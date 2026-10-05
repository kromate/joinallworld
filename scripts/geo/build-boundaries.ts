// npm run geo:boundaries — rebuilds Lagos only. Pass --nigeria to opt in to replacing the Nigeria atlas.
//
//   node --experimental-strip-types scripts/geo/build-boundaries.ts [--lagos-only] [--check]
//   node --experimental-strip-types scripts/geo/build-boundaries.ts --nigeria [--check]
//
// Sources (pinned by revision and sha256; fetched once into .cache/geo, verified every run):
//   geoBoundaries gbOpen NGA ADM1 (states) and ADM2 (local governments), release 9469f09, source GRID3,
//   licence CC BY 4.0 (see NOTICE.md). The same two files are recorded in src/models/geo/provenance.json.
//
// Writes:
//   src/map3d/geo/data/lagos.ts    the 20 Lagos local governments, the Lagos State outline and the derived lagoon
//   src/map3d/geo/data/nigeria.ts  the 37 states (geoBoundaries ADM1) plus, unchanged, the neighbouring countries
//                                  and the rivers and lakes that file already held, plus the derived Lagos lagoon
//
// How: every ring of a layer is cut into arcs wherever the set of rings using the boundary changes, so a border two
// regions share is ONE arc. Each arc is simplified once (Visvalingam–Whyatt, effective area in map units of the
// Nigeria frame, 1 unit = 100 m) and quantised once; both neighbours then draw the same vertices.
// The lagoon is derived: Lagos State (ADM1, which includes the lagoon) minus the union of the 20 local governments
// (ADM2, which are land only), found on a raster of 0.0002 degrees, traced, and simplified.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from '../../src/map3d/geo/frame.ts';
import { decodeTopology, encodeArc } from '../../src/map3d/geo/topo.ts';
import type { FeatureData, RawTopo } from '../../src/map3d/geo/topo.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cacheDir = join(root, '.cache', 'geo');
const RELEASE = '9469f09';
const SOURCES = {
  adm1: { url: `https://github.com/wmgeolab/geoBoundaries/raw/${RELEASE}/releaseData/gbOpen/NGA/ADM1/geoBoundaries-NGA-ADM1.geojson`, sha256: '64fa218ac3d453cc1e66412ff461c5dfa1a4a1ade0da93b239a9891b587d28f9', bytes: 2289696 },
  adm2: { url: `https://github.com/wmgeolab/geoBoundaries/raw/${RELEASE}/releaseData/gbOpen/NGA/ADM2/geoBoundaries-NGA-ADM2.geojson`, sha256: 'bef7f2cfa45e012f4772eaa61c7b99e5188aeba4d5c6badae7e9f9aae8c02fcd', bytes: 9422551 },
} as const;

/** Tolerances. Effective areas are in square map units (1 unit = 100 m, so 1 unit² = 10 000 m²). */
export const TOLERANCE = {
  lagos: { grid: 0.0002, lga: 0.01, state: 0.01, lagoon: 0.05, rasterGrid: 0.0002 },
  nigeria: { grid: 0.001, general: 3, lagos: 0.15, lagoonLake: 1.5 },
};
/** The smallest lagoon pieces kept, and the smallest islands of land inside it that still cut a hole, in km². */
const LAGOON_MIN_KM2 = 0.5, ISLAND_MIN_KM2 = 0.05;

type Pt = [number, number];
type Polygon = Pt[][];

interface GeoFeature {
  properties: { shapeName: string }
  polygons: Polygon[]
}
interface GeoFeatureCollection { features: GeoFeature[] }

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function pointOf(value: unknown, label: string): Pt {
  if (!Array.isArray(value) || !finite(value[0]) || !finite(value[1])) throw new TypeError(`${label}: expected a longitude/latitude position`);
  return [value[0], value[1]];
}

function ringOf(value: unknown, label: string): Pt[] {
  if (!Array.isArray(value) || value.length < 4) throw new TypeError(`${label}: expected a closed GeoJSON ring`);
  const points = value.map((point, index) => pointOf(point, `${label}[${index}]`));
  const first = points[0], last = points.at(-1);
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) throw new TypeError(`${label}: ring is not closed`);
  const open = points.slice(0, -1);
  if (open.length < 3) throw new TypeError(`${label}: ring has fewer than three vertices`);
  return open;
}

function polygonOf(value: unknown, label: string): Polygon {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError(`${label}: expected polygon rings`);
  return value.map((ring, index) => ringOf(ring, `${label}[${index}]`));
}

function geometryPolygons(value: unknown, label: string): Polygon[] {
  if (!isRecord(value) || (value.type !== 'Polygon' && value.type !== 'MultiPolygon')) throw new TypeError(`${label}: expected Polygon or MultiPolygon geometry`);
  if (!Array.isArray(value.coordinates)) throw new TypeError(`${label}: geometry coordinates are missing`);
  return value.type === 'Polygon'
    ? [polygonOf(value.coordinates, `${label}.coordinates`)]
    : value.coordinates.map((polygon, index) => polygonOf(polygon, `${label}.coordinates[${index}]`));
}

function featureCollectionOf(value: unknown, label: string): GeoFeatureCollection {
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) throw new TypeError(`${label}: expected a GeoJSON FeatureCollection`);
  return { features: value.features.map((feature, index): GeoFeature => {
    if (!isRecord(feature) || feature.type !== 'Feature' || !isRecord(feature.properties) || typeof feature.properties.shapeName !== 'string') {
      throw new TypeError(`${label}.features[${index}]: expected a named GeoJSON feature`);
    }
    return { properties: { shapeName: feature.properties.shapeName }, polygons: geometryPolygons(feature.geometry, `${label}.features[${index}].geometry`) };
  }) };
}

// ---- sources -------------------------------------------------------------------------------------------------------

async function load(key: keyof typeof SOURCES): Promise<GeoFeatureCollection> {
  const source = SOURCES[key], path = join(cacheDir, `geoBoundaries-NGA-${key.toUpperCase()}-${RELEASE}.geojson`);
  if (!existsSync(path)) {
    mkdirSync(cacheDir, { recursive: true });
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  const raw = readFileSync(path);
  if (createHash('sha256').update(raw).digest('hex') !== source.sha256 || raw.length !== source.bytes) throw new Error(`${key}: the file does not match its pinned hash`);
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  return featureCollectionOf(parsed, key);
}

const polygonsOf = (feature: GeoFeature): Polygon[] => feature.polygons;

// ---- geometry helpers ----------------------------------------------------------------------------------------------

const unitsOf = ([lon, lat]: Pt): Pt => { const p = project(lon, lat); return [p.x, p.z]; };
/** Twice the signed area of a ring in lon/lat (positive = anticlockwise). */
function area2(ring: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; sum += a[0] * b[1] - b[0] * a[1]; }
  return sum;
}
const km2 = (ring: readonly Pt[]): number => Math.abs(area2(ring.map(unitsOf))) / 2 / 100;

/** Visvalingam–Whyatt on map-unit coordinates; the ends stay. `keep` is the fewest points left. Returns indexes kept. */
function visvalingam(points: readonly Pt[], threshold: number, keep: number): number[] {
  const n = points.length, prev = Int32Array.from({ length: n }, (_, i) => i - 1), next = Int32Array.from({ length: n }, (_, i) => i + 1);
  const removed = new Uint8Array(n), version = new Uint32Array(n), xy = points.map(unitsOf);
  const tri = (i: number): number => { const a = xy[prev[i]!]!, b = xy[i]!, c = xy[next[i]!]!; return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; };
  const heap: { i: number; area: number; v: number }[] = [];
  const push = (i: number) => {
    const item = { i, area: tri(i), v: ++version[i]! };
    heap.push(item);
    for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p]!.area <= heap[k]!.area) break; [heap[p], heap[k]] = [heap[k]!, heap[p]!]; k = p; }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l]!.area < heap[m]!.area) m = l; if (r < heap.length && heap[r]!.area < heap[m]!.area) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k]!, heap[m]!]; k = m; }
    }
    return top;
  };
  for (let i = 1; i < n - 1; i++) push(i);
  let left = n, floor = 0;
  while (heap.length && left > keep) {
    const top = pop();
    if (removed[top.i] || top.v !== version[top.i]) continue;
    floor = Math.max(floor, top.area);
    if (floor >= threshold) break;
    removed[top.i] = 1; left -= 1;
    const p = prev[top.i]!, q = next[top.i]!;
    next[p] = q; prev[q] = p;
    if (p > 0) push(p);
    if (q < n - 1) push(q);
  }
  return Array.from({ length: n }, (_, i) => i).filter((i) => !removed[i]);
}

// ---- shared-arc topology -------------------------------------------------------------------------------------------

interface RingInput { owner: string; poly: number; hole: boolean; pts: Pt[] }
interface ArcOut { points: Pt[]; owners: Set<string> }
interface RingRef { owner: string; poly: number; hole: boolean; ring: number[] }
interface Built { arcs: ArcOut[]; refs: RingRef[]; grid: number }

/**
 * Cuts every ring into arcs where the set of rings along its boundary changes, so a border shared by two rings is one arc
 * (a ring walking it the other way refers to it as ~n). Rings are given open (the first point is not repeated) and must use
 * identical coordinates where they touch. Each arc is then simplified once with `threshold(owners)` and quantised to `grid`.
 */
function build(inputs: readonly RingInput[], grid: number, threshold: (owners: ReadonlySet<string>) => number): Built {
  const vertex = new Map<string, number>(), coords: Pt[] = [];
  const rings = inputs.map((input) => input.pts.map((p) => {
    const key = `${p[0]},${p[1]}`;
    let id = vertex.get(key);
    if (id === undefined) { id = coords.length; vertex.set(key, id); coords.push(p); }
    return id;
  }));
  const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const users = new Map<string, Set<number>>();
  rings.forEach((ids, r) => ids.forEach((id, i) => { const key = edgeKey(id, ids[(i + 1) % ids.length]!); const set = users.get(key) ?? new Set<number>(); set.add(r); users.set(key, set); }));
  const signature = (a: number, b: number) => [...users.get(edgeKey(a, b))!].sort((x, y) => x - y).join(',');
  const stored = new Map<string, number>(), chains: number[][] = [], owners: Set<string>[] = [], refs: RingRef[] = [];
  rings.forEach((ids, r) => {
    const n = ids.length, input = inputs[r]!, sig = ids.map((id, i) => signature(id, ids[(i + 1) % n]!));
    let cuts = ids.map((_, i) => i).filter((i) => sig[(i - 1 + n) % n] !== sig[i]);
    if (!cuts.length) cuts = [0];
    const ring: number[] = [];
    cuts.forEach((from, c) => {
      const to = cuts[(c + 1) % cuts.length]!, chain = [ids[from]!];
      let i = from;
      do { i = (i + 1) % n; chain.push(ids[i]!); } while (i !== to);
      const forward = chain.join(','), key = forward < [...chain].reverse().join(',') ? forward : [...chain].reverse().join(',');
      const found = stored.get(key);
      if (found === undefined) { stored.set(key, chains.length); ring.push(chains.length); chains.push(chain); owners.push(new Set([input.owner])); }
      else { owners[found]!.add(input.owner); ring.push(chains[found]!.join(',') === forward ? found : ~found); }
    });
    refs.push({ owner: input.owner, poly: input.poly, hole: input.hole, ring });
  });
  const arcs = chains.map((chain, k): ArcOut => {
    const points = chain.map((id) => coords[id]!);
    const closed = chain[0] === chain[chain.length - 1];
    const kept = visvalingam(points, threshold(owners[k]!), closed ? 4 : 2).map((i) => points[i]!);
    const q: Pt[] = [];
    for (const [lon, lat] of kept) { const p: Pt = [Math.round(lon / grid), Math.round(lat / grid)]; const last = q[q.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) q.push(p); }
    return { points: q, owners: owners[k]! };
  });
  const built: Built = { arcs, refs, grid };
  orient(built);
  return built;
}

/** Twice the signed area of a ring given as arc references, in quantised lon/lat. */
function ringSigned(built: Built, ring: readonly number[]): number {
  const pts: Pt[] = [];
  for (const ref of ring) {
    const arc = built.arcs[ref < 0 ? ~ref : ref]!.points, seq = ref < 0 ? [...arc].reverse() : arc;
    for (let i = 0; i < seq.length - 1; i++) pts.push(seq[i]!);
  }
  return area2(pts);
}

/** Outer rings clockwise, holes anticlockwise (in lon/lat), as the existing atlas data is. */
function orient(built: Built): void {
  for (const ref of built.refs) {
    const signed = ringSigned(built, ref.ring);
    if (ref.hole ? signed < 0 : signed > 0) ref.ring = [...ref.ring].reverse().map((r) => ~r);
  }
}

/** The `polys` of one feature: per polygon, [outer ring, hole rings…] as arc references. */
function polysOf(built: Built, owner: string): number[][][] {
  const polys = new Map<number, { outer: number[]; holes: number[][] }>();
  for (const ref of built.refs) {
    if (ref.owner !== owner) continue;
    const entry = polys.get(ref.poly) ?? { outer: [], holes: [] };
    if (ref.hole) entry.holes.push(ref.ring); else entry.outer = ref.ring;
    polys.set(ref.poly, entry);
  }
  return [...polys.entries()].sort((a, b) => a[0] - b[0]).filter(([, e]) => e.outer.length && ringSigned(built, e.outer) !== 0).map(([, e]) => [e.outer, ...e.holes]);
}

const arcText = (built: Built): string => built.arcs.map((arc) => encodeArc(arc.points)).join(',');

// ---- the lagoon: Lagos State minus the 20 local governments ----------------------------------------------------------

/** Rasterises polygons (even-odd) at cell centres into `mask`. */
function fillPolygons(mask: Uint8Array, polys: readonly Polygon[], box: { minLon: number; minLat: number; w: number; h: number; g: number }): void {
  const { minLon, minLat, w, h, g } = box;
  for (const poly of polys) {
    const edges: [number, number, number, number][] = [];
    for (const ring of poly) for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]); }
    let lo = Infinity, hi = -Infinity;
    for (const ring of poly) for (const p of ring) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    for (let j = Math.max(0, Math.floor((lo - minLat) / g) - 1); j < Math.min(h, Math.ceil((hi - minLat) / g) + 1); j++) {
      const y = minLat + (j + 0.5) * g, xs: number[] = [];
      for (const [x1, y1, x2, y2] of edges) if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k]! - minLon) / g - 0.5)); i < w && minLon + (i + 0.5) * g < xs[k + 1]!; i++) mask[j * w + i] = 1;
    }
  }
}

/** Removes 4-connected components of `value` smaller than `min` cells (they become the other value). */
function dropSmall(mask: Uint8Array, w: number, h: number, value: number, min: number): void {
  const seen = new Uint8Array(mask.length), stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start] !== value) continue;
    const cells: number[] = [start]; seen[start] = 1; stack.push(start);
    while (stack.length) {
      const c = stack.pop()!, x = c % w, y = (c - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (!seen[k] && mask[k] === value) { seen[k] = 1; cells.push(k); stack.push(k); }
      }
    }
    if (cells.length < min) for (const c of cells) mask[c] = 1 - value;
  }
}

/** The boundary of the set cells of `mask` as closed rings (outer: anticlockwise, holes: clockwise), in lon/lat. */
function trace(mask: Uint8Array, box: { minLon: number; minLat: number; w: number; h: number; g: number }): Pt[][] {
  const { w, h, g, minLon, minLat } = box, stride = w + 1;
  const out = new Map<number, number[]>();
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && mask[j * w + i] === 1;
  const edge = (x1: number, y1: number, x2: number, y2: number) => { const k = y1 * stride + x1; const list = out.get(k); const to = y2 * stride + x2; if (list) list.push(to); else out.set(k, [to]); };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) edge(i, j, i + 1, j);
    if (!at(i + 1, j)) edge(i + 1, j, i + 1, j + 1);
    if (!at(i, j + 1)) edge(i + 1, j + 1, i, j + 1);
    if (!at(i - 1, j)) edge(i, j + 1, i, j);
  }
  const rings: Pt[][] = [];
  for (const [start] of out) {
    while (out.get(start)?.length) {
      const ring: Pt[] = [];
      let k = start;
      do {
        const list = out.get(k)!, to = list.pop()!;
        ring.push([minLon + (k % stride) * g, minLat + Math.floor(k / stride) * g]);
        k = to;
      } while (k !== start);
      rings.push(ring);
    }
  }
  return rings;
}

const pointIn = (p: Pt, ring: readonly Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

/** Traced rings → polygons: each anticlockwise ring with the clockwise rings inside it as holes. */
function polygonsFromRings(rings: Pt[][]): Polygon[] {
  const outers = rings.filter((r) => area2(r) > 0).map((r): Polygon => [r]);
  for (const hole of rings.filter((r) => area2(r) < 0)) {
    const host = outers.filter((o) => pointIn(hole[0]!, o[0]!)).sort((a, b) => area2(a[0]!) - area2(b[0]!))[0];
    if (host) host.push(hole);
  }
  return outers;
}

function lagoonOf(state: readonly Polygon[], lgas: readonly Polygon[]): Polygon[] {
  const g = TOLERANCE.lagos.rasterGrid;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const poly of state) for (const p of poly[0]!) { minLon = Math.min(minLon, p[0]); maxLon = Math.max(maxLon, p[0]); minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]); }
  const box = { minLon: minLon - 2 * g, minLat: minLat - 2 * g, w: Math.ceil((maxLon - minLon) / g) + 5, h: Math.ceil((maxLat - minLat) / g) + 5, g };
  const inState = new Uint8Array(box.w * box.h), land = new Uint8Array(box.w * box.h), water = new Uint8Array(box.w * box.h);
  fillPolygons(inState, state, box); fillPolygons(land, lgas, box);
  for (let i = 0; i < water.length; i++) water[i] = inState[i] && !land[i] ? 1 : 0;
  const cellKm2 = ((g * 111.195) * (g * 111.195 * Math.cos((9 * Math.PI) / 180)));
  dropSmall(water, box.w, box.h, 1, Math.round(LAGOON_MIN_KM2 / cellKm2));
  dropSmall(water, box.w, box.h, 0, Math.round(ISLAND_MIN_KM2 / cellKm2));
  return polygonsFromRings(trace(water, box));
}

// ---- Lagos -----------------------------------------------------------------------------------------------------------

/** [name in geoBoundaries ADM2, game id, game name] */
const LGAS: readonly [string, string, string][] = [
  ['Agege', 'agege', 'Agege'], ['Ajeromi/Ifelodun', 'ajeromi-ifelodun', 'Ajeromi-Ifelodun'], ['Alimosho', 'alimosho', 'Alimosho'], ['Amuwo Odofin', 'amuwo-odofin', 'Amuwo-Odofin'],
  ['Apapa', 'apapa', 'Apapa'], ['Badagry', 'badagry', 'Badagry'], ['Epe', 'epe', 'Epe'], ['Eti Osa', 'eti-osa', 'Eti-Osa'], ['Ibeju Lekki', 'ibeju-lekki', 'Ibeju-Lekki'],
  ['Ifako/Ijaye', 'ifako-ijaiye', 'Ifako-Ijaiye'], ['Ikeja', 'ikeja', 'Ikeja'], ['Ikorodu', 'ikorodu', 'Ikorodu'], ['Kosofe', 'kosofe', 'Kosofe'], ['Lagos Island', 'lagos-island', 'Lagos Island'],
  ['Lagos Mainland', 'lagos-mainland', 'Lagos Mainland'], ['Mushin', 'mushin', 'Mushin'], ['Ojo', 'ojo', 'Ojo'], ['Oshodi/Isolo', 'oshodi-isolo', 'Oshodi-Isolo'], ['Shomolu', 'somolu', 'Somolu'], ['Surulere', 'surulere', 'Surulere'],
];

function lagosInputs(adm1: GeoFeatureCollection, adm2: GeoFeatureCollection): { rings: RingInput[]; names: Map<string, string>; statePolys: Polygon[]; lgaPolys: Polygon[] } {
  const rings: RingInput[] = [], lgaPolys: Polygon[] = [], names = new Map<string, string>();
  for (const [source, id, name] of LGAS) {
    // 'Surulere' also exists in Oyo State: take the one inside Lagos.
    const found = adm2.features.filter((feature) => feature.properties.shapeName === source && polygonsOf(feature)[0]?.[0]?.every(([lon, lat]) => lon > 2.6 && lon < 4.5 && lat > 6.3 && lat < 6.8) === true);
    if (found.length !== 1) throw new Error(`${source}: ${found.length} matches in Lagos`);
    const feature = found[0];
    if (!feature) throw new Error(`${source}: missing matched feature`);
    names.set(id, name);
    polygonsOf(feature).forEach((poly, p) => { poly.forEach((ring, r) => rings.push({ owner: id, poly: p, hole: r > 0, pts: ring })); lgaPolys.push(poly); });
  }
  const state = adm1.features.find((feature) => feature.properties.shapeName === 'Lagos');
  if (!state) throw new Error('Lagos State is missing from ADM1');
  const statePolys = polygonsOf(state);
  names.set('lagos-state', 'Lagos State');
  statePolys.forEach((poly, p) => poly.forEach((ring, r) => rings.push({ owner: 'lagos-state', poly: p, hole: r > 0, pts: ring })));
  return { rings, names, statePolys, lgaPolys };
}

const featureText = (feature: Record<string, unknown>): string => JSON.stringify(feature);
const bytes = (text: string): number => Buffer.byteLength(text);
const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

interface AtlasFeature extends Record<string, unknown> { id: string; name: string }
interface AtlasModule {
  NIGERIA: { features: AtlasFeature[] }
  AROUND: Record<string, unknown>
  WATER: { rivers: unknown[]; lakes: { name: string; ring: number[] }[] }
}

function atlasModuleOf(value: unknown): AtlasModule {
  if (!isRecord(value) || !isRecord(value.NIGERIA) || !Array.isArray(value.NIGERIA.features) || !isRecord(value.AROUND) || !isRecord(value.WATER)
    || !Array.isArray(value.WATER.rivers) || !Array.isArray(value.WATER.lakes)) throw new TypeError('The existing Nigeria atlas module has an unexpected shape');
  const features = value.NIGERIA.features.map((feature, index): AtlasFeature => {
    if (!isRecord(feature) || typeof feature.id !== 'string' || typeof feature.name !== 'string') throw new TypeError(`NIGERIA.features[${index}] is invalid`);
    return { ...feature, id: feature.id, name: feature.name };
  });
  const lakes = value.WATER.lakes.map((lake, index) => {
    if (!isRecord(lake) || typeof lake.name !== 'string' || !Array.isArray(lake.ring) || !lake.ring.every(finite)) throw new TypeError(`WATER.lakes[${index}] is invalid`);
    return { name: lake.name, ring: [...lake.ring] };
  });
  return { NIGERIA: { features }, AROUND: value.AROUND, WATER: { rivers: [...value.WATER.rivers], lakes } };
}

function refsOf(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || !value.every((item) => Number.isSafeInteger(item))) throw new TypeError(`${label}: expected integer arc references`);
  return [...value];
}

function rawTopoOf(value: unknown, label: string): RawTopo<FeatureData> {
  if (!isRecord(value) || !finite(value.grid) || value.grid <= 0 || typeof value.arcs !== 'string' || !Array.isArray(value.features)) throw new TypeError(`${label}: invalid topology`);
  const features = value.features.map((feature, featureIndex): FeatureData => {
    if (!isRecord(feature) || typeof feature.id !== 'string' || typeof feature.name !== 'string' || !Array.isArray(feature.polys)) throw new TypeError(`${label}.features[${featureIndex}]: invalid feature`);
    const polys = feature.polys.map((polygon, polygonIndex) => {
      if (!Array.isArray(polygon)) throw new TypeError(`${label}.features[${featureIndex}].polys[${polygonIndex}]: invalid polygon`);
      return polygon.map((ring, ringIndex) => refsOf(ring, `${label}.features[${featureIndex}].polys[${polygonIndex}][${ringIndex}]`));
    });
    return { id: feature.id, name: feature.name, polys };
  });
  return { grid: value.grid, arcs: value.arcs, features };
}

function topologyFromText(text: string, label: string): RawTopo<FeatureData> {
  const marker = 'export const LAGOS: RawTopo = ';
  const start = text.indexOf(marker);
  const end = start < 0 ? -1 : text.indexOf(';', start + marker.length);
  if (start < 0 || end < 0) throw new TypeError(`${label}: cannot find the LAGOS topology`);
  const parsed: unknown = JSON.parse(text.slice(start + marker.length, end));
  return rawTopoOf(parsed, label);
}

function decodedHash(raw: RawTopo<FeatureData>): string {
  const decoded = decodeTopology(raw);
  return sha256(JSON.stringify({ grid: decoded.grid, arcs: decoded.arcs.map((arc) => [...arc]), features: decoded.features.map((feature) => ({ id: feature.id, rings: feature.rings.map((polygon) => polygon.map((ring) => [...ring])), bounds: feature.bounds })) }));
}

function output(path: string, text: string, check: boolean, topology = false): void {
  const generatedHash = sha256(text);
  if (check) {
    const actual = readFileSync(path, 'utf8');
    const actualHash = sha256(actual);
    if (actual !== text) throw new Error(`${path}: generated text ${generatedHash} differs from ${actualHash}`);
    if (topology) {
      const generatedGeometry = decodedHash(topologyFromText(text, `${path} generated`));
      const actualGeometry = decodedHash(topologyFromText(actual, `${path} actual`));
      if (generatedGeometry !== actualGeometry) throw new Error(`${path}: decoded geometry differs (${generatedGeometry} != ${actualGeometry})`);
      console.log(`${path}: check ok, sha256 ${actualHash}, decoded ${actualGeometry}`);
      return;
    }
    console.log(`${path}: check ok, sha256 ${actualHash}`);
    return;
  }
  writeFileSync(path, text);
  console.log(`${path}: wrote sha256 ${generatedHash}`);
}

interface Options { check: boolean; nigeria: boolean }

function optionsOf(args: readonly string[]): Options {
  const allowed = new Set(['--check', '--lagos-only', '--nigeria']);
  const unknown = args.filter((arg) => !allowed.has(arg));
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}`);
  if (args.includes('--lagos-only') && args.includes('--nigeria')) throw new Error('--lagos-only and --nigeria cannot be combined');
  return { check: args.includes('--check'), nigeria: args.includes('--nigeria') };
}

async function main(options: Options): Promise<void> {
  const [adm1, adm2] = [await load('adm1'), await load('adm2')];
  const lagos = lagosInputs(adm1, adm2);
  const lagoon = lagoonOf(lagos.statePolys, lagos.lgaPolys);
  console.log(`lagoon: ${lagoon.length} pieces, ${lagoon.reduce((sum, poly) => sum + km2(poly[0]!), 0).toFixed(1)} km² outer`);

  // ---- lagos.ts
  const T = TOLERANCE.lagos;
  const lagoonInputs: RingInput[] = lagoon.flatMap((poly, p) => poly.map((ring, r): RingInput => ({ owner: 'lagoon', poly: p, hole: r > 0, pts: ring })));
  const lagosBuilt = build([...lagos.rings, ...lagoonInputs], T.grid, (owners) => (owners.has('lagoon') ? T.lagoon : owners.has('lagos-state') && owners.size === 1 ? T.state : T.lga));
  const lagosFeatures = [...LGAS.map(([, id, name]) => ({ id, name })), { id: 'lagos-state', name: 'Lagos State' }, { id: 'lagoon', name: 'Lagos Lagoon (derived)' }]
    .map((f) => featureText({ ...f, polys: polysOf(lagosBuilt, f.id) }));
  const lagosText = `/**
 * GENERATED DATA — do not edit by hand (npm run geo:boundaries).
 * The 20 local governments of Lagos State, the Lagos State outline and the Lagos Lagoon, as one shared-arc topology
 * (format: see ../topo.ts; reader: ../lagos-shapes.ts). Feature ids are the game's local-government ids, plus
 * 'lagos-state' and 'lagoon'. Loaded lazily, with the Lagos city map.
 * Source: geoBoundaries gbOpen Nigeria, release ${RELEASE} (https://www.geoboundaries.org), ADM2 (boundaryID NGA-ADM2-59680162,
 *   local governments) and ADM1 (NGA-ADM1-27671186, states). Original source GRID3, year 2022; built 12 December 2023.
 *   Licence CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: selected, simplified, quantised, converted.
 * The local governments are land only: the Lagos Lagoon and the Lekki Lagoon are gaps between them. The State outline
 * includes the Lagos Lagoon. 'lagoon' is derived: the State outline minus the union of the 20 local governments, traced
 * from a raster of ${T.rasterGrid} degrees; pieces under ${LAGOON_MIN_KM2} km² and islands under ${ISLAND_MIN_KM2} km² are dropped.
 * Processing: shared-arc topology (a border two regions share is one arc), each arc simplified once with Visvalingam–Whyatt,
 * effective-area threshold ${T.lga} square map units (1 unit = 100 m) for borders, ${T.state} for the State's own edge, ${T.lagoon} for the lagoon,
 * quantised to ${T.grid} degrees (about 22 m).
 */
/* eslint-disable */
import type { RawTopo } from '../topo.ts';
export const LAGOS: RawTopo = {"grid":${T.grid},"arcs":${JSON.stringify(arcText(lagosBuilt))},"features":[
${lagosFeatures.join(',\n')}
]};
`;
  output(join(root, 'src/map3d/geo/data/lagos.ts'), lagosText, options.check, true);
  console.log(`lagos.ts ${bytes(lagosText)} bytes, ${lagosBuilt.arcs.length} arcs, ${lagosBuilt.arcs.reduce((n, a) => n + a.points.length, 0)} points`);
  if (!options.nigeria) return;

  // ---- nigeria.ts
  const nigeriaPath = join(root, 'src/map3d/geo/data/nigeria.ts');
  const imported: unknown = await import(`${nigeriaPath}?t=${Date.now()}`);
  const old = atlasModuleOf(imported);
  const N = TOLERANCE.nigeria, byName = new Map(old.NIGERIA.features.map((f) => [f.name, f]));
  const states: RingInput[] = [];
  for (const feature of adm1.features) {
    const name = feature.properties.shapeName === 'Abuja Federal Capital Territory' ? 'Federal Capital Territory' : feature.properties.shapeName;
    const meta = byName.get(name);
    if (!meta) throw new Error(`No state ${name} in the atlas data`);
    polygonsOf(feature).forEach((poly, p) => poly.forEach((ring, r) => states.push({ owner: meta.id, poly: p, hole: r > 0, pts: ring })));
  }
  const nigeriaBuilt = build(states, N.grid, (owners) => (owners.has('lagos') ? N.lagos : N.general));
  const nigeriaTopo = { grid: N.grid, arcs: arcText(nigeriaBuilt), features: old.NIGERIA.features.map((f) => ({ ...f, polys: polysOf(nigeriaBuilt, f.id) })) };
  const lakes = old.WATER.lakes.filter((lake) => !lake.name.startsWith('Lagos Lagoon') && !lake.name.startsWith('Lekki Lagoon'));
  const pieces = lagoon.map((poly) => poly[0]!).filter((ring) => km2(ring) >= 1).sort((a, b) => km2(b) - km2(a));
  pieces.forEach((ring, i) => {
    const closed = [...ring, ring[0]!], kept = visvalingam(closed, N.lagoonLake, 4).map((k) => closed[k]!).slice(0, -1);
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const flat = kept.flatMap(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    lakes.push({ name: lon > 3.75 ? (i === 0 || pieces.findIndex((p) => p.reduce((s, q) => s + q[0], 0) / p.length > 3.75) === i ? 'Lekki Lagoon' : `Lekki Lagoon ${i + 1}`) : (i === 0 ? 'Lagos Lagoon' : `Lagos Lagoon ${i + 1}`), ring: flat });
  });
  const nigeriaText = `/**
 * GENERATED DATA — do not edit by hand (npm run geo:boundaries).
 * States: geoBoundaries gbOpen Nigeria ADM1, release ${RELEASE} (boundaryID NGA-ADM1-27671186; https://www.geoboundaries.org), original
 *   source GRID3, year 2022, licence CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: simplified, quantised, converted.
 *   Lagos State's own geometry also comes from the ADM2 file (see ./lagos.ts); the Lagos lakes below are derived from both.
 * Everything else here is carried over unchanged from the earlier Natural Earth build (naturalearthdata.com), public domain —
 * "No permission is needed to use Natural Earth.":
 *   ne_50m_admin_0_countries.geojson (the neighbouring countries)
 *   ne_10m_rivers_lake_centerlines.geojson (Niger; Benue with its upper course, Bénoué)
 *   ne_10m_lakes.geojson (Lake Chad, Kainji Reservoir)
 *   ne_10m_populated_places_simple.geojson (state capitals)
 * Boundaries of the neighbours are Natural Earth's default view (its de facto points of view); Allworld takes no position
 * on any disputed border.
 * Processing: states: shared-arc topology, each arc simplified once with Visvalingam–Whyatt, effective-area threshold ${N.general}
 *   square map units (1 unit = 100 m), ${N.lagos} for arcs of Lagos State so its coast, lagoon shore and barrier-island coast stay
 *   recognisable; quantised to ${N.grid}°. Neighbours: threshold 0.002 on Nigeria's border, 0.012 elsewhere, quantised to 0.01°.
 *   Lakes 'Lagos Lagoon' and 'Lekki Lagoon' are DERIVED: Lagos State (ADM1) minus the union of the 20 local governments (ADM2, land only),
 *   traced from a raster, simplified (threshold ${N.lagoonLake}), pieces under 1 km² dropped, islands inside them ignored.
 * Format: see ../topo.ts (shared-arc topology, quantised, delta + variable-length encoded).
 */
/* eslint-disable */
import type { AroundTopology, NigeriaTopology, WaterData } from '../topo.ts';
export const NIGERIA: NigeriaTopology = ${JSON.stringify(nigeriaTopo)};
export const AROUND: AroundTopology = ${JSON.stringify(old.AROUND)};
export const WATER: WaterData = ${JSON.stringify({ rivers: old.WATER.rivers, lakes })};
`;
  output(nigeriaPath, nigeriaText, options.check);
  console.log(`nigeria.ts ${bytes(nigeriaText)} bytes, ${nigeriaBuilt.arcs.length} arcs, ${nigeriaBuilt.arcs.reduce((n, a) => n + a.points.length, 0)} points; lakes: ${lakes.map((l) => l.name).join(', ')}`);
}
await main(optionsOf(process.argv.slice(2)));
