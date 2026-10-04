import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient as createClientUntyped} from '../../client.js';
import {createLife as createLifeUntyped,dispatch as dispatchUntyped} from '../../life.js';
import {makeContext as makeContextUntyped} from '../../game/util.js';
import type {ActionOutcome,LifeContext,LifeContextInit,LifeState} from '../../types/life.ts';

// client.js, life.js and game/util.js are untyped JS: name what this test passes in and reads back.
interface StubResponse {ok:boolean;json:()=>Promise<unknown>}
interface TestClient {connect:()=>Promise<boolean>;stop:()=>void;state:LifeState}
const createClient=createClientUntyped as unknown as (options:{now:()=>number;setTimeout:(fn:()=>void,ms:number)=>number;clearTimeout:()=>void;fetch:(path:string)=>Promise<StubResponse>})=>TestClient;
const createLife=createLifeUntyped as unknown as (saved:Record<string,unknown>,ctx:LifeContext)=>LifeState;
const dispatch=dispatchUntyped as unknown as (state:LifeState,body:{type:string;payload?:Record<string,unknown>},ctx:LifeContext)=>ActionOutcome;
const makeContext=makeContextUntyped as (init?:LifeContextInit)=>LifeContext;

async function hydrate(state: LifeState) {
  const scheduled: number[]=[];
  const client=createClient({now:()=>1000,setTimeout:(fn,ms)=>{scheduled.push(ms);return 1;},clearTimeout(){},fetch:async path=>({ok:true,json:async()=>path==='/api/session'?{session:{id:'qa-student',name:'QA Student'},serverTime:state.t}:{state,serverTime:state.t}})});
  assert.equal(await client.connect(),true);
  return {client,scheduled};
}

test('live client hydrates running campus shuttle with snapshot time and keeps active polling',async()=>{
 const now=Date.UTC(2026,9,4,15),ctx=makeContext({now,cityId:'lagos',seed:'client-shuttle'});
 const state=createLife({location:'unilag',spot:'senate'},ctx);
 assert.equal(dispatch(state,{type:'campus-shuttle',payload:{destination:'engineering'}},ctx).code,'started');
 const {client,scheduled}=await hydrate(state);
 assert.deepEqual(client.state.activeAction,state.activeAction);
 assert.equal(client.state.cash,4950);assert.equal(scheduled.at(-1),1000);
 client.stop();
});

test('live client preserves a current campus quiz even when its own wall clock differs',async()=>{
 const now=Date.UTC(2026,9,9,17),ctx=makeContext({now,cityId:'lagos',seed:'client-quiz'});
 const state=createLife({location:'unilag',spot:'student-union',unilagStudent:{programme:'computer',studentId:'ULG-2026-123456',status:'matriculated'}},ctx);
 assert.equal(dispatch(state,{type:'unilag.quiz.start',payload:{}},ctx).code,'quiz_started');
 const {client}=await hydrate(state);
 assert.deepEqual(client.state.unilagCommunity.quiz,state.unilagCommunity.quiz);client.stop();
});
