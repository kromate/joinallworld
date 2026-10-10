import assert from 'node:assert/strict';
import { createCommunity } from '/workspace/remote-verification/repositories/coordinator-c1-third-five-sourcecheck/src/community.ts';
import { reconnectDelay } from '/workspace/remote-verification/repositories/coordinator-c1-third-five-sourcecheck/src/reconnect.ts';
const names=['fetch','navigator','WebSocket','location','setTimeout','clearTimeout'];
const originals=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
const originalRandom=Math.random, realSet=globalThis.setTimeout, realClear=globalThis.clearTimeout;
class Socket { static OPEN=1; static CONNECTING=0; static instances=[]; readyState=0; constructor(){Socket.instances.push(this)} send(){} open(){this.readyState=1;this.onopen?.()} close(){this.readyState=3;this.onclose?.()} }
try {
 for (const random of [0,0.5]) {
  const allTimers=new Map(), oldHarnessTimers=new Map(); let clears=0;
  Socket.instances=[]; Math.random=()=>random;
  for(const [name,value] of Object.entries({WebSocket:Socket,location:{protocol:'http:',host:'localhost:5173'},navigator:{},fetch:async()=>({ok:true,json:async()=>({session:{id:'synthetic-diagnostic',name:'Diagnostic'}})})})) Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  globalThis.setTimeout=(callback,delay,...args)=>{let id; id=realSet(()=>{allTimers.delete(id);oldHarnessTimers.delete(id);callback(...args)},delay);allTimers.set(id,{delay});if(delay)oldHarnessTimers.set(id,{delay});return id};
  globalThis.clearTimeout=id=>{if(allTimers.delete(id))clears++;oldHarnessTimers.delete(id);realClear(id)};
  const api=await createCommunity(); const ws=Socket.instances.at(-1); ws.open(); ws.close();
  const delay=reconnectDelay(0,1000,15000);
  assert.equal(allTimers.size,1); assert.equal(oldHarnessTimers.size,random===0?0:1);
  const sockets=Socket.instances.length; api.destroy(); assert.equal(allTimers.size,0);assert.equal(clears,1);
  await new Promise(resolve=>realSet(resolve,25)); assert.equal(Socket.instances.length,sockets);
  console.log(JSON.stringify({random,delay,originalHarnessWouldReportPending:random!==0,actualTimerScheduled:true,actualTimerCleared:true,noSocketAfterDestroy:true}));
 }
} finally { Math.random=originalRandom; for(const [n,d]of originals){if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n]} }
