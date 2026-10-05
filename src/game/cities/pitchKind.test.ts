import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, dispatch, advanceLife } from '../../life.ts'
import { findActivity } from '../systems/activities.ts'
import { setSkillLevel } from '../systems/skills.ts'
import { DREAM_TARGETS } from '../content/traits.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import { fictionalCity, fictionalContent } from './testing/fictionalCity.test-fixture.ts'
import type { CityContent } from '../../types/content.ts'

test('a local tech hub hosts the shared pitch and records the visit without a cchub id', async () => {
  const content: CityContent = { ...fictionalContent, venues: fictionalContent.venues.map(venue => venue.id === 'test-square' ? {
    ...venue, name: 'Test Innovation Hub', kind: 'hub', definition: { ...venue.definition, label: 'Test Innovation Hub', scene: { kind: 'hub' } },
  } : venue) }
  const registration = registerCityForTest({ ...fictionalCity, loadContent: async () => content })
  try {
    await loadCityContent(fictionalCity.id)
    let now = Date.UTC(2026, 9, 5, 9)
    const state = createLife({ location: 'home' }, { now, cityId: fictionalCity.id })
    assert.equal(dispatch(state, { type: 'travel', payload: { id: 'test-square', mode: 'trek' } }, { now }).code, 'started')
    const seconds = state.activeAction?.remaining
    assert.ok(seconds)
    now += seconds * 1000
    advanceLife(state, seconds, { now })
    assert.equal(state.goals.stats.cchub, true, 'the legacy saved progress field records the local hub visit')
    assert.equal(findActivity('dream-startup-pitch', fictionalCity.id)?.venue, 'test-square')
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'pitch-room' } }, { now }).code, 'selected')
    setSkillLevel(state, 'coding', DREAM_TARGETS.codingLevel)
    setSkillLevel(state, 'hustle', DREAM_TARGETS.hustleLevel)
    const before = state.cash
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'dream-startup-pitch' } }, { now }).code, 'started')
    const duration = state.activeAction?.remaining
    assert.ok(duration)
    now += duration * 1000
    advanceLife(state, duration, { now })
    assert.equal(state.cash, before + DREAM_TARGETS.funding)
    assert.equal(state.ledger.at(-1)?.reason, 'Startup funding from Test Innovation Hub')
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'dream-startup-pitch' } }, { now }).code, 'already_funded')
    assert.equal(state.cash, before + DREAM_TARGETS.funding)
  } finally { registration.dispose() }
})
