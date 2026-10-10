/**
 * Conservative, static sedan footprint diagnostics for the authored map-detail model.
 * This module never authorizes a route: terrain, actor volume, building/access, yielding,
 * crossings, and continuous vehicle motion still require independent evidence.
 */

export const SEDAN_CLEARANCE_SOURCE = Object.freeze({
  sourceSha: 'dc4fb360c5bfadf2093f3f6c932be82ef7e84cdf',
  model: 'sedan',
  detail: 'map',
  sourceHashes: Object.freeze({
    'src/models/vehicles/sedan-interior.ts': '3d9a5b3a516031fb7b6e14058a3d3c2615a3f531a38b56781d2f4a66bf8b0a57',
    'src/models/vehicles/index.ts': '7db039a0b25373a86354639fd703a96aab3a3de48a3088c14c555cc0fa6afc19',
    'src/models/vehicles/geometry.ts': '4bf847bd17a735050daa4686ed0be495c64a7936ed3c65c6e306e740edc94885',
    'src/app/features/living-world/drivingScene.ts': 'f7dedaecc5be14ba2088a3884cbd234c6c2beefcd9669695974598d270df34b0',
  }),
})

export interface ClearancePoint { x: number; z: number }
export interface RoadSegment { start: ClearancePoint; end: ClearancePoint; width: number; edgeMargin: number }
export interface VehiclePose { center: ClearancePoint; headingRadians: number }

/** Caller-supplied dimensions are diagnostic only; no trusted player capsule source is approved. */
export interface UnverifiedActorCapsule { radius: number; halfHeight: number; evidenceRef: string }

export interface ClearanceInput {
  provenance: unknown
  road: RoadSegment
  vehicle: VehiclePose
  /** Safe timestamp for the inspected pose only; it proves no motion interval. */
  atMs: number
  actorCapsule?: unknown
}

export interface FootprintFit {
  fits: boolean
  across: { min: number; max: number }
  along: { min: number; max: number }
}

export interface VehicleClearanceResult {
  routeAuthorized: false
  code: 'ok' | 'unsupported_provenance' | 'invalid_geometry' | 'invalid_time' | 'invalid_actor_capsule'
  inspectedAtMs: number | null
  scopes: {
    closedVehicleOnRoad: FootprintFit | null
    fullDoorSweepOnRoad: FootprintFit | null
    boardingCenterlineOnRoad: FootprintFit | null
    actorVolume: 'unverified'
  }
  depotApron: 'unverified'
  missingProof: readonly ['actor_volume', 'terrain', 'depot_apron', 'buildings_and_access', 'yielding', 'crossings', 'continuous_motion']
  geometry: {
    vehicleHalfWidth: number
    vehicleHalfLength: number
    doorSweepRadius: number
    boardingApproach: ClearancePoint
    closedDoorGroundAnchor: ClearancePoint
  } | null
}

const MISSING_PROOF = Object.freeze(['actor_volume', 'terrain', 'depot_apron', 'buildings_and_access', 'yielding', 'crossings', 'continuous_motion'] as const)
const BODY_HALF_WIDTH = 1.032
const BODY_HALF_LENGTH = 2.245
// The authored 1.9 × 4.35 sedan places wheel centers at x=±0.912 and
// z=1.395/-1.435. Their radius is .37 and axial half-width is .12.
const WHEEL_CENTER_X = 0.912
const WHEEL_RADIUS = 0.37
const WHEEL_HALF_WIDTH = 0.12
const WHEEL_CENTER_Z_MAX = 1.435
const HINGE = { x: -0.96, z: 0.89 } as const
// splitCarDoorPanels clips sedan geometry to x[-width/2-.12,-width/2+.06] and z[-.05,.89].
// At width 1.9 that is x[-1.07,-.89]; use the whole clipping box, not a smaller observed mesh AABB.
const DOOR_BOUNDS = { minX: -1.07, maxX: -0.89, minZ: -0.05, maxZ: 0.89 } as const
const BOARDING_APPROACH = { x: -2.46, z: 0.42 } as const
const DOOR_GROUND_ANCHOR = { x: -0.96, z: 0.42 } as const
const MAX_COORDINATE = 100_000

// A sphere enclosing a wheel cylinder also encloses every steering and spin orientation.
// The body evidence is x±1.032, z[-2.2375,2.245]; the derived wheel spheres are smaller
// longitudinally, so the conservative union is x±1.302, z±2.246 after rounding allowance.
const wheelSphereRadius = Math.hypot(WHEEL_RADIUS, WHEEL_HALF_WIDTH)
const roundedEnvelope = (extent: number): number => (Math.ceil(extent * 1000) + 1) / 1000
const VEHICLE_HALF_WIDTH = roundedEnvelope(Math.max(BODY_HALF_WIDTH, WHEEL_CENTER_X + wheelSphereRadius))
const VEHICLE_HALF_LENGTH = roundedEnvelope(Math.max(BODY_HALF_LENGTH, WHEEL_CENTER_Z_MAX + wheelSphereRadius))

// Relative to the front hinge (-.96,.89), the full clip box gives radii .11 and .94.
// A disk around that hinge encloses every point throughout every intervening door angle.
const doorXRadius = Math.max(Math.abs(DOOR_BOUNDS.minX - HINGE.x), Math.abs(DOOR_BOUNDS.maxX - HINGE.x))
const doorZRadius = Math.max(Math.abs(DOOR_BOUNDS.minZ - HINGE.z), Math.abs(DOOR_BOUNDS.maxZ - HINGE.z))
const DOOR_SWEEP_RADIUS = Math.hypot(doorXRadius, doorZRadius) + 0.002

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try { return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null } catch { return false }
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value)
    return keys.length === expected.length && keys.every(key => typeof key === 'string' && expected.includes(key))
  } catch { return false }
}
function finite(value: unknown, maxAbs = MAX_COORDINATE): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= maxAbs
}
function point(value: unknown): value is ClearancePoint {
  return record(value) && exactKeys(value, ['x', 'z']) && finite(value.x) && finite(value.z)
}
function provenanceMatches(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['sourceSha', 'model', 'detail', 'sourceHashes'])
    || value.sourceSha !== SEDAN_CLEARANCE_SOURCE.sourceSha || value.model !== 'sedan' || value.detail !== 'map'
    || !record(value.sourceHashes)) return false
  const hashes = value.sourceHashes
  if (!exactKeys(hashes, Object.keys(SEDAN_CLEARANCE_SOURCE.sourceHashes))) return false
  return Object.entries(SEDAN_CLEARANCE_SOURCE.sourceHashes).every(([path, hash]) => hashes[path] === hash)
}
function validRoad(value: unknown): value is RoadSegment {
  if (!record(value) || !exactKeys(value, ['start', 'end', 'width', 'edgeMargin']) || !point(value.start) || !point(value.end)
    || !finite(value.width, 1000) || value.width <= 0 || !finite(value.edgeMargin, 500) || value.edgeMargin < 0
    || value.edgeMargin * 2 >= value.width) return false
  return Math.hypot(value.end.x - value.start.x, value.end.z - value.start.z) > 1e-6
}
function validVehicle(value: unknown): value is VehiclePose {
  return record(value) && exactKeys(value, ['center', 'headingRadians']) && point(value.center)
    && finite(value.headingRadians, Math.PI * 10)
}
function validActorCapsule(value: unknown): boolean {
  if (value === undefined) return true
  return record(value) && exactKeys(value, ['radius', 'halfHeight', 'evidenceRef'])
    && finite(value.radius, 10) && value.radius > 0 && finite(value.halfHeight, 10) && value.halfHeight > 0
    && typeof value.evidenceRef === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(value.evidenceRef)
}

interface RoadFrame { origin: ClearancePoint; tangent: ClearancePoint; normal: ClearancePoint; length: number }
function frame(road: RoadSegment): RoadFrame {
  const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z, length = Math.hypot(dx, dz)
  const tangent = { x: dx / length, z: dz / length }
  return { origin: road.start, tangent, normal: { x: tangent.z, z: -tangent.x }, length }
}
function worldPoint(local: ClearancePoint, pose: VehiclePose): ClearancePoint {
  const c = Math.cos(pose.headingRadians), s = Math.sin(pose.headingRadians)
  return { x: pose.center.x + local.x * c + local.z * s, z: pose.center.z - local.x * s + local.z * c }
}
function project(p: ClearancePoint, f: RoadFrame): { across: number; along: number } {
  const x = p.x - f.origin.x, z = p.z - f.origin.z
  return { across: x * f.normal.x + z * f.normal.z, along: x * f.tangent.x + z * f.tangent.z }
}
function fitBounds(acrossMin: number, acrossMax: number, alongMin: number, alongMax: number, road: RoadSegment, f: RoadFrame): FootprintFit {
  const usableHalfWidth = road.width / 2 - road.edgeMargin
  return {
    fits: acrossMin >= -usableHalfWidth && acrossMax <= usableHalfWidth && alongMin >= 0 && alongMax <= f.length,
    across: { min: acrossMin, max: acrossMax }, along: { min: alongMin, max: alongMax },
  }
}
function rectangleFit(center: ClearancePoint, heading: number, halfWidth: number, halfLength: number, road: RoadSegment, f: RoadFrame): FootprintFit {
  const pose = { center, headingRadians: heading }
  const corners = [
    { x: -halfWidth, z: -halfLength }, { x: -halfWidth, z: halfLength },
    { x: halfWidth, z: -halfLength }, { x: halfWidth, z: halfLength },
  ].map(corner => project(worldPoint(corner, pose), f))
  return fitBounds(Math.min(...corners.map(p => p.across)), Math.max(...corners.map(p => p.across)),
    Math.min(...corners.map(p => p.along)), Math.max(...corners.map(p => p.along)), road, f)
}
function diskFit(center: ClearancePoint, radius: number, road: RoadSegment, f: RoadFrame): FootprintFit {
  const projected = project(center, f)
  return fitBounds(projected.across - radius, projected.across + radius, projected.along - radius, projected.along + radius, road, f)
}
function segmentFit(a: ClearancePoint, b: ClearancePoint, road: RoadSegment, f: RoadFrame): FootprintFit {
  const first = project(a, f), last = project(b, f)
  return fitBounds(Math.min(first.across, last.across), Math.max(first.across, last.across),
    Math.min(first.along, last.along), Math.max(first.along, last.along), road, f)
}
function result(code: VehicleClearanceResult['code'], atMs: number | null, scopes: VehicleClearanceResult['scopes'], geometry: VehicleClearanceResult['geometry']): VehicleClearanceResult {
  return { routeAuthorized: false, code, inspectedAtMs: atMs, scopes, depotApron: 'unverified', missingProof: MISSING_PROOF, geometry }
}

/**
 * Checks one static sedan pose against one straight finite road segment. The box and door disk
 * are analytic conservative bounds; the 101 sampled door poses in the evidence are not used.
 */
export function inspectSedanRoadFootprint(input: ClearanceInput): VehicleClearanceResult {
  const emptyScopes: VehicleClearanceResult['scopes'] = {
    closedVehicleOnRoad: null, fullDoorSweepOnRoad: null, boardingCenterlineOnRoad: null, actorVolume: 'unverified',
  }
  try {
    if (!record(input) || !provenanceMatches(input.provenance)) return result('unsupported_provenance', null, emptyScopes, null)
    const keys = ['provenance', 'road', 'vehicle', 'atMs', ...(Object.hasOwn(input, 'actorCapsule') ? ['actorCapsule'] : [])]
    if (!exactKeys(input, keys)) return result('invalid_geometry', null, emptyScopes, null)
    if (!Number.isSafeInteger(input.atMs) || input.atMs < 0) return result('invalid_time', null, emptyScopes, null)
    if (!validActorCapsule(input.actorCapsule)) return result('invalid_actor_capsule', input.atMs, emptyScopes, null)
    if (!validRoad(input.road) || !validVehicle(input.vehicle)) return result('invalid_geometry', input.atMs, emptyScopes, null)

    const f = frame(input.road), pose = input.vehicle
    const closed = rectangleFit(pose.center, pose.headingRadians, VEHICLE_HALF_WIDTH, VEHICLE_HALF_LENGTH, input.road, f)
    const hinge = worldPoint(HINGE, pose)
    const door = diskFit(hinge, DOOR_SWEEP_RADIUS, input.road, f)
    const approach = worldPoint(BOARDING_APPROACH, pose), anchor = worldPoint(DOOR_GROUND_ANCHOR, pose)
    const boarding = segmentFit(approach, anchor, input.road, f)
    return result('ok', input.atMs, {
      closedVehicleOnRoad: closed,
      fullDoorSweepOnRoad: door,
      boardingCenterlineOnRoad: boarding,
      actorVolume: 'unverified',
    }, {
      vehicleHalfWidth: VEHICLE_HALF_WIDTH,
      vehicleHalfLength: VEHICLE_HALF_LENGTH,
      doorSweepRadius: DOOR_SWEEP_RADIUS,
      boardingApproach: approach,
      closedDoorGroundAnchor: anchor,
    })
  } catch {
    return result('invalid_geometry', null, emptyScopes, null)
  }
}
