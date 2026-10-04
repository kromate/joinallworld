/**
 * OWNER: world
 * Local governments on the map: which one a point is in, the tinted layer both maps draw, and
 * finding a player's local government from their device's position. Pure maths — no Three.js, no
 * DOM, no network — so it runs under `node --test` and in the browser alike.
 *
 * LOCATION PRIVACY. resolveLga() is the ONLY code that ever sees a latitude and a longitude. It
 * runs in the player's browser, on the boxes bundled in the city pack, and returns an id. Nothing
 * in this file sends anything anywhere, and no caller keeps the position (src/ui/panels/lga-ui.js).
 *
 *   lgaAt(pack, x, z)            → the local government's id at a map point, or null
 *   landOf(pack)                 → the land outlines as the builder rounds them [{ id, kind, polygon }]
 *   onLand(lands, x, z)          → is the point on land (sand excluded unless `sand`)
 *   rasterLgas(pack, { scale, own })  → { width, height, data (RGBA), x0, z0, cell }: the tint layer —
 *                                 each local government's colour where it is land, a darker line
 *                                 along every boundary, the player's own one brighter
 *   resolveLga(pack, lat, lon)   → { id, name, sure } | null (not in this city)
 */
import { roundPolygon, pointInPolygon } from './roads.js';

export function lgaAt(pack, x, z) {
  for (const lga of pack.lgas || []) if (pointInPolygon(x, z, lga.polygon)) return lga.id;
  return null;
}
const landCache = new WeakMap();
export function landOf(pack) {
  if (!landCache.has(pack)) landCache.set(pack, pack.land.map((entry) => ({ id: entry.id, kind: entry.kind, polygon: roundPolygon(entry.points, 2) })));
  return landCache.get(pack);
}
export const onLand = (lands, x, z, sand = false) => lands.some((entry) => (sand || entry.kind !== 'sand') && pointInPolygon(x, z, entry.polygon));

/** Call fill(row, from, to) for every run of cells of a grid (cell centres) inside the polygon. */
export function scan(polygon, x0, z0, cell, width, height, fill) {
  let minZ = Infinity, maxZ = -Infinity;
  for (const point of polygon) { if (point[1] < minZ) minZ = point[1]; if (point[1] > maxZ) maxZ = point[1]; }
  const first = Math.max(0, Math.floor((minZ - z0) / cell)), last = Math.min(height - 1, Math.ceil((maxZ - z0) / cell));
  const hits = [];
  for (let row = first; row <= last; row++) {
    const z = z0 + (row + 0.5) * cell;
    hits.length = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, az] = polygon[i], [bx, bz] = polygon[j];
      if ((az > z) !== (bz > z)) hits.push(((bx - ax) * (z - az)) / (bz - az) + ax);
    }
    hits.sort((a, b) => a - b);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const from = Math.max(0, Math.ceil((hits[k] - x0) / cell - 0.5)), to = Math.min(width - 1, Math.floor((hits[k + 1] - x0) / cell - 0.5));
      if (to >= from) fill(row, from, to);
    }
  }
}
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** The tint layer as pixels. `scale` cells per map unit; `own` is the id to highlight. Row 0 is the north edge. */
export function rasterLgas(pack, { scale = 2, own = null } = {}) {
  const { minX, maxX, minZ, maxZ } = pack.bounds, cell = 1 / scale;
  const width = Math.ceil((maxX - minX) * scale), height = Math.ceil((maxZ - minZ) * scale);
  const land = new Uint8Array(width * height), owner = new Uint8Array(width * height);
  for (const entry of landOf(pack)) scan(entry.polygon, minX, minZ, cell, width, height, (row, from, to) => land.fill(1, row * width + from, row * width + to + 1));
  pack.lgas.forEach((lga, index) => scan(lga.polygon, minX, minZ, cell, width, height, (row, from, to) => { for (let i = row * width + from; i <= row * width + to; i++) if (land[i] && !owner[i]) owner[i] = index + 1; }));
  const data = new Uint8Array(width * height * 4), tints = pack.lgas.map((lga) => rgb(lga.tint));
  const mine = own ? pack.lgas.findIndex((lga) => lga.id === own) + 1 : 0;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col, id = owner[i];
    if (!id) continue;
    // A boundary: a neighbour to the east or south belongs to another local government (the coast is not a boundary).
    const east = col + 1 < width ? owner[i + 1] : id, south = row + 1 < height ? owner[i + width] : id;
    const edge = (east && east !== id) || (south && south !== id);
    const touchesMine = mine && edge && (id === mine || east === mine || south === mine);
    const tint = tints[id - 1], k = i * 4;
    if (edge) { data[k] = touchesMine ? 20 : 70; data[k + 1] = touchesMine ? 83 : 84; data[k + 2] = touchesMine ? 45 : 70; data[k + 3] = touchesMine ? 235 : 150; }
    else { data[k] = tint[0]; data[k + 1] = tint[1]; data[k + 2] = tint[2]; data[k + 3] = id === mine ? 150 : 86; }
  }
  return { width, height, data, x0: minX, z0: minZ, cell };
}

/**
 * The local government a position falls in. Among the boxes that contain it the nearest centre
 * wins; with none, the nearest centre if the position is inside the city's own box (`sure: false`
 * — a guess to confirm). Outside the city: null.
 */
export function resolveLga(pack, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !pack?.geo || !pack.lgas?.length) return null;
  const [south, west, north, east] = pack.geo.box;
  if (lat < south || lat > north || lon < west || lon > east) return null;
  const far = (lga) => Math.hypot(lat - lga.geo.c[0], (lon - lga.geo.c[1]) * Math.cos((lat * Math.PI) / 180));
  const inside = pack.lgas.filter((lga) => lat >= lga.geo.box[0] && lat <= lga.geo.box[2] && lon >= lga.geo.box[1] && lon <= lga.geo.box[3]);
  const best = (inside.length ? inside : pack.lgas).reduce((a, b) => (far(b) < far(a) ? b : a));
  return { id: best.id, name: best.name, sure: inside.length > 0 };
}
