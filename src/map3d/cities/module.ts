import { toLocal, fromLocal } from '../geo/frame.ts'
import { pointInPart } from '../lga.ts'
import type { CityModule, LonLatPolygon } from '../../types/content.ts'
import { mapContext } from '../context.ts'
import type { ContextSpec } from '../context.ts'
import type { Box4, CityPack, PackArea, PackDistrict, PackFabric, PackHill, PackLga, PackRail, PackRoad, PackWater, Point2, Rect } from '../types.ts'

const extent = (points: readonly Point2[]): Rect => ({
  minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
  minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])),
})
const area = (ring: readonly Point2[]) => Math.abs(ring.reduce((sum, p, i) => {
  const next = ring[(i + 1) % ring.length]
  return next ? sum + p[0] * next[1] - next[0] * p[1] : sum
}, 0))
/** A deterministic label/fictional-estate point inside the largest real polygon. */
const interior = (parts: readonly (readonly (readonly Point2[])[])[]): Point2 => {
  const largest = [...parts].sort((a, b) => area(b[0] ?? []) - area(a[0] ?? []))[0]
  const outer = largest?.[0]
  if (!largest || !outer?.length) throw new TypeError('A local unit needs a polygon')
  const box = extent(outer), centre: Point2 = [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2]
  if (pointInPart(...centre, largest)) return centre
  let best = outer[0]
  if (!best) throw new TypeError('A local unit needs a polygon vertex')
  let distance = Infinity
  for (let row = 1; row < 40; row++) for (let col = 1; col < 40; col++) {
    const point: Point2 = [box.minX + (box.maxX - box.minX) * col / 40, box.minZ + (box.maxZ - box.minZ) * row / 40]
    const d = Math.hypot(point[0] - centre[0], point[1] - centre[1])
    if (d < distance && pointInPart(...point, largest)) { best = point; distance = d }
  }
  return best
}

/** Roads as a module stores them: name, major (1/0), first longitude and latitude in 0.0001 degrees, then steps (see scripts/geo/build-ibadan-roads.ts). */
export type RoadRows = readonly (readonly (string | number)[])[]
/** What gives a city its look from above, in degrees and kilometres (src/map3d/city-build.ts draws it). All of it is optional. */
export interface ModuleCharacter {
  /** Old and dense areas (brown roofs) or planned and leafy ones: centre, radius in km. */
  areas?: readonly { name: string; lon: number; lat: number; km: number; tone: 'old' | 'planned' }[]
  /** Hills as low mounds: centre, radius in km, rise in map units (about 100 m each). */
  hills?: readonly { name: string; lon: number; lat: number; km: number; rise: number }[]
  /** Lakes (closed rings) and rivers (lines) as lists of [longitude, latitude]. */
  waters?: readonly { name: string; kind: 'lake' | 'river'; line: readonly (readonly [number, number])[]; width?: number }[]
  /** Railway lines as pieces of [longitude, latitude], with their stations. */
  rails?: readonly { name: string; lines: readonly (readonly (readonly [number, number])[])[]; stations: readonly { name: string; lon: number; lat: number }[] }[]
  /** Names of the strongest roads (expressways, ring roads). */
  trunkRoads?: readonly string[]
  /** Venue ids of the city's landmarks: their names are kept longest where labels crowd. */
  notable?: readonly string[]
  /** What the whole-extent view calls itself. */
  extent?: 'state' | 'city'
}
export interface ModuleScene {
  character?: ModuleCharacter
  landmarks?: readonly { id: string; name: string; lon: number; lat: number; kind: string }[]
  roads?: RoadRows
  /** The land around the state, drawn quiet under it (src/map3d/context.ts): a module that names it gets the whole-state view of a state with neighbours. */
  surroundings?: { spec: ContextSpec; planned: readonly string[] }
  /** Display-only shifts, in metres, of a venue's map icon where two sit on almost the same point; the venue keeps its true coordinate in the data. */
  iconOffsets?: Readonly<Record<string, { east: number; north: number }>>
}

function roadsOf(rows: RoadRows, origin: CityModule['rules']['mapOrigin'], trunk: ReadonlySet<string>): PackRoad[] {
  const out: PackRoad[] = []
  rows.forEach((row, index) => {
    const [name, major, x0, y0, ...steps] = row as [string, number, number, number, ...number[]]
    let x = x0, y = y0
    const points: Point2[] = [toLocal(origin, x / 1e4, y / 1e4)]
    for (let i = 0; i + 1 < steps.length; i += 2) { x += steps[i]!; y += steps[i + 1]!; points.push(toLocal(origin, x / 1e4, y / 1e4)) }
    if (points.length > 1) out.push({ id: `road-${index}`, name, ...(major || trunk.has(name) ? { major: true } : {}), ...(trunk.has(name) ? { trunk: true } : {}), points })
  })
  return out
}

/** The same shared-frame renderer for authored city modules; no second projection or outline. */
export async function createModulePack(module: CityModule, scene: ModuleScene['landmarks'] | ModuleScene = {}): Promise<CityPack> {
  const { landmarks = [], roads: roadRows = [], surroundings, character = {}, iconOffsets = {} } = Array.isArray(scene) ? { landmarks: scene } as ModuleScene : scene as ModuleScene
  const [content, map] = await Promise.all([module.loadContent(), module.loadMap()])
  const geometry = await map.loadGeometry(), origin = map.origin
  const local = (parts: readonly LonLatPolygon[]): Point2[][][] => parts.map(part => part.map(ring => ring.map(([lon, lat]) => toLocal(origin, lon, lat))))
  const shapes = Object.fromEntries(Object.entries(geometry.localUnits).map(([id, parts]) => [id, local(parts)]))
  const land = Object.entries(shapes).flatMap(([id, parts]) => parts.flatMap((part, i) => {
    const points = part[0]
    return points ? [{ id: `${id}-${i}`, kind: 'mainland' as const, exact: true, points, holes: part.slice(1) }] : []
  }))
  const fit = extent(local(geometry.playArea).flatMap(part => part[0] ?? []))
  const lgas: PackLga[] = module.rules.units.map(unit => {
    const parts = shapes[unit.id]
    if (!parts?.length) throw new TypeError(`Missing geometry for ${unit.id}`)
    const polygon = [...parts].sort((a, b) => area(b[0] ?? []) - area(a[0] ?? []))[0]?.[0]
    if (!polygon) throw new TypeError(`Empty geometry for ${unit.id}`)
    const plate = interior(parts), box = extent(parts.flatMap(part => part[0] ?? []))
    const nw = fromLocal(origin, box.minX, box.minZ), se = fromLocal(origin, box.maxX, box.maxZ), at = fromLocal(origin, ...plate)
    const line = content.localUnitDescriptions[unit.id]
    if (typeof line !== 'string') throw new TypeError(`Missing description for ${unit.id}`)
    return { ...unit, line, polygon, polygons: parts, plate, tint: '#baad87', geo: { c: [at.lat, at.lon], box: [se.lat, nw.lon, nw.lat, se.lon] } }
  })
  const sites = Object.fromEntries(content.venues.filter(venue => venue.id !== 'home').map(venue => {
    if (venue.position.kind !== 'lon-lat') throw new TypeError(`A new city needs geographic venue coordinates: ${venue.id}`)
    const shift = iconOffsets[venue.id], lat = venue.position.lat
    const [x, z] = toLocal(origin, venue.position.lon + (shift ? shift.east / (111320 * Math.cos(lat * Math.PI / 180)) : 0), lat + (shift ? shift.north / 110574 : 0))
    return [venue.id, { x, z }]
  }))
  const homes = Object.fromEntries(content.housing.map(home => {
    const district = module.rules.districts.find(item => item.id === home.districtId)
    const unit = lgas.find(item => item.id === district?.localUnitId)
    if (!unit) throw new TypeError(`Missing home district: ${home.definition.id}`)
    return [home.definition.id, { x: unit.plate[0], z: unit.plate[1], district: district?.name ?? unit.name }]
  }))
  const visible = Object.values(sites).map(({ x, z }): Point2 => [x, z]), core = extent(visible)
  const nw = fromLocal(origin, fit.minX, fit.minZ), se = fromLocal(origin, fit.maxX, fit.maxZ)
  const box: Box4 = [se.lat, nw.lon, nw.lat, se.lon]
  const km = (value: number) => value * 10
  const spot = (lon: number, lat: number): Point2 => toLocal(origin, lon, lat)
  const areas: PackArea[] = (character.areas ?? []).map(item => { const [x, z] = spot(item.lon, item.lat); return { name: item.name, x, z, r: km(item.km), tone: item.tone } })
  const relief: PackHill[] = (character.hills ?? []).map(item => { const [x, z] = spot(item.lon, item.lat); return { name: item.name, x, z, r: km(item.km), h: item.rise } })
  const waters: PackWater[] = (character.waters ?? []).map(item => ({ name: item.name, kind: item.kind, ...(item.width ? { width: item.width } : {}), points: item.line.map(([lon, lat]) => spot(lon, lat)) }))
  const inside = (p: Point2) => p[0] >= fit.minX && p[0] <= fit.maxX && p[1] >= fit.minZ && p[1] <= fit.maxZ
  const rails: PackRail[] = (character.rails ?? []).flatMap(item => item.lines.map((line, i): PackRail => ({
    name: item.name, points: line.map(([lon, lat]) => spot(lon, lat)).filter(inside), stations: item.stations.map((st): { name: string; x: number; z: number } => { const [x, z] = spot(st.lon, st.lat); return { name: st.name, x, z } }).filter(st => line.some(([lon, lat]) => { const [x, z] = spot(lon, lat); return Math.hypot(x - st.x, z - st.z) < 3 })),
  }))).filter(rail => rail.points.length > 1)
  // Old areas read as dense brown-roofed fabric, planned ones as leafy villas; they are listed before the local governments so they own their ground.
  const RUST = ['#a0522d', '#8b4a2b', '#b5651d', '#9a5b34', '#7d4a2e', '#a8683f']
  const characterFabric: PackFabric[] = areas.map(item => ({ box: [item.x - item.r, item.z - item.r, item.x + item.r, item.z + item.r], circle: [item.x, item.z, item.r], style: item.tone === 'old' ? 'dense' : 'villas', keep: item.tone === 'old' ? 0.25 : 0.05, ...(item.tone === 'old' ? { roofs: RUST } : {}) }))
  // Ground name plates for the landmarks that are not venues: none that would lie across another plate or over a venue.
  const plateRoom = (name: string, size: number) => name.length * size * 0.9
  const plates: PackDistrict[] = []
  for (const item of landmarks.filter(item => item.kind !== 'route-reference' && !content.venues.some(venue => venue.id === item.id))) {
    const [x, z] = toLocal(origin, item.lon, item.lat), plate = { name: item.name, x, z, size: 1.4, water: item.kind === 'water' }
    const room = plateRoom(plate.name, plate.size) / 2 + 3
    const clash = plates.some(other => Math.abs(other.x - x) < room + plateRoom(other.name, other.size) / 2 && Math.abs(other.z - z) < 4)
      || Object.values(sites).some(site => Math.abs(site.x - x) < room + 4 && Math.abs(site.z - z) < 6)
    if (plate.water || !clash) plates.push(plate)
  }
  const context = surroundings ? mapContext(origin, fit, surroundings.planned, 2600, surroundings.spec) : undefined
  return {
    id: module.id, name: module.rules.name, inland: module.rules.seaPlots === false,
    frame: { origin, unitsPerKm: 10 }, roadScale: 0.45,
    bounds: { ...fit, minX: fit.minX - 30, maxX: fit.maxX + 30, minZ: fit.minZ - 30, maxZ: fit.maxZ + 30, fit,
      sea: { x0: fit.minX, x1: fit.minX, z0: fit.maxZ, z1: fit.maxZ + 26 } },
    core: { minX: core.minX - 15, maxX: core.maxX + 15, minZ: core.minZ - 15, maxZ: core.maxZ + 15 },
    land, lgas, sites, homes, roads: roadsOf(roadRows, origin, new Set(character.trunkRoads ?? [])), soon: {}, zones: [],
    ...(areas.length ? { areas } : {}), ...(relief.length ? { relief } : {}), ...(waters.length ? { waters } : {}), ...(rails.length ? { rails } : {}), ...(character.extent ? { extent: character.extent } : {}), ...(character.notable?.length ? { notable: character.notable } : {}),
    ...(context ? { context } : {}),
    districts: plates,
    fabric: [...characterFabric, ...lgas.map(unit => { const b = extent(unit.polygon); return { box: [b.minX, b.minZ, b.maxX, b.maxZ] as Box4, style: unit.districts?.length ? 'dense' as const : 'green' as const } })],
    estates: Object.fromEntries(lgas.map(unit => [unit.id, { x: unit.plate[0], z: unit.plate[1], cols: 8, max: 64 }])),
    geo: { box }, decorate() {},
  }
}
