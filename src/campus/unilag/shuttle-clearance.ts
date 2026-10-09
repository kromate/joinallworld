import { pointInRing } from './geo.ts'
import type { MetreRing } from './geo.ts'

export interface CorridorPoint { readonly x: number; readonly z: number }

interface IndexedRing { readonly ring: MetreRing; readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number }
/** Opaque token for bounds compiled from a copied, validated building-ring snapshot. */
declare const roadBuildingIndexBrand: unique symbol
export type RoadBuildingIndex = object & { readonly [roadBuildingIndexBrand]: true }
const indexContents = new WeakMap<object, readonly IndexedRing[]>()

const orientation = (a: CorridorPoint, b: CorridorPoint, c: CorridorPoint): number =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)

function pointSegmentDistance(point: CorridorPoint, a: CorridorPoint, b: CorridorPoint): number {
  const dx = b.x - a.x, dz = b.z - a.z
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t)
}

function onSegment(a: CorridorPoint, b: CorridorPoint, point: CorridorPoint): boolean {
  return Math.abs(orientation(a, b, point)) <= 1e-9
    && point.x >= Math.min(a.x, b.x) - 1e-9 && point.x <= Math.max(a.x, b.x) + 1e-9
    && point.z >= Math.min(a.z, b.z) - 1e-9 && point.z <= Math.max(a.z, b.z) + 1e-9
}

function segmentsIntersect(a: CorridorPoint, b: CorridorPoint, c: CorridorPoint, d: CorridorPoint): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}

function segmentDistance(a: CorridorPoint, b: CorridorPoint, c: CorridorPoint, d: CorridorPoint): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

function finiteRing(ring: unknown): ring is MetreRing {
  if (!Array.isArray(ring) || ring.length < 3) return false
  for (let index = 0; index < ring.length; index += 1) {
    const point: unknown = ring[index]
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false
  }
  return true
}

function validPoint(point: CorridorPoint): boolean {
  return Number.isFinite(point?.x) && Number.isFinite(point?.z)
}

function segmentBuildingDistanceValidated(a: CorridorPoint, b: CorridorPoint, ring: MetreRing): number {
  if (pointInRing([a.x, a.z], ring) || pointInRing([b.x, b.z], ring)
    || pointInRing([(a.x + b.x) / 2, (a.z + b.z) / 2], ring)) return 0
  let nearest = Infinity
  for (let index = 0; index < ring.length; index += 1) {
    const first = ring[index], second = ring[(index + 1) % ring.length]
    if (!first || !second) return 0
    nearest = Math.min(nearest, segmentDistance(a, b, { x: first[0], z: first[1] }, { x: second[0], z: second[1] }))
  }
  return nearest
}

/** Exact planar distance from a source road segment to a closed mapped building ring. */
export function segmentBuildingDistance(a: CorridorPoint, b: CorridorPoint, ring: MetreRing): number {
  if (!validPoint(a) || !validPoint(b) || !finiteRing(ring)) return 0
  return segmentBuildingDistanceValidated(a, b, ring)
}

/**
 * Compile immutable copies and bounds for a stationary map snapshot. Invalid
 * or empty geometry has no index, so callers fail closed without trusting a
 * caller-supplied validity flag or mutable source rings.
 */
export function indexRoadBuildings(buildings: readonly MetreRing[]): RoadBuildingIndex | null {
  if (!Array.isArray(buildings) || buildings.length === 0) return null
  const entries: IndexedRing[] = []
  for (const source of buildings) {
    if (!finiteRing(source)) return null
    const copied = Object.freeze(source.map((point) => Object.freeze([point[0], point[1]] as const)))
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const [x, z] of copied) {
      minX = Math.min(minX, x); minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z)
    }
    if (![minX, minZ, maxX, maxZ].every(Number.isFinite)) return null
    entries.push(Object.freeze({ ring: copied, minX, minZ, maxX, maxZ }))
  }
  const token = Object.freeze({}) as RoadBuildingIndex
  indexContents.set(token, Object.freeze(entries))
  return token
}

/** Uses only an index created by indexRoadBuildings; forged/unregistered tokens fail closed. */
export function roadCorridorClearIndexed(a: CorridorPoint, b: CorridorPoint, width: number, index: RoadBuildingIndex | null): boolean {
  if (!validPoint(a) || !validPoint(b) || !Number.isFinite(width) || width <= 0 || !index) return false
  const entries = indexContents.get(index as object)
  if (!entries?.length) return false
  const radius = width / 2
  const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius
  const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius
  if (![radius, minX, maxX, minZ, maxZ].every(Number.isFinite)) return false
  for (const entry of entries) {
    if (entry.maxX < minX || entry.minX > maxX || entry.maxZ < minZ || entry.minZ > maxZ) continue
    // Preserve the positive clearance predicate: NaN distance is not clearance.
    if (!(segmentBuildingDistanceValidated(a, b, entry.ring) > radius + 1e-9)) return false
  }
  return true
}

/** Conservatively treats the full stated road width as a capsule around its source centerline. */
export function roadCorridorClear(a: CorridorPoint, b: CorridorPoint, width: number, buildings: readonly MetreRing[]): boolean {
  return roadCorridorClearIndexed(a, b, width, indexRoadBuildings(buildings))
}
