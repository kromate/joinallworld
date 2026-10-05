import assert from 'node:assert/strict'
import test from 'node:test'
import {advanceLife,createLife,dispatch} from '../../../life.ts'
import {loadCityContent} from '../registry.ts'
import {DEFAULT_LOOK} from '../../content/traits.ts'
import type {LifeState} from '../../../types/life.ts'

await loadCityContent('kano')

function fixture(){
  let now=Date.UTC(2026,0,5,9)
  const context=()=>({cityId:'kano',now,seed:'kano-outing'})
  let state=createLife({name:'Outing Visitor'},{...context(),isNew:true,quickStart:true})
  assert.equal(dispatch(state,{type:'onboarding.quick-start',payload:{look:DEFAULT_LOOK}},context()).code,'playing')
  assert.equal(dispatch(state,{type:'onboarding.traits',payload:{traits:['clean-pikin','musical']}},context()).code,'traits_saved')
  assert.equal(dispatch(state,{type:'onboarding.dream',payload:{dream:'afrobeats-star'}},context()).code,'dream_saved')
  assert.equal(dispatch(state,{type:'onboarding.lottery',payload:{}},context()).code,'rolled')
  assert.equal(dispatch(state,{type:'onboarding.home',payload:{lga:'nassarawa',via:'manual'}},context()).code,'life_started')
  state.location='railway-station'
  state.spot='visit'
  state.cash=10000
  for(const need of ['hunger','energy','hygiene','fun','social'] as const) state.needs[need]=50
  const advance=(seconds:number)=>{now+=seconds*1000;assert.equal(advanceLife(state,seconds,context()).ok,true)}
  const reload=()=>{const save=structuredClone(state);state=createLife(save,{...context(),trustedSave:true});assert.deepEqual(state,save)}
  return {get state(){return state},context,advance,reload}
}

const place=(state:LifeState)=>({city:state.estate.city,location:state.location,spot:state.spot,estate:structuredClone(state.estate),house:state.property.house})
const start=(f:ReturnType<typeof fixture>)=>dispatch(f.state,{type:'activity',payload:{id:'kano-tiga-outing'}},f.context())
const outingLedger=(state:LifeState)=>state.ledger.filter(line=>line.reason==='Countryside outing (simulated)')

test('Tiga outing charges once, survives reload and returns without moving the character',()=>{
  const f=fixture(),originalPlace=place(f.state)
  assert.equal(start(f).code,'started')
  assert.equal(f.state.cash,8500)
  assert.equal(f.state.activeAction?.duration,90)
  assert.deepEqual(outingLedger(f.state).map(line=>line.amount),[-1500])
  assert.equal(start(f).code,'busy')
  assert.equal(f.state.cash,8500)
  f.advance(30)
  f.reload()
  assert.equal(f.state.activeAction?.remaining,60)
  assert.equal(start(f).code,'busy')
  const withoutOuting=structuredClone(f.state)
  withoutOuting.activeAction=null
  const nextContext={...f.context(),now:f.context().now+60000}
  assert.equal(advanceLife(withoutOuting,60,nextContext).ok,true)
  f.advance(60)
  assert.equal(f.state.activeAction,null)
  assert.deepEqual(place(f.state),originalPlace)
  assert.equal(f.state.cash,8500)
  assert.deepEqual(outingLedger(f.state).map(line=>line.amount),[-1500])
  assert.equal(f.state.needs.fun,withoutOuting.needs.fun+16)
  assert.equal(f.state.needs.social,withoutOuting.needs.social+6)
  assert.equal(f.state.needs.energy,withoutOuting.needs.energy-4)
  assert.equal(f.state.needs.hunger,withoutOuting.needs.hunger-6)
  assert.equal(start(f).ok,false,'completed outing respects its cooldown')
  assert.equal(f.state.cash,8500)
})

test('Cancelling a Tiga outing keeps its departure fare and gives no completion effect',()=>{
  const f=fixture(),originalPlace=place(f.state)
  assert.equal(start(f).code,'started')
  f.advance(30)
  f.reload()
  const needs=structuredClone(f.state.needs)
  assert.equal(dispatch(f.state,{type:'cancel'},f.context()).code,'cancelled')
  assert.equal(f.state.activeAction,null)
  assert.equal(f.state.cash,8500)
  assert.deepEqual(outingLedger(f.state).map(line=>line.amount),[-1500])
  assert.deepEqual(f.state.needs,needs)
  assert.deepEqual(place(f.state),originalPlace)
  assert.equal(dispatch(f.state,{type:'cancel'},f.context()).ok,false)
  assert.equal(f.state.cash,8500)
})
