import test from 'node:test';
import assert from 'node:assert/strict';
import { createVenueWorld } from './venue-world.js';

function fixture() {
  const listeners = new Map(), captured = new Set(), options = new Map();
  const canvas = { style: {}, addEventListener(type, fn, opts) { listeners.set(type, fn); options.set(type, opts); }, removeEventListener(type) { listeners.delete(type); },
    setPointerCapture(id) { captured.add(id); }, releasePointerCapture(id) { captured.delete(id); }, remove() {} };
  const renderer = { shadowMap: {}, domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {},
    render(scene, camera) { this.view = { position: camera.position.toArray(), zoom: camera.zoom }; } };
  const world = createVenueWorld({ appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844 }) }, { renderer });
  const send = (type, props = {}) => listeners.get(type)?.({ pointerId: 1, button: 0, clientX: 120, clientY: 200, preventDefault() {}, ...props });
  return { world, renderer, send, listeners, captured, options };
}

test('venue mouse/touch drag changes camera and tags, persists through HUD resize, and cleans up', () => {
  const f = fixture();
  f.world.setPlayer({ seed: 'test', name: 'Player' });
  const before = structuredClone(f.renderer.view), tag = f.world.diagnostics().tags[0];
  f.send('pointerdown'); f.send('pointermove', { clientX: 210, clientY: 230 }); f.send('pointerup');
  assert.notDeepEqual(f.renderer.view.position, before.position, 'drag rotates the actual rendered camera');
  assert.ok(f.renderer.view.position[1] > before.position[1], 'dragging down raises the camera: the view tips towards top-down');
  assert.notDeepEqual(f.world.diagnostics().tags[0], tag, 'tags follow camera');
  const rotated = f.renderer.view.position;
  f.world.setInsets({ top: 100, bottom: 200 });
  assert.deepEqual(f.renderer.view.position, rotated, 'HUD resize retains orientation');
  const count = f.world.diagnostics().renderCount;
  f.send('pointermove', { clientX: 280 });
  assert.equal(f.world.diagnostics().renderCount, count, 'no redraw after drag ends');
  assert.equal(f.captured.size, 0);
  f.world.recentre();
  assert.deepEqual(f.renderer.view.position, before.position, 'recentre restores the scene preset');
  f.world.dispose(); assert.equal(f.listeners.size, 0);
});

test('wheel and two-finger pinch zoom are bounded and cancel clears gestures', () => {
  const f = fixture();
  const distance = () => f.world.diagnostics().camera.distance;
  const initial = distance();
  f.send('wheel', { deltaY: -200, deltaMode: 0 });
  assert.ok(distance() < initial, 'scrolling up moves the camera in');
  f.world.recentre();
  assert.equal(distance(), initial);
  f.send('pointerdown', { pointerId: 1, clientX: 100 });
  f.send('pointerdown', { pointerId: 2, clientX: 200 });
  f.send('pointermove', { pointerId: 2, clientX: 250 });
  assert.ok(distance() < initial, 'spreading fingers zooms in');
  f.send('pointercancel', { pointerId: 2 }); f.send('pointercancel', { pointerId: 1 });
  const count = f.world.diagnostics().renderCount;
  f.send('pointermove', { clientX: 20 });
  assert.equal(f.world.diagnostics().renderCount, count);
  for (let i = 0; i < 100; i++) f.send('wheel', { deltaY: -1000 });
  assert.ok(Math.abs(distance() - 6.2) < 0.01, 'zooming in stops close enough to see a face, and no closer');
  for (let i = 0; i < 100; i++) f.send('wheel', { deltaY: 1000 });
  assert.ok(distance() > initial * 1.3 && distance() < initial * 1.45, 'zooming out stops with the whole venue in view');
  f.world.setLocation('home');
  assert.equal(f.world.diagnostics().camera.zoom, 1, 'new venue restores its framing');
  f.world.dispose();
});


test('drag click is intercepted before Home picking, while taps and keyboard clicks remain usable', () => {
  const f = fixture();
  let picked = 0;
  const click = (detail = 1) => {
    let blocked = false;
    f.send('click', { detail, stopImmediatePropagation() { blocked = true; } });
    if (!blocked) picked++;
  };
  f.send('pointerdown'); f.send('pointermove', { clientX: 122 }); f.send('pointerup'); click();
  assert.equal(picked, 1, 'small finger jitter remains a tap');
  f.send('pointerdown'); f.send('pointermove', { clientX: 180 }); f.send('pointerup');
  f.send('lostpointercapture'); click();
  assert.equal(picked, 1, 'post-drag click does not reach furniture');
  assert.equal(f.options.get('click').capture, true, 'interception precedes the scene click listener');
  f.send('pointerdown'); f.send('pointerup'); click();
  assert.equal(picked, 2, 'next tap works');
  f.send('pointerdown'); f.send('pointermove', { clientX: 190 }); f.send('pointercancel');
  const drawn = f.world.diagnostics().renderCount;
  f.send('pointermove', { clientX: 220 });
  assert.equal(f.world.diagnostics().renderCount, drawn);
  click(0); assert.equal(picked, 3, 'keyboard-generated click is never swallowed');
  f.send('pointerdown'); f.send('pointerup'); click();
  assert.equal(picked, 4, 'a plain click stays available');
  f.world.dispose();
});
