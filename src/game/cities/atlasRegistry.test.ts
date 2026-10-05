import test from 'node:test'
import assert from 'node:assert/strict'
import { createAtlas } from '../../map3d/geo/atlas.ts'
import { linkKey, regionInfo } from '../../map3d/geo/info.ts'
import { COUNTRIES, citiesOf, cityEntry, regionEntry } from '../../map3d/regions.ts'
import type { CityContent, CityMapPack, CityModule } from '../../types/content.ts'
import { allCityLinks, cityLinks, linksFrom, registerCityForTest } from './registry.ts'
import { FICTIONAL_CITY_ID, fictionalCity, fictionalContent, fictionalMap, fictionalNeighbourCity } from './testing/fictionalCity.test-fixture.ts'

const ibadanLink = { a: 'lagos', b: 'ibadan', mode: 'road', label: 'Live Ibadan coach', icon: 'bus', fare: 4321, seconds: 90, km: 130, beta: true } as const

const ibadanContent: CityContent = {
  ...fictionalContent,
  cityId: 'ibadan',
  venues: fictionalContent.venues.map((venue) => ({ ...venue, cityId: 'ibadan' })),
  regulars: fictionalContent.regulars.map((regular) => ({ ...regular, cityId: 'ibadan' })),
}
const ibadanMap: CityMapPack = { ...fictionalMap, cityId: 'ibadan' }
const ibadanModule: CityModule = {
  ...fictionalCity,
  id: 'ibadan',
  rules: {
    ...fictionalCity.rules,
    id: 'ibadan', name: 'Ibadan Open', state: { id: 'oyo', name: 'Oyo State', unit: 'local government' },
    atlas: { lon: 3.95, lat: 7.38, teaser: 'Ibadan is open from the live registry.', preview: ['Cocoa House'] },
    links: [ibadanLink],
  },
  loadContent: async () => ibadanContent,
  loadMap: async () => ibadanMap,
}

test('atlas consumers read live city metadata and canonical links after module import', (t) => {
  assert.equal(typeof createAtlas, 'function', 'the atlas module was imported before test registration')
  const registrations = [
    registerCityForTest(fictionalCity),
    registerCityForTest(fictionalNeighbourCity),
    registerCityForTest(ibadanModule, { replaceClosed: true }),
  ]
  t.after(() => registrations.reverse().forEach((registration) => registration.dispose()))

  assert.equal(cityEntry('ibadan')?.name, 'Ibadan Open')
  assert.equal(cityEntry('ibadan')?.status, 'playable')
  assert.equal(COUNTRIES.nigeria.cities.ibadan?.status, 'playable', 'COUNTRIES.cities is a live descriptor')
  assert.ok(citiesOf('nigeria').some((city) => city.id === FICTIONAL_CITY_ID && city.status === 'playable'))
  const oyo = regionEntry('state', 'oyo')
  assert.deepEqual([oyo.city, oyo.status], ['ibadan', 'open'])
  assert.deepEqual([regionEntry('state', 'test-state').city, regionEntry('state', 'test-state').status], [FICTIONAL_CITY_ID, 'open'])

  const canonical = allCityLinks().find((link) => link.a === 'lagos' && link.b === 'ibadan' && link.mode === 'road')
  assert.deepEqual(canonical, ibadanLink, 'the opened module overrides the legacy compatibility row')
  assert.ok(allCityLinks().some((link) => link.a === FICTIONAL_CITY_ID && link.b === fictionalNeighbourCity.id), 'new module links reach atlas drawing')
  assert.equal(cityLinks('ibadan').filter((link) => link.mode === 'road' && (link.a === 'lagos' || link.b === 'lagos')).length, 1)
  assert.deepEqual(linksFrom('ibadan').find((link) => link.to === 'lagos' && link.mode === 'road')?.fare, ibadanLink.fare, 'reverse lookup uses the same canonical link')

  const outward = regionInfo({ kind: 'state', id: 'oyo' }, { cityId: 'ibadan', feature: { name: 'Oyo' }, current: 'lagos', routes: [{ to: 'ibadan', mode: 'road' }] })
  const route = outward.routes[0]
  if (!route) throw new Error('expected the live Ibadan route')
  assert.deepEqual({ id: route.id, fare: route.fare, minutes: route.minutes, live: route.live }, { id: linkKey(ibadanLink), fare: 4321, minutes: 1.5, live: true })
  assert.deepEqual([outward.tag, outward.tone, outward.city?.name], ['Open', 'open', 'Ibadan Open'])

  const reverse = regionInfo({ kind: 'state', id: 'lagos' }, { feature: { name: 'Lagos' }, current: 'ibadan', routes: [{ to: 'lagos', mode: 'road' }] }).routes[0]
  assert.deepEqual([reverse?.id, reverse?.fare, reverse?.live], [linkKey(ibadanLink), 4321, true])

  const shared = fictionalCity.rules.links[0]
  if (!shared) throw new Error('fictional link fixture is missing')
  const conflict = registerCityForTest({ ...fictionalCity, id: 'test-link-conflict', rules: { ...fictionalCity.rules, id: 'test-link-conflict', links: [{ ...shared, fare: shared.fare + 1 }] } })
  assert.throws(() => allCityLinks(), /Conflicting fixtures city link/, 'authored conflicts fail instead of dropping the newer data')
  conflict.dispose()
})
