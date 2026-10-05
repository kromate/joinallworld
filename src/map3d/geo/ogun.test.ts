import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { LonLatPolygon } from '../../types/content.ts'
import { ogunStateOverview } from '../../game/cities/ogun/mapOverview.ts'
import { ABEOKUTA_MAP } from '../../game/cities/abeokuta/map.ts'
import { OTA_MAP } from '../../game/cities/ota/map.ts'
import { IJEBU_ODE_MAP } from '../../game/cities/ijebu-ode/map.ts'
import { SAGAMU_MAP } from '../../game/cities/sagamu/map.ts'
import { LAGOS } from './data/lagos.ts'
import {
  OGUN_CITY_AREA_KM2,
  OGUN_CITY_LGA_IDS,
  OGUN_COMING_LGA_IDS,
  OGUN_LAGOS_SEAM_VERTEX_COUNT,
  OGUN_LGAS,
  OGUN_STATE,
  OGUN_STATE_KM2,
  OTA_LAGOS_SEAM_VERTEX_COUNT,
} from './data/ogun.ts'
import { decodeTopology } from './topo.ts'

const EXPECTED_LAGOS_HASH = 'e65bb768f638d863576bf64dc800fb4823777def95813e4ed8171678ec7ac1f9'
const pointKey = ([lon, lat]: readonly [number, number]): string => `${lon},${lat}`
const segmentKey = (a: readonly [number, number], b: readonly [number, number]): string => pointKey(a) < pointKey(b) ? `${pointKey(a)}|${pointKey(b)}` : `${pointKey(b)}|${pointKey(a)}`
const inRing = (lon: number, lat: number, ring: LonLatPolygon[number]): boolean => {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!, b = ring[previous]!
    if ((a[1] > lat) !== (b[1] > lat) && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
const covers = (polygons: readonly LonLatPolygon[], lon: number, lat: number): boolean => polygons.some((polygon) => polygon.reduce((inside, ring) => inRing(lon, lat, ring) ? !inside : inside, false))
const interiorPoint = (polygon: LonLatPolygon): readonly [number, number] => {
  const outer = polygon[0]
  if (!outer?.length) throw new Error('A polygon needs an outer ring')
  const minLon = Math.min(...outer.map(([lon]) => lon)), maxLon = Math.max(...outer.map(([lon]) => lon))
  const minLat = Math.min(...outer.map(([, lat]) => lat)), maxLat = Math.max(...outer.map(([, lat]) => lat))
  for (let row = 1; row < 30; row += 1) for (let column = 1; column < 30; column += 1) {
    const point: readonly [number, number] = [minLon + ((maxLon - minLon) * column) / 30, minLat + ((maxLat - minLat) * row) / 30]
    if (covers([polygon], point[0], point[1])) return point
  }
  throw new Error('No interior sample found')
}

function polygonsOf(raw: typeof OGUN_STATE, featureId: string): LonLatPolygon[] {
  const feature = decodeTopology(raw).byId.get(featureId)
  if (!feature) throw new Error(`Missing geometry feature ${featureId}`)
  return feature.rings.map((polygon) => polygon.map((ring) => {
    const points: [number, number][] = []
    for (let index = 0; index < ring.length; index += 2) points.push([ring[index]!, ring[index + 1]!])
    return points
  }))
}

const segmentsOf = (polygons: readonly LonLatPolygon[]): Map<string, readonly [readonly [number, number], readonly [number, number]]> => {
  const segments = new Map<string, readonly [readonly [number, number], readonly [number, number]]>()
  for (const polygon of polygons) for (const ring of polygon) for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!, b = ring[(index + 1) % ring.length]!
    segments.set(segmentKey(a, b), [a, b])
  }
  return segments
}

function assertAcceptedLagosSeam(lagos: readonly LonLatPolygon[], ogun: readonly LonLatPolygon[], vertexCount = OGUN_LAGOS_SEAM_VERTEX_COUNT): void {
  const lagosSegments = segmentsOf(lagos), shared = [...segmentsOf(ogun)].filter(([key]) => lagosSegments.has(key))
  assert.equal(shared.length, vertexCount - 1, 'every accepted Lagos seam segment is reused exactly')
  const degrees = new Map<string, number>()
  for (const [, [a, b]] of shared) for (const point of [a, b]) degrees.set(pointKey(point), (degrees.get(pointKey(point)) ?? 0) + 1)
  assert.equal(degrees.size, vertexCount)
  assert.equal([...degrees.values()].filter((degree) => degree === 1).length, 2, 'the shared seam has exactly two endpoints')
  assert.equal([...degrees.values()].filter((degree) => degree === 2).length, vertexCount - 2, 'the shared seam is one continuous chain')
  assert.equal([...degrees.values()].some((degree) => degree > 2), false, 'the shared seam has no branch')
}

test('Ogun retains all 20 LGAs and partitions 11 opened units from nine coming units', () => {
  const topology = decodeTopology(OGUN_LGAS), ids = topology.features.map((feature) => feature.id)
  assert.equal(ids.length, 20)
  assert.equal(new Set(ids).size, 20)
  assert.deepEqual(topology.features.map((feature) => feature.name), [
    'Abeokuta North', 'Abeokuta South', 'Ado Odo/Ota', 'Ewekoro', 'Ifo', 'Ijebu East', 'Ijebu North',
    'Ijebu North East', 'Ijebu Ode', 'Ikenne', 'Imeko/Afon', 'Ipokia', 'Obafemi/Owode', 'Odeda',
    'Odogbolu', 'Ogun Water Side', 'Remo North', 'Sagamu', 'Yewa North', 'Yewa South',
  ])
  const opened = Object.values(OGUN_CITY_LGA_IDS).flat()
  assert.equal(opened.length, 11)
  assert.equal(new Set([...opened, ...OGUN_COMING_LGA_IDS]).size, 20)
  assert.deepEqual([...opened, ...OGUN_COMING_LGA_IDS].sort(), [...ids].sort())
  assert.deepEqual(OGUN_CITY_LGA_IDS.abeokuta, ['abeokuta-north', 'abeokuta-south', 'odeda', 'obafemi-owode'])
  assert.deepEqual(OGUN_CITY_LGA_IDS.ota, ['ado-odo-ota'])
  assert.deepEqual(OGUN_CITY_LGA_IDS['ijebu-ode'], ['ijebu-ode', 'ijebu-north-east', 'odogbolu'])
  assert.deepEqual(OGUN_CITY_LGA_IDS.sagamu, ['sagamu', 'ikenne', 'remo-north'])
})

test('four city descriptors select distinct real footprints and share one state overview', async () => {
  const maps = [ABEOKUTA_MAP, OTA_MAP, IJEBU_ODE_MAP, SAGAMU_MAP]
  assert.deepEqual(maps.map((map) => [map.cityId, map.origin]), [
    ['abeokuta', { x: -5019, z: 2039 }], ['ota', { x: -5396, z: 2644 }],
    ['ijebu-ode', { x: -4523, z: 2457 }], ['sagamu', { x: -4801, z: 2386 }],
  ])
  for (const map of maps) {
    const geometry = await map.loadGeometry(), overview = await map.loadStateOverview?.()
    assert.deepEqual(Object.keys(geometry.localUnits), [...map.localUnitIds])
    assert.deepEqual(geometry.playArea, Object.values(geometry.localUnits).flat())
    assert.deepEqual(geometry.water, [])
    assert.ok(geometry.playArea.every((polygon) => {
      const point = interiorPoint(polygon)
      return covers(geometry.state, point[0], point[1])
    }), `${map.cityId} footprint lies inside Ogun State`)
    assert.deepEqual([overview?.stateId, overview?.localUnits.length, overview?.neighbours[0]?.name], ['ogun', 20, 'Lagos State'])
  }
})

test('the shared state overview exposes all units and the accepted Lagos neighbour lazily', () => {
  const overview = ogunStateOverview()
  assert.deepEqual([overview.stateId, overview.name, overview.localUnits.length], ['ogun', 'Ogun State', 20])
  assert.deepEqual(overview.localUnits.map((unit) => unit.id).sort(), decodeTopology(OGUN_LGAS).features.map((feature) => feature.id).sort())
  assert.deepEqual(overview.neighbours.map((neighbour) => neighbour.name), ['Lagos State'])
  assertAcceptedLagosSeam(overview.neighbours[0]!.polygons, overview.outline)
  const landmarkIds = overview.landmarks?.map((landmark) => landmark.id) ?? []
  assert.ok(landmarkIds.includes('oou-ago-iwoye') && landmarkIds.includes('papalanto-station'))
  for (const [landmarkId, unitId] of [['oou-ago-iwoye', 'ijebu-north'], ['papalanto-station', 'ewekoro']] as const) {
    const landmark = overview.landmarks?.find((item) => item.id === landmarkId), unit = overview.localUnits.find((item) => item.id === unitId)
    assert.ok(landmark && unit)
    assert.ok(covers(unit.polygons, landmark.lon, landmark.lat), `${landmarkId} stays in coming ${unitId}`)
    assert.ok(OGUN_COMING_LGA_IDS.includes(unitId))
  }
})

test('the Ogun outline reuses the accepted Lagos seam exactly and rejects a one-grid gap', () => {
  const lagos = polygonsOf(LAGOS, 'lagos-state'), ogun = polygonsOf(OGUN_STATE, 'ogun-state')
  assertAcceptedLagosSeam(lagos, ogun)

  const sharedVertices = new Set([...segmentsOf(ogun)].filter(([key]) => segmentsOf(lagos).has(key)).flatMap(([, segment]) => segment.map(pointKey)))
  const broken = ogun.map((polygon) => polygon.map((ring) => ring.map(([lon, lat]): [number, number] => [lon, lat])))
  const point = broken.flat(2).find((candidate) => sharedVertices.has(pointKey(candidate)))
  if (!point) throw new Error('The negative fixture needs a seam vertex')
  point[0] += OGUN_STATE.grid
  assert.throws(() => assertAcceptedLagosSeam(lagos, broken), /accepted Lagos seam segment|shared seam/)
})

test('Ota play-area land reuses every accepted adjacent Lagos LGA segment exactly', () => {
  const accepted = decodeTopology(LAGOS).features.slice(0, 20).flatMap((feature) => polygonsOf(LAGOS, feature.id))
  const ota = polygonsOf(OGUN_LGAS, 'ado-odo-ota')
  assert.equal(OTA_LAGOS_SEAM_VERTEX_COUNT, 147)
  assertAcceptedLagosSeam(accepted, ota, OTA_LAGOS_SEAM_VERTEX_COUNT)
})

test('Ogun administrative areas are measured without forcing a city-size comparison', () => {
  assert.equal(OGUN_STATE_KM2, 16_724.2)
  assert.deepEqual(OGUN_CITY_AREA_KM2, { abeokuta: 3783.3, ota: 851.4, 'ijebu-ode': 873.6, sagamu: 929.5 })
  assert.ok(Object.values(OGUN_CITY_AREA_KM2).every((area) => area > 0 && area < OGUN_STATE_KM2))
})

test('the pinned Ogun generator reproduces geometry without changing accepted Lagos', () => {
  const generator = fileURLToPath(new URL('../../../scripts/geo/build-boundaries.ts', import.meta.url))
  execFileSync(process.execPath, ['--experimental-strip-types', generator, '--ogun', '--check'], { stdio: 'pipe' })
  const lagosPath = fileURLToPath(new URL('./data/lagos.ts', import.meta.url))
  assert.equal(createHash('sha256').update(readFileSync(lagosPath)).digest('hex'), EXPECTED_LAGOS_HASH)
})
