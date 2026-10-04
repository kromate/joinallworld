import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './test-fixture.ts';
import core from './routes/core.ts';
// A synthetic extension routes a fixed server-owned action through the documented boundary.
const extension = ctx => ({
  'POST /api/probe/shoutout': async request => {
    const body = await request.json();
    return {body: await ctx.command(request, {cityId: body.cityId, actionId: body.actionId,
      type: 'civic.shoutout', payload: body.payload}, {internal:true}), renew:true};
  },
});
test('extension command authenticates, validates identity, and durably deduplicates paid outcomes', async t => {
  const f=await fixture(t,{routes:[core,extension]});
  const a=await f.device('Command Ada'), b=await f.device('Command Bayo');
  const life=async who=>(await(await f.request('/api/life?city=lagos',null,who.cookie)).json()).state;
  await life(a);await life(b);
  // Fixture location only: ordinary starting wallets, no injected receipt/debit.
  await f.server.store.transact(db=>{for(const s of Object.values(db.sessions))s.cities.lagos.state.location='library';});
  const body={cityId:'lagos',actionId:`${f.now()}:${randomUUID()}`,payload:{}};
  const send=async (value,who=a)=>{const r=await f.request('/api/probe/shoutout',value,who?.cookie);return{status:r.status,...await r.json()};};
  assert.equal((await send(body,null)).status,401);
  assert.equal((await send({...body,actionId:undefined})).status,400);
  assert.equal((await life(a)).cash,5000);
  const first=await send(body);assert.equal(first.ok,true);assert.equal(first.state.cash,4500);
  await f.flush();
  const second=await send(body);assert.equal(second.duplicate,true);assert.equal(second.state.cash,4500);
  assert.equal((await send({...body,payload:{changed:true}})).status,409);
  const publicAttempt=await f.request('/api/action',{...body,type:'civic.shoutout'},a.cookie);
  assert.equal(publicAttempt.status,409,'authority is part of receipt identity');
  assert.equal((await send(body,b)).state.cash,4500,'receipts are per authenticated session');
  assert.equal((await life(a)).cash,4500);
  f.advance(86400001);
  const expired=await send(body);
  assert.deepEqual([expired.status,expired.error],[409,'action_expired'],'expired IDs cannot be charged after receipt eviction');
  assert.equal((await life(a)).cash,4500);
});

test('extension counterparty/queue callback commits with charge and receipt or rolls all three back',async t=>{
 let rejectOnce=true;
 const module=ctx=>({'POST /api/probe/atomic':async request=>{
  const body=await request.json();
  return{body:await ctx.command(request,{cityId:body.cityId,actionId:body.actionId,type:'civic.shoutout',payload:body.payload},{internal:true,scope:'probe.queue',afterAction:({db,session})=>{
   const queue=ctx.collection(db,'commandProbe',{queue:[]}).queue;queue.push(session.publicId);
   if(rejectOnce){rejectOnce=false;throw ctx.fail(503,'synthetic_queue_failure');}
  }})};
 }});
 const f=await fixture(t,{routes:[core,module]});const a=await f.device('Atomic Ada');
 await f.request('/api/life?city=lagos',null,a.cookie);
 await f.server.store.transact(db=>{Object.values(db.sessions)[0].cities.lagos.state.location='library';});
 const body={cityId:'lagos',actionId:`${f.now()}:${randomUUID()}`,payload:{song:'Fixture'}};
 const post=()=>f.request('/api/probe/atomic',body,a.cookie);
 assert.equal((await post()).status,503);
 const snapshot=()=>f.server.store.read(db=>{const s=Object.values(db.sessions)[0];return{cash:s.cities.lagos.state.cash,receipt:!!s.actions[body.actionId],queued:db.commandProbe?.queue.length??0};});
 assert.deepEqual(await snapshot(),{cash:5000,receipt:false,queued:0});
 assert.equal((await(await post()).json()).ok,true);
 assert.deepEqual(await snapshot(),{cash:4500,receipt:true,queued:1});
 assert.equal((await(await post()).json()).duplicate,true);
 assert.deepEqual(await snapshot(),{cash:4500,receipt:true,queued:1});
});
