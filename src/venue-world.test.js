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

test('no scene, map or shell source contains a frame loop or interval', async () => {
  const files = ['src/venue-world.js', 'src/world-map.js', 'src/city-map.js', 'src/ui/shell.js', 'src/life-main.js', 'src/client.js',
    ...(await readdir('src/scene')).map(name => `src/scene/${name}`), ...(await readdir('src/ui/panels')).filter(name => name.endsWith('.js')).map(name => `src/ui/panels/${name}`)];
  for (const file of files) {
    const code = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /requestAnimationFrame|setAnimationLoop|setInterval/, file);
  }
});
