import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './test-fixture.ts';
import core from './routes/core.ts';
import type {CityLifeRecord, Db, RouteContext, RouteKey, RouteHandler, SessionRecord} from './types.ts';
import type {ActionRequest, TimedId} from '../src/types/protocol.ts';
import type {LifeState} from '../src/types/life.ts';
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null;
// A parsed JSON reply: only the fields these tests read, narrowed from the wire value.
interface Reply{status:number;ok?:boolean;duplicate?:boolean;error?:unknown;state?:LifeState}
const reply=async(r:Response):Promise<Reply>=>{const b:unknown=await r.json();if(!isRecord(b))throw Error('JSON object expected');return{...b,status:r.status};};
const lagosLife=(s:SessionRecord|undefined):CityLifeRecord=>{const c=s?.cities.lagos;if(!c)throw Error('no lagos life');return c;};
const firstSession=(db:Db):SessionRecord=>{const s=Object.values(db.sessions)[0];if(!s)throw Error('no session');return s;};
const queueLength=(db:Db):number=>{const probe=db.commandProbe;return isRecord(probe)&&Array.isArray(probe.queue)?probe.queue.length:0;};
const cashOf=(state:LifeState|undefined):number|undefined=>state?.cash;
// A synthetic extension routes a fixed server-owned action through the documented boundary.
// The probe forwards the untrusted body as sent so that missing fields reach the server's own validation.
const extension = (ctx: RouteContext): Record<RouteKey, RouteHandler> => ({
  'POST /api/probe/shoutout': async request => {
    const body = await request.json();
    return {body: await ctx.command(request, {cityId: body.cityId as ActionRequest['cityId'], actionId: body.actionId as TimedId,
      type: 'civic.shoutout', payload: isRecord(body.payload)?body.payload:undefined}, {internal:true}), renew:true};
  },
});
test('extension command authenticates, validates identity, and durably deduplicates paid outcomes', async t => {
  const f=await fixture(t,{routes:[core,extension]});
  const a=await f.device('Command Ada'), b=await f.device('Command Bayo');
  const life=async (who:{cookie:string}):Promise<LifeState>=>{const state=(await reply(await f.request('/api/life?city=lagos',null,who.cookie))).state;if(!state)throw Error('no state');return state;};
  await life(a);await life(b);
  // Fixture location only: ordinary starting wallets, no injected receipt/debit.
  await f.server.store.transact(db=>{for(const s of Object.values(db.sessions))lagosLife(s).state.location='library';});
  const body={cityId:'lagos',actionId:`${f.now()}:${randomUUID()}`,payload:{}};
  const send=async (value:object,who:{cookie:string}|null=a):Promise<Reply>=>reply(await f.request('/api/probe/shoutout',value,who?.cookie));
  assert.equal((await send(body,null)).status,401);
  assert.equal((await send({...body,actionId:undefined})).status,400);
  assert.equal((await life(a)).cash,5000);
  const first=await send(body);assert.equal(first.ok,true);assert.equal(cashOf(first.state),4500);
  await f.flush();
  const second=await send(body);assert.equal(second.duplicate,true);assert.equal(cashOf(second.state),4500);
  assert.equal((await send({...body,payload:{changed:true}})).status,409);
  const publicAttempt=await f.request('/api/action',{...body,type:'civic.shoutout'},a.cookie);
  assert.equal(publicAttempt.status,409,'authority is part of receipt identity');
  assert.equal(cashOf((await send(body,b)).state),4500,'receipts are per authenticated session');
  assert.equal((await life(a)).cash,4500);
  f.advance(86400001);
  const expired=await send(body);
  assert.deepEqual([expired.status,expired.error],[409,'action_expired'],'expired IDs cannot be charged after receipt eviction');
  assert.equal((await life(a)).cash,4500);
});

test('extension counterparty/queue callback commits with charge and receipt or rolls all three back',async t=>{
 let rejectOnce=true;
 const module=(ctx:RouteContext):Record<RouteKey,RouteHandler>=>({'POST /api/probe/atomic':async request=>{
  const body=await request.json();
  return{body:await ctx.command(request,{cityId:body.cityId as ActionRequest['cityId'],actionId:body.actionId as TimedId,type:'civic.shoutout',payload:isRecord(body.payload)?body.payload:undefined},{internal:true,scope:'probe.queue',afterAction:({db,session})=>{
   const queue:unknown=ctx.collection(db,'commandProbe',{queue:[]}).queue;if(!Array.isArray(queue))throw Error('queue expected');queue.push(session.publicId);
   if(rejectOnce){rejectOnce=false;throw ctx.fail(503,'synthetic_queue_failure');}
  }})};
 }});
 const f=await fixture(t,{routes:[core,module]});const a=await f.device('Atomic Ada');
 await f.request('/api/life?city=lagos',null,a.cookie);
 await f.server.store.transact(db=>{lagosLife(firstSession(db)).state.location='library';});
 const body={cityId:'lagos',actionId:`${f.now()}:${randomUUID()}`,payload:{song:'Fixture'}};
 const post=()=>f.request('/api/probe/atomic',body,a.cookie);
 assert.equal((await post()).status,503);
 const snapshot=()=>f.server.store.read(db=>{const s=firstSession(db);return{cash:lagosLife(s).state.cash,receipt:!!s.actions[body.actionId as TimedId],queued:queueLength(db)};});
 assert.deepEqual(await snapshot(),{cash:5000,receipt:false,queued:0});
 assert.equal((await reply(await post())).ok,true);
 assert.deepEqual(await snapshot(),{cash:4500,receipt:true,queued:1});
 assert.equal((await reply(await post())).duplicate,true);
 assert.deepEqual(await snapshot(),{cash:4500,receipt:true,queued:1});
});
