// npm run geo:boundaries — rebuilds Lagos only. Pass --oyo, --ogun, --rivers, --fct, --kano or --nigeria for another explicit target.
//
//   node --experimental-strip-types scripts/geo/build-boundaries.ts [--lagos-only] [--check]
//   node --experimental-strip-types scripts/geo/build-boundaries.ts --oyo [--check]
//   node --experimental-strip-types scripts/geo/build-boundaries.ts --ogun [--check]
//   node --experimental-strip-types scripts/geo/build-boundaries.ts --rivers [--check]
//   node --experimental-strip-types scripts/geo/build-boundaries.ts --fct [--check]
//   node --experimental-strip-types scripts/geo/build-boundaries.ts --kano [--check]
//   node --experimental-strip-types scripts/geo/build-boundaries.ts --nigeria [--check]
//
// Sources (pinned by revision and sha256; fetched once into .cache/geo, verified every run):
//   geoBoundaries gbOpen NGA ADM1 (states) and ADM2 (local governments), release 9469f09, source GRID3,
//   licence CC BY 4.0 (see NOTICE.md). The same two files are recorded in src/models/geo/provenance.json.
//
// Writes:
//   src/map3d/geo/data/lagos.ts    the 20 Lagos local governments, the Lagos State outline and the derived lagoon
//   src/map3d/geo/data/oyo.ts      all 33 Oyo local governments and an Oyo State outline cut from the shared ADM1 topology
//   src/map3d/geo/data/ogun.ts     all 20 Ogun local governments and an Ogun State outline locked to accepted Lagos
//   src/map3d/geo/data/rivers.ts   all 23 Rivers local governments and the Rivers State outline
//   src/map3d/geo/data/fct.ts      all six FCT area councils, water cutouts, roads and Idu–Rigasa rail
//   src/map3d/geo/data/nigeria.ts  the 37 states (geoBoundaries ADM1) plus, unchanged, the neighbouring countries
//                                  and the rivers and lakes that file already held, plus the derived Lagos lagoon
//
// How: every ring of a layer is cut into arcs wherever the set of rings using the boundary changes, so a border two
// regions share is ONE arc. Each arc is simplified once (Visvalingam–Whyatt, effective area in map units of the
// Nigeria frame, 1 unit = 100 m) and quantised once; both neighbours then draw the same vertices.
// The lagoon is derived: Lagos State (ADM1, which includes the lagoon) minus the union of the 20 local governments
// (ADM2, which are land only), found on a raster of 0.0002 degrees, traced, and simplified.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from '../../src/map3d/geo/frame.ts';
import { LAGOS } from '../../src/map3d/geo/data/lagos.ts';
import { decodeTopology, encodeArc } from '../../src/map3d/geo/topo.ts';
import type { FeatureData, RawTopo } from '../../src/map3d/geo/topo.ts';
import {
  NIGERIA_BOUNDARY_RELEASE,
  finite,
  geometryPolygons,
  isRecord,
  loadNigeriaBoundarySource,
  pointOf,
  polygonsOf,
} from './nigeria-boundaries.ts';
import type {
  BoundaryFeature as GeoFeature,
  BoundaryFeatureCollection as GeoFeatureCollection,
  Point as Pt,
  Polygon,
} from './nigeria-boundaries.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE = NIGERIA_BOUNDARY_RELEASE;
const ACCEPTED_LAGOS_SHA256 = 'e65bb768f638d863576bf64dc800fb4823777def95813e4ed8171678ec7ac1f9';

/** Tolerances. Effective areas are in square map units (1 unit = 100 m, so 1 unit² = 10 000 m²). */
export const TOLERANCE = {
  lagos: { grid: 0.0002, lga: 0.01, state: 0.01, lagoon: 0.05, rasterGrid: 0.0002 },
  oyo: { grid: 0.0002, lga: 0.01, state: 0.01 },
  ogun: { grid: 0.0002, lga: 0.01, state: 0.01 },
  rivers: { grid: 0.0002, lga: 0.01, state: 0.01, waterGrid: 0.000001, water: 0.0001,
    overviewWaterGrid: 0.00005, overviewWater: 0.05, mangroveGrid: 0.00002, mangrove: 0.02 },
  kano: { grid: 0.000001, lga: 0.0001, state: 0.0001, surfaceGrid: 0.000001, surface: 0.0001, overviewGrid: 0.00002, overview: 0.02 },
  fct: { grid: 0.0002, council: 0.01, state: 0.01, surfaceGrid: 0.000001, surface: 0.0001 },
  nigeria: { grid: 0.001, general: 3, lagos: 0.15, lagoonLake: 1.5 },
};
/** The smallest lagoon pieces kept, and the smallest islands of land inside it that still cut a hole, in km². */
const LAGOON_MIN_KM2 = 0.5, ISLAND_MIN_KM2 = 0.05;

const load = loadNigeriaBoundarySource;

// ---- geometry helpers ----------------------------------------------------------------------------------------------

const unitsOf = ([lon, lat]: Pt): Pt => { const p = project(lon, lat); return [p.x, p.z]; };
/** Twice the signed area of a ring in lon/lat (positive = anticlockwise). */
function area2(ring: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; sum += a[0] * b[1] - b[0] * a[1]; }
  return sum;
}
const km2 = (ring: readonly Pt[]): number => Math.abs(area2(ring.map(unitsOf))) / 2 / 100;
const polygonKm2 = (polygon: Polygon): number => km2(polygon[0]!) - polygon.slice(1).reduce((sum, hole) => sum + km2(hole), 0);
const polygonsKm2 = (polygons: readonly Polygon[]): number => polygons.reduce((sum, polygon) => sum + polygonKm2(polygon), 0);

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

/** Retains selected owners without rebuilding or resimplifying their arcs. */
function subsetBuilt(built: Built, owners: ReadonlySet<string>): Built {
  const refs = built.refs.filter((ref) => owners.has(ref.owner));
  const used = new Set<number>();
  for (const ref of refs) for (const arc of ref.ring) used.add(arc < 0 ? ~arc : arc);
  const indexes = [...used].sort((a, b) => a - b);
  const remap = new Map(indexes.map((old, index): [number, number] => [old, index]));
  const mapRef = (ref: number): number => {
    const index = remap.get(ref < 0 ? ~ref : ref);
    if (index === undefined) throw new Error(`Arc ${ref} is absent from the selected topology`);
    return ref < 0 ? ~index : index;
  };
  return {
    grid: built.grid,
    arcs: indexes.map((index) => built.arcs[index]!),
    refs: refs.map((ref) => ({ ...ref, ring: ref.ring.map(mapRef) })),
  };
}

const quantised = ([x, y]: Pt, grid: number): Pt => [Math.round(x / grid), Math.round(y / grid)];
const pointKey = ([x, y]: Pt): string => `${x},${y}`;
const edgeKey = (a: Pt, b: Pt): string => pointKey(a) < pointKey(b) ? `${pointKey(a)}|${pointKey(b)}` : `${pointKey(b)}|${pointKey(a)}`;

/** The one exact raw-source edge chain shared by `neighbour` and `target`, walked in target-ring order. */
function rawSharedChain(neighbour: readonly Polygon[], target: readonly Polygon[]): Pt[] {
  const targetRing = target[0]?.[0];
  if (!targetRing || target.length !== 1) throw new Error('The Lagos-Ogun seam target requires one outer polygon');
  const neighbourEdges = new Set<string>();
  for (const polygon of neighbour) for (const ring of polygon) for (let index = 0; index < ring.length; index += 1) neighbourEdges.add(edgeKey(ring[index]!, ring[(index + 1) % ring.length]!));
  const shared = new Set(targetRing.flatMap((point, index) => neighbourEdges.has(edgeKey(point, targetRing[(index + 1) % targetRing.length]!)) ? [index] : []));
  const starts = [...shared].filter((index) => !shared.has((index - 1 + targetRing.length) % targetRing.length));
  if (starts.length !== 1 || shared.size < 2) throw new Error(`Expected one Lagos-Ogun raw seam, found ${starts.length} chains and ${shared.size} edges`);
  const points: Pt[] = [], start = starts[0]!;
  let index = start;
  points.push(targetRing[index]!);
  while (shared.has(index)) {
    index = (index + 1) % targetRing.length;
    points.push(targetRing[index]!);
    if (points.length > shared.size + 1) throw new Error('The Lagos-Ogun raw seam did not terminate');
  }
  if (points.length !== shared.size + 1) throw new Error('The Lagos-Ogun raw seam is not contiguous');
  return points;
}

const ringPoints = (ring: Float64Array): Pt[] => {
  const points: Pt[] = [];
  for (let index = 0; index < ring.length; index += 2) points.push([ring[index]!, ring[index + 1]!]);
  return points;
};

const cyclicPath = (points: readonly Pt[], from: number, to: number): Pt[] => {
  const path: Pt[] = [];
  for (let index = from; ; index = (index + 1) % points.length) {
    path.push(points[index]!);
    if (index === to) return path;
  }
};

/** The accepted Lagos-state path corresponding to the exact raw shared chain, in accepted-ring order. */
function acceptedLagosSeam(raw: readonly Pt[], grid: number): Pt[] {
  const feature = decodeTopology(LAGOS).byId.get('lagos-state');
  const ring = feature?.rings[0]?.[0];
  if (!ring) throw new Error('The accepted Lagos topology has no state outline');
  const accepted = ringPoints(ring).map((point) => quantised(point, grid));
  const rawKeys = new Set(raw.map((point) => pointKey(quantised(point, grid))));
  const endpoints = [quantised(raw[0]!, grid), quantised(raw.at(-1)!, grid)] as const;
  const indexes = endpoints.map((endpoint) => accepted.findIndex((point) => pointKey(point) === pointKey(endpoint)));
  if (indexes.some((index) => index < 0)) throw new Error('A raw Lagos-Ogun seam endpoint is absent from the accepted Lagos topology');
  const forward = cyclicPath(accepted, indexes[0]!, indexes[1]!);
  const backward = cyclicPath(accepted, indexes[1]!, indexes[0]!).reverse();
  const score = (path: readonly Pt[]) => path.filter((point) => rawKeys.has(pointKey(point))).length;
  const chosen = score(forward) > score(backward) ? forward : backward;
  if (chosen.some((point) => !rawKeys.has(pointKey(point)))) throw new Error('The accepted Lagos seam contains a vertex outside the raw shared source chain');
  if (pointKey(chosen[0]!) !== pointKey(endpoints[0]) || pointKey(chosen.at(-1)!) !== pointKey(endpoints[1])) throw new Error('The accepted Lagos seam has the wrong orientation');
  return chosen;
}

const directedArc = (built: Built, ref: number): Pt[] => {
  const points = built.arcs[ref < 0 ? ~ref : ref]!.points;
  return ref < 0 ? [...points].reverse() : points;
};

/** Replaces only Ogun's Lagos-facing all-state arcs with the locked accepted Lagos-state seam. */
function lockAcceptedLagosSeam(allStates: Built, rawLagos: readonly Polygon[], rawOgun: readonly Polygon[]): { built: Built; seamPoints: number } {
  const target = subsetBuilt(allStates, new Set(['ogun-state']));
  const reference = target.refs.find((ref) => ref.owner === 'ogun-state' && ref.poly === 0 && !ref.hole);
  if (!reference) throw new Error('The Ogun state topology has no outer ring');
  const shared = (ref: number): boolean => {
    const owners = target.arcs[ref < 0 ? ~ref : ref]!.owners;
    return owners.has('ogun-state') && owners.has('state:Lagos');
  };
  const starts = reference.ring.flatMap((ref, index) => shared(ref) && !shared(reference.ring[(index - 1 + reference.ring.length) % reference.ring.length]!) ? [index] : []);
  if (starts.length !== 1) throw new Error(`Expected one Lagos-facing Ogun arc run, found ${starts.length}`);
  const rotated = [...reference.ring.slice(starts[0]), ...reference.ring.slice(0, starts[0])];
  const seamCount = rotated.findIndex((ref) => !shared(ref));
  if (seamCount <= 0 || rotated.slice(seamCount).some(shared)) throw new Error('The Lagos-facing Ogun arcs are not one contiguous run');
  const raw = rawSharedChain(rawLagos, rawOgun), accepted = acceptedLagosSeam(raw, target.grid);
  const first = directedArc(target, rotated[0]!)[0]!, last = directedArc(target, rotated[seamCount - 1]!).at(-1)!;
  const oriented = pointKey(first) === pointKey(accepted[0]!) && pointKey(last) === pointKey(accepted.at(-1)!)
    ? accepted
    : pointKey(first) === pointKey(accepted.at(-1)!) && pointKey(last) === pointKey(accepted[0]!) ? [...accepted].reverse() : null;
  if (!oriented) throw new Error(`Accepted Lagos seam endpoints ${pointKey(accepted[0]!)}/${pointKey(accepted.at(-1)!)} do not match Ogun ${pointKey(first)}/${pointKey(last)}`);
  const seamArc = target.arcs.length;
  const withLocked: Built = {
    ...target,
    arcs: [...target.arcs, { points: oriented, owners: new Set(['ogun-state', 'state:Lagos']) }],
    refs: target.refs.map((ref) => ref === reference ? { ...ref, ring: [seamArc, ...rotated.slice(seamCount)] } : ref),
  };
  return { built: subsetBuilt(withLocked, new Set(['ogun-state'])), seamPoints: accepted.length };
}

/** Locks the Ado Odo/Ota land edge to the same accepted Lagos path used by adjacent Lagos LGAs. */
function lockAcceptedLagosLgaSeam(allLgas: Built, rawLagosLgas: readonly Polygon[], rawOta: readonly Polygon[]): { built: Built; seamPoints: number } {
  const reference = allLgas.refs.find((ref) => ref.owner === 'ado-odo-ota' && ref.poly === 0 && !ref.hole);
  if (!reference) throw new Error('The Ado Odo/Ota topology has no outer ring');
  const raw = rawSharedChain(rawLagosLgas, rawOta), rawKeys = new Set(raw.map((point) => pointKey(quantised(point, allLgas.grid))));
  const onSeam = (ref: number): boolean => directedArc(allLgas, ref).every((point) => rawKeys.has(pointKey(point)));
  const starts = reference.ring.flatMap((ref, index) => onSeam(ref) && !onSeam(reference.ring[(index - 1 + reference.ring.length) % reference.ring.length]!) ? [index] : []);
  if (starts.length !== 1) throw new Error(`Expected one Lagos-facing Ota LGA arc run, found ${starts.length}`);
  const rotated = [...reference.ring.slice(starts[0]), ...reference.ring.slice(0, starts[0])];
  const seamCount = rotated.findIndex((ref) => !onSeam(ref));
  if (seamCount <= 0 || rotated.slice(seamCount).some(onSeam)) throw new Error('The Lagos-facing Ota LGA arcs are not one contiguous run');
  const accepted = acceptedLagosSeam(raw, allLgas.grid);
  const first = directedArc(allLgas, rotated[0]!)[0]!, last = directedArc(allLgas, rotated[seamCount - 1]!).at(-1)!;
  const oriented = pointKey(first) === pointKey(accepted[0]!) && pointKey(last) === pointKey(accepted.at(-1)!)
    ? accepted
    : pointKey(first) === pointKey(accepted.at(-1)!) && pointKey(last) === pointKey(accepted[0]!) ? [...accepted].reverse() : null;
  if (!oriented) throw new Error(`Accepted Lagos land seam endpoints do not match Ota ${pointKey(first)}/${pointKey(last)}`);
  const seamArc = allLgas.arcs.length;
  const withLocked: Built = {
    ...allLgas,
    arcs: [...allLgas.arcs, { points: oriented, owners: new Set(['ado-odo-ota', 'accepted:Lagos-LGAs']) }],
    refs: allLgas.refs.map((ref) => ref === reference ? { ...ref, ring: [seamArc, ...rotated.slice(seamCount)] } : ref),
  };
  const owners = new Set(OGUN_LGAS.map(([, id]) => id));
  return { built: subsetBuilt(withLocked, owners), seamPoints: accepted.length };
}

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

// ---- Oyo -------------------------------------------------------------------------------------------------------------

/** [name in geoBoundaries ADM2, game id, display name] */
const OYO_LGAS: readonly [string, string, string][] = [
  ['Afijio', 'afijio', 'Afijio'], ['Akinyele', 'akinyele', 'Akinyele'], ['Atiba', 'atiba', 'Atiba'], ['Atisbo', 'atisbo', 'Atisbo'],
  ['Egbeda', 'egbeda', 'Egbeda'], ['Ibadan North', 'ibadan-north', 'Ibadan North'], ['Ibadan North East', 'ibadan-north-east', 'Ibadan North-East'],
  ['Ibadan North West', 'ibadan-north-west', 'Ibadan North-West'], ['Ibadan South East', 'ibadan-south-east', 'Ibadan South-East'],
  ['Ibadan South West', 'ibadan-south-west', 'Ibadan South-West'], ['Ibarapa Central', 'ibarapa-central', 'Ibarapa Central'],
  ['Ibarapa East', 'ibarapa-east', 'Ibarapa East'], ['Ibarapa North', 'ibarapa-north', 'Ibarapa North'], ['Ido', 'ido', 'Ido'],
  ['Irepo', 'irepo', 'Irepo'], ['Iseyin', 'iseyin', 'Iseyin'], ['Itesiwaju', 'itesiwaju', 'Itesiwaju'], ['Iwajowa', 'iwajowa', 'Iwajowa'],
  ['Kajola', 'kajola', 'Kajola'], ['Lagelu', 'lagelu', 'Lagelu'], ['Ogbomosho North', 'ogbomoso-north', 'Ogbomoso North'],
  ['Ogbomosho South', 'ogbomoso-south', 'Ogbomoso South'], ['Ogo Oluwa', 'ogo-oluwa', 'Ogo Oluwa'], ['Olorunsogo', 'olorunsogo', 'Olorunsogo'],
  ['Oluyole', 'oluyole', 'Oluyole'], ['Ona Ara', 'ona-ara', 'Ona Ara'], ['Orelope', 'orelope', 'Orelope'], ['Ori Ire', 'ori-ire', 'Ori Ire'],
  ['Oyo East', 'oyo-east', 'Oyo East'], ['Oyo West', 'oyo-west', 'Oyo West'], ['Saki East', 'saki-east', 'Saki East'],
  ['Saki West', 'saki-west', 'Saki West'], ['Surulere', 'surulere', 'Surulere'],
];

const IBADAN_LGA_IDS = [
  'akinyele', 'egbeda', 'ibadan-north', 'ibadan-north-east', 'ibadan-north-west', 'ibadan-south-east',
  'ibadan-south-west', 'ido', 'lagelu', 'oluyole', 'ona-ara',
] as const;

const inPolygons = (point: Pt, polygons: readonly Polygon[]): boolean => polygons.some((polygon) => pointIn(point, polygon[0]!) && !polygon.slice(1).some((hole) => pointIn(point, hole)));
const ringMean = (ring: readonly Pt[]): Pt => ring.reduce<Pt>((sum, point) => [sum[0] + point[0] / ring.length, sum[1] + point[1] / ring.length], [0, 0]);

function oyoInputs(adm1: GeoFeatureCollection, adm2: GeoFeatureCollection): {
  lgaRings: RingInput[]
  stateRings: RingInput[]
  statePolys: Polygon[]
  lgaPolys: Map<string, Polygon[]>
} {
  const state = adm1.features.find((feature) => feature.properties.shapeName === 'Oyo');
  if (!state) throw new Error('Oyo State is missing from ADM1');
  const statePolys = polygonsOf(state);
  const inOyo = adm2.features.filter((feature) => {
    const outer = polygonsOf(feature)[0]?.[0];
    return outer ? inPolygons(ringMean(outer), statePolys) : false;
  });
  const expected = new Set(OYO_LGAS.map(([source]) => source));
  const unexpected = inOyo.filter((feature) => !expected.has(feature.properties.shapeName));
  if (inOyo.length !== OYO_LGAS.length || unexpected.length) {
    throw new Error(`Oyo ADM2 selection found ${inOyo.length} features; unexpected: ${unexpected.map((feature) => feature.properties.shapeName).join(', ') || 'none'}`);
  }
  const byName = new Map(inOyo.map((feature): [string, GeoFeature] => [feature.properties.shapeName, feature]));
  const lgaRings: RingInput[] = [], lgaPolys = new Map<string, Polygon[]>();
  for (const [source, id] of OYO_LGAS) {
    const feature = byName.get(source);
    if (!feature) throw new Error(`${source}: missing from the 33 Oyo local governments`);
    const polygons = polygonsOf(feature);
    lgaPolys.set(id, polygons);
    polygons.forEach((polygon, poly) => polygon.forEach((ring, index) => lgaRings.push({ owner: id, poly, hole: index > 0, pts: ring })));
  }
  const stateRings: RingInput[] = [];
  for (const feature of adm1.features) {
    const owner = feature === state ? 'oyo-state' : `state:${feature.properties.shapeName}`;
    polygonsOf(feature).forEach((polygon, poly) => polygon.forEach((ring, index) => stateRings.push({ owner, poly, hole: index > 0, pts: ring })));
  }
  return { lgaRings, stateRings, statePolys, lgaPolys };
}

// ---- Ogun ------------------------------------------------------------------------------------------------------------

/** [name in geoBoundaries ADM2, game id, display name] */
const OGUN_LGAS: readonly [string, string, string][] = [
  ['Abeokuta North', 'abeokuta-north', 'Abeokuta North'], ['Abeokuta South', 'abeokuta-south', 'Abeokuta South'],
  ['Ado Odo/Ota', 'ado-odo-ota', 'Ado Odo/Ota'], ['Ewekoro', 'ewekoro', 'Ewekoro'], ['Ifo', 'ifo', 'Ifo'],
  ['Ijebu East', 'ijebu-east', 'Ijebu East'], ['Ijebu North', 'ijebu-north', 'Ijebu North'],
  ['Ijebu North East', 'ijebu-north-east', 'Ijebu North East'], ['Ijebu Ode', 'ijebu-ode', 'Ijebu Ode'],
  ['Ikenne', 'ikenne', 'Ikenne'], ['Imeko Afon', 'imeko-afon', 'Imeko/Afon'], ['Ipokia', 'ipokia', 'Ipokia'],
  ['Obafemi Owode', 'obafemi-owode', 'Obafemi/Owode'], ['Odeda', 'odeda', 'Odeda'], ['Odogbolu', 'odogbolu', 'Odogbolu'],
  ['Ogun Waterside', 'ogun-waterside', 'Ogun Water Side'], ['Remo North', 'remo-north', 'Remo North'],
  ['Shagamu', 'sagamu', 'Sagamu'], ['Yewa North', 'yewa-north', 'Yewa North'], ['Yewa South', 'yewa-south', 'Yewa South'],
];

const OGUN_CITY_LGA_IDS = {
  abeokuta: ['abeokuta-north', 'abeokuta-south', 'odeda', 'obafemi-owode'],
  ota: ['ado-odo-ota'],
  'ijebu-ode': ['ijebu-ode', 'ijebu-north-east', 'odogbolu'],
  sagamu: ['sagamu', 'ikenne', 'remo-north'],
} as const;
const OGUN_COMING_LGA_IDS = ['ewekoro', 'ifo', 'ijebu-east', 'ijebu-north', 'imeko-afon', 'ipokia', 'ogun-waterside', 'yewa-north', 'yewa-south'] as const;

function ogunInputs(adm1: GeoFeatureCollection, adm2: GeoFeatureCollection): {
  lgaRings: RingInput[]
  stateRings: RingInput[]
  statePolys: Polygon[]
  lagosPolys: Polygon[]
  lgaPolys: Map<string, Polygon[]>
} {
  const state = adm1.features.find((feature) => feature.properties.shapeName === 'Ogun');
  const lagos = adm1.features.find((feature) => feature.properties.shapeName === 'Lagos');
  if (!state || !lagos) throw new Error('Ogun or Lagos State is missing from ADM1');
  const statePolys = polygonsOf(state), lagosPolys = polygonsOf(lagos);
  const inOgun = adm2.features.filter((feature) => {
    const outer = polygonsOf(feature)[0]?.[0];
    return outer ? inPolygons(ringMean(outer), statePolys) : false;
  });
  const expected = new Set(OGUN_LGAS.map(([source]) => source));
  const unexpected = inOgun.filter((feature) => !expected.has(feature.properties.shapeName));
  if (inOgun.length !== OGUN_LGAS.length || unexpected.length) {
    throw new Error(`Ogun ADM2 selection found ${inOgun.length} features; unexpected: ${unexpected.map((feature) => feature.properties.shapeName).join(', ') || 'none'}`);
  }
  const byName = new Map(inOgun.map((feature): [string, GeoFeature] => [feature.properties.shapeName, feature]));
  const lgaRings: RingInput[] = [], lgaPolys = new Map<string, Polygon[]>();
  for (const [source, id] of OGUN_LGAS) {
    const feature = byName.get(source);
    if (!feature) throw new Error(`${source}: missing from the 20 Ogun local governments`);
    const polygons = polygonsOf(feature);
    lgaPolys.set(id, polygons);
    polygons.forEach((polygon, poly) => polygon.forEach((ring, index) => lgaRings.push({ owner: id, poly, hole: index > 0, pts: ring })));
  }
  const stateRings: RingInput[] = [];
  for (const feature of adm1.features) {
    const owner = feature === state ? 'ogun-state' : `state:${feature.properties.shapeName}`;
    polygonsOf(feature).forEach((polygon, poly) => polygon.forEach((ring, index) => stateRings.push({ owner, poly, hole: index > 0, pts: ring })));
  }
  return { lgaRings, stateRings, statePolys, lagosPolys, lgaPolys };
}

// ---- Rivers ----------------------------------------------------------------------------------------------------------

/** [name in the pinned ADM2 release, game id, display name]. Selection by identity preserves coastal pieces. */
const RIVERS_LGAS: readonly [string, string, string][] = [
  ['Abua/Odual', 'abua-odual', 'Abua/Odual'], ['Ahoada East', 'ahoada-east', 'Ahoada East'],
  ['Ahoada West', 'ahoada-west', 'Ahoada West'], ['Akuku Toru', 'akuku-toru', 'Akuku-Toru'],
  ['Andoni', 'andoni', 'Andoni'], ['Asari-Toru', 'asari-toru', 'Asari-Toru'], ['Bonny', 'bonny', 'Bonny'],
  ['Degema', 'degema', 'Degema'], ['Eleme', 'eleme', 'Eleme'], ['Emuoha', 'emuoha', 'Emohua'],
  ['Etche', 'etche', 'Etche'], ['Gokana', 'gokana', 'Gokana'], ['Ikwerre', 'ikwerre', 'Ikwerre'],
  ['Khana', 'khana', 'Khana'], ['Obio/Akpor', 'obio-akpor', 'Obio/Akpor'],
  ['Ogba/Egbema/Ndoni', 'ogba-egbema-ndoni', 'Ogba/Egbema/Ndoni'], ['Ogu Bolo', 'ogu-bolo', 'Ogu/Bolo'],
  ['Okrika', 'okrika', 'Okrika'], ['Omumma', 'omumma', 'Omuma'], ['Opobo/Nkoro', 'opobo-nkoro', 'Opobo/Nkoro'],
  ['Oyigbo', 'oyigbo', 'Oyigbo'], ['Port-Harcourt', 'port-harcourt', 'Port Harcourt'], ['Tai', 'tai', 'Tai'],
];
const PORT_HARCOURT_LGA_IDS = ['port-harcourt', 'obio-akpor', 'eleme', 'okrika', 'ikwerre', 'oyigbo', 'etche'] as const;
const RIVERS_COMING_LGA_IDS = RIVERS_LGAS.map(([, id]) => id).filter((id) => !PORT_HARCOURT_LGA_IDS.some((opened) => opened === id));
const RIVERS_WATER_SOURCE_SHA256 = '176197c043a0975eb5f7d1bfe72cc9e1eca3d2a297f06476eeed0f9681ac7b36';
const RIVERS_PBF_SHA256 = '6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5';

function riversWaterInputs(): { surface: RingInput[]; stateWater: RingInput[]; mangrove: RingInput[]; route: Pt[] } {
  const path = join(root, 'scripts/geo/sources/rivers-water.geojson');
  const raw = readFileSync(path);
  if (sha256(raw) !== RIVERS_WATER_SOURCE_SHA256) throw new Error('Rivers water source differs from its pinned SHA-256');
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (!isRecord(parsed) || parsed.type !== 'FeatureCollection' || !isRecord(parsed.metadata) || !Array.isArray(parsed.features)
    || parsed.metadata.pbfSha256 !== RIVERS_PBF_SHA256 || !Array.isArray(parsed.metadata.route)) {
    throw new TypeError('Rivers water source has an unexpected shape or PBF provenance');
  }
  const route = parsed.metadata.route.map((point, index) => pointOf(point, `Rivers boat route[${index}]`));
  if (route.length < 2) throw new Error('Rivers boat route has no navigable path');
  const surface: RingInput[] = [], stateWater: RingInput[] = [], mangrove: RingInput[] = [];
  const seen = new Set<string>();
  for (const [index, item] of parsed.features.entries()) {
    if (!isRecord(item) || item.type !== 'Feature' || !isRecord(item.properties)
      || typeof item.properties.id !== 'string' || typeof item.properties.kind !== 'string') throw new TypeError(`Rivers water feature ${index} is invalid`);
    const { kind, id } = item.properties;
    const key = `${kind}:${id}`;
    if (seen.has(key)) throw new Error(`Duplicate Rivers surface ${key}`);
    seen.add(key);
    const target = kind === 'land' || kind === 'water' ? surface : kind === 'state-water' ? stateWater : kind === 'mangrove' ? mangrove : null;
    if (!target) throw new Error(`Unexpected Rivers surface kind ${kind}`);
    const owner = kind === 'land' ? id : kind === 'water' ? `water-${id}` : kind;
    geometryPolygons(item.geometry, `Rivers water feature ${index}`).forEach((polygon, poly) => polygon.forEach((ring, ringIndex) => {
      target.push({ owner, poly, hole: ringIndex > 0, pts: ring });
    }));
  }
  const expected = [...PORT_HARCOURT_LGA_IDS.flatMap((id) => [`land:${id}`, `water:${id}`]), 'state-water:rivers', 'mangrove:port-harcourt'];
  if (seen.size !== expected.length || expected.some((key) => !seen.has(key))) throw new Error('Rivers water source does not partition all seven opened LGAs');
  return { surface, stateWater, mangrove, route };
}

function riversInputs(adm1: GeoFeatureCollection, adm2: GeoFeatureCollection): {
  lgaRings: RingInput[]; stateRings: RingInput[]; statePolys: Polygon[]; lgaPolys: Map<string, Polygon[]>;
} {
  const state = adm1.features.find((feature) => feature.properties.shapeName === 'Rivers');
  if (!state) throw new Error('Rivers State is missing from ADM1');
  const expected = new Set(RIVERS_LGAS.map(([source]) => source));
  const selected = adm2.features.filter((feature) => expected.has(feature.properties.shapeName));
  if (selected.length !== RIVERS_LGAS.length || new Set(selected.map((feature) => feature.properties.shapeName)).size !== RIVERS_LGAS.length) {
    throw new Error(`Rivers ADM2 selection found ${selected.length} distinct named features, expected ${RIVERS_LGAS.length}`);
  }
  const byName = new Map(selected.map((feature): [string, GeoFeature] => [feature.properties.shapeName, feature]));
  const lgaRings: RingInput[] = [], lgaPolys = new Map<string, Polygon[]>();
  for (const [source, id] of RIVERS_LGAS) {
    const feature = byName.get(source);
    if (!feature) throw new Error(`${source}: missing from the 23 Rivers local governments`);
    const polygons = polygonsOf(feature);
    lgaPolys.set(id, polygons);
    polygons.forEach((polygon, poly) => polygon.forEach((ring, index) => lgaRings.push({ owner: id, poly, hole: index > 0, pts: ring })));
  }
  const stateRings: RingInput[] = [];
  for (const feature of adm1.features) {
    const owner = feature === state ? 'rivers-state' : `state:${feature.properties.shapeName}`;
    polygonsOf(feature).forEach((polygon, poly) => polygon.forEach((ring, index) => stateRings.push({ owner, poly, hole: index > 0, pts: ring })));
  }
  return { lgaRings, stateRings, statePolys: polygonsOf(state), lgaPolys };
}

const FCT_COUNCILS: readonly [string, string, string][] = [
  ['Municipal Area Council', 'abuja-municipal', 'Abuja Municipal (AMAC)'],
  ['Bwari', 'bwari', 'Bwari'], ['Gwagwalada', 'gwagwalada', 'Gwagwalada'],
  ['Kuje', 'kuje', 'Kuje'], ['Kwali', 'kwali', 'Kwali'], ['Abaji', 'abaji', 'Abaji'],
];
const ABUJA_AREA_COUNCIL_IDS = ['abuja-municipal', 'bwari', 'gwagwalada', 'kuje', 'kwali', 'abaji'] as const;
const FCT_SURFACE_SOURCE_SHA256 = '471e9789485dd7370da22d2f239cedb8bbadc3c43085caccb48b20a4842bd8f8';
const FCT_RAIL_SOURCE_SHA256 = '2cfbf6e46526d32d5b3ef7aaf00900444393ecac1ca4f37aed27588086014e9c';

function fctKadunaRail(): Pt[] {
  const raw = readFileSync(join(root, 'scripts/geo/sources/fct-kaduna-rail.geojson'));
  if (sha256(raw) !== FCT_RAIL_SOURCE_SHA256) throw new Error('FCT rail source differs from pinned SHA-256');
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (!isRecord(parsed) || !isRecord(parsed.metadata) || parsed.metadata.pbfSha256 !== RIVERS_PBF_SHA256
    || !Array.isArray(parsed.features) || parsed.features.length !== 1) throw new TypeError('Invalid FCT railway source');
  const feature: unknown = parsed.features[0];
  if (!isRecord(feature) || !isRecord(feature.geometry) || feature.geometry.type !== 'LineString'
    || !Array.isArray(feature.geometry.coordinates)) throw new TypeError('Invalid FCT railway geometry');
  const points = feature.geometry.coordinates.map((point, i) => pointOf(point, `FCT Idu–Rigasa rail[${i}]`));
  if (points.length < 2) throw new Error('FCT railway lacks a connected path');
  return points;
}
interface FctTransport { id: string; name: string; mode: string; points: Pt[] }

function fctSurfaceInputs(): { surface: RingInput[]; roads: FctTransport[]; rail: FctTransport[] } {
  const raw = readFileSync(join(root, 'scripts/geo/sources/fct-surface.geojson'));
  if (sha256(raw) !== FCT_SURFACE_SOURCE_SHA256) throw new Error('FCT surface source differs from pinned SHA-256');
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (!isRecord(parsed) || parsed.type !== 'FeatureCollection' || !isRecord(parsed.metadata)
    || parsed.metadata.pbfSha256 !== RIVERS_PBF_SHA256 || !Array.isArray(parsed.features)) throw new TypeError('Invalid FCT source provenance');
  const surface: RingInput[] = [], roads: FctTransport[] = [], rail: FctTransport[] = [];
  const seen = new Set<string>();
  for (const [index, item] of parsed.features.entries()) {
    if (!isRecord(item) || !isRecord(item.properties) || typeof item.properties.kind !== 'string'
      || typeof item.properties.id !== 'string') throw new TypeError(`Invalid FCT feature ${index}`);
    const { kind, id } = item.properties, key = `${kind}:${id}`;
    if (seen.has(key)) throw new Error(`Duplicate FCT feature ${key}`);
    seen.add(key);
    if (kind === 'road' || kind === 'rail') {
      if (typeof item.properties.name !== 'string' || typeof item.properties.mode !== 'string'
        || !isRecord(item.geometry) || item.geometry.type !== 'LineString' || !Array.isArray(item.geometry.coordinates)) throw new TypeError(`Invalid FCT transport ${id}`);
      const points = item.geometry.coordinates.map((point, i) => pointOf(point, `${id}[${i}]`));
      if (points.length < 2) throw new Error(`Empty FCT transport ${id}`);
      (kind === 'road' ? roads : rail).push({ id, name: item.properties.name, mode: item.properties.mode, points });
    } else {
      if ((kind !== 'land' && kind !== 'water') || !ABUJA_AREA_COUNCIL_IDS.some(council => council === id)) throw new Error(`Unexpected FCT surface ${key}`);
      geometryPolygons(item.geometry, key).forEach((polygon, poly) => polygon.forEach((pts, ring) => {
        surface.push({ owner: kind === 'land' ? id : `water-${id}`, poly, hole: ring > 0, pts });
      }));
    }
  }
  if (ABUJA_AREA_COUNCIL_IDS.some(id => !seen.has(`land:${id}`))) throw new Error('FCT surface lacks a council');
  return { surface, roads, rail };
}

function fctInputs(adm1: GeoFeatureCollection, adm2: GeoFeatureCollection): {
  councilRings: RingInput[]; stateRings: RingInput[]; statePolys: Polygon[]; councilPolys: Map<string, Polygon[]>;
} {
  const state = adm1.features.find(feature => feature.properties.shapeName === 'Abuja Federal Capital Territory');
  if (!state) throw new Error('FCT is missing from pinned ADM1');
  const councilRings: RingInput[] = [], councilPolys = new Map<string, Polygon[]>();
  for (const [source, id] of FCT_COUNCILS) {
    const matches = adm2.features.filter(feature => feature.properties.shapeName === source);
    if (matches.length !== 1 || !matches[0]) throw new Error(`FCT ADM2 ${source}: expected exactly one council`);
    const polygons = polygonsOf(matches[0]);
    councilPolys.set(id, polygons);
    polygons.forEach((polygon, poly) => polygon.forEach((pts, ring) => councilRings.push({ owner: id, poly, hole: ring > 0, pts })));
  }
  const stateRings: RingInput[] = [];
  for (const feature of adm1.features) {
    const owner = feature === state ? 'fct' : `state:${feature.properties.shapeName}`;
    polygonsOf(feature).forEach((polygon, poly) => polygon.forEach((pts, ring) => stateRings.push({ owner, poly, hole: ring > 0, pts })));
  }
  return { councilRings, stateRings, statePolys: polygonsOf(state), councilPolys };
}

const KANO_LGA_NAMES = ['Ajingi', 'Albasu', 'Bagwai', 'Bebeji', 'Bichi', 'Bunkure', 'Dala', 'Dambatta', 'Dawakin Kudu', 'Dawakin Tofa', 'Doguwa', 'Fagge', 'Gabasawa', 'Garko', 'Garun Malam', 'Gaya', 'Gezawa', 'Gwale', 'Gwarzo', 'Kabo', 'Kano Municipal', 'Karaye', 'Kibiya', 'Kiru', 'Kumbotso', 'Kunchi', 'Kura', 'Madobi', 'Makoda', 'Minjibir', 'Nassarawa', 'Rano', 'Rimin Gado', 'Rogo', 'Shanono', 'Sumaila', 'Takai', 'Tarauni', 'Tofa', 'Tsanyawa', 'Tudun Wada', 'Ungogo', 'Warawa', 'Wudil'] as const;
const KANO_CITY_LGA_IDS = ['kano-municipal', 'dala', 'fagge', 'gwale', 'nassarawa', 'tarauni', 'kumbotso', 'ungogo'] as const;
const KANO_LGAS = KANO_LGA_NAMES.map(name => ({ source: name, id: name.toLowerCase().replaceAll(' ', '-'), name }));
const KANO_SURFACE_SOURCE_SHA256 = '10ca8a37bc7a9c4b95fc443ad0a8b7c6e971cf5b04aa804a3948f20fccd51fab';
interface KanoTransport { id: string; name: string; bridge: boolean; points: Pt[] }

function kanoInputs(adm1: GeoFeatureCollection, adm2: GeoFeatureCollection): {
  lgaRings: RingInput[]; stateRings: RingInput[]; statePolys: Polygon[]; lgaPolys: Map<string, Polygon[]>;
} {
  const state = adm1.features.find(feature => feature.properties.shapeName === 'Kano');
  if (!state) throw new Error('Kano is missing from pinned ADM1');
  const statePolys = polygonsOf(state);
  const selected = adm2.features.filter(feature => { const outer = polygonsOf(feature)[0]?.[0]; return outer ? inPolygons(ringMean(outer), statePolys) : false; });
  const names = new Set<string>(KANO_LGA_NAMES);
  if (selected.length !== 44 || selected.some(feature => !names.has(feature.properties.shapeName))) throw new Error('Kano ADM2 selection does not match the 44 source identities');
  const byName = new Map(selected.map((feature): [string, GeoFeature] => [feature.properties.shapeName, feature]));
  if (byName.size !== 44) throw new Error('Kano source names are not unique');
  const lgaRings: RingInput[] = [], lgaPolys = new Map<string, Polygon[]>();
  for (const { source, id } of KANO_LGAS) {
    const feature = byName.get(source);
    if (!feature) throw new Error(`Missing Kano ADM2 ${source}`);
    const polygons = polygonsOf(feature); lgaPolys.set(id, polygons);
    polygons.forEach((polygon, poly) => polygon.forEach((pts, ring) => lgaRings.push({ owner: id, poly, hole: ring > 0, pts })));
  }
  const stateRings: RingInput[] = [];
  for (const feature of adm1.features) {
    const owner = feature === state ? 'kano-state' : `state:${feature.properties.shapeName}`;
    polygonsOf(feature).forEach((polygon, poly) => polygon.forEach((pts, ring) => stateRings.push({ owner, poly, hole: ring > 0, pts })));
  }
  return { lgaRings, stateRings, statePolys, lgaPolys };
}

function kanoSurfaceInputs(): { surface: RingInput[]; stateWater: RingInput[]; roads: KanoTransport[]; rail: KanoTransport[] } {
  const raw = readFileSync(join(root, 'scripts/geo/sources/kano-surface.geojson'));
  if (sha256(raw) !== KANO_SURFACE_SOURCE_SHA256) throw new Error('Kano surface source differs from pinned SHA-256');
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (!isRecord(parsed) || parsed.type !== 'FeatureCollection' || !isRecord(parsed.metadata)
    || parsed.metadata.pbfSha256 !== RIVERS_PBF_SHA256 || !Array.isArray(parsed.features)) throw new TypeError('Invalid Kano source provenance');
  const surface: RingInput[] = [], stateWater: RingInput[] = [], roads: KanoTransport[] = [], rail: KanoTransport[] = [];
  const seen = new Set<string>();
  for (const [index, item] of parsed.features.entries()) {
    if (!isRecord(item) || !isRecord(item.properties) || typeof item.properties.kind !== 'string'
      || typeof item.properties.id !== 'string') throw new TypeError(`Invalid Kano feature ${index}`);
    const { kind, id } = item.properties, key = `${kind}:${id}`;
    if (seen.has(key)) throw new Error(`Duplicate Kano feature ${key}`);
    seen.add(key);
    if (kind === 'road' || kind === 'rail') {
      if (typeof item.properties.name !== 'string' || typeof item.properties.bridge !== 'boolean'
        || !isRecord(item.geometry) || item.geometry.type !== 'LineString' || !Array.isArray(item.geometry.coordinates)) throw new TypeError(`Invalid Kano transport ${id}`);
      const points = item.geometry.coordinates.map((point, i) => pointOf(point, `${id}[${i}]`));
      if (points.length < 2) throw new Error(`Empty Kano transport ${id}`);
      (kind === 'road' ? roads : rail).push({ id, name: item.properties.name, bridge: item.properties.bridge, points });
    } else {
      if (kind !== 'land' && kind !== 'water' && kind !== 'state-water') throw new Error(`Unknown Kano surface ${key}`);
      if (kind !== 'state-water' && !KANO_CITY_LGA_IDS.some(lga => lga === id)) throw new Error(`Unknown Kano city LGA ${id}`);
      const owner = kind === 'land' ? id : kind === 'water' ? `water-${id}` : 'state-water';
      geometryPolygons(item.geometry, key).forEach((polygon, poly) => polygon.forEach((pts, ring) => {
        (kind === 'state-water' ? stateWater : surface).push({ owner, poly, hole: ring > 0, pts });
      }));
    }
  }
  if (KANO_CITY_LGA_IDS.some(id => !seen.has(`land:${id}`)) || !seen.has('state-water:kano')) throw new Error('Kano surface lacks an expected land or water layer');
  return { surface, stateWater, roads, rail };
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

function topologyFromText(text: string, label: string, exportName: string): RawTopo<FeatureData> {
  const marker = `export const ${exportName}: RawTopo = `;
  const start = text.indexOf(marker);
  const end = start < 0 ? -1 : text.indexOf(';', start + marker.length);
  if (start < 0 || end < 0) throw new TypeError(`${label}: cannot find the ${exportName} topology`);
  const parsed: unknown = JSON.parse(text.slice(start + marker.length, end));
  return rawTopoOf(parsed, label);
}

function decodedHash(raw: RawTopo<FeatureData>): string {
  const decoded = decodeTopology(raw);
  return sha256(JSON.stringify({ grid: decoded.grid, arcs: decoded.arcs.map((arc) => [...arc]), features: decoded.features.map((feature) => ({ id: feature.id, rings: feature.rings.map((polygon) => polygon.map((ring) => [...ring])), bounds: feature.bounds })) }));
}

function output(path: string, text: string, check: boolean, topologyNames: readonly string[] = []): void {
  const generatedHash = sha256(text);
  if (check) {
    const actual = readFileSync(path, 'utf8');
    const actualHash = sha256(actual);
    if (actual !== text) throw new Error(`${path}: generated text ${generatedHash} differs from ${actualHash}`);
    if (topologyNames.length) {
      const generatedGeometry = sha256(topologyNames.map((name) => decodedHash(topologyFromText(text, `${path} generated ${name}`, name))).join(':'));
      const actualGeometry = sha256(topologyNames.map((name) => decodedHash(topologyFromText(actual, `${path} actual ${name}`, name))).join(':'));
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

interface Options { check: boolean; target: 'lagos' | 'oyo' | 'ogun' | 'rivers' | 'fct' | 'kano' | 'nigeria' }

function optionsOf(args: readonly string[]): Options {
  const allowed = new Set(['--check', '--lagos-only', '--oyo', '--ogun', '--rivers', '--fct', '--kano', '--nigeria']);
  const unknown = args.filter((arg) => !allowed.has(arg));
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}`);
  const targets = [args.includes('--lagos-only'), args.includes('--oyo'), args.includes('--ogun'), args.includes('--rivers'), args.includes('--fct'), args.includes('--kano'), args.includes('--nigeria')].filter(Boolean).length;
  if (targets > 1) throw new Error('Only one of --lagos-only, --oyo, --ogun, --rivers, --fct, --kano and --nigeria can be selected');
  return { check: args.includes('--check'), target: args.includes('--oyo') ? 'oyo' : args.includes('--ogun') ? 'ogun' : args.includes('--rivers') ? 'rivers' : args.includes('--fct') ? 'fct' : args.includes('--kano') ? 'kano' : args.includes('--nigeria') ? 'nigeria' : 'lagos' };
}

async function main(options: Options): Promise<void> {
  const [adm1, adm2] = [await load('adm1'), await load('adm2')];

  if (options.target === 'oyo') {
    const T = TOLERANCE.oyo, oyo = oyoInputs(adm1, adm2), lagos = lagosInputs(adm1, adm2);
    const lgaBuilt = build(oyo.lgaRings, T.grid, () => T.lga);
    // Build every state together before selecting Oyo. Its exterior arcs therefore remain byte-for-byte reusable by
    // neighbouring state packs generated from the same pinned source and tolerance.
    const allStates = build(oyo.stateRings, T.grid, () => T.state);
    const stateBuilt = subsetBuilt(allStates, new Set(['oyo-state']));
    const lgaFeatures = OYO_LGAS.map(([, id, name]) => featureText({ id, name, polys: polysOf(lgaBuilt, id) }));
    const stateFeature = featureText({ id: 'oyo-state', name: 'Oyo State', polys: polysOf(stateBuilt, 'oyo-state') });
    const oyoStateKm2 = polygonsKm2(oyo.statePolys);
    const ibadanPlayAreaKm2 = IBADAN_LGA_IDS.reduce((sum, id) => sum + polygonsKm2(oyo.lgaPolys.get(id) ?? []), 0);
    const lagos20LgaKm2 = polygonsKm2(lagos.lgaPolys);
    const oyoText = `/**
 * GENERATED DATA — do not edit by hand (npm run geo:boundaries -- --oyo).
 * All 33 Oyo State local governments are stored in OYO_LGAS. The Ibadan city map opens the 11 ids in
 * IBADAN_LGA_IDS; their polygons are also the exact playable-area tiles. OYO_STATE is the full state outline.
 * Source: geoBoundaries gbOpen Nigeria, release ${RELEASE} (https://www.geoboundaries.org), ADM2 (boundaryID NGA-ADM2-59680162,
 *   local governments) and ADM1 (NGA-ADM1-27671186, states). Original source GRID3, year 2022.
 *   Licence CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: selected, simplified, quantised, converted.
 * Processing: shared-arc topology, each arc simplified once with Visvalingam–Whyatt at effective-area threshold ${T.lga}
 *   square map units (1 unit = 100 m), quantised to ${T.grid} degrees (about 22 m). The state outline is selected only
 *   after all 37 ADM1 states are built together, preserving its shared border arcs for future neighbouring state packs.
 * Water is deliberately absent from this file: no suitable pinned inland-water polygon source is used by this build.
 */
/* eslint-disable */
import type { RawTopo } from '../topo.ts';
export const IBADAN_LGA_IDS = ${JSON.stringify(IBADAN_LGA_IDS)} as const;
export const OYO_STATE_KM2 = ${oyoStateKm2.toFixed(1)};
export const IBADAN_PLAY_AREA_KM2 = ${ibadanPlayAreaKm2.toFixed(1)};
export const LAGOS_20_LGA_KM2 = ${lagos20LgaKm2.toFixed(1)};
export const OYO_LGAS: RawTopo = {"grid":${T.grid},"arcs":${JSON.stringify(arcText(lgaBuilt))},"features":[
${lgaFeatures.join(',\n')}
]};
export const OYO_STATE: RawTopo = {"grid":${T.grid},"arcs":${JSON.stringify(arcText(stateBuilt))},"features":[
${stateFeature}
]};
`;
    const path = join(root, 'src/map3d/geo/data/oyo.ts');
    output(path, oyoText, options.check, ['OYO_LGAS', 'OYO_STATE']);
    console.log(`oyo.ts ${bytes(oyoText)} bytes, ${lgaBuilt.arcs.length} LGA arcs, ${stateBuilt.arcs.length} state arcs`);
    console.log(`areas from source projection: Oyo State ${oyoStateKm2.toFixed(1)} km²; Ibadan 11-LGA play area ${ibadanPlayAreaKm2.toFixed(1)} km²; Lagos 20-LGA land ${lagos20LgaKm2.toFixed(1)} km² (administrative sets, not like-for-like metro areas)`);
    return;
  }

  if (options.target === 'ogun') {
    const lagosPath = join(root, 'src/map3d/geo/data/lagos.ts');
    const acceptedLagosHash = sha256(readFileSync(lagosPath));
    if (acceptedLagosHash !== ACCEPTED_LAGOS_SHA256) throw new Error(`Ogun seam requires accepted Lagos ${ACCEPTED_LAGOS_SHA256}; found ${acceptedLagosHash}`);
    const T = TOLERANCE.ogun, ogun = ogunInputs(adm1, adm2), lagos = lagosInputs(adm1, adm2);
    const lgaLocked = lockAcceptedLagosLgaSeam(build(ogun.lgaRings, T.grid, () => T.lga), lagos.lgaPolys, ogun.lgaPolys.get('ado-odo-ota') ?? []);
    const lgaBuilt = lgaLocked.built;
    const allStates = build(ogun.stateRings, T.grid, () => T.state);
    const locked = lockAcceptedLagosSeam(allStates, ogun.lagosPolys, ogun.statePolys), stateBuilt = locked.built;
    const lgaFeatures = OGUN_LGAS.map(([, id, name]) => featureText({ id, name, polys: polysOf(lgaBuilt, id) }));
    const stateFeature = featureText({ id: 'ogun-state', name: 'Ogun State', polys: polysOf(stateBuilt, 'ogun-state') });
    const stateArea = polygonsKm2(ogun.statePolys);
    const cityAreas = Object.fromEntries(Object.entries(OGUN_CITY_LGA_IDS).map(([city, ids]) => [city, ids.reduce((sum, id) => sum + polygonsKm2(ogun.lgaPolys.get(id) ?? []), 0)]));
    const ogunText = `/**
 * GENERATED DATA — do not edit by hand (npm run geo:boundaries -- --ogun).
 * All 20 Ogun State local governments are stored in OGUN_LGAS. OGUN_CITY_LGA_IDS selects the 11 local governments
 * opened by Abeokuta, Ota, Ijebu-Ode and Sagamu; OGUN_COMING_LGA_IDS names the other nine for the state overview.
 * Source: geoBoundaries gbOpen Nigeria, release ${RELEASE} (https://www.geoboundaries.org), ADM2 (boundaryID NGA-ADM2-59680162,
 *   local governments) and ADM1 (NGA-ADM1-27671186, states). Original source GRID3, year 2022.
 *   Licence CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: selected, simplified, quantised, converted.
 * Processing: LGA and non-Lagos state arcs use shared-arc topology, Visvalingam–Whyatt effective-area threshold ${T.lga}
 *   square map units (1 unit = 100 m), quantised to ${T.grid} degrees. The ${locked.seamPoints}-vertex Lagos-facing state
 *   path is copied exactly from accepted Lagos topology sha256 ${ACCEPTED_LAGOS_SHA256}; exact shared raw ADM1 edges select
 *   its endpoints and orientation. Ado Odo/Ota's ${lgaLocked.seamPoints}-vertex shared land edge is locked the same way from
 *   exact raw ADM2 edges shared with Lagos LGAs. Accepted paths are not simplified again. No water polygon is inferred from gaps.
 */
/* eslint-disable */
import type { RawTopo } from '../topo.ts';
export const OGUN_CITY_LGA_IDS = ${JSON.stringify(OGUN_CITY_LGA_IDS)} as const;
export const OGUN_COMING_LGA_IDS = ${JSON.stringify(OGUN_COMING_LGA_IDS)} as const;
export const OGUN_STATE_KM2 = ${stateArea.toFixed(1)};
export const OGUN_CITY_AREA_KM2 = ${JSON.stringify(Object.fromEntries(Object.entries(cityAreas).map(([id, area]) => [id, Number(area.toFixed(1))])))} as const;
export const OGUN_LAGOS_SEAM_VERTEX_COUNT = ${locked.seamPoints};
export const OTA_LAGOS_SEAM_VERTEX_COUNT = ${lgaLocked.seamPoints};
export const OGUN_LGAS: RawTopo = {"grid":${T.grid},"arcs":${JSON.stringify(arcText(lgaBuilt))},"features":[
${lgaFeatures.join(',\n')}
]};
export const OGUN_STATE: RawTopo = {"grid":${T.grid},"arcs":${JSON.stringify(arcText(stateBuilt))},"features":[
${stateFeature}
]};
`;
    const path = join(root, 'src/map3d/geo/data/ogun.ts');
    output(path, ogunText, options.check, ['OGUN_LGAS', 'OGUN_STATE']);
    console.log(`ogun.ts ${bytes(ogunText)} bytes, ${lgaBuilt.arcs.length} LGA arcs, ${stateBuilt.arcs.length} state arcs, ${locked.seamPoints} locked state-seam vertices, ${lgaLocked.seamPoints} locked Ota land-seam vertices`);
    console.log(`areas from source projection: Ogun State ${stateArea.toFixed(1)} km²; ${Object.entries(cityAreas).map(([city, area]) => `${city} ${area.toFixed(1)} km²`).join('; ')}`);
    return;
  }

  if (options.target === 'kano') {
    const T = TOLERANCE.kano, kano = kanoInputs(adm1, adm2), wet = kanoSurfaceInputs();
    const lgas = build(kano.lgaRings, T.grid, () => T.lga);
    const state = subsetBuilt(build(kano.stateRings, T.grid, () => T.state), new Set(['kano-state']));
    const surface = build(wet.surface, T.surfaceGrid, () => T.surface);
    const land = subsetBuilt(surface, new Set(KANO_CITY_LGA_IDS));
    const waterNames = KANO_CITY_LGA_IDS.map(id => ({ id: `water-${id}`, name: `Mapped water in ${id}` })).filter(feature => surface.refs.some(ref => ref.owner === feature.id));
    const water = subsetBuilt(surface, new Set(waterNames.map(feature => feature.id)));
    const stateWater = build(wet.stateWater, T.overviewGrid, () => T.overview);
    const layer = (built: Built, features: readonly { id: string; name: string }[]): string =>
      `{"grid":${built.grid},"arcs":${JSON.stringify(arcText(built))},"features":${JSON.stringify(features.map(feature => ({ ...feature, polys: polysOf(built, feature.id) })))}}`;
    const names = KANO_LGAS.map(({ id, name }) => ({ id, name }));
    const cityNames = KANO_CITY_LGA_IDS.map(id => { const feature = names.find(feature => feature.id === id); if (!feature) throw new Error(`Unknown Kano ${id}`); return feature; });
    const text = `/**
 * GENERATED DATA (npm run geo:boundaries -- --kano). All 44 Kano State local governments.
 * Eight metropolis local governments form an independent original ADM2 playable footprint.
 * Boundaries: geoBoundaries gbOpen Nigeria release ${RELEASE}, GRID3 2022, CC BY 4.0.
 * ADM1 NGA-ADM1-27671186; ADM2 NGA-ADM2-59680162. Source-era names retained.
 * Water and local transport: © OpenStreetMap contributors, ODbL 1.0; Geofabrik Nigeria 2026-10-03.
 * PBF SHA-256 ${RIVERS_PBF_SHA256}.
 * Derived source SHA-256 ${KANO_SURFACE_SOURCE_SHA256}; scripts/geo/refresh-kano-surface.py.
 * Administrative arcs: grid ${T.grid} degrees, Visvalingam threshold ${T.lga} square frame units.
 * State selected after all 37 states share arcs. City land and water share one topology,
 * grid ${T.surfaceGrid} degrees, threshold ${T.surface}. Overview water grid ${T.overviewGrid}.
 * Transport source vertices simplified at 0.00006 degrees; local railway segments only.
 * No inferred national rail/road preview. Ancient walls require a separate identified source;
 * modern unnamed compound walls and road embankments are not relabelled.
 */
/* eslint-disable */
import type { RawTopo } from '../topo.ts';
export const KANO_CITY_LGA_IDS = ${JSON.stringify(KANO_CITY_LGA_IDS)} as const;
export const KANO_COMING_LGA_IDS = ${JSON.stringify(names.map(feature => feature.id).filter(id => !KANO_CITY_LGA_IDS.some(city => city === id)))} as const;
export const KANO_STATE_KM2 = ${polygonsKm2(kano.statePolys).toFixed(1)};
export const KANO_PLAY_AREA_KM2 = ${KANO_CITY_LGA_IDS.reduce((sum, id) => sum + polygonsKm2(kano.lgaPolys.get(id) ?? []), 0).toFixed(1)};
export const KANO_LGAS: RawTopo = ${layer(lgas, names)};
export const KANO_STATE: RawTopo = ${layer(state, [{ id: 'kano-state', name: 'Kano State' }])};
export const KANO_LAND: RawTopo = ${layer(land, cityNames)};
export const KANO_WATER: RawTopo = ${layer(water, waterNames)};
export const KANO_STATE_WATER: RawTopo = ${layer(stateWater, [{ id: 'state-water', name: 'Kano mapped water' }])};
export const KANO_ROADS = ${JSON.stringify(wet.roads)} as const;
export const KANO_RAIL = ${JSON.stringify(wet.rail)} as const;
export const KANO_SURFACE_SOURCE_SHA256 = '${KANO_SURFACE_SOURCE_SHA256}';
`;
    output(join(root, 'src/map3d/geo/data/kano.ts'), text, options.check, ['KANO_LGAS', 'KANO_STATE', 'KANO_LAND', 'KANO_WATER', 'KANO_STATE_WATER']);
    console.log(`kano.ts ${bytes(text)} bytes, ${lgas.arcs.length} LGA arcs, ${surface.arcs.length} surface arcs; ${wet.roads.length} roads and ${wet.rail.length} local rail polylines`);
    return;
  }

  if (options.target === 'fct') {
    const T = TOLERANCE.fct, fct = fctInputs(adm1, adm2), wet = fctSurfaceInputs(), kadunaRail = fctKadunaRail();
    const councils = build(fct.councilRings, T.grid, () => T.council);
    const allStates = build(fct.stateRings, T.grid, () => T.state);
    const state = subsetBuilt(allStates, new Set(['fct']));
    const neighbours = ['Niger', 'Kaduna', 'Nasarawa', 'Kogi'].map(name => ({ id: `state:${name}`, name }));
    const neighbourBuilt = subsetBuilt(allStates, new Set(neighbours.map(feature => feature.id)));
    const surface = build(wet.surface, T.surfaceGrid, () => T.surface);
    const land = subsetBuilt(surface, new Set(ABUJA_AREA_COUNCIL_IDS));
    const water = subsetBuilt(surface, new Set(ABUJA_AREA_COUNCIL_IDS.map(id => `water-${id}`)));
    const layer = (built: Built, features: readonly { id: string; name: string }[]): string =>
      `{"grid":${built.grid},"arcs":${JSON.stringify(arcText(built))},"features":${JSON.stringify(features.map(feature => ({ ...feature, polys: polysOf(built, feature.id) })))}}`;
    const names = FCT_COUNCILS.map(([, id, name]) => ({ id, name }));
    const waterNames = ABUJA_AREA_COUNCIL_IDS.map(id => ({ id: `water-${id}`, name: `Mapped water in ${id}` })).filter(feature => surface.refs.some(ref => ref.owner === feature.id));
    const text = `/**
 * GENERATED DATA (npm run geo:boundaries -- --fct). All six FCT area councils.
 * Boundaries: geoBoundaries gbOpen Nigeria release ${RELEASE}, GRID3 2022, CC BY 4.0.
 * ADM1 NGA-ADM1-27671186; ADM2 NGA-ADM2-59680162. Independent ADM2 playable footprint.
 * Water and transport: © OpenStreetMap contributors, ODbL 1.0; Geofabrik Nigeria 2026-10-03.
 * PBF SHA-256 ${RIVERS_PBF_SHA256}.
 * Derived source SHA-256 ${FCT_SURFACE_SOURCE_SHA256}; reproducible with scripts/geo/refresh-fct-surface.py.
 * Administrative arcs: grid ${T.grid} degrees, Visvalingam threshold ${T.council} square frame units.
 * State outline selected after all 37 states share arcs. Land and water built together with
 * grid ${T.surfaceGrid} degrees and threshold ${T.surface}; reservoir islands remain land.
 * Transport retains sourced vertices, simplified at 0.00008 degrees and clipped to FCT;
 * local northbound railway context stops at 9.6 N; the separate Idu–Rigasa route retains
 * every original track node with no invented connectors. Rail source SHA-256 ${FCT_RAIL_SOURCE_SHA256}.
 */
/* eslint-disable */
import type { RawTopo } from '../topo.ts';
export const ABUJA_AREA_COUNCIL_IDS = ${JSON.stringify(ABUJA_AREA_COUNCIL_IDS)} as const;
export const FCT_STATE_KM2 = ${polygonsKm2(fct.statePolys).toFixed(1)};
export const ABUJA_PLAY_AREA_KM2 = ${[...fct.councilPolys.values()].reduce((sum, polygons) => sum + polygonsKm2(polygons), 0).toFixed(1)};
export const FCT_COUNCILS: RawTopo = ${layer(councils, names)};
export const FCT_STATE: RawTopo = ${layer(state, [{ id: 'fct', name: 'Federal Capital Territory' }])};
export const FCT_NEIGHBOURS: RawTopo = ${layer(neighbourBuilt, neighbours)};
export const FCT_LAND: RawTopo = ${layer(land, names)};
export const FCT_WATER: RawTopo = ${layer(water, waterNames)};
export const FCT_ROADS = ${JSON.stringify(wet.roads)} as const;
export const FCT_RAIL = ${JSON.stringify(wet.rail)} as const;
export const FCT_KADUNA_RAIL = ${JSON.stringify(kadunaRail)} as const;
export const FCT_RAIL_SOURCE_SHA256 = '${FCT_RAIL_SOURCE_SHA256}';
export const FCT_SURFACE_SOURCE_SHA256 = '${FCT_SURFACE_SOURCE_SHA256}';
`;
    output(join(root, 'src/map3d/geo/data/fct.ts'), text, options.check, ['FCT_COUNCILS', 'FCT_STATE', 'FCT_NEIGHBOURS', 'FCT_LAND', 'FCT_WATER']);
    console.log(`fct.ts ${bytes(text)} bytes, ${councils.arcs.length} council arcs, ${surface.arcs.length} shared surface arcs; ${wet.roads.length} road and ${wet.rail.length} rail polylines`);
    return;
  }

  if (options.target === 'rivers') {
    const T = TOLERANCE.rivers, rivers = riversInputs(adm1, adm2), wet = riversWaterInputs();
    const lgaBuilt = build(rivers.lgaRings, T.grid, () => T.lga);
    const allStates = build(rivers.stateRings, T.grid, () => T.state);
    const stateBuilt = subsetBuilt(allStates, new Set(['rivers-state']));
    const surfaceBuilt = build(wet.surface, T.waterGrid, () => T.water);
    const landBuilt = subsetBuilt(surfaceBuilt, new Set(PORT_HARCOURT_LGA_IDS));
    const cityWaterIds = PORT_HARCOURT_LGA_IDS.map((id) => `water-${id}`);
    const cityWaterBuilt = subsetBuilt(surfaceBuilt, new Set(cityWaterIds));
    const stateWaterBuilt = build(wet.stateWater, T.overviewWaterGrid, () => T.overviewWater);
    const mangroveBuilt = build(wet.mangrove, T.mangroveGrid, () => T.mangrove);
    const lgaFeatures = RIVERS_LGAS.map(([, id, name]) => featureText({ id, name, polys: polysOf(lgaBuilt, id) }));
    const stateFeature = featureText({ id: 'rivers-state', name: 'Rivers State', polys: polysOf(stateBuilt, 'rivers-state') });
    const landFeatures = PORT_HARCOURT_LGA_IDS.map((id) => featureText({ id, name: id, polys: polysOf(landBuilt, id) }));
    const cityWaterFeatures = cityWaterIds.map((id) => featureText({ id, name: id, polys: polysOf(cityWaterBuilt, id) }));
    const stateWaterFeature = featureText({ id: 'rivers-water', name: 'Rivers mapped water', polys: polysOf(stateWaterBuilt, 'state-water') });
    const mangroveFeature = featureText({ id: 'port-harcourt-mangrove', name: 'Mapped mangrove wetland', polys: polysOf(mangroveBuilt, 'mangrove') });
    const stateArea = polygonsKm2(rivers.statePolys);
    const cityArea = PORT_HARCOURT_LGA_IDS.reduce((sum, id) => sum + polygonsKm2(rivers.lgaPolys.get(id) ?? []), 0);
    const riversText = `/**
 * GENERATED DATA — do not edit by hand (npm run geo:boundaries -- --rivers).
 * All 23 named Rivers State local governments are retained. Seven form Port Harcourt's open play area;
 * the other 16 remain state context. Selection uses exact ADM2 identities, including Oyigbo and coastal pieces.
 * Source: geoBoundaries gbOpen Nigeria release ${RELEASE}, ADM2 NGA-ADM2-59680162 and ADM1 NGA-ADM1-27671186,
 *   originally GRID3, 2022. CC BY 4.0. Modified: selected, simplified, quantised and converted to ES modules.
 * Processing: shared arcs simplified once using Visvalingam–Whyatt threshold ${T.lga} square map units
 *   (one unit = 100 m), then quantised to ${T.grid} degrees. State arcs are built with all 37 ADM1 states.
 * Water: OpenStreetMap contributors, ODbL 1.0, pinned Geofabrik Nigeria 2026-10-03 extract SHA-256 ${RIVERS_PBF_SHA256}.
 *   Its source-derived clipped land, water and mangrove polygons are pinned at ${RIVERS_WATER_SOURCE_SHA256}.
 *   Land and water are built as one shared-arc topology, threshold ${T.water} square map units and grid ${T.waterGrid} degrees.
 *   State-overview water uses threshold ${T.overviewWater} and grid ${T.overviewWaterGrid}; mangrove context uses
 *   threshold ${T.mangrove} and grid ${T.mangroveGrid}. These display layers do not define the navigable city mask.
 *   The boat polyline is a derived path within the mapped water component, not an official ferry chart or schedule.
 */
/* eslint-disable */
import type { RawTopo } from '../topo.ts';
export const PORT_HARCOURT_LGA_IDS = ${JSON.stringify(PORT_HARCOURT_LGA_IDS)} as const;
export const RIVERS_COMING_LGA_IDS = ${JSON.stringify(RIVERS_COMING_LGA_IDS)} as const;
export const RIVERS_STATE_KM2 = ${stateArea.toFixed(1)};
export const PORT_HARCOURT_PLAY_AREA_KM2 = ${cityArea.toFixed(1)};
export const RIVERS_LGAS: RawTopo = {"grid":${T.grid},"arcs":${JSON.stringify(arcText(lgaBuilt))},"features":[
${lgaFeatures.join(',\n')}
]};
export const RIVERS_STATE: RawTopo = {"grid":${T.grid},"arcs":${JSON.stringify(arcText(stateBuilt))},"features":[
${stateFeature}
]};
export const RIVERS_LAND: RawTopo = {"grid":${T.waterGrid},"arcs":${JSON.stringify(arcText(landBuilt))},"features":[
${landFeatures.join(',\n')}
]};
export const RIVERS_CITY_WATER: RawTopo = {"grid":${T.waterGrid},"arcs":${JSON.stringify(arcText(cityWaterBuilt))},"features":[
${cityWaterFeatures.join(',\n')}
]};
export const RIVERS_STATE_WATER: RawTopo = {"grid":${T.overviewWaterGrid},"arcs":${JSON.stringify(arcText(stateWaterBuilt))},"features":[
${stateWaterFeature}
]};
export const RIVERS_MANGROVE: RawTopo = {"grid":${T.mangroveGrid},"arcs":${JSON.stringify(arcText(mangroveBuilt))},"features":[
${mangroveFeature}
]};
export const RIVERS_BOAT_ROUTE = ${JSON.stringify(wet.route)} as const;
export const RIVERS_WATER_SOURCE_SHA256 = '${RIVERS_WATER_SOURCE_SHA256}';
`;
    const path = join(root, 'src/map3d/geo/data/rivers.ts');
    output(path, riversText, options.check, ['RIVERS_LGAS', 'RIVERS_STATE', 'RIVERS_LAND', 'RIVERS_CITY_WATER', 'RIVERS_STATE_WATER', 'RIVERS_MANGROVE']);
    console.log(`rivers.ts ${bytes(riversText)} bytes, ${lgaBuilt.arcs.length} LGA arcs, ${stateBuilt.arcs.length} state arcs, ${surfaceBuilt.arcs.length} shared surface arcs`);
    console.log(`areas from source projection: Rivers State ${stateArea.toFixed(1)} km²; seven-LGA play area ${cityArea.toFixed(1)} km²`);
    return;
  }

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
  output(join(root, 'src/map3d/geo/data/lagos.ts'), lagosText, options.check, ['LAGOS']);
  console.log(`lagos.ts ${bytes(lagosText)} bytes, ${lagosBuilt.arcs.length} arcs, ${lagosBuilt.arcs.reduce((n, a) => n + a.points.length, 0)} points`);
  if (options.target !== 'nigeria') return;

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
