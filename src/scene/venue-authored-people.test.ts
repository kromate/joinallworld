import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from './kit.ts';
import { createBatch } from './build.ts';
import { footprintRecorder } from './movement.ts';
import { buildVenueScene, MAX_CROWD } from './venue-scenes.ts';
import { SCENES } from './venues-outdoor.ts';
import { loadCityContent } from '../game/cities/registry.ts';
import { loadCityScenes } from './city-scenes.ts';
import { bodyImports } from './body/gate.ts';
import type { AuthoredPerson } from './authored-people.ts';

await loadCityContent('lagos');
await loadCityScenes('lagos');

function device(memory: number) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hardwareConcurrency: 4, deviceMemory: memory } });
  return () => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  };
}
const venue = { id: 'authored-market-qa', scene: { kind: 'market' } };
const recordedMarket = () => {
  const recorder = footprintRecorder(createBatch(THREE));
  SCENES.market!.build(recorder.batch, { kind: 'market', venue, spots: [], variant: null,
    accent: '#f08a3c', label: 'market', cityId: 'lagos' });
  return recorder;
};

test('market captures all six authored people without consuming public crowd capacity or changing camera solids', async () => {
  const restore = device(4), kit = createKit(), before = bodyImports.count;
  const baseline = recordedMarket(), entry = buildVenueScene(kit, venue);
  try {
    const captured: AuthoredPerson[] = [];
    const meshes: THREE.Mesh[] = [];
    entry.group.traverse(object => {
      const person = object.userData.authoredPerson as AuthoredPerson | undefined;
      if (person) { captured.push(person); meshes.push(object as THREE.Mesh); }
    });
    assert.equal(captured.length, 6);
    assert.deepEqual(captured.map(person => [person.seed, person.appearance.pose, person.local.x, person.local.z]).sort(), [
      ['market-mat', 'sit', 8.6, 3], ['market-tomato', 'work', -9.6, -9.3],
      ['market-yam', 'stand', -5, -9.3], ['market-cloth', 'wave', 6.6, -6.4],
      ['market-shopper', 'walk', 0.6, -2.6], ['market-provisions', 'stand', -12.8, -1.6],
    ].sort());
    assert.equal(captured.find(person => person.seed === 'market-mat')!.appearance.seat, 0.4);
    assert.equal(new Set(captured.map(person => person.id)).size, 6);
    assert.deepEqual(entry.walk.solids, baseline.shapes().solids, 'grouping fallbacks retains original camera collisions');
    assert.deepEqual(entry.group.userData.authoredPeople, { desired: 6, captured: 6, canonical: 0, procedural: 6, loading: 0 });
    const publicPeople = Array.from({ length: MAX_CROWD + 2 }, (_, i) => ({ id: `public-${i}`, kind: 'npc', name: `Public ${i}` }));
    entry.setCrowd(publicPeople);
    assert.equal(entry.tags().filter(tag => tag.kind !== 'self').length, MAX_CROWD);
    assert.equal(entry.crowdRendering!.desired, MAX_CROWD, 'authored staff do not take public occupancy slots');
    entry.startCrowd?.({ getContext: () => ({}) }, () => assert.fail('unsupported context cannot commit'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(bodyImports.count, before, 'capturing and unsupported rendering cannot import body assets');
    entry.setTime('night');
    assert.ok(meshes.every(mesh => mesh.visible && mesh.parent === entry.group), 'fallbacks remain visible and owned before a real commit');
    assert.deepEqual(entry.group.userData.authoredPeople, { desired: 6, captured: 6, canonical: 0, procedural: 6, loading: 0 });
    entry.setCrowd([]);
    assert.equal(entry.crowdRendering!.desired, 0);
    assert.equal(entry.group.userData.authoredPeople.desired, 6, 'public presence changes cannot erase static staff');
    // A public presence ID can be any string. It must not take over an authored identity.
    entry.setCrowd([{ id: captured[0]!.id, seed: 'separate-presence', kind: 'player', name: 'Visitor' }]);
    assert.equal(entry.crowdRendering!.desired, 1);
    assert.equal(entry.tags().find(tag => tag.name === 'Visitor')!.id, captured[0]!.id, 'external identity remains intact');
    assert.equal(entry.group.userData.authoredPeople.desired, 6);
  } finally { entry.dispose(); kit.dispose(); restore(); }
  assert.deepEqual(entry.group.userData.authoredPeople, { desired: 0, captured: 0, canonical: 0, procedural: 0, loading: 0 });
});

test('low-tier body refusal retains merged authored geometry and performs no body request', async () => {
  const restore = device(2), kit = createKit(), before = bodyImports.count;
  const entry = buildVenueScene(kit, venue);
  try {
    assert.deepEqual(entry.group.userData.authoredPeople, { desired: 6, captured: 0, canonical: 0, procedural: 6, loading: 0 });
    let split = false;
    entry.group.traverse(object => { if (object.userData.authoredPerson) split = true; });
    assert.equal(split, false, 'body refusal preserves the original merged fallback batches');
    entry.startCrowd?.({ getContext: () => ({}) }, () => assert.fail('refused device cannot commit'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(bodyImports.count, before);
  } finally { entry.dispose(); kit.dispose(); restore(); }
});
