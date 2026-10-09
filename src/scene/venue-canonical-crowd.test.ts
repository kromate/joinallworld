import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadCityContent } from '../game/cities/registry.ts';
import { bodyImports } from './body/gate.ts';
import { loadCityScenes } from './city-scenes.ts';
import { createLife } from '../life.ts';
import { createKit } from './kit.ts';
import { buildVenueScene, MAX_CROWD } from './venue-scenes.ts';
import { buildHomeScene } from './home-scene.ts';
import { createVenueWorld } from '../venue-world.ts';
import type { CrowdPerson } from './types.ts';

await loadCityContent('lagos');
await loadCityScenes('lagos');
const people: CrowdPerson[] = Array.from({ length: MAX_CROWD + 2 }, (_, index) => ({
  id: `venue-crowd-${index}`, name: `Person ${index}`, seed: `venue-crowd-${index}`,
  kind: index % 2 ? 'player' : 'npc', look: { body: index % 2 ? 'woman' : 'man', outfit: 'casual' },
  ...(index % 2 ? { x: -3 + index * 0.35, z: 4 } : {}),
}));

test('mixed venue crowd preserves all capped identities without fetching bodies before a supported frame', async () => {
  const kit = createKit(), entry = buildVenueScene(kit, { scene: { kind: 'park' } }), imports = bodyImports.count;
  try {
    const tags = entry.setCrowd(people);
    assert.equal(tags.length, MAX_CROWD);
    assert.deepEqual(tags.map(tag => [tag.id, tag.kind, tag.text]), people.slice(0, MAX_CROWD)
      .map(person => [person.id, person.kind, person.kind === 'npc' ? person.name : `@${person.name}`]));
    assert.deepEqual(entry.crowdRendering, { desired: MAX_CROWD, canonical: 0, procedural: MAX_CROWD, loading: 0 });
    entry.startCrowd?.({ getContext: () => ({}) }, () => assert.fail('unsupported renderer cannot commit a canonical actor'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(bodyImports.count, imports);
    assert.ok(entry.walk.people().every(person => [person.x, person.z, person.top].every(Number.isFinite)));
    entry.setTime('night');
    assert.deepEqual(entry.tags().filter(tag => tag.kind !== 'self').map(tag => tag.id), tags.map(tag => tag.id));
  } finally { entry.dispose(); kit.dispose(); }
  assert.deepEqual(entry.crowdRendering, { desired: 0, canonical: 0, procedural: 0, loading: 0 });
});

test('reported peer motion retains identity and arrival while canonical loading is gated', () => {
  const kit = createKit(), entry = buildVenueScene(kit, { scene: { kind: 'park' } });
  try {
    entry.setCrowd([{ id: 'moving-peer', kind: 'player', name: 'Ada', seed: 'moving-peer', look: { body: 'woman', outfit: 'office' }, x: -2, z: 4 }]);
    const tag = entry.tags().find(tag => tag.id === 'moving-peer')!, person = entry.walk.people()[0]!;
    entry.setCrowd([{ id: 'moving-peer', kind: 'player', name: 'Ada', seed: 'moving-peer', look: { body: 'woman', outfit: 'office' }, x: -1, z: 4 }]);
    assert.equal(entry.easing, true);
    entry.stepCrowd(0.05);
    assert.ok(person.x > -2 && person.x < -1, 'presence updates ease through intermediate positions');
    assert.equal(entry.tags().find(next => next.id === tag.id), tag);
    entry.settleCrowd();
    assert.deepEqual([person.x, person.z], [-1, 4]);
    assert.equal(entry.easing, false);
    assert.equal(entry.crowdRendering?.desired, 1);
    entry.setCrowd([]);
    assert.equal(entry.walk.people().length, 0);
    assert.equal(entry.crowdRendering?.desired, 0);
  } finally { entry.dispose(); kit.dispose(); }
});

test('host starts scene crowd only after its canonical player frame and redraws an asynchronous commit once', () => {
  const events: string[] = [];
  let ready = false, changed: (() => void) | undefined;
  const renderer = { shadowMap: {}, domElement: { remove() {} }, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {},
    render() { events.push('render'); } } as unknown as THREE.WebGLRenderer;
  const container = { appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844 }) } as unknown as HTMLElement;
  const world = createVenueWorld(container, { location: 'home', renderer, buildHome: () => ({
    group: new THREE.Group(), get bodyShown() { return ready; },
    startCrowd(_renderer, callback) { events.push('start'); changed = callback; },
  }) });
  try {
    assert.ok(events.includes('render'));
    assert.equal(events.includes('start'), false, 'first fallback draw cannot start crowd asset loading');
    ready = true; events.length = 0; world.update();
    assert.deepEqual(events, ['render', 'start'], 'the actual render precedes loading');
    assert.ok(changed);
    const frames = world.diagnostics().renderCount;
    changed();
    assert.equal(world.diagnostics().renderCount, frames + 1, 'commit schedules one demand frame');
    world.dispose(); changed();
    assert.equal(world.diagnostics().renderCount, frames + 1, 'late callbacks cannot draw a disposed host');
  } finally { world.dispose(); }
});

test('Home disposal before the queued body task prevents the module request', async () => {
  const descriptors = ['navigator', 'WebGL2RenderingContext'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  class Context {}
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hardwareConcurrency: 4, deviceMemory: 4 } });
  Object.defineProperty(globalThis, 'WebGL2RenderingContext', { configurable: true, value: Context });
  const kit = createKit(), home = buildHomeScene(kit), before = bodyImports.count;
  let closed = false;
  try {
    let plinth: THREE.Mesh | undefined;
    home.group.traverse(object => { if (object instanceof THREE.Mesh && Object.hasOwn(object, 'onBeforeRender')) plinth = object; });
    assert.ok(plinth instanceof THREE.Mesh, 'the actual room mesh owns first-frame body startup');
    plinth.onBeforeRender({ getContext: () => new Context() } as unknown as THREE.WebGLRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), plinth.geometry, Array.isArray(plinth.material) ? plinth.material[0]! : plinth.material, new THREE.Group());
    home.dispose(); closed = true; kit.dispose();
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    assert.equal(bodyImports.count, before, 'departing Home before the timer runs must not import a disposed scene body');
  } finally {
    if (!closed) home.dispose(); kit.dispose();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test('the Home host crowd entry point waits for its canonical player and stays inert after disposal', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'WebGL2RenderingContext');
  class Context {}
  Object.defineProperty(globalThis, 'WebGL2RenderingContext', { configurable: true, value: Context });
  const kit = createKit(), home = buildHomeScene(kit), before = bodyImports.count;
  let closed = false;
  try {
    home.update(createLife({ location: 'home', home: { custom: true, items: [] } }, { cityId: 'lagos', now: Date.UTC(2026, 0, 5, 11) }));
    home.setCrowd([{ id: 'home-guest', seed: 'home-guest', name: 'Ada', kind: 'player', look: { body: 'woman', outfit: 'office' } }]);
    assert.equal(home.crowdRendering.desired, 1);
    assert.equal(home.bodyShown, false);
    for (let frame = 0; frame < 3; frame++) home.startCrowd({ getContext: () => new Context() }, () => assert.fail('no player body means no guest commit'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(bodyImports.count, before, 'a renderer alone must not start guest loading before the canonical player frame');
    home.dispose(); closed = true;
    home.startCrowd({ getContext: () => new Context() }, () => assert.fail('disposed Home must not request frames'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(bodyImports.count, before);
  } finally {
    if (!closed) home.dispose();
    kit.dispose();
    if (prior) Object.defineProperty(globalThis, 'WebGL2RenderingContext', prior);
    else Reflect.deleteProperty(globalThis, 'WebGL2RenderingContext');
  }
});
