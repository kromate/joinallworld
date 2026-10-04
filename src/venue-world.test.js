// Battery rule: a venue scene renders on demand only — an idle scene does zero renders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createVenueWorld } from './venue-world.js';

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

test('no scene, map or shell source contains a frame loop or interval', async () => {
  const files = ['src/venue-world.js', 'src/world-map.js', 'src/city-map.js', 'src/ui/shell.js', 'src/life-main.js', 'src/client.js',
    ...(await readdir('src/scene')).map(name => `src/scene/${name}`), ...(await readdir('src/ui/panels')).filter(name => name.endsWith('.js')).map(name => `src/ui/panels/${name}`)];
  for (const file of files) {
    const code = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /requestAnimationFrame|setAnimationLoop|setInterval/, file);
  }
});
