import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteStore } from './sqlite-store.js';
function fixture(t) {
 const db = new DatabaseSync(':memory:');t.after(()=>db.close());
 let rejectSync=false, failCommit=false;
 const storage={sql:{exec(query,...params){const stmt=db.prepare(query);if(stmt.columns().length){const rows=stmt.all(...params);return {toArray:()=>rows,one:()=>rows[0]};}stmt.run(...params);return {toArray:()=>[]};}},transactionSync(fn){db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){if(rejectSync)throw Error('barrier failed');}};
 const store=createSqliteStore(storage,{beforeCommit(){if(failCommit)throw Error('commit failed');}});
 return {db,store,storage,fail(){failCommit=true;},barrierFail(){rejectSync=true;}};
}
const session=()=>({secret:'secret',publicId:'public',expiresAt:Date.now()+10000,cities:{lagos:{cash:5000}},actions:{}});
test('SQLite: atomic wallet, feature and receipt rollback; retry once; separate receipts',async t=>{
 const f=fixture(t);await f.store.transact(db=>{db.sessions.secret=session();});
 f.db.exec("CREATE TRIGGER fail_feature BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT,'injected'); END");
 let announced=0;
 const command=db=>{const s=db.sessions.secret;if(s.actions.a)return 'duplicate';s.cities.lagos.cash-=100;db.social={value:1};s.actions.a={actionAt:Date.now(),ok:true};return 'ok';};
 await assert.rejects(f.store.transact(command,{committed(){announced++;}}),/injected/);
 assert.equal(announced,0);assert.equal(await f.store.read(db=>db.sessions.secret.cities.lagos.cash),5000);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM action_receipts').get().n,0);
 f.db.exec('DROP TRIGGER fail_feature');
 assert.equal(await f.store.transact(command),'ok');assert.equal(await f.store.transact(command),'duplicate');
 assert.equal(await f.store.read(db=>db.sessions.secret.cities.lagos.cash),4900);
 assert.ok(!f.db.prepare('SELECT value FROM sessions').get().value.includes('actions'));
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM action_receipts').get().n,1);
});
test('SQLite: concurrent drafts serialize and failed callback leaves no state',async t=>{
 const f=fixture(t);await f.store.transact(db=>{db.sessions.secret=session();});
 await Promise.all(Array.from({length:20},()=>f.store.transact(async db=>{const s=db.sessions.secret;await Promise.resolve();s.cities.lagos.cash-=1;})));
 assert.equal(await f.store.read(db=>db.sessions.secret.cities.lagos.cash),4980);
 await assert.rejects(f.store.transact(db=>{db.sessions.secret.cities.lagos.cash=0;throw Error('refused');}),/refused/);
 assert.equal(await f.store.read(db=>db.sessions.secret.cities.lagos.cash),4980);
});
test('SQLite: uncertain durability never acknowledges or continues serving cached state',async t=>{
 const f=fixture(t);let acknowledged=false;f.barrierFail();
 await assert.rejects(f.store.transact(db=>{db.sessions.secret=session();},{committed(){acknowledged=true;}}),/barrier failed/);
 assert.equal(acknowledged,false);await assert.rejects(f.store.read(db=>db.sessions.secret),/storage_unavailable/);
 const restarted=createSqliteStore(f.storage);assert.equal(await restarted.read(db=>db.sessions.secret.publicId),'public');
});
test('SQLite: legacy inline receipts migrate without erasing dedupe metadata',async t=>{
 const f=fixture(t),s=session();s.actions.old={actionAt:Date.now(),ok:true,code:'saved',fingerprint:'original'};
 f.storage.sql.exec('INSERT INTO sessions VALUES(?,?,?,?)',s.secret,s.publicId,s.expiresAt,JSON.stringify(s));
 await f.store.transact(db=>assert.equal(db.sessions.secret.actions.old.fingerprint,'original'));
 assert.deepEqual(await f.store.read(db=>Object.keys(db.sessions.secret.actions)),['old']);
 assert.ok(!f.db.prepare('SELECT value FROM sessions').get().value.includes('actions'));
});
test('SQLite: commit hooks retain private symbol metadata and fire once after durability',async t=>{
 const f=fixture(t),symbol=Symbol('private effects');let effects=0;
 const result=await f.store.transact(db=>{db.social={saved:true};const r={ok:true};Object.defineProperty(r,symbol,{value:['effect']});return r;},{committed(r){effects+=r[symbol].length;}});
 assert.equal(effects,1);assert.equal(result[symbol][0],'effect');assert.equal(JSON.stringify(result),'{"ok":true}');
});
