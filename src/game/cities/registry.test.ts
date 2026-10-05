import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cityContent, cityMap, isCityId, isKnownCityId, isOpenCityId, knownCityIds, linksFrom, loadCityContent, loadCityMap, playableCityIds, registerCityForTest, registeredCityIds } from './registry.ts'
import { cityContractTest } from './cityContractTest.test.ts'
import { lagosCity } from './lagos/index.ts'
import { fictionalCity, fictionalContent, fictionalLoadCounts, fictionalMap, fictionalNeighbourCity, resetFictionalLoadCounts } from './testing/fictionalCity.test-fixture.ts'

cityContractTest(lagosCity)

cityContractTest(fictionalCity, { profile: 'test-fixture' })
cityContractTest(fictionalNeighbourCity, { profile: 'test-fixture' })

test('test registration is scoped and keeps closed cities closed', async () => {
  resetFictionalLoadCounts()
  assert.equal(isKnownCityId('kaduna'), true)
  assert.equal(isCityId('kaduna'), false)
  assert.equal(isOpenCityId('kaduna'), false)
  assert.throws(() => cityContent('test-fictional'), /has not been loaded/)
  const neighbourRegistration = registerCityForTest(fictionalNeighbourCity)
  const registration = registerCityForTest(fictionalCity)
  try {
    assert.equal(isKnownCityId('test-fictional'), true)
    assert.equal(isCityId('test-fictional'), true)
    assert.equal(isOpenCityId('test-fictional'), true)
    assert.deepEqual(linksFrom('test-fictional').map((link) => [link.to, link.fare, link.seconds]), [['test-neighbour', 10, 1]])
    assert.deepEqual(linksFrom('test-neighbour').map((link) => [link.to, link.fare, link.seconds]), [['test-fictional', 10, 1]])
    assert.deepEqual(fictionalLoadCounts(), { content: 0, map: 0 })
    assert.equal(await loadCityContent('test-fictional'), fictionalContent)
    assert.equal(cityContent('test-fictional'), fictionalContent)
    assert.equal(await loadCityMap('test-fictional'), fictionalMap)
    assert.equal(cityMap('test-fictional'), fictionalMap)
  } finally {
    registration.dispose()
    neighbourRegistration.dispose()
  }
  assert.equal(isKnownCityId('test-fictional'), false)
  assert.throws(() => cityContent('test-fictional'), /has not been loaded/)
})

test('the catalogue has nine open cities and one closed preview in registry order', () => {
  assert.deepEqual(knownCityIds(), ['lagos', 'ibadan', 'abuja', 'port-harcourt', 'kaduna', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'kano'])
  assert.deepEqual(registeredCityIds(), ['lagos', 'ibadan', 'abuja', 'port-harcourt', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'kano'])
  assert.deepEqual(playableCityIds(), ['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano'])
})

test('authored Ibadan content is open and exposes its canonical road and rail links', async () => {
  const content = await loadCityContent('ibadan')
  assert.equal(content.cityId, 'ibadan')
  assert.equal(content.venues.some((venue) => venue.id === 'mapo-hall'), true)
  assert.equal(content.venues.some((venue) => venue.id === 'unilag' || venue.id === 'park'), false)
  assert.ok(content.venues.every((venue) => venue.cityId === 'ibadan'))
  assert.ok(content.regulars.every((regular) => regular.cityId === 'ibadan'))
  assert.equal(isOpenCityId('ibadan'), true)
  assert.deepEqual(linksFrom('lagos').filter((link) => link.to === 'ibadan').map((link) => [link.mode, link.fare, link.seconds]), [['road', 3500, 30], ['rail', 9000, 21]])
  assert.deepEqual(linksFrom('ibadan').filter((link) => link.to === 'lagos').map((link) => [link.mode, link.fare, link.seconds]), [['road', 3500, 30], ['rail', 9000, 21]])
})
