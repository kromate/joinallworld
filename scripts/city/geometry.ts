import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { originAt, toLocal } from '../../src/map3d/geo/frame.ts'
import {
  NIGERIA_BOUNDARY_RELEASE,
  NIGERIA_BOUNDARY_SOURCES,
  buildTopology,
  geometryPolygons,
  isRecord,
  loadNigeriaBoundarySource,
  pointInPolygons,
  pointInRing,
  polygonsOf,
  polygonsKm2,
  ringsFor,
  subsetTopology,
  topologyArcText,
  topologyPolys,
} from '../geo/nigeria-boundaries.ts'
import type {
  BoundaryFeatureCollection,
  BuiltTopology,
  Point,
  Polygon,
  RingInput,
} from '../geo/nigeria-boundaries.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PBF = {
  url: 'https://download.geofabrik.de/africa/nigeria-261003.osm.pbf',
  date: '2026-10-03',
  sha256: '6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5',
  bytes: 709_273_731,
} as const

const ADMIN_GRID_DEGREES = 0.0002
const ADMIN_TOLERANCE_SQUARE_UNITS = 0.01
const SURFACE_GRID_DEGREES = 0.000001
const SURFACE_TOLERANCE_SQUARE_UNITS = 0.0001

export interface CityGeometryLocalUnitInput {
  readonly id: string
  readonly sourceName: string
  readonly name: string
}

export interface CityGeometryVenueInput {
  readonly id: string
  readonly name: string
  readonly lon: number
  readonly lat: number
  readonly localUnitId: string
}

export interface BuildCityGeometryInput {
  readonly cityId: string
  readonly stateId: string
  readonly stateSourceName: string
  readonly localUnits: readonly CityGeometryLocalUnitInput[]
  readonly atlas: Readonly<{ lon: number; lat: number }>
  readonly origin?: Readonly<{ x: number; z: number }>
  readonly venues: readonly CityGeometryVenueInput[]
  readonly surface: Readonly<{ sha256: string; bytes: number }>
  readonly offline: boolean
}

export interface CityGeometryBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

export interface CityGeometryEvidence {
  readonly boundaryRelease: typeof NIGERIA_BOUNDARY_RELEASE
  readonly adm1Sha256: string
  readonly adm2Sha256: string
  readonly stateSourceName: string
  readonly localUnitSourceNames: readonly string[]
  readonly localUnitAreaKm2: Readonly<Record<string, number>>
  readonly surfaceSourcePath: string
  readonly surfaceSourceSha256: string
  readonly pbfUrl: typeof PBF.url
  readonly pbfDate: typeof PBF.date
  readonly pbfSha256: typeof PBF.sha256
  readonly pbfBytes: typeof PBF.bytes
}

export interface BuiltCityGeometry {
  readonly origin: Readonly<{ x: number; z: number }>
  readonly bounds: CityGeometryBounds
  readonly localUnitIds: readonly string[]
  readonly localUnitAnchors: Readonly<Record<string, Readonly<{ lon: number; lat: number }>>>
  readonly stateFeatureId: string
  readonly dataModuleText: string
  readonly geographyModuleText: string
  readonly runtimeModuleText: string
  readonly evidence: CityGeometryEvidence
  /** Raw selected ADM2 polygons, used only by the build-time cross-city overlap gate. */
  readonly playAreaPolygons: readonly Polygon[]
}

interface SurfacePolygonFeature {
  readonly kind: 'state' | 'administrative' | 'land' | 'water'
  readonly id: string
  readonly localUnitId: string
  readonly name: string
  readonly polygons: Polygon[]
}

interface SurfaceLineFeature {
  readonly kind: 'road' | 'rail'
  readonly id: string
  readonly name: string
  readonly points: Point[]
  readonly major: boolean
  readonly bridge: boolean
}

interface SurfaceSource {
  readonly polygons: readonly SurfacePolygonFeature[]
  readonly lines: readonly SurfaceLineFeature[]
  readonly sha256: string
  readonly relativePath: string
}

const idsAreSafe = (id: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)

function assertUnique<T>(values: readonly T[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`)
}

function polygonCentroid(polygon: Polygon): Point | undefined {
  const ring = polygon[0]
  if (!ring?.length) return undefined
  let crossSum = 0
  let x = 0
  let y = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!
    const next = ring[(index + 1) % ring.length]!
    const cross = current[0] * next[1] - next[0] * current[1]
    crossSum += cross
    x += (current[0] + next[0]) * cross
    y += (current[1] + next[1]) * cross
  }
  if (Math.abs(crossSum) < Number.EPSILON) return undefined
  return [x / (3 * crossSum), y / (3 * crossSum)]
}

function interiorPoint(polygons: readonly Polygon[]): Point {
  const candidates = [...polygons].sort((left, right) => polygonsKm2([right]) - polygonsKm2([left]))
  for (const polygon of candidates) {
    const centroid = polygonCentroid(polygon)
    if (centroid && pointInPolygons(centroid, [polygon])) return centroid
    const outer = polygon[0]
    if (!outer?.length) continue
    const minLon = Math.min(...outer.map(([lon]) => lon))
    const maxLon = Math.max(...outer.map(([lon]) => lon))
    const minLat = Math.min(...outer.map(([, lat]) => lat))
    const maxLat = Math.max(...outer.map(([, lat]) => lat))
    const centre: Point = [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
    let best: Point | undefined
    let bestDistance = Infinity
    for (let row = 1; row < 40; row += 1) {
      for (let column = 1; column < 40; column += 1) {
        const point: Point = [minLon + (maxLon - minLon) * column / 40, minLat + (maxLat - minLat) * row / 40]
        const distance = Math.hypot(point[0] - centre[0], point[1] - centre[1])
        if (distance < bestDistance && pointInPolygons(point, [polygon])) {
          best = point
          bestDistance = distance
        }
      }
    }
    if (best) return best
  }
  throw new Error('A selected local unit has no deterministic interior point')
}

const pointOnSegment = (point: Point, start: Point, end: Point): boolean => {
  const cross = (point[0] - start[0]) * (end[1] - start[1]) - (point[1] - start[1]) * (end[0] - start[0])
  return Math.abs(cross) <= 1e-12
    && point[0] >= Math.min(start[0], end[0]) - 1e-12
    && point[0] <= Math.max(start[0], end[0]) + 1e-12
    && point[1] >= Math.min(start[1], end[1]) - 1e-12
    && point[1] <= Math.max(start[1], end[1]) + 1e-12
}

const pointOnPolygonBoundary = (point: Point, polygon: Polygon): boolean =>
  polygon.some((ring) => ring.some((start, index) => pointOnSegment(point, start, ring[(index + 1) % ring.length]!)))

const strictlyInsidePolygon = (point: Point, polygon: Polygon): boolean =>
  !pointOnPolygonBoundary(point, polygon)
  && pointInRing(point, polygon[0]!)
  && !polygon.slice(1).some((hole) => pointInRing(point, hole))

function properIntersection(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (start: Point, end: Point, point: Point): number => {
    const cross = (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
    return Math.abs(cross) <= 1e-12 ? 0 : Math.sign(cross)
  }
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

interface PolygonBounds { readonly minLon: number; readonly maxLon: number; readonly minLat: number; readonly maxLat: number }

const boundsFor = (polygon: Polygon): PolygonBounds => {
  const outer = polygon[0]
  if (!outer?.length) throw new Error('A polygon has no outer ring')
  return {
    minLon: Math.min(...outer.map(([lon]) => lon)),
    maxLon: Math.max(...outer.map(([lon]) => lon)),
    minLat: Math.min(...outer.map(([, lat]) => lat)),
    maxLat: Math.max(...outer.map(([, lat]) => lat)),
  }
}

const boxesOverlap = (left: PolygonBounds, right: PolygonBounds): boolean =>
  left.minLon < right.maxLon && right.minLon < left.maxLon && left.minLat < right.maxLat && right.minLat < left.maxLat

const segmentsMayCross = (a: Point, b: Point, c: Point, d: Point): boolean =>
  Math.min(a[0], b[0]) < Math.max(c[0], d[0])
  && Math.min(c[0], d[0]) < Math.max(a[0], b[0])
  && Math.min(a[1], b[1]) < Math.max(c[1], d[1])
  && Math.min(c[1], d[1]) < Math.max(a[1], b[1])

function polygonsOverlap(left: readonly Polygon[], right: readonly Polygon[]): boolean {
  for (const leftPolygon of left) {
    for (const rightPolygon of right) {
      if (!boxesOverlap(boundsFor(leftPolygon), boundsFor(rightPolygon))) continue
      const leftOuter = leftPolygon[0] ?? []
      const rightOuter = rightPolygon[0] ?? []
      const leftInterior = interiorPoint([leftPolygon])
      const rightInterior = interiorPoint([rightPolygon])
      if (strictlyInsidePolygon(leftInterior, rightPolygon) || strictlyInsidePolygon(rightInterior, leftPolygon)) return true
      if (leftOuter.some(point => strictlyInsidePolygon(point, rightPolygon))) return true
      if (rightOuter.some(point => strictlyInsidePolygon(point, leftPolygon))) return true
      for (const leftRing of leftPolygon) {
        for (const rightRing of rightPolygon) {
          for (let leftIndex = 0; leftIndex < leftRing.length; leftIndex += 1) {
            for (let rightIndex = 0; rightIndex < rightRing.length; rightIndex += 1) {
              const a = leftRing[leftIndex]!
              const b = leftRing[(leftIndex + 1) % leftRing.length]!
              const c = rightRing[rightIndex]!
              const d = rightRing[(rightIndex + 1) % rightRing.length]!
              if (segmentsMayCross(a, b, c, d) && properIntersection(a, b, c, d)) return true
            }
          }
        }
      }
    }
  }
  return false
}

export function assertNoOpenCityGeometryOverlap(
  cities: readonly { readonly cityId: string; readonly polygons: readonly Polygon[] }[],
): void {
  for (let left = 0; left < cities.length; left += 1) {
    for (let right = left + 1; right < cities.length; right += 1) {
      if (polygonsOverlap(cities[left]!.polygons, cities[right]!.polygons)) {
        throw new Error(`${cities[left]!.cityId} and ${cities[right]!.cityId} have overlapping open-city geometry`)
      }
    }
  }
}

function parseLine(value: unknown, label: string): Point[] {
  if (!isRecord(value) || value.type !== 'LineString' || !Array.isArray(value.coordinates) || value.coordinates.length < 2) {
    throw new TypeError(`${label}: expected a LineString with at least two points`)
  }
  return value.coordinates.map((point, index) => {
    if (!Array.isArray(point) || typeof point[0] !== 'number' || !Number.isFinite(point[0]) || typeof point[1] !== 'number' || !Number.isFinite(point[1])) {
      throw new TypeError(`${label}.coordinates[${index}]: expected finite longitude and latitude`)
    }
    return [point[0], point[1]]
  })
}

function loadSurfaceSource(input: BuildCityGeometryInput): SurfaceSource {
  const relativePath = `scripts/geo/sources/formula/${input.cityId}-surface.geojson`
  const path = join(root, relativePath)
  if (!existsSync(path)) {
    const mode = input.offline ? 'Offline check cannot continue' : 'Generate the pinned source first'
    throw new Error(`${mode}: ${relativePath} is missing. Run scripts/geo/extract-city-osm.py with .cache/geo/nigeria-261003.osm.pbf.`)
  }
  const raw = readFileSync(path)
  const sha256 = createHash('sha256').update(raw).digest('hex')
  if (raw.length !== input.surface.bytes || sha256 !== input.surface.sha256) {
    throw new Error(`${relativePath}: expected ${input.surface.bytes} bytes and SHA-256 ${input.surface.sha256}, received ${raw.length} bytes and ${sha256}`)
  }
  const parsed: unknown = JSON.parse(raw.toString('utf8'))
  if (!isRecord(parsed) || parsed.type !== 'FeatureCollection' || !isRecord(parsed.metadata) || !Array.isArray(parsed.features)) {
    throw new TypeError(`${relativePath}: invalid feature collection`)
  }
  const metadata = parsed.metadata
  const expectedUnits = input.localUnits.map(({ id, sourceName }) => [id, sourceName])
  if (metadata.surfaceFormatVersion !== 1 || metadata.pbfUrl !== PBF.url || metadata.pbfDate !== PBF.date || metadata.pbfSha256 !== PBF.sha256 || metadata.pbfBytes !== PBF.bytes
    || metadata.boundaryRelease !== NIGERIA_BOUNDARY_RELEASE || metadata.adm1Sha256 !== NIGERIA_BOUNDARY_SOURCES.adm1.sha256
    || metadata.adm2Sha256 !== NIGERIA_BOUNDARY_SOURCES.adm2.sha256 || metadata.cityId !== input.cityId
    || metadata.stateId !== input.stateId || metadata.stateSourceName !== input.stateSourceName
    || JSON.stringify(metadata.localUnits) !== JSON.stringify(expectedUnits)) {
    throw new Error(`${relativePath}: metadata does not match the pinned city geometry request`)
  }
  const polygons: SurfacePolygonFeature[] = []
  const lines: SurfaceLineFeature[] = []
  parsed.features.forEach((feature, index) => {
    if (!isRecord(feature) || feature.type !== 'Feature' || !isRecord(feature.properties)) {
      throw new TypeError(`${relativePath}.features[${index}]: invalid feature`)
    }
    const properties = feature.properties
    if (typeof properties.kind !== 'string' || typeof properties.id !== 'string' || typeof properties.name !== 'string') {
      throw new TypeError(`${relativePath}.features[${index}]: invalid properties`)
    }
    if (properties.kind === 'state' || properties.kind === 'administrative' || properties.kind === 'land' || properties.kind === 'water') {
      if (typeof properties.localUnitId !== 'string') throw new TypeError(`${properties.id}: polygon feature needs localUnitId`)
      polygons.push({
        kind: properties.kind,
        id: properties.id,
        localUnitId: properties.localUnitId,
        name: properties.name,
        polygons: geometryPolygons(feature.geometry, `${relativePath}.features[${index}].geometry`),
      })
      return
    }
    if (properties.kind === 'road' || properties.kind === 'rail') {
      lines.push({
        kind: properties.kind,
        id: properties.id,
        name: properties.name,
        points: parseLine(feature.geometry, `${relativePath}.features[${index}].geometry`),
        major: properties.major === true,
        bridge: properties.bridge === true,
      })
      return
    }
    throw new TypeError(`${properties.id}: unsupported surface kind ${properties.kind}`)
  })
  assertUnique(polygons.map(({ id }) => id), `${relativePath} polygon ids`)
  assertUnique(lines.map(({ id }) => id), `${relativePath} line ids`)
  for (const unit of input.localUnits) {
    if (!polygons.some((feature) => feature.kind === 'administrative' && feature.localUnitId === unit.id && feature.name === unit.sourceName)) {
      throw new Error(`${relativePath}: missing pinned administrative boundary for ${unit.id}`)
    }
    if (!polygons.some((feature) => feature.kind === 'land' && feature.localUnitId === unit.id)) {
      throw new Error(`${relativePath}: missing derived land for ${unit.id}`)
    }
  }
  if (!polygons.some((feature) => feature.kind === 'state' && feature.localUnitId === input.stateId && feature.name === input.stateSourceName)) {
    throw new Error(`${relativePath}: missing pinned state boundary for ${input.stateSourceName}`)
  }
  return {
    polygons,
    lines: lines.sort((left, right) => left.id.localeCompare(right.id)),
    sha256,
    relativePath,
  }
}

function topologyText(topology: BuiltTopology, features: readonly { id: string; name: string }[]): string {
  return JSON.stringify({
    grid: topology.grid,
    arcs: topologyArcText(topology),
    features: features.map((feature) => ({ ...feature, polys: topologyPolys(topology, feature.id) })),
  })
}

function roadRows(lines: readonly SurfaceLineFeature[]): readonly (readonly (string | number)[])[] {
  return lines.filter(line => line.kind === 'road').map(line => {
    const points = line.points.map(([lon, lat]): Point => [Math.round(lon * 10_000), Math.round(lat * 10_000)])
    const first = points[0]
    if (!first) throw new Error(`${line.id}: road has no points`)
    const steps = points.slice(1).flatMap((point, index) => {
      const previous = points[index]!
      return [point[0] - previous[0], point[1] - previous[1]]
    })
    return [line.name, line.major ? 1 : 0, first[0], first[1], ...steps]
  })
}

function boundsOf(polygons: readonly Polygon[], origin: Readonly<{ x: number; z: number }>): CityGeometryBounds {
  const points = polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.map(([lon, lat]) => toLocal(origin, lon, lat))))
  if (!points.length) throw new Error('City geometry has no points')
  return Object.freeze({
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)),
    maxZ: Math.max(...points.map(([, z]) => z)),
  })
}

export function buildSelectedStateTopology(adm1: BoundaryFeatureCollection, sourceName: string, owner: string): BuiltTopology {
  const selected = adm1.features.filter(feature => feature.properties.shapeName === sourceName)
  if (selected.length !== 1) throw new Error(`${sourceName}: expected one ADM1 feature, found ${selected.length}`)
  const inputs = adm1.features.flatMap(feature => ringsFor(
    feature === selected[0] ? owner : `state:${feature.properties.shapeName}`,
    polygonsOf(feature),
  ))
  return subsetTopology(
    buildTopology(inputs, ADMIN_GRID_DEGREES, () => ADMIN_TOLERANCE_SQUARE_UNITS),
    new Set([owner]),
  )
}

function surfaceTopology(features: readonly SurfacePolygonFeature[]): BuiltTopology {
  const inputs: RingInput[] = features.flatMap((feature) => ringsFor(feature.id, feature.polygons))
  return buildTopology(inputs, SURFACE_GRID_DEGREES, () => SURFACE_TOLERANCE_SQUARE_UNITS)
}

function sourceText(input: BuildCityGeometryInput, surface: SurfaceSource): string {
  return `geoBoundaries gbOpen Nigeria ${NIGERIA_BOUNDARY_RELEASE}, GRID3 2022; Geofabrik Nigeria ${PBF.date}, OpenStreetMap contributors; derived source ${surface.relativePath}`
}

function runtimeText(args: {
  input: BuildCityGeometryInput
  stateFeatureId: string
}): string {
  const { input, stateFeatureId } = args
  return `// Generated by scripts/city/build-city.ts. Do not edit by hand.
import type { CityMapPack } from '../../../types/content.ts'
import { createFormulaCityGeometry } from '../formula/geometry.ts'
import { CITY_MAP_ORIGIN } from './geography.ts'
import { CITY_SPEC } from './spec.ts'
import {
  FORMULA_GEOMETRY_LICENCE,
  FORMULA_GEOMETRY_SOURCE,
  FORMULA_LAND,
  FORMULA_LOCAL_UNITS,
  FORMULA_RAIL,
  FORMULA_ROADS,
  FORMULA_STATE,
  FORMULA_WATER,
} from '../../../map3d/geo/data/${input.cityId}.formula.ts'

export const CITY_MAP: CityMapPack = Object.freeze({
  cityId: ${JSON.stringify(input.cityId)},
  origin: CITY_MAP_ORIGIN,
  projection: 'nigeria-equirectangular-v1',
  unitsPerKm: 10,
  localUnitIds: Object.freeze(${JSON.stringify(input.localUnits.map(({ id }) => id))}),
  stateFeatureId: ${JSON.stringify(stateFeatureId)},
  loadScene: async () => {
    const [{ city }, { createModulePack }] = await Promise.all([import('./index.ts'), import('../../../map3d/cities/module.ts')])
    const stations = CITY_SPEC.transport.rail.filter(fact => fact.status !== 'inactive').flatMap(fact => {
      const place = CITY_SPEC.places.find(candidate => candidate.id === fact.placeId)
      return place ? [{ name: place.name, lon: place.lon, lat: place.lat }] : []
    })
    return createModulePack(city, {
      spread: true,
      roads: FORMULA_ROADS,
      landmarks: CITY_SPEC.places.map(place => ({ id: place.id, name: place.name, lon: place.lon, lat: place.lat, kind: place.kind })),
      character: {
        extent: 'city',
        rails: FORMULA_RAIL.map(line => ({ name: line.name, lines: [line.points], stations })),
        notable: CITY_SPEC.places.filter(place => place.scene.landmark).map(place => place.id),
      },
    })
  },
  loadGeometry: async () => createFormulaCityGeometry({
    localUnits: FORMULA_LOCAL_UNITS,
    state: FORMULA_STATE,
    land: FORMULA_LAND,
    water: FORMULA_WATER,
    localUnitIds: ${JSON.stringify(input.localUnits.map(({ id }) => id))},
    stateFeatureId: ${JSON.stringify(stateFeatureId)},
    source: FORMULA_GEOMETRY_SOURCE,
    licence: FORMULA_GEOMETRY_LICENCE,
  }),
})
`
}

function geographyText(args: {
  origin: Readonly<{ x: number; z: number }>
  bounds: CityGeometryBounds
  anchors: Readonly<Record<string, Readonly<{ lon: number; lat: number }>>>
}): string {
  return `// Generated by scripts/city/build-city.ts. Do not edit by hand.
export const CITY_MAP_ORIGIN = Object.freeze(${JSON.stringify(args.origin)})
export const CITY_PLAY_BOUNDS = Object.freeze(${JSON.stringify(args.bounds)})
export const CITY_LOCAL_UNIT_ANCHORS = Object.freeze(${JSON.stringify(args.anchors)})
`
}

export async function buildCityGeometry(input: BuildCityGeometryInput): Promise<BuiltCityGeometry> {
  if (!idsAreSafe(input.cityId) || !idsAreSafe(input.stateId)) throw new Error('cityId and stateId must be lowercase kebab-case ids')
  if (!input.localUnits.length) throw new Error('At least one local unit is required')
  assertUnique(input.localUnits.map(({ id }) => id), 'Local unit ids')
  assertUnique(input.localUnits.map(({ sourceName }) => sourceName), 'Local unit source names')
  if (input.localUnits.some(({ id }) => !idsAreSafe(id))) throw new Error('Local unit ids must be lowercase kebab-case')
  if (!Number.isFinite(input.atlas.lon) || !Number.isFinite(input.atlas.lat)) throw new Error('Atlas longitude and latitude must be finite')

  const adm1 = await loadNigeriaBoundarySource('adm1', { offline: input.offline })
  const surface = loadSurfaceSource(input)
  const units = input.localUnits.map((unit) => ({
    ...unit,
    feature: surface.polygons.find(feature => feature.kind === 'administrative' && feature.localUnitId === unit.id),
  }))
  for (const unit of units) if (!unit.feature) throw new Error(`${surface.relativePath}: administrative boundary is missing for ${unit.id}`)
  const unitPolygons = units.map(unit => {
    if (!unit.feature) throw new Error(`${surface.relativePath}: administrative boundary is missing for ${unit.id}`)
    return { cityId: unit.id, polygons: unit.feature.polygons }
  })
  assertNoOpenCityGeometryOverlap(unitPolygons)

  for (const venue of input.venues) {
    if (!Number.isFinite(venue.lon) || !Number.isFinite(venue.lat)) throw new Error(`${venue.id}: venue longitude and latitude must be finite`)
    const owners = units.filter((unit) => unit.feature && pointInPolygons([venue.lon, venue.lat], unit.feature.polygons)).map(({ id }) => id)
    if (owners.length !== 1 || owners[0] !== venue.localUnitId) {
      throw new Error(`${venue.id}: raw ADM2 owner is ${owners.join(', ') || 'none'}, declared ${venue.localUnitId}`)
    }
  }

  for (const venue of input.venues) {
    const dryOwners = surface.polygons
      .filter(feature => feature.kind === 'land' && pointInPolygons([venue.lon, venue.lat], feature.polygons))
      .map(feature => feature.localUnitId)
    const inWater = surface.polygons.some(feature => feature.kind === 'water' && pointInPolygons([venue.lon, venue.lat], feature.polygons))
    if (inWater || dryOwners.length !== 1 || dryOwners[0] !== venue.localUnitId) {
      throw new Error(`${venue.id}: derived dry-land owner is ${dryOwners.join(', ') || 'none'}, declared ${venue.localUnitId}${inWater ? '; point is in mapped water' : ''}`)
    }
  }
  const localUnitTopology = buildTopology(
    units.flatMap((unit) => ringsFor(unit.id, unit.feature?.polygons ?? [])),
    ADMIN_GRID_DEGREES,
    () => ADMIN_TOLERANCE_SQUARE_UNITS,
  )
  const stateFeatureId = `${input.stateId}-state`
  const selectedStateTopology = buildSelectedStateTopology(adm1, input.stateSourceName, stateFeatureId)
  const builtSurface = surfaceTopology(surface.polygons.filter(feature => feature.kind === 'land' || feature.kind === 'water'))
  const landFeatures = input.localUnits.map((unit) => ({ id: unit.id, name: unit.name }))
  const landOwners = new Set(landFeatures.map(({ id }) => id))
  const waterFeatures = surface.polygons
    .filter((feature) => feature.kind === 'water')
    .map(({ id, name }) => ({ id, name }))
  const landTopology = subsetTopology(builtSurface, landOwners)
  const waterTopology = subsetTopology(builtSurface, new Set(waterFeatures.map(({ id }) => id)))
  const origin = Object.freeze(input.origin ? { ...input.origin } : originAt(input.atlas.lon, input.atlas.lat))
  const playArea = units.flatMap((unit) => unit.feature?.polygons ?? [])
  const bounds = boundsOf(playArea, origin)
  const anchors = Object.freeze(Object.fromEntries(units.map((unit) => {
    const dryLand = surface.polygons.find(feature => feature.kind === 'land' && feature.localUnitId === unit.id)
    if (!dryLand) throw new Error(`${surface.relativePath}: derived land is missing for ${unit.id}`)
    const [lon, lat] = interiorPoint(dryLand.polygons)
    return [unit.id, Object.freeze({ lon, lat })]
  })))
  const evidence: CityGeometryEvidence = Object.freeze({
    boundaryRelease: NIGERIA_BOUNDARY_RELEASE,
    adm1Sha256: NIGERIA_BOUNDARY_SOURCES.adm1.sha256,
    adm2Sha256: NIGERIA_BOUNDARY_SOURCES.adm2.sha256,
    stateSourceName: input.stateSourceName,
    localUnitSourceNames: Object.freeze(input.localUnits.map(({ sourceName }) => sourceName)),
    localUnitAreaKm2: Object.freeze(Object.fromEntries(units.map((unit) => [unit.id, Number(polygonsKm2(unit.feature?.polygons ?? []).toFixed(1))]))),
    surfaceSourcePath: surface.relativePath,
    surfaceSourceSha256: surface.sha256,
    pbfUrl: PBF.url,
    pbfDate: PBF.date,
    pbfSha256: PBF.sha256,
    pbfBytes: PBF.bytes,
  })
  const dataModuleText = `import type { RawTopo } from '../topo.ts'
import type { RoadRows } from '../../cities/module.ts'

/** Generated by scripts/city/build-city.ts. Do not edit by hand. */
export const FORMULA_LOCAL_UNITS: RawTopo = ${topologyText(localUnitTopology, input.localUnits)}
export const FORMULA_STATE: RawTopo = ${topologyText(selectedStateTopology, [{ id: stateFeatureId, name: input.stateSourceName }])}
export const FORMULA_LAND: RawTopo = ${topologyText(landTopology, landFeatures)}
export const FORMULA_WATER: RawTopo = ${topologyText(waterTopology, waterFeatures)}
export const FORMULA_ROADS: RoadRows = Object.freeze(${JSON.stringify(roadRows(surface.lines))})
export const FORMULA_RAIL: readonly { readonly id: string; readonly name: string; readonly points: readonly (readonly [number, number])[] }[] = Object.freeze(${JSON.stringify(surface.lines.filter(({ kind }) => kind === 'rail').map(({ id, name, points }) => ({ id, name, points })))})
export const FORMULA_GEOMETRY_SOURCE = ${JSON.stringify(sourceText(input, surface))}
export const FORMULA_GEOMETRY_LICENCE = 'CC BY 4.0; ODbL 1.0'
export const FORMULA_GEOMETRY_EVIDENCE = Object.freeze(${JSON.stringify(evidence)})
`
  return Object.freeze({
    origin,
    bounds,
    localUnitIds: Object.freeze(input.localUnits.map(({ id }) => id)),
    localUnitAnchors: anchors,
    stateFeatureId,
    dataModuleText,
    geographyModuleText: geographyText({ origin, bounds, anchors }),
    runtimeModuleText: runtimeText({ input, stateFeatureId }),
    evidence,
    playAreaPolygons: Object.freeze(playArea),
  })
}
