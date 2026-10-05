/**
 * OWNER: world
 * THE SURROUNDINGS OF A STATE MAP: the land around Lagos State, drawn flat and quiet so that the state sits in the real
 * map of Nigeria — Ogun State to the north and east, Oyo and Ondo beyond it, the Republic of Benin and Togo to the west —
 * with the roads that leave the state continuing a little into it, and the names of what is around (the Atlantic to the
 * south). Pure: no Three.js, no DOM. Lon/lat in, map units out, through the same frame (./geo/frame.ts) the state itself is
 * built in, so the pieces meet exactly.
 *
 * LOAD RULE  this reads ./geo/data/nigeria.ts (it lives beside, not in, geo/: the atlas's own modules never import data statically) (the atlas's data chunk). Import it only from code that is itself loaded lazily
 * (the Lagos city pack), never from the first-paint bundle.
 *
 * Context is not interactive, except that a state that is only planned (Ogun) answers a tap with "Opening soon" (the host
 * does that from `status`). It is clipped to `rect`, a window around the state big enough for any screen shape.
 */
import { AROUND, NIGERIA } from './geo/data/nigeria.ts';
import { toLocal } from './geo/frame.ts';
import type { MapOrigin } from './geo/frame.ts';
import { decodeTopology } from './geo/topo.ts';
import type { Rect, Point2 } from './types.ts';

/** A piece of surrounding land, or the base under the state itself. `status` 'planned' means the registry lists a city in it. */
export interface ContextLand { id: string; name: string; kind: 'state' | 'country' | 'base'; points: Point2[]; holes: Point2[][]; status: 'planned' | null }
export interface ContextRoad { id: string; name: string; points: Point2[] }
/** A quiet name: a state, a country or the sea. */
export interface ContextLabel { id: string; text: string; kind: 'state' | 'country' | 'sea'; x: number; z: number }
export interface MapContext { rect: Rect; land: ContextLand[]; roads: ContextRoad[]; labels: ContextLabel[] }

/** Countries around the window that are drawn (the ones whose land can come into view from Lagos). */
/** Map units (100 m): the context is far land, so its outline may move by 400 m. */
const TOLERANCE = 4;
const COUNTRIES = ['bj', 'tg', 'gh'];

/** Sutherland–Hodgman against an axis-aligned window. Fine for the simple, mostly convex-at-the-window outlines used here. */
function clip(points: readonly Point2[], r: Rect): Point2[] {
  const edges: [(p: Point2) => boolean, (a: Point2, b: Point2) => Point2][] = [
    [(p) => p[0] >= r.minX, (a, b) => { const t = (r.minX - a[0]) / (b[0] - a[0]); return [r.minX, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= r.maxX, (a, b) => { const t = (r.maxX - a[0]) / (b[0] - a[0]); return [r.maxX, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= r.minZ, (a, b) => { const t = (r.minZ - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, r.minZ]; }],
    [(p) => p[1] <= r.maxZ, (a, b) => { const t = (r.maxZ - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, r.maxZ]; }],
  ];
  let out = points.slice();
  for (const [inside, cross] of edges) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!, b = input[(i + 1) % input.length]!, ai = inside(a), bi = inside(b);
      if (ai) out.push(a);
      if (ai !== bi) out.push(cross(a, b));
    }
    if (!out.length) return [];
  }
  return out;
}

/** Roads that leave the state, as [lon, lat]: they start where the state's own roads end. */
const ROADS: { id: string; name: string; line: [number, number][] }[] = [
  { id: 'ibadan', name: 'Lagos–Ibadan Expressway', line: [[3.365, 6.642], [3.42, 6.74], [3.55, 6.88], [3.7, 7.04], [3.8, 7.2], [3.9, 7.38]] },
  { id: 'abeokuta', name: 'Lagos–Abeokuta Expressway', line: [[3.32, 6.625], [3.25, 6.69], [3.27, 6.9], [3.33, 7.05], [3.35, 7.16]] },
  { id: 'seme', name: 'Badagry–Seme Road', line: [[2.8813, 6.4155], [2.8, 6.425], [2.72, 6.43], [2.62, 6.46]] },
];
const NAMES: { id: string; text: string; kind: ContextLabel['kind']; at: [number, number] }[] = [
  { id: 'ogun', text: 'OGUN STATE', kind: 'state', at: [3.4, 6.98] },
  { id: 'ogun-east', text: 'Ogun State', kind: 'state', at: [4.1, 6.62] },
  { id: 'oyo', text: 'OYO STATE', kind: 'state', at: [3.9, 7.7] },
  { id: 'ondo', text: 'ONDO STATE', kind: 'state', at: [5.0, 6.75] },
  { id: 'benin', text: 'REPUBLIC OF BENIN', kind: 'country', at: [2.35, 6.75] },
  { id: 'sea', text: 'ATLANTIC OCEAN', kind: 'sea', at: [3.4, 6.05] },
  { id: 'gulf', text: 'Gulf of Guinea', kind: 'sea', at: [4.6, 5.8] },
];

/** Douglas–Peucker: the far land is drawn with far fewer points than the data has (a tolerance of `tol` map units). */
function simplify(points: readonly Point2[], tol: number): Point2[] {
  if (points.length < 12) return points.slice();
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!; let far = -1, worst = tol;
    const [ax, az] = points[a]!, [bx, bz] = points[b]!, len = Math.hypot(bx - ax, bz - az) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (az - points[i]![1]) - (ax - points[i]![0]) * (bz - az)) / len; if (d > worst) { worst = d; far = i; } }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const cache = new Map<string, MapContext>();

/**
 * The context of a state map. `planned` lists the state ids the registry has a reserved city in; `around` is the window
 * around the state's own rect, in map units (the default is wide enough that a phone held upright is still full of land).
 */
export function mapContext(origin: MapOrigin, state: Rect, planned: readonly string[] = [], around = 2600): MapContext {
  const key = `${origin.x},${origin.z}|${planned.join()}|${around}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rect: Rect = { minX: state.minX - around, maxX: state.maxX + around, minZ: state.minZ - around, maxZ: state.maxZ + around };
  const local = (ring: ArrayLike<number>): Point2[] => Array.from({ length: ring.length / 2 }, (_, i) => toLocal(origin, ring[i * 2]!, ring[i * 2 + 1]!));
  const land: ContextLand[] = [];
  const draw = (id: string, name: string, kind: ContextLand['kind'], parts: readonly (readonly Float64Array[])[], status: ContextLand['status']): void => {
    parts.forEach((part, index) => {
      const outer = simplify(clip(local(part[0]!), rect), TOLERANCE);
      if (outer.length < 3) return;
      const holes = part.slice(1).map((ring) => simplify(clip(local(ring), rect), TOLERANCE)).filter((ring) => ring.length >= 3);
      land.push({ id: index ? `${id}:${index}` : id, name, kind, points: outer, holes, status });
    });
  };
  const nigeria = decodeTopology(NIGERIA), around_ = decodeTopology(AROUND);
  // Under the state itself: the same region from the atlas data, so that a hairline between two sources never shows water.
  const lagos = nigeria.byId.get('lagos');
  if (lagos) draw('lagos-base', 'Lagos', 'base', lagos.rings, null);
  // Every other state that comes into the window: the whole map of Nigeria is there, not only the ones named.
  for (const f of nigeria.features) if (f.id !== 'lagos') draw(f.id, f.name, 'state', f.rings, planned.includes(f.id) ? 'planned' : null);
  for (const id of COUNTRIES) { const f = around_.byId.get(id); if (f) draw(id, f.name, 'country', f.rings, null); }
  const roads = ROADS.map((road) => ({ id: road.id, name: road.name, points: clipLine(road.line.map(([lon, lat]) => toLocal(origin, lon, lat)), rect) }));
  const labels = NAMES.map((name) => { const [x, z] = toLocal(origin, name.at[0], name.at[1]); return { id: name.id, text: name.text, kind: name.kind, x, z }; });
  const made: MapContext = { rect, land, roads, labels };
  cache.set(key, made);
  return made;
}
/** A line is kept while it is inside the window (the roads here are short and well inside it). */
const clipLine = (points: Point2[], r: Rect): Point2[] => points.filter(([x, z]) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
