import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { project } from '../../src/map3d/geo/frame.ts'
import { encodeArc } from '../../src/map3d/geo/topo.ts'

export const NIGERIA_BOUNDARY_RELEASE = '9469f09'

export const NIGERIA_BOUNDARY_SOURCES = {
  adm1: {
    url: `https://github.com/wmgeolab/geoBoundaries/raw/${NIGERIA_BOUNDARY_RELEASE}/releaseData/gbOpen/NGA/ADM1/geoBoundaries-NGA-ADM1.geojson`,
    sha256: '64fa218ac3d453cc1e66412ff461c5dfa1a4a1ade0da93b239a9891b587d28f9',
    bytes: 2_289_696,
  },
  adm2: {
    url: `https://github.com/wmgeolab/geoBoundaries/raw/${NIGERIA_BOUNDARY_RELEASE}/releaseData/gbOpen/NGA/ADM2/geoBoundaries-NGA-ADM2.geojson`,
    sha256: 'bef7f2cfa45e012f4772eaa61c7b99e5188aeba4d5c6badae7e9f9aae8c02fcd',
    bytes: 9_422_551,
  },
} as const

export type Point = [number, number]
export type Polygon = Point[][]

export interface BoundaryFeature {
  properties: { shapeName: string }
  polygons: Polygon[]
}

export interface BoundaryFeatureCollection {
  features: BoundaryFeature[]
}

export interface RingInput {
  owner: string
  poly: number
  hole: boolean
  pts: Point[]
}

export interface TopologyArc {
  points: Point[]
  owners: Set<string>
}

export interface TopologyRingReference {
  owner: string
  poly: number
  hole: boolean
  ring: number[]
}

export interface BuiltTopology {
  arcs: TopologyArc[]
  refs: TopologyRingReference[]
  grid: number
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export function pointOf(value: unknown, label: string): Point {
  if (!Array.isArray(value) || !finite(value[0]) || !finite(value[1])) {
    throw new TypeError(`${label}: expected a longitude/latitude position`)
  }
  return [value[0], value[1]]
}

function ringOf(value: unknown, label: string): Point[] {
  if (!Array.isArray(value) || value.length < 4) throw new TypeError(`${label}: expected a closed GeoJSON ring`)
  const points = value.map((point, index) => pointOf(point, `${label}[${index}]`))
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) throw new TypeError(`${label}: ring is not closed`)
  const open = points.slice(0, -1)
  if (open.length < 3) throw new TypeError(`${label}: ring has fewer than three vertices`)
  return open
}

function polygonOf(value: unknown, label: string): Polygon {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError(`${label}: expected polygon rings`)
  return value.map((ring, index) => ringOf(ring, `${label}[${index}]`))
}

export function geometryPolygons(value: unknown, label: string): Polygon[] {
  if (!isRecord(value) || (value.type !== 'Polygon' && value.type !== 'MultiPolygon')) {
    throw new TypeError(`${label}: expected Polygon or MultiPolygon geometry`)
  }
  if (!Array.isArray(value.coordinates)) throw new TypeError(`${label}: geometry coordinates are missing`)
  return value.type === 'Polygon'
    ? [polygonOf(value.coordinates, `${label}.coordinates`)]
    : value.coordinates.map((polygon, index) => polygonOf(polygon, `${label}.coordinates[${index}]`))
}

function featureCollectionOf(value: unknown, label: string): BoundaryFeatureCollection {
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new TypeError(`${label}: expected a GeoJSON FeatureCollection`)
  }
  return {
    features: value.features.map((feature, index): BoundaryFeature => {
      if (!isRecord(feature) || feature.type !== 'Feature' || !isRecord(feature.properties) || typeof feature.properties.shapeName !== 'string') {
        throw new TypeError(`${label}.features[${index}]: expected a named GeoJSON feature`)
      }
      return {
        properties: { shapeName: feature.properties.shapeName },
        polygons: geometryPolygons(feature.geometry, `${label}.features[${index}].geometry`),
      }
    }),
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const cacheDirectory = join(root, '.cache', 'geo')
export const NIGERIA_ADM1_COMMITTED_PATH = 'scripts/geo/sources/nigeria-adm1-9469f09.geojson'

export async function loadNigeriaBoundarySource(
  key: keyof typeof NIGERIA_BOUNDARY_SOURCES,
  options: Readonly<{ offline?: boolean }> = {},
): Promise<BoundaryFeatureCollection> {
  const source = NIGERIA_BOUNDARY_SOURCES[key]
  const committed = key === 'adm1' ? join(root, NIGERIA_ADM1_COMMITTED_PATH) : null
  const cached = join(cacheDirectory, `geoBoundaries-NGA-${key.toUpperCase()}-${NIGERIA_BOUNDARY_RELEASE}.geojson`)
  const path = committed && existsSync(committed) ? committed : cached
  if (!existsSync(path)) {
    if (options.offline) throw new Error(`Offline check cannot continue: ${path} is missing`)
    mkdirSync(cacheDirectory, { recursive: true })
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`)
    const partial = `${cached}.${process.pid}.part`
    writeFileSync(partial, Buffer.from(await response.arrayBuffer()))
    renameSync(partial, cached)
  }
  const raw = readFileSync(existsSync(path) ? path : cached)
  if (createHash('sha256').update(raw).digest('hex') !== source.sha256 || raw.length !== source.bytes) {
    throw new Error(`${key}: the file does not match its pinned hash`)
  }
  const parsed: unknown = JSON.parse(raw.toString('utf8'))
  return featureCollectionOf(parsed, key)
}

export const polygonsOf = (feature: BoundaryFeature): Polygon[] => feature.polygons

const unitsOf = ([lon, lat]: Point): Point => {
  const projected = project(lon, lat)
  return [projected.x, projected.z]
}

export function area2(ring: readonly Point[]): number {
  let sum = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!
    const next = ring[(index + 1) % ring.length]!
    sum += current[0] * next[1] - next[0] * current[1]
  }
  return sum
}

const ringKm2 = (ring: readonly Point[]): number => Math.abs(area2(ring.map(unitsOf))) / 2 / 100
const polygonKm2 = (polygon: Polygon): number => ringKm2(polygon[0]!) - polygon.slice(1).reduce((sum, hole) => sum + ringKm2(hole), 0)

export const polygonsKm2 = (polygons: readonly Polygon[]): number =>
  polygons.reduce((sum, polygon) => sum + polygonKm2(polygon), 0)

function visvalingam(points: readonly Point[], threshold: number, keep: number): number[] {
  const length = points.length
  const previous = Int32Array.from({ length }, (_, index) => index - 1)
  const next = Int32Array.from({ length }, (_, index) => index + 1)
  const removed = new Uint8Array(length)
  const version = new Uint32Array(length)
  const xy = points.map(unitsOf)
  const triangleArea = (index: number): number => {
    const a = xy[previous[index]!]!
    const b = xy[index]!
    const c = xy[next[index]!]!
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  }
  const heap: { index: number; area: number; version: number }[] = []
  const push = (index: number): void => {
    const item = { index, area: triangleArea(index), version: ++version[index]! }
    heap.push(item)
    for (let child = heap.length - 1; child > 0;) {
      const parent = (child - 1) >> 1
      if (heap[parent]!.area <= heap[child]!.area) break
      ;[heap[parent], heap[child]] = [heap[child]!, heap[parent]!]
      child = parent
    }
  }
  const pop = (): { index: number; area: number; version: number } => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      for (let parent = 0; ;) {
        const left = 2 * parent + 1
        const right = left + 1
        let smallest = parent
        if (left < heap.length && heap[left]!.area < heap[smallest]!.area) smallest = left
        if (right < heap.length && heap[right]!.area < heap[smallest]!.area) smallest = right
        if (smallest === parent) break
        ;[heap[smallest], heap[parent]] = [heap[parent]!, heap[smallest]!]
        parent = smallest
      }
    }
    return top
  }
  for (let index = 1; index < length - 1; index += 1) push(index)
  let remaining = length
  let floor = 0
  while (heap.length && remaining > keep) {
    const top = pop()
    if (removed[top.index] || top.version !== version[top.index]) continue
    floor = Math.max(floor, top.area)
    if (floor >= threshold) break
    removed[top.index] = 1
    remaining -= 1
    const before = previous[top.index]!
    const after = next[top.index]!
    next[before] = after
    previous[after] = before
    if (before > 0) push(before)
    if (after < length - 1) push(after)
  }
  return Array.from({ length }, (_, index) => index).filter((index) => !removed[index])
}

export function buildTopology(
  inputs: readonly RingInput[],
  grid: number,
  threshold: (owners: ReadonlySet<string>) => number,
): BuiltTopology {
  const vertex = new Map<string, number>()
  const coordinates: Point[] = []
  const rings = inputs.map((input) => input.pts.map((point) => {
    const key = `${point[0]},${point[1]}`
    let id = vertex.get(key)
    if (id === undefined) {
      id = coordinates.length
      vertex.set(key, id)
      coordinates.push(point)
    }
    return id
  }))
  const edgeKey = (a: number, b: number): string => a < b ? `${a}|${b}` : `${b}|${a}`
  const users = new Map<string, Set<number>>()
  rings.forEach((ids, ring) => ids.forEach((id, index) => {
    const key = edgeKey(id, ids[(index + 1) % ids.length]!)
    const set = users.get(key) ?? new Set<number>()
    set.add(ring)
    users.set(key, set)
  }))
  const signature = (a: number, b: number): string => [...users.get(edgeKey(a, b))!].sort((left, right) => left - right).join(',')
  const stored = new Map<string, number>()
  const chains: number[][] = []
  const owners: Set<string>[] = []
  const refs: TopologyRingReference[] = []
  rings.forEach((ids, ringIndex) => {
    const count = ids.length
    const input = inputs[ringIndex]!
    const signatures = ids.map((id, index) => signature(id, ids[(index + 1) % count]!))
    let cuts = ids.map((_, index) => index).filter((index) => signatures[(index - 1 + count) % count] !== signatures[index])
    if (!cuts.length) cuts = [0]
    const ring: number[] = []
    cuts.forEach((from, cutIndex) => {
      const to = cuts[(cutIndex + 1) % cuts.length]!
      const chain = [ids[from]!]
      let index = from
      do {
        index = (index + 1) % count
        chain.push(ids[index]!)
      } while (index !== to)
      const forward = chain.join(',')
      const reverse = [...chain].reverse().join(',')
      const key = forward < reverse ? forward : reverse
      const found = stored.get(key)
      if (found === undefined) {
        stored.set(key, chains.length)
        ring.push(chains.length)
        chains.push(chain)
        owners.push(new Set([input.owner]))
      } else {
        owners[found]!.add(input.owner)
        ring.push(chains[found]!.join(',') === forward ? found : ~found)
      }
    })
    refs.push({ owner: input.owner, poly: input.poly, hole: input.hole, ring })
  })
  const arcs = chains.map((chain, index): TopologyArc => {
    const points = chain.map((id) => coordinates[id]!)
    const closed = chain[0] === chain[chain.length - 1]
    const kept = visvalingam(points, threshold(owners[index]!), closed ? 4 : 2).map((pointIndex) => points[pointIndex]!)
    const quantised: Point[] = []
    for (const [lon, lat] of kept) {
      const point: Point = [Math.round(lon / grid), Math.round(lat / grid)]
      const last = quantised[quantised.length - 1]
      if (!last || last[0] !== point[0] || last[1] !== point[1]) quantised.push(point)
    }
    return { points: quantised, owners: owners[index]! }
  })
  const built: BuiltTopology = { arcs, refs, grid }
  orient(built)
  return built
}

function ringSigned(topology: BuiltTopology, ring: readonly number[]): number {
  const points: Point[] = []
  for (const reference of ring) {
    const arc = topology.arcs[reference < 0 ? ~reference : reference]!.points
    const sequence = reference < 0 ? [...arc].reverse() : arc
    for (let index = 0; index < sequence.length - 1; index += 1) points.push(sequence[index]!)
  }
  return area2(points)
}

function orient(topology: BuiltTopology): void {
  for (const reference of topology.refs) {
    const signed = ringSigned(topology, reference.ring)
    if (reference.hole ? signed < 0 : signed > 0) reference.ring = [...reference.ring].reverse().map((arc) => ~arc)
  }
}

export function topologyPolys(topology: BuiltTopology, owner: string): number[][][] {
  const polygons = new Map<number, { outer: number[]; holes: number[][] }>()
  for (const reference of topology.refs) {
    if (reference.owner !== owner) continue
    const entry = polygons.get(reference.poly) ?? { outer: [], holes: [] }
    if (reference.hole) entry.holes.push(reference.ring)
    else entry.outer = reference.ring
    polygons.set(reference.poly, entry)
  }
  return [...polygons.entries()]
    .sort((left, right) => left[0] - right[0])
    .filter(([, entry]) => entry.outer.length && ringSigned(topology, entry.outer) !== 0)
    .map(([, entry]) => [entry.outer, ...entry.holes])
}

export const topologyArcText = (topology: BuiltTopology): string =>
  topology.arcs.map((arc) => encodeArc(arc.points)).join(',')

export function subsetTopology(topology: BuiltTopology, owners: ReadonlySet<string>): BuiltTopology {
  const refs = topology.refs.filter((reference) => owners.has(reference.owner))
  const used = new Set<number>()
  for (const reference of refs) {
    for (const arc of reference.ring) used.add(arc < 0 ? ~arc : arc)
  }
  const indexes = [...used].sort((left, right) => left - right)
  const remap = new Map(indexes.map((old, index): [number, number] => [old, index]))
  const mapReference = (reference: number): number => {
    const index = remap.get(reference < 0 ? ~reference : reference)
    if (index === undefined) throw new Error(`Arc ${reference} is absent from the selected topology`)
    return reference < 0 ? ~index : index
  }
  return {
    grid: topology.grid,
    arcs: indexes.map((index) => topology.arcs[index]!),
    refs: refs.map((reference) => ({ ...reference, ring: reference.ring.map(mapReference) })),
  }
}

const onSegment = (point: Point, start: Point, end: Point): boolean => {
  const cross = (point[0] - start[0]) * (end[1] - start[1]) - (point[1] - start[1]) * (end[0] - start[0])
  return Math.abs(cross) <= 1e-12
    && point[0] >= Math.min(start[0], end[0]) - 1e-12
    && point[0] <= Math.max(start[0], end[0]) + 1e-12
    && point[1] >= Math.min(start[1], end[1]) - 1e-12
    && point[1] <= Math.max(start[1], end[1]) + 1e-12
}

export function pointInRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index]!
    const previousPoint = ring[previous]!
    if (onSegment(point, previousPoint, currentPoint)) return true
    if ((currentPoint[1] > point[1]) !== (previousPoint[1] > point[1])
      && point[0] < ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) / (previousPoint[1] - currentPoint[1]) + currentPoint[0]) {
      inside = !inside
    }
  }
  return inside
}

export const pointInPolygons = (point: Point, polygons: readonly Polygon[]): boolean =>
  polygons.some((polygon) => pointInRing(point, polygon[0]!) && !polygon.slice(1).some((hole) => pointInRing(point, hole)))

export function ringsFor(owner: string, polygons: readonly Polygon[]): RingInput[] {
  return polygons.flatMap((polygon, poly) => polygon.map((pts, ring): RingInput => ({
    owner,
    poly,
    hole: ring > 0,
    pts,
  })))
}
