import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {rename,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import { fixture } from './test-fixture.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(check){for(let i=0;i<200;i++){const v=check();if(v)return v;await sleep(5);}throw Error('bounded message wait expired');}
async function socket(f,d){const ws=new WebSocket(f.base.replace('http','ws')+'/socket',{headers:{Cookie:d.cookie,Origin:f.base}});const messages=[];ws.on('message',b=>messages.push(JSON.parse(b)));await once(ws,'open');return {ws,messages,send:m=>ws.send(JSON.stringify(m))};}
for (const storeMode of ['grouped', 'legacy']) test(`${storeMode}: failed durable departure preserves room; retry commits once and revokes`,async t=>{
 const f=await fixture(t,{heartbeatMs:60000,storeMode});
 assert.equal(f.server.store.stats().mode,storeMode);
 const A=await f.device('ProbeA'),B=await f.device('ProbeB');
 const a=await socket(f,A),b=await socket(f,B);
 const disk=join(f.dir,'devices.json'),backup=join(f.dir,'devices.pre-failure.json');let sabotaged=false;
 async function restore(){if(sabotaged){await rm(disk,{recursive:true,force:true});await rename(backup,disk);sabotaged=false;}}
 try{
  for(const p of[a,b]){p.send({type:'join',cityId:'lagos',venueId:'park'});await wait(()=>p.messages.find(m=>m.type==='presence'));}
  a.send({type:'voice-state',enabled:true,muted:false});
  await wait(()=>b.messages.find(m=>m.type==='presence'&&m.members.some(x=>x.id===A.id&&x.enabled)));
  async function signal(label){a.messages.length=0;b.messages.length=0;a.send({type:'signal',to:B.id,data:{probe:label}});await wait(()=>b.messages.find(m=>m.type==='signal'&&m.data?.probe===label)||a.messages.find(m=>m.type==='error'));return {delivered:b.messages.some(m=>m.type==='signal'&&m.data?.probe===label),errors:a.messages.filter(m=>m.type==='error').map(m=>m.code)};}
  const control=await signal('pre-failure');assert.equal(control.delivered,true);
  const beforeLife=(await (await f.request('/api/life?city=lagos',null,A.cookie)).json()).state;
  await f.flush();await rename(disk,backup);await mkdir(disk);sabotaged=true;
  const action={actionId:`${f.now()}:${randomUUID()}`,cityId:'lagos',type:'travel',id:'library',mode:'trek'};
  a.messages.length=0;b.messages.length=0;
  const failedResponse=await f.request('/api/action',action,A.cookie);const failedBody=await failedResponse.json();
  const failureRevoked=a.messages.some(m=>m.type==='error'&&m.code==='venue_mismatch');
  b.send({type:'voice-state',enabled:false,muted:true});
  const fresh=await wait(()=>b.messages.find(m=>m.type==='presence'));
  const failedMembership={venueMismatch:failureRevoked,memberPresent:fresh.members.some(m=>m.id===A.id),memberEnabled:fresh.members.find(m=>m.id===A.id)?.enabled??false};
  const duringFailure=await signal('after-failed-write');
  await restore();
  const recoveredLife=(await (await f.request('/api/life?city=lagos',null,A.cookie)).json()).state;
  assert.equal(recoveredLife.cash,beforeLife.cash);
  assert.equal(recoveredLife.location,beforeLife.location);
  assert.equal(recoveredLife.activeAction,null,'rejected travel must not settle or persist after recovery');
  a.messages.length=0;b.messages.length=0;
  const retryResponse=await f.request('/api/action',action,A.cookie);const retry=await retryResponse.json();
  await wait(()=>a.messages.find(m=>m.type==='error'&&m.code==='venue_mismatch'));
  b.send({type:'voice-state',enabled:false,muted:true});
  const retryRoster=await wait(()=>b.messages.find(m=>m.type==='presence'&&!m.members.some(x=>x.id===A.id)));
  const afterRetry=await signal('after-same-ID-retry');
  assert.equal(failedResponse.status,500);
  assert.equal(retryResponse.status,200);assert.equal(retry.duplicate === true,false);
  assert.equal(retry.state.activeAction.kind,'travel');
  assert.equal(afterRetry.delivered,false);assert.deepEqual(afterRetry.errors,['join_required']);
  assert.deepEqual(failedMembership,{venueMismatch:false,memberPresent:true,memberEnabled:true});
  assert.equal(duringFailure.delivered,true);
  assert.deepEqual(duringFailure.errors,[]);
  assert.equal(retryRoster.members.some(x=>x.id===A.id),false);
 }finally{await restore();a.ws.terminate();b.ws.terminate();}
});
