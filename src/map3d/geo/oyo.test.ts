import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { LonLatPolygon } from '../../types/content.ts'
import { IBADAN_MAP } from '../../game/cities/ibadan/map.ts'
import { NIGERIA } from './data/nigeria.ts'
import {
  IBADAN_LGA_IDS,
  IBADAN_PLAY_AREA_KM2,
  LAGOS_20_LGA_KM2,
  OYO_LGAS,
  OYO_STATE,
  OYO_STATE_KM2,
} from './data/oyo.ts'
import { decodeTopology } from './topo.ts'

const inRing = (lon: number, lat: number, ring: LonLatPolygon[number]): boolean => {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!, b = ring[previous]!
    if ((a[1] > lat) !== (b[1] > lat) && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

const covers = (polygons: readonly LonLatPolygon[], lon: number, lat: number): boolean => polygons.some((polygon) => polygon.reduce((inside, ring) => inRing(lon, lat, ring) ? !inside : inside, false))

test('Oyo source topology retains all 33 LGAs and the exact 11-unit Ibadan selection', async () => {
  const lgas = decodeTopology(OYO_LGAS), state = decodeTopology(OYO_STATE)
  assert.equal(lgas.features.length, 33)
  assert.equal(new Set(lgas.features.map((feature) => feature.id)).size, 33)
  assert.deepEqual(IBADAN_LGA_IDS, [
    'akinyele', 'egbeda', 'ibadan-north', 'ibadan-north-east', 'ibadan-north-west', 'ibadan-south-east',
    'ibadan-south-west', 'ido', 'lagelu', 'oluyole', 'ona-ara',
  ])
  assert.deepEqual(state.features.map((feature) => feature.id), ['oyo-state'])

  const geometry = await IBADAN_MAP.loadGeometry()
  assert.deepEqual(Object.keys(geometry.localUnits), [...IBADAN_LGA_IDS])
  assert.deepEqual(geometry.playArea, Object.values(geometry.localUnits).flat())
  assert.deepEqual(geometry.water, [])
  assert.ok(geometry.sharedArcCount > 0)
  assert.equal(geometry.gridDegrees, 0.0002)
})

test('Ibadan LGA tiles cover the play area once and remain inside the full Oyo outline', async () => {
  const geometry = await IBADAN_MAP.loadGeometry()
  const outerPoints = geometry.playArea.flatMap((polygon) => polygon[0] ?? [])
  const lons = outerPoints.map(([lon]) => lon), lats = outerPoints.map(([, lat]) => lat)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats)
  let citySamples = 0, outsideState = 0, overlap = 0
  for (let x = 0; x <= 160; x += 1) for (let y = 0; y <= 160; y += 1) {
    const lon = minLon + ((maxLon - minLon) * x) / 160, lat = minLat + ((maxLat - minLat) * y) / 160
    if (!covers(geometry.playArea, lon, lat)) continue
    citySamples += 1
    if (!covers(geometry.state, lon, lat)) outsideState += 1
    const land = Object.values(geometry.localUnits).filter((polygons) => covers(polygons, lon, lat)).length
    if (land !== 1) overlap += 1
  }
  assert.ok(citySamples > 1_000)
  assert.ok(outsideState / citySamples < 0.001, `${outsideState} of ${citySamples} play-area samples fall outside Oyo State`)
  assert.ok(overlap / citySamples < 0.001, `${overlap} of ${citySamples} play-area samples are not covered exactly once`)
})

test('reported areas are source measurements of distinct administrative sets', () => {
  assert.equal(OYO_STATE_KM2, 27_762.6)
  assert.equal(IBADAN_PLAY_AREA_KM2, 2_875.2)
  assert.equal(LAGOS_20_LGA_KM2, 3_547.5)
  assert.ok(IBADAN_PLAY_AREA_KM2 < OYO_STATE_KM2)
})

test('the Nigeria atlas uses the pinned Oyo state source and shares its borders with neighbours', () => {
  const atlas = decodeTopology(NIGERIA), detailed = decodeTopology(OYO_STATE)
  const oyo = atlas.byId.get('oyo'), state = detailed.byId.get('oyo-state')
  assert.ok(oyo)
  assert.ok(state)
  assert.deepEqual(oyo.cap, ['Ibadan', 3.93, 7.38])
  assert.ok(oyo.polys.flat(2).some((reference) => atlas.users[reference < 0 ? ~reference : reference]!.length > 1))
  for (const field of ['minLon', 'minLat', 'maxLon', 'maxLat'] as const) {
    assert.ok(Math.abs(oyo.bounds[field] - state.bounds[field]) <= 0.002, `${field} differs between atlas and detailed Oyo outlines`)
  }
})

test('the pinned Oyo generator reproduces the checked-in bytes and decoded geometry', () => {
  const generator = fileURLToPath(new URL('../../../scripts/geo/build-boundaries.ts', import.meta.url))
  execFileSync(process.execPath, ['--experimental-strip-types', generator, '--oyo', '--check'], { stdio: 'pipe' })
})
