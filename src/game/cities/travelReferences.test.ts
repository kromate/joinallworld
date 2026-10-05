import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { cachedCityContent, loadCityContent, registerCityForTest } from './registry.ts'
import { cityReference } from './references.ts'
import { fictionalCity, fictionalNeighbourCity } from './testing/fictionalCity.test-fixture.ts'
import type { CityModule } from '../../types/content.ts'
import type { LifeState } from '../../types/life.ts'

async function withCooldown(module: CityModule): Promise<CityModule> {
  const original = await module.loadContent()
  const content = { ...original, venues: original.venues.map(venue => venue.id === 'test-square' ? {
    ...venue, definition: { ...venue.definition, spots: { ...venue.definition.spots, gig: {
      id: 'gig', label: 'Gig desk', activities: [{ id: 'shared-gig', label: 'Local gig', duration: 1, reward: 10, cooldown: 300, effects: {}, tags: ['gig'], beta: true }],
    } } },
  } : venue) }
  return { ...module, loadContent: async () => content }
}

test('same local activity and venue ids keep separate histories through a cold-origin reload', async () => {
  const modules = await Promise.all([withCooldown(fictionalCity), withCooldown(fictionalNeighbourCity)])
  const [a, b] = modules
  assert.ok(a && b)
  let registrations = modules.map(module => registerCityForTest(module))
  let now = Date.UTC(2026, 0, 5, 9)
  const context = (state: LifeState) => ({ cityId: state.estate.city, now, seed: `travel-references-${now}` })
  const finish = (state: LifeState): void => {
    const remaining = state.activeAction?.remaining
    assert.equal(typeof remaining, 'number')
    if (typeof remaining !== 'number') throw new Error('Missing timed action')
    now += (remaining + 1) * 1000
    assert.equal(advanceLife(state, remaining + 1, context(state)).ok, true)
  }
  const walk = (state: LifeState, id: string): void => {
    assert.equal(dispatch(state, { type: 'travel', payload: { id, mode: 'trek' } }, context(state)).code, 'started')
    finish(state)
  }
  const gig = (state: LifeState): void => {
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'gig' } }, context(state)).ok, true)
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'shared-gig' } }, context(state)).code, 'started')
    finish(state)
  }
  try {
    await Promise.all([loadCityContent(a.id), loadCityContent(b.id)])
    let state = createLife({ location: 'home', cash: 10000 }, { cityId: a.id, now })
    walk(state, 'test-square')
    gig(state)
    const originExpiry = state.travel.cooldowns[cityReference(a.id, 'shared-gig')]
    assert.ok(originExpiry)
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: b.id, mode: 'road' } }, context(state)).code, 'departed')
    finish(state)
    assert.equal(state.travel.lastTrip, null)
    gig(state)
    assert.equal(state.travel.gigs.count, 2, 'the earning cap remains global')
    const bUnit = b.rules.units[0]
    assert.ok(bUnit)
    assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: bUnit.id } }, context(state)).code, 'lga_set')
    walk(state, 'home')
    walk(state, 'test-square')
    assert.ok(state.travel.visited.includes(cityReference(a.id, 'test-square')))
    assert.ok(state.travel.visited.includes(cityReference(b.id, 'test-square')))
    const saved = structuredClone(state)

    for (const registration of registrations.reverse()) registration.dispose()
    registrations = modules.map(module => registerCityForTest(module))
    await loadCityContent(b.id)
    assert.equal(cachedCityContent(a.id), null)
    assert.equal(cachedCityContent('lagos'), null)
    state = createLife(saved, { ...context(saved), trustedSave: true })
    assert.deepEqual(state.travel, saved.travel)
    assert.equal(state.travel.cooldowns[cityReference(a.id, 'shared-gig')], originExpiry)
    assert.deepEqual(state.travel.gigs, saved.travel.gigs)
    assert.ok(viewLife(state, context(state)).travel.cooldowns['shared-gig']! > 0)
    assert.equal(cachedCityContent(a.id), null, 'reading local cooldowns never loads the origin')

    await loadCityContent(a.id)
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: a.id, mode: 'road' } }, context(state)).code, 'departed')
    finish(state)
    walk(state, 'test-square')
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'gig' } }, context(state)).ok, true)
    const cash = state.cash
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'shared-gig' } }, context(state)).code, 'cooldown')
    assert.equal(state.cash, cash)
    assert.equal(state.travel.gigs.count, 2)
  } finally { for (const registration of registrations.reverse()) registration.dispose() }
})
