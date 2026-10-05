import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLife, dispatch, viewLife } from '../../life.ts'
import { makeContext } from '../util.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import { FICTIONAL_CITY_ID, fictionalCity } from './testing/fictionalCity.test-fixture.ts'

test('shared contexts require a registered city while new-game convenience chooses the declared default', () => {
  assert.throws(() => Reflect.apply(makeContext, null, [{ now: 0 }]), /registered city context/)
  assert.throws(() => makeContext({ now: 0, cityId: 'not-a-city' }), /Unknown city context/)
  assert.throws(() => makeContext({ now: 0, cityId: 'abuja' }), /Unknown city context/, 'reserved atlas cities are not life contexts')
  assert.equal(createLife(null).estate.city, 'lagos')
  assert.equal(createLife({ estate: { city: 'abuja' } }).estate.city, 'lagos', 'a reserved atlas id is not adopted from a save')
})

test('an established life uses its saved city instead of a stale storage-key context', async () => {
  const registration = registerCityForTest(fictionalCity)
  try {
    await loadCityContent(FICTIONAL_CITY_ID)
    const state = createLife(null, { cityId: FICTIONAL_CITY_ID, now: 0, isNew: true })
    const stale = makeContext({ now: 0, cityId: 'lagos', seed: 'stale-storage-key' })
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'centre' } }, stale).code, 'selected')
    assert.equal(state.spot, 'centre')
    const destinations = viewLife(state, stale).travel.destinations.map((destination) => destination.id)
    assert.ok(destinations.includes('test-square'))
    assert.equal(destinations.includes('park'), false)

    state.estate.city = 'not-a-city'
    assert.throws(() => viewLife(state, stale), /registered city/)
  } finally {
    registration.dispose()
  }
})
