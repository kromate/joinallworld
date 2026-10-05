import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cityContent, cityMap, isCityId, isKnownCityId, isOpenCityId, linksFrom, loadCityContent, loadCityMap, registerCityForTest } from './registry.ts'
import { cityContractTest } from './cityContractTest.test.ts'
import { lagosCity } from './lagos/index.ts'
import { fictionalCity, fictionalContent, fictionalLoadCounts, fictionalMap, fictionalNeighbourCity, resetFictionalLoadCounts } from './testing/fictionalCity.test-fixture.ts'

cityContractTest(lagosCity)

cityContractTest(fictionalCity, { profile: 'test-fixture' })
cityContractTest(fictionalNeighbourCity, { profile: 'test-fixture' })

test('test registration is scoped and keeps closed cities closed', async () => {
  resetFictionalLoadCounts()
  assert.equal(isKnownCityId('ibadan'), true)
  assert.equal(isCityId('ibadan'), true)
  assert.equal(isOpenCityId('ibadan'), false)
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

test('legacy Ibadan content loads for stored lives without opening the city', async () => {
  const content = await loadCityContent('ibadan')
  assert.equal(content.cityId, 'ibadan')
  assert.equal(content.venues.some((venue) => venue.id === 'unilag'), false)
  assert.ok(content.venues.every((venue) => venue.cityId === 'ibadan'))
  assert.ok(content.regulars.every((regular) => regular.cityId === 'ibadan'))
  assert.equal(isOpenCityId('ibadan'), false)
})
