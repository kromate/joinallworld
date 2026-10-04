/**
 * Campus shuttle rules, road routing, pose interpolation and procedural model.
 *
 * This is a synthetic internal beta service. Stop order, fare, speed and timing
 * are game rules, not a representation of a real UNILAG route or timetable.
 */
import type { Group } from 'three';
import { arrive as arriveUntyped, debit, spotsOf } from '../../game/api.js';
import { busy as busyUntyped, fail as failUntyped, ok as okUntyped } from '../../game/util.js';
import { createBatch, kitResources, releaseObjects, sceneMaterials } from '../../scene/build.js';
import { ANCHORS, ROADS } from './layout.ts';
import type { CampusAnchor } from './layout.ts';
import { createCampusWalk } from './walk.ts';
import type { WalkPoint } from './walk.ts';
import type { SceneBatch, SceneKit } from '../shared/geometry.ts';
import type { CampusShuttleAction, ShuttleStopId, UnilagShuttleView } from '../../types/campus.ts';
import type { ActionFailure, ActionOutcome, ActionSuccess, LifeContext, LifeState } from '../../types/life.ts';
import type { ActiveKindHandler, SystemDefinition } from '../../types/registry.ts';

// util.js is untyped JS: its results widen `ok: true` to boolean, so name the shapes it really builds.
const ok = okUntyped as (state: LifeState, code?: string) => ActionSuccess;
const fail = failUntyped as (state: LifeState, code: string, reason?: string) => ActionFailure;
const busy = busyUntyped as (state: LifeState, reason?: string) => ActionFailure | null;
// activities.js infers `mode` as null from its default; the travel mode id is a string.
const arrive = arriveUntyped as (state: LifeState, venueId: string, ctx: LifeContext, options: { spot?: string; mode?: string | null }) => boolean;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

type Point = WalkPoint;

export const SHUTTLE_FEE = 50;
export const SHUTTLE_SPEED = 8;
export const SHUTTLE_MAX_DURATION = 120;
export const SHUTTLE_ROUTE_SOURCE = 'Synthetic internal beta route; not a real UNILAG route or timetable.';

export interface ShuttleStop {
  /** Stable destination and venue-spot id. */
  id: ShuttleStopId
  /** Display label. */
  label: string
  /** Exact campus anchor. */
  anchor: CampusAnchor
}

const anchorOf = (id: ShuttleStopId): CampusAnchor => {
  const anchor = ANCHORS[id];
  if (!anchor) throw new Error(`No campus anchor for shuttle stop ${id}`); // every stop id is an anchor of layout.ts (the original stored undefined)
  return anchor;
};

const STOP_ROWS: readonly (readonly [ShuttleStopId, string])[] = [
  ['main-gate', 'Main Gate'],
  ['new-hall-shopping', 'New Hall Shops & 2001 Café'],
  ['senate', 'Senate House'],
  ['engineering', 'Faculty of Engineering'],
  ['sports-centre', 'Sports Centre'],
  ['second-gate', 'Second Gate'],
  ['dli-building', 'Distance Learning Institute'],
  ['lagoon-front', 'Lagoon Front'],
];
export const SHUTTLE_STOPS: readonly Readonly<ShuttleStop>[] = Object.freeze(STOP_ROWS.map(([id, label]): Readonly<ShuttleStop> => Object.freeze({ id, label, anchor: anchorOf(id) })));

const stopById = new Map(SHUTTLE_STOPS.map((stop): [ShuttleStopId, Readonly<ShuttleStop>] => [stop.id, stop]));
const isStopId = (value: unknown): value is ShuttleStopId => typeof value === 'string' && stopById.has(value as ShuttleStopId);
/** The label of a stop. */
const stopLabel = (id: ShuttleStopId): string => stopById.get(id)?.label ?? id; // every ShuttleStopId is a stop (the original would throw)
const campusWalk = createCampusWalk();
const EPSILON = 1e-7;

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.z - a.z);
const pointKey = (point: Point): string => `${point.x},${point.z}`;
const lengthOf = (points: readonly Point[]): number => points.slice(1).reduce((sum, point, index) => sum + distance(points[index]!, point), 0); // index is always in range
const pushDistinct = (points: Point[], point: Point): void => {
  const last = points.at(-1);
  if (!last || distance(last, point) > EPSILON) points.push({ x: point.x, z: point.z });
};

interface RoadEdge {
  /** Adjacent node key. */
  to: string
  /** Edge length. */
  length: number
  /** Oriented edge polyline. */
  points: Point[]
}

interface RoadSegment { a: Point; b: Point; ak: string; bk: string }
interface RoadProjection extends RoadSegment { point: Point; distance: number }

const roadGraph = new Map<string, RoadEdge[]>();
const roadSegments: RoadSegment[] = [];
const edgesAt = (graph: Map<string, RoadEdge[]>, key: string): RoadEdge[] => {
  let edges = graph.get(key);
  if (!edges) { edges = []; graph.set(key, edges); }
  return edges;
};
const addEdge = (a: Point, b: Point): void => {
  const ak = pointKey(a), bk = pointKey(b), span = distance(a, b);
  edgesAt(roadGraph, ak).push({ to: bk, length: span, points: [a, b] });
  edgesAt(roadGraph, bk).push({ to: ak, length: span, points: [b, a] });
  roadSegments.push({ a, b, ak, bk });
};
for (const road of ROADS) {
  for (let index = 1; index < road.points.length; index += 1) {
    const from = road.points[index - 1], to = road.points[index];
    if (!from || !to) continue; // index is always in range
    addEdge({ x: from[0], z: from[1] }, { x: to[0], z: to[1] });
  }
}

function nearestRoad(point: Point): RoadProjection | null {
  let best: RoadProjection | null = null;
  for (const segment of roadSegments) {
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z;
    const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.z - segment.a.z) * dz) / (dx * dx + dz * dz || 1)));
    const at = { x: segment.a.x + dx * t, z: segment.a.z + dz * t };
    const gap = distance(point, at);
    if (!best || gap < best.distance) best = { ...segment, point: at, distance: gap };
  }
  return best;
}

/** Shortest path on the continuous road graph between two projected road points. */
function roadPath(start: RoadProjection | null, end: RoadProjection | null): Point[] | null {
  if (!start || !end) return null;
  const graph = new Map([...roadGraph].map(([key, edges]): [string, RoadEdge[]] => [key, [...edges]]));
  const startKey = '@start', endKey = '@end';
  graph.set(startKey, []); graph.set(endKey, []);
  const connect = (virtualKey: string, projection: RoadProjection): void => {
    for (const [key, point] of [[projection.ak, projection.a], [projection.bk, projection.b]] as const) {
      const span = distance(projection.point, point);
      edgesAt(graph, virtualKey).push({ to: key, length: span, points: [projection.point, point] });
      edgesAt(graph, key).push({ to: virtualKey, length: span, points: [point, projection.point] });
    }
  };
  connect(startKey, start);
  connect(endKey, end);
  if (start.ak === end.ak && start.bk === end.bk) {
    const span = distance(start.point, end.point);
    edgesAt(graph, startKey).push({ to: endKey, length: span, points: [start.point, end.point] });
    edgesAt(graph, endKey).push({ to: startKey, length: span, points: [end.point, start.point] });
  }

  const cost = new Map<string, number>([[startKey, 0]]), previous = new Map<string, { from: string; points: Point[] }>(), open = new Set([startKey]);
  while (open.size) {
    let current: string | null = null, best = Infinity;
    for (const key of open) { const known = cost.get(key) ?? Infinity; if (known < best) { current = key; best = known; } }
    if (current === null) break; // unreachable: every open key has a finite cost (the original would throw)
    open.delete(current);
    if (current === endKey) break;
    for (const edge of graph.get(current) || []) {
      const next = best + edge.length;
      if (next >= (cost.get(edge.to) ?? Infinity)) continue;
      cost.set(edge.to, next);
      previous.set(edge.to, { from: current, points: edge.points });
      open.add(edge.to);
    }
  }
  if (!previous.has(endKey)) return null;
  const edges: Point[][] = [];
  for (let cursor = endKey; cursor !== startKey;) {
    const step = previous.get(cursor);
    if (!step) return null; // unreachable: the chain from the end always reaches the start
    edges.push(step.points); cursor = step.from;
  }
  const result: Point[] = [];
  for (const edge of edges.reverse()) for (const point of edge) pushDistinct(result, point);
  return result;
}

/** The safe shuttle polyline of one origin/destination pair. */
export interface ShuttleRoute {
  origin: string
  destination: string
  points: readonly Point[]
  road: readonly Point[]
  connectors: Readonly<{ start: readonly Point[]; end: readonly Point[] }>
  length: number
  totalLength: number
  duration: number
  source: string
}

const routeCache = new Map<string, Readonly<ShuttleRoute>>();

/**
 * Returns the safe shuttle polyline. Only the first and last legs use the walk
 * grid; every middle segment follows `ROADS`.
 */
export function shuttleRoute(origin: string, destination: string): Readonly<ShuttleRoute> | null {
  const cacheKey = `${origin}>${destination}`;
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;
  const from = stopById.get(origin as ShuttleStopId), to = stopById.get(destination as ShuttleStopId);
  if (!from || !to || origin === destination) return null;
  const startRoad = nearestRoad(from.anchor), endRoad = nearestRoad(to.anchor);
  if (!startRoad || !endRoad) return null; // no roads at all (the original threw)
  const first = campusWalk.route(from.anchor, startRoad.point);
  const road = roadPath(startRoad, endRoad);
  const last = campusWalk.route(endRoad.point, to.anchor);
  if (!first || !road || !last) return null;
  const startConnector: Point[] = [];
  pushDistinct(startConnector, from.anchor);
  for (const point of first) pushDistinct(startConnector, point);
  const endConnector: Point[] = [];
  pushDistinct(endConnector, endRoad.point);
  for (const point of last) pushDistinct(endConnector, point);
  const points = [...startConnector];
  for (const point of road) pushDistinct(points, point);
  for (const point of endConnector) pushDistinct(points, point);
  const roadLength = lengthOf(road);
  const route: Readonly<ShuttleRoute> = Object.freeze({
    origin, destination, points: Object.freeze(points), road: Object.freeze(road),
    connectors: Object.freeze({ start: Object.freeze(startConnector), end: Object.freeze(endConnector) }),
    length: roadLength, totalLength: lengthOf(points),
    duration: Math.min(SHUTTLE_MAX_DURATION, Math.max(1, Math.ceil(roadLength / SHUTTLE_SPEED))),
    source: SHUTTLE_ROUTE_SOURCE,
  });
  routeCache.set(cacheKey, route);
  return route;
}

/** The part of a running ride (or of a ride-shaped object) that decides where the shuttle is. */
export interface ShuttlePoseSource {
  origin: string
  destination?: string
  dest?: string
  duration: number
  remaining: number
  start?: number
}

export interface ShuttlePose { x: number; y: number; z: number; ry: number; progress: number }

/**
 * Deterministic shuttle position along the authoritative route.
 * A number from 0 to 1 is explicit progress; a larger number is interpreted as
 * server time in ms when the action has `start`. Omit it to derive progress from
 * `duration` and `remaining`.
 */
export function shuttlePose(active: ShuttlePoseSource, nowOrProgress?: number): ShuttlePose | null {
  const destination = active?.dest ?? active?.destination;
  const route = destination === undefined ? null : shuttleRoute(active?.origin, destination);
  if (!route || active.duration !== route.duration || !finite(active.remaining)) return null;
  let progress = 1 - active.remaining / active.duration;
  if (finite(nowOrProgress) && nowOrProgress >= 0 && nowOrProgress <= 1) progress = nowOrProgress;
  else if (finite(nowOrProgress) && finite(active.start)) progress = (nowOrProgress - active.start) / (active.duration * 1000);
  progress = Math.max(0, Math.min(1, progress));
  const target = route.length * progress;
  let covered = 0;
  for (let index = 1; index < route.road.length; index += 1) {
    const a = route.road[index - 1], b = route.road[index];
    if (!a || !b) continue; // index is always in range
    const span = distance(a, b);
    if (covered + span + EPSILON < target) { covered += span; continue; }
    const t = span ? Math.max(0, Math.min(1, (target - covered) / span)) : 0;
    return { x: a.x + (b.x - a.x) * t, y: 0, z: a.z + (b.z - a.z) * t,
      ry: Math.atan2(b.x - a.x, b.z - a.z), progress };
  }
  const end = route.road.at(-1), before = route.road.at(-2) || end;
  if (!end || !before) return null; // an empty road (the original threw)
  return { x: end.x, y: 0, z: end.z, ry: Math.atan2(end.x - before.x, end.z - before.z), progress };
}

function board(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): ActionOutcome {
  const blocked = busy(state);
  if (blocked) return blocked;
  if (state.location !== 'unilag') return fail(state, 'wrong_venue', 'Board the campus shuttle from a UNILAG stop.');
  const origin = state.spot, destination = payload?.destination;
  if (!isStopId(origin)) return fail(state, 'wrong_stop', 'Move to a campus shuttle stop before boarding.');
  if (!isStopId(destination) || destination === origin) {
    return fail(state, 'invalid_destination', 'Choose a different campus shuttle stop.');
  }
  const route = shuttleRoute(origin, destination);
  if (!route) return fail(state, 'route_unavailable', 'That campus shuttle route is unavailable.');
  if (!debit(state, SHUTTLE_FEE, `Campus shuttle to ${stopLabel(destination)}`, ctx)) {
    return fail(state, 'insufficient_funds', `The campus shuttle costs ₦${SHUTTLE_FEE}.`);
  }
  state.activeAction = {
    kind: 'campus-shuttle', id: destination, duration: route.duration, remaining: route.duration,
    origin, dest: destination, start: ctx.now,
  };
  state.message = `Campus shuttle to ${stopLabel(destination)}.`;
  return ok(state, 'started');
}

const activeShuttle = {
  moves: false,
  sanitize(value, state, ctx) {
    const { origin, dest } = value;
    if (!isStopId(origin) || !isStopId(dest)) return null; // an unknown stop never had a route
    const route = shuttleRoute(origin, dest);
    if (state.location !== 'unilag' || state.spot !== origin || value.id !== dest || !route
      || value.duration !== route.duration || !finite(value.start) || value.start < 0 || value.start > ctx.now) return null;
    return { origin, dest, start: value.start };
  },
  complete(state, active, ctx) {
    const legitimate = spotsOf('unilag').some((spot) => spot.id === active.dest);
    if (!legitimate || !arrive(state, 'unilag', ctx, { spot: active.dest, mode: 'campus-shuttle' })) {
      state.message = 'The campus shuttle stop is no longer available. You remain at your origin stop.';
      return;
    }
    state.unilagShuttle.rides = Math.min(Number.MAX_SAFE_INTEGER, state.unilagShuttle.rides + 1);
    state.message = `Campus shuttle arrived at ${stopLabel(active.dest)}.`;
  },
  cancel(state, _active, _ctx) {
    state.message = `Campus shuttle cancelled. The ₦${SHUTTLE_FEE} fare is not refundable.`;
    return null;
  },
} satisfies ActiveKindHandler<CampusShuttleAction>;

/** Registry-ready, server-authoritative campus shuttle system. */
const unilagShuttle = {
  id: 'unilagShuttle',
  stateKeys: ['unilagShuttle'],
  sanitize(input, state) {
    const saved = input.unilagShuttle;
    const rides = typeof saved === 'object' && saved !== null && 'rides' in saved ? saved.rides : undefined;
    state.unilagShuttle = { rides: Number.isSafeInteger(rides) && (rides as number) >= 0 ? rides as number : 0 };
  },
  actions: { 'campus-shuttle': board },
  active: { 'campus-shuttle': activeShuttle },
  advance() {},
  view(state): UnilagShuttleView {
    return {
      fare: SHUTTLE_FEE, source: SHUTTLE_ROUTE_SOURCE,
      stops: SHUTTLE_STOPS.map(({ id, label }) => ({ id, label })),
      active: state.activeAction?.kind === 'campus-shuttle'
        ? { origin: state.activeAction.origin, destination: state.activeAction.dest, refundable: false }
        : null,
    };
  },
} satisfies SystemDefinition<'unilagShuttle'>;

export default unilagShuttle;

/**
 * Builds a reusable merged campus shuttle model without timers or textures.
 */
export function buildShuttle(kit: SceneKit): { group: Group; triangles: number; dispose: () => void } {
  const { THREE } = kit, batch: SceneBatch = createBatch(THREE), group = new THREE.Group();
  group.name = 'unilag-campus-shuttle';
  batch.box(0, 1.25, 0, 3.2, 1.8, 6.4, '#f2e7c9');
  batch.box(0, 2.2, -0.15, 3.05, 0.45, 5.6, '#8f2434');
  batch.box(0, 1.45, 3.22, 2.5, 1.0, 0.08, '#7db6c5', { layer: 'glass' });
  for (const side of [-1, 1]) {
    batch.box(side * 1.61, 1.5, -0.2, 0.07, 0.8, 4.8, '#78acbb', { layer: 'glass' });
    for (const z of [-2.2, 2.1]) batch.cyl(side * 1.65, 0.62, z, 0.56, 0.34, '#202328', { seg: 10, rz: Math.PI / 2 });
  }
  batch.box(0, 1.0, -3.23, 2.7, 0.5, 0.08, '#8f2434');
  batch.box(0, 2.45, 0, 2.0, 0.12, 3.4, '#d9b43c');
  const built = batch.build(sceneMaterials(kit));
  for (const mesh of built.meshes) group.add(mesh);
  const registry = kitResources(kit).disposers;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; registry.delete(dispose); releaseObjects(built.meshes); group.parent?.remove(group); group.clear();
  };
  registry.add(dispose);
  group.userData = { triangles: built.triangles, dispose };
  return { group, triangles: built.triangles, dispose };
}
