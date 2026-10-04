// Battery rule: a venue scene renders on demand only — an idle scene does zero renders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as THREE from 'three';
import { createVenueWorld, HOST_LIGHTING } from './venue-world.js';
import { LIGHTING, MAX_CROWD } from './scene/venue-scenes.js';
import { createLife } from './life.js';

function stubRenderer() {
  const calls = { render: 0 };
  return { calls, shadowMap: {}, domElement: { remove() {} }, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() { calls.render += 1; } };
}
const container = { appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844 }) };

test('idle venue performs zero renders; each change draws exactly one frame', async () => {
  let frames = 0, timers = 0;
  const original = { raf: globalThis.requestAnimationFrame, interval: globalThis.setInterval };
  globalThis.requestAnimationFrame = () => { frames += 1; return 0; };
  globalThis.setInterval = (...args) => { timers += 1; return original.interval(...args); };
  try {
    const renderer = stubRenderer();
    const world = createVenueWorld(container, { location: 'park', renderer });
    const afterCreate = world.diagnostics().renderCount;
    assert.equal(afterCreate, 1, 'one frame to show the first venue');
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(world.diagnostics().renderCount, afterCreate, 'no renders while idle');
    assert.equal(renderer.calls.render, afterCreate);
    assert.equal(frames, 0, 'no requestAnimationFrame'); assert.equal(timers, 0, 'no interval timers');
    world.setLocation('park'); assert.equal(world.diagnostics().renderCount, afterCreate, 'same venue: nothing to draw');
    world.setState({ location: 'park' }); assert.equal(world.diagnostics().renderCount, afterCreate, 'static scene ignores state');
    world.setLocation('home'); assert.equal(world.diagnostics().renderCount, afterCreate + 1);
    world.setLocation('library'); world.setLocation('park'); assert.equal(world.diagnostics().renderCount, afterCreate + 3);
    world.resize(); world.update(); assert.equal(world.diagnostics().renderCount, afterCreate + 5);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(world.diagnostics().renderCount, afterCreate + 5); assert.equal(frames, 0);
    world.dispose();
  } finally { globalThis.requestAnimationFrame = original.raf; globalThis.setInterval = original.interval; }
});

const NOON = Date.UTC(2026, 0, 5, 11), MIDNIGHT = Date.UTC(2026, 0, 5, 23, 30);
const PLAYER = '11111111-2222-4333-8444-555555555555';
const people = (count) => Array.from({ length: count }, (_, i) => (i % 2 ? { id: `npc:n${i}`, name: `Local ${i}`, kind: 'npc', seed: `n${i}` } : { id: `0000000${i}-2222-4333-8444-555555555555`, name: `Player ${i}`, kind: 'player', seed: `p${i}` }));

test('an idle venue with a crowd renders zero frames; the crowd, the player and the lighting each cost one frame when they change', async () => {
  let frames = 0, timers = 0;
  const original = { raf: globalThis.requestAnimationFrame, interval: globalThis.setInterval };
  globalThis.requestAnimationFrame = () => { frames += 1; return 0; };
  globalThis.setInterval = (...args) => { timers += 1; return original.interval(...args); };
  try {
    const renderer = stubRenderer();
    const world = createVenueWorld(container, { location: 'park', renderer });
    const count = () => world.diagnostics().renderCount;
    assert.equal(count(), 1);
    assert.deepEqual(world.diagnostics().lighting, { hemi: LIGHTING.outdoor.day.hemi[2], sun: LIGHTING.outdoor.day.sun[1], sky: '#e6f3ff' }, 'the host applied the scene’s own lighting preset');
    world.setPlayer({ look: { body: 'woman', hair: 'afro' }, seed: PLAYER, name: 'Ada' });
    assert.equal(count(), 2, 'the avatar changed: one frame');
    world.setPlayer({ look: { body: 'woman', hair: 'afro' }, seed: PLAYER, name: 'Ada' });
    assert.equal(count(), 2, 'the same player again: nothing to draw');
    assert.equal(world.setCrowd(people(4)), true);
    assert.equal(count(), 3, 'a crowd arrived: one frame');
    const tags = world.diagnostics().tags;
    assert.deepEqual(tags.map((tag) => [tag.kind, tag.marker]), [['self', 'crown'], ['player', 'tag'], ['npc', 'dot'], ['player', 'tag'], ['npc', 'dot']]);
    assert.deepEqual([tags[0].text, tags[1].text, tags[2].name], ['Ada', '@Player 0', 'Local 1']);
    assert.ok(tags.every((tag) => Number.isFinite(tag.x) && Number.isFinite(tag.y)), 'every tag has a screen position');
    assert.ok(tags.filter((tag) => tag.visible).length >= 4, 'tags are projected inside the 390 × 844 view');
    // Idle with a crowd on screen: no frames, no timers, however long we wait and however often the same data arrives.
    for (let i = 0; i < 25; i++) { assert.equal(world.setCrowd(people(4)), false); world.setState({ location: 'park', spot: 'amphitheatre', t: NOON + i * 1000, name: 'Ada' }); }
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(count(), 3, 'idle with a crowd: zero renders');
    assert.equal(renderer.calls.render, 3); assert.equal(frames, 0); assert.equal(timers, 0);
    // The crowd is capped, and a changed crowd costs exactly one frame.
    assert.equal(world.setCrowd(people(40)), true);
    assert.equal(count(), 4); assert.equal(world.diagnostics().tags.length, MAX_CROWD + 1); assert.equal(world.diagnostics().crowd, MAX_CROWD);
    world.setCrowd([]); assert.equal(count(), 5); assert.equal(world.diagnostics().tags.length, 1);
    // Night falls: the scene reports a change, and the host re-reads its lighting and background.
    const day = world.diagnostics().background;
    world.setState({ location: 'park', spot: 'amphitheatre', t: MIDNIGHT, name: 'Ada' });
    assert.equal(count(), 6);
    assert.equal(world.diagnostics().lighting.hemi, LIGHTING.outdoor.night.hemi[2]);
    assert.notEqual(world.diagnostics().background, day); assert.equal(world.diagnostics().background, LIGHTING.outdoor.night.sky[0]);
    // Tags are re-projected with the frame a resize draws — nothing else moves them.
    const before = world.diagnostics().tags[0];
    container.getBoundingClientRect = () => ({ width: 1280, height: 800 });
    assert.deepEqual(world.diagnostics().tags[0], before, 'a resize that has not been drawn yet moves nothing');
    world.resize();
    assert.equal(count(), 7); assert.notDeepEqual([world.diagnostics().tags[0].x, world.diagnostics().tags[0].y], [before.x, before.y]);
    container.getBoundingClientRect = () => ({ width: 390, height: 844 });
    world.dispose();
  } finally { globalThis.requestAnimationFrame = original.raf; globalThis.setInterval = original.interval; }
});

test('leaving a venue disposes its scene; home shows the player’s avatar and guests under the host’s default lighting', () => {
  const live = new Set(), setIndex = THREE.BufferGeometry.prototype.setIndex;
  THREE.BufferGeometry.prototype.setIndex = function tracked(...args) {
    if (!live.has(this)) { live.add(this); this.addEventListener('dispose', () => live.delete(this)); }
    return setIndex.apply(this, args);
  };
  try {
    const renderer = stubRenderer();
    const world = createVenueWorld(container, { location: 'park', renderer });
    world.setPlayer({ seed: PLAYER, name: 'Ada' });
    world.setCrowd(people(3));
    const inPark = live.size;
    assert.ok(inPark > 3);
    world.setLocation('market');
    assert.equal(world.diagnostics().scenes, 1, 'the park scene was disposed, not kept hidden');
    assert.equal(world.diagnostics().tags.length, 4, 'the player and the crowd carry over to the next venue');
    world.setLocation('park');
    assert.equal(live.size, inPark, 'coming back rebuilds the same geometry and nothing has leaked');
    const state = createLife({ location: 'home', spot: 'kitchen', name: 'Ada' }, { now: NOON, cityId: 'lagos' });
    world.setLocation('home');
    world.setState(state);
    assert.deepEqual([world.diagnostics().lighting.hemi, world.diagnostics().lighting.sun], [HOST_LIGHTING.hemi[2], HOST_LIGHTING.sun[1]], 'a scene without lighting() gets the host defaults back');
    world.setCrowd([{ id: '00000009-2222-4333-8444-555555555555', name: 'Guest', kind: 'player' }]);
    assert.deepEqual(world.diagnostics().tags.map((tag) => [tag.kind, tag.text]), [['self', 'Ada'], ['player', '@Guest']], 'you and your guest stand in your home');
    const drawn = world.diagnostics().renderCount;
    world.setState(state); world.setCrowd([{ id: '00000009-2222-4333-8444-555555555555', name: 'Guest', kind: 'player' }]);
    assert.equal(world.diagnostics().renderCount, drawn, 'home is idle too');
    world.setState({ ...state, spot: 'bedroom' });
    assert.equal(world.diagnostics().renderCount, drawn + 1, 'walking to the bed: one frame');
    world.dispose();
    assert.equal(live.size, 0, 'the host disposes every scene it still holds');
  } finally { THREE.BufferGeometry.prototype.setIndex = setIndex; }
});

test('HUD insets re-centre the scene with one frame per change, never by themselves, and keep name tags on the canvas', () => {
  const renderer = stubRenderer();
  const world = createVenueWorld(container, { location: 'park', renderer });
  const drawn = world.diagnostics().renderCount;
  assert.equal(world.setInsets({ top: 0, bottom: 0 }), false, 'no insets: nothing changes');
  assert.equal(world.diagnostics().renderCount, drawn);
  assert.equal(world.setInsets({ top: 104, bottom: 300 }), true);
  assert.equal(world.diagnostics().renderCount, drawn + 1, 'a new HUD size draws exactly one frame');
  assert.equal(world.setInsets({ top: 106, bottom: 298 }), false, 'a change of a few pixels is not a new layout');
  assert.equal(world.setInsets({ top: 104, bottom: 300 }), false, 'the same insets again draw nothing');
  assert.equal(world.diagnostics().renderCount, drawn + 1);
  world.setPlayer({ look: null, seed: 'p1', name: 'Ada' });
  const before = world.diagnostics().tags.find(tag => tag.kind === 'self');
  assert.ok(before, 'the player has a tag');
  world.setInsets({ top: 104, bottom: 520 });
  const after = world.diagnostics().tags.find(tag => tag.kind === 'self');
  assert.ok(after.y < before.y, 'a taller bottom panel moves the scene (and its tags) up');
  assert.ok(after.x === before.x, 'and never sideways');
  world.setInsets({ top: 0, bottom: 0 });
  world.dispose();
});

test('only the motion loop may name a frame callback; no scene, map or shell source holds an interval', async () => {
  const files = ['src/venue-world.js', 'src/world-map.js', 'src/city-map.js', 'src/ui/shell.js', 'src/life-main.js', 'src/client.js',
    ...(await readdir('src/scene')).map(name => `src/scene/${name}`), ...(await readdir('src/ui/panels')).filter(name => name.endsWith('.js')).map(name => `src/ui/panels/${name}`)];
  const withLoop = [];
  for (const file of files) {
    if (file.endsWith('.test.js')) continue;
    const code = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /setAnimationLoop|setInterval/, file);
    if (/requestAnimationFrame/.test(code)) withLoop.push(file);
  }
  assert.deepEqual(withLoop, ['src/scene/motion-loop.js'], 'the one frame loop lives in one file, and that file cannot idle');
});

// ---- motion: frames only while something moves ------------------------------------------------

/** A browser's frame callback, a window and a document, all driven by hand. */
function motionBench({ width = 1280, height = 800, location = 'park' } = {}) {
  const original = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, window: globalThis.window, document: globalThis.document, matchMedia: globalThis.matchMedia };
  let queue = [], time = 5000, reduce = false;
  const docListeners = new Map();
  globalThis.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };
  globalThis.cancelAnimationFrame = () => { queue = []; };
  globalThis.window = new EventTarget();
  globalThis.document = { visibilityState: 'visible', addEventListener: (type, fn) => docListeners.set(type, fn), removeEventListener: (type) => docListeners.delete(type) };
  globalThis.matchMedia = (query) => ({ matches: reduce && /reduced-motion/.test(query) });
  const listeners = new Map();
  const canvas = { style: {}, addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, setPointerCapture() {}, releasePointerCapture() {}, remove() {} };
  const renderer = { calls: 0, shadowMap: {}, domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() { this.calls += 1; } };
  const spots = [], tagged = [], moves = [];
  const world = createVenueWorld({ appendChild() {}, getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }) }, { location, renderer, onSpot: (spot) => spots.push(spot), onTag: (tag) => tagged.push(tag), onMove: (at) => moves.push(at) });
  return {
    world, renderer, spots, tagged, moves, listeners,
    /** Run up to `count` frames 16 ms apart; returns how many ran (fewer when the loop stopped itself). */
    pump(count = 1) { let ran = 0; for (let i = 0; i < count; i++) { const fns = queue; queue = []; if (!fns.length) break; time += 16; fns.forEach((fn) => fn(time)); ran += 1; } return ran; },
    queued: () => queue.length,
    key: (action, mode = 'venue', jog = false) => globalThis.window.dispatchEvent(new CustomEvent('jaw:key', { detail: { action, mode, jog } })),
    keyUp: (action) => globalThis.window.dispatchEvent(new CustomEvent('jaw:key-up', { detail: { action } })),
    send: (type, props = {}) => listeners.get(type)?.({ pointerId: 1, button: 0, detail: 1, clientX: 0, clientY: 0, preventDefault() {}, stopImmediatePropagation() {}, ...props }),
    hide(hidden) { globalThis.document.visibilityState = hidden ? 'hidden' : 'visible'; docListeners.get('visibilitychange')?.(); },
    reduceMotion(on) { reduce = on; },
    restore() { world.dispose(); globalThis.requestAnimationFrame = original.raf; globalThis.cancelAnimationFrame = original.caf; globalThis.window = original.window; globalThis.document = original.document; globalThis.matchMedia = original.matchMedia; },
  };
}
const PARK = { location: 'park', spot: 'amphitheatre', t: NOON, name: 'Ada' };

test('RELEASE GATE: idle → zero frames; walking → frames; after arrival → flat again; tab hidden → the loop stops', async () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    const idle = world.diagnostics();
    assert.deepEqual([idle.loop.running, idle.loop.frames, bench.queued()], [false, 0, 0], 'idle: no loop, nothing scheduled');
    assert.equal(idle.avatar.moving, false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(bench.pump(50), 0, 'idle: pumping the browser runs nothing');
    assert.equal(world.diagnostics().renderCount, idle.renderCount, 'idle: zero frames');

    // A key is held: frames, one render each, and the avatar moves away from the camera.
    bench.key('walk-up');
    assert.equal(world.diagnostics().loop.running, true);
    assert.equal(bench.pump(30), 30, 'walking: a frame every tick');
    const walking = world.diagnostics();
    assert.equal(walking.renderCount, idle.renderCount + 30, 'walking: exactly one render per frame');
    assert.ok(walking.avatar.moving && walking.avatar.mode === 'keys');
    assert.ok(walking.avatar.z < idle.avatar.z - 1.5, `W moved the avatar away from the camera (${idle.avatar.z} → ${walking.avatar.z})`);
    // Released: the avatar stops, the camera finishes easing after it, and the loop ends by itself.
    bench.keyUp('walk-up');
    const tail = bench.pump(400);
    assert.ok(tail > 0 && tail < 150, `the loop stopped itself ${tail} frames after the key was released`);
    const stopped = world.diagnostics();
    assert.deepEqual([stopped.loop.running, stopped.avatar.moving, bench.queued()], [false, false, 0]);
    await new Promise((resolve) => setTimeout(resolve, 800)); // past the dwell timer
    assert.equal(bench.pump(50), 0);
    assert.equal(world.diagnostics().renderCount, stopped.renderCount, 'after the key is released: flat again');

    // Sent to a place on the floor: frames until it arrives, then flat.
    assert.equal(world.walkTo(6, 4), true);
    assert.equal(world.diagnostics().avatar.mode, 'path');
    const walked = bench.pump(2000);
    const arrived = world.diagnostics();
    assert.ok(walked > 20 && walked < 600, `${walked} frames to get there`);
    assert.ok(Math.hypot(arrived.avatar.x - 6, arrived.avatar.z - 4) < 0.45, `arrived at (${arrived.avatar.x}, ${arrived.avatar.z})`);
    assert.deepEqual([arrived.loop.running, arrived.avatar.moving, bench.queued()], [false, false, 0]);
    assert.equal(arrived.renderCount, stopped.renderCount + walked);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(bench.pump(50), 0);
    assert.equal(world.diagnostics().renderCount, arrived.renderCount, 'after arrival: flat again');
    // The same state arriving every second changes nothing.
    for (let i = 1; i <= 10; i++) world.setState({ ...PARK, t: NOON + i * 1000 });
    assert.equal(world.diagnostics().renderCount, arrived.renderCount); assert.equal(bench.queued(), 0);

    // Tab hidden mid-walk: the loop stops at once and the held key is dropped.
    bench.key('walk-left'); bench.pump(5);
    assert.equal(world.diagnostics().loop.running, true);
    bench.hide(true);
    const hidden = world.diagnostics();
    assert.deepEqual([hidden.loop.running, bench.queued()], [false, 0], 'hidden: stopped, nothing scheduled');
    bench.key('walk-left');
    assert.equal(bench.queued(), 0, 'hidden: a key cannot start it');
    assert.equal(bench.pump(50), 0); assert.equal(world.diagnostics().renderCount, hidden.renderCount);
    bench.hide(false);
    assert.equal(bench.queued(), 0, 'visible again: nothing runs until the player does something');
    bench.key('walk-left'); assert.equal(bench.pump(3), 3);
    bench.keyUp('walk-left'); bench.pump(400);
    assert.equal(world.diagnostics().loop.running, false);
    // Hidden in the middle of a walk to a target: stopped while hidden, and the walk carries on when the tab is back.
    world.walkTo(-6, 6); bench.pump(5);
    bench.hide(true);
    assert.deepEqual([world.diagnostics().loop.running, bench.queued()], [false, 0]);
    const paused = world.diagnostics();
    assert.equal(bench.pump(50), 0); assert.equal(world.diagnostics().renderCount, paused.renderCount);
    bench.hide(false);
    assert.equal(bench.queued(), 1, 'a walk that was cut short resumes');
    bench.pump(3000);
    const resumed = world.diagnostics();
    assert.ok(Math.hypot(resumed.avatar.x + 6, resumed.avatar.z - 6) < 0.45 && !resumed.loop.running && bench.queued() === 0);
  } finally { bench.restore(); }
});

test('camera: drag eases and stops; zoom keys and wheel dolly towards the avatar; recentre restores; keys elsewhere do nothing', () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    const start = world.diagnostics();
    // Drag down: the camera rises (more from above). It eases over a few frames, then the loop stops.
    bench.send('pointerdown', { clientX: 400, clientY: 300 }); bench.send('pointermove', { clientX: 400, clientY: 380 }); bench.send('pointerup', { clientX: 400, clientY: 380 });
    const eased = bench.pump(400);
    assert.ok(eased > 3 && eased < 120, `eased over ${eased} frames`);
    const above = world.diagnostics();
    assert.ok(above.camera.pitch > start.camera.pitch + 0.3, 'dragging down looks from higher up');
    assert.equal(above.camera.yaw, start.camera.yaw, 'a vertical drag does not turn the scene');
    assert.deepEqual([above.loop.running, bench.queued()], [false, 0]);
    bench.send('pointerdown', { clientX: 400, clientY: 300 }); bench.send('pointermove', { clientX: 400, clientY: 100 }); bench.send('pointerup', { clientX: 400, clientY: 100 });
    bench.pump(400);
    assert.ok(world.diagnostics().camera.pitch < start.camera.pitch, 'dragging up looks along the ground');
    bench.send('pointerdown', { clientX: 400, clientY: 300 }); bench.send('pointermove', { clientX: 500, clientY: 300 }); bench.send('pointerup', { clientX: 500, clientY: 300 });
    bench.pump(400);
    assert.ok(world.diagnostics().camera.yaw < start.camera.yaw, 'dragging right swings the camera left (unchanged)');
    // Zoom: keys, wheel and trackpad pinch (ctrl+wheel) all dolly; bounded both ways.
    bench.key('zoom-in'); bench.pump(400);
    assert.ok(world.diagnostics().camera.distance < start.camera.distance);
    for (let i = 0; i < 60; i++) bench.send('wheel', { deltaY: -400, deltaMode: 0 });
    bench.pump(600);
    const close = world.diagnostics();
    assert.ok(Math.abs(close.camera.distance - 6.2) < 0.01, `closest ${close.camera.distance}: a face fills the view`);
    assert.equal(close.loop.running, false);
    for (let i = 0; i < 60; i++) bench.send('wheel', { deltaY: 40, deltaMode: 0, ctrlKey: true });
    bench.pump(600);
    const far = world.diagnostics();
    assert.ok(far.camera.distance > start.camera.distance * 1.3 && far.camera.zoom === far.camera.limits.zoom[0], `farthest ${far.camera.distance}: the whole venue`);
    bench.send('wheel', { deltaY: 40, deltaMode: 0 });
    assert.equal(bench.queued(), 0, 'at the limit a wheel tick changes nothing and draws nothing');
    // Two-finger pinch.
    bench.send('pointerdown', { pointerId: 1, clientX: 300, clientY: 300 }); bench.send('pointerdown', { pointerId: 2, clientX: 400, clientY: 300 });
    bench.send('pointermove', { pointerId: 2, clientX: 600, clientY: 300 });
    bench.send('pointercancel', { pointerId: 2 }); bench.send('pointercancel', { pointerId: 1 });
    bench.pump(600);
    assert.ok(world.diagnostics().camera.distance < far.camera.distance / 2, 'spreading two fingers zooms in');
    // Recentre (0, or the on-screen button).
    bench.key('zoom-fit'); bench.pump(600);
    const home = world.diagnostics().camera;
    assert.deepEqual([home.yaw, home.pitch, home.zoom], [start.camera.yaw, start.camera.pitch, 1]);
    // Camera keys: held to swing and tilt; released, the loop ends.
    bench.key('look-up'); bench.pump(20); bench.keyUp('look-up');
    bench.key('look-right'); bench.pump(20); bench.keyUp('look-right'); bench.pump(400);
    const looked = world.diagnostics();
    assert.ok(looked.camera.pitch > start.camera.pitch && looked.camera.yaw > start.camera.yaw);
    assert.deepEqual([looked.loop.running, bench.queued()], [false, 0]);
    // On the map and under a sheet the scene hears nothing; in Buy mode only the zoom keys.
    const before = world.diagnostics();
    for (const mode of ['map', 'sheet']) for (const action of ['walk-up', 'move-left', 'zoom-in', 'look-left', 'zoom-fit']) bench.key(action, mode);
    bench.key('walk-up', 'buy'); bench.key('move-up', 'buy');
    assert.equal(bench.queued(), 0);
    assert.deepEqual(world.diagnostics().avatar, before.avatar);
    bench.key('zoom-in', 'buy'); assert.equal(bench.queued(), 1); bench.pump(400);
  } finally { bench.restore(); }
});

test('arrows and W A S D walk in the camera’s frame; walls and furniture stop the avatar; Shift jogs', () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    const hold = (action, frames = 10, jog = false) => { const from = world.diagnostics().avatar; bench.key(action, 'venue', jog); bench.pump(frames); bench.keyUp(action); bench.pump(400); const to = world.diagnostics().avatar; return { dx: to.x - from.x, dz: to.z - from.z, facing: to.facing, from, to }; };
    // The park camera looks from the front right (+x, +z): away is −x −z, the camera's right is +x −z.
    const yaw = world.diagnostics().camera.yaw;
    const away = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
    const along = (move, axis) => move.dx * axis[0] + move.dz * axis[1];
    for (const [action, axis, sign] of [['walk-up', away, 1], ['move-up', away, 1], ['walk-down', away, -1], ['move-down', away, -1], ['walk-right', right, 1], ['move-right', right, 1], ['walk-left', right, -1], ['move-left', right, -1]]) {
      world.walkTo(6, 4); bench.pump(2000);
      const move = hold(action);
      const forward = along(move, axis) * sign, sideways = Math.abs(along(move, axis === away ? right : away));
      assert.ok(forward > 0.6 && sideways < 0.05, `${action}: ${forward.toFixed(2)} the right way, ${sideways.toFixed(2)} sideways`);
      const heading = Math.atan2(move.dx, move.dz);
      assert.ok(Math.abs(Math.atan2(Math.sin(move.facing - heading), Math.cos(move.facing - heading))) < 0.05, `${action}: the avatar faces where it went`);
    }
    world.walkTo(6, 4); bench.pump(2000);
    const walk = hold('walk-up');
    world.walkTo(6, 4); bench.pump(2000);
    const jog = hold('walk-up', 10, true);
    assert.ok(Math.hypot(jog.dx, jog.dz) > Math.hypot(walk.dx, walk.dz) * 1.5, 'Shift jogs');
    // Rotate the camera: the same key follows the camera.
    bench.send('pointerdown', { clientX: 400, clientY: 300 }); bench.send('pointermove', { clientX: 150, clientY: 300 }); bench.send('pointerup', {});
    bench.pump(400);
    const turned = world.diagnostics().camera.yaw;
    assert.ok(turned > yaw + 1);
    world.walkTo(6, 4); bench.pump(2000);
    const after = hold('walk-up');
    assert.ok(along(after, [-Math.sin(turned), -Math.cos(turned)]) > 0.6, 'W is still away from the camera after turning it');
    // The fountain (centre of the park, at 0, 2.4): walking straight at it stops short of it.
    bench.key('zoom-fit'); bench.pump(600);
    world.walkTo(0, 2.4); bench.pump(2000);
    const atFountain = world.diagnostics().avatar;
    assert.ok(Math.hypot(atFountain.x, atFountain.z - 2.4) > 1.5, `the fountain is solid: stopped ${Math.hypot(atFountain.x, atFountain.z - 2.4).toFixed(2)} from its centre`);
    // The edge of the park: holding a key against it goes nowhere and reports blocked.
    world.walkTo(13.9, 11.9); bench.pump(3000);
    const corner = world.diagnostics().avatar;
    bench.key('walk-down'); bench.key('walk-right'); bench.pump(120);
    const pushed = world.diagnostics().avatar;
    assert.ok(pushed.x <= 14.2 && pushed.z <= 12.2 && Math.hypot(pushed.x - corner.x, pushed.z - corner.z) < 0.8, 'the edge of the floor is a wall');
    assert.equal(pushed.blocked, true);
    bench.keyUp('walk-down'); bench.keyUp('walk-right'); bench.pump(400);
    assert.equal(world.diagnostics().loop.running, false);
  } finally { bench.restore(); }
});

test('spots and walking stay coherent: taps walk first, the panel walks instead of teleporting, dwell selects once, activities lock', async () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    world.setCrowd([{ id: 'npc:n1', name: 'Mama', kind: 'npc', seed: 'n1', spot: 'drinks' }]);
    const spot = (id) => world.diagnostics().spots.find((item) => item.id === id);
    const spawn = world.diagnostics().avatar;
    assert.ok(spawn.z > 10 && Math.abs(spawn.x) < 1, 'the avatar appears at the entrance, not at the selected spot');
    assert.equal(spot('amphitheatre').selected, true);

    // Tap a spot's marker: walk there, and only on arrival ask for the spot (open = show its activities).
    const art = spot('art');
    bench.send('pointerdown', { clientX: art.px, clientY: art.py }); bench.send('pointerup', { clientX: art.px, clientY: art.py });
    bench.send('click', { clientX: art.px, clientY: art.py });
    assert.equal(bench.spots.length, 0, 'nothing is sent before the avatar gets there');
    assert.equal(world.diagnostics().avatar.mode, 'path');
    bench.pump(3000);
    assert.deepEqual(bench.spots, [{ id: 'art', open: true }]);
    assert.ok(Math.hypot(world.diagnostics().avatar.x - art.x, world.diagnostics().avatar.z - art.z) < 0.01, 'standing on the spot');
    world.setState({ ...PARK, spot: 'art' }); // the server accepted it
    assert.equal(bench.queued(), 0, 'already there: the accepted spot moves nothing');
    assert.equal(spot('art').selected, true);

    // A drag is not a tap.
    const drinks = spot('drinks');
    bench.send('pointerdown', { clientX: drinks.px, clientY: drinks.py }); bench.send('pointermove', { clientX: drinks.px + 40, clientY: drinks.py }); bench.send('pointerup', { clientX: drinks.px + 40, clientY: drinks.py });
    let swallowed = false;
    bench.send('click', { clientX: drinks.px + 40, clientY: drinks.py, stopImmediatePropagation() { swallowed = true; } });
    bench.pump(600);
    assert.equal(swallowed, true); assert.equal(world.diagnostics().avatar.mode, 'idle', 'the click after a drag walks nowhere');
    assert.equal(bench.spots.length, 1);
    bench.key('zoom-fit'); bench.pump(600);

    // Chosen in the panel (the server state changes): the avatar walks there instead of jumping.
    const from = world.diagnostics().avatar;
    world.setState({ ...PARK, spot: 'work' });
    const first = world.diagnostics().avatar;
    assert.deepEqual([first.x, first.z], [from.x, from.z], 'not teleported');
    assert.equal(first.mode, 'path');
    bench.pump(5);
    const moving = world.diagnostics().avatar, work = spot('work');
    assert.ok(Math.hypot(moving.x - from.x, moving.z - from.z) > 0.1 && Math.hypot(moving.x - work.x, moving.z - work.z) > 1, 'on its way');
    bench.pump(3000);
    assert.ok(Math.hypot(world.diagnostics().avatar.x - work.x, world.diagnostics().avatar.z - work.z) < 0.01);
    assert.equal(bench.spots.length, 1, 'a spot chosen in the panel is not asked for again');

    // Wandering beside another spot: highlighted at once, selected once after a short dwell, with open = false.
    const people = spot('people');
    world.walkTo(people.x + 0.8, people.z + 0.4); bench.pump(3000);
    assert.equal(world.diagnostics().avatar.near, 'people');
    assert.equal(bench.spots.length, 1, 'not yet: a dwell is needed');
    await new Promise((resolve) => setTimeout(resolve, 1700)); // the dwell, and the spacing after the request just made
    assert.deepEqual(bench.spots.at(-1), { id: 'people', open: false });
    assert.equal(bench.spots.length, 2);
    world.setState({ ...PARK, spot: 'people' });
    assert.equal(bench.queued(), 0, 'a spot the avatar wandered up to does not pull it on to the marker');
    // Walking straight past spots never asks for them (no dwell), and a second request is spaced out.
    world.walkTo(work.x + 0.6, work.z + 0.6); bench.pump(3000);
    world.walkTo(people.x + 0.8, people.z + 0.4); bench.pump(3000);
    world.walkTo(work.x + 0.6, work.z + 0.6); bench.pump(3000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(bench.spots.length, 2, 'passing by is not dwelling, and requests are spaced out');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.ok(bench.spots.length <= 3, `wandering between two spots asked ${bench.spots.length - 2} more time(s), not once per pass`);

    // An activity starts: the avatar goes to the spot's own place first, then takes the pose, and cannot walk off.
    world.setState({ ...PARK, spot: 'trees' }); bench.pump(3000);
    const asked = bench.spots.length;
    world.walkTo(-6, 2); bench.pump(3000);
    world.setState({ ...PARK, spot: 'trees', activeAction: { kind: 'activity', id: 'chill', remaining: 20, duration: 20 } });
    assert.equal(world.diagnostics().avatar.locked, true);
    assert.equal(world.diagnostics().avatar.mode, 'path', 'walks to the bench first');
    bench.pump(3000);
    const seated = world.diagnostics().avatar;
    assert.ok(Math.hypot(seated.x - 10.25, seated.z - 6.6) < 0.01, 'sitting on the bench under the trees');
    bench.key('walk-up'); assert.equal(bench.queued(), 0, 'no walking during an activity');
    bench.keyUp('walk-up');
    const drinksNow = spot('drinks');
    bench.send('pointerdown', { clientX: drinksNow.px, clientY: drinksNow.py }); bench.send('pointerup', { clientX: drinksNow.px, clientY: drinksNow.py }); bench.send('click', { clientX: drinksNow.px, clientY: drinksNow.py });
    bench.pump(100);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(bench.spots.length, asked, 'no spot is asked for while an activity runs');
    assert.deepEqual([world.diagnostics().avatar.x, world.diagnostics().avatar.z], [seated.x, seated.z]);
    // Done: free again, back on its feet at the spot.
    world.setState({ ...PARK, spot: 'trees' }); bench.pump(3000);
    assert.equal(world.diagnostics().avatar.locked, false);
    bench.key('walk-down'); assert.equal(bench.pump(10), 10); bench.keyUp('walk-down'); bench.pump(400);

    // A person: walk up to them, then open their card.
    const mama = world.diagnostics().people[0];
    bench.send('pointerdown', { clientX: mama.px, clientY: mama.py }); bench.send('pointerup', { clientX: mama.px, clientY: mama.py }); bench.send('click', { clientX: mama.px, clientY: mama.py });
    assert.equal(bench.tagged.length, 0);
    bench.pump(3000);
    assert.deepEqual(bench.tagged, [{ id: 'npc:n1', kind: 'npc' }]);
    assert.ok(Math.hypot(world.diagnostics().avatar.x - mama.x, world.diagnostics().avatar.z - mama.z) < 2.2, 'standing next to them');

    // Setting off on a trip walks to the way out; position reports were rate-limited throughout.
    world.setState({ ...PARK, spot: 'trees', activeAction: { kind: 'travel', id: 'home', remaining: 10, duration: 10 } }); bench.pump(3000);
    const leaving = world.diagnostics().avatar;
    assert.ok(leaving.z > 10 && leaving.locked, 'at the entrance, on the way out');
    assert.ok(bench.moves.length >= 2 && bench.moves.length < 30, `${bench.moves.length} position reports for thousands of frames: limited by the clock, not by the frame rate`); assert.ok(bench.moves.every((move) => move.location === 'park' && Number.isFinite(move.x) && Number.isFinite(move.z)));
    assert.equal(world.diagnostics().loop.running, false);
  } finally { bench.restore(); }
});

test('reduced motion snaps: a tap puts the avatar there in one frame and the camera never eases', () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    bench.reduceMotion(true);
    world.setState(PARK);
    const drawn = world.diagnostics().renderCount;
    world.walkTo(6, 4);
    const there = world.diagnostics();
    assert.ok(Math.hypot(there.avatar.x - 6, there.avatar.z - 4) < 0.45 && !there.avatar.moving);
    assert.deepEqual([there.renderCount, bench.queued()], [drawn + 1, 0], 'one frame, no loop');
    bench.key('zoom-in');
    assert.deepEqual([world.diagnostics().renderCount, bench.queued()], [drawn + 2, 0], 'zoom: one frame, at once');
    assert.ok(world.diagnostics().camera.zoom > 1.3);
    world.setState({ ...PARK, spot: 'work' });
    assert.equal(bench.queued(), 0);
    const work = world.diagnostics().spots.find((item) => item.id === 'work');
    assert.ok(Math.hypot(world.diagnostics().avatar.x - work.x, world.diagnostics().avatar.z - work.z) < 0.01, 'a spot chosen in the panel: simply there');
  } finally { bench.restore(); }
});

test('home: furniture is solid, a tap on the floor walks there, and Buy mode keeps its own taps', () => {
  const bench = motionBench({ location: 'home' });
  try {
    const { world } = bench;
    const state = createLife({ location: 'home', name: 'Ada' }, { now: NOON, cityId: 'lagos' });
    world.setState(state);
    const spawn = world.diagnostics();
    assert.equal(spawn.location, 'home');
    assert.deepEqual(spawn.camera.limits.azimuth.map((value) => Math.round(value * 100) / 100), [0.05, 1.52], 'two cut-away walls: the camera stays on the open side');
    assert.ok(spawn.avatar.x < -4, 'the avatar appears by the door');
    bench.key('walk-right'); bench.pump(30); bench.keyUp('walk-right'); bench.pump(400);
    const moved = world.diagnostics().avatar;
    assert.ok(Math.hypot(moved.x - spawn.avatar.x, moved.z - spawn.avatar.z) > 0.8, 'walks in the room');
    assert.equal(world.diagnostics().loop.running, false);
    // Buy mode keeps its own taps: a click on the floor walks nowhere (the scene's own picking handles it).
    const floor = world.diagnostics().tags[0];
    const click = (x, y) => { bench.send('pointerdown', { clientX: x, clientY: y }); bench.send('pointerup', { clientX: x, clientY: y }); bench.send('click', { clientX: x, clientY: y }); };
    globalThis.window.dispatchEvent(new CustomEvent('jaw:mode', { detail: { mode: 'buy' } }));
    click(floor.x + 60, floor.y + 110);
    assert.deepEqual([bench.queued(), world.diagnostics().avatar.mode], [0, 'idle'], 'Buy mode: a tap does not walk the avatar');
    globalThis.window.dispatchEvent(new CustomEvent('jaw:mode', { detail: { mode: 'venue' } }));
    click(floor.x + 60, floor.y + 110);
    assert.equal(world.diagnostics().avatar.mode, 'path', 'back in the room view: the same tap walks');
    bench.pump(3000);
    assert.equal(world.diagnostics().loop.running, false);
    // Hold every direction for a long time: the avatar never leaves the room.
    for (const action of ['walk-up', 'walk-left', 'walk-down', 'walk-right']) {
      bench.key(action); bench.pump(300); bench.keyUp(action); bench.pump(400);
      const at = world.diagnostics().avatar;
      assert.ok(Math.abs(at.x) <= 5 && Math.abs(at.z) <= 5, `${action}: still inside (${at.x}, ${at.z})`);
    }
  } finally { bench.restore(); }
});
