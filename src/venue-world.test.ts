// Battery rule: a venue scene renders on demand only — an idle scene does zero renders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as THREE from 'three';
import { createVenueWorld, HOST_LIGHTING } from './venue-world.ts';
import type { VenueWorld, VenueWorldOptions, SceneSpotRequest, SceneTag, AvatarPosition, ShownTag } from './venue-world.ts';
import { LIGHTING, MAX_CROWD } from './scene/venue-scenes.ts';
import { createLife } from './life.ts';

/** The host is handed a renderer and a container; these are the narrow stand-ins the tests drive it with (there is no WebGL or DOM under node). */
type StubRenderer = THREE.WebGLRenderer & { calls: { render: number } };
function stubRenderer(): StubRenderer {
  const calls = { render: 0 };
  return { calls, shadowMap: {}, domElement: { remove() {} }, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() { calls.render += 1; } } as unknown as StubRenderer;
}
interface StubContainer { appendChild(): void; getBoundingClientRect: () => { width: number; height: number; left?: number; top?: number } }
const container: StubContainer = { appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844 }) };
/** The game state the tests push is a slice of a LifeState (the host reads only a few fields), so setState takes any object here. */
type TestWorld = Omit<VenueWorld, 'setState'> & { setState(state: object): void };
function makeWorld(host: StubContainer, options: VenueWorldOptions): TestWorld {
  return createVenueWorld(host as unknown as HTMLElement, options) as unknown as TestWorld;
}
/** The browser globals the tests replace and restore (assignable here, unlike on the real `globalThis`). */
const browser = globalThis as unknown as Record<string, unknown>;

test('idle venue performs zero renders; each change draws exactly one frame', async () => {
  let frames = 0, timers = 0;
  const original = { raf: globalThis.requestAnimationFrame, interval: globalThis.setInterval };
  globalThis.requestAnimationFrame = () => { frames += 1; return 0; };
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { timers += 1; return original.interval(...args); }) as typeof setInterval;
  try {
    const renderer = stubRenderer();
    const world = makeWorld(container, { location: 'park', renderer });
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
const people = (count: number) => Array.from({ length: count }, (_, i) => (i % 2 ? { id: `npc:n${i}`, name: `Local ${i}`, kind: 'npc', seed: `n${i}` } : { id: `0000000${i}-2222-4333-8444-555555555555`, name: `Player ${i}`, kind: 'player', seed: `p${i}` }));

test('an idle venue with a crowd renders zero frames; the crowd, the player and the lighting each cost one frame when they change', async () => {
  let frames = 0, timers = 0;
  const original = { raf: globalThis.requestAnimationFrame, interval: globalThis.setInterval };
  globalThis.requestAnimationFrame = () => { frames += 1; return 0; };
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { timers += 1; return original.interval(...args); }) as typeof setInterval;
  try {
    const renderer = stubRenderer();
    const world = makeWorld(container, { location: 'park', renderer });
    const count = () => world.diagnostics().renderCount;
    assert.equal(count(), 1);
    assert.deepEqual(world.diagnostics().lighting, { hemi: LIGHTING.outdoor.day.hemi[2], sun: LIGHTING.outdoor.day.sun[1], sky: '#eaf4ff' }, 'the host applied the scene’s own lighting preset');
    world.setPlayer({ look: { body: 'woman', hair: 'afro' }, seed: PLAYER, name: 'Ada' });
    assert.equal(count(), 2, 'the avatar changed: one frame');
    world.setPlayer({ look: { body: 'woman', hair: 'afro' }, seed: PLAYER, name: 'Ada' });
    assert.equal(count(), 2, 'the same player again: nothing to draw');
    assert.equal(world.setCrowd(people(4)), true);
    assert.equal(count(), 3, 'a crowd arrived: one frame');
    const tags = world.diagnostics().tags;
    assert.deepEqual(tags.filter((tag) => tag.kind !== 'table').map((tag) => [tag.kind, tag.marker]), [['self', 'crown'], ['player', 'tag'], ['npc', 'dot'], ['player', 'tag'], ['npc', 'dot']]);
    // The park's two game tables stand in the scene and are named (part of the scene, like its spots: they cost no frame of their own).
    assert.deepEqual(tags.filter((tag) => tag.kind === 'table').map((tag) => tag.text), ['Whot · Bench under the trees', 'Penalties · Kickabout corner']);
    assert.deepEqual([tags[0]!.text, tags[1]!.text, tags[2]!.name], ['Ada', '@Player 0', 'Local 1']);
    assert.ok(tags.every((tag) => Number.isFinite(tag.x) && Number.isFinite(tag.y)), 'every tag has a screen position');
    // The view starts close to the player (START_DISTANCE in venue-world.js), so not everyone is in it: the player's own tag always is.
    assert.ok(tags[0]!.visible && tags.filter((tag) => tag.visible).length >= 2, 'the player’s tag and the people nearby are projected inside the 390 × 844 view');
    // Idle with a crowd on screen: no frames, no timers, however long we wait and however often the same data arrives.
    for (let i = 0; i < 25; i++) { assert.equal(world.setCrowd(people(4)), false); world.setState({ location: 'park', spot: 'amphitheatre', t: NOON + i * 1000, name: 'Ada' }); }
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(count(), 3, 'idle with a crowd: zero renders');
    assert.equal(renderer.calls.render, 3); assert.equal(frames, 0); assert.equal(timers, 0);
    // The crowd is capped, and a changed crowd costs exactly one frame.
    assert.equal(world.setCrowd(people(40)), true);
    const people_ = (list: ShownTag[]) => list.filter((tag) => tag.kind !== 'table');
    assert.equal(count(), 4); assert.equal(people_(world.diagnostics().tags).length, MAX_CROWD + 1); assert.equal(world.diagnostics().crowd, MAX_CROWD);
    world.setCrowd([]); assert.equal(count(), 5); assert.equal(people_(world.diagnostics().tags).length, 1);
    // Night falls: the scene reports a change, and the host re-reads its lighting and background.
    const day = world.diagnostics().background;
    world.setState({ location: 'park', spot: 'amphitheatre', t: MIDNIGHT, name: 'Ada' });
    assert.equal(count(), 6);
    assert.equal(world.diagnostics().lighting.hemi, LIGHTING.outdoor.night.hemi[2]);
    assert.notEqual(world.diagnostics().background, day); assert.equal(world.diagnostics().background, LIGHTING.outdoor.night.sky[0]);
    // Tags are re-projected with the frame a resize draws — nothing else moves them.
    const before = world.diagnostics().tags[0]!;
    container.getBoundingClientRect = () => ({ width: 1280, height: 800 });
    assert.deepEqual(world.diagnostics().tags[0], before, 'a resize that has not been drawn yet moves nothing');
    world.resize();
    assert.equal(count(), 7); assert.notDeepEqual([world.diagnostics().tags[0]!.x, world.diagnostics().tags[0]!.y], [before.x, before.y]);
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
    const world = makeWorld(container, { location: 'park', renderer });
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
  const world = makeWorld(container, { location: 'park', renderer });
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
  const after = world.diagnostics().tags.find(tag => tag.kind === 'self')!;
  assert.ok(after.y < before.y, 'a taller bottom panel moves the scene (and its tags) up');
  assert.ok(after.x === before.x, 'and never sideways');
  world.setInsets({ top: 0, bottom: 0 });
  world.dispose();
});

test('only the motion loop may name a frame callback; no scene, map or shell source holds an interval', async () => {
  const files = ['src/venue-world.ts', 'src/world-map.ts', 'src/city-map.ts', 'src/ui/shell.js', 'src/life-main.js', 'src/client.ts',
    ...(await readdir('src/scene')).map(name => `src/scene/${name}`), ...(await readdir('src/ui/panels')).filter(name => name.endsWith('.js')).map(name => `src/ui/panels/${name}`)];
  const withLoop = [];
  for (const file of files) {
    if (file.endsWith('.test.js') || file.endsWith('.test.ts')) continue;
    const code = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /setAnimationLoop|setInterval/, file);
    if (/requestAnimationFrame/.test(code)) withLoop.push(file);
  }
  assert.deepEqual(withLoop, ['src/scene/motion-loop.ts'], 'the one frame loop lives in one file, and that file cannot idle');
});

// ---- motion: frames only while something moves ------------------------------------------------

/** A browser's frame callback, a window and a document, all driven by hand. */
function motionBench({ width = 1280, height = 800, location = 'park' } = {}) {
  const original = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, window: browser.window, document: browser.document, matchMedia: browser.matchMedia };
  let queue: ((time: number) => void)[] = [], time = 5000, reduce = false;
  const docListeners = new Map<string, () => void>();
  globalThis.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };
  globalThis.cancelAnimationFrame = () => { queue = []; };
  const win = new EventTarget();
  const fakeDocument = { visibilityState: 'visible', addEventListener: (type: string, fn: () => void) => docListeners.set(type, fn), removeEventListener: (type: string) => docListeners.delete(type) };
  browser.window = win;
  browser.document = fakeDocument;
  browser.matchMedia = (query: string) => ({ matches: reduce && /reduced-motion/.test(query) });
  const listeners = new Map<string, (event: unknown) => void>();
  const canvas = { style: {}, addEventListener(type: string, fn: (event: unknown) => void) { listeners.set(type, fn); }, removeEventListener(type: string) { listeners.delete(type); }, setPointerCapture() {}, releasePointerCapture() {}, remove() {} };
  const renderer = { calls: 0, shadowMap: {}, domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render(this: { calls: number }) { this.calls += 1; } } as unknown as THREE.WebGLRenderer & { calls: number };
  const spots: SceneSpotRequest[] = [], tagged: SceneTag[] = [], moves: AvatarPosition[] = [];
  const world = makeWorld({ appendChild() {}, getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }) }, { location, renderer, onSpot: (spot) => spots.push(spot), onTag: (tag) => tagged.push(tag), onMove: (at) => moves.push(at) });
  return {
    world, renderer, spots, tagged, moves, listeners,
    /** Run up to `count` frames 16 ms apart; returns how many ran (fewer when the loop stopped itself). */
    pump(count = 1) { let ran = 0; for (let i = 0; i < count; i++) { const fns = queue; queue = []; if (!fns.length) break; time += 16; fns.forEach((fn) => fn(time)); ran += 1; } return ran; },
    queued: () => queue.length,
    key: (action: string, mode = 'venue', jog = false) => win.dispatchEvent(new CustomEvent('jaw:key', { detail: { action, mode, jog } })),
    keyUp: (action: string) => win.dispatchEvent(new CustomEvent('jaw:key-up', { detail: { action } })),
    send: (type: string, props: Record<string, unknown> = {}) => listeners.get(type)?.({ pointerId: 1, button: 0, detail: 1, clientX: 0, clientY: 0, preventDefault() {}, stopImmediatePropagation() {}, ...props }),
    hide(hidden: boolean) { fakeDocument.visibilityState = hidden ? 'hidden' : 'visible'; docListeners.get('visibilitychange')?.(); },
    reduceMotion(on: boolean) { reduce = on; },
    restore() { world.dispose(); globalThis.requestAnimationFrame = original.raf; globalThis.cancelAnimationFrame = original.caf; browser.window = original.window; browser.document = original.document; browser.matchMedia = original.matchMedia; },
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
    const hold = (action: string, frames = 10, jog = false) => { const from = world.diagnostics().avatar; bench.key(action, 'venue', jog); bench.pump(frames); bench.keyUp(action); bench.pump(400); const to = world.diagnostics().avatar; return { dx: to.x - from.x, dz: to.z - from.z, facing: to.facing, from, to }; };
    // The park camera looks from the front right (+x, +z): away is −x −z, the camera's right is +x −z.
    const yaw = world.diagnostics().camera.yaw;
    const away = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
    const along = (move: { dx: number; dz: number }, axis: number[]) => move.dx * axis[0]! + move.dz * axis[1]!;
    for (const [action, axis, sign] of [['walk-up', away, 1], ['move-up', away, 1], ['walk-down', away, -1], ['move-down', away, -1], ['walk-right', right, 1], ['move-right', right, 1], ['walk-left', right, -1], ['move-left', right, -1]] as [string, number[], number][]) {
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
    const spot = (id: string) => world.diagnostics().spots.find((item) => item.id === id)!;
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
    const mama = world.diagnostics().people[0]!;
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

test('walking moves transforms only: hundreds of frames of walking, turning and zooming build no geometry', () => {
  const bench = motionBench();
  const setIndex = THREE.BufferGeometry.prototype.setIndex, setAttribute = THREE.BufferGeometry.prototype.setAttribute;
  let built = 0;
  try {
    const { world } = bench;
    world.setState(PARK);
    world.setCrowd(people(6));
    THREE.BufferGeometry.prototype.setIndex = function counted(...args) { built += 1; return setIndex.apply(this, args); };
    THREE.BufferGeometry.prototype.setAttribute = function counted(...args) { built += 1; return setAttribute.apply(this, args); };
    bench.key('walk-up'); bench.pump(60); bench.key('walk-left'); bench.pump(60); bench.keyUp('walk-up'); bench.keyUp('walk-left');
    bench.key('look-right'); bench.pump(30); bench.keyUp('look-right'); bench.key('zoom-in'); bench.pump(400);
    world.walkTo(6, 4); bench.pump(2000); world.walkTo(-6, 6); bench.pump(2000);
    world.setState({ ...PARK, spot: 'art' }); bench.pump(3000);
    assert.ok(world.diagnostics().loop.frames > 300, `${world.diagnostics().loop.frames} frames`);
    assert.equal(built, 0, 'not one geometry or attribute was made while moving');
  } finally { THREE.BufferGeometry.prototype.setIndex = setIndex; THREE.BufferGeometry.prototype.setAttribute = setAttribute; bench.restore(); }
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
    const work = world.diagnostics().spots.find((item) => item.id === 'work')!;
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
    assert.equal(spawn.camera.limits.azimuth, null, 'the camera may orbit all the way round the room');
    assert.deepEqual(spawn.walls, { back: true, left: true }, 'from the composed view both walls are behind the room and showing');
    assert.ok(spawn.avatar.x < -4, 'the avatar appears by the door');
    bench.key('walk-right'); bench.pump(30); bench.keyUp('walk-right'); bench.pump(400);
    const moved = world.diagnostics().avatar;
    assert.ok(Math.hypot(moved.x - spawn.avatar.x, moved.z - spawn.avatar.z) > 0.8, 'walks in the room');
    assert.equal(world.diagnostics().loop.running, false);
    // Buy mode keeps its own taps: a click on the floor walks nowhere (the scene's own picking handles it).
    const floor = world.diagnostics().tags[0]!;
    const click = (x: number, y: number) => { bench.send('pointerdown', { clientX: x, clientY: y }); bench.send('pointerup', { clientX: x, clientY: y }); bench.send('click', { clientX: x, clientY: y }); };
    (browser.window as EventTarget).dispatchEvent(new CustomEvent('jaw:mode', { detail: { mode: 'buy' } }));
    click(floor.x + 60, floor.y + 110);
    assert.deepEqual([bench.queued(), world.diagnostics().avatar.mode], [0, 'idle'], 'Buy mode: a tap does not walk the avatar');
    (browser.window as EventTarget).dispatchEvent(new CustomEvent('jaw:mode', { detail: { mode: 'venue' } }));
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

// ---- the finished camera and walking: every venue, sight lines, other players, markers ------------

test('EVERY VENUE: spawn on free floor, walk to every spot and back out, orbit all the way round, zoom to both limits — and the loop always stops', async () => {
  const { VENUES } = await import('./game/content/venues.ts');
  const { spotsOf } = await import('./life.ts');
  const report = [];
  for (const id of Object.keys(VENUES)) {
    const bench = motionBench({ location: id });
    try {
      const { world } = bench;
      const spots = spotsOf(id).map((spot) => spot.id);
      const base = id === 'home' ? createLife({ location: 'home', name: 'Ada' }, { now: NOON, cityId: 'lagos' }) : { location: id, spot: spots[0], t: NOON, name: 'Ada' };
      world.setState(base);
      const spawn = world.diagnostics();
      assert.equal(spawn.location, id);
      assert.equal(spawn.camera.limits.azimuth, null, `${id}: free orbit`);
      const entrance = { x: spawn.avatar.x, z: spawn.avatar.z };
      assert.equal(spawn.avatar.y < 0.1, true, `${id}: spawns on the ground`);
      // Every spot the server knows, chosen in the panel one after another: the avatar gets there and the loop stops.
      // (The first state of a scene just shown leaves the avatar at the entrance, so the first spot is visited last.)
      for (const spot of id === 'home' ? [] : [...spots.slice(1), spots[0]]) {
        world.setState({ ...base, spot });
        const frames = bench.pump(4000);
        const at = world.diagnostics();
        const target = at.spots.find((item) => item.id === spot)!;
        assert.ok(frames < 3900 && !at.loop.running, `${id}.${spot}: the walk ends (${frames} frames)`);
        assert.ok(Math.hypot(at.avatar.x - target.x, at.avatar.z - target.z) < 0.05, `${id}.${spot}: standing on the spot (${at.avatar.x}, ${at.avatar.z}) vs (${target.x}, ${target.z})`);
      }
      // Never stranded: from the last spot the avatar walks back out to where it came in.
      assert.equal(world.walkTo(entrance.x, entrance.z), true);
      bench.pump(4000);
      const out = world.diagnostics();
      assert.ok(Math.hypot(out.avatar.x - entrance.x, out.avatar.z - entrance.z) < 0.5 && !out.loop.running && out.avatar.y < 0.1 && !out.perch, `${id}: back at the entrance, on the ground (${out.avatar.x}, ${out.avatar.z}, y ${out.avatar.y})`);
      // Keys still walk from there.
      bench.key('walk-up'); bench.pump(20); bench.keyUp('walk-up'); bench.pump(400);
      assert.ok(Math.hypot(world.diagnostics().avatar.x - out.avatar.x, world.diagnostics().avatar.z - out.avatar.z) > 0.3, `${id}: not stuck at the entrance`);
      // A full turn in eight drags: the camera goes all the way round; a room shows and hides its walls on the way.
      // (From the whole-venue view: the view starts close to the player, where the camera can be inside the room.)
      for (let i = 0; i < 12 && world.diagnostics().camera.asked < world.diagnostics().camera.whole - 0.01; i++) { world.zoom(-1); bench.pump(900); }
      const seen = new Set();
      let turned = 0, last = world.diagnostics().camera.yaw;
      for (let i = 0; i < 8; i++) {
        bench.send('pointerdown', { clientX: 600, clientY: 300 }); bench.send('pointermove', { clientX: 600 + 131, clientY: 300 }); bench.send('pointerup', { clientX: 731, clientY: 300 });
        bench.pump(400);
        const now = world.diagnostics();
        turned += Math.abs(now.camera.yaw - last); last = now.camera.yaw;
        if (now.walls) seen.add(`${now.walls.back}${now.walls.left}`);
        assert.equal(now.loop.running, false, `${id}: the orbit comes to rest`);
        assert.ok(now.camera.y > 0.5, `${id}: the camera stays above the floor`);
      }
      assert.ok(Math.abs(turned - Math.PI * 2) < 0.2, `${id}: turned ${turned.toFixed(2)} rad — a full orbit`);
      if (spawn.walls) assert.equal(seen.size, 4, `${id}: each wall was hidden while the camera was behind it, and shown again (${[...seen].join(' ')})`);
      world.recentre(); bench.pump(900);
      assert.deepEqual(world.diagnostics().walls, spawn.walls, `${id}: back where it started, the walls are as they were`);
      // Zoom limits both ways.
      for (let i = 0; i < 60; i++) bench.send('wheel', { deltaY: -400, deltaMode: 0 });
      bench.pump(900);
      const close = world.diagnostics().camera;
      assert.ok(close.zoom === close.limits.zoom[1] && close.distance <= close.asked + 0.01 && close.distance > 1, `${id}: closest ${close.distance}`);
      for (let i = 0; i < 80; i++) bench.send('wheel', { deltaY: 400, deltaMode: 0 });
      bench.pump(900);
      const far = world.diagnostics().camera;
      assert.ok(far.zoom === far.limits.zoom[0] && far.held === 1, `${id}: farthest ${far.distance}, nothing holds the wide view`);
      assert.equal(world.diagnostics().loop.running, false); assert.equal(bench.queued(), 0);
      report.push(id);
    } finally { bench.restore(); }
  }
  assert.ok(report.length >= 23, `${report.length} venues walked`);
});

test('raised spots: the avatar climbs the declared way up, stands at the deck’s height, and a walking key takes the same way down first', () => {
  const bench = motionBench({ location: 'canopy-walk' });
  try {
    const { world } = bench;
    world.setState({ location: 'canopy-walk', spot: 'trail', t: NOON, name: 'Ada' });
    bench.pump(4000);
    const tower = world.diagnostics().spots.map((spot) => spot.id);
    // Find the spot that sits on the walkway (a raised landmark) by asking each in turn.
    let up = null;
    for (const id of tower) { world.setState({ location: 'canopy-walk', spot: id, t: NOON, name: 'Ada' }); let highest = 0, frames = 0; while (bench.pump(1) && frames < 5000) { frames += 1; highest = Math.max(highest, world.diagnostics().avatar.y); } if (world.diagnostics().avatar.y > 2) { up = { id, highest }; break; } }
    assert.ok(up, 'one of the canopy walk’s spots is up on the walkway');
    const top = world.diagnostics();
    assert.equal(top.perch, true, 'the host remembers the way it came up');
    assert.ok(top.avatar.y > 2.4 && up.highest <= 4.6, `standing ${top.avatar.y} up; never higher than the platforms on the way (${up.highest})`);
    // A walking key: down the same way, then free on the ground.
    bench.key('walk-down');
    let frames = 0, heights = [];
    while (world.diagnostics().perch && frames < 3000) { bench.pump(1); frames += 1; heights.push(world.diagnostics().avatar.y); }
    bench.keyUp('walk-down'); bench.pump(600);
    const down = world.diagnostics();
    assert.equal(down.perch, false); assert.ok(down.avatar.y < 0.1, `back on the ground (y ${down.avatar.y}) after ${frames} frames`);
    assert.ok(heights.every((height, index) => index === 0 || height - heights[index - 1]! < 0.5), 'no leap on the way down');
    assert.ok(Math.abs(down.avatar.x + 8) < 1.2 && down.avatar.z > 10, `it came down the stair (${down.avatar.x}, ${down.avatar.z})`);
    assert.equal(down.loop.running, false);
  } finally { bench.restore(); }
});

test('in sight: zoomed in behind a tree the camera is held in or the tree is ghosted — eased, then at rest; the wide view is never pulled', () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    assert.ok(world.diagnostics().solids > 20, 'the park has things that can hide the avatar');
    // Walk about the park zoomed right in, looking from every side: whenever something is in the way, one of the two answers is on.
    for (let i = 0; i < 60; i++) bench.send('wheel', { deltaY: -400, deltaMode: 0 });
    bench.pump(900);
    let held = 0, ghosted = 0, visits = 0, jumps = 0;
    for (const [x, z] of [[8.8, 9], [10.6, 7.4], [9.6, 5.6], [-8, 8], [5, -3], [-2, 0], [11, 9], [7.5, 6.5]] as [number, number][]) {
      world.walkTo(x, z); bench.pump(3000);
      for (let turn = 0; turn < 6; turn++) {
        bench.send('pointerdown', { clientX: 600, clientY: 300 }); bench.send('pointermove', { clientX: 600 + 175, clientY: 300 }); bench.send('pointerup', { clientX: 775, clientY: 300 });
        let previous = world.diagnostics().camera.distance;
        for (let frame = 0; frame < 400 && bench.pump(1); frame++) { const now = world.diagnostics().camera.distance; if (Math.abs(now - previous) > 1.6) jumps += 1; previous = now; }
        const view = world.diagnostics();
        assert.equal(view.loop.running, false, 'the camera comes to rest');
        assert.ok(view.camera.distance >= 1.7 && view.camera.distance <= view.camera.asked + 0.01);
        visits += 1;
        if (view.camera.held < 0.999) held += 1;
        if (view.camera.ghost > 0.5) ghosted += 1;
        assert.ok(view.camera.ghost === 0 || view.camera.ghost === 1, 'the ghost has finished fading by the time the loop stops');
      }
    }
    assert.ok(held > 0, `the camera was held in at ${held} of ${visits} views`);
    assert.ok(ghosted > 0, `and the thing in the way was ghosted at ${ghosted}`);
    assert.ok(held + ghosted < visits, 'most views are clear and untouched');
    assert.equal(jumps, 0, 'never a jump: the hold eases in and out');
    // Idle afterwards.
    const rest = world.diagnostics().renderCount;
    assert.equal(bench.pump(50), 0); assert.equal(world.diagnostics().renderCount, rest);
    // The composed wide view: whatever crosses the line, the camera is where the player put it.
    bench.key('zoom-fit'); bench.pump(900);
    for (const [x, z] of [[8.8, 9], [-8, 8], [5, -3]] as [number, number][]) { world.walkTo(x, z); bench.pump(3000); assert.equal(world.diagnostics().camera.held, 1); }
  } finally { bench.restore(); }
});

test('other players stand where they report, ease when they move (bounded frames, then idle), and are simply there with reduced motion', () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    const ada = '00000001-2222-4333-8444-555555555555';
    const crowd = (x: number, z: number) => [{ id: ada, name: 'Ada', kind: 'player', seed: ada, look: null, x, z }, { id: 'npc:n1', name: 'Mama', kind: 'npc', seed: 'n1', spot: 'drinks' }];
    const drawn = world.diagnostics().renderCount;
    assert.equal(world.setCrowd(crowd(4, 6)), true);
    assert.deepEqual([world.diagnostics().renderCount, bench.queued()], [drawn + 1, 0], 'someone arrived: one frame, no loop');
    const first = world.diagnostics();
    assert.deepEqual(first.people.map((person) => [person.id, person.x, person.z]).find(([id]) => id === ada), [ada, 4, 6]);
    const tagAt = () => world.diagnostics().tags.find((tag) => tag.id === ada)!;
    const before = tagAt();
    // She walks: the loop runs for a bounded number of frames, her tag moves with her, then everything is at rest.
    world.setCrowd(crowd(6.5, 6));
    assert.equal(world.diagnostics().easing, true);
    const frames = bench.pump(400);
    assert.ok(frames > 5 && frames < 40, `eased over ${frames} frames`);
    const after = world.diagnostics();
    assert.deepEqual([after.easing, after.loop.running, bench.queued()], [false, false, 0]);
    assert.deepEqual(after.people.find((person) => person.id === ada)!.x, 6.5);
    assert.notDeepEqual([tagAt().x, tagAt().y], [before.x, before.y], 'her name tag followed her');
    assert.equal(after.renderCount, drawn + 1 + frames, 'exactly one render per frame of the ease');
    // The same list again, and again: nothing.
    for (let i = 0; i < 10; i++) assert.equal(world.setCrowd(crowd(6.5, 6)), false);
    assert.equal(bench.pump(50), 0); assert.equal(world.diagnostics().renderCount, after.renderCount);
    // A stream of updates three times a second (as presence delivers them) never leaves the loop running afterwards.
    for (let step = 0; step < 6; step++) { world.setCrowd(crowd(6.5 - step * 0.8, 6 + step * 0.3)); bench.pump(20); }
    bench.pump(400);
    assert.deepEqual([world.diagnostics().loop.running, world.diagnostics().easing], [false, false]);
    // Reduced motion: a new place is one frame, no loop.
    bench.reduceMotion(true);
    const count = world.diagnostics().renderCount;
    world.setCrowd(crowd(-3, 8));
    assert.deepEqual([world.diagnostics().renderCount, bench.queued(), world.diagnostics().easing], [count + 1, 0, false]);
    assert.equal(world.diagnostics().people.find((person) => person.id === ada)!.x, -3);
    bench.reduceMotion(false);
    // The local avatar walks round her instead of through her.
    world.setCrowd(crowd(3, 8));
    bench.pump(400);
    world.walkTo(0, 8); bench.pump(3000);
    world.walkTo(6, 8);
    let closest = Infinity;
    for (let i = 0; i < 3000 && bench.pump(1); i++) { const at = world.diagnostics().avatar; closest = Math.min(closest, Math.hypot(at.x - 3, at.z - 8)); }
    assert.ok(Math.hypot(world.diagnostics().avatar.x - 6, world.diagnostics().avatar.z - 8) < 0.45, 'it gets where it was going');
    assert.ok(closest > 0.5, `and kept ${closest.toFixed(2)} clear of her on the way`);
  } finally { bench.restore(); }
});

test('markers and people: a click on a marker’s ring picks the marker even with someone in front of it; hovering names what a click would pick', () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    const spot = (id: string) => world.diagnostics().spots.find((item) => item.id === id)!;
    const drinks = spot('drinks');
    // Somebody (a player who walked there) stands right in front of the drinks marker, as the camera sees it.
    const yaw = world.diagnostics().camera.yaw;
    const blocker = '00000003-2222-4333-8444-555555555555';
    world.setCrowd([{ id: blocker, name: 'Tunde', kind: 'player', seed: blocker, look: null, x: drinks.x + Math.sin(yaw) * 1.1, z: drinks.z + Math.cos(yaw) * 1.1 }]);
    const person = world.diagnostics().people[0]!;
    // Hover: the marker names itself; the person's body, higher up, is the person.
    const draws = world.diagnostics().renderCount;
    bench.send('pointermove', { clientX: drinks.px, clientY: drinks.py, pointerType: 'mouse' });
    assert.equal(world.diagnostics().hover, 'spot:drinks', 'on the ring: the marker');
    assert.equal(world.diagnostics().renderCount, draws + 1, 'a hover change draws one frame');
    bench.send('pointermove', { clientX: drinks.px + 1, clientY: drinks.py, pointerType: 'mouse' });
    assert.equal(world.diagnostics().renderCount, draws + 1, 'moving within the same target draws nothing');
    bench.send('pointermove', { clientX: person.px, clientY: person.py - 14, pointerType: 'mouse' });
    assert.equal(world.diagnostics().hover, `person:${blocker}`, 'on the figure: the person');
    bench.send('pointermove', { clientX: 5, clientY: 5, pointerType: 'mouse' });
    assert.equal(world.diagnostics().hover, null);
    assert.equal(bench.queued(), 0, 'hovering never starts the loop');
    // Click the ring: the avatar walks to the SPOT and asks for it; the person's card is not opened.
    bench.send('pointerdown', { clientX: drinks.px, clientY: drinks.py }); bench.send('pointerup', { clientX: drinks.px, clientY: drinks.py }); bench.send('click', { clientX: drinks.px, clientY: drinks.py });
    bench.pump(3000);
    assert.deepEqual(bench.spots, [{ id: 'drinks', open: true }]);
    assert.deepEqual(bench.tagged, []);
    assert.ok(Math.hypot(world.diagnostics().avatar.x - drinks.x, world.diagnostics().avatar.z - drinks.z) < 0.01);
    // Click the person's body: their card.
    world.walkTo(0, 9); bench.pump(3000);
    const now = world.diagnostics().people[0]!;
    bench.send('pointerdown', { clientX: now.px, clientY: now.py - 14 }); bench.send('pointerup', { clientX: now.px, clientY: now.py - 14 }); bench.send('click', { clientX: now.px, clientY: now.py - 14 });
    bench.pump(3000);
    assert.deepEqual(bench.tagged, [{ id: blocker, kind: 'player' }]);
    // The marker's hit area is a little larger than the ring: a click just outside it still picks the spot.
    world.setCrowd([]);
    world.walkTo(0, 9); bench.pump(3000);
    const art = spot('art');
    bench.send('pointerdown', { clientX: art.px + 20, clientY: art.py }); bench.send('pointerup', { clientX: art.px + 20, clientY: art.py }); bench.send('click', { clientX: art.px + 20, clientY: art.py });
    bench.pump(3000);
    assert.deepEqual(bench.spots.at(-1), { id: 'art', open: true });
  } finally { bench.restore(); }
});

test('where the avatar stands is reported in presence units, on request and while walking; walkBy is the keyboard way to move', () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    const start = world.position();
    assert.deepEqual(start, { x: world.diagnostics().avatar.x, z: world.diagnostics().avatar.z, location: 'park' }, 'the park fits the room protocol’s bounds: scene units are presence units');
    assert.ok(Math.abs(start.x) <= 20 && Math.abs(start.z) <= 20);
    assert.equal(world.walkBy(0, -2), true);
    bench.pump(600);
    const moved = world.position();
    assert.ok(Math.abs(moved.z - (start.z - 2)) < 0.45 && Math.abs(moved.x - start.x) < 0.45, 'two steps up-screen');
    assert.ok(bench.moves.length >= 1 && bench.moves.every((move) => move.location === 'park' && Math.abs(move.x) <= 20 && Math.abs(move.z) <= 20));
    assert.deepEqual([bench.moves.at(-1)!.x, bench.moves.at(-1)!.z], [moved.x, moved.z], 'the last report is where it stopped');
    assert.equal(world.walkBy(NaN, 1), false);
    (browser.window as EventTarget).dispatchEvent(new CustomEvent('jaw:mode', { detail: { mode: 'map' } }));
    assert.equal(world.walkBy(1, 0), false, 'not while another screen is in front');
  } finally { bench.restore(); }
});

test('game tables can be walked up to: a tap walks there and opens it on arrival, resting beside one opens it once, and it costs no idle frame', async () => {
  const bench = motionBench();
  try {
    const { world } = bench;
    world.setState(PARK);
    const things = () => world.diagnostics().things, avatar = () => world.diagnostics().avatar;
    assert.deepEqual(things().map((thing) => [thing.id, thing.kind, thing.at]), [['table:park-bench', 'table', false], ['table:park-goal', 'table', false]]);
    const table = things()[0]!;
    const away = () => Math.hypot(avatar().x - table.x, avatar().z - table.z);
    assert.ok(away() > 6, 'the avatar starts at the entrance, not at a table');
    // Idle with tables in the room: nothing runs.
    const idle = world.diagnostics().renderCount;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual([bench.pump(20), world.diagnostics().renderCount, bench.tagged.length], [0, idle, 0], 'a table is part of the scene: no frame, no timer, nothing reported');

    // 1. Tap the table: the avatar walks up to it, and only on arrival is the table reported (which opens the Tables app).
    bench.send('pointerdown', { clientX: table.px, clientY: table.py }); bench.send('pointerup', { clientX: table.px, clientY: table.py });
    bench.send('click', { clientX: table.px, clientY: table.py });
    assert.deepEqual([bench.tagged.length, avatar().mode, bench.spots.length], [0, 'path', 0], 'nothing is opened before the avatar gets there, and a table is not a spot');
    bench.pump(3000);
    assert.deepEqual(bench.tagged, [{ id: 'table:park-bench', kind: 'table' }]);
    assert.ok(away() > 1.2 && away() < 2.6, `standing beside the table, not on it (${away().toFixed(2)} away)`);
    assert.deepEqual([things()[0]!.at, avatar().moving, bench.queued()], [true, false, 0], 'at the table, and the loop has stopped');
    // Staying there, a state poll and the dwell passing report nothing more.
    world.setState({ ...PARK, t: NOON + 5000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(bench.tagged.length, 1, 'it is opened once, not every time the player stands there');

    // 2. Walk away, then walk back beside it without tapping it (the keyboard way): after a short dwell it opens again, once.
    assert.equal(world.walkBy(-6, 3), true); bench.pump(3000);
    assert.ok(away() > 3.3); assert.equal(things()[0]!.at, false, 'walked away from it');
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(bench.tagged.length, 1, 'resting somewhere else opens nothing');
    const here = avatar();
    assert.equal(world.walkBy(table.x - 2.1 - here.x, table.z + 0.4 - here.z), true); bench.pump(3000);
    assert.ok(away() < 2.5, `came to rest beside it (${away().toFixed(2)} away)`);
    assert.equal(bench.tagged.length, 1, 'not at the very moment of stopping');
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.deepEqual(bench.tagged.slice(1), [{ id: 'table:park-bench', kind: 'table' }], 'after the dwell, once');
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(bench.tagged.length, 2);

    // 3. While an activity runs the scene is locked: a tap on a table does nothing.
    world.setState({ ...PARK, t: NOON + 9000, activeAction: { kind: 'activity', id: 'chill', duration: 11, remaining: 11 } });
    bench.pump(600);
    const far = things()[1]!;
    bench.send('pointerdown', { clientX: far.px, clientY: far.py }); bench.send('pointerup', { clientX: far.px, clientY: far.py }); bench.send('click', { clientX: far.px, clientY: far.py });
    bench.pump(600);
    assert.equal(bench.tagged.length, 2);
  } finally { bench.restore(); }
});
