import test from 'node:test'
import assert from 'node:assert/strict'
import { createAtlas } from '../../map3d/geo/atlas.ts'
import { linkKey, regionInfo } from '../../map3d/geo/info.ts'
import { COUNTRIES, citiesOf, cityEntry, regionEntry } from '../../map3d/regions.ts'
import type { CityContent, CityMapPack, CityModule } from '../../types/content.ts'
import { allCityLinks, cityLinks, linksFrom, registerCityForTest } from './registry.ts'
import { FICTIONAL_CITY_ID, fictionalCity, fictionalContent, fictionalMap, fictionalNeighbourCity } from './testing/fictionalCity.test-fixture.ts'

const kadunaLink = { a: 'lagos', b: 'kaduna', mode: 'road', label: 'Live Kaduna coach', icon: 'bus', fare: 4321, seconds: 90, km: 760, beta: true } as const

const kadunaContent: CityContent = {
  ...fictionalContent,
  cityId: 'kaduna',
  venues: fictionalContent.venues.map((venue) => ({ ...venue, cityId: 'kaduna' })),
  regulars: fictionalContent.regulars.map((regular) => ({ ...regular, cityId: 'kaduna' })),
}
const kadunaMap: CityMapPack = { ...fictionalMap, cityId: 'kaduna' }
const kadunaModule: CityModule = {
  ...fictionalCity,
  id: 'kaduna',
  rules: {
    ...fictionalCity.rules,
    id: 'kaduna', name: 'Kaduna Open', state: { id: 'kaduna', name: 'Kaduna State', unit: 'local government' },
    atlas: { lon: 7.44, lat: 10.52, teaser: 'Kaduna is open from the live registry.', preview: ['Rigasa railway'] },
    links: [kadunaLink],
  },
  loadContent: async () => kadunaContent,
  loadMap: async () => kadunaMap,
}

test('atlas consumers read live city metadata and canonical links after module import', (t) => {
  assert.equal(typeof createAtlas, 'function', 'the atlas module was imported before test registration')
  const registrations = [
    registerCityForTest(fictionalCity),
    registerCityForTest(fictionalNeighbourCity),
    registerCityForTest(kadunaModule, { replaceClosed: true }),
  ]
  t.after(() => registrations.reverse().forEach((registration) => registration.dispose()))

  assert.equal(cityEntry('kaduna')?.name, 'Kaduna Open')
  assert.equal(cityEntry('kaduna')?.status, 'playable')
  assert.equal(COUNTRIES.nigeria.cities.kaduna?.status, 'playable', 'COUNTRIES.cities is a live descriptor')
  assert.ok(citiesOf('nigeria').some((city) => city.id === FICTIONAL_CITY_ID && city.status === 'playable'))
  const kaduna = regionEntry('state', 'kaduna')
  assert.deepEqual([kaduna.city, kaduna.status], ['kaduna', 'open'])
  assert.deepEqual([regionEntry('state', 'test-state').city, regionEntry('state', 'test-state').status], [FICTIONAL_CITY_ID, 'open'])

  const canonical = allCityLinks().find((link) => link.a === 'lagos' && link.b === 'kaduna' && link.mode === 'road')
  assert.deepEqual(canonical, kadunaLink, 'the opened module overrides the legacy compatibility row')
  assert.ok(allCityLinks().some((link) => link.a === FICTIONAL_CITY_ID && link.b === fictionalNeighbourCity.id), 'new module links reach atlas drawing')
  assert.equal(cityLinks('kaduna').filter((link) => link.mode === 'road' && (link.a === 'lagos' || link.b === 'lagos')).length, 1)
  assert.deepEqual(linksFrom('kaduna').find((link) => link.to === 'lagos' && link.mode === 'road')?.fare, kadunaLink.fare, 'reverse lookup uses the same canonical link')

  const outward = regionInfo({ kind: 'state', id: 'kaduna' }, { cityId: 'kaduna', feature: { name: 'Kaduna State' }, current: 'lagos', routes: [{ to: 'kaduna', mode: 'road' }] })
  const route = outward.routes[0]
  if (!route) throw new Error('expected the live Abuja route')
  assert.deepEqual({ id: route.id, fare: route.fare, minutes: route.minutes, live: route.live }, { id: linkKey(kadunaLink), fare: 4321, minutes: 1.5, live: true })
  assert.deepEqual([outward.tag, outward.tone, outward.city?.name], ['Open', 'open', 'Kaduna Open'])

  const reverse = regionInfo({ kind: 'state', id: 'lagos' }, { feature: { name: 'Lagos' }, current: 'kaduna', routes: [{ to: 'lagos', mode: 'road' }] }).routes[0]
  assert.deepEqual([reverse?.id, reverse?.fare, reverse?.live], [linkKey(kadunaLink), 4321, true])

  const shared = fictionalCity.rules.links[0]
  if (!shared) throw new Error('fictional link fixture is missing')
  const conflict = registerCityForTest({ ...fictionalCity, id: 'test-link-conflict', rules: { ...fictionalCity.rules, id: 'test-link-conflict', links: [{ ...shared, fare: shared.fare + 1 }] } })
  assert.throws(() => allCityLinks(), /Conflicting fixtures city link/, 'authored conflicts fail instead of dropping the newer data')
  conflict.dispose()
})
