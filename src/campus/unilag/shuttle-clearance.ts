import { pointInRing } from './geo.ts'
import type { MetreRing } from './geo.ts'

export interface CorridorPoint { readonly x: number; readonly z: number }

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

/** Exact planar distance from a source road segment to a closed mapped building ring. */
export function segmentBuildingDistance(a: CorridorPoint, b: CorridorPoint, ring: MetreRing): number {
  if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(b.x) || !Number.isFinite(b.z) || ring.length < 3
    || ring.some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z))) return 0
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

/** Conservatively treats the full stated road width as a capsule around its source centerline. */
export function roadCorridorClear(a: CorridorPoint, b: CorridorPoint, width: number, buildings: readonly MetreRing[]): boolean {
  if (!Number.isFinite(width) || width <= 0 || buildings.length === 0) return false
  const radius = width / 2
  const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius
  const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius
  return buildings.every((ring) => {
    if (ring.length < 3 || ring.some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z))) return false
    let ringMinX = Infinity, ringMinZ = Infinity, ringMaxX = -Infinity, ringMaxZ = -Infinity
    for (const [x, z] of ring) {
      ringMinX = Math.min(ringMinX, x); ringMinZ = Math.min(ringMinZ, z)
      ringMaxX = Math.max(ringMaxX, x); ringMaxZ = Math.max(ringMaxZ, z)
    }
    if (ringMaxX < minX || ringMinX > maxX || ringMaxZ < minZ || ringMinZ > maxZ) return true
    return segmentBuildingDistance(a, b, ring) > radius + 1e-9
  })
}
