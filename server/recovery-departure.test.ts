import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {rename,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import { fixture } from './test-fixture.ts';
import type { PresenceFrame, ServerFrame } from '../src/types/protocol.ts';
import type { LifeState } from '../src/types/life.ts';
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null;
const isFrame=(value:unknown):value is ServerFrame=>isRecord(value)&&typeof value.type==='string';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function wait<T>(check:()=>T|undefined|false):Promise<T>{for(let i=0;i<200;i++){const v=check();if(v)return v;await sleep(5);}throw Error('bounded message wait expired');}
// The two frames this test sends are not all in ClientFrame (signal data carries a free-form probe), so sends take a plain object.
async function socket(f:{base:string},d:{cookie:string}){const ws=new WebSocket(f.base.replace('http','ws')+'/socket',{headers:{Cookie:d.cookie,Origin:f.base}});const messages:ServerFrame[]=[];ws.on('message',b=>{const frame:unknown=JSON.parse(b.toString());if(isFrame(frame))messages.push(frame);});await once(ws,'open');return {ws,messages,send:(m:object)=>ws.send(JSON.stringify(m))};}
const presenceOf=(frame:ServerFrame):PresenceFrame=>{if(frame.type!=='presence')throw Error('presence expected');return frame;};
const isProbe=(m:ServerFrame,label:string)=>{if(m.type!=='signal')return false;const data:unknown=m.data;return isRecord(data)&&data.probe===label;};
interface Outcome{error?:unknown;duplicate?:boolean;state:LifeState}
const outcomeOf=async(r:Response):Promise<Outcome>=>{const body:unknown=await r.json();if(!isRecord(body))throw Error('JSON object expected');return{...body,state:body.state as LifeState};};
const lifeOf=async(r:Response):Promise<LifeState>=>(await outcomeOf(r)).state;
// Adapted to this branch in two places, both marked: there is ONE store (the legacy mode was removed, so the
// loop has one entry), and a write that could not be made is answered 503 storage_unavailable, not 500.
for (const storeMode of ['grouped']) test(`${storeMode}: failed durable departure preserves room; retry commits once and revokes`,async t=>{
 const f=await fixture(t,{heartbeatMs:60000});
 assert.equal(f.server.store.stats?.().mode,storeMode);
 const A=await f.device('ProbeA'),B=await f.device('ProbeB');
 const a=await socket(f,A),b=await socket(f,B);
 const disk=join(f.dir,'devices.json'),backup=join(f.dir,'devices.pre-failure.json');let sabotaged=false;
 async function restore(){if(sabotaged){await rm(disk,{recursive:true,force:true});await rename(backup,disk);sabotaged=false;}}
 try{
  for(const p of[a,b]){p.send({type:'join',cityId:'lagos',venueId:'park'});await wait(()=>p.messages.find(m=>m.type==='presence'));}
  a.send({type:'voice-state',enabled:true,muted:false});
  await wait(()=>b.messages.find(m=>m.type==='presence'&&m.members.some(x=>x.id===A.id&&x.enabled)));
  async function signal(label:string){a.messages.length=0;b.messages.length=0;a.send({type:'signal',to:B.id,data:{probe:label}});await wait(()=>b.messages.find(m=>isProbe(m,label))||a.messages.find(m=>m.type==='error'));return {delivered:b.messages.some(m=>isProbe(m,label)),errors:a.messages.flatMap(m=>m.type==='error'?[m.code]:[])};}
  const control=await signal('pre-failure');assert.equal(control.delivered,true);
  const beforeLife=await lifeOf(await f.request('/api/life?city=lagos',null,A.cookie));
  await f.flush();await rename(disk,backup);await mkdir(disk);sabotaged=true;
  const action={actionId:`${f.now()}:${randomUUID()}`,cityId:'lagos',type:'travel',id:'library',mode:'trek'};
  a.messages.length=0;b.messages.length=0;
  const failedResponse=await f.request('/api/action',action,A.cookie);const failedBody=await outcomeOf(failedResponse);
  const failureRevoked=a.messages.some(m=>m.type==='error'&&m.code==='venue_mismatch');
  b.send({type:'voice-state',enabled:false,muted:true});
  const fresh=presenceOf(await wait(()=>b.messages.find(m=>m.type==='presence')));
  const failedMembership={venueMismatch:failureRevoked,memberPresent:fresh.members.some(m=>m.id===A.id),memberEnabled:fresh.members.find(m=>m.id===A.id)?.enabled??false};
  const duringFailure=await signal('after-failed-write');
  await restore();
  const recoveredLife=await lifeOf(await f.request('/api/life?city=lagos',null,A.cookie));
  assert.equal(recoveredLife.cash,beforeLife.cash);
  assert.equal(recoveredLife.location,beforeLife.location);
  assert.equal(recoveredLife.activeAction,null,'rejected travel must not settle or persist after recovery');
  a.messages.length=0;b.messages.length=0;
  const retryResponse=await f.request('/api/action',action,A.cookie);const retry=await outcomeOf(retryResponse);
  await wait(()=>a.messages.find(m=>m.type==='error'&&m.code==='venue_mismatch'));
  b.send({type:'voice-state',enabled:false,muted:true});
  const retryRoster=presenceOf(await wait(()=>b.messages.find(m=>m.type==='presence'&&!m.members.some(x=>x.id===A.id))));
  const afterRetry=await signal('after-same-ID-retry');
  assert.equal(failedResponse.status,503);assert.equal(failedBody.error,'storage_unavailable');
  assert.equal(retryResponse.status,200);assert.equal(retry.duplicate === true,false);
  assert.equal(retry.state.activeAction?.kind,'travel');
  assert.equal(afterRetry.delivered,false);assert.deepEqual(afterRetry.errors,['join_required']);
  assert.deepEqual(failedMembership,{venueMismatch:false,memberPresent:true,memberEnabled:true});
  assert.equal(duringFailure.delivered,true);
  assert.deepEqual(duringFailure.errors,[]);
  assert.equal(retryRoster.members.some(x=>x.id===A.id),false);
 }finally{await restore();a.ws.terminate();b.ws.terminate();}
});
