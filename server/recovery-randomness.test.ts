import test from 'node:test';
import assert from 'node:assert/strict';
import {registerSystem} from '../src/game/registry.ts';
import {createLife} from '../src/life.ts';
import {applyLifeAction} from './life-service.ts';
registerSystem({id:'randomness-probe',stateKeys:[],sanitize(){},actions:{'randomness-probe':(state,payload,ctx)=>({ok:true,code:'rolled',roll:ctx.rng(),state})}});
test('portable server action uses server entropy, not client-selected action IDs',()=>{
 const original=globalThis.crypto;let calls=0;
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(array){array[0]=++calls===1?0x40000000:0xc0000000;return array;}}});
 try{
  const body={type:'randomness-probe',cityId:'lagos',actionId:'chosen-by-client'};
  assert.equal(applyLifeAction(createLife(),body).roll,.25);
  assert.equal(applyLifeAction(createLife(),body,{now:0,cityId:'lagos',actionId:body.actionId}).roll,.75);
  assert.equal(calls,2);
 }finally{Object.defineProperty(globalThis,'crypto',{configurable:true,value:original});}
});
