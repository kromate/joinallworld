/**
 * Campus shuttle rules, road routing, pose interpolation and procedural model.
 *
 * This is a synthetic internal beta service. Stop order, fare, speed and timing
 * are game rules, not a representation of a real UNILAG route or timetable.
 */
import { arrive, debit, spotsOf } from '../../game/api.ts';
import { busy, fail, finite, ok, safeCount } from '../../game/util.ts';
import { createBatch, kitResources, releaseObjects, sceneMaterials } from '../../scene/build.ts';
import { ANCHORS, ROADS } from './layout.js';
import { createCampusWalk } from './walk.js';

export const SHUTTLE_FEE = 50;
export const SHUTTLE_SPEED = 8;
export const SHUTTLE_MAX_DURATION = 120;
export const SHUTTLE_ROUTE_SOURCE = 'Synthetic internal beta route; not a real UNILAG route or timetable.';

/**
 * @typedef {object} ShuttleStop
 * @property {string} id Stable destination and venue-spot id.
 * @property {string} label Display label.
 * @property {{x:number,y:number,z:number,ry:number}} anchor Exact campus anchor.
 */

/** @type {ShuttleStop[]} */
export const SHUTTLE_STOPS = Object.freeze([
  ['main-gate', 'Main Gate'],
  ['new-hall-shopping', 'New Hall Shops & 2001 Café'],
  ['senate', 'Senate House'],
  ['engineering', 'Faculty of Engineering'],
  ['sports-centre', 'Sports Centre'],
  ['second-gate', 'Second Gate'],
  ['dli-building', 'Distance Learning Institute'],
  ['lagoon-front', 'Lagoon Front'],
].map(([id, label]) => Object.freeze({ id, label, anchor: ANCHORS[id] })));

const stopById = new Map(SHUTTLE_STOPS.map((stop) => [stop.id, stop]));
const campusWalk = createCampusWalk();
const EPSILON = 1e-7;

/** @param {{x:number,z:number}} a @param {{x:number,z:number}} b */
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
/** @param {{x:number,z:number}} point */
const pointKey = (point) => `${point.x},${point.z}`;
/** @param {Array<{x:number,z:number}>} points */
const lengthOf = (points) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
/** @param {Array<{x:number,z:number}>} points @param {{x:number,z:number}} point */
const pushDistinct = (points, point) => {
  if (!points.length || distance(points.at(-1), point) > EPSILON) points.push({ x: point.x, z: point.z });
};

/**
 * @typedef {object} RoadEdge
 * @property {string} to Adjacent node key.
 * @property {number} length Edge length.
 * @property {Array<{x:number,z:number}>} points Oriented edge polyline.
 */

/** @type {Map<string, RoadEdge[]>} */
const roadGraph = new Map();
const roadSegments = [];
const addEdge = (a, b) => {
  const ak = pointKey(a), bk = pointKey(b), span = distance(a, b);
  if (!roadGraph.has(ak)) roadGraph.set(ak, []);
  if (!roadGraph.has(bk)) roadGraph.set(bk, []);
  roadGraph.get(ak).push({ to: bk, length: span, points: [a, b] });
  roadGraph.get(bk).push({ to: ak, length: span, points: [b, a] });
  roadSegments.push({ a, b, ak, bk });
};
for (const road of ROADS) {
  for (let index = 1; index < road.points.length; index += 1) {
    const a = { x: road.points[index - 1][0], z: road.points[index - 1][1] };
    const b = { x: road.points[index][0], z: road.points[index][1] };
    addEdge(a, b);
  }
}

/** @param {{x:number,z:number}} point */
function nearestRoad(point) {
  let best = null;
  for (const segment of roadSegments) {
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z;
    const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.z - segment.a.z) * dz) / (dx * dx + dz * dz || 1)));
    const at = { x: segment.a.x + dx * t, z: segment.a.z + dz * t };
    const gap = distance(point, at);
    if (!best || gap < best.distance) best = { ...segment, point: at, distance: gap };
  }
  return best;
}

/**
 * Shortest path on the continuous road graph between two projected road points.
 * @param {ReturnType<typeof nearestRoad>} start
 * @param {ReturnType<typeof nearestRoad>} end
 * @returns {Array<{x:number,z:number}>|null}
 */
function roadPath(start, end) {
  if (!start || !end) return null;
  const graph = new Map([...roadGraph].map(([key, edges]) => [key, [...edges]]));
  const startKey = '@start', endKey = '@end';
  graph.set(startKey, []); graph.set(endKey, []);
  const connect = (virtualKey, projection) => {
    for (const [key, point] of [[projection.ak, projection.a], [projection.bk, projection.b]]) {
      const span = distance(projection.point, point);
      graph.get(virtualKey).push({ to: key, length: span, points: [projection.point, point] });
      graph.get(key).push({ to: virtualKey, length: span, points: [point, projection.point] });
    }
  };
  connect(startKey, start);
  connect(endKey, end);
  if (start.ak === end.ak && start.bk === end.bk) {
    const span = distance(start.point, end.point);
    graph.get(startKey).push({ to: endKey, length: span, points: [start.point, end.point] });
    graph.get(endKey).push({ to: startKey, length: span, points: [end.point, start.point] });
  }

  const cost = new Map([[startKey, 0]]), previous = new Map(), open = new Set([startKey]);
  while (open.size) {
    let current = null, best = Infinity;
    for (const key of open) if (cost.get(key) < best) { current = key; best = cost.get(key); }
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
  const edges = [];
  for (let cursor = endKey; cursor !== startKey;) {
    const step = previous.get(cursor);
    edges.push(step.points); cursor = step.from;
  }
  const result = [];
  for (const edge of edges.reverse()) for (const point of edge) pushDistinct(result, point);
  return result;
}

const routeCache = new Map();

/**
 * Returns the safe shuttle polyline. Only the first and last legs use the walk
 * grid; every middle segment follows `ROADS`.
 * @param {string} origin Stop id.
 * @param {string} destination Stop id.
 * @returns {{origin:string,destination:string,points:Array<{x:number,z:number}>,road:Array<{x:number,z:number}>,
 *   connectors:{start:Array<{x:number,z:number}>,end:Array<{x:number,z:number}>},length:number,totalLength:number,
 *   duration:number,source:string}|null}
 */
export function shuttleRoute(origin, destination) {
  const cacheKey = `${origin}>${destination}`;
  if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);
  const from = stopById.get(origin), to = stopById.get(destination);
  if (!from || !to || origin === destination) return null;
  const startRoad = nearestRoad(from.anchor), endRoad = nearestRoad(to.anchor);
  const first = campusWalk.route(from.anchor, startRoad.point);
  const road = roadPath(startRoad, endRoad);
  const last = campusWalk.route(endRoad.point, to.anchor);
  if (!first || !road || !last) return null;
  const startConnector = [];
  pushDistinct(startConnector, from.anchor);
  for (const point of first) pushDistinct(startConnector, point);
  const endConnector = [];
  pushDistinct(endConnector, endRoad.point);
  for (const point of last) pushDistinct(endConnector, point);
  const points = [...startConnector];
  for (const point of road) pushDistinct(points, point);
  for (const point of endConnector) pushDistinct(points, point);
  const roadLength = lengthOf(road);
  const route = Object.freeze({
    origin, destination, points: Object.freeze(points), road: Object.freeze(road),
    connectors: Object.freeze({ start: Object.freeze(startConnector), end: Object.freeze(endConnector) }),
    length: roadLength, totalLength: lengthOf(points),
    duration: Math.min(SHUTTLE_MAX_DURATION, Math.max(1, Math.ceil(roadLength / SHUTTLE_SPEED))),
    source: SHUTTLE_ROUTE_SOURCE,
  });
  routeCache.set(cacheKey, route);
  return route;
}

/**
 * Deterministic shuttle position along the authoritative route.
 * A number from 0 to 1 is explicit progress; a larger number is interpreted as
 * server time in ms when the action has `start`. Omit it to derive progress from
 * `duration` and `remaining`.
 * @param {{origin:string,destination?:string,dest?:string,duration:number,remaining:number,start?:number}} active
 * @param {number} [nowOrProgress]
 * @returns {{x:number,y:number,z:number,ry:number,progress:number}|null}
 */
export function shuttlePose(active, nowOrProgress) {
  const destination = active?.dest ?? active?.destination;
  const route = shuttleRoute(active?.origin, destination);
  if (!route || active.duration !== route.duration || !finite(active.remaining)) return null;
  let progress = 1 - active.remaining / active.duration;
  if (finite(nowOrProgress) && nowOrProgress >= 0 && nowOrProgress <= 1) progress = nowOrProgress;
  else if (finite(nowOrProgress) && finite(active.start)) progress = (nowOrProgress - active.start) / (active.duration * 1000);
  progress = Math.max(0, Math.min(1, progress));
  const target = route.length * progress;
  let covered = 0;
  for (let index = 1; index < route.road.length; index += 1) {
    const a = route.road[index - 1], b = route.road[index], span = distance(a, b);
    if (covered + span + EPSILON < target) { covered += span; continue; }
    const t = span ? Math.max(0, Math.min(1, (target - covered) / span)) : 0;
    return { x: a.x + (b.x - a.x) * t, y: 0, z: a.z + (b.z - a.z) * t,
      ry: Math.atan2(b.x - a.x, b.z - a.z), progress };
  }
  const end = route.road.at(-1), before = route.road.at(-2) || end;
  return { x: end.x, y: 0, z: end.z, ry: Math.atan2(end.x - before.x, end.z - before.z), progress };
}

function board(state, payload, ctx) {
  const blocked = busy(state);
  if (blocked) return blocked;
  if (state.location !== 'unilag') return fail(state, 'wrong_venue', 'Board the campus shuttle from a UNILAG stop.');
  const origin = state.spot, destination = payload?.destination;
  if (!stopById.has(origin)) return fail(state, 'wrong_stop', 'Move to a campus shuttle stop before boarding.');
  if (typeof destination !== 'string' || !stopById.has(destination) || destination === origin) {
    return fail(state, 'invalid_destination', 'Choose a different campus shuttle stop.');
  }
  const route = shuttleRoute(origin, destination);
  if (!route) return fail(state, 'route_unavailable', 'That campus shuttle route is unavailable.');
  if (!debit(state, SHUTTLE_FEE, `Campus shuttle to ${stopById.get(destination).label}`, ctx)) {
    return fail(state, 'insufficient_funds', `The campus shuttle costs ₦${SHUTTLE_FEE}.`);
  }
  state.activeAction = {
    kind: 'campus-shuttle', id: destination, duration: route.duration, remaining: route.duration,
    origin, dest: destination, start: ctx.now,
  };
  state.message = `Campus shuttle to ${stopById.get(destination).label}.`;
  return ok(state, 'started');
}

const activeShuttle = {
  moves: false,
  sanitize(value, state, ctx) {
    const route = shuttleRoute(value.origin, value.dest);
    if (state.location !== 'unilag' || state.spot !== value.origin || value.id !== value.dest || !route
      || value.duration !== route.duration || !finite(value.start) || value.start < 0 || value.start > ctx.now) return null;
    return { origin: value.origin, dest: value.dest, start: value.start };
  },
  complete(state, active, ctx) {
    const legitimate = spotsOf('unilag').some((spot) => spot.id === active.dest);
    if (!legitimate || !arrive(state, 'unilag', ctx, { spot: active.dest, mode: 'campus-shuttle' })) {
      state.message = 'The campus shuttle stop is no longer available. You remain at your origin stop.';
      return;
    }
    state.unilagShuttle.rides = Math.min(Number.MAX_SAFE_INTEGER, state.unilagShuttle.rides + 1);
    state.message = `Campus shuttle arrived at ${stopById.get(active.dest).label}.`;
  },
  cancel(state) {
    state.message = `Campus shuttle cancelled. The ₦${SHUTTLE_FEE} fare is not refundable.`;
    return null;
  },
};

/** Registry-ready, server-authoritative campus shuttle system. */
const unilagShuttle = {
  id: 'unilagShuttle',
  stateKeys: ['unilagShuttle'],
  sanitize(input, state) {
    state.unilagShuttle = { rides: safeCount(input.unilagShuttle?.rides) ? input.unilagShuttle.rides : 0 };
  },
  actions: { 'campus-shuttle': board },
  active: { 'campus-shuttle': activeShuttle },
  advance() {},
  view(state) {
    return {
      fare: SHUTTLE_FEE, source: SHUTTLE_ROUTE_SOURCE,
      stops: SHUTTLE_STOPS.map(({ id, label }) => ({ id, label })),
      active: state.activeAction?.kind === 'campus-shuttle'
        ? { origin: state.activeAction.origin, destination: state.activeAction.dest, refundable: false }
        : null,
    };
  },
};

export default unilagShuttle;

/**
 * Builds a reusable merged campus shuttle model without timers or textures.
 * @param {{THREE:object,onDispose:(fn:()=>void)=>()=>void}} kit Scene kit.
 * @returns {{group:object,triangles:number,dispose:()=>void}}
 */
export function buildShuttle(kit) {
  const { THREE } = kit, batch = createBatch(THREE), group = new THREE.Group();
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
