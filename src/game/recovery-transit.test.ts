import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
import test from 'node:test';import assert from 'node:assert/strict';
import {createLife,dispatch} from '../life.ts';
import type {ActiveAction} from '../types/life.ts';
test('commuting through a club cannot buy a radio shoutout from the old location',()=>{
 const state=createLife(null,{now:100000,cityId:'lagos'});state.location='library';
 const original=state.cash;state.activeAction={id:'commute-control',kind:'commute',duration:5,elapsed:0} as unknown as ActiveAction; // a malformed commute (no `remaining`, an unknown venue): hostile input
 const denied=dispatch(state,{type:'civic.shoutout',payload:{}},{now:100000,cityId:'lagos',internal:true});
 assert.equal(denied.ok,false);assert.equal(denied.code,'not_in_club');assert.equal(state.cash,original);
 state.activeAction=null;
 const allowed=dispatch(state,{type:'civic.shoutout',payload:{}},{now:100000,cityId:'lagos',internal:true});
 assert.equal(allowed.ok,true);assert.equal(state.cash,original-500);
});
