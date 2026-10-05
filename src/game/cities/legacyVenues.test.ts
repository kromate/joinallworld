import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife } from '../../life.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import { fictionalCity } from './testing/fictionalCity.test-fixture.ts'

test('saved venue aliases preserve a local trip while current ids take precedence', async () => {
  const module = { ...fictionalCity, rules: { ...fictionalCity.rules, legacyVenueAliases: { 'old-square': 'test-square', 'test-square': 'home' } } }
  const registration = registerCityForTest(module)
  try {
    await loadCityContent(module.id)
    const state = createLife({ location: 'home', cash: 12345, activeAction: { kind: 'travel', id: 'old-square', duration: 5, remaining: 4 } }, { cityId: module.id, trustedSave: true })
    assert.equal(state.activeAction?.kind, 'travel')
    assert.equal(state.activeAction?.id, 'test-square')
    assert.equal(state.activeAction?.remaining, 4)
    assert.equal(state.cash, 12345)
    assert.equal(createLife({ location: 'old-square' }, { cityId: module.id }).location, 'test-square')
    assert.equal(createLife({ location: 'test-square' }, { cityId: module.id }).location, 'test-square')
    assert.deepEqual(createLife(structuredClone(state), { cityId: module.id, trustedSave: true }), state)
  } finally { registration.dispose() }
})

test('a venue alias cannot turn another timed-action kind into a local trip', async () => {
  const module = { ...fictionalCity, rules: { ...fictionalCity.rules, legacyVenueAliases: { 'old-square': 'test-square' } } }
  const registration = registerCityForTest(module)
  try {
    await loadCityContent(module.id)
    for (const kind of ['activity', 'intercity']) {
      const state = createLife({ location: 'home', cash: 12345, activeAction: { kind, id: 'old-square', duration: 5, remaining: 4 } }, { cityId: module.id, trustedSave: true })
      assert.equal(state.activeAction, null)
      assert.equal(state.cash, 12345)
    }
  } finally { registration.dispose() }
})
