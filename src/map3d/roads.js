/**
 * OWNER: world
 * Road network of a city pack: smoothing, the graph, routing and sampling. Pure maths — no
 * Three.js, no DOM — so it runs under `node --test` and the trip animation can be checked there.
 *
 *   buildNetwork(pack) → {
 *     roads   [{ id, name, major, bridge, pylon, points: [{ x, y, z }], length }]   smoothed, with deck heights
 *     places  { [venueId | 'home:<house>']: { x, z, ry, gate: { x, y, z }, door: { x, y, z } } }   ry faces the road; a trip runs door to door
 *     route(fromKey, toKey) → Route | null
 *   }
 *   Route = { points: [{ x, y, z, bridge }], lengths: [cumulative], length, lead, tail, bridges: [roadId] }
 *     `lead` is the length of the walk from the door to the road, `tail` of the walk from the road to the door.
 *   pointAt(route, distance) → { x, y, z, ry, bridge }
 */

const key = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;
const smoothstep = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** Round the corners of a closed polygon (Chaikin). */
export function roundPolygon(points, iterations = 2) {
  let current = points;
  for (let pass = 0; pass < iterations; pass++) {
    const next = [];
    for (let i = 0; i < current.length; i++) {
      const [ax, az] = current[i], [bx, bz] = current[(i + 1) % current.length];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    current = next;
  }
  return current;
}

export function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[i], [bx, bz] = polygon[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** A Catmull-Rom curve through every control point (the control points themselves are kept exactly). */
export function smoothLine(controls, step = 3) {
  const out = [];
  const at = (i) => controls[Math.max(0, Math.min(controls.length - 1, i))];
  for (let i = 0; i < controls.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      if (s === 0) { out.push([p1[0], p1[1]]); continue; }
      out.push([0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  const last = controls[controls.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

/** Nearest point to (x, z) on the segment a→b. */
function nearestOnSegment(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, span = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / span));
  const px = a.x + dx * t, pz = a.z + dz * t;
  return { x: px, z: pz, t, distance: Math.hypot(x - px, z - pz) };
}

export function buildNetwork(pack, { door = 4.7 } = {}) {
  const nodes = new Map();
  const node = (x, y, z) => {
    const id = key(x, z);
    if (!nodes.has(id)) nodes.set(id, { id, x, y, z, links: new Map() });
    return nodes.get(id);
  };
  const link = (a, b, data) => {
    if (a === b) return;
    const length = Math.hypot(a.x - b.x, a.z - b.z, a.y - b.y);
    a.links.set(b.id, { length, ...data }); b.links.set(a.id, { length, ...data });
  };

  const roads = pack.roads.map((road) => {
    const flat = smoothLine(road.points, road.bridge ? 2 : 3);
    let total = 0;
    const run = flat.map((point, i) => { if (i) total += Math.hypot(point[0] - flat[i - 1][0], point[1] - flat[i - 1][1]); return total; });
    const points = flat.map(([x, z], i) => {
      const t = total ? run[i] / total : 0;
      return { x, z, y: road.bridge ? road.bridge * smoothstep(0, 0.24, t) * (1 - smoothstep(0.76, 1, t)) : 0 };
    });
    for (let i = 1; i < points.length; i++) {
      link(node(points[i - 1].x, points[i - 1].y, points[i - 1].z), node(points[i].x, points[i].y, points[i].z), { road: road.id, bridge: road.bridge ? road.id : null, cost: road.major ? 1 : 1.2 });
    }
    return { id: road.id, name: road.name, major: Boolean(road.major), bridge: road.bridge || 0, pylon: Boolean(road.pylon), points, length: total };
  });

  /** Join a place to the nearest ground road with a short path; returns its gate on that road. */
  function attach(id, x, z) {
    let best = null;
    for (const a of nodes.values()) {
      if (a.id.startsWith('place:')) continue;
      for (const [otherId, data] of a.links) {
        if (otherId < a.id || data.bridge || data.road === 'path') continue;
        const b = nodes.get(otherId), hit = nearestOnSegment(x, z, a, b);
        if (!best || hit.distance < best.distance) best = { ...hit, a, b, data };
      }
    }
    if (!best) return null;
    let gate;
    if (best.t < 0.02) gate = best.a; else if (best.t > 0.98) gate = best.b;
    else {
      gate = node(best.x, 0, best.z);
      best.a.links.delete(best.b.id); best.b.links.delete(best.a.id);
      link(best.a, gate, { road: best.data.road, bridge: null, cost: best.data.cost });
      link(gate, best.b, { road: best.data.road, bridge: null, cost: best.data.cost });
    }
    const place = { id: `place:${id}`, x, y: 0, z, links: new Map() };
    nodes.set(place.id, place);
    link(place, gate, { road: 'path', bridge: null, cost: 1 });
    return gate;
  }

  const places = {};
  const add = (id, spot) => {
    const gate = attach(id, spot.x, spot.z);
    const reach = gate ? Math.hypot(gate.x - spot.x, gate.z - spot.z) : 0, k = reach ? Math.min(door, reach * 0.78) / reach : 0;
    // The door: where a traveller stands, just off the plinth on the side facing the road.
    places[id] = { x: spot.x, z: spot.z, ry: gate ? Math.atan2(gate.x - spot.x, gate.z - spot.z) : 0, gate: gate ? { x: gate.x, y: 0, z: gate.z } : null,
      door: gate ? { x: spot.x + (gate.x - spot.x) * k, y: 0, z: spot.z + (gate.z - spot.z) * k } : { x: spot.x, y: 0, z: spot.z } };
  };
  for (const [id, spot] of Object.entries(pack.sites)) add(id, spot);
  for (const [id, spot] of Object.entries(pack.homes)) add(`home:${id}`, spot);

  const cache = new Map();
  function route(from, to) {
    const cacheKey = `${from}>${to}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const start = nodes.get(`place:${from}`), goal = nodes.get(`place:${to}`);
    let result = null;
    if (start && goal && start !== goal) {
      const cost = new Map([[start.id, 0]]), previous = new Map(), open = new Set([start.id]), done = new Set();
      while (open.size) {
        let current = null;
        for (const id of open) if (current === null || cost.get(id) < cost.get(current)) current = id;
        if (current === goal.id) break;
        open.delete(current); done.add(current);
        const here = nodes.get(current);
        // A place is a dead end: only the two ends of the trip are ever entered.
        if (current.startsWith('place:') && current !== start.id) continue;
        for (const [next, data] of here.links) {
          if (done.has(next)) continue;
          const value = cost.get(current) + data.length * data.cost;
          if (value < (cost.get(next) ?? Infinity)) { cost.set(next, value); previous.set(next, { from: current, data }); open.add(next); }
        }
      }
      if (previous.has(goal.id)) {
        const chain = [];
        for (let at = goal.id; at; at = previous.get(at)?.from) chain.unshift({ node: nodes.get(at), via: previous.get(at)?.data || null });
        const points = chain.map((step, i) => ({ x: step.node.x, y: step.node.y, z: step.node.z, bridge: step.via?.bridge || chain[i + 1]?.via?.bridge || null }));
        // The trip runs door to door, not centre to centre.
        Object.assign(points[0], places[from].door); Object.assign(points[points.length - 1], places[to].door);
        const lengths = [0];
        for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z));
        result = { from, to, points, lengths, length: lengths[lengths.length - 1], lead: lengths[1], tail: lengths[lengths.length - 1] - lengths[lengths.length - 2],
          bridges: [...new Set(chain.map((step) => step.via?.bridge).filter(Boolean))] };
      }
    }
    cache.set(cacheKey, result);
    return result;
  }

  return { roads, places, route, nodeCount: nodes.size };
}

/** Where a distance along the route is: position, the direction of travel (ry) and the bridge it is on, if any. */
export function pointAt(route, distance) {
  const { points, lengths } = route;
  const d = Math.max(0, Math.min(route.length, distance));
  let low = 0, high = lengths.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (lengths[mid] <= d) low = mid; else high = mid; }
  const a = points[low], b = points[Math.min(points.length - 1, low + 1)], span = lengths[low + 1] - lengths[low] || 1;
  const t = Math.max(0, Math.min(1, (d - lengths[low]) / span));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, ry: Math.atan2(b.x - a.x, b.z - a.z), bridge: b.bridge && a.bridge ? b.bridge : (t > 0.5 ? b.bridge : a.bridge) || null };
}
