/**
 * Geometry-only swept clearance for the source-pinned street-detail sedan.
 * This proves neither terrain support, doorway/actor fit, route provenance nor permission to drive.
 */
import { readSedanBoardingDescriptor } from './vehicle-boarding.ts'
import type { VehicleFramePoint } from './vehicle-boarding.ts'

export interface SweepPose { readonly center: VehicleFramePoint; readonly headingRadians: number }
export type SweepReason = 'clear' | 'invalid_input' | 'invalid_descriptor' | 'invalid_pose'
  | 'invalid_support' | 'invalid_buildings' | 'outside_support' | 'building_clearance'
export interface MappedSweepResult {
  readonly routeAuthorized: false
  readonly canBoard: false
  readonly scope: 'closed-vehicle-swept-footprint-only'
  readonly reason: SweepReason
  readonly minimumSupportClearanceM: number | null
  readonly obstacleEnvelopeRadiusM: number | null
  readonly headingDeltaRadians: number | null
}

const MAX_COORDINATE = 100_000
const MAX_HEADING = 1_000_000
const MAX_POLYGON_POINTS = 64
const MAX_BUILDINGS = 64
const EDGE_MARGIN_M = 0.05
const TAU = 2 * Math.PI

type Point = VehicleFramePoint
type Polygon = readonly Point[]
type Rec = Record<string, unknown>
interface Dimensions { halfWidth: number; halfLength: number }

function exactRecord(value: unknown, keys: readonly string[]): Rec | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return null
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return null
    const out: Rec = Object.create(null)
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null
      out[key] = descriptor.value
    }
    return out
  } catch { return null }
}

function exactArray(value: unknown, min: number, max: number): unknown[] | null {
  if (!Array.isArray(value)) return null
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) return null
    const keys = Reflect.ownKeys(value)
    if (keys.length !== value.length + 1 || !keys.includes('length')) return null
    const out: unknown[] = []
    for (let i = 0; i < value.length; i++) {
      if (!keys.includes(String(i))) return null
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null
      out.push(descriptor.value)
    }
    return out
  } catch { return null }
}

function readPoint(value: unknown): Point | null {
  const row = exactRecord(value, ['x', 'z'])
  if (!row || typeof row.x !== 'number' || !Number.isFinite(row.x) || Math.abs(row.x) > MAX_COORDINATE
    || typeof row.z !== 'number' || !Number.isFinite(row.z) || Math.abs(row.z) > MAX_COORDINATE) return null
  return { x: row.x, z: row.z }
}

function polygon(value: unknown, convex: boolean): Polygon | null {
  const items = exactArray(value, 3, MAX_POLYGON_POINTS)
  if (!items) return null
  const points: Point[] = []
  for (const item of items) {
    const point = readPoint(item)
    if (!point) return null
    points.push(point)
  }
  let twiceArea = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!
    if (same(a, b)) return null
    twiceArea += a.x * b.z - b.x * a.z
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) < 1e-8) return null
  if (convex) {
    const winding = Math.sign(twiceArea)
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!
      let hasInteriorSide = false
      for (const p of points) {
        const side = cross(a, b, p) * winding
        if (!Number.isFinite(side) || side < -1e-8) return null
        if (side > 1e-8) hasInteriorSide = true
      }
      if (!hasInteriorSide) return null
    }
  } else {
    // Reject self-crossing footprints; only simple authored polygons have defined interior.
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const iNext = (i + 1) % points.length, jNext = (j + 1) % points.length
      if (i === j || iNext === j || jNext === i) continue
      if (segmentsIntersect(points[i]!, points[iNext]!, points[j]!, points[jNext]!)) return null
    }
  }
  return points
}

function dimensions(value: unknown): Dimensions | null {
  const descriptor = readSedanBoardingDescriptor(value)
  if (!descriptor || descriptor.authority.routeAuthorized !== false || descriptor.authority.canBoard !== false) return null
  const width = descriptor.sedan.conservativeStaticEnvelope.halfWidth
  const length = descriptor.sedan.conservativeStaticEnvelope.halfLength
  return Number.isFinite(width) && width > 0 && Number.isFinite(length) && length > 0
    ? { halfWidth: width, halfLength: length } : null
}

function pose(value: unknown): SweepPose | null {
  const row = exactRecord(value, ['center', 'headingRadians'])
  if (!row || typeof row.headingRadians !== 'number' || !Number.isFinite(row.headingRadians)
    || Math.abs(row.headingRadians) > MAX_HEADING) return null
  const center = readPoint(row.center)
  return center ? { center, headingRadians: row.headingRadians } : null
}

function same(a: Point, b: Point): boolean { return a.x === b.x && a.z === b.z }
function cross(a: Point, b: Point, c: Point): number { return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) }
function signedArea(points: Polygon): number {
  let area = 0
  for (let i = 0; i < points.length; i++) area += points[i]!.x * points[(i + 1) % points.length]!.z - points[(i + 1) % points.length]!.x * points[i]!.z
  return area / 2
}
function orient(a: Point, b: Point, c: Point): number { return cross(a, b, c) }
function onSegment(a: Point, b: Point, p: Point): boolean {
  return p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9
    && p.z >= Math.min(a.z, b.z) - 1e-9 && p.z <= Math.max(a.z, b.z) + 1e-9
}
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
  const crosses = (x: number, y: number) => (x > 1e-9 && y < -1e-9) || (x < -1e-9 && y > 1e-9)
  if (crosses(o1, o2) && crosses(o3, o4)) return true
  return Math.abs(o1) <= 1e-9 && onSegment(a, b, c) || Math.abs(o2) <= 1e-9 && onSegment(a, b, d)
    || Math.abs(o3) <= 1e-9 && onSegment(c, d, a) || Math.abs(o4) <= 1e-9 && onSegment(c, d, b)
}

function wrapDelta(from: number, to: number): number {
  const raw = to - from
  return ((raw + Math.PI) % TAU + TAU) % TAU - Math.PI
}

/** Minimum of A + B*t + C*cos(theta(t)) + D*sin(theta(t)), t in [0,1]. */
function minimumCornerPlane(c0: number, c1: number, theta0: number, delta: number, cosine: number, sine: number): number {
  const evaluate = (t: number) => c0 + (c1 - c0) * t + cosine * Math.cos(theta0 + delta * t) + sine * Math.sin(theta0 + delta * t)
  let minimum = Math.min(evaluate(0), evaluate(1))
  if (delta === 0) return minimum

  // Derivative roots are exact critical angles, not spatial/heading samples.
  const slopeByTheta = (c1 - c0) / delta
  const amplitude = Math.hypot(cosine, sine)
  if (amplitude === 0) return minimum
  const target = -slopeByTheta / amplitude
  if (target < -1 || target > 1) return minimum
  const phase = Math.atan2(cosine, sine) // amp*cos(theta+phase) = sine*cos(theta)-cosine*sin(theta)
  const base = Math.acos(Math.max(-1, Math.min(1, target)))
  const low = Math.min(theta0, theta0 + delta), high = Math.max(theta0, theta0 + delta)
  for (const rootBase of [base - phase, -base - phase]) {
    const first = Math.ceil((low - rootBase) / TAU), last = Math.floor((high - rootBase) / TAU)
    for (let turn = first; turn <= last; turn++) {
      const theta = rootBase + turn * TAU
      const t = (theta - theta0) / delta
      if (t >= 0 && t <= 1) minimum = Math.min(minimum, evaluate(t))
    }
  }
  return minimum
}

function supportMinimum(start: SweepPose, end: SweepPose, d: Dimensions, support: Polygon): number | null {
  const winding = Math.sign(signedArea(support)), delta = wrapDelta(start.headingRadians, end.headingRadians)
  let minimum = Infinity
  for (let edge = 0; edge < support.length; edge++) {
    const a = support[edge]!, b = support[(edge + 1) % support.length]!
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
    if (!(length > 0) || !Number.isFinite(length)) return null
    const nx = winding * -dz / length, nz = winding * dx / length
    const c0 = nx * (start.center.x - a.x) + nz * (start.center.z - a.z)
    const c1 = nx * (end.center.x - a.x) + nz * (end.center.z - a.z)
    for (const signX of [-1, 1]) for (const signZ of [-1, 1]) {
      const localX = signX * d.halfWidth, localZ = signZ * d.halfLength
      const cosine = nx * localX + nz * localZ
      const sine = nx * localZ - nz * localX
      minimum = Math.min(minimum, minimumCornerPlane(c0, c1, start.headingRadians, delta, cosine, sine))
    }
  }
  return Number.isFinite(minimum) ? minimum : null
}

function pointInPolygon(point: Point, points: Polygon): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}
function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz
  if (!(length2 > 0) || !Number.isFinite(length2)) return Math.hypot(point.x - a.x, point.z - a.z)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length2))
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz)
}
function segmentPolygonDistance(a: Point, b: Point, polygon: Polygon): number {
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return 0
  let minimum = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!, q = polygon[(i + 1) % polygon.length]!
    if (segmentsIntersect(a, b, p, q)) return 0
    minimum = Math.min(minimum, pointSegmentDistance(a, p, q), pointSegmentDistance(b, p, q),
      pointSegmentDistance(p, a, b), pointSegmentDistance(q, a, b))
  }
  return Number.isFinite(minimum) ? minimum : 0
}

function result(reason: SweepReason, values: Partial<Pick<MappedSweepResult, 'minimumSupportClearanceM' | 'obstacleEnvelopeRadiusM' | 'headingDeltaRadians'>> = {}): MappedSweepResult {
  return { routeAuthorized: false, canBoard: false, scope: 'closed-vehicle-swept-footprint-only', reason,
    minimumSupportClearanceM: values.minimumSupportClearanceM ?? null,
    obstacleEnvelopeRadiusM: values.obstacleEnvelopeRadiusM ?? null,
    headingDeltaRadians: values.headingDeltaRadians ?? null }
}

/** Analytically sweeps the source-pinned rectangular sedan footprint through two poses. */
export function verifyMappedSweep(value: unknown): MappedSweepResult {
  try {
    const input = exactRecord(value, ['descriptor', 'from', 'to', 'supportPolygon', 'buildings'])
    if (!input) return result('invalid_input')
    const d = dimensions(input.descriptor)
    if (!d) return result('invalid_descriptor')
    const from = pose(input.from), to = pose(input.to)
    if (!from || !to) return result('invalid_pose')
    const support = polygon(input.supportPolygon, true)
    if (!support) return result('invalid_support')
    const rawBuildings = exactArray(input.buildings, 0, MAX_BUILDINGS)
    if (!rawBuildings) return result('invalid_buildings')
    const buildings: Polygon[] = []
    for (const footprint of rawBuildings) {
      const parsed = polygon(footprint, false)
      if (!parsed) return result('invalid_buildings')
      buildings.push(parsed)
    }
    const headingDelta = wrapDelta(from.headingRadians, to.headingRadians)
    const minimum = supportMinimum(from, to, d, support)
    if (minimum === null) return result('invalid_support', { headingDeltaRadians: headingDelta })
    const radius = Math.hypot(d.halfWidth, d.halfLength) + EDGE_MARGIN_M
    if (![radius, minimum, headingDelta].every(Number.isFinite)) return result('invalid_input')
    if (minimum < EDGE_MARGIN_M - 1e-9) return result('outside_support', { minimumSupportClearanceM: minimum, obstacleEnvelopeRadiusM: radius, headingDeltaRadians: headingDelta })
    for (const building of buildings) {
      if (segmentPolygonDistance(from.center, to.center, building) <= radius + 1e-9)
        return result('building_clearance', { minimumSupportClearanceM: minimum, obstacleEnvelopeRadiusM: radius, headingDeltaRadians: headingDelta })
    }
    return result('clear', { minimumSupportClearanceM: minimum, obstacleEnvelopeRadiusM: radius, headingDeltaRadians: headingDelta })
  } catch { return result('invalid_input') }
}
