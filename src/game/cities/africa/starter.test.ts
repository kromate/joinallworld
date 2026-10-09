import assert from 'node:assert/strict'
import test from 'node:test'
import type { CityMapPack } from '../../../types/content.ts'
import type { CityPack } from '../../../map3d/types.ts'
import { assertCityContentContract } from '../cityContractTest.test.ts'
import { city as accra } from '../accra/index.ts'
import { city as algiers } from '../algiers/index.ts'
import { city as lome } from '../lome/index.ts'
import { city as nairobi } from '../nairobi/index.ts'
import { city as yaounde } from '../yaounde/index.ts'
import { buildDestinationContent } from './contentBuilder.ts'
import { createDestinationModule } from './module.ts'
import { buildDestinationRules } from './rules.ts'
import { validateDestinationFacts } from './types.ts'
import type { DestinationFacts } from './types.ts'
import { withBoardGames } from '../../../tables/derive.ts'

const facts: DestinationFacts = {
  id: 'accra-starter',
  name: 'Accra',
  country: { idISOlower: 'gh', name: 'Ghana' },
  state: { idunique: 'greater-accra-starter', name: 'Greater Accra' },
  timezone: 'Africa/Accra',
  centre: { lon: -0.2, lat: 5.7 },
  airport: { id: 'osm-way-11', name: 'Kotoka International Airport', lon: -0.17, lat: 5.61, sourceUrl: 'https://www.openstreetmap.org/way/11' },
  sourceLabel: 'Reviewed OSM airport point',
  sourceUrl: 'https://www.openstreetmap.org/',
  licence: 'ODbL-1.0',
  bounds: [-0.25, 5.55, -0.1, 5.8],
  coverageNote: 'A bounded starter play area; the zone is not an administrative boundary.',
}

const scene: CityPack = {
  id: facts.id, name: facts.name,
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5, fit: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, sea: { x0: 0, x1: 0, z0: 5, z1: 6 } },
  land: [], roads: [], sites: {}, homes: {}, soon: {}, districts: [], zones: [], fabric: [], estates: {}, lgas: [],
  geo: { box: [5.55, -0.25, 5.8, -0.1] }, decorate: () => {},
}

const map: CityMapPack<string, 'centre'> = {
  cityId: facts.id, origin: buildDestinationRules(facts).mapOrigin, projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
  localUnitIds: ['centre'], stateFeatureId: facts.state.idunique,
  loadScene: async () => scene,
  loadGeometry: async () => ({ localUnits: { centre: [] }, playArea: [], state: [], water: [], gridDegrees: 0.001, sharedArcCount: 0, source: facts.sourceUrl, licence: facts.licence }),
}

test('destination factory builds foreign-timed starter rules and playable sourced-arrival content', async () => {
  const rules = buildDestinationRules(facts)
  assert.equal(rules.timezone, 'Africa/Accra')
  assert.equal(rules.country.id, 'gh')
  assert.equal(rules.units[0]?.id, 'centre')
  assert.equal(rules.districts[0]?.id, 'centre-home')
  assert.match(rules.atlas.teaser, /not an administrative boundary/u)

  const content = buildDestinationContent(facts)
  const airport = content.venues.find(venue => venue.id === 'accra-starter-airport-osm-way-11')
  assert.equal(airport?.position.kind, 'lon-lat')
  if (airport?.position.kind === 'lon-lat') assert.deepEqual([airport.position.lon, airport.position.lat], [facts.airport.lon, facts.airport.lat])
  assert.match(airport?.definition.note ?? '', /ODbL-1.0/u)
  assert.ok(content.housing.some(home => home.definition.id === 'accra-starter-centre-home'))
  assert.deepEqual(content.workplaces.map(workplace => workplace.careerId).sort(), ['community-helper', 'tech'])
  assert.ok(content.unavailableCareerIds.length > 0)
  const meal = content.venues.flatMap(venue => Object.values(venue.definition.spots)).flatMap(place => place.activities).find(item => item.id === 'accra-starter-visitor-meal')
  assert.equal(meal?.effects?.hunger, 30)
  assert.equal(meal?.cost, 0)
  const homeMeal = content.venues.find(venue => venue.id === 'home')?.definition.spots.kitchen?.activities[0]
  assert.equal(homeMeal?.label, 'Make a simple meal')
  assert.ok(content.venues.filter(venue => venue.id !== 'home').every(venue => venue.id.startsWith('accra-starter-')))

  let mapLoads = 0
  const module = createDestinationModule(facts, async () => { mapLoads++; return map })
  assert.equal(mapLoads, 0)
  assert.equal((await module.loadContent()).cityId, facts.id)
  assert.equal(mapLoads, 0)
  assert.equal((await module.loadMap()).cityId, facts.id)
  assert.equal(mapLoads, 1)
})

for (const module of [accra, lome, yaounde, nairobi, algiers]) test(`${module.id}: opened content contract`, async () => {
  const content = await module.loadContent()
  assertCityContentContract(module, content, { profile: 'opened' })
  const table = content.tablePlaces.find(place => place.game === 'chess')
  assert.ok(table, 'each playable starter authors a shared chess table')
  assert.equal(table.id, `${module.id}-recreation-chess`, 'the fictional table has a stable city-prefixed id')
  assert.equal(table.seats, 2)
  assert.ok(content.venues.some(venue => venue.id === table.venueId && venue.kind === 'park'), 'the table belongs to an authored public recreation venue')
  const available = withBoardGames(content.venues, content.tablePlaces)
  assert.equal(available.filter(place => place.id === table.id).length, 1, 'shared derived tables do not duplicate the authored chess table')
})


test('destination source URLs retain standard HTTPS and credential refusal semantics', () => {
  const accepted = validateDestinationFacts({ ...facts, sourceUrl: 'HTTPS://example.com/source?x=1' })
  assert.equal(accepted.sourceUrl, 'HTTPS://example.com/source?x=1', 'the parser validates without rewriting the pinned public source')
  for (const sourceUrl of ['/relative', 'http://example.com/', 'file:///source', 'https://user@example.com/', 'https://user:secret@example.com/', 'https://user%40name@example.com/']) {
    assert.throws(() => validateDestinationFacts({ ...facts, sourceUrl }), TypeError, sourceUrl)
    assert.throws(() => validateDestinationFacts({ ...facts, airport: { ...facts.airport, sourceUrl } }), TypeError, `airport: ${sourceUrl}`)
  }
})
