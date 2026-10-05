import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createLife } from '../../life.ts'
import { houseOf } from '../../app/features/home/houseOf.ts'
import { buildHomeScene } from '../../scene/home-scene.ts'
import { createKit } from '../../scene/kit.ts'
import { createMap3D } from '../../map3d/map3d.ts'
import { cityFlatModel } from '../../map3d/map2d.ts'
import type { MapRenderer } from '../../map3d/map3d.ts'
import type { CityContent, CityModule } from '../../types/content.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import { FICTIONAL_CITY_ID, fictionalCity, fictionalContent, fictionalMap } from './testing/fictionalCity.test-fixture.ts'

const GOVERNMENT = 'test-government-hall'
const HOME = 'test-rental-home'

test('3D, flat, SVG and home scene read renamed places from the active city module', async (t) => {
  const stateHouse = fictionalContent.venues.find((venue) => venue.kind === 'statehouse')
  if (!stateHouse) throw new Error('fictional state house is missing')
  const content: CityContent = {
    ...fictionalContent,
    venues: fictionalContent.venues.map((venue) => venue === stateHouse ? { ...venue, id: GOVERNMENT, name: 'Test Government Hall', definition: { ...venue.definition, id: GOVERNMENT, label: 'Test Government Hall' } } : venue),
    regulars: fictionalContent.regulars.map((regular) => regular.venueId === stateHouse.id ? { ...regular, venueId: GOVERNMENT, definition: { ...regular.definition, venue: GOVERNMENT } } : regular),
    housing: [{ definition: { id: HOME, label: 'Test Rental Home', district: 'Test Centre', grid: 7, rent: 12, moveIn: 36, description: 'A test-only rental.' }, spot: { district: 'Test Centre', zone: 'mainland', map: { x: 31, y: 44 } } }],
  }
  const basePack = await fictionalMap.loadScene()
  const { [stateHouse.id]: _oldStateHouse, ...sites } = basePack.sites
  const pack = { ...basePack, sites: { ...sites, [GOVERNMENT]: { x: 70, z: 50 } }, homes: { ...basePack.homes, [HOME]: { x: 31, z: 44, district: 'Test Centre' } }, lgas: [], estates: {} }
  const module: CityModule = {
    ...fictionalCity,
    rules: { ...fictionalCity.rules, rentedHomeIds: [HOME], defaultRentedHome: HOME },
    loadContent: async () => content,
    loadMap: async () => ({ ...fictionalMap, loadScene: async () => pack }),
  }
  const registration = registerCityForTest(module)
  t.after(registration.dispose)
  await loadCityContent(FICTIONAL_CITY_ID)

  const svgSource = await readFile(new URL('../../city-map.ts', import.meta.url), 'utf8')
  assert.match(svgSource, /contentFor\(cityId\)\.venues/)
  assert.match(svgSource, /housingFor\(cityId\)/)
  assert.doesNotMatch(svgSource, /const VENUE_TABLE|const HOME_TABLE/, 'the CSS-backed SVG module has no global city catalogue snapshot')

  const flat = cityFlatModel(pack, FICTIONAL_CITY_ID)
  assert.ok(flat.places.some((place) => place.id === GOVERNMENT))
  assert.ok(!flat.places.some((place) => place.id === 'state-house'))
  assert.equal(flat.homes[HOME]?.district, 'Test Centre')

  const renderer = { shadowMap: {}, domElement: {}, info: { render: {} }, setClearColor() {}, render() {}, dispose() {} }
  const container = { hidden: false, appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0 }) }
  const map = createMap3D(container as unknown as HTMLElement, { pack, cityId: FICTIONAL_CITY_ID, renderer: renderer as unknown as MapRenderer, raf: () => 1, caf: () => {}, tabHidden: () => false })
  assert.ok(map.city.places[GOVERNMENT])
  assert.equal(map.city.places['state-house'], undefined)
  map.destroy()

  const state = createLife({ property: { house: HOME } }, { now: 1, cityId: FICTIONAL_CITY_ID })
  assert.equal(houseOf(state).grid, 7)
  const kit = createKit(), scene = buildHomeScene(kit)
  scene.update(state)
  assert.ok(Math.abs(scene.walk.scale - (10 / 7) * 0.72) < 1e-9, 'rendered room scale uses the city rental grid')
  scene.dispose()
  kit.dispose()
})
