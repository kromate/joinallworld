/**
 * Geometry-only follow-up for the fictional Marina depot proposal. This checks conservative
 * swept envelopes on the pinned coarse street mask; it is not collision-engine or route authority.
 */
import { MARINA_DEPOT_SOURCE_PINS } from './depot-site.ts'
import type { DepotSiteDescriptor } from './depot-site.ts'
import { SEDAN_CLEARANCE_SOURCE } from './vehicle-clearance.ts'
import type { MetrePoint, StreetTile } from '../../street/types.ts'
import { tileGroundAt, tileOrigin } from '../../street/frame.ts'

const CITY = MARINA_DEPOT_SOURCE_PINS.city
const VERSION = MARINA_DEPOT_SOURCE_PINS.version
const ROAD_ID = MARINA_DEPOT_SOURCE_PINS.roadId
const TILE = MARINA_DEPOT_SOURCE_PINS.tile
const WHEELBASE_M = 2.6 // driving.ts bicycle model
const MAX_WHEEL_ANGLE = 0.62 // driving.ts and sedan visual steering share this limit
const ROAD_EDGE_MARGIN_M = 0.4 // vehicle-clearance.ts diagnostic margin
const ACTOR_RADIUS_ASSUMPTION_M = 0.8
const ACTOR_HEIGHT_ASSUMPTION_M = 2.1
const MAX_ARC_CHORD_ANGLE = 0.05
const MAX_CHORDS = 64
const EPS = 1e-7

export type MotionReason = 'ok' | 'invalid_site_or_tile' | 'invalid_road_connection' | 'turning_path_unreachable'
  | 'outside_authored_support' | 'missing_ground_cell' | 'building_clearance' | 'estate_approach_clearance' | 'other_road_clearance'

export interface DepotMotionReport {
  readonly siteId: 'marina-fictional-depot'
  readonly routeAuthorized: false
  /** This sync inspector consumes a caller-provided decoded tile; it does not rehash it. */
  readonly evidence: 'caller-provided-tile-not-rehashed'
  readonly vehicle: {
    /** The exact candidate bicycle-model S-bend swept by a conservative circular sedan envelope. */
    readonly candidatePath: readonly Readonly<MetrePoint>[]
    readonly candidateRadiusM: number
    readonly candidateMaskAndStaticObstacles: 'clear' | 'blocked'
    readonly reason: MotionReason
    /** Height/support continuity and live controller collision still have no authority contract. */
    readonly integration: 'unverified'
  }
  readonly actor: {
    readonly approach: readonly [Readonly<MetrePoint>, Readonly<MetrePoint>]
    readonly assumedRadiusM: number
    readonly assumedHeightM: number
    readonly candidateMaskAndStaticObstacles: 'clear' | 'blocked'
    readonly reason: MotionReason
    /** StandIn exposes no collision capsule or door-contact API; clear here is only a proposal. */
    readonly integration: 'unverified'
  }
  readonly remainingProof: readonly ['actor_model_bounds_and_door_contact', 'terrain_height_continuity', 'live_controller_and_collision_integration']
}

interface Frame { origin: MetrePoint; tangent: MetrePoint; normal: MetrePoint; heading: number; length: number }
interface Chord { a: MetrePoint; b: MetrePoint; sagitta: number }
const finitePoint = (p: unknown): p is MetrePoint => !!p && typeof p === 'object' && Number.isFinite((p as MetrePoint).x) && Number.isFinite((p as MetrePoint).z)
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const distance = (a: MetrePoint, b: MetrePoint) => Math.hypot(a.x - b.x, a.z - b.z)
const cross = (a: MetrePoint, b: MetrePoint, c: MetrePoint) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)

function frame(tile: StreetTile): Frame | null {
  const roads = tile.roads.filter(road => road.id === ROAD_ID)
  if (roads.length !== 1) return null
  const road = roads[0]!
  if (road.source !== 'authored' || road.name !== 'Marina' || road.bridge || road.width !== 8 || road.points.length !== 2) return null
  const [origin, end] = road.points
  if (!origin || !end || !finitePoint(origin) || !finitePoint(end)) return null
  const dx = end.x - origin.x, dz = end.z - origin.z, length = Math.hypot(dx, dz)
  if (length < 100 || length > 130) return null
  const tangent = { x: dx / length, z: dz / length }
  return { origin, tangent, normal: { x: -tangent.z, z: tangent.x }, heading: Math.atan2(dx, dz), length }
}

function project(point: MetrePoint, f: Frame): { station: number; side: number } {
  const dx = point.x - f.origin.x, dz = point.z - f.origin.z
  return { station: dx * f.tangent.x + dz * f.tangent.z, side: dx * f.normal.x + dz * f.normal.z }
}
/** Produce a forward S-turn using the lesson's bicycle radius; points are only chord endpoints. */
function candidateSturn(start: MetrePoint, heading: number, startSide: number, targetSide: number, radius: number): Chord[] | null {
  const drop = startSide - targetSide
  if (!(drop > 0) || drop >= 2 * radius) return null
  const theta = Math.acos(1 - drop / (2 * radius))
  const pieces = Math.ceil(theta / MAX_ARC_CHORD_ANGLE)
  if (pieces < 1 || pieces * 2 > MAX_CHORDS) return null
  const curvature = 1 / radius
  let point = { ...start }, angle = heading
  const chords: Chord[] = []
  for (const sign of [1, -1]) {
    let before = { ...point }
    for (let i = 1; i <= pieces; i++) {
      const nextAngle = angle + sign * theta / pieces
      // Integrate dx/ds=sin(heading), dz/ds=cos(heading) exactly on a circular arc.
      point = {
        x: point.x + (Math.cos(angle) - Math.cos(nextAngle)) / (sign * curvature),
        z: point.z + (Math.sin(nextAngle) - Math.sin(angle)) / (sign * curvature),
      }
      const delta = theta / pieces
      const sagitta = radius * (1 - Math.cos(delta / 2))
      chords.push({ a: before, b: point, sagitta })
      angle = nextAngle
      before = { ...point }
    }
  }
  return chords
}

function pointSegmentDistance(p: MetrePoint, a: MetrePoint, b: MetrePoint): number {
  const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz
  const t = len2 > EPS ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz)
}
function segmentsIntersect(a: MetrePoint, b: MetrePoint, c: MetrePoint, d: MetrePoint): boolean {
  const ab1 = cross(a, b, c), ab2 = cross(a, b, d), cd1 = cross(c, d, a), cd2 = cross(c, d, b)
  return ((ab1 > EPS && ab2 < -EPS) || (ab1 < -EPS && ab2 > EPS))
    && ((cd1 > EPS && cd2 < -EPS) || (cd1 < -EPS && cd2 > EPS))
}
function segmentDistance(a: MetrePoint, b: MetrePoint, c: MetrePoint, d: MetrePoint): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}
function pointInPolygon(p: MetrePoint, polygon: readonly MetrePoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}
function segmentPolygonDistance(a: MetrePoint, b: MetrePoint, polygon: readonly MetrePoint[]): number {
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return 0
  let best = Infinity
  for (let i = 0; i < polygon.length; i++) best = Math.min(best, segmentDistance(a, b, polygon[i]!, polygon[(i + 1) % polygon.length]!))
  return best
}
function pointSquareDistance(p: MetrePoint, x0: number, z0: number, x1: number, z1: number): number {
  return Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(z0 - p.z, 0, p.z - z1))
}
function segmentSquareDistance(a: MetrePoint, b: MetrePoint, x0: number, z0: number, x1: number, z1: number): number {
  if (pointSquareDistance(a, x0, z0, x1, z1) === 0 || pointSquareDistance(b, x0, z0, x1, z1) === 0) return 0
  const corners = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }]
  let best = Infinity
  for (let i = 0; i < 4; i++) best = Math.min(best, segmentDistance(a, b, corners[i]!, corners[(i + 1) % 4]!))
  return best
}
/** Test the whole segment capsule against every 2 m cell it touches; no point sampling. */
function groundCoversCapsule(tile: StreetTile, chord: Chord, radius: number): boolean {
  const minX = Math.min(chord.a.x, chord.b.x) - radius, maxX = Math.max(chord.a.x, chord.b.x) + radius
  const minZ = Math.min(chord.a.z, chord.b.z) - radius, maxZ = Math.max(chord.a.z, chord.b.z) + radius
  if (minX < 0 || minZ < 0 || maxX > 128 || maxZ > 128) return false
  const c0 = Math.floor(minX / 2), c1 = Math.floor(maxX / 2), r0 = Math.floor(minZ / 2), r1 = Math.floor(maxZ / 2)
  for (let row = r0; row <= Math.min(63, r1); row++) for (let col = c0; col <= Math.min(63, c1); col++) {
    if (segmentSquareDistance(chord.a, chord.b, col * 2, row * 2, col * 2 + 2, row * 2 + 2) <= radius + EPS
      && !tileGroundAt(tile, { x: col * 2 + 1, z: row * 2 + 1 })) return false
  }
  return true
}
function obstaclesClear(tile: StreetTile, chords: readonly Chord[], radius: number, ignoredRoadId?: string): MotionReason {
  for (const chord of chords) {
    const expanded = radius + chord.sagitta + 0.01
    for (const building of tile.buildings) {
      if (building.footprint.length < 3 || building.footprint.some(p => !finitePoint(p))) return 'invalid_site_or_tile'
      if (segmentPolygonDistance(chord.a, chord.b, building.footprint) <= expanded) return 'building_clearance'
    }
    for (const door of tile.doors) {
      if (!finitePoint(door.at) || !finitePoint(door.approach)) return 'invalid_site_or_tile'
      if (segmentDistance(chord.a, chord.b, door.at, door.approach) <= expanded) return 'estate_approach_clearance'
    }
    for (const road of tile.roads) {
      if (!Number.isFinite(road.width) || road.width <= 0 || !Array.isArray(road.points) || road.points.some(p => !finitePoint(p))) return 'invalid_site_or_tile'
      if (road.id === ignoredRoadId) continue
      for (let i = 1; i < road.points.length; i++) {
        if (segmentDistance(chord.a, chord.b, road.points[i - 1]!, road.points[i]!) <= expanded + road.width / 2) return 'other_road_clearance'
      }
    }
  }
  return 'ok'
}
function supportBounds(chords: readonly Chord[], radius: number, site: DepotSiteDescriptor, f: Frame, roadWidth: number): boolean {
  const pad = site.surface.polygon.map(p => project(p, f))
  if (pad.length !== 4 || !pad.every(p => Number.isFinite(p.station) && Number.isFinite(p.side))) return false
  const minStation = Math.min(...pad.map(p => p.station)), maxStation = Math.max(...pad.map(p => p.station))
  const padLow = Math.min(...pad.map(p => p.side)), padHigh = Math.max(...pad.map(p => p.side))
  if (Math.max(-roadWidth / 2, padLow) > Math.min(roadWidth / 2, padHigh) + EPS) return false
  const minSide = Math.min(-roadWidth / 2, padLow), maxSide = Math.max(roadWidth / 2, padHigh)
  return chords.every(chord => {
    const a = project(chord.a, f), b = project(chord.b, f), r = radius + chord.sagitta + 0.01
    return Math.min(a.station, b.station) - r >= minStation - EPS && Math.max(a.station, b.station) + r <= maxStation + EPS
      && Math.min(a.side, b.side) - r >= minSide - EPS && Math.max(a.side, b.side) + r <= maxSide + EPS
  })
}
function capsuleInsideConvexPolygon(a: MetrePoint, b: MetrePoint, radius: number, polygon: readonly MetrePoint[]): boolean {
  if (polygon.length < 3 || polygon.length > 64 || polygon.some(p => !finitePoint(p))) return false
  let area = 0
  for (let i = 0; i < polygon.length; i++) area += polygon[i]!.x * polygon[(i + 1) % polygon.length]!.z - polygon[(i + 1) % polygon.length]!.x * polygon[i]!.z
  if (Math.abs(area) < EPS) return false
  const orientation = Math.sign(area)
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!, q = polygon[(i + 1) % polygon.length]!, length = distance(p, q)
    if (length < EPS) return false
    // Convex half-plane distance is linear along the center segment; both endpoints >= radius
    // therefore prove that its entire radius-thick capsule remains inside the polygon.
    const clearance = (point: MetrePoint) => orientation * cross(p, q, point) / length
    if (clearance(a) < radius - EPS || clearance(b) < radius - EPS) return false
  }
  return true
}
function validSite(value: unknown): value is DepotSiteDescriptor {
  try {
    if (!record(value) || value.id !== 'marina-fictional-depot' || value.schemaVersion !== 1 || value.provenance !== 'fictional-overlay'
      || !record(value.sourcePins) || !record(value.checks) || !record(value.surface) || !record(value.sedanEnvelope)
      || !record(value.boarding) || !record(value.parkingPose) || !record(value.roadConnection)) return false
    const pins = value.sourcePins, checks = value.checks, surface = value.surface, envelope = value.sedanEnvelope
    const boarding = value.boarding, parking = value.parkingPose, connection = value.roadConnection
    return pins.city === CITY && pins.version === VERSION && pins.roadId === ROAD_ID && record(pins.tile)
      && pins.tile.x === TILE.x && pins.tile.z === TILE.z
      && checks.pinnedAsset === 'verified' && checks.routeAuthorized === false && checks.actorVolume === 'unverified' && checks.continuousVehicleMotion === 'unverified'
      && surface.kind === 'game-authored-flat-apron' && surface.supportHeightM === 0 && surface.surface === 'fictional-practice-hardstand'
      && surface.surveyedTerrain === false && Array.isArray(surface.polygon) && surface.polygon.length === 4 && surface.polygon.every(finitePoint)
      && envelope.sourceSha === SEDAN_CLEARANCE_SOURCE.sourceSha && Number.isFinite(envelope.halfWidthM) && Number(envelope.halfWidthM) > 0
      && Number.isFinite(envelope.halfLengthM) && Number(envelope.halfLengthM) > 0
      && Math.abs(Number(envelope.sourceBodyRadiusM) - Math.hypot(Number(envelope.halfWidthM), Number(envelope.halfLengthM))) <= 0.002
      && finitePoint(boarding.approach) && finitePoint(boarding.doorGroundAnchor)
      && finitePoint(parking.center) && Number.isFinite(parking.headingRadians)
      && Array.isArray(connection.centerline) && connection.centerline.length === 2 && connection.centerline.every(finitePoint)
  } catch { return false }
}
function validTile(value: unknown): value is StreetTile {
  try {
    return record(value) && value.city === CITY && value.version === VERSION
      && record(value.tile) && value.tile.x === TILE.x && value.tile.z === TILE.z
      && finitePoint(value.origin) && value.origin.x === tileOrigin(TILE).x && value.origin.z === tileOrigin(TILE).z
      && value.ground instanceof Uint32Array && value.ground.length === 128
      && Array.isArray(value.roads) && Array.isArray(value.buildings) && Array.isArray(value.doors)
  } catch { return false }
}
function report(site: unknown, vehiclePath: readonly MetrePoint[], vehicleReason: MotionReason, actorReason: MotionReason): DepotMotionReport {
  const actorBlocked = actorReason !== 'ok'
  let safeBoarding: Record<string, unknown> | null = null, envelope: Record<string, unknown> | null = null
  try {
    if (record(site) && record(site.boarding)) safeBoarding = site.boarding
    if (record(site) && record(site.sedanEnvelope)) envelope = site.sedanEnvelope
  } catch { /* malformed accessors stay fail-closed */ }
  const safePoint = (point: unknown): MetrePoint => {
    try { return finitePoint(point) ? { x: point.x, z: point.z } : { x: 0, z: 0 } }
    catch { return { x: 0, z: 0 } }
  }
  const approach = [Object.freeze(safePoint(safeBoarding?.approach)), Object.freeze(safePoint(safeBoarding?.doorGroundAnchor))] as const
  let candidateRadiusM = 0
  try { if (envelope && typeof envelope.sourceBodyRadiusM === 'number' && Number.isFinite(envelope.sourceBodyRadiusM)) candidateRadiusM = envelope.sourceBodyRadiusM } catch { /* safe default */ }
  return Object.freeze({
    siteId: 'marina-fictional-depot', routeAuthorized: false, evidence: 'caller-provided-tile-not-rehashed',
    vehicle: Object.freeze({ candidatePath: Object.freeze(vehiclePath.map(p => Object.freeze({ ...p }))), candidateRadiusM,
      candidateMaskAndStaticObstacles: vehicleReason === 'ok' ? 'clear' : 'blocked', reason: vehicleReason, integration: 'unverified' }),
    actor: Object.freeze({ approach: Object.freeze(approach),
      assumedRadiusM: ACTOR_RADIUS_ASSUMPTION_M, assumedHeightM: ACTOR_HEIGHT_ASSUMPTION_M,
      candidateMaskAndStaticObstacles: actorBlocked ? 'blocked' : 'clear', reason: actorReason, integration: 'unverified' }),
    remainingProof: Object.freeze(['actor_model_bounds_and_door_contact', 'terrain_height_continuity', 'live_controller_and_collision_integration'] as const),
  })
}

/**
 * Diagnose a forward max-steer S-bend from the apron onto the pinned ground road. The chord
 * capsules expanded by circular-arc sagitta conservatively enclose the entire continuous path.
 * A clear result is still proposal-only: the actual server lesson and renderer do not consume it.
 */
export function inspectMarinaDepotMotion(siteValue: unknown, tileValue: unknown): DepotMotionReport {
  const none: readonly MetrePoint[] = []
  if (!validSite(siteValue) || !validTile(tileValue)) return report(siteValue, none, 'invalid_site_or_tile', 'invalid_site_or_tile')
  const site = siteValue
  const tile = tileValue
  try {
    if (tile.city !== CITY || tile.version !== VERSION || tile.tile.x !== TILE.x || tile.tile.z !== TILE.z
      || tile.origin.x !== tileOrigin(TILE).x || tile.origin.z !== tileOrigin(TILE).z
      || !(tile.ground instanceof Uint32Array) || tile.ground.length !== 128
      || !Array.isArray(tile.roads) || !Array.isArray(tile.buildings) || !Array.isArray(tile.doors)) {
      return report(site, none, 'invalid_site_or_tile', 'invalid_site_or_tile')
    }
    const f = frame(tile)
    if (!f) return report(site, none, 'invalid_road_connection', 'invalid_site_or_tile')
    const road = tile.roads.find(value => value.id === ROAD_ID)!
    const park = site.parkingPose.center, centerlineRoad = site.roadConnection.centerline[0]
    if (![park, centerlineRoad, site.boarding.approach, site.boarding.doorGroundAnchor].every(finitePoint)
      || Math.abs(site.parkingPose.headingRadians - f.heading) > 1e-6
      || Math.abs(project(centerlineRoad, f).side) > 0.02
      || project(centerlineRoad, f).station < 0 || project(centerlineRoad, f).station > f.length
      || distance(site.roadConnection.centerline[1], park) > 0.02) {
      return report(site, none, 'invalid_road_connection', 'invalid_site_or_tile')
    }
    const bodyRadius = site.sedanEnvelope.sourceBodyRadiusM
    const start = project(park, f), targetSide = road.width / 2 - bodyRadius - ROAD_EDGE_MARGIN_M
    const turningRadius = WHEELBASE_M / Math.tan(MAX_WHEEL_ANGLE)
    const chords = candidateSturn(park, f.heading, start.side, targetSide, turningRadius)
    if (!chords) return report(site, none, 'turning_path_unreachable', 'invalid_site_or_tile')
    const path = [chords[0]!.a, ...chords.map(chord => chord.b)]
    let vehicleReason: MotionReason = 'ok'
    if (!supportBounds(chords, bodyRadius, site, f, road.width)) vehicleReason = 'outside_authored_support'
    else if (!chords.every(chord => groundCoversCapsule(tile, chord, bodyRadius + chord.sagitta + 0.01))) vehicleReason = 'missing_ground_cell'
    else vehicleReason = obstaclesClear(tile, chords, bodyRadius, ROAD_ID)

    const actorChord: Chord = { a: site.boarding.approach, b: site.boarding.doorGroundAnchor, sagitta: 0 }
    let actorReason: MotionReason = 'ok'
    if (distance(actorChord.a, actorChord.b) < 0.1 || distance(actorChord.a, actorChord.b) > 4) actorReason = 'invalid_road_connection'
    else if (!capsuleInsideConvexPolygon(actorChord.a, actorChord.b, ACTOR_RADIUS_ASSUMPTION_M, site.surface.polygon)) actorReason = 'outside_authored_support'
    else if (!groundCoversCapsule(tile, actorChord, ACTOR_RADIUS_ASSUMPTION_M)) actorReason = 'missing_ground_cell'
    else actorReason = obstaclesClear(tile, [actorChord], ACTOR_RADIUS_ASSUMPTION_M)
    return report(site, path, vehicleReason, actorReason)
  } catch { return report(site, none, 'invalid_site_or_tile', 'invalid_site_or_tile') }
}
