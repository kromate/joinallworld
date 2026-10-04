import assert from 'node:assert/strict';
import test from 'node:test';

import { VENUES } from '../../game/content/venues.js';
import { rebuildCatalogue } from '../../game/systems/activities.js';
import { makeContext } from '../../game/util.js';
import { BUILDINGS, ROADS } from './layout.js';
import { createCampusWalk, footprintOf } from './walk.js';
import unilagShuttle, { buildShuttle, SHUTTLE_FEE, SHUTTLE_STOPS, shuttlePose, shuttleRoute } from './shuttle.js';
import { buildUnilagLandmark, MAP_PLACEMENT } from './landmark.js';

const NOW = Date.UTC(2026, 9, 4, 12);
const context = makeContext({ now: NOW, cityId: 'lagos', seed: 'shuttle-test' });

const lifeAt = (spot = 'main-gate', cash = 500) => ({
  location: 'unilag', spot, activeAction: null, cash, ledger: [], ledgerDays: [], t: NOW,
  message: '', unilagShuttle: { rides: 0 },
});

const intersects = (a, b, rectangle, clearance = 0) => {
  let [x0, z0, x1, z1] = rectangle;
  x0 -= clearance; z0 -= clearance; x1 += clearance; z1 += clearance;
  const dx = b.x - a.x, dz = b.z - a.z;
  let low = 0, high = 1;
  for (const [at, delta, min, max] of [[a.x, dx, x0, x1], [a.z, dz, z0, z1]]) {
    if (!delta) { if (at < min || at > max) return false; continue; }
    let first = (min - at) / delta, last = (max - at) / delta;
    if (first > last) [first, last] = [last, first];
    low = Math.max(low, first); high = Math.min(high, last);
    if (low > high) return false;
  }
  return true;
};

test('the road graph is continuous and every stop pair gets a safe road-led route', () => {
  const roadPoints = new Set(ROADS.flatMap((road) => road.points.map(([x, z]) => `${x},${z}`)));
  const walk = createCampusWalk();
  for (const from of SHUTTLE_STOPS) for (const to of SHUTTLE_STOPS) if (from !== to) {
    const route = shuttleRoute(from.id, to.id);
    assert.ok(route, `${from.id} -> ${to.id}`);
    assert.deepEqual(route.points[0], { x: from.anchor.x, z: from.anchor.z });
    assert.deepEqual(route.points.at(-1), { x: to.anchor.x, z: to.anchor.z });
    assert.ok(route.duration >= 1 && route.duration <= 120);
    assert.ok(route.road.some((point) => roadPoints.has(`${point.x},${point.z}`)), 'route uses road topology');
    for (const connector of [route.connectors.start, route.connectors.end]) {
      for (let index = 1; index < connector.length; index += 1) {
        const a = connector[index - 1], b = connector[index];
        const aZone = walk.zoneAt(a.x, a.z), bZone = walk.zoneAt(b.x, b.z);
        if (aZone?.id === bZone?.id) assert.equal(walk.grids.get(aZone.id).clearLine(a.x, a.z, b.x, b.z), true,
          `${from.id} -> ${to.id} connector crosses an obstacle`);
        else assert.ok(Math.hypot(a.x - b.x, a.z - b.z) <= 1.01, 'a connector changes zones only through a paired portal');
      }
    }
  }

  for (const road of ROADS) for (let index = 1; index < road.points.length; index += 1) {
    const a = { x: road.points[index - 1][0], z: road.points[index - 1][1] };
    const b = { x: road.points[index][0], z: road.points[index][1] };
    for (const building of BUILDINGS) for (const footprint of footprintOf(building)) {
      assert.equal(intersects(a, b, footprint, road.width / 2), false, `${road.id} crosses ${building.id}`);
    }
  }
});

test('boarding is server-authoritative, charges once and cannot teleport or forge timing', () => {
  const rebuilt = {};
  unilagShuttle.sanitize({ unilagShuttle: { rides: -1, admin: true } }, rebuilt);
  assert.deepEqual(rebuilt.unilagShuttle, { rides: 0 });
  const board = unilagShuttle.actions['campus-shuttle'];
  const away = { ...lifeAt(), location: 'park' };
  assert.equal(board(away, { destination: 'senate' }, context).code, 'wrong_venue');
  const betweenStops = lifeAt('library');
  assert.equal(board(betweenStops, { destination: 'senate' }, context).code, 'wrong_stop');
  const invalid = lifeAt();
  assert.equal(board(invalid, { destination: 'roof' }, context).code, 'invalid_destination');

  const state = lifeAt();
  assert.equal(board(state, { destination: 'senate', origin: 'second-gate', duration: 1 }, context).code, 'started');
  const expected = shuttleRoute('main-gate', 'senate');
  assert.deepEqual(state.activeAction, { kind: 'campus-shuttle', id: 'senate', duration: expected.duration,
    remaining: expected.duration, origin: 'main-gate', dest: 'senate', start: NOW });
  assert.equal(state.cash, 500 - SHUTTLE_FEE);
  assert.deepEqual(state.ledger.map(({ amount, reason }) => ({ amount, reason })), [{ amount: -50, reason: 'Campus shuttle to Senate House' }]);
  assert.equal(board(state, { destination: 'engineering' }, context).code, 'busy');
  assert.equal(state.cash, 500 - SHUTTLE_FEE, 'a repeat request cannot charge twice');

  const sanitize = unilagShuttle.active['campus-shuttle'].sanitize;
  assert.deepEqual(sanitize(state.activeAction, state, context), { origin: 'main-gate', dest: 'senate', start: NOW });
  assert.equal(sanitize({ ...state.activeAction, duration: 1 }, state, context), null);
  assert.equal(sanitize({ ...state.activeAction, dest: 'second-gate' }, state, context), null);
  assert.equal(sanitize({ ...state.activeAction, origin: 'second-gate' }, state, context), null);
  assert.equal(sanitize({ ...state.activeAction, start: NOW + 1 }, state, context), null);
});

test('completion uses a registered venue spot and cancellation never refunds the fare', () => {
  const original = VENUES.unilag;
  VENUES.unilag = {
    id: 'unilag', label: 'UNILAG', district: 'Akoka', zone: 'mainland', map: { x: 60, y: 12 },
    scene: { kind: 'unilag' }, ambient: [],
    spots: Object.fromEntries(SHUTTLE_STOPS.map((stop) => [stop.id, { id: stop.id, label: stop.label, activities: [] }])),
  };
  rebuildCatalogue();
  try {
    const state = lifeAt();
    const board = unilagShuttle.actions['campus-shuttle'];
    board(state, { destination: 'engineering' }, context);
    const active = state.activeAction;
    state.activeAction = null;
    unilagShuttle.active['campus-shuttle'].complete(state, active, context);
    assert.deepEqual([state.location, state.spot, state.unilagShuttle.rides], ['unilag', 'engineering', 1]);

    const cancelled = lifeAt();
    board(cancelled, { destination: 'senate' }, context);
    const balance = cancelled.cash, lines = cancelled.ledger.length;
    assert.equal(unilagShuttle.active['campus-shuttle'].cancel(cancelled, cancelled.activeAction, context), null);
    cancelled.activeAction = null;
    assert.deepEqual([cancelled.cash, cancelled.ledger.length], [balance, lines]);
    assert.match(cancelled.message, /not refundable/);

    const free = lifeAt('main-gate', 0);
    assert.equal(board(free, { destination: 'senate' }, context).code, 'insufficient_funds');
    assert.deepEqual([free.cash, free.ledger.length, free.activeAction], [0, 0, null]);
  } finally {
    if (original) VENUES.unilag = original; else delete VENUES.unilag;
    rebuildCatalogue();
  }
});

test('pose is deterministic at the beginning, midpoint and exact endpoint', () => {
  const route = shuttleRoute('main-gate', 'lagoon-front');
  const active = { origin: 'main-gate', dest: 'lagoon-front', duration: route.duration, remaining: route.duration, start: NOW };
  const beginning = shuttlePose(active, 0), midpoint = shuttlePose(active, 0.5), endpoint = shuttlePose(active, 1);
  assert.deepEqual({ x: beginning.x, z: beginning.z }, route.road[0]);
  assert.deepEqual({ x: endpoint.x, z: endpoint.z }, route.road.at(-1));
  assert.equal(midpoint.progress, 0.5);
  assert.notDeepEqual({ x: midpoint.x, z: midpoint.z }, { x: beginning.x, z: beginning.z });
  assert.deepEqual(shuttlePose({ ...active, remaining: active.duration / 2 }), midpoint);
  assert.deepEqual(shuttlePose(active, NOW + active.duration * 500), midpoint);
});

test('the shuttle and city landmark are merged, bounded and disposable', async (t) => {
  let THREE, createKit;
  try {
    THREE = await import('three');
    ({ createKit } = await import('../../scene/kit.js'));
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return t.skip('three is not installed in this isolated checkout');
    throw error;
  }
  const kit = createKit(), parent = new THREE.Group();
  const shuttle = buildShuttle(kit), landmark = buildUnilagLandmark(kit);
  parent.add(shuttle.group, landmark.group);
  assert.ok(shuttle.triangles > 0 && shuttle.triangles <= 300);
  assert.ok(shuttle.group.children.length <= 3);
  assert.ok(landmark.triangles > 0 && landmark.triangles <= 2000);
  assert.ok(landmark.group.children.length <= 3);
  assert.deepEqual(MAP_PLACEMENT.footprint, { w: 14, d: 10 });
  shuttle.dispose(); landmark.dispose();
  assert.deepEqual([shuttle.group.children.length, landmark.group.children.length, parent.children.length], [0, 0, 0]);
  shuttle.dispose(); landmark.dispose();
  kit.dispose();
});
