import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CityContent, CityMapGeometry, CityModule, LonLatPolygon } from '../../types/content.ts'
import { assertCityContentContract, assertCityMapContract, assertCityModuleContract, assertCityRulesContract } from './cityContractTest.test.ts'
import { lagosCity } from './lagos/index.ts'
import { LAGOS_CONTENT } from './lagos/content.ts'
import { fictionalCity, fictionalContent, fictionalMap, fictionalNeighbourCity, fictionalNeighbourMap } from './testing/fictionalCity.test-fixture.ts'

const rect = (west: number, south: number, east: number, north: number): readonly LonLatPolygon[] => [[[[west, south], [east, south], [east, north], [west, north]]]]

function moduleWithContent(base: CityModule, content: CityContent): CityModule {
  return { ...base, loadContent: async () => content }
}

function twoUnitModule(geometry: CityMapGeometry): CityModule {
  const east: { id: string; name: string; zone: 'mainland'; land: number; line: string; districts: string[] } = { id: 'test-east', name: 'Test East', zone: 'mainland', land: 1, line: 'Test only.', districts: [] }
  return {
    ...fictionalCity,
    rules: { ...fictionalCity.rules, units: [...fictionalCity.rules.units, east] },
    loadMap: async () => ({
      ...fictionalMap,
      localUnitIds: ['test-central', 'test-east'],
      loadScene: async () => {
        const scene = await fictionalMap.loadScene()
        const first = scene.lgas[0]
        if (!first) throw new Error('fixture local unit missing')
        return { ...scene, lgas: [...scene.lgas, { ...first, id: 'test-east', name: 'Test East', districts: [] }] }
      },
      loadGeometry: async () => geometry,
    }),
  }
}

const geometry = (
  localUnits: CityMapGeometry['localUnits'],
  playArea = rect(7.9, 8.9, 8.3, 9.1),
  state = playArea,
): CityMapGeometry => ({
  localUnits, playArea, state, water: [], gridDegrees: 0.0002, sharedArcCount: 1, source: 'test-only', licence: 'test-only',
})

test('city contract rejects geometry without an exact shared border', async () => {
  const broken = twoUnitModule(geometry({ 'test-central': rect(7.9, 8.9, 8.1, 9.1), 'test-east': rect(8.1001, 8.9, 8.3, 9.1) }))
  await assert.rejects(assertCityModuleContract(broken, { profile: 'test-fixture' }), /share exact border segments/)
})

test('city contract rejects overlapping local-unit polygons', async () => {
  const broken = twoUnitModule(geometry({
    'test-central': rect(7.9, 8.9, 8.1, 9.1),
    'test-east': [...rect(8.1, 8.9, 8.3, 9.1), ...rect(7.95, 8.95, 8.05, 9.05)],
  }))
  await assert.rejects(assertCityModuleContract(broken, { profile: 'test-fixture' }), /do not overlap/)
})

test('city contract rejects state ground that local units and water do not cover', async () => {
  const broken = twoUnitModule(geometry(
    { 'test-central': rect(7.9, 8.9, 8.1, 9.1), 'test-east': rect(8.1, 8.9, 8.3, 9.1) },
    rect(7.9, 8.9, 8.4, 9.1),
  ))
  await assert.rejects(assertCityModuleContract(broken, { profile: 'test-fixture' }), /cover the city play area within 1%/)
})

test('city contract rejects a local-unit polygon wholly outside the state bounding box', async () => {
  const broken: CityModule = {
    ...fictionalCity,
    loadMap: async () => ({
      ...fictionalMap,
      loadGeometry: async () => geometry({ 'test-central': rect(9, 10, 9.2, 10.2) }, rect(7.9, 8.9, 8.1, 9.1)),
    }),
  }
  await assert.rejects(assertCityModuleContract(broken, { profile: 'test-fixture' }), /land stays inside the city play area/)
})

test('city contract rejects a city footprint outside its full state outline', async () => {
  const outside = rect(9, 10, 9.2, 10.2), state = rect(7.9, 8.9, 8.1, 9.1)
  const broken: CityModule = {
    ...fictionalCity,
    loadMap: async () => ({ ...fictionalMap, loadGeometry: async () => geometry({ 'test-central': outside }, outside, state) }),
  }
  await assert.rejects(assertCityModuleContract(broken, { profile: 'test-fixture' }), /play area stays inside the state/)
})

test('two city fixtures share one larger state while their playable footprints stay disjoint', async () => {
  const [first, second] = await Promise.all([fictionalMap.loadGeometry(), fictionalNeighbourMap.loadGeometry()])
  assert.deepEqual(first.state, second.state)
  const longitudes = (polygons: readonly LonLatPolygon[]): number[] => polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.map(([lon]) => lon)))
  assert.ok(Math.max(...longitudes(first.playArea)) < Math.min(...longitudes(second.playArea)))
  await Promise.all([assertCityMapContract(fictionalCity, fictionalMap), assertCityMapContract(fictionalNeighbourCity, fictionalNeighbourMap)])
})

test('city contract rejects a venue scene with no builder', () => {
  const original = fictionalContent.venues[0]
  if (!original) throw new Error('fixture venue missing')
  const definition = { ...original.definition, scene: { ...original.definition.scene } }
  const venue = { ...original, definition }
  Object.assign(definition.scene, { kind: 'not-built' })
  Object.assign(venue, { kind: 'not-built' })
  const broken = { ...fictionalContent, venues: [venue, ...fictionalContent.venues.slice(1)] }
  assert.throws(() => assertCityContentContract(fictionalCity, broken, { profile: 'test-fixture' }), /uses built scene kind/)
})

test('opened-city profile cannot bypass minimum venue-kind coverage', () => {
  assert.throws(() => assertCityContentContract(fictionalCity, fictionalContent), /required venue kind/)
  assert.throws(() => assertCityContentContract(lagosCity, LAGOS_CONTENT, { profile: 'test-fixture' }), /only test-\* modules/)
})

test('opened city requires worship, a rented-home district and a road hub', () => {
  const withoutWorship = structuredClone(LAGOS_CONTENT)
  for (const venue of withoutWorship.venues) if (venue.kind === 'worship') { venue.kind = 'park'; venue.definition.scene.kind = 'park' }
  assert.throws(() => assertCityContentContract(lagosCity, withoutWorship), /required venue kind: worship/)
  assert.throws(() => assertCityRulesContract({ ...lagosCity, rules: { ...lagosCity.rules, districts: [] } }), /rented-home district/)
  assert.throws(() => assertCityRulesContract({ ...lagosCity, rules: { ...lagosCity.rules, hubs: lagosCity.rules.hubs.filter((hub) => hub.mode !== 'road') } }), /road hub/)
})

test('a culturally appropriate evening activity satisfies nightlife without a club scene', () => {
  const content = structuredClone(LAGOS_CONTENT)
  for (const venue of content.venues) if (venue.kind === 'club' || venue.kind === 'shrine' || venue.kind === 'rooftop') {
    venue.kind = 'viewing'; venue.definition.scene.kind = 'viewing'
  }
  const garden = content.venues.find((venue) => venue.id === 'viewing-centre')
  const activity = garden?.definition.spots.screen?.activities[0]
  if (!garden || !activity) throw new Error('positive nightlife fixture is incomplete')
  garden.name = 'Evening tea and suya garden'; garden.definition.label = garden.name
  activity.label = 'Tea, suya and a film'; activity.tags = [...(activity.tags ?? []), 'nightlife']
  assertCityContentContract(lagosCity, content)
})

test('city contract rejects a career missing both a workplace and an explicit absence', () => {
  const broken = { ...fictionalContent, unavailableCareerIds: fictionalContent.unavailableCareerIds.filter((id) => id !== 'banking') }
  assert.throws(() => assertCityContentContract(fictionalCity, broken, { profile: 'test-fixture' }), /every career has a workplace or is explicitly unavailable/)
})

test('city contract rejects a starter goal with a foreign venue reference', () => {
  const goal = LAGOS_CONTENT.starterGoals[0]
  if (!goal) throw new Error('Lagos starter goal missing')
  const go: [string] = ['missing-venue']
  const broken = { ...LAGOS_CONTENT, starterGoals: [{ ...goal, go }] }
  assert.throws(() => assertCityContentContract(lagosCity, broken), /goal .* destination venue exists/)
})

test('city contract rejects a wish with a foreign venue reference', () => {
  const wish = LAGOS_CONTENT.wishes.find((entry) => entry.on === 'visit')
  if (!wish || wish.on !== 'visit') throw new Error('Lagos visit wish missing')
  const broken = { ...LAGOS_CONTENT, wishes: [{ ...wish, venue: 'missing-venue' }] }
  assert.throws(() => assertCityContentContract(lagosCity, broken), /wish .* venue exists/)
})

test('city contract rejects module link data that disagrees with the live round-trip registry', () => {
  const link = lagosCity.rules.links[0]
  if (!link) throw new Error('Lagos link missing')
  const broken: CityModule = { ...lagosCity, rules: { ...lagosCity.rules, links: [{ ...link, fare: link.fare + 1 }] } }
  assert.throws(() => assertCityRulesContract(broken), /module link matches the registry/)
})

test('content-only negative modules fail before unrelated lazy map work runs', async () => {
  const broken = moduleWithContent(fictionalCity, { ...fictionalContent, housing: [] })
  await assert.rejects(assertCityModuleContract(broken, { profile: 'test-fixture' }), /at least one rented home/)
})

test('city venue display identity cannot disagree with its scene definition', () => {
  for (const field of ['name', 'district'] as const) {
    const broken = { ...fictionalContent, venues: fictionalContent.venues.map((venue, index) => index === 0 ? { ...venue, [field]: 'Wrong identity' } : venue) }
    assert.throws(() => assertCityContentContract(fictionalCity, broken, { profile: 'test-fixture' }), /venue (name|district) matches its definition/)
  }
})

test('city regular and workplace identity cannot disagree with their definitions', () => {
  const regular = fictionalContent.regulars[0], workplace = fictionalContent.workplaces[0]
  if (!regular || !workplace) throw new Error('identity fixtures are incomplete')
  assert.throws(() => assertCityContentContract(fictionalCity, { ...fictionalContent, regulars: [{ ...regular, id: 'wrong-regular' }, ...fictionalContent.regulars.slice(1)] }, { profile: 'test-fixture' }), /regular id matches its definition/)
  assert.throws(() => assertCityContentContract(fictionalCity, { ...fictionalContent, workplaces: [{ ...workplace, definition: { ...workplace.definition, id: 'banking' } }, ...fictionalContent.workplaces.slice(1)] }, { profile: 'test-fixture' }), /workplace career id matches its definition/)
})
