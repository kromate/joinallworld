import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { LonLatPolygon } from '../../types/content.ts'
import {
  PORT_HARCOURT_LGA_IDS, PORT_HARCOURT_PLAY_AREA_KM2, RIVERS_COMING_LGA_IDS,
  RIVERS_BOAT_ROUTE, RIVERS_CITY_WATER, RIVERS_LAND, RIVERS_LGAS, RIVERS_MANGROVE,
  RIVERS_STATE, RIVERS_STATE_KM2, RIVERS_STATE_WATER,
} from './data/rivers.ts'
import { PORT_HARCOURT_MAP } from '../../game/cities/port-harcourt/map.ts'
import { decodeTopology } from './topo.ts'

const polygonsOf = (rings: readonly (readonly Float64Array[])[]): LonLatPolygon[] => rings.map((polygon) => polygon.map((ring) => {
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
const covers = (polygons: readonly LonLatPolygon[], lon: number, lat: number): boolean => polygons.some((polygon) => polygon.reduce((inside, ring) => insideRing(lon, lat, ring) ? !inside : inside, false))

test('the pinned Rivers release retains all 23 named LGAs including Oyigbo and the delta coast', () => {
  const lgas = decodeTopology(RIVERS_LGAS), state = decodeTopology(RIVERS_STATE)
  assert.equal(lgas.features.length, 23)
  assert.equal(new Set(lgas.features.map((feature) => feature.id)).size, 23)
  assert.equal(state.features.length, 1)
  assert.ok(lgas.byId.has('oyigbo'))
  assert.ok(lgas.byId.has('bonny'))
  assert.deepEqual(PORT_HARCOURT_LGA_IDS, ['port-harcourt', 'obio-akpor', 'eleme', 'okrika', 'ikwerre', 'oyigbo', 'etche'])
  assert.equal(RIVERS_COMING_LGA_IDS.length, 16)
  assert.deepEqual(new Set([...PORT_HARCOURT_LGA_IDS, ...RIVERS_COMING_LGA_IDS]), new Set(lgas.features.map((feature) => feature.id)))
  assert.ok(PORT_HARCOURT_PLAY_AREA_KM2 > 2_800 && PORT_HARCOURT_PLAY_AREA_KM2 < RIVERS_STATE_KM2)
})

test('all 23 ADM2 polygons partition the pinned ADM1 outline at bounded samples', () => {
  const lgas = decodeTopology(RIVERS_LGAS), state = decodeTopology(RIVERS_STATE).byId.get('rivers-state')
  assert.ok(state)
  const regions = lgas.features.map((feature) => polygonsOf(feature.rings)), outline = polygonsOf(state.rings)
  const { minLon, minLat, maxLon, maxLat } = state.bounds
  let inside = 0, mismatch = 0
  for (let x = 0; x < 300; x++) for (let y = 0; y < 300; y++) {
    const lon = minLon + (maxLon - minLon) * (x + 0.413) / 300
    const lat = minLat + (maxLat - minLat) * (y + 0.617) / 300
    const claimed = regions.filter((region) => covers(region, lon, lat)).length
    const inState = covers(outline, lon, lat)
    if (inState) inside++
    if (claimed !== (inState ? 1 : 0)) mismatch++
  }
  assert.ok(inside > 10_000)
  assert.ok(mismatch / inside < 0.002, `${mismatch} samples disagree between 23 LGAs and Rivers ADM1`)
})

test('the city tiles seven real land LGAs with source-clipped water and keeps mapped state water', async () => {
  const geometry = await PORT_HARCOURT_MAP.loadGeometry()
  const overview = await PORT_HARCOURT_MAP.loadStateOverview?.()
  const original = decodeTopology(RIVERS_LGAS)
  assert.equal(decodeTopology(RIVERS_LAND).features.length, 7)
  assert.equal(decodeTopology(RIVERS_CITY_WATER).features.length, 7)
  assert.equal(decodeTopology(RIVERS_STATE_WATER).features.length, 1)
  assert.equal(decodeTopology(RIVERS_MANGROVE).features.length, 1)
  assert.ok(geometry.water.length > 0)
  assert.equal(overview?.localUnits.length, 23)
  assert.ok((overview?.water?.length ?? 0) > 0)
  const independentFootprint = PORT_HARCOURT_LGA_IDS.flatMap((id) => {
    const unit = original.byId.get(id)
    assert.ok(unit)
    return polygonsOf(unit.rings)
  })
  assert.deepEqual(geometry.playArea, independentFootprint)
  const points = independentFootprint.flatMap((polygon) => polygon[0] ?? [])
  const minLon = Math.min(...points.map(([lon]) => lon)), maxLon = Math.max(...points.map(([lon]) => lon))
  const minLat = Math.min(...points.map(([, lat]) => lat)), maxLat = Math.max(...points.map(([, lat]) => lat))
  let inFootprint = 0, mismatch = 0, landWaterOverlap = 0
  for (let x = 0; x < 160; x++) for (let y = 0; y < 160; y++) {
    const lon = minLon + (maxLon - minLon) * (x + 0.37) / 160
    const lat = minLat + (maxLat - minLat) * (y + 0.61) / 160
    const target = covers(independentFootprint, lon, lat)
    const land = Object.values(geometry.localUnits).filter((polygons) => covers(polygons, lon, lat)).length
    const water = covers(geometry.water, lon, lat)
    if (target) inFootprint++
    if (target !== (land > 0 || water)) mismatch++
    if (land && water) landWaterOverlap++
  }
  assert.ok(inFootprint > 1_000)
  assert.ok(mismatch / inFootprint < 0.01, `${mismatch}/${inFootprint} original-footprint samples lack exact land/water coverage`)
  assert.ok(landWaterOverlap / inFootprint < 0.002, `${landWaterOverlap}/${inFootprint} samples overlap land and water`)
})

test('both boat directions follow the same water-connected source path in the decoded city mask', async () => {
  const water = (await PORT_HARCOURT_MAP.loadGeometry()).water
  const [first, last] = [RIVERS_BOAT_ROUTE[0], RIVERS_BOAT_ROUTE.at(-1)]
  assert.deepEqual(first, [7.0247212, 4.7576372])
  assert.deepEqual(last, [7.0823282, 4.7471189])
  assert.ok(RIVERS_BOAT_ROUTE.length > 2)
  for (const path of [RIVERS_BOAT_ROUTE, [...RIVERS_BOAT_ROUTE].reverse()]) {
    for (let segment = 0; segment < path.length - 1; segment++) {
      const a = path[segment]!, b = path[segment + 1]!
      for (let sample = 0; sample <= 100; sample++) {
        const lon = a[0] + (b[0] - a[0]) * sample / 100
        const lat = a[1] + (b[1] - a[1]) * sample / 100
        assert.ok(covers(water, lon, lat), `boat path ${segment} sample ${sample} remains in mapped water`)
      }
    }
  }
  const scene = await PORT_HARCOURT_MAP.loadScene()
  assert.equal(scene.localRoutes?.length, 1)
  assert.equal(scene.localRoutes[0]?.points.length, RIVERS_BOAT_ROUTE.length)
  assert.ok(scene.localRoutes[0]?.points.every((point) => point.y === 0))
})

test('the pinned Rivers generator reproduces checked-in text and decoded geometry', () => {
  const generator = fileURLToPath(new URL('../../../scripts/geo/build-boundaries.ts', import.meta.url))
  execFileSync(process.execPath, ['--experimental-strip-types', generator, '--rivers', '--check'], { stdio: 'pipe' })
})
