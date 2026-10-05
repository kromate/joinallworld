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
 * (src/map3d/map3d.test.ts: every venue, road, bridge and local government, at the same place).
 */
import { landOf, partsOf } from './lga.ts';
import type { Network } from './roads.ts';
import { extentWord } from './labels.ts';
import type { CityPack, LandKind, PackBounds, PackSoon, Point2, Point3, XZ } from './types.ts';

export interface FlatLand { id: string; kind: LandKind; d: string }
export interface FlatRoad { id: string; name: string; major: boolean; bridge: boolean; d: string; width: number; from: Point3; to: Point3 }
export interface FlatLga { id: string; name: string; tint: string; d: string; plate: Point2 }
/** How big the strokes of the ground are: the usual for an invented map, a fifth for one in true scale (a unit is 100 m there). */
export const groundScale = (pack: Pick<CityPack, 'frame'>) => (pack.frame ? 0.22 : 1);
export interface FlatZone { id: string; x: number; z: number; width: number; height: number }
export interface FlatPlace { id: string; kind: 'venue' | 'soon'; x: number; z: number }
export interface FlatName { name: string; x: number; z: number; size: number; water: boolean }
/** The board, in map units (x east, z south: north is up). */
/** The land and names around a state (CityPack.context), as paths and text in map units. */
export interface FlatContext { land: { id: string; kind: string; d: string }[]; roads: { id: string; d: string }[]; names: { text: string; kind: string; x: number; z: number }[] }
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
  inland: boolean
  /** What the whole-extent button names (see labels.ts extentWord). */
  extent: 'state' | 'city'
  sea: PackBounds['sea'] | null
  /** Present for a state map: drawn under everything, muted. */
  context: FlatContext | null
  /** The character of a city's ground (CityPack areas, waters, rails); empty for a city without any. */
  character: { areas: { x: number; z: number; r: number; tone: string }[]; waters: { name: string; kind: string; d: string; width: number }[]; rails: { d: string }[] }
  /** The multiplier of every stroke of the ground (see groundScale) and of the roads (CityPack.roadScale). */
  scale: { ground: number; road: number }
}

const fixed = (value: number) => (Math.round(value * 100) / 100).toString();
/** A part as one path: the outer ring and its holes (fill with evenodd). */
const rings = (part: readonly (readonly Point2[])[]) => part.map((ring) => path(ring, true)).join('');
const path = (points: readonly (Point2 | XZ)[], close = false) => `${points.map((point, i) => `${i ? 'L' : 'M'}${fixed('x' in point ? point.x : point[0])} ${fixed('z' in point ? point.z : point[1])}`).join('')}${close ? 'Z' : ''}`;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!);
/** The ground colours of the 3D build (src/map3d/city-build.ts LAND_COLOURS), so both maps are the same green. */
export const FLAT_COLOURS = { water: '#4faacb', shallows: '#7cc6d6', rim: '#ecdcae', mainland: '#bcd596', island: '#c6dca2', estate: '#b2d892', sand: '#f1dfae', asphalt: '#5d626b', kerb: '#e4dfcf', dash: '#f6f2e2', parapet: '#efe9da' };

/** How far past the state's board a state map's flat drawing reaches into the land around it, in map units (150 km). */
export const CONTEXT_REACH = 1500;

export function flatModel(pack: CityPack, network: Pick<Network, 'roads'>, { venues = {}, soon = {} }: { venues?: object; soon?: object } = {}): FlatModel {
  const { minX, maxX, minZ, maxZ } = pack.bounds;
  const places: FlatPlace[] = [];
  for (const [id, spot] of Object.entries(pack.sites)) if ((venues as Record<string, unknown>)[id]) places.push({ id, kind: 'venue', x: spot.x, z: spot.z });
  for (const [id, spot] of Object.entries<PackSoon>(pack.soon || {})) if ((soon as Record<string, unknown>)[id]) places.push({ id, kind: 'soon', x: spot.x, z: spot.z });
  // A state map reaches a little way into the land around it (the drawing is a screen-sized element: it is not made as big as the 3D board).
  const seaEnd = pack.bounds.sea ? pack.bounds.sea.z1 + 4 : maxZ, reach = pack.context ? CONTEXT_REACH : 0;
  const edge = { minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: seaEnd + reach };
  const ctx = pack.context;
  return {
    id: pack.id, name: pack.name,
    box: { x: edge.minX, z: edge.minZ, width: edge.maxX - edge.minX, height: edge.maxZ - edge.minZ },
    context: ctx ? { land: ctx.land.map((piece) => ({ id: piece.id, kind: piece.kind, d: rings([piece.points, ...piece.holes]) })), roads: ctx.roads.filter((road) => road.points.length > 1).map((road) => ({ id: road.id, d: path(road.points) })), names: ctx.labels.map((label) => ({ text: label.text, kind: label.kind, x: label.x, z: label.z })) } : null,
    land: landOf(pack).map((entry) => ({ id: entry.id, kind: entry.kind, d: rings([entry.polygon, ...(entry.holes ?? [])]) })),
    roads: network.roads.map((road) => ({ id: road.id, name: road.name, major: road.major, bridge: road.bridge > 0, d: path(road.points), width: (road.trunk ? 3.6 : road.major ? 2.5 : 1.8) * (pack.roadScale ?? 1), from: road.points[0]!, to: road.points[road.points.length - 1]! })),
    lgas: (pack.lgas || []).map((lga) => ({ id: lga.id, name: lga.name, tint: lga.tint, d: partsOf(lga).map(rings).join(''), plate: lga.plate })),
    zones: Object.entries<PackSoon>(pack.soon || {}).map(([id, spot]) => ({ id, x: spot.zone[0], z: spot.zone[1], width: spot.zone[2] - spot.zone[0], height: spot.zone[3] - spot.zone[1] })),
    places,
    homes: Object.fromEntries(Object.entries(pack.homes).map(([id, spot]) => [id, { x: spot.x, z: spot.z, district: spot.district }])),
    names: (pack.districts || []).map((plate) => ({ name: plate.name, x: plate.x, z: plate.z, size: plate.size || 2, water: Boolean(plate.water) })),
    inland: pack.inland === true,
    extent: extentWord(pack),
    character: {
      areas: (pack.areas ?? []).map((area) => ({ x: area.x, z: area.z, r: area.r, tone: area.tone })),
      waters: (pack.waters ?? []).map((water) => ({ name: water.name, kind: water.kind, d: water.kind === 'lake' ? rings([water.points]) : path(water.points), width: water.width ?? 0.5 })),
      rails: (pack.rails ?? []).map((rail) => ({ d: path(rail.points) })),
    },
    sea: pack.inland ? null : pack.bounds.sea || null,
    scale: { ground: groundScale(pack), road: pack.roadScale ?? 1 },
  };
}

/** The least width, in screen pixels, a river line is drawn with, so it stays visible when the true width shrinks below a pixel. */
const RIVER_MIN_PX = 2;

export function flatSvg(model: FlatModel): string {
  const { box } = model, c = FLAT_COLOURS, g = model.scale.ground, k = model.scale.road;
  const land = (kind: string) => model.land.filter((entry) => (kind === 'sand') === (entry.kind === 'sand'));
  const ground = [...land('other'), ...land('sand')];
  const roads = model.roads.filter((road) => !road.bridge), bridges = model.roads.filter((road) => road.bridge);
  const stroke = (road: FlatRoad, colour: string, extra: number, more = '') => `<path d="${road.d}" data-road="${esc(road.id)}" fill="none" stroke="${colour}" stroke-width="${fixed(road.width + extra)}" stroke-linecap="round" stroke-linejoin="round" ${more}/>`;
  return `<svg class="m3-flat-art" viewBox="${fixed(box.x)} ${fixed(box.z)} ${fixed(box.width)} ${fixed(box.height)}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><clipPath id="m3-flat-land-${esc(model.id)}" clip-rule="evenodd">${model.land.map((entry) => `<path d="${entry.d}"/>`).join('')}</clipPath></defs>
    <rect x="${fixed(box.x)}" y="${fixed(box.z)}" width="${fixed(box.width)}" height="${fixed(box.height)}" fill="${model.inland ? c.mainland : c.water}"/>
    ${model.context ? `<g class="m3-flat-context" fill-rule="evenodd" aria-hidden="true"><g>${model.context.land.map((piece) => `<path d="${piece.d}" data-context="${esc(piece.id)}" fill="${piece.kind === 'country' ? '#e4dfd0' : '#dde1d3'}"/>`).join('')}</g><g fill="none" stroke="#b7b8ae" stroke-width="${fixed(1.1 * k)}" stroke-linecap="round" stroke-linejoin="round">${model.context.roads.map((road) => `<path d="${road.d}"/>`).join('')}</g><g font-family="DM Sans, Arial, sans-serif" font-weight="700" text-anchor="middle" font-size="46" letter-spacing="7">${model.context.names.map((label) => `<text x="${fixed(label.x)}" y="${fixed(label.z)}" fill="${label.kind === 'sea' ? '#e2f4f8' : '#56684f'}" fill-opacity=".75">${esc(label.text)}</text>`).join('')}</g></g>` : ''}
    <g fill="${model.inland ? c.mainland : c.shallows}" fill-rule="evenodd" stroke="${model.inland ? c.mainland : c.shallows}" stroke-width="${fixed(5.2 * g)}" stroke-linejoin="round">${ground.map((entry) => `<path d="${entry.d}"/>`).join('')}</g>
    <g stroke-width="${fixed(2.2 * g)}" stroke-linejoin="round" fill-rule="evenodd">${ground.map((entry) => `<path d="${entry.d}" data-land="${esc(entry.id)}" fill="${c[entry.kind] || c.mainland}" stroke="${entry.kind === 'sand' ? '#f8efd2' : c.rim}"/>`).join('')}</g>
    <g class="m3-flat-lgas" clip-path="url(#m3-flat-land-${esc(model.id)})" fill-rule="evenodd">${model.lgas.map((lga) => `<path d="${lga.d}" data-lga="${esc(lga.id)}" fill="${esc(lga.tint)}" fill-opacity=".34" stroke="#46544a" stroke-opacity=".6" stroke-width="${fixed(0.5 * Math.max(g, 0.5))}" stroke-linejoin="round"/>`).join('')}</g>
    ${model.character.areas.length ? `<g class="m3-flat-areas" aria-hidden="true">${model.character.areas.map((area) => `<circle cx="${fixed(area.x)}" cy="${fixed(area.z)}" r="${fixed(area.r)}" fill="${area.tone === 'old' ? '#cdb48c' : '#a6cc7c'}" fill-opacity=".55"/>`).join('')}</g>` : ''}
    ${model.character.waters.length ? `<g class="m3-flat-waters" aria-hidden="true" fill="#79bfd2" stroke="#6fb6cd" stroke-linecap="round" stroke-linejoin="round">${model.character.waters.map((water) => water.kind === 'lake' ? `<path d="${water.d}" data-water="${esc(water.name)}" stroke-width="${fixed(0.3 * k)}"/>` : `<path d="${water.d}" data-water="${esc(water.name)}" fill="none" stroke-width="${fixed(water.width * k)}"/><path d="${water.d}" data-water-line="${esc(water.name)}" fill="none" stroke="#4f9fc0" stroke-width="${RIVER_MIN_PX}" vector-effect="non-scaling-stroke"/>`).join('')}</g>` : ''}
    ${model.character.rails.length ? `<g class="m3-flat-rails" aria-hidden="true" fill="none" stroke-linejoin="round">${model.character.rails.map((rail) => `<path d="${rail.d}" stroke="#a7a395" stroke-width="${fixed(0.9 * k)}"/><path d="${rail.d}" stroke="#6f6b60" stroke-width="${fixed(0.4 * k)}" stroke-dasharray="${fixed(1.2 * k)} ${fixed(0.8 * k)}"/>`).join('')}</g>` : ''}
    <g class="m3-flat-zones">${model.zones.map((zone) => `<rect data-zone="${esc(zone.id)}" x="${fixed(zone.x)}" y="${fixed(zone.z)}" width="${fixed(zone.width)}" height="${fixed(zone.height)}" fill="#c8bfa4" stroke="#f2c230" stroke-width=".8" stroke-dasharray="2.2 2.2"/>`).join('')}</g>
    <g class="m3-flat-roads">
    <g data-ink="parapet">${bridges.map((road) => stroke(road, c.parapet, 1.5 * k)).join('')}</g>
    <g data-ink="kerb">${roads.map((road) => stroke(road, c.kerb, 0.7 * k)).join('')}</g>
    <g data-ink="asphalt">${model.roads.map((road) => stroke(road, c.asphalt, 0)).join('')}</g>
    <g data-ink="dash">${model.roads.filter((road) => road.major).map((road) => stroke(road, c.dash, -road.width + 0.16 * k, `stroke-dasharray="${fixed(1.6 * k)} ${fixed(3.2 * k)}" stroke-linecap="butt"`)).join('')}</g>
    </g>
    <g class="m3-flat-names" font-family="DM Sans, Arial, sans-serif" font-weight="800" text-anchor="middle">${model.names.map((plate) => `<text x="${fixed(plate.x)}" y="${fixed(plate.z + plate.size * 0.35)}" font-size="${fixed(plate.size * 1.15)}" letter-spacing="${fixed(plate.size * 0.18)}" fill="${plate.water ? '#d6f1f7' : '#f6faea'}" ${plate.water ? '' : 'stroke="#6f9160" stroke-width=".35" paint-order="stroke"'}>${esc(plate.name)}</text>`).join('')}</g>
  </svg>`;
}
