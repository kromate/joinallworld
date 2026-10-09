import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, dispatch, advanceLife } from '../../../life.ts'
import { loadCityContent, registerCityForTest } from '../registry.ts'
import { createDestinationModule } from './module.ts'
import { FACTS as yaounde } from '../yaounde/facts.ts'
import { FACTS as lome } from '../lome/facts.ts'
import { FACTS as accra } from '../accra/facts.ts'
import { FACTS as nairobi } from '../nairobi/facts.ts'
import { FACTS as algiers } from '../algiers/facts.ts'
import { FACTS as cotonou } from '../cotonou/facts.ts'
import { FACTS as abidjan } from '../abidjan/facts.ts'
import { FACTS as dakar } from '../dakar/facts.ts'
import { FACTS as capeTown } from '../cape-town/facts.ts'
import { FACTS as addisAbaba } from '../addis-ababa/facts.ts'

await loadCityContent('lagos')

for (const original of [yaounde, lome, accra, nairobi, algiers, cotonou, abidjan, dakar, capeTown, addisAbaba]) test(`${original.id}: normal flight, visitor activity, saved reload and original Nigeria home return`, async () => {
  // Registry admission is isolated until Integration applies the production catalogue patch.
  const facts = { ...original, id: `test-${original.id}` }
  const destination = createDestinationModule(facts, async () => { throw new Error('The server lifecycle must never load map geometry') })
  const links = destination.rules.links.filter(link => link.mode === 'air')
  assert.equal(links.length, 1)
  const link = links[0]
  assert.ok(link)
  const module = { ...destination, rules: { ...destination.rules, links } }
  const registration = registerCityForTest(module)
  try {
    const content = await loadCityContent(module.id)
    let now = Date.UTC(2026, 9, 9, 9)
    const context = () => ({ cityId: state.estate.city, now, trustedSave: true, seed: 'africa-flight' })
    let state = createLife(null, { cityId: 'lagos', now, isNew: true })
    state.onboarding.done = true
    state.cash = 2_000_000
    assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: 'ikeja' } }, context()).ok, true)
    assert.equal(dispatch(state, { type: 'estate.move-in', payload: {} }, context()).ok, true)
    const beforeHome = structuredClone({ lga: state.estate.lga, plot: state.estate.plot, style: state.estate.style, home: state.estate.home, living: state.estate.living })
    const finish = () => {
      for (let iteration = 0; state.activeAction && iteration < 300; iteration++) {
        now += 1000
        advanceLife(state, 1, context())
      }
      assert.equal(state.activeAction, null)
    }
    const beforeFare = state.cash
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: module.id, mode: 'air' } }, context()).code, 'departed')
    assert.equal(state.cash, beforeFare - link.fare)
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: module.id, mode: 'air' } }, context()).ok, false, 'a second departure cannot charge again')
    assert.equal(state.cash, beforeFare - link.fare)
    state = createLife(JSON.parse(JSON.stringify(state)), context())
    assert.equal(state.activeAction?.kind, 'intercity', 'in-flight save retains the unfinished journey')
    finish()
    assert.equal(state.estate.city, module.id)
    assert.equal(state.location, module.rules.hubs.find(hub => hub.mode === 'air')?.venueId)
    assert.equal(state.estate.lga, null, 'visiting does not invent a secondary owned home')
    assert.equal(state.estate.home, 'lagos')
    assert.ok(state.estate.away.lagos, 'original home is retained')
    state = createLife(JSON.parse(JSON.stringify(state)), context())
    assert.equal(state.estate.city, module.id)
    const meal = content.venues.find(venue => venue.id === `${facts.id}-meal-stop`)
    assert.ok(meal)
    assert.equal(dispatch(state, { type: 'travel', payload: { id: meal.id, mode: 'trek' } }, context()).code, 'started')
    finish()
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'counter' } }, context()).ok, true)
    state.needs.hunger = 10
    assert.equal(dispatch(state, { type: 'activity', payload: { id: `${facts.id}-visitor-meal` } }, context()).ok, true)
    const duringMealCash = state.cash
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'lagos', mode: 'air' } }, context()).ok, false, 'unfinished activities keep the departure fence')
    assert.equal(state.cash, duringMealCash)
    finish()
    assert.ok(state.needs.hunger > 10)
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'lagos', mode: 'air' } }, context()).code, 'departed')
    finish()
    state = createLife(JSON.parse(JSON.stringify(state)), context())
    assert.equal(state.estate.city, 'lagos')
    assert.deepEqual({ lga: state.estate.lga, plot: state.estate.plot, style: state.estate.style, home: state.estate.home, living: state.estate.living }, beforeHome)
    assert.equal(state.estate.away[module.id], undefined)
  } finally { registration.dispose() }
})
