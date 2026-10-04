import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteStore } from './sqlite-store.ts';
import type { SqlBinding, SqliteStorage, SqlCursor, SqlRow } from './cf-types.ts';
import type { Draft, SessionRecord } from './host-seam.ts';

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
 const store=createSqliteStore(storage,{beforeCommit(){if(failCommit)throw Error('commit failed');}});
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
 const restarted=createSqliteStore(f.storage);assert.equal(await restarted.read(db=>db.sessions['secret']?.publicId),'public');
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
 const store=createSqliteStore(storage,{chunk:64});
 const big={lines:Array.from({length:40},(_,i)=>`line ${i} with some text`)};
 await store.transact(d=>{d['social']=big;d['civic']={small:true};});
 assert.ok(count(db,"SELECT COUNT(*) AS n FROM collection_parts WHERE name='social'")>3);
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM collection_parts WHERE name='civic'"),0);
 assert.deepEqual(await store.read(d=>d['social']),big);
 await store.transact(d=>{d['social']={lines:['short']};});
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM collection_parts"),0,'a collection that shrank leaves no parts behind');
 assert.deepEqual(await createSqliteStore(storage).read(d=>d['social']),{lines:['short']});
 await store.transact(d=>{put(d,'one',{secret:'one',publicId:'p1',expiresAt:5,cities:{},actions:{}});});
 const seen=await store.transact(d=>{put(d,'two',{secret:'two',publicId:'p2',expiresAt:1,cities:{},actions:{}});delete d.sessions['one'];return d.$store.scanSessions(s=>s.expiresAt<10);});
 assert.deepEqual(seen,['two'],'a session added in the draft is scanned and one removed in it is not');
});
test('SQLite: a collection that exists is an own property of the document, so the shared collection() helper never resets it',async t=>{
 const {collection}=await import('../server/protocol.js');
 const f=fixture(t);
 type Social = { players: Record<string, { name: string }> };
 await f.store.transact(db=>{assert.equal(Object.hasOwn(db,'social'),false);(collection(db,'social',{players:{}}) as Social).players['ada']={name:'Ada'};});
 await f.store.transact(db=>{assert.equal(Object.hasOwn(db,'social'),true);assert.equal('social' in db,true);(collection(db,'social',{players:{}}) as Social).players['bola']={name:'Bola'};});
 assert.deepEqual(await f.store.read(db=>Object.keys((db['social'] as Social).players)),['ada','bola']);
});
