import assert from 'node:assert/strict'
import test from 'node:test'
import type * as THREE from 'three'
import { cityModule, loadCityContent, loadCityMap } from '../registry.ts'
import { CITY_TRIANGLE_BUDGET } from '../../../map3d/city-build.ts'
import { createMap3D } from '../../../map3d/map3d.ts'
import type { MapRenderer } from '../../../map3d/map3d.ts'
import { flatModel, flatSvg } from '../../../map3d/flat.ts'
import { buildNetwork } from '../../../map3d/roads.ts'
import { extentWord } from '../../../map3d/labels.ts'
import { inLga } from '../../../map3d/lga.ts'
import type { CityPack } from '../../../map3d/types.ts'
import { OGUN_CHARACTER, OGUN_QUARTERS, OGUN_SCOPE, OGUN_SURROUNDINGS } from './character.ts'
import type { OgunCityId } from './character.ts'
import { rowsWithin } from './scene.ts'
import { OGUN_ROADS } from './roads.ts'
import { OGUN_WATER } from './water.ts'

const CITIES: readonly OgunCityId[] = ['abeokuta', 'ota', 'ijebu-ode', 'sagamu']
await Promise.all(CITIES.map(loadCityContent))
const packs = Object.fromEntries(await Promise.all(CITIES.map(async (id) => [id, await (await loadCityMap(id)).loadScene()] as const))) as Record<OgunCityId, CityPack>

const stub = <T>(value: object): T => value as unknown as T

/** The map in a fake renderer, as map3d.test.ts runs it: every frame it asks for is counted. */
function harness(pack: CityPack, { width = 1280, height = 800 } = {}) {
  const queue: Array<() => void> = [], env = { now: 0 }
  const renderer = { shadowMap: {}, domElement: {}, info: { render: {} }, setPixelRatio() {}, setSize() {}, setClearColor() {}, dispose() {}, render() {} }
  const container = { hidden: false, appendChild() {}, getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }) }
  const map = createMap3D(stub<HTMLElement>(container), { pack, renderer: stub<MapRenderer>(renderer), raf: (fn) => { queue.push(fn as () => void); return queue.length }, caf: () => { queue.length = 0 }, now: () => env.now })
  const pump = (limit = 1000) => { let ran = 0; while (queue.length && ran < limit) { env.now += 16; queue.shift()!(); ran += 1 } return ran }
  return { map, queue, env, pump, count: () => map.diagnostics().renderCount }
}

/** What a view draws: the visible meshes of the built city and their triangles (an instanced mesh counts every copy). */
function drawn(map: ReturnType<typeof harness>['map']): { meshes: number; triangles: number } {
  let meshes = 0, triangles = 0
  map.city.group.parent!.traverse((object) => {
    const mesh = object as THREE.Mesh & { isInstancedMesh?: true; count?: number }
    if (!mesh.isMesh || !object.visible) return
    for (let up = object.parent; up; up = up.parent) if (!up.visible) return
    meshes += 1
    triangles += ((mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position!.count) / 3) * (mesh.isInstancedMesh ? mesh.count! : 1)
  })
  return { meshes, triangles }
}

test('every Ogun city says what its map is and keeps to its own local governments', () => {
  for (const id of CITIES) {
    const pack = packs[id], module = cityModule(id)!
    assert.equal(pack.id, id)
    assert.equal(extentWord(pack), 'city', `${id}: the whole-extent view names the city, not a state`)
    assert.deepEqual(pack.lgas.map((unit) => unit.id).sort(), module.rules.units.map((unit) => unit.id).sort(), `${id}: only its own local governments`)
    assert.ok(pack.context?.land.some((piece) => piece.id === 'ogun-base'), `${id}: the rest of Ogun State is drawn quiet under it`)
    assert.ok(pack.context?.land.some((piece) => piece.id === 'lagos'), `${id}: Lagos lies to the south`)
    assert.ok(pack.context?.land.some((piece) => piece.id === 'oyo'), `${id}: Oyo lies to the north`)
    assert.deepEqual(pack.context?.labels.map((label) => label.id), OGUN_SURROUNDINGS[id].names.map((name) => name.id))
    assert.ok(pack.context!.labels.some((label) => label.text === 'LAGOS STATE'))
    for (const [venue, site] of Object.entries(pack.sites)) assert.ok(pack.lgas.some((unit) => inLga(unit, site.x, site.z)), `${id}: ${venue} lies in one of its local governments`)
  }
  assert.ok(packs.abeokuta.context!.land.some((piece) => piece.id === 'oyo'), 'Abeokuta looks north to Oyo')
  assert.ok(packs.ota.context!.land.some((piece) => piece.id === 'bj'), 'Ota looks west to the Republic of Benin')
  assert.ok(packs.sagamu.context!.land.some((piece) => piece.id === 'ogun-base'))
})

test('each city map carries real OpenStreetMap roads and water clipped to its own scope, and its own character', () => {
  const [full] = [OGUN_ROADS.length]
  for (const id of CITIES) {
    const pack = packs[id], character = OGUN_CHARACTER[id]
    assert.ok(pack.roads.length > 20, `${id}: ${pack.roads.length} roads`)
    assert.ok(pack.roads.length < full, `${id}: the road file is clipped to the city`)
    for (const road of pack.roads) for (const [x, z] of road.points) assert.ok(Number.isFinite(x) && Number.isFinite(z))
    assert.equal(pack.roads.length, rowsWithin(OGUN_ROADS, OGUN_SCOPE[id]).length)
    assert.ok(pack.roads.some((road) => road.trunk), `${id}: it has a trunk road`)
    assert.equal(pack.areas?.length, character.areas?.length, `${id}: its areas`)
    assert.ok((pack.areas ?? []).some((area) => area.tone === 'old') && (pack.areas ?? []).some((area) => area.tone === 'planned'), `${id}: old and planned areas`)
    assert.ok((pack.notable ?? []).every((venue) => venue in pack.sites), `${id}: every notable place is a venue of the city`)
    assert.ok(pack.districts.some((plate) => OGUN_QUARTERS[id].some((quarter) => quarter.name === plate.name)), `${id}: real quarters are named on the ground`)
  }
  const names = (id: OgunCityId) => (packs[id].waters ?? []).map((water) => water.name)
  assert.ok(names('abeokuta').includes('Ogun'), 'the Ogun River runs through Abeokuta')
  assert.ok(rowsWithin(OGUN_WATER, OGUN_SCOPE.abeokuta).length > 3)
  // Abeokuta: granite outcrops, Olumo the highest, the standard-gauge line and its station.
  const hills = packs.abeokuta.relief ?? []
  assert.ok(hills.length >= 5 && hills.every((hill) => hill.h > 0.5))
  assert.equal([...hills].sort((a, b) => b.h - a.h)[0]!.name, 'Olumo Rock')
  assert.ok(packs.abeokuta.rails?.some((rail) => rail.stations.some((station) => station.name === 'Professor Wole Soyinka Station')), 'the rail line reaches the station')
  assert.ok(packs.ota.rails?.length, 'the railway touches the north-east of Ota')
  assert.ok(packs.ota.areas?.some((area) => /Industrial Estate/.test(area.name)), 'Ota has its industrial belt')
  assert.ok(packs['ijebu-ode'].areas?.some((area) => area.name === 'Ojude Oba ground'), 'Ijebu-Ode names the Ojude Oba ground')
  assert.equal(packs['ijebu-ode'].relief, undefined, 'Ijebu-Ode is lowland')
  assert.ok(packs.sagamu.areas?.some((area) => area.name === 'Ode-Remo') && packs.sagamu.areas?.some((area) => /Ikenne/.test(area.name)))
  assert.ok(packs.sagamu.roads.some((road) => /Lagos-Ibadan Expressway/.test(road.name)), 'Sagamu has the expressway')
})

test('each Ogun city map stays under 90,000 triangles and 40 draw calls in its core, whole and flat views, and idles without drawing', () => {
  for (const id of CITIES) {
    const pack = packs[id], h = harness(pack)
    h.map.setState({ location: 'home', t: Date.UTC(2026, 0, 5, 11), activeAction: null, travel: { home: pack.lgas[0]!.id } } as never)
    h.map.resize()
    assert.ok(h.pump() >= 1, `${id}: opening draws the city`)
    const core = h.map.rig.core(), whole = h.map.rig.whole()
    assert.ok(core.distance < whole.distance, `${id}: the core is nearer than the whole city`)
    for (const [name, distance] of [['core', core.distance], ['whole', whole.distance]] as const) {
      h.map.city.setDetail(distance, 560 * 1.35)
      const view = drawn(h.map)
      assert.ok(view.triangles < CITY_TRIANGLE_BUDGET, `${id} ${name}: ${Math.round(view.triangles)} triangles`)
      assert.ok(view.meshes <= 40, `${id} ${name}: ${view.meshes} draw calls`)
      console.log(`${id} ${name}: ${Math.round(view.triangles)} triangles, ${view.meshes} draw calls`)
    }
    assert.ok(h.map.diagnostics().cityTriangles > 10000, `${id}: a city, not pins on a board`)
    // Flat: the same pack as straight-down SVG.
    const flat = flatModel(pack, buildNetwork(pack))
    assert.equal(flat.extent, 'city')
    assert.ok(flat.roads.length > 20 && flat.land.length > 0)
    assert.doesNotMatch(flatSvg(flat), /NaN|Infinity/)
    // Idle: nothing is scheduled and the render counter stays flat.
    const idle = h.count()
    h.env.now += 60000
    assert.equal(h.queue.length, 0); assert.equal(h.pump(), 0); assert.equal(h.count(), idle, `${id}: the render counter is flat while idle`)
    h.map.destroy()
  }
})
