/**
 * Pinned, body-local sedan aperture diagnostics. This module intentionally has no renderer,
 * physics engine, route, actor pose, or ground authority. A reported clear candidate is only a
 * geometric result for the supplied capsules and the authored simplified model.
 */

export const SEDAN_APERTURE_SOURCE = Object.freeze({
  model: 'sedan',
  detail: 'street',
  frame: 'vehicle-body-local',
  units: 'metres',
  pins: Object.freeze({
    'src/models/vehicles/sedan-interior.ts': '3d9a5b3a516031fb7b6e14058a3d3c2615a3f531a38b56781d2f4a66bf8b0a57',
    'src/models/vehicles/index.ts': '7db039a0b25373a86354639fd703a96aab3a3de48a3088c14c555cc0fa6afc19',
    'src/models/vehicles/geometry.ts': '4bf847bd17a735050daa4686ed0be495c64a7936ed3c65c6e306e740edc94885',
    'src/app/features/living-world/drivingScene.ts': '3d42051273229265a17fcc5e04b7e5c95ddb72e7fa5fd00520d910cd19cf006c',
  }),
  doorAngle: Object.freeze([0, Math.PI * 0.55]),
  steeringInput: Object.freeze([-1, 1]),
  authority: Object.freeze({ canBoard: false, authoritativeClearance: false, routeAuthorized: false }),
})

export type Point3 = readonly [number, number, number]
export interface SedanCapsule {
  readonly id: string
  /** World-space endpoints; the analyzer inverse-transforms them to the pinned body frame. */
  readonly start: Point3
  readonly end: Point3
  readonly radius: number
  readonly phase: 'enter-walk' | 'enter-seat' | 'exit-slide' | 'exit-seat'
  /** Evidence label for this candidate only; it is not accepted actor-pose authority. */
  readonly provenance: string
}
export interface RigidTransform {
  /** Body origin in world coordinates. */
  readonly position: Point3
  /** Unit quaternion [x,y,z,w], body-to-world. Scale is not representable. */
  readonly quaternion: readonly [number, number, number, number]
  readonly motion: 'static'
}
export interface SedanApertureInput {
  readonly sourcePins: typeof SEDAN_APERTURE_SOURCE.pins
  readonly bodyTransform: RigidTransform
  readonly capsules: readonly SedanCapsule[]
  readonly contactMargin: number
  /** Closed interval of possible hinge angles; bounds cover precisely this interval. */
  readonly doorAngleInterval: readonly [number, number]
  /** Closed steering input interval; current obstacle uses the documented full [-1,1] envelope. */
  readonly steeringInterval: readonly [number, number]
}

export type SedanApertureCode = 'ok' | 'unsupported_source' | 'invalid_descriptor'
export interface SedanApertureResult {
  readonly code: SedanApertureCode
  readonly status: 'valid_candidate' | 'blocked_candidate' | 'unknown'
  readonly reason: 'supplied_geometry_clear' | 'modeled_overlap' | 'aperture_boundary_failure' | 'unsupported_source' | 'invalid_descriptor'
  readonly canBoard: false
  readonly authoritativeClearance: false
  readonly routeAuthorized: false
  /** Capsule contact/penetration with authored interior boxes after the explicit margin. */
  readonly modelIntersections: readonly string[]
  /** Conservative contact with retained body/glass/trim surfaces, separate from cabin solids. */
  readonly shellIntersections: readonly string[]
  /** Conservative AABB candidates for the articulated door and steering wheel. */
  readonly sweepOverlapCandidates: readonly string[]
  readonly apertureFailures: readonly string[]
  readonly apertureCrossings: readonly string[]
  readonly sourceGeometry: {
    readonly driverSideApertureZY: readonly (readonly [number, number])[]
    readonly retainedProfileZY: readonly (readonly [number, number])[]
    readonly retainedShell: Readonly<{
      readonly prismWidth: 1.9
      readonly driverCapX: -0.95
      readonly oppositeCapX: 0.95
      readonly oppositeCap: 'retained'
      readonly roofHoodSill: 'profile-prism-surfaces-retained'
      readonly windscreenLowerZY: readonly [1.755, 0.94]
      readonly windscreenUpperZY: readonly [0.695, 1.53]
      readonly sideGlassAndPillar: readonly Readonly<{ id: string; center: Point3; size: Point3 }>[]
      readonly sideTrimPanels: readonly Readonly<{ id: string; center: Point3; size: Point3 }>[]
      readonly clippedGlassAndTrim: 'driver-cut-pieces-hinged; all-other-glass-and-trim-retained'
    }>
    readonly doorSweepBounds: Readonly<{ min: Point3; max: Point3 }>
    readonly interiorObstacleIds: readonly string[]
    readonly retainedObstacleIds: readonly string[]
    readonly steeringSweep: '[-1,1]'
    readonly doorSweepRadians: readonly [number, number]
  } | null
  readonly knownModelIntersection: boolean
  readonly candidateGeometry: 'clear-for-supplied-capsules' | 'conservative-overlap-candidate' | 'known-model-intersection' | 'aperture-boundary-failure' | 'unavailable'
  readonly missingProof: readonly ['complete_clothed_actor_pose', 'terrain_and_support', 'continuous_entry_motion', 'full_scene_collision', 'route_and_yield_authority']
}

const PROFILE: readonly (readonly [number, number])[] = Object.freeze([
  [-2.175, 0.45], [2.175, 0.45], [2.115, 0.78], [1.755, 0.94],
  [1.055, 1.05], [0.695, 1.53], [-1.175, 1.53], [-1.555, 0.96], [-1.835, 0.76],
].map(([z, y]) => Object.freeze([Math.fround(z!), Math.fround(y!)] as const)))
const RETAINED_SHELL = Object.freeze({
  prismWidth: 1.9 as const,
  driverCapX: -0.95 as const,
  oppositeCapX: 0.95 as const,
  oppositeCap: 'retained' as const,
  roofHoodSill: 'profile-prism-surfaces-retained' as const,
  windscreenLowerZY: Object.freeze([1.755, 0.94] as const),
  windscreenUpperZY: Object.freeze([0.695, 1.53] as const),
  sideGlassAndPillar: Object.freeze([
    Object.freeze({ id: 'driver-front-glass', center: Object.freeze([-0.966, 1.20, 0.4175] as const), size: Object.freeze([0.04, 0.5, 1.085] as const) }),
    Object.freeze({ id: 'driver-rear-glass', center: Object.freeze([-0.966, 1.20, -0.7575] as const), size: Object.freeze([0.04, 0.5, 1.125] as const) }),
    Object.freeze({ id: 'driver-b-pillar', center: Object.freeze([-0.975, 1.20, -0.16] as const), size: Object.freeze([0.055, 0.58, 0.1] as const) }),
    Object.freeze({ id: 'passenger-front-glass', center: Object.freeze([0.966, 1.20, 0.4175] as const), size: Object.freeze([0.04, 0.5, 1.085] as const) }),
    Object.freeze({ id: 'passenger-rear-glass', center: Object.freeze([0.966, 1.20, -0.7575] as const), size: Object.freeze([0.04, 0.5, 1.125] as const) }),
    Object.freeze({ id: 'passenger-b-pillar', center: Object.freeze([0.975, 1.20, -0.16] as const), size: Object.freeze([0.055, 0.58, 0.1] as const) }),
  ]),
  sideTrimPanels: Object.freeze([
    Object.freeze({ id: 'driver-shoulder-trim', center: Object.freeze([-0.995, 0.94, 0] as const), size: Object.freeze([0.06, 0.09, 3.306] as const) }),
    Object.freeze({ id: 'driver-pillar-trim', center: Object.freeze([-1.002, 0.88, -0.18] as const), size: Object.freeze([0.065, 0.68, 0.035] as const) }),
    Object.freeze({ id: 'driver-door-handle-trim', center: Object.freeze([-1.008, 0.91, 0.12] as const), size: Object.freeze([0.075, 0.07, 0.28] as const) }),
    Object.freeze({ id: 'passenger-shoulder-trim', center: Object.freeze([0.995, 0.94, 0] as const), size: Object.freeze([0.06, 0.09, 3.306] as const) }),
    Object.freeze({ id: 'passenger-pillar-trim', center: Object.freeze([1.002, 0.88, -0.18] as const), size: Object.freeze([0.065, 0.68, 0.035] as const) }),
    Object.freeze({ id: 'passenger-door-handle-trim', center: Object.freeze([1.008, 0.91, 0.04] as const), size: Object.freeze([0.075, 0.07, 0.28] as const) }),
  ]),
  clippedGlassAndTrim: 'driver-cut-pieces-hinged; all-other-glass-and-trim-retained' as const,
})

const DOOR = Object.freeze({
  // splitCarDoorPanels clipping planes for the 1.9 m sedan; this enclosing box also contains
  // the clipped glass, handle, trim, and the non-planar source triangles within the partition.
  min: [-1.07, Math.fround(0.49), Math.fround(-0.05)] as const,
  max: [-0.89, Math.fround(1.48), Math.fround(0.89)] as const,
  hinge: [-0.96, 0.93, 0.89] as const,
  maxAngle: Math.PI * 0.55,
})
const MISSING = Object.freeze(['complete_clothed_actor_pose', 'terrain_and_support', 'continuous_entry_motion', 'full_scene_collision', 'route_and_yield_authority'] as const)
const MAX_COORDINATE = 10
const FLOAT_MARGIN = 2e-6

type Box = Readonly<{ id: string; min: Point3; max: Point3 }>
const INTERIOR: readonly Box[] = Object.freeze([
  Object.freeze({ id: 'street-underbody', min: [-0.9025, 0.25, -1.9575] as const, max: [0.9025, 0.47, 1.9575] as const }),
  Object.freeze({ id: 'cabin-floor', min: [-0.78, 0.46, -1.25] as const, max: [0.78, 0.52, 0.90] as const }),
  Object.freeze({ id: 'dashboard', min: [-0.67, 0.985, 0.63] as const, max: [0.67, 1.125, 0.91] as const }),
  Object.freeze({ id: 'driver-cushion', min: [-0.707, 0.50, 0.14] as const, max: [-0.167, 0.62, 0.76] as const }),
  Object.freeze({ id: 'driver-backrest', min: [-0.707, 0.62, 0.045] as const, max: [-0.167, 1.20, 0.175] as const }),
  Object.freeze({ id: 'front-passenger-cushion', min: [0.167, 0.50, 0.14] as const, max: [0.707, 0.62, 0.76] as const }),
  Object.freeze({ id: 'front-passenger-backrest', min: [0.167, 0.62, 0.045] as const, max: [0.707, 1.20, 0.175] as const }),
  Object.freeze({ id: 'rear-driver-cushion', min: [-0.707, 0.50, -0.86] as const, max: [-0.167, 0.62, -0.24] as const }),
  Object.freeze({ id: 'rear-driver-backrest', min: [-0.707, 0.62, -0.955] as const, max: [-0.167, 1.20, -0.825] as const }),
  Object.freeze({ id: 'rear-passenger-cushion', min: [0.167, 0.50, -0.86] as const, max: [0.707, 0.62, -0.24] as const }),
  Object.freeze({ id: 'rear-passenger-backrest', min: [0.167, 0.62, -0.955] as const, max: [0.167 + 0.54, 1.20, -0.825] as const }),
])

function dataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try { return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null } catch { return false }
}
function ownData(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : INVALID
}
const INVALID = Symbol('invalid')
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    const own = Reflect.ownKeys(value)
    return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)
      && ownData(value, key) !== INVALID)
  } catch { return false }
}
function finite(value: unknown, limit = MAX_COORDINATE): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
}
function exactArray(value: unknown, length: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length) return false
  for (let index = 0; index < length; index += 1) if (ownData(value, String(index)) === INVALID) return false
  return Reflect.ownKeys(value).every(key => key === 'length' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length))
}
function vec3(value: unknown, coordinateLimit = MAX_COORDINATE): value is Point3 {
  if (!exactArray(value, 3)) return false
  for (let index = 0; index < 3; index += 1) if (!finite(ownData(value, String(index)), coordinateLimit)) return false
  return true
}
function sourceMatches(value: unknown): boolean {
  if (!dataRecord(value) || !exactKeys(value, Object.keys(SEDAN_APERTURE_SOURCE.pins))) return false
  return Object.entries(SEDAN_APERTURE_SOURCE.pins).every(([path, hash]) => ownData(value, path) === hash)
}
function pointInTransform(point: Point3, transform: RigidTransform): Point3 {
  const norm = Math.hypot(...transform.quaternion)
  const [rawX, rawY, rawZ, rawW] = transform.quaternion
  const qx = rawX / norm, qy = rawY / norm, qz = rawZ / norm, qw = rawW / norm
  const px = point[0] - transform.position[0], py = point[1] - transform.position[1], pz = point[2] - transform.position[2]
  // Inverse of the body-to-world unit quaternion: q* (p - translation) q.
  const ix = qw * px - qy * pz + qz * py
  const iy = qw * py - qz * px + qx * pz
  const iz = qw * pz - qx * py + qy * px
  const iw = qx * px + qy * py + qz * pz
  return [ix * qw + iw * qx + iy * qz - iz * qy,
    iy * qw + iw * qy + iz * qx - ix * qz,
    iz * qw + iw * qz + ix * qy - iy * qx]
}
function validTransform(value: unknown): value is RigidTransform {
  if (!dataRecord(value) || !exactKeys(value, ['position', 'quaternion', 'motion']) || ownData(value, 'motion') !== 'static') return false
  const position = ownData(value, 'position'), quaternion = ownData(value, 'quaternion')
  if (!vec3(position, 1_000_000) || !exactArray(quaternion, 4)) return false
  const values: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const component = ownData(quaternion, String(index))
    if (!finite(component, 1)) return false
    values.push(component)
  }
  const norm = Math.hypot(...values)
  return Math.abs(norm - 1) <= 1e-6
}
function validCapsule(value: unknown): value is SedanCapsule {
  if (!dataRecord(value) || !exactKeys(value, ['id', 'start', 'end', 'radius', 'phase', 'provenance'])) return false
  const id = ownData(value, 'id'), start = ownData(value, 'start'), end = ownData(value, 'end')
  const radius = ownData(value, 'radius'), provenance = ownData(value, 'provenance'), phase = ownData(value, 'phase')
  return typeof id === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(id) && vec3(start, 1_000_000) && vec3(end, 1_000_000)
    && finite(radius, 2) && radius > 0 && typeof phase === 'string'
    && (phase === 'enter-walk' || phase === 'enter-seat' || phase === 'exit-slide' || phase === 'exit-seat')
    && typeof provenance === 'string' && /^[A-Za-z0-9:_./-]{1,120}$/.test(provenance)
}
function validInterval(value: unknown, lower: number, upper: number): value is readonly [number, number] {
  if (!exactArray(value, 2)) return false
  const start = ownData(value, '0'), end = ownData(value, '1')
  return finite(start, upper) && finite(end, upper) && start >= lower && end <= upper && start <= end
}
function validInput(value: unknown): value is SedanApertureInput {
  if (!dataRecord(value) || !exactKeys(value, ['sourcePins', 'bodyTransform', 'capsules', 'contactMargin', 'doorAngleInterval', 'steeringInterval'])) return false
  const capsules = ownData(value, 'capsules'), margin = ownData(value, 'contactMargin')
  if (!sourceMatches(ownData(value, 'sourcePins')) || !validTransform(ownData(value, 'bodyTransform'))
    || !Array.isArray(capsules) || capsules.length < 1 || capsules.length > 64 || !exactArray(capsules, capsules.length)
    || !finite(margin, 0.25) || margin < 0.005 || !validInterval(ownData(value, 'doorAngleInterval'), 0, DOOR.maxAngle)
    || !validInterval(ownData(value, 'steeringInterval'), -1, 1)) return false
  const ids = new Set<string>()
  for (let index = 0; index < capsules.length; index += 1) {
    const item = ownData(capsules, String(index))
    if (!validCapsule(item) || ids.has(item.id)) return false
    ids.add(item.id)
  }
  return true
}

function clipProfile(axis: 0 | 1, boundary: number, keepGreater: boolean, polygon: readonly Point2[]): Point2[] {
  const result: Point2[] = []
  if (!polygon.length) return result
  const inside = (point: Point2): boolean => keepGreater ? point[axis] >= boundary : point[axis] <= boundary
  let previous = polygon[polygon.length - 1]!
  let wasInside = inside(previous)
  for (const current of polygon) {
    const isInside = inside(current)
    if (isInside !== wasInside) {
      const fraction = (boundary - previous[axis]) / (current[axis] - previous[axis])
      result.push([previous[0] + fraction * (current[0] - previous[0]),
        previous[1] + fraction * (current[1] - previous[1])])
    }
    if (isInside) result.push(current)
    previous = current; wasInside = isInside
  }
  return result
}
type Point2 = readonly [number, number] // [z,y]
function apertureProfile(): readonly Point2[] {
  let polygon: readonly Point2[] = PROFILE
  // Match splitCarDoorPanels' plane order and double-precision interpolation. The actual
  // generated attribute is Float32, so round the final clipped vertices once at emission.
  polygon = clipProfile(1, 0.49, true, polygon)
  polygon = clipProfile(1, Math.fround(1.48), false, polygon)
  polygon = clipProfile(0, -0.05, true, polygon)
  polygon = clipProfile(0, 0.89, false, polygon)
  return Object.freeze(polygon.map(point => Object.freeze([Math.fround(point[0]), Math.fround(point[1])] as const)))
}
const APERTURE = apertureProfile()

function insideInsetAperture(z: number, y: number, inset: number): boolean {
  for (let index = 0; index < APERTURE.length; index += 1) {
    const a = APERTURE[index]!, b = APERTURE[(index + 1) % APERTURE.length]!
    const dz = b[0] - a[0], dy = b[1] - a[1]
    const signed = (dz * (y - a[1]) - dy * (z - a[0])) / Math.hypot(dz, dy)
    if (signed < inset + FLOAT_MARGIN) return false
  }
  return true
}
function lineIntersectsExpandedBox(a: Point3, b: Point3, box: Box, radius: number): boolean {
  let low = 0, high = 1
  for (let axis = 0; axis < 3; axis += 1) {
    const min = box.min[axis]! - radius - FLOAT_MARGIN, max = box.max[axis]! + radius + FLOAT_MARGIN
    const delta = b[axis]! - a[axis]!
    if (Math.abs(delta) < 1e-15) {
      if (a[axis]! < min || a[axis]! > max) return false
    } else {
      let t0 = (min - a[axis]!) / delta, t1 = (max - a[axis]!) / delta
      if (t0 > t1) [t0, t1] = [t1, t0]
      low = Math.max(low, t0); high = Math.min(high, t1)
      if (low > high) return false
    }
  }
  return true
}
function segmentBoxDistanceSquared(a: Point3, b: Point3, box: Box): number {
  // Exact minimum for a segment and an axis-aligned box: split the segment where each
  // coordinate crosses a box face, then minimize its quadratic distance on every interval.
  const min = box.min.map(value => value - FLOAT_MARGIN), max = box.max.map(value => value + FLOAT_MARGIN)
  const breaks = [0, 1]
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = b[axis]! - a[axis]!
    if (Math.abs(delta) < 1e-15) continue
    for (const boundary of [min[axis]!, max[axis]!]) {
      const t = (boundary - a[axis]!) / delta
      if (t > 0 && t < 1) breaks.push(t)
    }
  }
  breaks.sort((left, right) => left - right)
  let best = Infinity
  const measure = (t: number): number => {
    let sum = 0
    for (let axis = 0; axis < 3; axis += 1) {
      const value = a[axis]! + (b[axis]! - a[axis]!) * t
      const separation = value < min[axis]! ? min[axis]! - value : value > max[axis]! ? value - max[axis]! : 0
      sum += separation * separation
    }
    return sum
  }
  for (let index = 0; index + 1 < breaks.length; index += 1) {
    const left = breaks[index]!, right = breaks[index + 1]!, middle = (left + right) / 2
    let numerator = 0, denominator = 0
    for (let axis = 0; axis < 3; axis += 1) {
      const delta = b[axis]! - a[axis]!, value = a[axis]! + delta * middle
      let offset = 0, slope = 0
      if (value < min[axis]!) { offset = min[axis]! - a[axis]!; slope = -delta }
      else if (value > max[axis]!) { offset = a[axis]! - max[axis]!; slope = delta }
      numerator += offset * slope
      denominator += slope * slope
    }
    const closest = denominator === 0 ? left : Math.max(left, Math.min(right, -numerator / denominator))
    best = Math.min(best, measure(left), measure(right), measure(closest))
  }
  if (breaks.length === 1) best = measure(breaks[0]!)
  return best
}
function capsuleCrossesAperture(a: Point3, b: Point3, radius: number, margin: number): 'none' | 'inside' | 'outside' {
  // The whole capsule is checked against an inward-offset convex [z,y] polygon wherever its
  // centerline is within one radius of the side plane. This deliberately overstates its footprint.
  const planeX = -0.95
  const lo = -radius, hi = radius
  const dx = b[0] - a[0]
  let t0 = 0, t1 = 1
  if (Math.abs(dx) < 1e-15) {
    if (Math.abs(a[0] - planeX) > radius) return 'none'
  } else {
    const first = (planeX + lo - a[0]) / dx, second = (planeX + hi - a[0]) / dx
    t0 = Math.max(0, Math.min(first, second)); t1 = Math.min(1, Math.max(first, second))
    if (t0 > t1) return 'none'
  }
  for (const t of t0 === t1 ? [t0] : [t0, t1]) {
    const z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t
    if (!insideInsetAperture(z, y, radius + margin)) return 'outside'
  }
  return 'inside'
}

function trigCandidates(start: number, end: number, base: number): number[] {
  const values = [start, end]
  const first = Math.ceil((start - base) / Math.PI), last = Math.floor((end - base) / Math.PI)
  for (let k = first; k <= last; k += 1) values.push(base + k * Math.PI)
  return values
}
function doorSweepBounds(startAngle: number, endAngle: number): { min: Point3; max: Point3 } {
  const [hx, hy, hz] = DOOR.hinge
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const x of [DOOR.min[0], DOOR.max[0]]) for (const z of [DOOR.min[2], DOOR.max[2]]) {
    const dx = x - hx, dz = z - hz
    // x'=dx*cos+dz*sin; z'=-dx*sin+dz*cos. Include all derivative roots, not samples.
    const xRoots = trigCandidates(startAngle, endAngle, Math.atan2(dz, dx))
    const zRoots = trigCandidates(startAngle, endAngle, Math.atan2(-dx, dz))
    for (const theta of xRoots) {
      const value = hx + dx * Math.cos(theta) + dz * Math.sin(theta)
      minX = Math.min(minX, value); maxX = Math.max(maxX, value)
    }
    for (const theta of zRoots) {
      const value = hz - dx * Math.sin(theta) + dz * Math.cos(theta)
      minZ = Math.min(minZ, value); maxZ = Math.max(maxZ, value)
    }
  }
  return Object.freeze({
    min: Object.freeze([minX - FLOAT_MARGIN, DOOR.min[1] - FLOAT_MARGIN, minZ - FLOAT_MARGIN] as const),
    max: Object.freeze([maxX + FLOAT_MARGIN, DOOR.max[1] + FLOAT_MARGIN, maxZ + FLOAT_MARGIN] as const),
  })
}
const DOOR_SWEEP = doorSweepBounds(0, DOOR.maxAngle)
const STEERING_BOX: Box = Object.freeze({ id: 'steering-wheel-full-input-sweep',
  min: [-0.64, 0.75, 0.40], max: [-0.23, 1.11, 0.80] })
function panelBounds(id: string, center: Point3, size: Point3): Box {
  return Object.freeze({ id,
    min: [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2] as const,
    max: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2] as const })
}
const DOOR_CLIP: Box = Object.freeze({ id: 'door-panel-clipping-volume',
  min: [-1.07, Math.fround(0.49), Math.fround(-0.05)], max: [-0.89, Math.fround(1.48), Math.fround(0.89)] })
function retainedPanelFragments(box: Box): readonly Box[] {
  const innerMin: Point3 = [Math.max(box.min[0], DOOR_CLIP.min[0]), Math.max(box.min[1], DOOR_CLIP.min[1]), Math.max(box.min[2], DOOR_CLIP.min[2])]
  const innerMax: Point3 = [Math.min(box.max[0], DOOR_CLIP.max[0]), Math.min(box.max[1], DOOR_CLIP.max[1]), Math.min(box.max[2], DOOR_CLIP.max[2])]
  if (innerMin.some((value, axis) => value >= innerMax[axis]!)) return Object.freeze([box])
  const fragments: Box[] = []
  const add = (id: string, min: Point3, max: Point3): void => {
    if (min.every((value, axis) => value < max[axis]!)) fragments.push(Object.freeze({ id, min, max }))
  }
  add(`${box.id}:retained-x-low`, box.min, [innerMin[0], box.max[1], box.max[2]])
  add(`${box.id}:retained-x-high`, [innerMax[0], box.min[1], box.min[2]], box.max)
  add(`${box.id}:retained-y-low`, [innerMin[0], box.min[1], box.min[2]], [innerMax[0], innerMin[1], box.max[2]])
  add(`${box.id}:retained-y-high`, [innerMin[0], innerMax[1], box.min[2]], [innerMax[0], box.max[1], box.max[2]])
  add(`${box.id}:retained-z-low`, [innerMin[0], innerMin[1], box.min[2]], [innerMax[0], innerMax[1], innerMin[2]])
  add(`${box.id}:retained-z-high`, [innerMin[0], innerMin[1], innerMax[2]], [innerMax[0], innerMax[1], box.max[2]])
  return Object.freeze(fragments)
}
const STREET_GLASS_AND_TRIM: readonly Box[] = Object.freeze([
  ...RETAINED_SHELL.sideGlassAndPillar.filter(panel => panel.id.startsWith('driver-')).map(panel => panelBounds(panel.id, panel.center, panel.size)),
  ...RETAINED_SHELL.sideTrimPanels.filter(panel => panel.id.startsWith('driver-')).map(panel => panelBounds(panel.id, panel.center, panel.size)),
])
const OPPOSITE_SIDE_GLASS_AND_TRIM: readonly Box[] = Object.freeze([
  ...RETAINED_SHELL.sideGlassAndPillar.filter(panel => panel.id.startsWith('passenger-')).map(panel => panelBounds(panel.id, panel.center, panel.size)),
  ...RETAINED_SHELL.sideTrimPanels.filter(panel => panel.id.startsWith('passenger-')).map(panel => panelBounds(panel.id, panel.center, panel.size)),
])
const SHELL: readonly Box[] = Object.freeze([
  Object.freeze({ id: 'opposite-cap', min: [0.92, 0.45, -2.175] as const, max: [0.95, 1.53, 2.175] as const }),
  Object.freeze({ id: 'driver-cap-lower-sill', min: [-0.95, 0.45, -2.175] as const, max: [-0.92, 0.49, 2.175] as const }),
  // The driver cap is a retained profile-prism face outside splitCarDoorPanels' hinge cut.
  // These four conservative pieces exclude the clipping volume; the side aperture itself stays
  // articulated, while the rear/front cap, sill, and roof remain modeled as shell obstacles.
  Object.freeze({ id: 'driver-cap-retained-rear', min: [-0.95, 0.45, -2.175] as const, max: [-0.95, 1.53, -0.05] as const }),
  Object.freeze({ id: 'driver-cap-retained-front', min: [-0.95, 0.45, 0.89] as const, max: [-0.95, 1.53, 2.175] as const }),
  Object.freeze({ id: 'driver-cap-retained-sill', min: [-0.95, 0.45, -2.175] as const, max: [-0.95, 0.49, 2.175] as const }),
  Object.freeze({ id: 'driver-cap-retained-roof', min: [-0.95, 1.48, -2.175] as const, max: [-0.95, 1.53, 2.175] as const }),
  // Outward AABB of the retained sloped windshield box emitted by slopedWindscreen().
  Object.freeze({ id: 'windscreen-sloped-panel', min: [-0.817, 0.959, 0.705] as const, max: [0.817, 1.589, 1.788] as const }),
  Object.freeze({ id: 'windscreen-lower', min: [-0.95, 0.915, 1.73] as const, max: [0.95, 0.965, 1.78] as const }),
  Object.freeze({ id: 'windscreen-upper', min: [-0.95, 1.505, 0.67] as const, max: [0.95, 1.555, 0.72] as const }),
  // The static rear-glass box is emitted separately from the hinged side panels.
  Object.freeze({ id: 'rear-glass-static', min: [-0.798, 0.969, -1.443] as const, max: [0.798, 1.431, -1.291] as const }),
  // The cabin shoulder trim sits above the hinge clip and remains part of the static body.
  Object.freeze({ id: 'roof-shoulder-trim', min: [-0.836, 1.515, -1.144] as const, max: [0.836, 1.595, 0.784] as const }),
  ...PROFILE.map(([z0, y0], index) => {
    const [z1, y1] = PROFILE[(index + 1) % PROFILE.length]!
    return Object.freeze({ id: `retained-profile-edge-${index}`,
      min: [-0.95, Math.min(y0, y1) - 0.025, Math.min(z0, z1) - 0.025] as const,
      max: [0.95, Math.max(y0, y1) + 0.025, Math.max(z0, z1) + 0.025] as const })
  }),
  ...STREET_GLASS_AND_TRIM.flatMap(retainedPanelFragments),
  ...OPPOSITE_SIDE_GLASS_AND_TRIM,
])

function frozenResult(code: SedanApertureCode, modelIntersections: string[], shellIntersections: string[], sweepOverlapCandidates: string[], apertureFailures: string[], apertureCrossings: string[], doorBounds = DOOR_SWEEP, doorInterval: readonly [number, number] = [0, DOOR.maxAngle]): SedanApertureResult {
  const ok = code === 'ok'
  const blocked = modelIntersections.length > 0 || shellIntersections.length > 0 || apertureFailures.length > 0 || sweepOverlapCandidates.length > 0
  const reason = code !== 'ok' ? code : apertureFailures.length ? 'aperture_boundary_failure' : blocked ? 'modeled_overlap' : 'supplied_geometry_clear'
  return Object.freeze({ code, status: !ok ? 'unknown' : blocked ? 'blocked_candidate' : 'valid_candidate', reason,
    canBoard: false, authoritativeClearance: false, routeAuthorized: false,
    modelIntersections: Object.freeze(modelIntersections), shellIntersections: Object.freeze(shellIntersections), sweepOverlapCandidates: Object.freeze(sweepOverlapCandidates), apertureFailures: Object.freeze(apertureFailures),
    apertureCrossings: Object.freeze(apertureCrossings),
    sourceGeometry: ok ? Object.freeze({
      driverSideApertureZY: APERTURE,
      retainedProfileZY: PROFILE,
      retainedShell: RETAINED_SHELL,
      doorSweepBounds: Object.freeze({ min: doorBounds.min, max: doorBounds.max }),
      interiorObstacleIds: Object.freeze([...INTERIOR.map(box => box.id), STEERING_BOX.id]),
      retainedObstacleIds: Object.freeze(SHELL.map(box => box.id)),
      steeringSweep: '[-1,1]' as const,
      doorSweepRadians: Object.freeze([doorInterval[0], doorInterval[1]] as const),
    }) : null,
    knownModelIntersection: modelIntersections.length > 0 || shellIntersections.length > 0,
    candidateGeometry: !ok ? 'unavailable' : apertureFailures.length ? 'aperture-boundary-failure'
      : modelIntersections.length || shellIntersections.length ? 'known-model-intersection'
      : sweepOverlapCandidates.length ? 'conservative-overlap-candidate' : 'clear-for-supplied-capsules',
    missingProof: MISSING,
  })
}

/**
 * Analyze supplied capsules against the pinned simplified opening, full door sweep and interior.
 * A clear return covers only those capsules; it is never sufficient for boarding or routing.
 */
export function analyzeSedanAperture(input: unknown): SedanApertureResult {
  try {
    if (!dataRecord(input) || ownData(input, 'sourcePins') === INVALID || !sourceMatches(ownData(input, 'sourcePins')))
      return frozenResult('unsupported_source', [], [], [], [], [])
    if (!validInput(input)) return frozenResult('invalid_descriptor', [], [], [], [], [])
    const transform = ownData(input, 'bodyTransform') as RigidTransform
    const margin = ownData(input, 'contactMargin') as number
    const doorInterval = ownData(input, 'doorAngleInterval') as readonly [number, number]
    const doorBounds = doorSweepBounds(doorInterval[0], doorInterval[1])
    const modelIntersections = new Set<string>(), shellIntersections = new Set<string>(), sweepOverlapCandidates = new Set<string>()
    const apertureFailures: string[] = [], apertureCrossings: string[] = []
    const capsules = ownData(input, 'capsules') as readonly SedanCapsule[]
    for (let index = 0; index < capsules.length; index += 1) {
      const capsule = ownData(capsules, String(index)) as SedanCapsule
      const start = pointInTransform(capsule.start, transform), end = pointInTransform(capsule.end, transform)
      if (![...start, ...end].every(value => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE))
        return frozenResult('invalid_descriptor', [], [], [], [], [])
      const doorBox: Box = { id: 'door-sweep', min: doorBounds.min, max: doorBounds.max }
      if (lineIntersectsExpandedBox(start, end, doorBox, capsule.radius + margin)) sweepOverlapCandidates.add(`${capsule.id}:door-sweep`)
      for (const obstacle of INTERIOR) if (segmentBoxDistanceSquared(start, end, obstacle) <= (capsule.radius + margin) ** 2)
        modelIntersections.add(`${capsule.id}:${obstacle.id}`)
      for (const obstacle of SHELL) if (segmentBoxDistanceSquared(start, end, obstacle) <= (capsule.radius + margin) ** 2)
        shellIntersections.add(`${capsule.id}:${obstacle.id}`)
      if (lineIntersectsExpandedBox(start, end, STEERING_BOX, capsule.radius + margin)) sweepOverlapCandidates.add(`${capsule.id}:${STEERING_BOX.id}`)
      const crossing = capsuleCrossesAperture(start, end, capsule.radius, margin)
      if (crossing === 'inside') apertureCrossings.push(capsule.id)
      else if (crossing === 'outside') apertureFailures.push(capsule.id)
    }
    return frozenResult('ok', [...modelIntersections].sort(), [...shellIntersections].sort(), [...sweepOverlapCandidates].sort(), apertureFailures.sort(), apertureCrossings.sort(), doorBounds, doorInterval)
  } catch {
    return frozenResult('invalid_descriptor', [], [], [], [], [])
  }
}
