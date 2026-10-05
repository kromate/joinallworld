import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import { fictionalCity, fictionalContent } from './testing/fictionalCity.test-fixture.ts'
import { TRAVEL_MODES } from '../content/travel.ts'
import { assertCityContentContract } from './cityContractTest.test.ts'
import type { CityContent } from '../../types/content.ts'

const content: CityContent = {
  ...fictionalContent,
  localModes: Object.values(TRAVEL_MODES),
  localModeZones: [
    { mode: 'keke', venueIds: ['test-square', 'polling-unit'], rentedHomeIds: [], ownedHomeUnitIds: ['test-central'] },
    { mode: 'keke', venueIds: ['state-house'], rentedHomeIds: ['test-centre-flat'], ownedHomeUnitIds: [] },
  ],
}
const module = { ...fictionalCity, loadContent: async () => content }

test('restricted modes require one shared zone and resolve the actual rented or owned home', async () => {
  const registered = registerCityForTest(module)
  try {
    await loadCityContent(module.id)
    let now = Date.UTC(2026, 0, 5, 9)
    const context = () => ({ cityId: module.id, now })
    let state = createLife({ location: 'test-square', cash: 10000 }, context())
    const modes = (destination: string) => viewLife(state, context()).travel.destinations.find(place => place.id === destination)?.modes.map(mode => mode.id) ?? []
    assert.ok(modes('polling-unit').includes('keke'))
    assert.ok(!modes('state-house').includes('keke'), 'different satellite zones cannot be bridged by keke')
    assert.ok(modes('state-house').includes('trek') && modes('state-house').includes('danfo') && modes('state-house').includes('cab'))
    const before = state.cash
    assert.equal(dispatch(state, { type: 'travel', payload: { id: 'state-house', mode: 'keke' } }, context()).code, 'travel_mode_unavailable')
    assert.equal(state.cash, before)
    assert.equal(dispatch(state, { type: 'travel', payload: { id: 'polling-unit', mode: 'keke' } }, context()).code, 'started')
    now += 1000
    advanceLife(state, 1, context())
    const saved = structuredClone(state)
    state = createLife(saved, { ...context(), trustedSave: true })
    assert.deepEqual(state.activeAction, saved.activeAction)
    assert.equal(state.cash, saved.cash)
    state.activeAction = null
    state.location = 'home'
    state.estate.living = 'rent'
    state.property.house = 'test-centre-flat'
    assert.ok(modes('state-house').includes('keke'))
    assert.ok(!modes('test-square').includes('keke'))
    state.estate.living = 'own'
    state.estate.lga = 'test-central'
    assert.ok(modes('test-square').includes('keke'))
    assert.ok(!modes('state-house').includes('keke'), 'the old rental cannot authorize the own home in another zone')
    state.estate.lga = null
    assert.ok(!modes('test-square').includes('keke'))
    state.location = 'test-square'
    const invalid = createLife({ ...state, activeAction: { kind: 'travel', id: 'state-house', mode: 'keke', duration: 8, remaining: 6, fare: 150 } }, { ...context(), trustedSave: true })
    assert.equal(invalid.activeAction, null)
  } finally { registered.dispose() }
})

test('mode zone declarations must reference actual public venues, rentals and local units', () => {
  assertCityContentContract(module, content, { profile: 'test-fixture' })
  for (const patch of [{ venueIds: ['missing'] }, { venueIds: ['home'] }, { rentedHomeIds: ['missing'] }, { ownedHomeUnitIds: ['missing'] }]) {
    const bad = { ...content, localModeZones: content.localModeZones!.map((zone, index) => index ? zone : { ...zone, ...patch }) }
    assert.throws(() => assertCityContentContract(module, bad, { profile: 'test-fixture' }), /mode zone/)
  }
})
