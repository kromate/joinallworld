import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch } from '../../../life.ts'
import { DEFAULT_LOOK } from '../../content/traits.ts'
import { cachedCityContent, cityRules, loadCityContent } from '../registry.ts'
import type { LifeContextInit, LifeState } from '../../../types/life.ts'

const CITIES = ['abeokuta', 'ota', 'ijebu-ode', 'sagamu'] as const
/** 20:00 in Lagos: the evening sets are open, and so is everything else. */
const EVENING = Date.UTC(2026, 0, 5, 19)

function fresh(cityId: string, now: number): { state: LifeState; ctx: () => LifeContextInit; advance: (seconds: number) => void } {
  let clock = now
  const state = createLife(null, { cityId, now: clock, seed: `venues-${cityId}`, isNew: true, quickStart: true })
  const ctx = (): LifeContextInit => ({ cityId: state.estate.city, now: clock, seed: `venues-${cityId}-${clock}` })
  const unit = cityRules(cityId)?.units[0]?.id
  assert.ok(unit)
  assert.equal(dispatch(state, { type: 'onboarding.quick-start', payload: { look: DEFAULT_LOOK } }, ctx()).ok, true)
  assert.equal(dispatch(state, { type: 'onboarding.traits', payload: { traits: ['clean-pikin', 'musical'] } }, ctx()).ok, true)
  assert.equal(dispatch(state, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } }, ctx()).ok, true)
  assert.equal(dispatch(state, { type: 'onboarding.lottery', payload: {} }, ctx()).ok, true)
  assert.equal(dispatch(state, { type: 'onboarding.home', payload: { lga: unit, via: 'manual' } }, ctx()).ok, true)
  state.cash = 100_000
  return { state, ctx, advance: seconds => { clock += seconds * 1000; assert.equal(advanceLife(state, seconds, ctx()).ok, true) } }
}

for (const cityId of CITIES) test(`${cityId}: every venue has an activity that can be done in the evening`, async () => {
  await loadCityContent(cityId)
  const content = cachedCityContent(cityId)
  assert.ok(content)
  const venues = content.venues.filter(venue => venue.id !== 'home')
  assert.ok(venues.length >= 15)
  for (const venue of venues) {
    const { state, ctx, advance } = fresh(cityId, EVENING)
    assert.equal(dispatch(state, { type: 'travel', payload: { id: venue.id, mode: 'trek' } }, ctx()).code, 'started', venue.id)
    advance((state.activeAction?.remaining ?? 0) + 1)
    assert.equal(state.location, venue.id)
    let done = 0
    for (const spot of Object.values(venue.definition.spots)) {
      for (const activity of spot.activities ?? []) {
        if (state.activeAction) advance(state.activeAction.remaining + 1)
        assert.equal(dispatch(state, { type: 'spot', payload: { id: spot.id } }, ctx()).ok, true)
        if (dispatch(state, { type: 'activity', payload: { id: activity.id } }, ctx()).ok) done += 1
      }
    }
    assert.ok(done >= 1, `${cityId}/${venue.id}: at least one activity runs`)
  }
})

test('a rented start home from another city is refused in every Ogun city and in Ibadan; Lagos keeps its own', async () => {
  await Promise.all(['lagos', 'ibadan', ...CITIES].map(loadCityContent))
  for (const cityId of ['ibadan', ...CITIES, 'lagos']) {
    const ctx: LifeContextInit = { cityId, now: EVENING, seed: `start-home-${cityId}` }
    const state = createLife(null, { ...ctx, isNew: true, quickStart: true })
    assert.equal(dispatch(state, { type: 'onboarding.quick-start', payload: { look: DEFAULT_LOOK } }, ctx).ok, true)
    assert.equal(dispatch(state, { type: 'onboarding.traits', payload: { traits: ['clean-pikin', 'musical'] } }, ctx).ok, true)
    assert.equal(dispatch(state, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } }, ctx).ok, true)
    assert.equal(dispatch(state, { type: 'onboarding.lottery', payload: {} }, ctx).ok, true)
    const cash = state.cash
    const answer = dispatch(state, { type: 'onboarding.home', payload: { house: 'yaba' } }, ctx)
    if (cityId === 'lagos') { assert.equal(answer.code, 'life_started'); continue }
    assert.equal(answer.code, 'invalid_house', `${cityId}: Yaba is not a home here`)
    assert.equal(state.cash, cash, `${cityId}: nothing is paid`)
    assert.equal(state.onboarding.done, false)
    const unit = cityRules(cityId)?.units[0]?.id
    assert.ok(unit)
    assert.equal(dispatch(state, { type: 'onboarding.home', payload: { lga: unit, via: 'manual' } }, ctx).code, 'life_started')
  }
})
