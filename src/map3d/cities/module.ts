import { toLocal, fromLocal } from '../geo/frame.ts'
import { pointInPart } from '../lga.ts'
import type { CityModule, LonLatPolygon } from '../../types/content.ts'
import type { Box4, CityPack, PackLga, Point2, Rect } from '../types.ts'

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

/** The same shared-frame renderer for authored city modules; no second projection or outline. */
export async function createModulePack(module: CityModule, landmarks: readonly { id: string; name: string; lon: number; lat: number; kind: string }[] = []): Promise<CityPack> {
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
    return { ...unit, polygon, polygons: parts, plate, tint: '#baad87', geo: { c: [at.lat, at.lon], box: [se.lat, nw.lon, nw.lat, se.lon] } }
  })
  const sites = Object.fromEntries(content.venues.filter(venue => venue.id !== 'home').map(venue => {
    if (venue.position.kind !== 'lon-lat') throw new TypeError(`A new city needs geographic venue coordinates: ${venue.id}`)
    const [x, z] = toLocal(origin, venue.position.lon, venue.position.lat)
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
  return {
    id: module.id, name: module.rules.name, inland: module.rules.seaPlots === false,
    frame: { origin, unitsPerKm: 10 }, roadScale: 0.45,
    bounds: { ...fit, minX: fit.minX - 30, maxX: fit.maxX + 30, minZ: fit.minZ - 30, maxZ: fit.maxZ + 30, fit,
      sea: { x0: fit.minX, x1: fit.minX, z0: fit.maxZ, z1: fit.maxZ + 26 } },
    core: { minX: core.minX - 15, maxX: core.maxX + 15, minZ: core.minZ - 15, maxZ: core.maxZ + 15 },
    land, lgas, sites, homes, roads: [], soon: {}, zones: [],
    districts: [...lgas.map(unit => ({ name: unit.name, x: unit.plate[0], z: unit.plate[1], size: 2 })), ...landmarks.filter(item => !content.venues.some(venue => venue.id === item.id)).map(item => { const [x, z] = toLocal(origin, item.lon, item.lat); return { name: item.name, x, z, size: 1.4, water: item.kind === 'water' } })],
    fabric: lgas.map(unit => { const b = extent(unit.polygon); return { box: [b.minX, b.minZ, b.maxX, b.maxZ], style: unit.districts?.length ? 'dense' : 'green' } }),
    estates: Object.fromEntries(lgas.map(unit => [unit.id, { x: unit.plate[0], z: unit.plate[1], cols: 8, max: 64 }])),
    geo: { box }, decorate() {},
  }
}
