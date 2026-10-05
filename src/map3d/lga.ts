/**
 * OWNER: world
 * Local governments on the map: which one a point is in, the tinted layer both maps draw, and
 * finding a player's local government from their device's position. Pure maths — no Three.js, no
 * DOM, no network — so it runs under `node --test` and in the browser alike.
 *
 * LOCATION PRIVACY. resolveLga() is the ONLY code that ever sees a latitude and a longitude. It
 * runs in the player's browser, on the real boundaries bundled in the city pack, and returns an id. Nothing
 * in this file sends anything anywhere, and no caller keeps the position (src/ui/panels/lga-ui.js).
 *
 *   lgaAt(pack, x, z)            → the local government's id at a map point, or null
 *   landOf(pack)                 → the land outlines as the builder draws them [{ id, kind, polygon, holes? }]
 *   onLand(lands, x, z)          → is the point on land (sand excluded unless `sand`)
 *   rasterLgas(pack, { scale, own })  → { width, height, data (RGBA), x0, z0, cell }: the tint layer —
 *                                 each local government's colour where it is land, a darker line
 *                                 along every boundary, the player's own one brighter
 *   resolveLga(pack, lat, lon)   → { id, name, sure } | null (not in this city); the position is projected into the
 *                                 pack's frame and tested against the polygons — offline, pure
 */
import { roundPolygon, pointInPolygon } from './roads.ts';
import { toLocal } from './geo/frame.ts';
import type { CityPack, LandKind, PackLga, Point2 } from './types.ts';

/** A land outline as the builder rounds it (or as given, for an exact one); `holes` are cut out of it. */
export interface LandOutline { id: string; kind: LandKind; polygon: readonly Point2[]; holes?: readonly (readonly Point2[])[] }
type Ring = readonly Point2[];
/** One part of a boundary: [outer ring, ...holes]. */
export type Part = readonly Ring[];

/** Is the point inside a part (inside the outer ring and outside every hole)? */
export function pointInPart(x: number, z: number, part: Part): boolean {
  if (!pointInPolygon(x, z, part[0]!)) return false;
  for (let i = 1; i < part.length; i++) if (pointInPolygon(x, z, part[i]!)) return false;
  return true;
}
/** Every part of a local government's boundary (`polygons`, or its one `polygon`). */
export const partsOf = (lga: Pick<PackLga, 'polygon' | 'polygons'>): readonly Part[] => lga.polygons ?? [[lga.polygon]];
/** Is the point inside any part of the local government? */
export const inLga = (lga: Pick<PackLga, 'polygon' | 'polygons'>, x: number, z: number) => partsOf(lga).some((part) => pointInPart(x, z, part));
/** The tint layer as pixels: `data` is RGBA, `cell` the side of one pixel in map units. */
export interface LgaRaster { width: number; height: number; data: Uint8Array; x0: number; z0: number; cell: number }
/** `sure` is false when the position was in no local government's box and the nearest centre is only a guess. */
export interface ResolvedLga { id: string; name: string; sure: boolean }

export function lgaAt(pack: CityPack, x: number, z: number): string | null {
  for (const lga of pack.lgas || []) if (inLga(lga, x, z)) return lga.id;
  return null;
}
const landCache = new WeakMap<CityPack, LandOutline[]>();
export function landOf(pack: CityPack): LandOutline[] {
  if (!landCache.has(pack)) landCache.set(pack, pack.land.map((entry) => ({ id: entry.id, kind: entry.kind, polygon: entry.exact ? entry.points : roundPolygon(entry.points, 2), ...(entry.holes?.length ? { holes: entry.holes } : {}) })));
  return landCache.get(pack)!;
}
export const onLand = (lands: readonly LandOutline[], x: number, z: number, sand = false) => lands.some((entry) => (sand || entry.kind !== 'sand') && pointInPart(x, z, [entry.polygon, ...(entry.holes || [])]));

/** Call fill(row, from, to) for every run of cells of a grid (cell centres) inside the polygon. */
export function scan(polygon: readonly Point2[], x0: number, z0: number, cell: number, width: number, height: number, fill: (row: number, from: number, to: number) => void): void {
  scanRings([polygon], x0, z0, cell, width, height, fill);
}
/** As scan(), for a part: the cells inside the outer ring and outside its holes (even-odd over all the rings). */
export function scanRings(rings: Part, x0: number, z0: number, cell: number, width: number, height: number, fill: (row: number, from: number, to: number) => void): void {
  let minZ = Infinity, maxZ = -Infinity;
  for (const point of rings[0]!) { if (point[1] < minZ) minZ = point[1]; if (point[1] > maxZ) maxZ = point[1]; }
  const first = Math.max(0, Math.floor((minZ - z0) / cell)), last = Math.min(height - 1, Math.ceil((maxZ - z0) / cell));
  const hits: number[] = [];
  for (let row = first; row <= last; row++) {
    const z = z0 + (row + 0.5) * cell;
    hits.length = 0;
    for (const polygon of rings) for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, az] = polygon[i]!, [bx, bz] = polygon[j]!;
      if ((az > z) !== (bz > z)) hits.push(((bx - ax) * (z - az)) / (bz - az) + ax);
    }
    hits.sort((a, b) => a - b);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const from = Math.max(0, Math.ceil((hits[k]! - x0) / cell - 0.5)), to = Math.min(width - 1, Math.floor((hits[k + 1]! - x0) / cell - 0.5));
      if (to >= from) fill(row, from, to);
    }
  }
}
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** The tint layer as pixels. `scale` cells per map unit; `own` is the id to highlight. Row 0 is the north edge. */
export function rasterLgas(pack: CityPack, { scale = 2, own = null }: { scale?: number; own?: string | null } = {}): LgaRaster {
  const { minX, maxX, minZ, maxZ } = pack.bounds, cell = 1 / scale;
  const width = Math.ceil((maxX - minX) * scale), height = Math.ceil((maxZ - minZ) * scale);
  const land = new Uint8Array(width * height), owner = new Uint8Array(width * height);
  for (const entry of landOf(pack)) scanRings([entry.polygon, ...(entry.holes || [])], minX, minZ, cell, width, height, (row, from, to) => land.fill(1, row * width + from, row * width + to + 1));
  pack.lgas.forEach((lga, index) => { for (const part of partsOf(lga)) scanRings(part, minX, minZ, cell, width, height, (row, from, to) => { for (let i = row * width + from; i <= row * width + to; i++) if (land[i] && !owner[i]) owner[i] = index + 1; }); });
  const data = new Uint8Array(width * height * 4), tints = pack.lgas.map((lga) => rgb(lga.tint));
  const mine = own ? pack.lgas.findIndex((lga) => lga.id === own) + 1 : 0;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col, id = owner[i]!;
    if (!id) continue;
    // A boundary: a neighbour to the east or south belongs to another local government (the coast is not a boundary).
    const east = col + 1 < width ? owner[i + 1]! : id, south = row + 1 < height ? owner[i + width]! : id;
    const edge = (east && east !== id) || (south && south !== id);
    const touchesMine = mine && edge && (id === mine || east === mine || south === mine);
    const tint = tints[id - 1]!, k = i * 4;
    if (edge) { data[k] = touchesMine ? 20 : 70; data[k + 1] = touchesMine ? 83 : 84; data[k + 2] = touchesMine ? 45 : 70; data[k + 3] = touchesMine ? 235 : 150; }
    else { data[k] = tint[0]; data[k + 1] = tint[1]; data[k + 2] = tint[2]; data[k + 3] = id === mine ? 150 : 86; }
  }
  return { width, height, data, x0: minX, z0: minZ, cell };
}

/** How far (map units) from a boundary a position still counts as "on the shore" of a local government. */
const SHORE = 15;
const near = (x: number, z: number, ring: Ring) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j]!, [bx, bz] = ring[i]!, dx = bx - ax, dz = bz - az, len = dx * dx + dz * dz;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
};
/**
 * The local government a position falls in, from the real boundaries bundled in the city pack
 * (every part, holes cut out): the position is projected into the pack's frame and tested against
 * the polygons on this device. A position in the water within a short way (SHORE units = 1.5 km)
 * of a boundary gets that local government with `sure: false` (a guess to confirm: a boat on the
 * lagoon, a GPS fix on the beach). Anywhere else — the open Atlantic, another state — null.
 * A pack without a frame falls back to the rough boxes (`geo`).
 */
export function resolveLga(pack: CityPack | null | undefined, lat: number, lon: number): ResolvedLga | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !pack?.geo || !pack.lgas?.length) return null;
  const [south, west, north, east] = pack.geo.box;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  if (pack.frame) {
    const [x, z] = toLocal(pack.frame.origin, lon, lat);
    const hit = pack.lgas.find((lga) => inLga(lga, x, z));
    if (hit) return { id: hit.id, name: hit.name, sure: true };
    let best: PackLga | null = null, far = SHORE;
    for (const lga of pack.lgas) for (const part of partsOf(lga)) {
      const d = near(x, z, part[0]!);
      if (d < far) { far = d; best = lga; }
    }
    return best ? { id: best.id, name: best.name, sure: false } : null;
  }
  const far = (lga: PackLga) => Math.hypot(lat - lga.geo.c[0], (lon - lga.geo.c[1]) * Math.cos((lat * Math.PI) / 180));
  const inside = pack.lgas.filter((lga) => lat >= lga.geo.box[0] && lat <= lga.geo.box[2] && lon >= lga.geo.box[1] && lon <= lga.geo.box[3]);
  const best = (inside.length ? inside : pack.lgas).reduce((a, b) => (far(b) < far(a) ? b : a));
  return { id: best.id, name: best.name, sure: inside.length > 0 };
}
