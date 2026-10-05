import test from 'node:test'
import assert from 'node:assert/strict'
import { createLife } from '../life.ts'
import { HOUSES } from './content/housing.ts'
import { billingWeek } from './systems/economy.ts'
import economySystem from './systems/economy.ts'
import { gridOf } from './systems/home.ts'
import propertySystem from './systems/property.ts'
import { makeContext } from './util.ts'
import { defaultHouseFor, houseFor, houseSpotFor, housesFor } from './cities/housingRuntime.ts'
import { loadCityContent, registerCityForTest } from './cities/registry.ts'
import { FICTIONAL_CITY_ID, fictionalCity } from './cities/testing/fictionalCity.test-fixture.ts'

const WEEK_SECONDS = 7 * 86_400

test('Lagos housing runtime preserves the original catalogue exactly', async () => {
  await loadCityContent('lagos')
  assert.deepEqual(housesFor('lagos'), Object.values(HOUSES))
  assert.equal(defaultHouseFor('lagos'), HOUSES.yaba)
  for (const house of Object.values(HOUSES)) assert.equal(houseFor('lagos', house.id), house)
})

test('a city module owns property choices, the home grid, map spot and weekly rent', async (t) => {
  const registration = registerCityForTest(fictionalCity)
  t.after(registration.dispose)
  await loadCityContent(FICTIONAL_CITY_ID)

  const house = defaultHouseFor(FICTIONAL_CITY_ID)
  assert.deepEqual({ id: house.id, label: house.label, grid: house.grid, rent: house.rent, moveIn: house.moveIn },
    { id: 'test-centre-flat', label: 'Test flat', grid: 6, rent: 10, moveIn: 30 })
  assert.deepEqual(houseSpotFor(FICTIONAL_CITY_ID, house.id), { district: 'Test Centre', zone: 'mainland', map: { x: 25, y: 50 } })
  assert.equal(houseFor(FICTIONAL_CITY_ID, 'yaba'), null, 'a Lagos house id does not leak into another city')

  const state = createLife({ cash: 100 }, { now: 0, cityId: 'lagos' })
  state.estate.city = FICTIONAL_CITY_ID
  const ctx = makeContext({ now: 0, cityId: FICTIONAL_CITY_ID, seed: 'housing-runtime' })
  propertySystem.sanitize({ property: { house: house.id } }, state, ctx)
  assert.equal(state.property.house, house.id)
  assert.equal(gridOf(state), 6)
  assert.deepEqual(propertySystem.view(state, ctx).houses.map((entry) => entry.id), [house.id])

  const movedHome = propertySystem.on['house.moved']
  const movedRent = economySystem.on['house.moved']
  if (!movedHome || !movedRent) throw new Error('house.moved listeners are not registered')
  state.property.house = 'yaba'
  movedHome(state, { id: house.id, from: 'away', cost: 0, house: house.id }, makeContext({ now: 0, cityId: 'lagos', seed: 'stale-storage-key' }))
  movedRent(state, { id: house.id, from: 'away', cost: 0, house: house.id }, makeContext({ now: 0, cityId: 'lagos', seed: 'stale-storage-key' }))
  assert.equal(state.property.house, house.id, 'arrival uses the character city after estate changed it')
  assert.equal(state.economy.rent.house, house.id)

  state.estate.living = 'own'
  const moveHouse = propertySystem.actions['property.house-move']
  if (!moveHouse) throw new Error('property.house-move is not registered')
  const moved = moveHouse(state, { id: house.id }, ctx)
  assert.equal(moved.ok, true)
  assert.equal(state.cash, 70)
  assert.equal(state.economy.rent.house, house.id)

  const renter = createLife({ cash: 100 }, { now: 0, cityId: 'lagos' })
  renter.estate.city = FICTIONAL_CITY_ID
  economySystem.sanitize({ economy: { billedWeek: billingWeek(0), started: true, rent: { house: house.id, arrears: 0, missed: 0 } } }, renter, ctx)
  economySystem.advance(renter, WEEK_SECONDS, makeContext({ now: WEEK_SECONDS * 1000, cityId: FICTIONAL_CITY_ID, seed: 'rent' }))
  assert.equal(renter.cash, 90)
  assert.equal(renter.ledger.filter((line) => line.reason.startsWith('Rent: Test flat')).length, 1)
})
