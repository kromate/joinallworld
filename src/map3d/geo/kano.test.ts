import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { originAt, toLocal } from '../../geo/frame.ts'
import type { LonLatPolygon } from '../../types/content.ts'
import { KANO_CITY_LGA_IDS, KANO_COMING_LGA_IDS, KANO_LGAS, KANO_PLAY_AREA_KM2, KANO_RAIL, KANO_ROADS, KANO_STATE, KANO_STATE_KM2, KANO_STATE_WATER } from './data/kano.ts'
import { KANO_HISTORIC_WALL } from './data/kano-wall.ts'
import { decodeTopology } from './topo.ts'
import type { Feature } from './topo.ts'
import { kanoCityGeometry, kanoStateOverview } from '../../game/cities/kano/geometry.ts'
import { KANO_MAP } from '../../game/cities/kano/map.ts'

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

test('Kano retains all 44 source LGAs and an independent eight-LGA city footprint', () => {
  const lgas = decodeTopology(KANO_LGAS), geometry = kanoCityGeometry(), overview = kanoStateOverview()
  assert.equal(lgas.features.length, 44)
  assert.equal(new Set(lgas.features.map(feature => feature.id)).size, 44)
  assert.deepEqual(KANO_CITY_LGA_IDS, ['kano-municipal', 'dala', 'fagge', 'gwale', 'nassarawa', 'tarauni', 'kumbotso', 'ungogo'])
  assert.equal(KANO_COMING_LGA_IDS.length, 36)
  assert.deepEqual(new Set([...KANO_CITY_LGA_IDS, ...KANO_COMING_LGA_IDS]), new Set(lgas.features.map(feature => feature.id)))
  const independent = KANO_CITY_LGA_IDS.flatMap(id => {
    const feature = lgas.byId.get(id)
    assert.ok(feature)
    return polygonsOf(feature)
  })
  assert.deepEqual(geometry.playArea, independent)
  assert.notDeepEqual(geometry.playArea, Object.values(geometry.localUnits).flat(), 'water cuts land without defining the administrative footprint')
  assert.equal(overview.localUnits.length, 44)
  assert.ok(KANO_STATE_KM2 > 20_000 && KANO_STATE_KM2 < 21_000)
  assert.ok(KANO_PLAY_AREA_KM2 > 550 && KANO_PLAY_AREA_KM2 < 650)
  assert.ok(geometry.sharedArcCount > 5)
})

test('the 44 LGAs partition the state outline at bounded independent samples', () => {
  const state = decodeTopology(KANO_STATE).features[0]
  assert.ok(state)
  const outline = polygonsOf(state), regions = decodeTopology(KANO_LGAS).features.map(polygonsOf)
  const { minLon, minLat, maxLon, maxLat } = state.bounds
  let count = 0, mismatch = 0
  for (let x = 0; x < 160; x++) for (let y = 0; y < 160; y++) {
    const lon = minLon + (maxLon - minLon) * (x + 0.413) / 160
    const lat = minLat + (maxLat - minLat) * (y + 0.617) / 160
    const inside = covered(outline, lon, lat), claimed = regions.filter(region => covered(region, lon, lat)).length
    if (inside) count++
    if (claimed !== (inside ? 1 : 0)) mismatch++
  }
  assert.ok(count > 10_000)
  assert.ok(mismatch / count < 0.001, `${mismatch}/${count} state samples have inconsistent LGA ownership`)
})

test('city land and water tile the original footprint without overlaps', () => {
  const geometry = kanoCityGeometry(), points = geometry.playArea.flatMap(polygon => polygon[0] ?? [])
  const minLon = Math.min(...points.map(p => p[0])), maxLon = Math.max(...points.map(p => p[0]))
  const minLat = Math.min(...points.map(p => p[1])), maxLat = Math.max(...points.map(p => p[1]))
  let count = 0, mismatch = 0, overlap = 0
  for (let x = 0; x < 180; x++) for (let y = 0; y < 180; y++) {
    const lon = minLon + (maxLon - minLon) * (x + 0.371) / 180
    const lat = minLat + (maxLat - minLat) * (y + 0.619) / 180
    const inside = covered(geometry.playArea, lon, lat)
    const dry = Object.values(geometry.localUnits).filter(polygons => covered(polygons, lon, lat)).length
    const water = covered(geometry.water, lon, lat)
    if (inside) count++
    if (inside !== (dry > 0 || water)) mismatch++
    if (dry > 1 || (dry && water)) overlap++
  }
  assert.ok(count > 15_000)
  assert.ok(mismatch / count < 0.001, `${mismatch}/${count} footprint samples lack mapped surface coverage`)
  assert.equal(overlap, 0)
  assert.ok(geometry.water.length > 0)
  assert.ok(covered(kanoStateOverview().water ?? [], 8.45, 11.4), 'southern mapped reservoir remains state context water')
  assert.ok(!covered(geometry.playArea, 8.45, 11.4), 'state reservoir is not moved into the metropolis')
  assert.equal(decodeTopology(KANO_STATE_WATER).features.length, 1)
})

test('Goron Dutse retains its original Gwale owner beside the Dala border', () => {
  const geometry = kanoCityGeometry(), overview = kanoStateOverview()
  const owners = overview.localUnits.filter(unit => covered(unit.polygons, 8.4944515, 12.001466))
  assert.deepEqual(owners.map(unit => unit.id), ['gwale'])
  assert.ok(covered(geometry.localUnits.gwale ?? [], 8.4944515, 12.001466))
  assert.ok(!covered(geometry.localUnits.dala ?? [], 8.4944515, 12.001466))
  assert.ok(geometry.gridDegrees <= 0.000001, 'sub-metre grid preserves a point 1.2 m from the exact administrative border')
})

test('sourced roads, flyovers and local rail keep the shared frame and Nassarawa starts at Gama', async () => {
  const scene = await KANO_MAP.loadScene()
  assert.deepEqual(KANO_MAP.origin, originAt(8.52, 12))
  assert.equal(scene.roads.length, KANO_ROADS.length)
  assert.ok(scene.inland)
  for (const [i, source] of KANO_ROADS.entries()) assert.deepEqual(scene.roads[i]?.points, source.points.map(([lon, lat]) => toLocal(KANO_MAP.origin, lon, lat)))
  for (const name of ['Zaria Road', 'Murtala Mohammed Road']) assert.ok(KANO_ROADS.some(road => road.name === name && road.points.length > 2))
  for (const id of ['road-161619537-0', 'road-161831977-0']) assert.ok(scene.roads.some(road => road.id === id && road.bridge))
  assert.ok(KANO_RAIL.length > 0)
  const [x, z] = toLocal(KANO_MAP.origin, 8.55362, 12.0327)
  assert.deepEqual(scene.estates.nassarawa, { x, z, cols: 8, max: 64 })
  assert.ok(covered(kanoCityGeometry().localUnits.nassarawa ?? [], 8.55362, 12.0327))
  assert.ok(!Object.keys(scene.sites).includes('wudil-university'))
  assert.ok(!Object.keys(scene.sites).includes('tiga-dam'))
})

test('the Kano generator reproduces checked-in text and decoded geometry', () => {
  const generator = fileURLToPath(new URL('../../../scripts/geo/build-boundaries.ts', import.meta.url))
  execFileSync(process.execPath, ['--experimental-strip-types', generator, '--kano', '--check'], { stdio: 'pipe' })
})


test('the published historic outline retains all 721 source points in a separate shared-frame heritage layer', async () => {
  const geometry = kanoCityGeometry(), scene = await KANO_MAP.loadScene(), overview = kanoStateOverview()
  const units = overview.localUnits.filter(unit => KANO_CITY_LGA_IDS.some(id => id === unit.id))
  assert.equal(KANO_HISTORIC_WALL.length, 721)
  assert.equal(scene.heritageLines?.length, 1)
  const line = scene.heritageLines?.[0]
  assert.ok(line)
  assert.equal(line.id, 'kano-historic-wall')
  assert.equal(line.kind, 'historic-wall-alignment')
  assert.equal(line.name, 'Published historic wall outline · approximate')
  assert.deepEqual(line.points, KANO_HISTORIC_WALL.map(([lon, lat]) => toLocal(KANO_MAP.origin, lon, lat)))
  for (const [lon, lat] of KANO_HISTORIC_WALL) {
    assert.ok(covered(geometry.playArea, lon, lat), `${lon},${lat} belongs to the eight-LGA footprint`)
    assert.equal(units.filter(unit => covered(unit.polygons, lon, lat)).length, 1, 'source vertex belongs to exactly one metropolis LGA')
  }
  assert.ok(!scene.roads.some(road => road.id === line.id), 'historical alignment is not a road or route')
  assert.equal(scene.roads.length, KANO_ROADS.length)
  assert.ok(!(line.id in scene.sites), 'historic outline creates no playable entrance')
  const label = scene.districts.find(label => label.name === 'Historic wall outline (approx.)')
  assert.ok(label)
  assert.equal(label.x, (Math.min(...line.points.map(point => point[0])) + Math.max(...line.points.map(point => point[0]))) / 2)
  assert.equal(label.z, (Math.min(...line.points.map(point => point[1])) + Math.max(...line.points.map(point => point[1]))) / 2)
})
