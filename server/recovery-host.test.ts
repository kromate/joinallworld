import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './test-fixture.ts';
import core from './routes/core.ts';
const extension=()=>({
 'GET /api/probe/after':()=>({body:{ok:true},after(){throw Error('synthetic_after_failure');}}),
 'GET /api/probe/async-after':()=>({body:{ok:true},after:async()=>{throw Error('synthetic_async_after_failure');}}),
 'GET /api/probe/circular':()=>{const v={};v.self=v;return{body:v};},
});
test('bad extension response and sync/async after hooks cannot stop the server',async t=>{
 const f=await fixture(t,{routes:[core,extension]});
 for(const path of['after','async-after','circular']){
  const response=await f.request(`/api/probe/${path}`);
  assert.equal(response.status,path==='circular'?500:200);
  assert.deepEqual((await response.json()).error,path==='circular'?'internal_error':undefined);
  await new Promise(r=>setTimeout(r,5));
  assert.equal((await f.request('/api/health')).status,200);
 }
});
test('core routes work without room module; voice config remains denied',async t=>{
 const f=await fixture(t,{wsModules:[()=>({})]});const d=await f.device('CustomModules');
 assert.equal((await f.request('/api/life?city=lagos',null,d.cookie)).status,200);
 assert.equal((await f.request('/api/voice-config',null,d.cookie)).status,403);
});
