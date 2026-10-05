import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fromLocal, originAt, toLocal } from '../../geo/frame.ts'
import type { LonLatPolygon } from '../../types/content.ts'
import { ABUJA_AREA_COUNCIL_IDS, ABUJA_PLAY_AREA_KM2, FCT_COUNCILS, FCT_KADUNA_RAIL, FCT_LAND, FCT_RAIL, FCT_ROADS, FCT_STATE, FCT_STATE_KM2, FCT_WATER } from './data/fct.ts'
import { decodeTopology } from './topo.ts'
import type { Feature } from './topo.ts'
import { fctCityGeometry, fctStateOverview } from '../../game/cities/abuja/geometry.ts'
import { ABUJA_MAP, ABUJA_ROUTE_GEOMETRY } from '../../game/cities/abuja/map.ts'

const polygonsOf = (feature: Feature): LonLatPolygon[] => feature.rings.map(polygon => polygon.map(ring => {
  const points: [number, number][] = []
  for (let i = 0; i < ring.length; i += 2) points.push([ring[i]!, ring[i + 1]!])
  return points
}))
const insideRing = (lon: number, lat: number, ring: LonLatPolygon[number]): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!
    if ((a[1] > lat) !== (b[1] > lat) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
const covered = (polygons: readonly LonLatPolygon[], lon: number, lat: number): boolean => polygons.some(polygon => polygon.reduce((inside, ring) => insideRing(lon, lat, ring) ? !inside : inside, false))

test('FCT retains exactly the six named area councils and their independent administrative footprint', () => {
  const councils = decodeTopology(FCT_COUNCILS), geometry = fctCityGeometry(), overview = fctStateOverview()
  assert.deepEqual(councils.features.map(feature => feature.id), [...ABUJA_AREA_COUNCIL_IDS])
  assert.deepEqual(councils.features.map(feature => feature.name), ['Abuja Municipal (AMAC)', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali', 'Abaji'])
  assert.deepEqual(geometry.playArea, councils.features.flatMap(polygonsOf))
  assert.notDeepEqual(geometry.playArea, Object.values(geometry.localUnits).flat(), 'source water must cut land without changing the independent footprint')
  assert.equal(overview.localUnits.length, 6)
  assert.equal(overview.neighbours.length, 4)
  assert.equal(ABUJA_PLAY_AREA_KM2, FCT_STATE_KM2)
  assert.ok(FCT_STATE_KM2 > 7_000 && FCT_STATE_KM2 < 8_500)
  assert.ok(councils.users.some(users => users.length === 2))
  assert.ok(geometry.sharedArcCount > 0)
})

test('six original ADM2 councils partition the FCT outline at bounded independent samples', () => {
  const state = decodeTopology(FCT_STATE).features[0]
  assert.ok(state)
  const geometry = fctCityGeometry(), councils = decodeTopology(FCT_COUNCILS).features.map(polygonsOf)
  const { minLon, minLat, maxLon, maxLat } = state.bounds
  let count = 0, mismatch = 0, surfaceMismatch = 0, overlap = 0
  for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
    const lon = minLon + (maxLon - minLon) * (x + 0.413) / 200
    const lat = minLat + (maxLat - minLat) * (y + 0.617) / 200
    const inside = covered(geometry.state, lon, lat), target = covered(geometry.playArea, lon, lat)
    const claimed = councils.filter(polygons => covered(polygons, lon, lat)).length
    const dry = Object.values(geometry.localUnits).filter(polygons => covered(polygons, lon, lat)).length
    const water = covered(geometry.water, lon, lat)
    if (inside) count++
    if (claimed !== (inside ? 1 : 0)) mismatch++
    if (target !== (dry > 0 || water)) surfaceMismatch++
    if (dry > 1 || (dry && water)) overlap++
  }
  assert.ok(count > 15_000)
  assert.ok(mismatch / count < 0.002, `${mismatch}/${count} council/state samples disagree`)
  assert.ok(surfaceMismatch / count < 0.002, `${surfaceMismatch}/${count} independent-footprint samples lack surface coverage`)
  assert.equal(overlap, 0)
})

test('Jabi and Usuma water cutouts retain the three source reservoir islands as Bwari land', () => {
  const geometry = fctCityGeometry()
  assert.ok(covered(geometry.water, 7.4222269, 9.0754357), 'Jabi mapped water')
  assert.ok(covered(geometry.water, 7.435, 9.2), 'Usuma mapped water')
  for (const [lon, lat] of [[7.417891186641992, 9.19266325], [7.427366268041904, 9.1986216], [7.432426710941396, 9.18346845]]) {
    assert.ok(covered(geometry.localUnits.bwari ?? [], lon!, lat!), 'mapped reservoir island remains land')
    assert.ok(!covered(geometry.water, lon!, lat!), 'water retains its island hole')
  }
  assert.ok(decodeTopology(FCT_WATER).features.flatMap(feature => feature.rings).some(polygon => polygon.length >= 4))
  assert.equal(decodeTopology(FCT_LAND).features.length, 6)
})

test('the main airport, northern and southern roads and planned city avenues retain geographic source bends', async () => {
  for (const name of ["Umaru Musa Yar'Adua Expressway", 'Murtala Mohammed Expressway', 'Nnamdi Azikiwe Expressway', 'Constitution Avenue', 'Independence Avenue', 'Yakubu Gowon Crescent']) {
    const pieces = FCT_ROADS.filter(road => road.name === name)
    assert.ok(pieces.length > 0, name)
    assert.ok(pieces.some(road => road.points.length > 3), `${name} has mapped bends`)
  }
  const scene = await ABUJA_MAP.loadScene()
  assert.equal(scene.roads.length, FCT_ROADS.length)
  for (const [i, source] of FCT_ROADS.entries()) {
    assert.deepEqual(scene.roads[i]?.points, source.points.map(([lon, lat]) => toLocal(ABUJA_MAP.origin, lon, lat)))
  }
})

test('light rail and the closed Kaduna preview use separate sourced tracks without invented connectors', () => {
  assert.equal(FCT_RAIL.filter(track => track.mode === 'light_rail').length, 5)
  const rail = FCT_RAIL.find(track => track.mode === 'rail')
  assert.ok(rail)
  assert.equal(ABUJA_ROUTE_GEOMETRY.length, 1)
  assert.deepEqual(ABUJA_ROUTE_GEOMETRY[0]?.points, FCT_KADUNA_RAIL)
  assert.deepEqual(FCT_KADUNA_RAIL[0], [7.3416618, 9.0474002])
  assert.deepEqual(FCT_KADUNA_RAIL.at(-1), [7.3547029, 10.5479045])
  assert.ok(FCT_KADUNA_RAIL.length > 550, 'complete source-node path reaches Rigasa without simplification')
  assert.deepEqual(rail.points[0], [7.3451511, 9.0457104])
  assert.equal(rail.points.at(-1)?.[1], 9.6, 'preview ends at the disclosed source extent, not Kaduna')
  assert.ok(rail.points.length > 90)
  assert.ok(FCT_RAIL.some(track => track.name === 'ARMT Yellow Line'))
  assert.ok(FCT_RAIL.some(track => track.name === 'ARMT Blue Line'))
})

test('the common frame keeps Kubwa inside Bwari and context landmarks nonenterable', async () => {
  assert.deepEqual(ABUJA_MAP.origin, originAt(7.49, 9.06))
  const geometry = fctCityGeometry(), scene = await ABUJA_MAP.loadScene()
  const kubwa = toLocal(ABUJA_MAP.origin, 7.3410781, 9.1526752)
  assert.deepEqual(scene.estates.bwari, { x: kubwa[0], z: kubwa[1], cols: 8, max: 64 })
  const roundTrip = fromLocal(ABUJA_MAP.origin, ...kubwa)
  assert.ok(Math.abs(roundTrip.lon - 7.3410781) < 1e-12)
  assert.ok(covered(geometry.localUnits.bwari ?? [], roundTrip.lon, roundTrip.lat))
  // The pinned boundary includes this Niger landmark; context classification must not create an enterable venue.
  assert.ok(covered(geometry.state, 7.2341492, 9.1305765), 'known pinned boundary discrepancy is explicit')
  assert.ok(!Object.keys(scene.sites).includes('zuma-rock'))
  for (const id of ['presidential-villa', 'national-assembly', 'supreme-court']) assert.ok(!(id in scene.sites), `${id} remains an exterior context marker`)
})

test('the pinned FCT generator reproduces exact checked-in text and decoded geometry', () => {
  const generator = fileURLToPath(new URL('../../../scripts/geo/build-boundaries.ts', import.meta.url))
  execFileSync(process.execPath, ['--experimental-strip-types', generator, '--fct', '--check'], { stdio: 'pipe' })
})
