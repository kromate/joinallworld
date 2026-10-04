/**
 * OWNER: world
 * The compact form the geographic data modules (./data/*.js) are stored in, and its reader.
 * Pure — no Three.js, no DOM.
 *
 * THE FORM (a small topology, like TopoJSON but written here):
 *   { grid, arcs, features }
 *   grid       degrees per integer step (coordinates are quantised to it)
 *   arcs       one string: arcs separated by ',', each a run of zig-zag variable-length integers in
 *              a 64-character alphabet — the first point absolute, the rest deltas (lon, lat pairs)
 *   features   [{ id, name, …, polys: [[ring, hole…], …] }] where a ring is a list of arc numbers;
 *              a negative number ~n means arc n walked backwards
 * A border two regions share is ONE arc used by both, so it is simplified once (no gaps or
 * overlaps between neighbours), stored once and drawn once.
 *
 * @typedef {{ id: string, name: string, polys: number[][][] }} RawFeature
 * @typedef {{ grid: number, arcs: string, features: RawFeature[] }} RawTopology
 * @typedef {{ minLon: number, minLat: number, maxLon: number, maxLat: number }} Bounds
 * @typedef {RawFeature & { rings: Float64Array[][], bounds: Bounds, index: number }} Feature
 *   rings: per polygon, [outer, hole…], each a flat [lon, lat, lon, lat…] closed ring (first point not repeated)
 * @typedef {{ grid: number, arcs: Float64Array[], users: number[][], features: Feature[], byId: Map<string, Feature> }} Topology
 *   users: for each arc, the indexes of the features whose rings use it (1 = a coast or outer edge, 2 = a shared border)
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUE = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Integers → text: zig-zag, then 5 bits a character with a continuation bit. */
export function encodeInts(values) {
  let out = '';
  for (const value of values) {
    let n = value < 0 ? -2 * value - 1 : 2 * value;
    do { const low = n % 32; n = Math.floor(n / 32); out += ALPHABET[low + (n ? 32 : 0)]; } while (n);
  }
  return out;
}
export function decodeInts(text) {
  const out = [];
  let n = 0, scale = 1;
  for (const char of text) {
    const v = VALUE.get(char);
    if (v === undefined) throw new Error(`Bad character in geo data: ${char}`);
    n += (v & 31) * scale;
    if (v & 32) scale *= 32; else { out.push(n % 2 ? -(n + 1) / 2 : n / 2); n = 0; scale = 1; }
  }
  return out;
}

/** One arc's quantised points [[qx, qy]…] → text (first absolute, then deltas). */
export function encodeArc(points) {
  const ints = [];
  let px = 0, py = 0;
  for (const [x, y] of points) { ints.push(x - px, y - py); px = x; py = y; }
  return encodeInts(ints);
}

/** The points of ring `refs` as a flat closed ring (the closing point is not repeated). */
export function ringOf(arcs, refs) {
  const out = [];
  for (const ref of refs) {
    const arc = arcs[ref < 0 ? ~ref : ref], n = arc.length / 2;
    // Each arc ends where the next begins: its last point is left to the next arc.
    if (ref < 0) for (let i = n - 1; i > 0; i--) out.push(arc[i * 2], arc[i * 2 + 1]);
    else for (let i = 0; i < n - 1; i++) out.push(arc[i * 2], arc[i * 2 + 1]);
  }
  return Float64Array.from(out);
}

export function boundsOf(rings) {
  const b = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const poly of rings) { const ring = poly[0]; for (let i = 0; i < ring.length; i += 2) { if (ring[i] < b.minLon) b.minLon = ring[i]; if (ring[i] > b.maxLon) b.maxLon = ring[i]; if (ring[i + 1] < b.minLat) b.minLat = ring[i + 1]; if (ring[i + 1] > b.maxLat) b.maxLat = ring[i + 1]; } }
  return b;
}

/** @param {RawTopology} raw @returns {Topology} */
export function decodeTopology(raw) {
  const arcs = raw.arcs.split(',').map((text) => {
    const ints = decodeInts(text), out = new Float64Array(ints.length);
    let x = 0, y = 0;
    for (let i = 0; i < ints.length; i += 2) { x += ints[i]; y += ints[i + 1]; out[i] = x * raw.grid; out[i + 1] = y * raw.grid; }
    return out;
  });
  const users = arcs.map(() => []);
  const features = raw.features.map((feature, index) => {
    for (const poly of feature.polys) for (const ring of poly) for (const ref of ring) { const list = users[ref < 0 ? ~ref : ref]; if (!list.includes(index)) list.push(index); }
    const rings = feature.polys.map((poly) => poly.map((ring) => ringOf(arcs, ring)));
    return { ...feature, index, rings, bounds: boundsOf(rings) };
  });
  return { grid: raw.grid, arcs, users, features, byId: new Map(features.map((feature) => [feature.id, feature])) };
}

/** Twice the signed area of a flat ring (positive = anticlockwise in lon/lat). */
export function ringArea2(ring) {
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i += 2) { const j = (i + 2) % n; sum += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
  return sum;
}

/** Does the flat ring cross itself? O(n²) — for tests and the data build, not for the game. */
export function selfIntersections(ring) {
  const n = ring.length / 2;
  let count = 0;
  const side = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], ay = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], by = ring[((i + 1) % n) * 2 + 1];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours round the end
      const cx = ring[j * 2], cy = ring[j * 2 + 1], dx = ring[((j + 1) % n) * 2], dy = ring[((j + 1) % n) * 2 + 1];
      if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx) || Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) continue;
      if (side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 && side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0) count += 1;
    }
  }
  return count;
}
