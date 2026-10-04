import test from 'node:test';
import assert from 'node:assert/strict';
import {registerSystem} from '../src/game/registry.ts';
import {createLife} from '../src/life.ts';
import {applyLifeAction} from './life-service.ts';
import type {SystemDefinition,ActionHandler} from '../src/types/registry.ts';
import type {ActionType} from '../src/types/actions.ts';
import type {SystemId} from '../src/types/life.ts';
// A test-only system and action type, outside the shipped SystemId and ActionType unions: the tables are built
// as plain string-keyed records and the definition is handed over under the registry's own type.
const probeActions:Record<string,ActionHandler>={'randomness-probe':(state,payload,ctx)=>({ok:true,code:'rolled',roll:ctx.rng(),state})};
const probe:SystemDefinition<string>={id:'randomness-probe',stateKeys:[],sanitize(){},actions:probeActions};
registerSystem(probe as SystemDefinition<SystemId>);
const rollOf=(outcome:object):unknown=>'roll' in outcome?outcome.roll:undefined;
test('portable server action uses server entropy, not client-selected action IDs',()=>{
 const original=globalThis.crypto;let calls=0;
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(array:Uint32Array){array[0]=++calls===1?0x40000000:0xc0000000;return array;}}});
 try{
  const body={type:'randomness-probe' as ActionType,cityId:'lagos' as const,actionId:'chosen-by-client'};
  assert.equal(rollOf(applyLifeAction(createLife(undefined),body)),.25);
  assert.equal(rollOf(applyLifeAction(createLife(undefined),body,{now:0,cityId:'lagos',actionId:body.actionId})),.75);
  assert.equal(calls,2);
 }finally{Object.defineProperty(globalThis,'crypto',{configurable:true,value:original});}
});
