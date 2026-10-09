import * as THREE from 'three'
import { TILE_METRES, tileOrigin } from './frame.ts'
import type { MetrePoint, TileCoord } from './types.ts'

export interface StreetOverlayGeometry {
  id: string
  tile: TileCoord
  sourceVersion: string
  surfaces: readonly { polygon: readonly MetrePoint[]; height: number; color: string }[]
  markers: readonly { id: string; label: string; point: MetrePoint; height: number }[]
}

export interface StreetOverlayView {
  readonly group: THREE.Group
  readonly tile: Readonly<TileCoord>
  attach(parent: THREE.Object3D): void
  rebase(originTile: TileCoord): void
  dispose(): void
}

const MAX_SURFACES = 16
const MAX_MARKERS = 16
const MAX_VERTICES = 512
const MAX_POLYGON_VERTICES = 128
const MAX_SURFACE_COLORS = 8
const MARKER_RADIUS = 0.55
const MARKER_COLOR = '#df7438'
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9:_-]{1,100}$/.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,160}$/.test(value)
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const tileCoord = (value: unknown): value is TileCoord => plain(value) && exact(value, ['x', 'z']) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.z) && Math.abs(value.x as number) <= 1_000_000 && Math.abs(value.z as number) <= 1_000_000
const point = (value: unknown): value is MetrePoint => plain(value) && exact(value, ['x', 'z']) && finite(value.x, 0, TILE_METRES) && finite(value.z, 0, TILE_METRES)

function cross(a: MetrePoint, b: MetrePoint, c: MetrePoint): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
}

function orient(a: MetrePoint, b: MetrePoint, c: MetrePoint): number {
  const area = cross(a, b, c)
  return Math.abs(area) < 1e-8 ? 0 : area > 0 ? 1 : -1
}

function onSegment(a: MetrePoint, b: MetrePoint, p: MetrePoint): boolean {
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.z >= Math.min(a.z, b.z) && p.z <= Math.max(a.z, b.z)
}

function intersects(a: MetrePoint, b: MetrePoint, c: MetrePoint, d: MetrePoint): boolean {
  const abC = orient(a, b, c), abD = orient(a, b, d), cdA = orient(c, d, a), cdB = orient(c, d, b)
  if (abC !== abD && cdA !== cdB) return true
  return (!abC && onSegment(a, b, c)) || (!abD && onSegment(a, b, d)) || (!cdA && onSegment(c, d, a)) || (!cdB && onSegment(c, d, b))
}

function validate(descriptor: unknown): asserts descriptor is StreetOverlayGeometry {
  if (!plain(descriptor) || !exact(descriptor, ['id', 'tile', 'sourceVersion', 'surfaces', 'markers']) || !token(descriptor.id) || !tileCoord(descriptor.tile) || !version(descriptor.sourceVersion)) throw Error('Invalid street overlay identity')
  if (!Array.isArray(descriptor.surfaces) || descriptor.surfaces.length > MAX_SURFACES || !Array.isArray(descriptor.markers) || descriptor.markers.length > MAX_MARKERS) throw Error('Street overlay exceeds feature limits')
  let vertices = 0
  const colors = new Set<string>()
  for (const surface of descriptor.surfaces) {
    if (!plain(surface) || !exact(surface, ['polygon', 'height', 'color']) || !Array.isArray(surface.polygon) || surface.polygon.length < 3 || surface.polygon.length > MAX_POLYGON_VERTICES || !finite(surface.height, -2, 40) || typeof surface.color !== 'string' || !/^#[\da-fA-F]{6}$/.test(surface.color)) throw Error('Invalid street overlay surface')
    vertices += surface.polygon.length
    colors.add(surface.color.toLowerCase())
    if (colors.size > MAX_SURFACE_COLORS) throw Error('Street overlay uses too many surface colors')
    if (vertices > MAX_VERTICES || !surface.polygon.every(point)) throw Error('Street overlay vertices exceed bounds')
    const polygon = surface.polygon
    if (new Set(polygon.map((p) => `${p.x},${p.z}`)).size !== polygon.length || Math.abs(polygon.reduce((sum, p, i) => { const next = polygon[(i + 1) % polygon.length]!; return sum + p.x * next.z - next.x * p.z }, 0)) < 1e-6) throw Error('Degenerate street overlay polygon')
    for (let i = 0; i < polygon.length; i++) for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue
      if (intersects(polygon[i]!, polygon[(i + 1) % polygon.length]!, polygon[j]!, polygon[(j + 1) % polygon.length]!)) throw Error('Self-intersecting street overlay polygon')
    }
  }
  const markerIds = new Set<string>()
  for (const marker of descriptor.markers) {
    if (!plain(marker) || !exact(marker, ['id', 'label', 'point', 'height']) || !token(marker.id) || markerIds.has(marker.id) || typeof marker.label !== 'string' || marker.label.length < 1 || marker.label.length > 80 || /[\u0000-\u001f\u007f]/.test(marker.label) || !point(marker.point) || marker.point.x < MARKER_RADIUS || marker.point.x > TILE_METRES - MARKER_RADIUS || marker.point.z < MARKER_RADIUS || marker.point.z > TILE_METRES - MARKER_RADIUS || !finite(marker.height, -2, 40)) throw Error('Invalid street overlay marker')
    markerIds.add(marker.id)
  }
}

function triangle(out: number[], a: MetrePoint, ay: number, b: MetrePoint, by: number, c: MetrePoint, cy: number): void {
  // For the x/z ground plane, a positive 2-D cross product faces downward in Three.js.
  if (cross(a, b, c) > 0) out.push(a.x, ay, a.z, c.x, cy, c.z, b.x, by, b.z)
  else out.push(a.x, ay, a.z, b.x, by, b.z, c.x, cy, c.z)
}

function geometry(positions: number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  result.computeVertexNormals()
  return result
}

/** Build an additive tile-local overlay. Caller must load this module only when an overlay is needed. */
export function buildStreetOverlay(input: StreetOverlayGeometry): StreetOverlayView {
  validate(input)
  const descriptor: StreetOverlayGeometry = {
    id: input.id,
    tile: { ...input.tile },
    sourceVersion: input.sourceVersion,
    surfaces: input.surfaces.map((surface) => ({ polygon: surface.polygon.map((p) => ({ ...p })), height: surface.height, color: surface.color.toLowerCase() })),
    markers: input.markers.map((marker) => ({ ...marker, point: { ...marker.point } })),
  }
  const byColor = new Map<string, number[]>()
  for (const surface of descriptor.surfaces) {
    const contour = surface.polygon.map((p) => new THREE.Vector2(p.x, p.z))
    const faces = THREE.ShapeUtils.triangulateShape(contour, [])
    if (!faces.length) throw Error('Street overlay surface could not be triangulated')
    let positions = byColor.get(surface.color)
    if (!positions) { positions = []; byColor.set(surface.color, positions) }
    for (const face of faces) triangle(positions, surface.polygon[face[0]!]!, surface.height, surface.polygon[face[1]!]!, surface.height, surface.polygon[face[2]!]!, surface.height)
  }
  const markerPositions: number[] = []
  for (const marker of descriptor.markers) {
    const { x, z } = marker.point, baseY = marker.height + 0.05, tipY = marker.height + 1.5, radius = MARKER_RADIUS
    const corners = [
      { x: x - radius, z: z - radius }, { x: x + radius, z: z - radius },
      { x: x + radius, z: z + radius }, { x: x - radius, z: z + radius },
    ]
    const tip = { x, z }
    for (let i = 0; i < corners.length; i++) triangle(markerPositions, corners[i]!, baseY, corners[(i + 1) % corners.length]!, baseY, tip, tipY)
    triangle(markerPositions, corners[0]!, baseY, corners[2]!, baseY, corners[1]!, baseY)
    triangle(markerPositions, corners[0]!, baseY, corners[3]!, baseY, corners[2]!, baseY)
  }

  const group = new THREE.Group()
  group.name = `street-overlay:${descriptor.id}`
  group.userData.streetOverlay = { id: descriptor.id, sourceVersion: descriptor.sourceVersion, tile: { ...descriptor.tile }, markers: descriptor.markers.map((marker) => ({ ...marker, point: { ...marker.point } })) }
  const ownedGeometries: THREE.BufferGeometry[] = []
  const ownedMaterials: THREE.Material[] = []
  for (const [color, positions] of byColor) {
    const meshGeometry = geometry(positions), material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    ownedGeometries.push(meshGeometry); ownedMaterials.push(material)
    const mesh = new THREE.Mesh(meshGeometry, material); mesh.name = `surface:${color}`; mesh.frustumCulled = true; group.add(mesh)
  }
  if (markerPositions.length) {
    const markerGeometry = geometry(markerPositions), markerMaterial = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, side: THREE.DoubleSide })
    ownedGeometries.push(markerGeometry); ownedMaterials.push(markerMaterial)
    const mesh = new THREE.Mesh(markerGeometry, markerMaterial); mesh.name = 'markers'; mesh.frustumCulled = true; group.add(mesh)
  }
  const tile = Object.freeze({ ...descriptor.tile })
  let disposed = false
  const rebase = (next: TileCoord): void => {
    if (disposed) return
    if (!tileCoord(next)) throw Error('Invalid street overlay rebase origin')
    const origin = { ...next }
    const absolute = tileOrigin(tile), frame = tileOrigin(origin)
    group.position.set(absolute.x - frame.x, 0, absolute.z - frame.z)
  }
  return {
    group,
    tile,
    attach(parent) { if (disposed) throw Error('Street overlay is disposed'); if (group.parent !== parent) parent.add(group) },
    rebase,
    dispose() {
      if (disposed) return
      disposed = true
      group.parent?.remove(group)
      for (const resource of ownedGeometries) resource.dispose()
      for (const resource of ownedMaterials) resource.dispose()
      ownedGeometries.length = 0; ownedMaterials.length = 0
      group.clear()
    },
  }
}
