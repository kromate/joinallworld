import assert from 'node:assert/strict'
import test from 'node:test'
import { ibadanCity } from './index.ts'
import { createModulePack } from '../../../map3d/cities/module.ts'
import { fromLocal, toLocal } from '../../../map3d/geo/frame.ts'
import { inLga } from '../../../map3d/lga.ts'
import { flatModel, flatSvg } from '../../../map3d/flat.ts'
import { buildCity, CITY_TRIANGLE_BUDGET } from '../../../map3d/city-build.ts'
import { buildNetwork } from '../../../map3d/roads.ts'
import { createKit } from '../../../scene/kit.ts'
import { IBADAN_ROADS } from './roads.ts'

// Geographic landmarks keep their source positions; the camera changes scale, never the outline.
test('Ibadan projects every landmark in the shared frame and keeps its eleven units inland', async () => {
  const [pack, content] = await Promise.all([createModulePack(ibadanCity), ibadanCity.loadContent()])
  assert.equal(pack.inland, true)
  assert.equal(pack.frame?.unitsPerKm, 10)
  assert.equal(pack.lgas.length, 11)
  for (const venue of content.venues.filter(item => item.id !== 'home')) {
    assert.equal(venue.position.kind, 'lon-lat')
    if (venue.position.kind !== 'lon-lat') throw new Error('Expected geographic position')
    const point = pack.sites[venue.id]
    assert.ok(point, venue.id)
    const ll = fromLocal(ibadanCity.rules.mapOrigin, point.x, point.z)
    assert.ok(Math.abs(ll.lon - venue.position.lon) < 1e-10, venue.id)
    assert.ok(Math.abs(ll.lat - venue.position.lat) < 1e-10, venue.id)
    const unit = pack.lgas.find(unit => inLga(unit, point.x, point.z))
    assert.ok(unit, `${venue.id} must lie in the playable footprint`)
    assert.ok(venue.district.endsWith(unit.name), `${venue.id}: district label must match its mapped local government ${unit.name}`)
  }
  for (const home of Object.values(pack.homes)) assert.ok(pack.lgas.some(unit => inLga(unit, home.x, home.z)))
  for (const home of content.housing) {
    assert.ok(home.position)
    const [x, z] = toLocal(ibadanCity.rules.mapOrigin, home.position.lon, home.position.lat)
    const unit = pack.lgas.find(unit => inLga(unit, x, z))
    assert.ok(unit)
    assert.equal(ibadanCity.rules.districts.find(district => district.id === home.districtId)?.localUnitId, unit.id, home.definition.id)
  }
  const flat = flatModel(pack, { roads: [] })
  assert.equal(flat.sea, null)
  assert.doesNotMatch(flatSvg(flat), /fill="#4faacb"/)
})

test('Ibadan has its real main roads and the land around it, and the built city stays inside the triangle and draw-call budgets', async () => {
  const pack = await createModulePack(ibadanCity, { roads: IBADAN_ROADS, surroundings: { spec: { own: 'oyo', countries: ['bj'], roads: [], names: [] }, planned: ['ogun'] } })
  assert.ok(pack.roads.length > 400, `${pack.roads.length} roads`)
  assert.ok(pack.roads.some((road) => road.name === 'Lagos-Ibadan Expressway' && road.major), 'the expressway is a major road')
  for (const road of pack.roads) for (const [x, z] of road.points) assert.ok(Number.isFinite(x) && Number.isFinite(z))
  assert.ok(pack.context && pack.context.land.some((piece) => piece.id === 'oyo-base') && pack.context.land.some((piece) => piece.id === 'ogun'), 'the rest of Oyo State and its neighbours are drawn quiet')
  const city = buildCity(createKit(), pack, buildNetwork(pack), { venues: {}, soon: {} })
  assert.ok(city.triangles > 10000 && city.triangles < CITY_TRIANGLE_BUDGET, `${city.triangles} triangles`)
  const meshes = city.group.children.filter((child) => (child as { isMesh?: boolean }).isMesh).length
  assert.ok(meshes <= 40, `${meshes} draw calls`)
})

test('Ibadan shows the polling centre beside Mapo Hall on the map while its data keeps the real point, and rivers keep a visible line', async () => {
  const map = await ibadanCity.loadMap(), pack = await map.loadScene(), plain = await createModulePack(ibadanCity)
  const content = await ibadanCity.loadContent(), polling = content.venues.find((venue) => venue.id === 'mapo-polling')!
  assert.deepEqual(polling.position, { kind: 'lon-lat', lon: 3.89706, lat: 7.37586 })
  const moved = Math.hypot(pack.sites['mapo-polling']!.x - plain.sites['mapo-polling']!.x, pack.sites['mapo-polling']!.z - plain.sites['mapo-polling']!.z)
  assert.ok(moved > 1.5 && moved < 2.2, `the icon moves about 180 m (${moved} units of 100 m)`)
  assert.match(flatSvg(flatModel(pack, { roads: [] })), /data-water-line="Ogunpa"[^>]*non-scaling-stroke/)
})
