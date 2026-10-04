/**
 * OWNER: world
 * THE SAME CITY, SEEN FROM STRAIGHT ABOVE. The flat ("Simple") map is not a second drawing of the
 * city: it is generated here from the same city pack the 3D map is built from — the same land
 * outlines (rounded the same way), the same smoothed roads and bridges, the same local-government
 * boundaries and tints, the same venue, home and coming-soon positions. Switching maps is tilting
 * one map, not opening another.
 *
 *   flatModel(pack, network, { venues, soon }) → {
 *     box: { x, z, width, height }                      the board, in map units (x east, z south: north is up)
 *     land: [{ id, kind, d }]   roads: [{ id, name, major, bridge, d, width }]
 *     lgas: [{ id, name, tint, d, plate: [x, z] }]      zones: [{ id, x, z, width, height }]
 *     places: [{ id, kind, x, z }]                      names: [{ name, x, z, size, water }]
 *   }
 *   flatSvg(model, { lgas }) → the backdrop as an SVG string (viewBox in map units)
 * Pure strings and numbers: no DOM, so `node --test` checks it against the 3D build
 * (src/map3d/map3d.test.js: every venue, road, bridge and local government, at the same place).
 */
import { landOf } from './lga.ts';
import type { Network } from './roads.ts';
import type { CityPack, LandKind, PackBounds, PackSoon, Point2, Point3, XZ } from './types.ts';

export interface FlatLand { id: string; kind: LandKind; d: string }
export interface FlatRoad { id: string; name: string; major: boolean; bridge: boolean; d: string; width: number; from: Point3; to: Point3 }
export interface FlatLga { id: string; name: string; tint: string; d: string; plate: Point2 }
export interface FlatZone { id: string; x: number; z: number; width: number; height: number }
export interface FlatPlace { id: string; kind: 'venue' | 'soon'; x: number; z: number }
export interface FlatName { name: string; x: number; z: number; size: number; water: boolean }
/** The board, in map units (x east, z south: north is up). */
export interface FlatBox { x: number; z: number; width: number; height: number }
export interface FlatModel {
  id: string
  name: string
  box: FlatBox
  land: FlatLand[]
  roads: FlatRoad[]
  lgas: FlatLga[]
  zones: FlatZone[]
  places: FlatPlace[]
  homes: Record<string, { x: number; z: number; district: string }>
  names: FlatName[]
  sea: PackBounds['sea'] | null
}

const fixed = (value: number) => (Math.round(value * 100) / 100).toString();
const path = (points: readonly (Point2 | XZ)[], close = false) => `${points.map((point, i) => `${i ? 'L' : 'M'}${fixed('x' in point ? point.x : point[0])} ${fixed('z' in point ? point.z : point[1])}`).join('')}${close ? 'Z' : ''}`;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!);
/** The ground colours of the 3D build (src/map3d/city-build.js LAND_COLOURS), so both maps are the same green. */
export const FLAT_COLOURS = { water: '#4faacb', shallows: '#7cc6d6', rim: '#ecdcae', mainland: '#bcd596', island: '#c6dca2', estate: '#b2d892', sand: '#f1dfae', asphalt: '#5d626b', kerb: '#e4dfcf', dash: '#f6f2e2', parapet: '#efe9da' };

export function flatModel(pack: CityPack, network: Pick<Network, 'roads'>, { venues = {}, soon = {} }: { venues?: object; soon?: object } = {}): FlatModel {
  const { minX, maxX, minZ, maxZ } = pack.bounds;
  const places: FlatPlace[] = [];
  for (const [id, spot] of Object.entries(pack.sites)) if ((venues as Record<string, unknown>)[id]) places.push({ id, kind: 'venue', x: spot.x, z: spot.z });
  for (const [id, spot] of Object.entries<PackSoon>(pack.soon || {})) if ((soon as Record<string, unknown>)[id]) places.push({ id, kind: 'soon', x: spot.x, z: spot.z });
  return {
    id: pack.id, name: pack.name,
    box: { x: minX, z: minZ, width: maxX - minX, height: (pack.bounds.sea ? pack.bounds.sea.z1 + 4 : maxZ) - minZ },
    land: landOf(pack).map((entry) => ({ id: entry.id, kind: entry.kind, d: path(entry.polygon, true) })),
    roads: network.roads.map((road) => ({ id: road.id, name: road.name, major: road.major, bridge: road.bridge > 0, d: path(road.points), width: road.major ? 2.5 : 1.8, from: road.points[0]!, to: road.points[road.points.length - 1]! })),
    lgas: (pack.lgas || []).map((lga) => ({ id: lga.id, name: lga.name, tint: lga.tint, d: path(lga.polygon, true), plate: lga.plate })),
    zones: Object.entries<PackSoon>(pack.soon || {}).map(([id, spot]) => ({ id, x: spot.zone[0], z: spot.zone[1], width: spot.zone[2] - spot.zone[0], height: spot.zone[3] - spot.zone[1] })),
    places,
    homes: Object.fromEntries(Object.entries(pack.homes).map(([id, spot]) => [id, { x: spot.x, z: spot.z, district: spot.district }])),
    names: (pack.districts || []).map((plate) => ({ name: plate.name, x: plate.x, z: plate.z, size: plate.size || 2, water: Boolean(plate.water) })),
    sea: pack.bounds.sea || null,
  };
}

export function flatSvg(model: FlatModel): string {
  const { box } = model, c = FLAT_COLOURS;
  const land = (kind: string) => model.land.filter((entry) => (kind === 'sand') === (entry.kind === 'sand'));
  const ground = [...land('other'), ...land('sand')];
  const roads = model.roads.filter((road) => !road.bridge), bridges = model.roads.filter((road) => road.bridge);
  const stroke = (road: FlatRoad, colour: string, extra: number, more = '') => `<path d="${road.d}" data-road="${esc(road.id)}" fill="none" stroke="${colour}" stroke-width="${fixed(road.width + extra)}" stroke-linecap="round" stroke-linejoin="round" ${more}/>`;
  return `<svg class="m3-flat-art" viewBox="${fixed(box.x)} ${fixed(box.z)} ${fixed(box.width)} ${fixed(box.height)}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><clipPath id="m3-flat-land-${esc(model.id)}">${model.land.map((entry) => `<path d="${entry.d}"/>`).join('')}</clipPath></defs>
    <rect x="${fixed(box.x)}" y="${fixed(box.z)}" width="${fixed(box.width)}" height="${fixed(box.height)}" fill="${c.water}"/>
    <g fill="${c.shallows}" stroke="${c.shallows}" stroke-width="5.2" stroke-linejoin="round">${ground.map((entry) => `<path d="${entry.d}"/>`).join('')}</g>
    <g stroke-width="2.2" stroke-linejoin="round">${ground.map((entry) => `<path d="${entry.d}" data-land="${esc(entry.id)}" fill="${c[entry.kind] || c.mainland}" stroke="${entry.kind === 'sand' ? '#f8efd2' : c.rim}"/>`).join('')}</g>
    <g class="m3-flat-lgas" clip-path="url(#m3-flat-land-${esc(model.id)})">${model.lgas.map((lga) => `<path d="${lga.d}" data-lga="${esc(lga.id)}" fill="${esc(lga.tint)}" fill-opacity=".34" stroke="#46544a" stroke-opacity=".6" stroke-width=".5" stroke-linejoin="round"/>`).join('')}</g>
    <g class="m3-flat-zones">${model.zones.map((zone) => `<rect data-zone="${esc(zone.id)}" x="${fixed(zone.x)}" y="${fixed(zone.z)}" width="${fixed(zone.width)}" height="${fixed(zone.height)}" fill="#c8bfa4" stroke="#f2c230" stroke-width=".8" stroke-dasharray="2.2 2.2"/>`).join('')}</g>
    <g>${bridges.map((road) => stroke(road, c.parapet, 1.5)).join('')}</g>
    <g>${roads.map((road) => stroke(road, c.kerb, 0.7)).join('')}</g>
    <g>${model.roads.map((road) => stroke(road, c.asphalt, 0)).join('')}</g>
    <g>${model.roads.filter((road) => road.major).map((road) => stroke(road, c.dash, -road.width + 0.16, 'stroke-dasharray="1.6 3.2" stroke-linecap="butt"')).join('')}</g>
    <g class="m3-flat-names" font-family="DM Sans, Arial, sans-serif" font-weight="800" text-anchor="middle">${model.names.map((plate) => `<text x="${fixed(plate.x)}" y="${fixed(plate.z + plate.size * 0.35)}" font-size="${fixed(plate.size * 1.15)}" letter-spacing="${fixed(plate.size * 0.18)}" fill="${plate.water ? '#d6f1f7' : '#f6faea'}" ${plate.water ? '' : 'stroke="#6f9160" stroke-width=".35" paint-order="stroke"'}>${esc(plate.name)}</text>`).join('')}</g>
  </svg>`;
}
