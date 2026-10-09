/**
 * Additive fictional depot apron proposal for the pinned Lagos Marina street tile.
 * This is game-authored flat support, not surveyed terrain, and never authorizes a trip.
 */
import { inspectSedanRoadFootprint, SEDAN_CLEARANCE_SOURCE } from './vehicle-clearance.ts'
import { tileGroundAt, tileKey, tileOrigin } from '../../street/frame.ts'
import type { MetrePoint, StreetTile, TileCoord } from '../../street/types.ts'

const CITY = 'lagos'
const VERSION = 'street-v1-c0dd6f6101f6f562'
const MANIFEST_SHA256 = '76cd9b6db8e79fc0c5e1be3aea193b32430a6cc9cdda694f96df8b5f1cf597c3'
const TILE: TileCoord = Object.freeze({ x: -9, z: -5 })
const TILE_SHA256 = '846c38cf8c80a2651e344b29779a3a6cd3d2246e821ffe9a01e440c4a321ab2b'
const PACK_SHA256 = 'eab52104e1de300cccc38b649ce561fb1db87e7158676ec3c705701f8e60b52a'
const ROAD_ID = 'road:lagos:15'
const ROAD_START = Object.freeze({ x: 0, z: 32.53 })
const ROAD_END = Object.freeze({ x: 128, z: 50.56 })
const ROAD_WIDTH = 8

// These stations are measured along the pinned two-point Marina centreline. The pad is on
// its +normal side, away from the four estate approaches and the generated building footprints.
const PAD_START_M = 70
const PAD_END_M = 94
const PAD_ROAD_OVERLAP_M = 0.2
const PAD_OUTER_OFFSET_M = 11.5
const PAD_PARK_STATION_M = 82
const PAD_PARK_OFFSET_M = 7.65
const SUPPORT_HEIGHT_M = 0

/** Shared immutable pins; byte/hash verification belongs to the server-only resolver. */
export const MARINA_DEPOT_SOURCE_PINS = Object.freeze({
  city: CITY,
  version: VERSION,
  manifestCanonicalSha256: MANIFEST_SHA256,
  tile: TILE,
  tileSha256: TILE_SHA256,
  packSha256: PACK_SHA256,
  roadId: ROAD_ID,
})

export interface DepotSiteDescriptor {
  readonly schemaVersion: 1
  readonly id: 'marina-fictional-depot'
  readonly provenance: 'fictional-overlay'
  readonly sourcePins: {
    readonly city: typeof CITY
    readonly version: typeof VERSION
    readonly manifestCanonicalSha256: typeof MANIFEST_SHA256
    readonly tile: Readonly<TileCoord>
    readonly tileSha256: typeof TILE_SHA256
    readonly packSha256: typeof PACK_SHA256
    readonly roadId: typeof ROAD_ID
  }
  /** All X/Z points are metres relative to the pinned tile origin. */
  readonly surface: {
    readonly kind: 'game-authored-flat-apron'
    readonly supportHeightM: 0
    readonly surface: 'fictional-practice-hardstand'
    readonly surveyedTerrain: false
    readonly polygon: readonly Readonly<MetrePoint>[]
  }
  /** Geometric vehicle-centre region for the pinned car/door envelope only; no permission or route. */
  readonly drivablePolygon: readonly Readonly<MetrePoint>[]
  readonly roadConnection: {
    readonly roadStationM: typeof PAD_PARK_STATION_M
    readonly overlapM: typeof PAD_ROAD_OVERLAP_M
    readonly centerline: readonly [Readonly<MetrePoint>, Readonly<MetrePoint>]
  }
  readonly parkingPose: { readonly center: Readonly<MetrePoint>; readonly headingRadians: number }
  readonly sedanEnvelope: {
    readonly sourceSha: string
    readonly halfWidthM: number
    readonly halfLengthM: number
    readonly sourceBodyRadiusM: number
    readonly doorSweepRadiusM: number
    readonly allHeadingCenterInsetM: number
  }
  readonly boarding: {
    readonly doorGroundAnchor: Readonly<MetrePoint>
    readonly approach: Readonly<MetrePoint>
    readonly sedanDoorSweepRadiusM: number
  }
  readonly checks: {
    readonly pinnedAsset: 'verified' | 'not-verified-by-tile-inspector'
    readonly groundMaskCoversSurfaceAndConnector: true
    readonly buildingFootprintsExcluded: true
    readonly estateApproachesExcluded: true
    readonly sourceSedanEnvelopeFitsParkingPose: true
    readonly actorVolume: 'unverified'
    readonly continuousVehicleMotion: 'unverified'
    readonly routeAuthorized: false
  }
}

interface Frame { start: MetrePoint; tangent: MetrePoint; normal: MetrePoint; length: number; heading: number }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function frame(road: StreetTile['roads'][number]): Frame | null {
  if (road.points.length !== 2) return null
  const start = road.points[0], end = road.points[1]
  if (!start || !end) return null
  const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length <= 1) return null
  const tangent = { x: dx / length, z: dz / length }
  return { start, tangent, normal: { x: -tangent.z, z: tangent.x }, length, heading: Math.atan2(dx, dz) }
}
function at(f: Frame, station: number, side: number): MetrePoint {
  return { x: f.start.x + f.tangent.x * station + f.normal.x * side, z: f.start.z + f.tangent.z * station + f.normal.z * side }
}
function project(f: Frame, p: MetrePoint): { station: number; side: number } {
  const x = p.x - f.start.x, z = p.z - f.start.z
  return { station: x * f.tangent.x + z * f.tangent.z, side: x * f.normal.x + z * f.normal.z }
}
function closePoint(a: MetrePoint, b: MetrePoint): boolean { return Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.z - b.z) < 1e-8 }
function finitePoint(p: MetrePoint): boolean { return Number.isFinite(p.x) && Number.isFinite(p.z) }

function projectRange(points: readonly MetrePoint[], axis: MetrePoint): [number, number] {
  const values = points.map(p => p.x * axis.x + p.z * axis.z)
  return [Math.min(...values), Math.max(...values)]
}
function polygonsIntersect(a: readonly MetrePoint[], b: readonly MetrePoint[]): boolean {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length]
    if (!p || !q) return true
    const axis = { x: -(q.z - p.z), z: q.x - p.x }
    const [amin, amax] = projectRange(a, axis), [bmin, bmax] = projectRange(b, axis)
    if (amax < bmin - 1e-8 || bmax < amin - 1e-8) return false
  }
  return true
}
function pointInPolygon(p: MetrePoint, polygon: readonly MetrePoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if (!a || !b) return false
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}
function pointSegmentDistance(p: MetrePoint, a: MetrePoint, b: MetrePoint): number {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz)
}
function orientation(a: MetrePoint, b: MetrePoint, c: MetrePoint): number { return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) }
function segmentsIntersect(a: MetrePoint, b: MetrePoint, c: MetrePoint, d: MetrePoint): boolean {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d), o3 = orientation(c, d, a), o4 = orientation(c, d, b)
  const on = (p: MetrePoint, q: MetrePoint, r: MetrePoint) => r.x >= Math.min(p.x, q.x) - 1e-9 && r.x <= Math.max(p.x, q.x) + 1e-9 && r.z >= Math.min(p.z, q.z) - 1e-9 && r.z <= Math.max(p.z, q.z) + 1e-9
  if ((o1 > 1e-9 && o2 < -1e-9 || o1 < -1e-9 && o2 > 1e-9) && (o3 > 1e-9 && o4 < -1e-9 || o3 < -1e-9 && o4 > 1e-9)) return true
  return Math.abs(o1) <= 1e-9 && on(a, b, c) || Math.abs(o2) <= 1e-9 && on(a, b, d) || Math.abs(o3) <= 1e-9 && on(c, d, a) || Math.abs(o4) <= 1e-9 && on(c, d, b)
}
function segmentDistance(a: MetrePoint, b: MetrePoint, c: MetrePoint, d: MetrePoint): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}
function polygonSegmentDistance(poly: readonly MetrePoint[], a: MetrePoint, b: MetrePoint): number {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return 0
  let min = Infinity
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    if (!p || !q) return 0
    min = Math.min(min, segmentDistance(a, b, p, q))
  }
  return min
}
function polygonDistance(a: readonly MetrePoint[], b: readonly MetrePoint[]): number {
  if (polygonsIntersect(a, b)) return 0
  let min = Infinity
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const a0 = a[i], a1 = a[(i + 1) % a.length], b0 = b[j], b1 = b[(j + 1) % b.length]
    if (!a0 || !a1 || !b0 || !b1) return 0
    min = Math.min(min, segmentDistance(a0, a1, b0, b1))
  }
  return min
}
function validConvexPolygon(points: readonly MetrePoint[]): boolean {
  if (points.length < 3 || points.length > 64 || points.some((p, i) => !finitePoint(p) || closePoint(p, points[(i + 1) % points.length]!))) return false
  let sign = 0, area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!, c = points[(i + 2) % points.length]!
    const turn = orientation(a, b, c)
    if (Math.abs(turn) > 1e-8) { const nextSign = Math.sign(turn); if (sign && sign !== nextSign) return false; sign = nextSign }
    area += a.x * b.z - b.x * a.z
  }
  return sign !== 0 && Math.abs(area) > 1e-8
}
function squareIntersectsPolygon(square: readonly MetrePoint[], polygon: readonly MetrePoint[]): boolean { return polygonsIntersect(square, polygon) }
/** Every 2 m mask cell touching the requested convex support area must be present. */
function groundCovers(tile: StreetTile, polygon: readonly MetrePoint[]): boolean {
  const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x))
  const minZ = Math.min(...polygon.map(p => p.z)), maxZ = Math.max(...polygon.map(p => p.z))
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX < 0 || minZ < 0 || maxX > 128 || maxZ > 128) return false
  const firstCol = Math.max(0, Math.floor(minX / 2)), lastCol = Math.min(63, Math.floor(maxX / 2))
  const firstRow = Math.max(0, Math.floor(minZ / 2)), lastRow = Math.min(63, Math.floor(maxZ / 2))
  for (let row = firstRow; row <= lastRow; row++) for (let col = firstCol; col <= lastCol; col++) {
    const cell = [{ x: col * 2, z: row * 2 }, { x: col * 2 + 2, z: row * 2 }, { x: col * 2 + 2, z: row * 2 + 2 }, { x: col * 2, z: row * 2 + 2 }]
    if (squareIntersectsPolygon(cell, polygon) && !tileGroundAt(tile, { x: col * 2 + 1, z: row * 2 + 1 })) return false
  }
  return true
}
function freezePolygon(points: readonly MetrePoint[]): readonly Readonly<MetrePoint>[] { return Object.freeze(points.map(p => Object.freeze({ ...p }))) }
function validTileIdentity(tile: StreetTile): boolean {
  const origin = tileOrigin(TILE)
  return tile.city === CITY && tile.version === VERSION && tile.tile.x === TILE.x && tile.tile.z === TILE.z
    && closePoint(tile.origin, origin) && tile.ground instanceof Uint32Array && tile.ground.length === 128
}

/**
 * Pure geometry check for a tile already returned by the immutable street-asset reader.
 * It does not verify file hashes itself and deliberately returns routeAuthorized:false.
 */
export function inspectPinnedMarinaDepotTile(tile: StreetTile): DepotSiteDescriptor | null {
  try {
    if (!validTileIdentity(tile)) return null
    const roads = tile.roads.filter(road => road.id === ROAD_ID)
    if (roads.length !== 1) return null
    const road = roads[0]
    if (!road || road.name !== 'Marina' || road.source !== 'authored' || road.width !== ROAD_WIDTH || road.bridge) return null
    const f = frame(road)
    if (!f || !closePoint(road.points[0]!, ROAD_START) || !closePoint(road.points[1]!, ROAD_END)) return null

    const surface = [at(f, PAD_START_M, ROAD_WIDTH / 2 - PAD_ROAD_OVERLAP_M), at(f, PAD_END_M, ROAD_WIDTH / 2 - PAD_ROAD_OVERLAP_M), at(f, PAD_END_M, PAD_OUTER_OFFSET_M), at(f, PAD_START_M, PAD_OUTER_OFFSET_M)]
    const park = at(f, PAD_PARK_STATION_M, PAD_PARK_OFFSET_M)
    const origin = tileOrigin(TILE)
    const inspection = inspectSedanRoadFootprint({
      provenance: SEDAN_CLEARANCE_SOURCE,
      road: { start: { x: ROAD_START.x + origin.x, z: ROAD_START.z + origin.z }, end: { x: ROAD_END.x + origin.x, z: ROAD_END.z + origin.z }, width: ROAD_WIDTH, edgeMargin: 0.4 },
      vehicle: { center: { x: park.x + origin.x, z: park.z + origin.z }, headingRadians: f.heading }, atMs: 0,
    })
    const shape = inspection.geometry
    if (inspection.code !== 'ok' || !shape) return null
    // A circle around the car bounds its complete body rectangle in every heading. Adding the
    // pinned door-sweep radius conservatively bounds the hinged door around any point in the pad.
    const bodyRadius = Math.hypot(shape.vehicleHalfWidth, shape.vehicleHalfLength)
    const centerInset = bodyRadius + shape.doorSweepRadius
    const startN = ROAD_WIDTH / 2 - PAD_ROAD_OVERLAP_M, endN = PAD_OUTER_OFFSET_M
    const centerPoly = [at(f, PAD_START_M + centerInset, startN + centerInset), at(f, PAD_END_M - centerInset, startN + centerInset), at(f, PAD_END_M - centerInset, endN - centerInset), at(f, PAD_START_M + centerInset, endN - centerInset)]
    if (endN - startN <= centerInset * 2 || PAD_END_M - PAD_START_M <= centerInset * 2) return null
    const parkFrame = project(f, park)
    if (parkFrame.station < PAD_START_M + centerInset || parkFrame.station > PAD_END_M - centerInset
      || parkFrame.side < startN + centerInset || parkFrame.side > endN - centerInset) return null

    // Check the apron and the vehicle-sized straight connector from the existing road surface.
    const connector = [at(f, PAD_PARK_STATION_M - centerInset, -centerInset), at(f, PAD_PARK_STATION_M + centerInset, -centerInset), at(f, PAD_PARK_STATION_M + centerInset, PAD_PARK_OFFSET_M + centerInset), at(f, PAD_PARK_STATION_M - centerInset, PAD_PARK_OFFSET_M + centerInset)]
    if (!groundCovers(tile, surface) || !groundCovers(tile, connector)) return null
    for (const building of tile.buildings) {
      if (!validConvexPolygon(building.footprint)) return null
      if (polygonDistance(surface, building.footprint) < centerInset || polygonDistance(connector, building.footprint) < 0.05) return null
      if (polygonsIntersect(centerPoly, building.footprint)) return null
    }
    for (const door of tile.doors) {
      if (!finitePoint(door.at) || !finitePoint(door.approach)) return null
      if (polygonSegmentDistance(surface, door.at, door.approach) < centerInset || polygonSegmentDistance(connector, door.at, door.approach) < 0.05) return null
    }
    if (tile.roads.some(other => other.id !== ROAD_ID && other.points.some((p, i) => i > 0 && polygonSegmentDistance(surface, other.points[i - 1]!, p) <= other.width / 2))) return null

    const boardingAnchor = { x: shape.closedDoorGroundAnchor.x - origin.x, z: shape.closedDoorGroundAnchor.z - origin.z }
    const boardingApproach = { x: shape.boardingApproach.x - origin.x, z: shape.boardingApproach.z - origin.z }
    const anchorProjection = project(f, boardingAnchor)
    const approachProjection = project(f, boardingApproach)
    if (![anchorProjection.station, anchorProjection.side, approachProjection.station, approachProjection.side].every(Number.isFinite)
      || anchorProjection.station < PAD_START_M || anchorProjection.station > PAD_END_M || anchorProjection.side < startN || anchorProjection.side > endN
      || approachProjection.station < PAD_START_M || approachProjection.station > PAD_END_M || approachProjection.side < startN || approachProjection.side > endN) return null

    const local = (p: MetrePoint): MetrePoint => ({ x: p.x, z: p.z })
    const parking = Object.freeze({ center: Object.freeze(local(park)), headingRadians: f.heading })
    const connectorStart = at(f, PAD_PARK_STATION_M, 0)
    return Object.freeze({
      schemaVersion: 1, id: 'marina-fictional-depot', provenance: 'fictional-overlay',
      sourcePins: Object.freeze({ city: CITY, version: VERSION, manifestCanonicalSha256: MANIFEST_SHA256, tile: Object.freeze({ ...TILE }), tileSha256: TILE_SHA256, packSha256: PACK_SHA256, roadId: ROAD_ID }),
      surface: Object.freeze({ kind: 'game-authored-flat-apron', supportHeightM: SUPPORT_HEIGHT_M, surface: 'fictional-practice-hardstand', surveyedTerrain: false, polygon: freezePolygon(surface) }),
      drivablePolygon: freezePolygon(centerPoly),
      roadConnection: Object.freeze({ roadStationM: PAD_PARK_STATION_M, overlapM: PAD_ROAD_OVERLAP_M, centerline: Object.freeze([Object.freeze(connectorStart), Object.freeze(park)]) as readonly [Readonly<MetrePoint>, Readonly<MetrePoint>] }),
      parkingPose: parking,
      sedanEnvelope: Object.freeze({ sourceSha: SEDAN_CLEARANCE_SOURCE.sourceSha, halfWidthM: shape.vehicleHalfWidth, halfLengthM: shape.vehicleHalfLength, sourceBodyRadiusM: bodyRadius, doorSweepRadiusM: shape.doorSweepRadius, allHeadingCenterInsetM: centerInset }),
      boarding: Object.freeze({ doorGroundAnchor: Object.freeze(boardingAnchor), approach: Object.freeze(boardingApproach), sedanDoorSweepRadiusM: shape.doorSweepRadius }),
      checks: Object.freeze({ pinnedAsset: 'not-verified-by-tile-inspector', groundMaskCoversSurfaceAndConnector: true, buildingFootprintsExcluded: true, estateApproachesExcluded: true, sourceSedanEnvelopeFitsParkingPose: true, actorVolume: 'unverified', continuousVehicleMotion: 'unverified', routeAuthorized: false }),
    })
  } catch { return null }
}
