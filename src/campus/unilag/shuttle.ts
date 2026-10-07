/**
 * Campus shuttle rules, road routing and pose interpolation.
 *
 * This is a synthetic internal beta service. Stop order, fare, speed and timing
 * are game rules, not a representation of a real UNILAG route or timetable.
 */
import { arrive, debit, spotsOf } from '../../game/api.ts';
import { LEFT_OUT, PLAYS } from '../../game/profile.ts';
import { busy, fail, ok } from '../../game/util.ts';
import { ANCHORS, ROADS } from './layout.ts';
import type { CampusAnchor } from './layout.ts';
import { createCampusWalk } from './walk.ts';
import type { WalkPoint } from './walk.ts';
import type { CampusOutcome, CampusShuttleAction, ShuttleStopId, UnilagShuttleView } from '../../types/campus.ts';
import type { ActionFailure, ActionOutcome, ActionSuccess, LifeContext, LifeState } from '../../types/life.ts';
import type { ActiveKindHandler, SystemDefinition } from '../../types/registry.ts';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

type Point = WalkPoint;

export const SHUTTLE_FEE = 50;
export const SHUTTLE_SPEED = 8;
export const SHUTTLE_MAX_DURATION = 120;
export const SHUTTLE_ROUTE_SOURCE = 'Geometry follows the pinned OpenStreetMap campus roads; stop service, fare and timetable remain fictional gameplay.';

export interface ShuttleStop {
  /** Stable destination and venue-spot id. */
  id: ShuttleStopId
  /** Display label. */
  label: string
  /** Exact campus anchor. */
  anchor: CampusAnchor
}

const anchorOf = (id: ShuttleStopId): CampusAnchor | null => ANCHORS[id] ?? null;

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
export const SHUTTLE_STOPS: readonly Readonly<ShuttleStop>[] = Object.freeze(STOP_ROWS.flatMap(([id, label]): Readonly<ShuttleStop>[] => {
  const anchor = anchorOf(id);
  return anchor ? [Object.freeze({ id, label, anchor })] : [];
}));

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

function roadCandidates(point: Point): RoadProjection[] {
  const candidates: RoadProjection[] = [];
  for (const segment of roadSegments) {
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z;
    const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.z - segment.a.z) * dz) / (dx * dx + dz * dz || 1)));
    const at = { x: segment.a.x + dx * t, z: segment.a.z + dz * t };
    const gap = distance(point, at);
    candidates.push({ ...segment, point: at, distance: gap });
  }
  return candidates.sort((a,b)=>a.distance-b.distance);
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
  const usable=(projection:RoadProjection)=>{const zone=campusWalk.zoneAt(projection.point.x,projection.point.z);return !!zone&&campusWalk.grids.get(zone.id)?.free(projection.point.x,projection.point.z);};
  const starts=roadCandidates(from.anchor).filter(usable).slice(0,30),ends=roadCandidates(to.anchor).filter(usable).slice(0,30);
  let selected:{start:RoadProjection;end:RoadProjection;first:Point[];last:Point[];road:Point[]}|null=null;
  for(const start of starts){for(const end of ends){const road=roadPath(start,end);if(!road)continue;const first=campusWalk.route(from.anchor,start.point),last=campusWalk.route(end.point,to.anchor);if(first&&last){selected={start,end,first,last,road};break;}}if(selected)break;}
  if(!selected)return null;
  const {start:startRoad,end:endRoad,first,last,road}=selected;
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

function board(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): CampusOutcome<'campus-shuttle'> {
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
  ...(PLAYS ? {
  complete(state, active, ctx) {
    const legitimate = spotsOf('unilag', ctx.cityId).some((spot) => spot.id === active.dest);
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
  } satisfies Pick<ActiveKindHandler<CampusShuttleAction>, 'complete' | 'cancel'> : LEFT_OUT),
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
  active: { 'campus-shuttle': activeShuttle },
  ...(PLAYS ? { actions: { 'campus-shuttle': board }, advance() {} } satisfies Pick<SystemDefinition<'unilagShuttle'>, 'actions' | 'advance'> : LEFT_OUT),
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
