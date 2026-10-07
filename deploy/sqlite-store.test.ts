import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteStore } from './sqlite-store.ts';
import { sqliteShardBackend } from './sqlite-shards.ts';
import { SQLITE_SCHEMA_VERSION } from './sqlite-schema.ts';
import { walletEffectSink } from '../server/economy/effects.ts';
import type { SqlBinding, SqliteStorage, SqlCursor, SqlRow } from './cf-types.ts';
import type { Db, SessionRecord, TransactOptions } from '../server/types.ts';

/** The document as these tests use it: sessions plus whatever collections a test invents (the real `Db` types the five known ones). */
interface Draft { version: number; sessions: Record<string, SessionRecord | undefined>; readonly $store: { scanSessions(predicate: (record: SessionRecord, key: string) => boolean): string[]; expiredSessionKeys(now: number): string[]; onceCounts(liveSince: number, lightKinds: readonly string[]): { money: number; light: number }; walletEffectsPage?(publicId:string,after:number,limit:number): {seq:number;amount:number;reason:string}[] }; [collection: string]: unknown }
interface LooseStore {
  transact<T>(operation: (db: Draft) => T | Promise<T>, options?: TransactOptions<T>): Promise<T>
  read<T>(operation: (db: Draft) => T | Promise<T>): Promise<T>
  flush(): Promise<void>
  authority(): { epoch: number; writable: boolean; retiredFromEpoch: number | null; walletEffectWatermark: number | null }
  assertWritable(): void
  retire(expectedEpoch: number): Promise<{ epoch: number; walletEffectWatermark: number; duplicate?: true }>
  layout: Required<ReturnType<typeof createSqliteStore>['layout']>
}
/** The store under test, seen through the looser document. */
const open = (storage: SqliteStorage, options?: Parameters<typeof createSqliteStore>[1]): LooseStore => createSqliteStore(storage, options) as unknown as LooseStore;

interface Receipt { at: number; kind: string; fp: string; result: { ok: boolean } }
interface ActionReceipt { actionAt: number; ok: boolean; code?: string; fingerprint?: string }
/** The shape of the sessions these tests store, as the tests read them back. */
interface Life { secret: string; publicId: string; expiresAt: number; cities: { lagos: { cash: number } }; actions: Record<string, ActionReceipt | undefined>; once: Record<string, Receipt | undefined> }
const life = (db: Draft): Life => db.sessions['secret'] as unknown as Life;
const put = (db: Draft, key: string, value: object): void => { db.sessions[key] = value as SessionRecord; };
const count = (db: DatabaseSync, query: string): number => Number((db.prepare(query).get() as { n: number }).n);
const sessionText = (db: DatabaseSync): string => (db.prepare('SELECT value FROM sessions').get() as { value: string }).value;
const codedError = (error: unknown): { code?: string; status?: number; cause?: Error } => error as { code?: string; status?: number; cause?: Error };

/** The Durable Object storage surface, backed by node:sqlite. */
function storageOn(db: DatabaseSync, rejectSync: () => boolean = () => false): SqliteStorage {
  return {
    sql: {
      exec<Row extends SqlRow>(query: string, ...params: SqlBinding[]): SqlCursor<Row> {
        const stmt = db.prepare(query);
        if (stmt.columns().length) { const rows = stmt.all(...params) as unknown as Row[]; return { toArray: () => rows, one: () => rows[0] as Row }; }
        stmt.run(...params);
        return { toArray: () => [], one: () => { throw Error('no rows'); } };
      },
    },
    transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    async sync() { if (rejectSync()) throw Error('barrier failed'); },
  };
}
function fixture(t: TestContext) {
 const db = new DatabaseSync(':memory:');t.after(()=>db.close());
 let rejectSync=false, failCommit=false;
 const storage=storageOn(db,()=>rejectSync);
 const store=open(storage,{beforeCommit(){if(failCommit)throw Error('commit failed');}});
 return {db,store,storage,fail(){failCommit=true;},barrierFail(){rejectSync=true;}};
}
const session=():Life=>({secret:'secret',publicId:'public',expiresAt:Date.now()+10000,cities:{lagos:{cash:5000}},actions:{},once:{}});
test('SQLite: atomic wallet, feature and receipt rollback; retry once; separate receipts',async t=>{
 const f=fixture(t);await f.store.transact(db=>{put(db,'secret',session());});
 f.db.exec("CREATE TRIGGER fail_feature BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT,'injected'); END");
 let announced=0;
 const command=(db: Draft)=>{const s=life(db);if(s.actions['a'])return 'duplicate';s.cities.lagos.cash-=100;db['social']={value:1};s.actions['a']={actionAt:Date.now(),ok:true};return 'ok';};
 await assert.rejects(f.store.transact(command,{committed(){announced++;}}),error=>codedError(error).code==='storage_unavailable'&&codedError(error).status===503&&/injected/.test(codedError(error).cause?.message ?? ''));
 assert.equal(announced,0);assert.equal(await f.store.read(db=>life(db).cities.lagos.cash),5000);assert.equal(count(f.db,'SELECT COUNT(*) AS n FROM action_receipts'),0);
 f.db.exec('DROP TRIGGER fail_feature');
 assert.equal(await f.store.transact(command),'ok');assert.equal(await f.store.transact(command),'duplicate');
 assert.equal(await f.store.read(db=>life(db).cities.lagos.cash),4900);
 assert.ok(!sessionText(f.db).includes('actions'));
 assert.equal(count(f.db,'SELECT COUNT(*) AS n FROM action_receipts'),1);
});
test('SQLite: wallet effects are atomic and force a lazy transaction durable, including a net-zero state cycle',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=open(storageOn(db),{lazyFlushMs:60000});await store.transact(d=>put(d,'secret',session()));
 const recordEffect=(d:Draft,amount:number,balanceAfter:number,reason:string)=>{const record=d.sessions['secret'];assert.ok(record);walletEffectSink(record,'lagos','effect-op')({at:1000,amount,balanceAfter,reason});};
 await store.transact(d=>{life(d).cities.lagos.cash=5100;recordEffect(d,100,5100,'Credit');},{durable:false});
 assert.equal(JSON.parse(sessionText(db)).cities.lagos.cash,5100);assert.equal(count(db,'SELECT COUNT(*) AS n FROM wallet_effects'),1);
 await store.transact(d=>{recordEffect(d,-50,5050,'Out');recordEffect(d,50,5100,'Back');},{durable:false});
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM wallet_effects'),3,'effects survive even when the saved life ends where it began');
 assert.deepEqual(await store.read(d=>d.$store.walletEffectsPage?.('public',0,51).map(row=>[row.seq,row.amount,row.reason])),[[1,100,'Credit'],[2,-50,'Out'],[3,50,'Back']]);
 db.exec("CREATE TRIGGER fail_effect BEFORE INSERT ON wallet_effects BEGIN SELECT RAISE(ABORT,'injected effect failure'); END");
 await assert.rejects(store.transact(d=>{life(d).cities.lagos.cash=5200;recordEffect(d,100,5200,'Fails');}),error=>codedError(error).code==='storage_unavailable');
 assert.equal(JSON.parse(sessionText(db)).cities.lagos.cash,5100);assert.equal(count(db,'SELECT COUNT(*) AS n FROM wallet_effects'),3);
});
test('SQLite: concurrent drafts serialize and failed callback leaves no state',async t=>{
 const f=fixture(t);await f.store.transact(db=>{put(db,'secret',session());});
 await Promise.all(Array.from({length:20},()=>f.store.transact(async db=>{const s=life(db);await Promise.resolve();s.cities.lagos.cash-=1;})));
 assert.equal(await f.store.read(db=>life(db).cities.lagos.cash),4980);
 await assert.rejects(f.store.transact(db=>{life(db).cities.lagos.cash=0;throw Error('refused');}),/refused/);
 assert.equal(await f.store.read(db=>life(db).cities.lagos.cash),4980);
});
test('SQLite: uncertain durability never acknowledges or continues serving cached state',async t=>{
 const f=fixture(t);let acknowledged=false;f.barrierFail();
 await assert.rejects(f.store.transact(db=>{put(db,'secret',session());},{committed(){acknowledged=true;}}),error=>codedError(error).code==='storage_unavailable'&&/barrier failed/.test(codedError(error).cause?.message ?? ''));
 assert.equal(acknowledged,false);await assert.rejects(f.store.read(db=>db.sessions['secret']),/storage_unavailable/);
 const restarted=open(f.storage);assert.equal(await restarted.read(db=>db.sessions['secret']?.publicId),'public');
});
test('SQLite: versioned schema upgrades atomically, refuses newer or incomplete versions, and keeps the deliberate receipt-index removal',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(TABLES_BEFORE_ACCOUNTS.join(';'));
 const old=session();db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(old.secret,old.publicId,old.expiresAt,JSON.stringify(old));
 const rowsBefore=JSON.stringify(db.prepare('SELECT * FROM sessions').all());
 const base=storageOn(db),broken:SqliteStorage={...base,sql:{exec<Row extends SqlRow>(query:string,...params:SqlBinding[]):SqlCursor<Row>{if(query.includes('CREATE TABLE IF NOT EXISTS main_store_authority'))throw Error('migration interrupted');return base.sql.exec<Row>(query,...params);}}};
 assert.throws(()=>open(broken),/migration interrupted/);assert.equal(count(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE name='app_schema'"),0,'failed migration rolled back its version fence');
 open(base);assert.equal((db.prepare('SELECT version FROM app_schema').get() as {version:number}).version,SQLITE_SCHEMA_VERSION);assert.equal(JSON.stringify(db.prepare('SELECT * FROM sessions').all()),rowsBefore);assert.equal(count(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE name='action_expiry'"),0);
 const currentSchema=JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all());open(base);assert.equal(JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()),currentSchema,'reopen changes no current schema object');
 db.prepare('UPDATE app_schema SET version=99 WHERE singleton=1').run();assert.throws(()=>open(base),/newer than supported/);db.prepare('UPDATE app_schema SET version=? WHERE singleton=1').run(SQLITE_SCHEMA_VERSION);db.exec('DROP INDEX wallet_effects_transfer');assert.throws(()=>open(base),/incomplete: missing wallet_effects_transfer/);
});
test('SQLite: legacy entry rows gain current projection columns without changing their values',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE entries (coll TEXT NOT NULL,map TEXT NOT NULL,key TEXT NOT NULL,ord INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(coll,map,key)) WITHOUT ROWID');db.prepare('INSERT INTO entries(coll,map,key,ord,value) VALUES(?,?,?,?,?)').run('social','players','ada',1,'{"name":"Ada"}');open(storageOn(db));
 assert.deepEqual((db.prepare('PRAGMA table_info(entries)').all() as {name:string}[]).map(column=>column.name),['coll','map','key','ord','value','ix','tx','jx']);assert.deepEqual(db.prepare('SELECT coll,map,key,ord,value FROM entries').all().map(row=>({...row})),[{coll:'social',map:'players',key:'ada',ord:1,value:'{"name":"Ada"}'}]);
});
test('SQLite: malformed legacy shape rolls back schema metadata and every newly-created table',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE sessions (secret TEXT PRIMARY KEY)');const before=JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all());assert.throws(()=>open(storageOn(db)),/sessions missing public_id, expires_at, value/);assert.equal(JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all()),before);assert.equal(count(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE name='app_schema'"),0);
});
test('SQLite: retirement flushes held baseline, records the effect watermark, fences late commits, and reopens read-only',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const storage=storageOn(db),first=open(storage,{lazyFlushMs:60000});
 await first.transact(d=>put(d,'secret',session()));
 await first.layout.setLayout('entries',true);
 await first.transact(d=>{const record=d.sessions['secret'];assert.ok(record);walletEffectSink(record,'lagos','before-retire')({at:1,amount:100,balanceAfter:5100,reason:'Before retire'});life(d).cities.lagos.cash=5100;});
 await first.transact(d=>{life(d).cities.lagos.cash=5200;},{durable:false});assert.equal(JSON.parse(sessionText(db)).cities.lagos.cash,5100);
 let release:()=>void=()=>{};const gate=new Promise<void>(done=>{release=done});let began:()=>void=()=>{};const started=new Promise<void>(done=>{began=done});
 const lateStore=open(storage),late=lateStore.transact(async d=>{began();await gate;life(d).cities.lagos.cash=9999;});await started;
 const retired=await first.retire(1);assert.deepEqual(retired,{epoch:2,walletEffectWatermark:1});assert.equal(JSON.parse(sessionText(db)).cities.lagos.cash,5200,'held baseline was durable before retirement');release();
 await assert.rejects(late,error=>codedError(error).code==='write_authority_retired');assert.deepEqual(await first.retire(1),{epoch:2,walletEffectWatermark:1,duplicate:true});await assert.rejects(first.retire(2),error=>codedError(error).code==='authority_epoch_conflict');
 let called=false;await assert.rejects(first.transact(()=>{called=true;}),error=>codedError(error).code==='write_authority_retired');assert.equal(called,false);
 db.exec('CREATE INDEX action_expiry ON action_receipts(action_at)');
 const reopened=open(storage,{layout:'shadow',lazyFlushMs:1});const before=JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all())+JSON.stringify(db.prepare('SELECT * FROM store_meta ORDER BY key').all());assert.equal(await reopened.read(d=>life(d).cities.lagos.cash),5200);await new Promise(done=>setTimeout(done,5));const after=JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all())+JSON.stringify(db.prepare('SELECT * FROM store_meta ORDER BY key').all());assert.equal(after,before,'retired reads do not prepare, backfill or restart a flush loop');
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE name='action_expiry'"),1,'retired reopen performs no optional schema cleanup');
 const rows=JSON.stringify(db.prepare("SELECT * FROM collections ORDER BY name").all())+JSON.stringify(db.prepare("SELECT * FROM entries ORDER BY coll,map,ord").all())+JSON.stringify(db.prepare("SELECT * FROM store_meta ORDER BY key").all());await assert.rejects(reopened.layout.migrate(),error=>codedError(error).code==='write_authority_retired');await assert.rejects(reopened.layout.setLayout('legacy'),error=>codedError(error).code==='write_authority_retired');await assert.rejects(reopened.layout.safety('drop',true),error=>codedError(error).code==='write_authority_retired');assert.equal(JSON.stringify(db.prepare("SELECT * FROM collections ORDER BY name").all())+JSON.stringify(db.prepare("SELECT * FROM entries ORDER BY coll,map,ord").all())+JSON.stringify(db.prepare("SELECT * FROM store_meta ORDER BY key").all()),rows);
});
test('SQLite: shard append, replace and metadata writes share the main-store authority while standalone shards remain usable',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const storage=storageOn(db),main=open(storage),guarded=sqliteShardBackend(storage,{beforeWrite:()=>main.assertWritable()});
 await guarded.append('lagos.ikeja','one');await guarded.replace('lagos.ikeja','compacted');await guarded.writeMeta({v:1});const before=[await guarded.read('lagos.ikeja'),JSON.stringify(await guarded.readMeta()),count(db,'SELECT COUNT(*) AS n FROM world_shards')];
 await main.retire(1);for(const write of [()=>guarded.append('lagos.ikeja','late'),()=>guarded.replace('lagos.ikeja','late'),()=>guarded.writeMeta({v:2})])await assert.rejects(write(),error=>codedError(error).code==='write_authority_retired');assert.deepEqual([await guarded.read('lagos.ikeja'),JSON.stringify(await guarded.readMeta()),count(db,'SELECT COUNT(*) AS n FROM world_shards')],before);
 const standaloneDb=new DatabaseSync(':memory:');t.after(()=>standaloneDb.close());const standalone=sqliteShardBackend(storageOn(standaloneDb));await standalone.append('test','ok');assert.equal(await standalone.read('test'),'ok');
});
test('SQLite: an uncertain retirement barrier fails closed and a reopen sees the persisted authority',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let reject=false;const storage=storageOn(db,()=>reject),store=open(storage);reject=true;
 await assert.rejects(store.retire(1),error=>codedError(error).code==='storage_unavailable');await assert.rejects(store.read(()=>true),error=>codedError(error).code==='storage_unavailable');
 reject=false;const reopened=open(storage);assert.deepEqual(reopened.authority(),{epoch:2,writable:false,retiredFromEpoch:1,walletEffectWatermark:0});assert.equal(await reopened.read(()=>true),true);
});
test('SQLite: retirement by another instance refuses a stale held flush without changing stored rows',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const storage=storageOn(db),stale=open(storage,{lazyFlushMs:60000}),tool=open(storage);await stale.transact(d=>put(d,'secret',session()));await stale.transact(d=>{life(d).cities.lagos.cash=4000;},{durable:false});
 const before=JSON.stringify(db.prepare('SELECT * FROM sessions').all());await tool.retire(1);await assert.rejects(stale.flush(),error=>codedError(error).code==='write_authority_retired');assert.equal(JSON.stringify(db.prepare('SELECT * FROM sessions').all()),before);
});
test('SQLite: legacy inline receipts migrate without erasing dedupe metadata',async t=>{
 const f=fixture(t),s=session();s.actions['old']={actionAt:Date.now(),ok:true,code:'saved',fingerprint:'original'};
 f.storage.sql.exec('INSERT INTO sessions VALUES(?,?,?,?)',s.secret,s.publicId,s.expiresAt,JSON.stringify(s));
 await f.store.transact(db=>assert.equal(life(db).actions['old']?.fingerprint,'original'));
 assert.deepEqual(await f.store.read(db=>Object.keys(life(db).actions)),['old']);
 assert.ok(!sessionText(f.db).includes('actions'));
});
test('SQLite: commit hooks retain private symbol metadata and fire once after durability',async t=>{
 const f=fixture(t),symbol=Symbol('private effects');let effects=0;
 type Effects = { ok: boolean; [symbol]?: string[] };
 const result=await f.store.transact(db=>{db['social']={saved:true};const r:Effects={ok:true};Object.defineProperty(r,symbol,{value:['effect']});return r;},{committed(r){effects+=(r[symbol] as string[]).length;}});
 assert.equal(effects,1);assert.equal((result[symbol] as string[])[0],'effect');assert.equal(JSON.stringify(result),'{"ok":true}');
});
test('SQLite: exactly-once receipts live in their own table, are counted by class and roll back with the write',async t=>{
 const f=fixture(t);await f.store.transact(db=>{put(db,'secret',session());});
 const now=Date.now();
 await f.store.transact(db=>{const s=life(db);s.once['a']={at:now,kind:'transfer',fp:'x',result:{ok:true}};s.once['b']={at:now,kind:'interact',fp:'y',result:{ok:true}};s.once['old']={at:now-90000000,kind:'transfer',fp:'z',result:{ok:true}};});
 assert.ok(!sessionText(f.db).includes('"once"'),'the session row carries no receipts');
 assert.equal(count(f.db,'SELECT COUNT(*) AS n FROM once_receipts'),3);
 assert.deepEqual(await f.store.read(db=>db.$store.onceCounts(now-86400000,['interact'])),{money:1,light:1});
 assert.deepEqual(await f.store.read(db=>[Object.keys(life(db).once).sort(),Object.hasOwn(life(db).once,'a'),life(db).once['a']?.kind]),[['a','b','old'],true,'transfer']);
 f.fail();
 await assert.rejects(f.store.transact(db=>{const s=life(db);delete s.once['old'];s.once['c']={at:now,kind:'transfer',fp:'q',result:{ok:true}};s.cities.lagos.cash-=500;}),error=>codedError(error).code==='storage_unavailable');
 assert.equal(count(f.db,'SELECT COUNT(*) AS n FROM once_receipts'),3,'a failed commit keeps no receipt and removes none');
});
test('SQLite: a collection larger than one row is split and read back whole; a scan sees the draft',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const storage=storageOn(db);
 const store=open(storage,{chunk:64});
 const big={lines:Array.from({length:40},(_,i)=>`line ${i} with some text`)};
 await store.transact(d=>{d['social']=big;d['civic']={small:true};});
 assert.ok(count(db,"SELECT COUNT(*) AS n FROM collection_parts WHERE name='social'")>3);
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM collection_parts WHERE name='civic'"),0);
 assert.deepEqual(await store.read(d=>d['social']),big);
 await store.transact(d=>{d['social']={lines:['short']};});
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM collection_parts"),0,'a collection that shrank leaves no parts behind');
 assert.deepEqual(await open(storage).read(d=>d['social']),{lines:['short']});
 await store.transact(d=>{put(d,'one',{secret:'one',publicId:'p1',expiresAt:5,cities:{},actions:{}});});
 const seen=await store.transact(d=>{put(d,'two',{secret:'two',publicId:'p2',expiresAt:1,cities:{},actions:{}});delete d.sessions['one'];return d.$store.scanSessions(s=>s.expiresAt<10);});
 assert.deepEqual(seen,['two'],'a session added in the draft is scanned and one removed in it is not');
});
test('SQLite: a collection that exists is an own property of the document, so the shared collection() helper never resets it',async t=>{
 const {collection:shared}=await import('../server/protocol.ts');
 const collection=(db: Draft,name: string,initial: object)=>shared(db as unknown as Db,name,initial);
 const f=fixture(t);
 type Social = { players: Record<string, { name: string }> };
 await f.store.transact(db=>{assert.equal(Object.hasOwn(db,'social'),false);(collection(db,'social',{players:{}}) as Social).players['ada']={name:'Ada'};});
 await f.store.transact(db=>{assert.equal(Object.hasOwn(db,'social'),true);assert.equal('social' in db,true);(collection(db,'social',{players:{}}) as Social).players['bola']={name:'Bola'};});
 assert.deepEqual(await f.store.read(db=>Object.keys((db['social'] as Social).players)),['ada','bola']);
});

// ---- accounts (server/accounts/service.ts): two tables beside the existing ones ----
type AccountRow = { id: string; publicId: string | null; devices: string[] };
type DeviceRow = { account: string; expiresAt: number };
const accountsOf = (db: Draft): Record<string, AccountRow | undefined> => db['accounts'] as Record<string, AccountRow | undefined>;
const devicesOf = (db: Draft): Record<string, DeviceRow | undefined> => db['accountDevices'] as Record<string, DeviceRow | undefined>;
/** The tables exactly as a database made before accounts existed has them. */
const TABLES_BEFORE_ACCOUNTS = [
 'CREATE TABLE sessions (secret TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, value TEXT NOT NULL)',
 'CREATE TABLE archived_lives (public_id TEXT PRIMARY KEY, value TEXT NOT NULL)',
 'CREATE TABLE action_receipts (sender TEXT NOT NULL, action_id TEXT NOT NULL, action_at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,action_id))',
 'CREATE INDEX action_expiry ON action_receipts(action_at)',
 'CREATE TABLE once_receipts (sender TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,id))',
 'CREATE INDEX once_expiry ON once_receipts(at)',
 'CREATE TABLE collections (name TEXT PRIMARY KEY, value TEXT NOT NULL)',
 'CREATE TABLE collection_parts (name TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(name,part))',
];
test('SQLite: a database made before accounts existed gains the account tables empty; no existing table or row changes',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 for(const statement of TABLES_BEFORE_ACCOUNTS)db.exec(statement);
 const old=session();
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(old.secret,old.publicId,old.expiresAt,JSON.stringify({...old,actions:undefined,once:undefined}));
 db.prepare('INSERT INTO action_receipts VALUES(?,?,?,?)').run(old.publicId,'1:a',1,JSON.stringify({actionAt:1,ok:true,code:'saved',fingerprint:'f'}));
 db.prepare('INSERT INTO archived_lives VALUES(?,?)').run('gone',JSON.stringify({publicId:'gone',name:'Gone',cities:{},archivedAt:1}));
 db.prepare('INSERT INTO collections VALUES(?,?)').run('social',JSON.stringify({players:{ada:{name:'Ada'}}}));
 const schema=()=>(db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name NOT LIKE 'account%' AND tbl_name NOT IN ('entries','store_meta') ORDER BY name").all() as {name:string;sql:string}[]).map(row=>`${row.name}:${row.sql}`);
 const rows=()=>['sessions','archived_lives','action_receipts','once_receipts','collections','collection_parts'].map(table=>JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()));
 const schemaBefore=schema(),rowsBefore=rows();
 const previousNames=new Set(schemaBefore.map(row=>row.slice(0,row.indexOf(':'))));
 const store=open(storageOn(db));
 assert.deepEqual(schema().filter(row=>previousNames.has(row.slice(0,row.indexOf(':')))),schemaBefore.filter(line=>!line.startsWith('action_expiry:')),'no existing table was altered; the one index no query reads is gone');
 assert.deepEqual(rows(),rowsBefore,'no existing row was touched by opening the store');
 assert.deepEqual((db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'account%' ORDER BY name").all() as {name:string}[]).map(row=>row.name).filter(name=>!name.startsWith('sqlite_')),['account_devices','account_devices_account','accounts']);
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM accounts'),0);assert.equal(count(db,'SELECT COUNT(*) AS n FROM account_devices'),0);
 assert.deepEqual((db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'wallet_effects%' ORDER BY name").all() as {name:string}[]).map(row=>row.name),['wallet_effects','wallet_effects_operation','wallet_effects_player','wallet_effects_transfer']);
 // Everything that was there reads as before, and the new collections are there, empty.
 assert.deepEqual(await store.read(d=>[life(d).cities.lagos.cash,life(d).actions['1:a']?.code,(d['social'] as {players:object}).players,Object.keys(accountsOf(d)),Object.keys(devicesOf(d)),accountsOf(d)['fb:nobody'],devicesOf(d)['nobody']]),[5000,'saved',{ada:{name:'Ada'}},[],[],undefined,undefined]);
 // The first account is written beside the session it belongs to, in one transaction.
 await store.transact(d=>{accountsOf(d)['fb:ada']={id:'fb:ada',publicId:old.publicId,devices:['cookie-1']};devicesOf(d)['cookie-1']={account:'fb:ada',expiresAt:99};life(d).cities.lagos.cash-=1;});
 assert.deepEqual(db.prepare('SELECT id,public_id FROM accounts').all().map(row=>({...row})),[{id:'fb:ada',public_id:old.publicId}]);
 assert.deepEqual(db.prepare('SELECT secret,account_id,expires_at FROM account_devices').all().map(row=>({...row})),[{secret:'cookie-1',account_id:'fb:ada',expires_at:99}]);
 assert.deepEqual(schema().filter(row=>previousNames.has(row.slice(0,row.indexOf(':')))),schemaBefore.filter(line=>!line.startsWith('action_expiry:')));
 // A second start finds what the first one wrote.
 assert.deepEqual(await open(storageOn(db)).read(d=>[accountsOf(d)['fb:ada']?.devices,devicesOf(d)['cookie-1']?.account,life(d).cities.lagos.cash]),[['cookie-1'],'fb:ada',4999]);
});
test('SQLite: an earlier local wallet effect table gains nullable transfer linkage without changing old rows',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE wallet_effects (seq INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL, city_id TEXT NOT NULL, operation_id TEXT, ordinal INTEGER NOT NULL, at INTEGER NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, reason TEXT NOT NULL)');
 db.prepare('INSERT INTO wallet_effects(public_id,city_id,operation_id,ordinal,at,amount,balance_after,reason) VALUES(?,?,?,?,?,?,?,?)').run('public','lagos','old',0,1,100,5100,'Old credit');
 open(storageOn(db));
 assert.ok((db.prepare('PRAGMA table_info(wallet_effects)').all() as {name:string}[]).some(column=>column.name==='transfer_id'));
 assert.deepEqual(db.prepare('SELECT public_id,amount,reason,transfer_id FROM wallet_effects').all().map(row=>({...row})),[{public_id:'public',amount:100,reason:'Old credit',transfer_id:null}]);
});
test('SQLite: account rows are read by key, change and disappear with their transaction, and a failed commit keeps none',async t=>{
 const f=fixture(t);await f.store.transact(db=>{put(db,'secret',session());});
 await f.store.transact(db=>{accountsOf(db)['fb:ada']={id:'fb:ada',publicId:'public',devices:['c1','c2']};devicesOf(db)['c1']={account:'fb:ada',expiresAt:10};devicesOf(db)['c2']={account:'fb:ada',expiresAt:20};});
 // A change inside a stored record is saved; an untouched one is not rewritten.
 await f.store.transact(db=>{const device=devicesOf(db)['c1'];if(device)device.expiresAt=11;});
 assert.deepEqual(f.db.prepare('SELECT secret,expires_at FROM account_devices ORDER BY secret').all().map(row=>({...row})),[{secret:'c1',expires_at:11},{secret:'c2',expires_at:20}]);
 // A failed commit: the account change, the device removal and the session change are all undone together.
 f.db.exec("CREATE TRIGGER fail_device BEFORE DELETE ON account_devices BEGIN SELECT RAISE(ABORT,'injected'); END");
 await assert.rejects(f.store.transact(db=>{const account=accountsOf(db)['fb:ada'];if(account)account.devices=['c1'];delete devicesOf(db)['c2'];life(db).cities.lagos.cash=0;}),error=>codedError(error).code==='storage_unavailable');
 f.db.exec('DROP TRIGGER fail_device');
 assert.deepEqual(await f.store.read(db=>[accountsOf(db)['fb:ada']?.devices,devicesOf(db)['c2']?.expiresAt,life(db).cities.lagos.cash]),[['c1','c2'],20,5000]);
 // A throw inside the callback leaves nothing either.
 await assert.rejects(f.store.transact(db=>{accountsOf(db)['fb:eve']={id:'fb:eve',publicId:null,devices:[]};throw Error('refused');}),/refused/);
 assert.equal(count(f.db,'SELECT COUNT(*) AS n FROM accounts'),1);
 // Removing a row that this transaction never read still removes it (sign out everywhere names bindings it has not loaded).
 await f.store.transact(db=>{delete devicesOf(db)['c2'];delete devicesOf(db)['never-there'];});
 assert.deepEqual(f.db.prepare('SELECT secret FROM account_devices').all().map(row=>({...row})),[{secret:'c1'}]);
 await f.store.transact(db=>{delete accountsOf(db)['fb:ada'];delete devicesOf(db)['c1'];});
 assert.equal(count(f.db,'SELECT COUNT(*) AS n FROM accounts')+count(f.db,'SELECT COUNT(*) AS n FROM account_devices'),0);
 // The shared collection() helper sees both as existing collections and never replaces them.
 const {collection:shared}=await import('../server/protocol.ts');
 await f.store.transact(db=>{(shared(db as unknown as Db,'accounts',{}) as Record<string,AccountRow>)['fb:bo']={id:'fb:bo',publicId:null,devices:[]};});
 assert.equal(count(f.db,'SELECT COUNT(*) AS n FROM accounts'),1);assert.equal(count(f.db,"SELECT COUNT(*) AS n FROM collections WHERE name LIKE 'account%'"),0,'accounts are rows of their own table, never a JSON collection');
});

// ---- lazy transactions: held in memory, written later (sqlite-store.ts LAZY) ----
/** A storage that also says how many statements wrote to each table. */
function countingStorage(db: DatabaseSync): { storage: SqliteStorage; writes: Map<string, number>; reset(): void } {
 const inner=storageOn(db),writes=new Map<string,number>();
 return { writes, reset(){writes.clear();}, storage:{...inner,sql:{exec<Row extends SqlRow>(query: string,...params: SqlBinding[]): SqlCursor<Row>{
  const table=/^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/.exec(query)?.[1];
  if(table)writes.set(table,(writes.get(table)??0)+1);
  return inner.sql.exec<Row>(query,...params);
 }}}};
}
const lazy={durable:false} as const;
/** A store that holds lazy changes for an hour (so only an explicit flush writes them); it is closed before its database. */
function lazyFixture(t: TestContext) {
 const db=new DatabaseSync(':memory:');
 const c=countingStorage(db),store=createSqliteStore(c.storage,{lazyFlushMs:3600000}),loose=store as unknown as LooseStore;
 t.after(async()=>{await store.close();db.close();});
 return {db,c,store,loose};
}
test('SQLite: a lazy change to a stored session or collection is held in memory, seen by everyone, and written by a flush',async t=>{
 const {db,c,store,loose}=lazyFixture(t);
 await loose.transact(d=>{put(d,'secret',session());d['pulse']={visits:1};});
 const stored=sessionText(db);c.reset();
 let announced=0;
 await loose.transact(d=>{life(d).cities.lagos.cash=4000;(d['pulse'] as {visits:number}).visits=2;},{...lazy,committed(){announced++;}});
 assert.equal(announced,1,'the commit hook of a lazy change runs');
 assert.equal(c.writes.size,0,'nothing was written');assert.equal(sessionText(db),stored);
 assert.deepEqual(await loose.read(d=>[life(d).cities.lagos.cash,(d['pulse'] as {visits:number}).visits]),[4000,2],'a read sees the held change');
 assert.deepEqual(await loose.read(d=>d.$store.scanSessions(record=>(record as unknown as Life).cities.lagos.cash===4000)),['secret'],'and so does a scan');
 assert.equal(store.stats().held,2);
 // A second lazy change of the same rows replaces the first: still nothing written.
 await loose.transact(d=>{life(d).cities.lagos.cash=3900;},lazy);
 assert.equal(c.writes.size,0);
 await store.flush();
 assert.deepEqual(Object.fromEntries(c.writes),{sessions:1,collections:1},'one statement per held row');
 assert.equal(store.stats().held,0);
 assert.deepEqual(await open(c.storage).read(d=>[life(d).cities.lagos.cash,(d['pulse'] as {visits:number}).visits]),[3900,2],'a store opened on the same storage reads what was flushed');
 c.reset();await store.flush();assert.equal(c.writes.size,0,'a flush with nothing held writes nothing');
 // `durable` as a function of the result: false is lazy, true is written before the answer.
 await loose.transact(d=>{life(d).cities.lagos.cash=3800;return {material:false};},{durable:result=>result.material});
 assert.equal(c.writes.size,0);
 await loose.transact(d=>{life(d).cities.lagos.cash=3700;return {material:true};},{durable:result=>result.material});
 assert.deepEqual(Object.fromEntries(c.writes),{sessions:1});assert.equal(store.stats().held,0);
});
test('SQLite: a durable transaction writes the held change of what it touches with its own; memory lost first loses only what was lazy',async t=>{
 const {db,c,store,loose}=lazyFixture(t);
 await loose.transact(d=>{put(d,'secret',session());put(d,'other',{...session(),secret:'other',publicId:'public-2'});d['pulse']={visits:1};});
 await loose.transact(d=>{life(d).cities.lagos.cash=4000;(d.sessions['other'] as unknown as Life).cities.lagos.cash=1;(d['pulse'] as {visits:number}).visits=2;},lazy);
 c.reset();
 // An action on the first session: its held clock is written with the action; the other session and the counter stay held.
 await loose.transact(d=>{const s=life(d);s.cities.lagos.cash-=100;s.actions['a']={actionAt:1,ok:true};});
 assert.deepEqual(Object.fromEntries(c.writes),{sessions:1,action_receipts:1});
 assert.equal(JSON.parse(sessionText(db)).cities.lagos.cash,3900);assert.equal(store.stats().held,2);
 // The object loses its memory: a new store on the same storage. The durable action is there; the two lazy changes are not.
 const woken=open(c.storage);
 assert.deepEqual(await woken.read(d=>[life(d).cities.lagos.cash,life(d).actions['a']?.ok,(d.sessions['other'] as unknown as Life).cities.lagos.cash,(d['pulse'] as {visits:number}).visits]),[3900,true,5000,1]);
});
test('SQLite: a lazy transaction that makes or removes a row, or touches a receipt, is written at once',async t=>{
 const {db,c,store,loose}=lazyFixture(t);
 await loose.transact(d=>{put(d,'secret',session());},lazy);
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM sessions'),1,'a new session');
 await loose.transact(d=>{d['pulse']={visits:1};},lazy);
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM collections'),1,'a new collection');
 await loose.transact(d=>{life(d).once['1:x']={at:1,kind:'gift',fp:'f',result:{ok:true}};},lazy);
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM once_receipts'),1,'a receipt');
 // Held first, then removed lazily: the removal is durable and nothing held is written back over it.
 await loose.transact(d=>{life(d).cities.lagos.cash=1;},lazy);assert.equal(store.stats().held,1);
 await loose.transact(d=>{if(d.sessions['secret'])delete d.sessions['secret'];},lazy);
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM sessions'),0);assert.equal(store.stats().held,0);
 await store.flush();assert.equal(count(db,'SELECT COUNT(*) AS n FROM sessions'),0);
 assert.equal(store.stats().lazy,1,'one transaction was held');
});
test('SQLite: a held change gives way to a row that was written underneath it; without lazyFlushMs every write is durable',async t=>{
 const {db,c,store,loose}=lazyFixture(t);
 await loose.transact(d=>{put(d,'secret',session());});
 await loose.transact(d=>{life(d).cities.lagos.cash=4000;},lazy);
 const edited=JSON.parse(sessionText(db));edited.cities.lagos.cash=77;
 db.prepare('UPDATE sessions SET value=? WHERE secret=?').run(JSON.stringify(edited),'secret');
 assert.equal(await loose.read(d=>life(d).cities.lagos.cash),77);
 await store.flush();assert.equal(JSON.parse(sessionText(db)).cities.lagos.cash,77);
 const plain=fixture(t);await plain.store.transact(d=>{put(d,'secret',session());});
 await plain.store.transact(d=>{life(d).cities.lagos.cash=4000;},lazy);
 assert.equal(JSON.parse(sessionText(plain.db)).cities.lagos.cash,4000);
});
test('SQLite: a write names only what changed — a session is updated by its key, a split collection rewrites only the parts that differ',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const c=countingStorage(db),loose=open(c.storage,{chunk:64});
 const statements: string[]=[];const exec=c.storage.sql.exec.bind(c.storage.sql);
 c.storage.sql.exec=<Row extends SqlRow>(query: string,...params: SqlBinding[]): SqlCursor<Row>=>{statements.push(query);return exec<Row>(query,...params);};
 await loose.transact(d=>{put(d,'secret',session());});
 statements.length=0;
 await loose.transact(d=>{life(d).cities.lagos.cash=1;});
 assert.deepEqual(statements.filter(query=>/^(INSERT|UPDATE|DELETE)/.test(query)),['UPDATE sessions SET expires_at=?, value=? WHERE secret=?'],'the unique index by public id is not rewritten');
 // A public id that changes goes through the full statement.
 await loose.transact(d=>{(d.sessions['secret'] as SessionRecord).publicId='public-rotated';});
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM sessions WHERE public_id='public-rotated'"),1);
 const lines=Array.from({length:40},(_,i)=>`line ${String(i).padStart(2,'0')} with some text`);
 await loose.transact(d=>{d['social']={lines};});
 const parts=count(db,"SELECT COUNT(*) AS n FROM collection_parts WHERE name='social'");assert.ok(parts>8);
 c.reset();
 // The same length, one line different: one part differs.
 await loose.transact(d=>{(d['social'] as {lines:string[]}).lines[20]='LINE 20 WITH SOME TEXT';});
 assert.ok((c.writes.get('collection_parts')??0)<=2&&c.writes.size===1,`the part or two the line lies in, and the head row is left alone (${JSON.stringify(Object.fromEntries(c.writes))} of ${parts} parts)`);
 assert.equal((await loose.read(d=>(d['social'] as {lines:string[]}).lines[20])),'LINE 20 WITH SOME TEXT');
 // Shorter: the changed tail is written and the surplus parts are removed with one statement.
 c.reset();await loose.transact(d=>{(d['social'] as {lines:string[]}).lines.length=30;});
 assert.ok((c.writes.get('collection_parts')??0)<=3,`only the tail was written (${c.writes.get('collection_parts')} statements)`);assert.equal(c.writes.get('collections'),1);
 assert.deepEqual(await open(c.storage,{chunk:64}).read(d=>(d['social'] as {lines:string[]}).lines.length),30);
 // Unchanged: nothing.
 c.reset();await loose.transact(d=>{(d['social'] as {lines:string[]}).lines[0]=lines[0] as string;});assert.equal(c.writes.size,0);
});

test('SQLite: expired sessions are found by their stored expiry: no other record is read, and a held or drafted renewal is honoured',async t=>{
 const db=new DatabaseSync(':memory:');
 const inner=storageOn(db),queries: string[]=[];
 const storage: SqliteStorage={...inner,sql:{exec<Row extends SqlRow>(query: string,...params: SqlBinding[]): SqlCursor<Row>{queries.push(`${query} ${params.join(',')}`);return inner.sql.exec<Row>(query,...params);}}};
 const store=createSqliteStore(storage,{lazyFlushMs:3600000}),loose=store as unknown as LooseStore;
 t.after(async()=>{await store.close();db.close();});
 const at=1000000,record=(key: string,expiresAt: number)=>({...session(),secret:key,publicId:`public-${key}`,expiresAt});
 await loose.transact(d=>{put(d,'gone',record('gone',at-1));put(d,'renewed',record('renewed',at-1));put(d,'drafted',record('drafted',at-1));for(let i=0;i<20;i++)put(d,`live-${i}`,record(`live-${i}`,at+5000));});
 // One session is renewed by a change that is only held in memory: its row still says it has run out.
 await loose.transact(d=>{(d.sessions['renewed'] as SessionRecord).expiresAt=at+5000;},lazy);
 queries.length=0;
 const found=await loose.transact(d=>{
  (d.sessions['drafted'] as SessionRecord).expiresAt=at+5000; // renewed by this transaction
  put(d,'fresh',record('fresh',at-5)); // made, already run out, by this transaction
  return d.$store.expiredSessionKeys(at).sort();
 },lazy);
 assert.deepEqual(found,['fresh','gone']);
 assert.equal(queries.some(query=>/SELECT secret,value FROM sessions/.test(query)),false,'the table is not read whole');
 assert.equal(queries.some(query=>/FROM sessions WHERE secret = \? live-/.test(query)),false,'a session that has not run out is not read');
 // A scan answers the same keys (and reads everything to do it).
 assert.deepEqual((await loose.read(d=>d.$store.scanSessions(item=>!(item.expiresAt>at)))).sort(),['fresh','gone']);
});

test('SQLite: walking a player\'s receipts is one statement however many there are, and what a transaction changed is kept',async t=>{
 const db=new DatabaseSync(':memory:');
 const inner=storageOn(db),queries: string[]=[];
 const storage: SqliteStorage={...inner,sql:{exec<Row extends SqlRow>(query: string,...params: SqlBinding[]): SqlCursor<Row>{queries.push(query);return inner.sql.exec<Row>(query,...params);}}};
 const store=open(storage);t.after(()=>db.close());
 await store.transact(d=>{put(d,'secret',session());const s=life(d);for(let i=0;i<500;i++){s.actions[`a${i}`]={actionAt:i,ok:true,code:'done'};s.once[`o${i}`]={at:i,kind:'gift',fp:'f',result:{ok:true}};}});
 queries.length=0;
 const seen=await store.transact(d=>{
  const s=life(d);
  delete s.actions['a7'];s.actions['fresh']={actionAt:900,ok:false,code:'refused'}; // changed before the walk
  const actions=Object.entries(s.actions),once=Object.values(s.once);
  for(const [id,receipt] of actions) if((receipt as ActionReceipt).actionAt<100) delete s.actions[id]; // what the shared code does with expired ones
  return {actions:actions.length,once:once.length,left:Object.keys(s.actions).length,has7:Object.hasOwn(s.actions,'a7'),fresh:s.actions['fresh']?.code,one:s.actions['a250']?.code};
 });
 assert.deepEqual(seen,{actions:500,once:500,left:401,has7:false,fresh:'refused',one:'done'});
 const reads=queries.filter(query=>/^SELECT/.test(query)&&/FROM (action_receipts|once_receipts)/.test(query));
 assert.equal(reads.length,2,`one read per kind of receipt, not one per receipt (${reads.length})`);
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM action_receipts'),401);assert.equal(count(db,'SELECT COUNT(*) AS n FROM once_receipts'),500);
 assert.deepEqual(await store.read(d=>[life(d).actions['a7'],life(d).actions['a99'],life(d).actions['a100']?.code,life(d).actions['fresh']?.code]),[undefined,undefined,'done','refused']);
});
test('SQLite: counting or listing the sessions reads their keys and no record — only the one that is then asked for',async t=>{
 const db=new DatabaseSync(':memory:');
 const inner=storageOn(db),queries: string[]=[];
 const storage: SqliteStorage={...inner,sql:{exec<Row extends SqlRow>(query: string,...params: SqlBinding[]): SqlCursor<Row>{queries.push(query);return inner.sql.exec<Row>(query,...params);}}};
 const store=createSqliteStore(storage),loose=store as unknown as LooseStore;
 t.after(async()=>{await store.close();db.close();});
 await loose.transact(d=>{for(let i=0;i<50;i++)put(d,`key-${i}`,{...session(),secret:`key-${i}`,publicId:`public-${i}`});});
 queries.length=0;
 // What a new session asks before it is made (server/routes/core.ts): how many are there?
 assert.equal(await loose.read(d=>Object.keys(d.sessions).length),50);
 assert.equal(queries.filter(query=>/SELECT value FROM sessions WHERE secret/.test(query)).length,0,'no record was read to count them');
 queries.length=0;
 // Listing the keys and then reading one reads that one; the values are still there for whoever walks them.
 const seen=await loose.transact(d=>{const keys=Object.keys(d.sessions);put(d,'new',{...session(),secret:'new',publicId:'public-new'});const gone=d.sessions['key-0'];if(gone)delete d.sessions['key-0'];return {keys:keys.length,after:Object.keys(d.sessions).length,one:(d.sessions['key-7'] as SessionRecord).publicId,has:'key-3' in d.sessions,gone:'key-0' in d.sessions};});
 assert.deepEqual(seen,{keys:50,after:50,one:'public-7',has:true,gone:false});
 assert.equal(queries.filter(query=>/SELECT value FROM sessions WHERE secret/.test(query)).length,2,'the one that was removed and the one that was asked for');
 assert.deepEqual(await loose.read(d=>Object.values(d.sessions).map(item=>(item as SessionRecord).publicId).sort().slice(0,3)),['public-1','public-10','public-11']);
 assert.deepEqual(await loose.read(d=>Object.entries(d.sessions).filter(([key])=>key==='new').map(([,item])=>(item as SessionRecord).secret)),['new']);
});
