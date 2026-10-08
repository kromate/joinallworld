import { inLga } from '../map3d/lga.ts'
import { buildNetwork } from '../map3d/roads.ts'
import type { CityPack } from '../map3d/types.ts'
import { GROUND_CELL, mapPointToMetres, QUANTUM, tileKey, tileOf, tileOrigin, TILE_METRES } from './frame.ts'
import type { DoorTarget, EstateGateSeed, GenerationIssue, MetrePoint, SourceKind, StreetDoor, StreetSource, TileCoord, WireStreetTile, EstatePortalMapping } from './types.ts'

interface Segment { id: string; name: string; source: SourceKind; width: number; bridge: boolean; a: MetrePoint; b: MetrePoint }
interface Building { id: string; source: 'generated-fabric' | 'generated-venue'; height: number; points: MetrePoint[] }
const finitePoint = (point: MetrePoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.z)
function inside(point: MetrePoint, polygon: readonly MetrePoint[]): boolean {
  let contained = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const a = polygon[i], b = polygon[j]; if (a && b && (a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) contained = !contained }
  return contained
}
const hash = (text: string): number => { let n = 2166136261; for (const char of text) n = Math.imul(n ^ char.charCodeAt(0), 16777619); return n >>> 0 }
function distance(point: MetrePoint, a: MetrePoint, b: MetrePoint): number { const dx = b.x - a.x, dz = b.z - a.z, squared = dx * dx + dz * dz, t = squared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / squared)) : 0; return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz) }
function clipped(a: MetrePoint, b: MetrePoint, origin: MetrePoint, margin = 0): [MetrePoint, MetrePoint] | null {
  let lo = 0, hi = 1; const dx = b.x - a.x, dz = b.z - a.z;
  const edges: [number, number][] = [[-dx, a.x - origin.x + margin], [dx, origin.x + 128 + margin - a.x], [-dz, a.z - origin.z + margin], [dz, origin.z + 128 + margin - a.z]]
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue }
    const t = q / p; if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t); if (lo > hi) return null
  }
  return [{ x: a.x + dx * lo, z: a.z + dz * lo }, { x: a.x + dx * hi, z: a.z + dz * hi }]
}
function polygonClip(points: readonly MetrePoint[], origin: MetrePoint): MetrePoint[] {
  let current = [...points]
  for (const [axis, edge, sign] of [['x', origin.x, 1], ['x', origin.x + 128, -1], ['z', origin.z, 1], ['z', origin.z + 128, -1]] as const) {
    const result: MetrePoint[] = []
    for (let i = 0; i < current.length; i++) {
      const a = current[i], b = current[(i + 1) % current.length]; if (!a || !b) continue
      const inA = sign * (a[axis] - edge) >= 0, inB = sign * (b[axis] - edge) >= 0
      if (inA) result.push(a)
      if (inA !== inB) { const t = (edge - a[axis]) / (b[axis] - a[axis]); result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }) }
    }
    current = result
  }
  return current
}

/** Offline only: nothing imports map loaders here, and decorate() is never executed. */
export function createStreetSource(pack: CityPack, options: { version: string; venues: readonly string[]; gates?: readonly EstateGateSeed[]; roadSource?: SourceKind; maxTiles?: number; estatePortals?: boolean }): StreetSource {
  mapPointToMetres(pack, { x: 0, z: 0 })
  const scale = 1000 / (pack.frame?.unitsPerKm ?? 10), issues: GenerationIssue[] = []
  const roads = pack.roads.filter(road => { const valid = road.points.length >= 2 && road.points.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)); if (!valid) issues.push({ code: 'invalid-road', id: road.id, detail: 'Invalid centreline omitted.' }); return valid })
  const network = buildNetwork({ ...pack, roads }, { door: 2 / scale })
  const segments: Segment[] = [], index = new Map<string, Segment[]>(), coords = new Map<string, TileCoord>(), doors: StreetDoor[] = [], siteBuildings: Building[] = []
  const land = pack.land.map(shape => ({ outer: shape.points.map(([x, z]) => ({ x: x * scale, z: z * scale })), holes: (shape.holes ?? []).map(hole => hole.map(([x, z]) => ({ x: x * scale, z: z * scale }))) }))
  const water = (pack.water ?? []).map(shape => ({ outer: shape.points.map(([x, z]) => ({ x: x * scale, z: z * scale })), holes: (shape.holes ?? []).map(hole => hole.map(([x, z]) => ({ x: x * scale, z: z * scale }))) }))
  const onLand = (point: MetrePoint): boolean => !water.some(shape => inside(point, shape.outer) && !shape.holes.some(hole => inside(point, hole))) && (pack.inland === true || land.some(shape => inside(point, shape.outer) && !shape.holes.some(hole => inside(point, hole))))
  function addTile(at: TileCoord): string { const key = tileKey(at); if (!coords.has(key)) { if (coords.size >= (options.maxTiles ?? 50000)) throw Error('Sparse street index exceeded its tile cap'); coords.set(key, at) } return key }
  function addSegment(segment: Segment): void {
    segments.push(segment); const visited = new Set<string>(), steps = Math.max(1, Math.ceil(Math.hypot(segment.b.x - segment.a.x, segment.b.z - segment.a.z) / 64))
    for (let i = 0; i <= steps; i++) { const at = tileOf({ x: segment.a.x + (segment.b.x - segment.a.x) * i / steps, z: segment.a.z + (segment.b.z - segment.a.z) * i / steps });
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) { const tile = { x: at.x + x, z: at.z + z }, key = tileKey(tile); if (visited.has(key) || !clipped(segment.a, segment.b, tileOrigin(tile), segment.width / 2 + 10)) continue; visited.add(key); addTile(tile); const held = index.get(key) ?? []; held.push(segment); index.set(key, held) }
    }
  }
  network.roads.forEach((road, roadIndex) => { for (let i = 1; i < road.points.length; i++) { const a = road.points[i - 1], b = road.points[i]; if (a && b) addSegment({ id: `road:${pack.id}:${roadIndex}`, name: road.name.slice(0, 160), source: options.roadSource ?? 'authored', width: road.trunk ? 18 : road.major ? 12 : 8, bridge: Boolean(road.bridge), a: { x: a.x * scale, z: a.z * scale }, b: { x: b.x * scale, z: b.z * scale } }) } })
  const routeIds = new Map<string, string>()
  function addDoor(id: string, routeId: string, centre: MetrePoint, target: DoorTarget): void {
    const gate = network.places[routeId]?.gate
    if (!gate) { issues.push({ code: 'disconnected-door', id, detail: 'No road attachment; timed travel remains available.' }); return }
    const end = { x: gate.x * scale, z: gate.z * scale }, length = Math.hypot(end.x - centre.x, end.z - centre.z), ux = length ? (end.x - centre.x) / length : 0, uz = length ? (end.z - centre.z) / length : 1
    const at = { x: centre.x + ux * 2, z: centre.z + uz * 2 }, approach = { x: centre.x + ux * 4, z: centre.z + uz * 4 }
    const samples = Math.ceil(length)
    if (length > 2048 || !onLand(approach) || Array.from({ length: Math.min(samples + 1, 2049) }, (_, i) => ({ x: centre.x + (end.x - centre.x) * i / Math.max(1, samples), z: centre.z + (end.z - centre.z) * i / Math.max(1, samples) })).some(point => !onLand(point))) { issues.push({ code: 'disconnected-door', id, detail: 'Generated approach exceeds 2 km or crosses unmapped water; timed travel remains available.' }); return }
    doors.push({ id, target, at, approach, source: 'generated' }); routeIds.set(id, routeId); addTile(tileOf(approach)); addSegment({ id: `approach:${id}`, name: 'Generated access path', source: 'generated', width: 2.4, bridge: false, a: approach, b: end })
    if (target.kind === 'venue') siteBuildings.push({ id: `site:${id}`, source: 'generated-venue', height: 3.4, points: [-1, 1].flatMap(side => [{ x: centre.x + ux * side * 2 - uz * 2, z: centre.z + uz * side * 2 + ux * 2 }, { x: centre.x + ux * side * 2 + uz * 2, z: centre.z + uz * side * 2 - ux * 2 }]).sort((a, b) => Math.atan2(a.z - centre.z, a.x - centre.x) - Math.atan2(b.z - centre.z, b.x - centre.x)) })
  }
  for (const venue of [...new Set(options.venues)].sort()) { const point = pack.sites[venue]; if (!point || !finitePoint(point)) { issues.push({ code: 'missing-site', id: venue, detail: 'No finite CityPack venue site.' }); continue } addDoor(`venue:${pack.id}:${venue}`, venue, mapPointToMetres(pack, point), { kind: 'venue', venue }) }
  const portals: EstatePortalMapping[] = []
  const groundRoads = segments.filter(segment => !segment.bridge && segment.source !== 'generated')
  interface Candidate { point: MetrePoint; road: Segment; lga: string | null }
  const candidates: Candidate[] = [], byLga = new Map<string, Candidate[]>()
  const validPortal = (point: MetrePoint): boolean => onLand(point) && onLand({ x: Math.floor(point.x / 2) * 2 + 1, z: Math.floor(point.z / 2) * 2 + 1 })
  if (options.estatePortals) for (const road of groundRoads) {
    const steps = Math.max(1, Math.ceil(Math.hypot(road.b.x - road.a.x, road.b.z - road.a.z) / 32))
    for (let i = 0; i <= steps; i++) {
      const point = { x: Math.round((road.a.x + (road.b.x - road.a.x) * i / steps) * 100) / 100, z: Math.round((road.a.z + (road.b.z - road.a.z) * i / steps) * 100) / 100 }
      if (!validPortal(point)) continue
      const lga = pack.lgas.find(unit => inLga(unit, point.x / scale, point.z / scale))?.id ?? null, candidate = { point, road, lga }
      candidates.push(candidate); if (lga) { const pool = byLga.get(lga) ?? []; pool.push(candidate); byLga.set(lga, pool) }
    }
  }
  for (const seed of [...(options.gates ?? [])].sort((a, b) => `${a.lga}:${a.estate}`.localeCompare(`${b.lga}:${b.estate}`))) {
    if (!finitePoint(seed.point) || !pack.lgas.some(lga => lga.id === seed.lga) || !Number.isInteger(seed.estate) || seed.estate < 0 || seed.estate >= 512) throw Error('Invalid generated estate gate seed')
    const id = `estate:${pack.id}:${seed.lga}:${seed.estate}`
    if (!options.estatePortals) { network.attachPlace(id, { x: seed.point.x / scale, z: seed.point.z / scale }); addDoor(id, id, seed.point, { kind: 'estate', lga: seed.lga, estate: seed.estate }); continue }
    // These are virtual-address portals on existing ground roads, never a claim that the
    // compact map estate has a surveyed physical road connection. Prefer its own LGA.
    const local = byLga.get(seed.lga), pool = local?.length ? local : candidates
    let best: Candidate | null = null, closest = Infinity
    for (const candidate of pool) { const d = Math.hypot(candidate.point.x - seed.point.x, candidate.point.z - seed.point.z); if (d < closest) { best = candidate; closest = d } }
    if (!best) { issues.push({ code: 'disconnected-door', id, detail: 'No valid existing ground-road portal approach; timed travel remains available.' }); continue }
    // Refine the selected road candidate to its exact closest centreline point when that
    // point passes the same land/grid/LGA checks. Boundary candidates retain the 32m sample.
    const dx = best.road.b.x - best.road.a.x, dz = best.road.b.z - best.road.a.z, t = Math.max(0, Math.min(1, ((seed.point.x - best.road.a.x) * dx + (seed.point.z - best.road.a.z) * dz) / (dx * dx + dz * dz || 1)))
    const refined = { x: Math.round((best.road.a.x + dx * t) * 100) / 100, z: Math.round((best.road.a.z + dz * t) * 100) / 100 }, owner = pack.lgas.find(unit => inLga(unit, refined.x / scale, refined.z / scale))?.id ?? null
    if (validPortal(refined) && (!local?.length || owner === seed.lga)) best = { ...best, point: refined, lga: owner }
    const approach = { x: Math.round(best.point.x * 100) / 100, z: Math.round(best.point.z * 100) / 100 }, length = Math.hypot(dx, dz) || 1
    if (!validPortal(approach)) { issues.push({ code: 'disconnected-door', id, detail: 'Quantized portal approach is not on valid ground.' }); continue }
    const at = { x: approach.x - dz / length * 3, z: approach.z + dx / length * 3 }
    doors.push({ id, target: { kind: 'estate', lga: seed.lga, estate: seed.estate }, source: 'generated', at, approach }); addTile(tileOf(approach))
    network.attachPlace(id, { x: approach.x / scale, z: approach.z / scale }); routeIds.set(id, id)
    const roadLga = pack.lgas.find(unit => inLga(unit, approach.x / scale, approach.z / scale))?.id ?? null
    portals.push({ lga: seed.lga, estate: seed.estate, requested: seed.point, anchor: approach, roadId: best.road.id, roadLga, crossLga: roadLga !== seed.lga, displacementMetres: Math.hypot(approach.x - seed.point.x, approach.z - seed.point.z) })
  }

  function tile(at: TileCoord): WireStreetTile {
    const origin = tileOrigin(at), nearby = index.get(tileKey(at)) ?? [], q = (point: MetrePoint): number[] => [Math.round(point.x * 100) - origin.x * 100, Math.round(point.z * 100) - origin.z * 100]
    const buildings = siteBuildings.filter(building => polygonClip(building.points, origin).length >= 3)
    for (let gx = Math.floor((origin.x - 8) / 24); gx <= Math.floor((origin.x + 136) / 24); gx++) for (let gz = Math.floor((origin.z - 8) / 24); gz <= Math.floor((origin.z + 136) / 24); gz++) {
      const centre = { x: (gx + 0.5) * 24, z: (gz + 0.5) * 24 }, map = { x: centre.x / scale, z: centre.z / scale }, fabric = pack.fabric.find(area => map.x >= area.box[0] && map.x <= area.box[2] && map.z >= area.box[1] && map.z <= area.box[3] && (!area.circle || Math.hypot(map.x - area.circle[0], map.z - area.circle[1]) <= area.circle[2]))
      if (!fabric || fabric.style === 'green' || hash(`${pack.id}:${gx}:${gz}`) / 0xffffffff > Math.min(0.8, 0.5 + (fabric.keep ?? 0)) || !onLand(centre) || nearby.some(road => distance(centre, road.a, road.b) < road.width / 2 + 10) || siteBuildings.some(building => distance(centre, building.points[0] ?? centre, building.points[2] ?? centre) < 12)) continue
      const points = [{ x: centre.x - 6, z: centre.z - 5 }, { x: centre.x + 6, z: centre.z - 5 }, { x: centre.x + 6, z: centre.z + 5 }, { x: centre.x - 6, z: centre.z + 5 }]
      if (points.every(onLand)) buildings.push({ id: `fabric:${pack.id}:${gx}:${gz}`, source: 'generated-fabric', height: fabric.style === 'towers' ? 30 : fabric.style === 'dense' ? 9 : 6, points })
    }
    const ground = Array<number>(128).fill(0)
    for (let row = 0; row < 64; row++) for (let col = 0; col < 64; col++) { const point = { x: origin.x + (col + 0.5) * GROUND_CELL, z: origin.z + (row + 0.5) * GROUND_CELL }; if ((onLand(point) || nearby.some(road => road.bridge && distance(point, road.a, road.b) <= road.width / 2)) && !buildings.some(building => inside(point, building.points))) { const word = row * 2 + Math.floor(col / 32); ground[word] = ((ground[word] ?? 0) | (1 << (col % 32))) >>> 0 } }
    return { v: 1, city: pack.id, version: options.version, tile: [at.x, at.z], ground,
      roads: nearby.flatMap(segment => { const points = clipped(segment.a, segment.b, origin); return points ? [{ id: segment.id, name: segment.name, source: segment.source, width: Math.round(segment.width * QUANTUM), bridge: segment.bridge, points: points.flatMap(q) }] : [] }),
      buildings: buildings.flatMap(building => { const points = polygonClip(building.points, origin); return points.length >= 3 ? [{ id: building.id, source: building.source, height: Math.round(building.height * 100), footprint: points.flatMap(q) }] : [] }),
      doors: doors.filter(door => tileKey(tileOf(door.approach)) === tileKey(at)).map((door): WireStreetTile['doors'][number] => { const where = q(door.at), approach = q(door.approach); return { id: door.id, target: door.target, source: 'generated', at: [where[0] ?? 0, where[1] ?? 0], approach: [approach[0] ?? 0, approach[1] ?? 0] } }) }
  }
  return { city: pack.id, version: options.version, tiles: [...coords.values()].sort((a, b) => a.x - b.x || a.z - b.z), doors, issues, portals, tile,
    route(from, to) { const a = routeIds.get(from), b = routeIds.get(to); if (!a || !b) return null; const route = network.route(a, b), first = doors.find(door => door.id === from), last = doors.find(door => door.id === to); return route && first && last ? [first.approach, ...route.points.slice(1, -1).map(point => ({ x: point.x * scale, z: point.z * scale })), last.approach] : null } }
}

/** Conservative public projected mask/road/box recipe: public venues plus one own estate door. */
export const estimatedTileTriangles = (tile: WireStreetTile): number => 64 * 64 * 2 + tile.roads.reduce((sum, road) => sum + Math.max(0, road.points.length / 2 - 1) * 2, 0) + tile.buildings.length * 160 + (tile.doors.filter(door => door.target.kind === 'venue').length + Number(tile.doors.some(door => door.target.kind === 'estate'))) * 24
