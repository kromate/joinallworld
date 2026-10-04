// Walking and the orbit camera: the arithmetic, and the walkable description of every scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from './kit.js';
import { createBatch } from './build.js';
import { createWalkGrid, createWalker, createPositionReporter, footprintRecorder, turnTowards, WALK_SPEED, JOG_SPEED } from './movement.js';
import { createOrbit, followShare, PITCH_MIN, PITCH_MAX } from './camera-controls.js';
import { createMotionLoop } from './motion-loop.js';
import { SCENES, KINDS, WALK, WALK_DEFAULT, SPOT_REACH, buildVenueScene } from './venue-scenes.js';
import { buildHomeScene } from './home-scene.js';
import { sceneVenue } from '../venue-world.js';
import { VENUES } from '../game/content/venues.js';
import { createLife } from '../life.js';

const near = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;
/** Run a walker until it stops; returns the seconds it took. */
function run(walker, yaw = 0, limit = 60) {
  let time = 0;
  while (walker.step(1 / 60, yaw) && time < limit) time += 1 / 60;
  return time;
}

test('a walk grid blocks obstacles grown by the avatar, finds the nearest free place and a path round a wall', () => {
  const grid = createWalkGrid({ bounds: [-5, -5, 5, 5], block: [[-0.5, -5, 0.5, 3], [3, 3, 0.6]], clear: [[-0.5, -1, 0.5, -0.4]] });
  assert.equal(grid.free(-3, 0), true); assert.equal(grid.free(0, 0), false, 'inside the wall');
  assert.equal(grid.free(0.7, 0), false, 'within the avatar’s radius of the wall');
  assert.equal(grid.free(1.3, 0), true); assert.equal(grid.free(3, 3), false, 'inside the circle'); assert.equal(grid.free(0, -0.7), true, 'the cleared gap');
  assert.equal(grid.free(9, 0), false, 'outside the floor'); assert.equal(grid.free(-5.2, 0), false);
  const out = grid.nearest(0, 1);
  assert.ok(out && grid.free(out.x, out.z) && Math.hypot(out.x, out.z - 1) < 1.3, 'the nearest free place is just outside the wall');
  assert.deepEqual(grid.nearest(-3, 0), { x: -3, z: 0 }, 'a free place is its own nearest');
  assert.equal(grid.clearLine(-3, 2, 3, 2), false); assert.equal(grid.clearLine(-3, 4.5, 3, 4.5), true);
  const path = grid.path(-3, 2, 3, 2);
  assert.ok(path.length >= 2, 'the wall is walked around, not through');
  let x = -3, z = 2;
  for (const next of path) { assert.ok(grid.clearLine(x, z, next.x, next.z), 'every leg is clear'); x = next.x; z = next.z; }
  assert.ok(near(x, 3) && near(z, 2), 'the path ends at the target');
  assert.deepEqual(grid.path(-3, 0, -2, 1), [{ x: -2, z: 1 }], 'in clear sight: one straight leg');
  // A target inside an obstacle is approached as closely as the floor allows.
  const beside = grid.path(-3, 0, 0, 0).at(-1);
  assert.ok(grid.free(beside.x, beside.z) && Math.hypot(beside.x, beside.z) < 1.6);
  // A walled-off island: the path ends at the reachable place closest to it.
  const island = createWalkGrid({ bounds: [-5, -5, 5, 5], block: [[1, -5, 1.4, 5]] });
  assert.equal(island.free(3, 0), true);
  const edge = island.path(-3, 0, 3, 0).at(-1);
  assert.ok(edge.x < 1 && edge.x > -0.5, `stops at the wall (${edge.x})`);
  assert.match(grid.ascii({ S: [-3, 2] }), /S/);
});

test('the footprint recorder notes what stands in the way, what is water and where the floor is — and draws the same geometry', () => {
  const plain = createBatch(THREE), recorder = footprintRecorder(createBatch(THREE));
  const draw = (b) => {
    b.box(0, -0.25, 0, 25, 0.5, 21, '#555555');           // base slab
    b.box(0, 0.02, 0, 24, 0.06, 20, '#bbbbbb');           // floor
    b.box(0, 2.75, -10.2, 24.8, 5.5, 0.4, '#dddddd');     // wall
    b.box(4, 0.5, 2, 2, 1, 1, '#885533');                 // counter
    b.box(-4, 0.02, 3, 3, 0.03, 2, '#aa3333');            // rug: walked over
    b.box(0, 3, 4, 6, 0.2, 4, '#3355aa');                 // awning overhead: walked under
    b.cyl(-6, 0.5, -2, 0.5, 1, '#666666');                // pillar
    b.at(7, 0, 5, Math.PI / 2, () => { b.box(0, 0.4, 0, 3, 0.8, 1, '#222222'); }); // a bench turned a quarter
    b.box(0, 0.01, 8, 10, 0.02, 3, '#79c3df', { layer: 'glass' }); // water
    b.disc(2, 0.07, -3, 1, '#ffffff');                    // a flat marker
  };
  draw(plain); draw(recorder.batch);
  assert.equal(recorder.batch.triangles, plain.triangles, 'recording changes nothing that is drawn');
  const { floor, block } = recorder.shapes();
  assert.deepEqual(floor, [-12.5, -10.5, 12.5, 10.5], 'the largest ground slab is the floor');
  const has = (x0, z0, x1, z1) => block.some((rect) => near(rect[0], x0, 0.01) && near(rect[1], z0, 0.01) && near(rect[2], x1, 0.01) && near(rect[3], z1, 0.01));
  assert.ok(has(3, 1.5, 5, 2.5), 'the counter'); assert.ok(has(-12.4, -10.4, 12.4, -10), 'the wall'); assert.ok(has(-6.5, -2.5, -5.5, -1.5), 'the pillar');
  assert.ok(has(6.5, 3.5, 7.5, 6.5), 'a turned bench keeps its true footprint'); assert.ok(has(-5, 6.5, 5, 9.5), 'water on the ground');
  assert.equal(block.length, 5, 'the rug, the awning, the marker and the floor are not obstacles');
});

test('the walker moves relative to the camera, normalises diagonals, jogs, turns to face its way and slides along walls', () => {
  const grid = createWalkGrid({ bounds: [-10, -10, 10, 10], block: [[2, -10, 3, 10]] });
  const walker = createWalker();
  walker.setGrid(grid); walker.place(0, 0, 0);
  // Camera in front (+z), yaw 0: forward is −z, right is +x.
  walker.input(0, 1); for (let i = 0; i < 30; i++) walker.step(1 / 60, 0);
  assert.ok(near(walker.x, 0) && near(walker.z, -WALK_SPEED * 0.5, 1e-3), 'W walks away from the camera');
  assert.ok(Math.abs(turnTowards(walker.ry, Math.PI)) < 0.05, 'the avatar faces where it walks');
  walker.place(0, 0, 0); walker.input(-1, 0); for (let i = 0; i < 30; i++) walker.step(1 / 60, 0);
  assert.ok(walker.x < -2 && near(walker.z, 0), 'A walks to the camera’s left');
  // Camera turned a quarter (it now looks along −x): the same keys follow it.
  walker.place(0, 0, 0); walker.input(0, 1); for (let i = 0; i < 30; i++) walker.step(1 / 60, Math.PI / 2);
  assert.ok(walker.x < -2 && near(walker.z, 0, 1e-6), 'forward is always away from the camera');
  // Diagonals are no faster than straight lines; jogging is.
  walker.place(0, 0, 0); walker.input(-1, 1); for (let i = 0; i < 30; i++) walker.step(1 / 60, 0);
  assert.ok(near(Math.hypot(walker.x, walker.z), WALK_SPEED * 0.5, 1e-3), 'diagonal movement is normalised');
  walker.place(0, 0, 0); walker.input(0, 1, true); for (let i = 0; i < 30; i++) walker.step(1 / 60, 0);
  assert.ok(near(-walker.z, JOG_SPEED * 0.5, 1e-3), 'Shift jogs');
  // Into a wall: stopped. Diagonally into it: slides along.
  walker.place(0, 0, 0); walker.input(1, 0); for (let i = 0; i < 120; i++) walker.step(1 / 60, 0);
  assert.ok(walker.x < 2 && walker.x > 1.2 && walker.blocked, `stopped at the wall (${walker.x.toFixed(2)})`);
  const stuck = walker.x;
  walker.input(1, 1); for (let i = 0; i < 30; i++) walker.step(1 / 60, 0);
  assert.ok(near(walker.x, stuck, 0.2) && walker.z < -1, 'slides along the wall');
  // The edge of the floor is a wall too.
  walker.place(0, 9, 0); walker.input(0, -1); for (let i = 0; i < 120; i++) walker.step(1 / 60, 0);
  assert.ok(walker.z <= 10 && walker.z > 9.5, 'cannot leave the floor');
  // Releasing the keys stops it, and step() says so.
  walker.input(0, 0);
  let steps = 0; while (walker.step(1 / 60, 0) && steps < 100) steps++;
  assert.ok(steps < 30 && !walker.moving && walker.mode === 'idle');
  assert.equal(walker.step(1 / 60, 0), false, 'nothing moves once stopped');
});

test('the walker follows a path, hops to an exact place off the floor, calls arrive once and keys take over', () => {
  const grid = createWalkGrid({ bounds: [-10, -10, 10, 10], block: [[-1, -10, 1, 6], [6, 0, 8, 2]] });
  const walker = createWalker();
  walker.setGrid(grid); walker.place(-5, 0, 0);
  let arrived = 0;
  assert.equal(walker.goTo(5, 0, { arrive: () => { arrived += 1; }, face: 1 }), true);
  assert.equal(walker.mode, 'path'); assert.deepEqual(walker.target, { x: 5, z: 0 });
  let through = false;
  for (let i = 0; i < 1200 && walker.step(1 / 60, 0); i++) if (!grid.free(walker.x, walker.z)) through = true;
  assert.equal(through, false, 'never inside an obstacle on the way');
  assert.ok(near(walker.x, 5) && near(walker.z, 0) && arrived === 1 && !walker.moving);
  assert.ok(near(walker.ry, 1, 0.03), 'takes the facing it was given');
  assert.equal(walker.step(1 / 60, 0), false);
  // A seat inside an obstacle: walk beside it, then hop on; walking away steps back on to the floor first.
  assert.equal(walker.goTo(7, 1, { exact: true, arrive: () => { arrived += 1; } }), true);
  run(walker);
  assert.ok(near(walker.x, 7) && near(walker.z, 1) && arrived === 2 && !grid.free(walker.x, walker.z));
  walker.input(0, -1); for (let i = 0; i < 60; i++) walker.step(1 / 60, 0);
  assert.ok(grid.free(walker.x, walker.z), 'keys walk off the seat on to the floor');
  walker.input(0, 0); run(walker);
  // Keys interrupt a path, and its arrive() is dropped.
  walker.place(-5, 0, 0); walker.goTo(5, 0, { arrive: () => { arrived += 1; } });
  for (let i = 0; i < 10; i++) walker.step(1 / 60, 0);
  walker.input(-1, 0); walker.step(1 / 60, 0);
  assert.equal(walker.mode, 'keys'); walker.input(0, 0); run(walker);
  assert.equal(arrived, 2);
  // A long way is jogged — also while the host keeps reporting "no keys held" every frame — a short one is walked.
  const open = createWalkGrid({ bounds: [-20, -20, 20, 20] });
  const timed = (distance) => { const w = createWalker(); w.setGrid(open); w.place(0, 0, 0); w.goTo(distance, 0); let t = 0; do { w.input(0, 0, false); t += 1 / 60; } while (w.step(1 / 60, 0) && t < 60); return t; };
  assert.ok(Math.abs(timed(4) - 4 / WALK_SPEED) < 0.1, 'four units: walked');
  assert.ok(Math.abs(timed(16) - 16 / JOG_SPEED) < 0.1, 'sixteen units: jogged');
  // Reduced motion / no frame loop: the path is simply finished.
  walker.place(-5, 0, 0); walker.goTo(5, 0, { arrive: () => { arrived += 1; }, face: 2 });
  assert.equal(walker.finishNow(), true);
  assert.deepEqual([walker.x, walker.z, walker.ry, arrived, walker.moving], [5, 0, 2, 3, false]);
  assert.equal(walker.finishNow(), false);
});

test('position reports are rate-limited to three a second and sent only when the avatar moved', () => {
  const sent = [];
  const reporter = createPositionReporter((x, z) => sent.push([x, z]));
  let now = 0;
  for (let i = 0; i < 300; i++) { now = i * (1000 / 60); reporter.report(i * 0.08, 0, now); } // five seconds of walking
  assert.ok(sent.length >= 13 && sent.length <= 16, `${sent.length} moves in five seconds`);
  const before = sent.length;
  for (let i = 0; i < 300; i++) reporter.report(24, 0, now + i * 16);
  assert.ok(sent.length <= before + 1, 'standing still sends nothing more');
  reporter.report(30, 0, now + 6000); reporter.report(30.5, 1, now + 6010);
  assert.equal(reporter.flush(now + 6020), true, 'the last place is sent when the avatar stops');
  assert.deepEqual(sent.at(-1), [30.5, 1]);
  assert.equal(reporter.flush(now + 9000), false);
});

test('orbit conventions: drag right swings left, drag DOWN looks from higher up, zoom dollies in, all clamped', () => {
  const orbit = createOrbit();
  const camera = { position: new THREE.Vector3(), lookAt() {} };
  orbit.setBase([15, 19.8, 25.4]); orbit.setLimits({ near: 5.5 });
  orbit.snap(); orbit.apply(camera);
  assert.ok(near(camera.position.x, 15, 1e-9) && near(camera.position.y, 19.8, 1e-9) && near(camera.position.z, 25.4, 1e-9), 'untouched, the orbit is the scene’s own camera');
  const start = { yaw: orbit.azimuth, pitch: orbit.pitch, distance: orbit.distance };
  orbit.drag(100, 0); orbit.snap();
  assert.ok(orbit.azimuth < start.yaw, 'dragging right swings the camera left: the scene turns with the finger');
  orbit.drag(-100, 0); orbit.drag(0, 60); orbit.snap(); orbit.apply(camera);
  assert.ok(orbit.pitch > start.pitch && camera.position.y > 19.8, 'dragging down raises the camera: more from above');
  orbit.drag(0, -120); orbit.snap(); orbit.apply(camera);
  assert.ok(orbit.pitch < start.pitch && camera.position.y < 19.8, 'dragging up lowers it: along the ground');
  orbit.drag(0, 100000); orbit.snap(); orbit.apply(camera);
  assert.ok(near(orbit.pitch, PITCH_MAX) && PITCH_MAX < Math.PI / 2, 'never past straight down');
  orbit.drag(0, -100000); orbit.snap(); orbit.apply(camera);
  assert.ok(near(orbit.pitch, PITCH_MIN) && camera.position.y > 0.7, 'never under the floor');
  orbit.reset(); orbit.zoomBy(1e6); orbit.snap();
  assert.ok(near(orbit.distance, 5.5, 1e-6), 'closest: near enough for a face');
  orbit.zoomBy(1e-9); orbit.snap();
  assert.ok(orbit.distance > start.distance * 1.3 && orbit.distance < start.distance * 1.45, 'farthest: the whole venue');
  orbit.zoomBy(NaN); orbit.zoomBy(-1);
  // Walled scenes keep the camera on the open side.
  orbit.reset(); orbit.setLimits({ azimuth: [0.05, Math.PI / 2 - 0.05] });
  orbit.drag(-100000, 0); orbit.snap(); assert.ok(near(orbit.azimuth, Math.PI / 2 - 0.05));
  orbit.drag(100000, 0); orbit.snap(); assert.ok(near(orbit.azimuth, 0.05));
  // Easing reaches the goal and then reports that nothing is moving.
  orbit.reset(); orbit.setLimits({}); orbit.snap();
  orbit.drag(40, 30); orbit.zoomBy(2); orbit.follow(3, 1, -2);
  let frames = 0; while (orbit.step(1 / 60) && frames < 600) frames++;
  assert.ok(frames > 5 && frames < 200, `eased over ${frames} frames`);
  assert.equal(orbit.settled, true); assert.equal(orbit.step(1 / 60), false);
  assert.ok(followShare(0.72) < 0.15 && followShare(1) > 0.3 && followShare(1) < 0.4 && followShare(2) === 1, 'the pivot belongs to the avatar as you zoom in');
});

test('the motion loop runs only while tick says so, stops when hidden, and never asks for two callbacks', () => {
  const queue = [], listeners = new Map();
  const doc = { visibilityState: 'visible', addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) };
  let left = 0, ticks = 0, dropped = 0, time = 1000;
  const loop = createMotionLoop(() => { ticks += 1; left -= 1; return left > 0; }, { request: (fn) => { queue.push(fn); return queue.length; }, cancel: () => { queue.length = 0; }, doc, clock: () => time, onHidden: () => { dropped += 1; } });
  const pump = () => { const fns = queue.splice(0); time += 16; fns.forEach((fn) => fn(time)); return fns.length; };
  assert.equal(loop.running, false); assert.equal(queue.length, 0, 'idle: nothing is scheduled');
  left = 3; assert.equal(loop.wake(), true); loop.wake(); loop.wake();
  assert.equal(queue.length, 1, 'one callback however often it is woken');
  while (pump());
  assert.deepEqual([ticks, loop.frames, loop.running, queue.length], [3, 3, false, 0], 'three frames, then it stopped itself');
  assert.equal(pump(), 0);
  left = 100; loop.wake(); pump(); pump();
  doc.visibilityState = 'hidden'; listeners.get('visibilitychange')();
  assert.deepEqual([loop.running, queue.length, dropped], [false, 0, 1], 'hidden: stopped, and held input is dropped');
  assert.equal(loop.wake(), false, 'cannot start while hidden'); assert.equal(queue.length, 0);
  doc.visibilityState = 'visible'; left = 2; loop.wake(); while (pump());
  assert.equal(loop.running, false);
  loop.dispose(); assert.equal(listeners.size, 0);
  assert.equal(createMotionLoop(() => true, { request: undefined, doc: null }).wake(), false, 'no frame callback on this platform: never runs');
});

test('every scene kind has a walkable description; the entrance is free and every landmark can be walked to', () => {
  assert.deepEqual(Object.keys(WALK).sort(), [...KINDS, 'generic'].sort(), 'one description per kind');
  for (const [kind, data] of Object.entries(WALK)) {
    assert.ok(data.bounds.length === 4 && data.bounds[0] < data.bounds[2] && data.bounds[1] < data.bounds[3] && data.entrance.length === 2 && typeof data.open === 'boolean', kind);
  }
  assert.equal(WALK_DEFAULT.bounds, null, 'the default takes its bounds from the floor that was drawn');
  const kit = createKit();
  const report = [];
  for (const kind of [...Object.keys(SCENES)]) {
    const entry = SCENES[kind](kit, { id: kind, label: kind, scene: { kind } });
    const { grid, entrance } = entry.walk;
    assert.ok(grid.free(entrance.x, entrance.z), `${kind}: the entrance is on free floor`);
    let free = 0; for (const cell of grid.cells) if (!cell) free += 1;
    const share = free / grid.cells.length;
    assert.ok(share > 0.45 && share < 0.97, `${kind}: ${Math.round(share * 100)}% of the floor is walkable — obstacles exist, and so does room to walk`);
    for (const [key, anchor] of Object.entries(entry.anchors)) {
      const path = grid.path(entrance.x, entrance.z, anchor.x, anchor.z);
      assert.ok(path, `${kind}.${key}: a path exists`);
      const end = path.at(-1) || entrance;
      const gap = Math.hypot(end.x - anchor.x, end.z - anchor.z);
      // A spot on a stage, a seat or behind a counter is finished with a short hop; it is never far from the floor.
      assert.ok(gap < 4.2, `${kind}.${key}: the floor comes within ${gap.toFixed(1)} of the spot`);
    }
    assert.ok(entry.walk.heightAt(entrance.x, entrance.z) === 0, `${kind}: the entrance is on the ground`);
    report.push(kind);
    entry.dispose();
  }
  assert.ok(report.length >= 23);
  // A kind nobody described still gets a floor: bounds from what was drawn.
  const unknown = buildVenueScene(kit, { id: 'x', scene: { kind: 'no-such-kind' } });
  assert.ok(unknown.walk.grid.free(unknown.walk.entrance.x, unknown.walk.entrance.z));
  kit.dispose();
});

test('a venue scene moves its avatar by transform only: no geometry is built while it walks', () => {
  const kit = createKit();
  const live = new Set(), setIndex = THREE.BufferGeometry.prototype.setIndex;
  let made = 0;
  THREE.BufferGeometry.prototype.setIndex = function tracked(...args) { if (!live.has(this)) { live.add(this); made += 1; } return setIndex.apply(this, args); };
  try {
    const entry = buildVenueScene(kit, sceneVenue('park'));
    const { walk } = entry;
    const spots = walk.spots();
    assert.deepEqual(spots.map((spot) => spot.id), sceneVenue('park').scene.spots.map((spot) => spot.id));
    assert.ok(spots.every((spot) => Number.isFinite(spot.x) && Number.isFinite(spot.z)));
    // Undriven, the scene stands the avatar at its spot by itself (what every other caller relies on).
    const rest = walk.rest();
    assert.deepEqual([walk.avatar.position.x, walk.avatar.position.z], [rest.x, rest.z]);
    walk.drive(true);
    const before = made, tag = entry.tags()[0];
    for (let i = 0; i < 200; i++) { walk.move(i * 0.05, 0, 1, i * 0.01); walk.gait(i % 2 === 0); walk.near(spots[i % spots.length]); walk.goal(i * 0.05, 2); }
    walk.pose('stand'); walk.near(null); walk.goal();
    assert.equal(made, before, 'two hundred steps: not one geometry');
    assert.deepEqual([walk.avatar.position.x, walk.avatar.position.z], [199 * 0.05, 1]);
    assert.equal(entry.tags()[0], tag, 'the name tag is the same object, moved in place');
    assert.deepEqual([tag.position.x, tag.position.z], [199 * 0.05, 1]);
    // Driven, a state change no longer teleports the avatar — it only says where it should be.
    assert.equal(entry.update({ location: 'park', spot: spots[2].id }), true);
    assert.deepEqual([walk.avatar.position.x, walk.avatar.position.z], [199 * 0.05, 1]);
    assert.deepEqual([walk.rest().spot, walk.rest().x, walk.rest().z], [spots[2].id, spots[2].x, spots[2].z]);
    assert.equal(entry.update({ location: 'park', spot: spots[2].id, activeAction: { kind: 'activity', id: 'chill' } }), true);
    assert.equal(walk.rest().busy, true); assert.equal(walk.rest().pose, 'sit');
    assert.equal(entry.update({ location: 'park', spot: spots[2].id, activeAction: { kind: 'travel', id: 'home' } }), true);
    assert.deepEqual([walk.rest().busy, walk.rest().leaving], [false, true]);
    assert.ok(SPOT_REACH > 1 && SPOT_REACH < 2);
    entry.dispose();
  } finally { THREE.BufferGeometry.prototype.setIndex = setIndex; }
  kit.dispose();
});

test('the home room’s walkable description comes from state.home.items: furniture blocks, rugs do not', () => {
  const kit = createKit();
  const home = buildHomeScene(kit);
  const state = createLife({ location: 'home', name: 'Ada' }, { now: Date.UTC(2026, 0, 5, 11), cityId: 'lagos' });
  home.update(state);
  const { grid, entrance } = home.walk;
  assert.ok(grid.free(entrance.x, entrance.z), 'the doorway is free');
  assert.ok(state.home.items.length > 0, 'a new life starts with furniture');
  let blocked = 0;
  for (const cell of grid.cells) if (cell) blocked += 1;
  assert.ok(blocked > 0, 'furniture blocks part of the floor');
  assert.equal(grid.free(-5.4, 0), false, 'the wall'); assert.equal(grid.free(5.4, 0), false, 'the open edge of the room');
  // Emptying the room frees the floor; the grid is rebuilt only because the furniture changed.
  const same = home.walk.grid;
  home.update({ ...state, t: state.t + 1000 });
  assert.equal(home.walk.grid, same, 'unchanged furniture: the same grid');
  home.update({ ...state, home: { ...state.home, items: [] } });
  assert.notEqual(home.walk.grid, same);
  assert.equal(home.walk.grid.cells.some((cell) => cell), false, 'an empty room is all floor');
  assert.equal(home.walk.open, false, 'two walls: the camera stays on the open side');
  assert.equal(home.placing, false);
  home.dispose();
  kit.dispose();
});

test('every venue of the game can be entered and crossed', () => {
  const kit = createKit();
  for (const venue of Object.values(VENUES)) {
    // The UNILAG campus is drawn by its own host (src/campus/unilag/host.ts behind world-adapter.js) and has its own scene, walk and budget tests there.
    if (venue.scene.kind === 'home' || venue.scene.kind === 'unilag') continue;
    const entry = buildVenueScene(kit, sceneVenue(venue.id));
    const walker = createWalker();
    walker.setGrid(entry.walk.grid); walker.place(entry.walk.entrance.x, entry.walk.entrance.z, Math.PI);
    for (const spot of entry.walk.spots()) {
      assert.equal(walker.goTo(spot.x, spot.z, { exact: true, face: spot.ry }), true, `${venue.id}.${spot.id}`);
      const seconds = run(walker);
      assert.ok(near(walker.x, spot.x, 1e-6) && near(walker.z, spot.z, 1e-6), `${venue.id}.${spot.id}: arrived`);
      assert.ok(seconds < 14, `${venue.id}.${spot.id}: ${seconds.toFixed(1)} s`);
    }
    entry.dispose();
  }
  kit.dispose();
});
