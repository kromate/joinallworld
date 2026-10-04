// The character preview draws on demand only: nothing while idle, one frame per input event,
// a bounded ease after a drag, and it frees everything — including its WebGL context — on dispose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createAvatarPreview, previewStats, frameCamera, ANIMATION_LIMIT_MS, PreviewUnavailable } from './avatar-preview.js';
import { createBatch } from './build.js';
import { LOOK_OPTIONS, DETAILS, drawAvatar, normalizeLook } from './characters.js';

function fakeCanvas() {
  const handlers = new Map();
  const host = { clientWidth: 520, clientHeight: 256, appended: 0, appendChild(node) { node.parentElement = host; host.appended += 1; } };
  const canvas = {
    style: {}, dataset: {}, attributes: {}, parentElement: null, removed: false,
    classList: { add() {} },
    setAttribute(name, value) { canvas.attributes[name] = value; },
    addEventListener(type, fn) { handlers.set(type, fn); },
    removeEventListener(type) { handlers.delete(type); },
    setPointerCapture() {}, releasePointerCapture() {},
    remove() { canvas.removed = true; canvas.parentElement = null; },
    fire(type, event = {}) { handlers.get(type)?.({ type, button: 0, pointerId: 1, preventDefault() {}, ...event }); },
    listening: () => handlers.size,
  };
  return { canvas, host };
}
function stubRenderer(canvas) {
  const calls = { render: 0, dispose: 0, contextLoss: 0, size: [] };
  return { calls, domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize(w, h) { calls.size.push([w, h]); }, render() { calls.render += 1; }, dispose() { calls.dispose += 1; }, forceContextLoss() { calls.contextLoss += 1; } };
}
/** A hand-cranked clock: scheduled steps run only when step() is called. */
function fakeClock() {
  let time = 0, next = 1;
  const queue = new Map();
  return {
    now: () => time, raf: (fn) => { queue.set(next, fn); return next++; }, caf: (id) => queue.delete(id),
    pending: () => queue.size,
    step(ms = 16) { time += ms; const run = [...queue.values()]; queue.clear(); run.forEach((fn) => fn()); return run.length; },
    /** Run frames until nothing is scheduled; returns [frames run, ms elapsed]. Fails if it never stops. */
    drain() { let frames = 0; const start = time; while (queue.size) { this.step(); if (++frames > 600) assert.fail('the animation never stopped'); } return [frames, time - start]; },
  };
}
const LOOK = { body: 'woman', hair: 'braids', outfit: 'owambe', fabric: 'ankara', skin: '#96603c', hairColor: '#15110f', outfitColor: '#2c9c9a', bottomsColor: '#243a6b' };
function make(more = {}) {
  const { canvas, host } = fakeCanvas(), renderer = stubRenderer(canvas), clock = fakeClock();
  const preview = createAvatarPreview(host, { look: LOOK, renderer, raf: clock.raf, caf: clock.caf, now: clock.now, reducedMotion: false, ...more });
  return { preview, canvas, host, renderer, clock };
}

test('an idle preview renders nothing; each change costs exactly one frame', async () => {
  let frames = 0, timers = 0;
  const FRAME = ['request', 'Animation', 'Frame'].join(''), INTERVAL = ['set', 'Interval'].join('');
  const original = { raf: globalThis[FRAME], interval: globalThis[INTERVAL], timeout: globalThis.setTimeout };
  globalThis[FRAME] = () => { frames += 1; return 0; };
  globalThis[INTERVAL] = (...args) => { timers += 1; return original.interval(...args); };
  try {
    const { preview, canvas, host, renderer, clock } = make();
    const count = () => preview.diagnostics().renderCount;
    assert.equal(count(), 1, 'one frame to show the Sim');
    assert.ok(preview.diagnostics().triangles > 3000, 'the preview uses the high-detail avatar');
    await new Promise((resolve) => original.timeout(resolve, 120));
    assert.equal(count(), 1, 'idle: zero renders');
    assert.equal(renderer.calls.render, 1);
    assert.equal(clock.pending(), 0, 'nothing is scheduled while idle');
    assert.equal(frames, 0, 'no frame callbacks'); assert.equal(timers, 0, 'no interval timers');
    assert.equal(preview.diagnostics().animating, false);
    assert.equal(preview.setLook({ ...LOOK }), false, 'the same look again: nothing to draw'); assert.equal(count(), 1);
    assert.equal(preview.resize(), false, 'same size: nothing to draw'); assert.equal(count(), 1);
    assert.equal(preview.setFocus('body'), false); assert.equal(count(), 1);
    assert.equal(preview.setLook({ ...LOOK, hair: 'afro' }), true); assert.equal(count(), 2, 'a new look: one frame');
    host.clientWidth = 390; assert.equal(preview.resize(), true); assert.equal(count(), 3, 'a new size: one frame');
    assert.deepEqual(renderer.calls.size.at(-1), [390, 256]);
    canvas.fire('keydown', { key: 'ArrowRight' }); canvas.fire('keydown', { key: 'ArrowLeft' }); canvas.fire('keydown', { key: 'a' });
    assert.equal(count(), 5, 'one frame per arrow key; other keys draw nothing');
    assert.equal(clock.pending(), 0);
    preview.dispose();
  } finally { globalThis[FRAME] = original.raf; globalThis[INTERVAL] = original.interval; }
});

test('dragging draws one frame per pointer move, then eases to rest in a bounded time and stops', () => {
  let spins = 0;
  const { preview, canvas, clock } = make({ onSpin: () => { spins += 1; } });
  const count = () => preview.diagnostics().renderCount;
  const before = count(), yaw = preview.diagnostics().yaw;
  canvas.fire('pointerdown', { clientX: 100 });
  assert.equal(count(), before, 'pressing draws nothing');
  for (let i = 1; i <= 10; i++) { clock.step(16); canvas.fire('pointermove', { clientX: 100 + i * 12 }); }
  assert.equal(count(), before + 10, 'one frame per move');
  assert.equal(spins, 1, 'the hint is dismissed once');
  assert.ok(preview.diagnostics().yaw > yaw + 1, 'the Sim turned with the drag');
  canvas.fire('pointermove', { pointerId: 9, clientX: 900 });
  assert.equal(count(), before + 10, 'another pointer is ignored');
  canvas.fire('pointerup', { clientX: 220 });
  assert.equal(preview.diagnostics().animating, true, 'a flick keeps turning for a moment');
  const [frames, elapsed] = clock.drain();
  assert.ok(frames >= 3 && elapsed <= ANIMATION_LIMIT_MS, `inertia ran ${frames} frames over ${elapsed} ms`);
  const after = count();
  assert.ok(after - before - 10 === frames && frames <= Math.ceil(ANIMATION_LIMIT_MS / 16) + 1, `a bounded number of frames after release (${frames})`);
  assert.equal(preview.diagnostics().animating, false);
  for (let i = 0; i < 20; i++) clock.step(16);
  assert.equal(count(), after, 'at rest: zero renders');
  // A slow release does not coast; a cancelled gesture (the page scrolled instead) does not either.
  canvas.fire('pointerdown', { clientX: 100 }); clock.step(16); canvas.fire('pointermove', { clientX: 104 }); clock.step(400); canvas.fire('pointerup', { clientX: 104 });
  assert.equal(clock.pending(), 0);
  canvas.fire('pointerdown', { clientX: 100 }); clock.step(8); canvas.fire('pointermove', { clientX: 190 }); canvas.fire('pointercancel', {});
  assert.equal(clock.pending(), 0);
  preview.dispose();
});

test('zoom and the turn after a change are bounded too; reduced motion skips every animation', () => {
  const { preview, clock } = make();
  const count = () => preview.diagnostics().renderCount;
  assert.equal(preview.setFocus('head'), true);
  let [frames, elapsed] = clock.drain();
  assert.ok(frames > 2 && elapsed <= ANIMATION_LIMIT_MS, `zoom: ${frames} frames, ${elapsed} ms`);
  assert.equal(preview.diagnostics().focus, 'head');
  preview.setLook({ ...LOOK, outfit: 'office' }, { react: true });
  [frames, elapsed] = clock.drain();
  assert.ok(frames > 2 && elapsed <= ANIMATION_LIMIT_MS, `reaction: ${frames} frames, ${elapsed} ms`);
  const settled = count();
  for (let i = 0; i < 30; i++) clock.step(16);
  assert.equal(count(), settled);
  preview.dispose();

  const still = make({ reducedMotion: true });
  const base = still.preview.diagnostics().renderCount;
  still.preview.setFocus('head'); still.preview.setLook({ ...LOOK, outfit: 'office' }, { react: true });
  still.canvas.fire('pointerdown', { clientX: 0 }); still.clock.step(8); still.canvas.fire('pointermove', { clientX: 200 }); still.canvas.fire('pointerup', { clientX: 200 });
  assert.equal(still.clock.pending(), 0, 'reduced motion: nothing is ever scheduled');
  assert.equal(still.preview.diagnostics().renderCount, base + 3, 'one frame each for the zoom, the look and the move');
  still.preview.dispose();
});

test('one context at a time; dispose frees the renderer, the context, the geometry and the listeners', () => {
  const live = new Set();
  const original = THREE.BufferGeometry.prototype.setAttribute;
  THREE.BufferGeometry.prototype.setAttribute = function setAttribute(...args) {
    if (!live.has(this)) { live.add(this); this.addEventListener('dispose', () => live.delete(this)); }
    return original.apply(this, args);
  };
  try {
    const base = { ...previewStats };
    const first = make();
    assert.equal(previewStats.live, base.live + 1);
    const second = make();
    assert.equal(previewStats.live, base.live + 1, 'creating a preview disposes the one before it');
    assert.equal(first.preview.diagnostics().disposed, true);
    assert.deepEqual([first.renderer.calls.dispose, first.renderer.calls.contextLoss, first.canvas.removed, first.canvas.listening()], [1, 1, true, 0]);
    second.preview.setLook({ ...LOOK, hair: 'gele' }); second.preview.setLook({ ...LOOK, hair: 'bun' });
    const drawn = second.preview.diagnostics().renderCount;
    second.preview.dispose(); second.preview.dispose();
    assert.equal(previewStats.live, base.live);
    assert.deepEqual([second.renderer.calls.dispose, second.renderer.calls.contextLoss], [1, 1], 'disposing twice frees once');
    second.preview.setLook({ ...LOOK, hair: 'afro' }); second.preview.rotate(1); second.preview.resize(); second.canvas.fire('keydown', { key: 'ArrowLeft' });
    assert.equal(second.preview.diagnostics().renderCount, drawn, 'a disposed preview never draws');
    assert.equal(second.clock.pending(), 0);
    assert.equal(live.size, 0, 'no geometry is left behind');
  } finally { THREE.BufferGeometry.prototype.setAttribute = original; }
});

test('a lost context stops drawing and tells the caller; without WebGL the preview refuses quietly', () => {
  let lost = 0;
  const { preview, canvas, clock } = make({ onLost: () => { lost += 1; } });
  preview.setFocus('head');
  canvas.fire('webglcontextlost');
  assert.equal(lost, 1); assert.equal(clock.pending(), 0, 'a running animation is dropped');
  const count = preview.diagnostics().renderCount;
  preview.setLook({ ...LOOK, hair: 'afro' }); preview.rotate(1);
  assert.equal(preview.diagnostics().renderCount, count, 'nothing is drawn into a lost context');
  canvas.fire('webglcontextrestored');
  assert.equal(preview.diagnostics().renderCount, count + 1, 'one frame when it comes back');
  preview.dispose();

  const before = previewStats.live, real = globalThis.document, errors = [], realError = console.error;
  globalThis.document = { createElement: () => ({ getContext: () => null }) };
  console.error = (...args) => errors.push(args);
  try { assert.throws(() => createAvatarPreview({}, { look: LOOK }), PreviewUnavailable); }
  finally { globalThis.document = real; console.error = realError; }
  assert.equal(previewStats.live, before, 'nothing is left alive');
  assert.deepEqual(errors, [], 'no error is logged');
});

test('the camera frames the whole Sim at any stage shape', () => {
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
  for (const aspect of [0.6, 1, 520 / 256, 3]) {
    frameCamera(camera, { y: 1.4, height: 3.1, width: 1.9 }, aspect); camera.updateMatrixWorld();
    for (const [x, y] of [[0, -0.1], [0, 2.9], [-0.9, 1.4], [0.9, 1.4]]) {
      const p = new THREE.Vector3(x, y, 0).project(camera);
      assert.ok(Math.abs(p.x) <= 1.001 && Math.abs(p.y) <= 1.001, `(${x}, ${y}) is in view at aspect ${aspect}`);
    }
  }
});

test('high detail is a real model, low detail stays inside the crowd budget, and both honour every option', () => {
  assert.deepEqual([...DETAILS], ['low', 'high']);
  const triangles = (look, detail) => { const batch = createBatch(THREE); drawAvatar(batch, look, { detail, seed: 'x', marker: 'crown' }); return batch.triangles; };
  const range = { low: [Infinity, 0], high: [Infinity, 0] };
  for (const body of LOOK_OPTIONS.body) for (const hair of LOOK_OPTIONS.hair[body]) for (const outfit of LOOK_OPTIONS.outfit[body]) for (const fabric of LOOK_OPTIONS.fabric) {
    for (const detail of DETAILS) { const n = triangles({ body, hair, outfit, fabric }, detail); range[detail] = [Math.min(range[detail][0], n), Math.max(range[detail][1], n)]; }
  }
  assert.ok(range.low[1] <= 600, `low detail: at most 600 triangles (${range.low})`);
  assert.ok(range.high[0] >= 3000 && range.high[1] <= 12000, `high detail: a few thousand triangles (${range.high})`);
  assert.equal(normalizeLook({ skin: 'skin-6' }, 'a').skin, '#5e3620', 'the game’s own skin ids keep their tone in a scene');
  assert.equal(normalizeLook({ skin: 'skin-1' }, 'b').skin, '#e0ac7e');
});

test('the preview and the panels that use it hold no interval timers or free-running loops, and Three.js stays out of the first download', async () => {
  const read = async (path) => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const preview = await read('./avatar-preview.js');
  assert.doesNotMatch(preview, new RegExp([['request', 'Animation', 'Frame'], ['set', 'Animation', 'Loop'], ['set', 'Interval']].map((parts) => parts.join('')).join('|')));
  assert.equal(preview.match(new RegExp(['set', 'Timeout'].join(''), 'g')).length, 1, 'the only timer is the one-shot step of the bounded animator');
  for (const file of ['look-ui.js', 'onboarding.js', 'sim.js', 'boutique.js']) {
    const code = await read(`../ui/panels/${file}`);
    assert.doesNotMatch(code, new RegExp(`${['request', 'Animation', 'Frame'].join('')}|${['set', 'Interval'].join('')}|${['set', 'Timeout'].join('')}|from '[^']*three[^']*'|from '[^']*scene/`), `${file} has no loops and no static import of the 3D code`);
  }
  assert.match(await read('../ui/panels/look-ui.js'), /import\('\.\.\/\.\.\/scene\/avatar-preview\.js'\)/, 'the preview is fetched with a dynamic import');
});
