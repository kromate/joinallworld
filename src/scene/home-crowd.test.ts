import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadCityContent } from '../game/cities/registry.ts';
import { createLife } from '../life.ts';
import { buildHomeScene, MAX_GUESTS_SHOWN } from './home-scene.ts';
import { createKit } from './kit.ts';
import { bodyImports } from './body/gate.ts';

await loadCityContent('lagos');
const guests = Array.from({ length: MAX_GUESTS_SHOWN + 2 }, (_, index) => ({
  id: `home-crowd-${index}`, name: `Guest ${index}`, seed: `home-crowd-${index}`,
  kind: index % 2 ? 'npc' : 'player', look: { body: index % 2 ? 'woman' : 'man', outfit: 'casual' },
}));
const stateFor = () => createLife({ location: 'home', home: { custom: true, items: [] } },
  { cityId: 'lagos', now: Date.UTC(2026, 0, 5, 11) });

test('Home preserves guest tags and its capacity without importing bodies on an unsupported renderer', async () => {
  const kit = createKit(), home = buildHomeScene(kit), imports = bodyImports.count;
  try {
    home.update(stateFor()); home.setCrowd(guests);
    const tags = home.tags().filter(tag => tag.kind === 'player' || tag.kind === 'npc');
    assert.equal(tags.length, MAX_GUESTS_SHOWN);
    assert.deepEqual(tags.map(tag => [tag.id, tag.kind, tag.text]), guests.slice(0, MAX_GUESTS_SHOWN)
      .map(guest => [guest.id, guest.kind, guest.kind === 'npc' ? guest.name : `@${guest.name}`]));
    // Find the actual camera/capability callback rather than starting the loader directly.
    let callbackMesh: THREE.Mesh | undefined;
    home.group.traverse(child => {
      if (child instanceof THREE.Mesh && Object.hasOwn(child, 'onBeforeRender')) callbackMesh ??= child;
    });
    assert.ok(callbackMesh, 'the home has its first-render capability callback');
    const renderer = { domElement: { addEventListener() {}, removeEventListener() {} }, getContext: () => ({}) } as unknown as THREE.WebGLRenderer;
    callbackMesh.onBeforeRender(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), callbackMesh.geometry,
      Array.isArray(callbackMesh.material) ? callbackMesh.material[0]! : callbackMesh.material, new THREE.Group());
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(bodyImports.count, imports, 'non-WebGL2 rendering cannot fetch a body module or assets');
    assert.deepEqual(home.crowdRendering, { desired: MAX_GUESTS_SHOWN, canonical: 0, procedural: MAX_GUESTS_SHOWN, loading: 0 });
    assert.ok(tags.every(tag => Object.values(tag.position).every(Number.isFinite)));
  } finally { home.dispose(); kit.dispose(); }
  assert.deepEqual(home.crowdRendering, { desired: 0, canonical: 0, procedural: 0, loading: 0 });
});

test('adding furniture under a waiting Home guest recomputes placement without changing identity', () => {
  const kit = createKit(), home = buildHomeScene(kit);
  try {
    const state = stateFor(); home.update(state); home.setCrowd(guests.slice(0, 2));
    const before = home.tags().find(tag => tag.id === guests[0]!.id)!;
    assert.ok(before);
    const tile = home.walk.scale / 0.72;
    const x = Math.floor((before.position.x + 5) / tile), y = Math.floor((before.position.z + 5) / tile);
    home.update({ ...state, home: { ...state.home, custom: true, items: [{ id: 'guest-tile-chair', itemId: 'plastic-chair', x, y, rot: 0 }] } });
    const after = home.tags().find(tag => tag.id === before.id)!;
    assert.deepEqual([after.id, after.kind, after.text], [before.id, before.kind, before.text]);
    assert.notDeepEqual([after.position.x, after.position.z], [before.position.x, before.position.z], 'the occupied tile cannot retain its guest');
    assert.equal(home.crowdRendering.desired, 2);
    const chair = home.objects().find(object => object.id === 'guest-tile-chair')!;
    assert.ok(chair);
    assert.ok(Math.abs(after.position.x - chair.x) >= tile / 2 || Math.abs(after.position.z - chair.z) >= tile / 2,
      'the guest stands outside the new furniture footprint');
  } finally { home.dispose(); kit.dispose(); }
});

test('five Home guests keep the door approach clear and occupy separate reachable floor positions', () => {
  const kit = createKit(), home = buildHomeScene(kit);
  try {
    home.update(stateFor()); home.setCrowd(guests);
    const people = home.tags().filter(tag => tag.kind === 'player' || tag.kind === 'npc');
    const door = home.homeDoor, tile = home.walk.scale / 0.72, floor = home.walk.grid;
    assert.ok(floor);
    assert.equal(people.length, MAX_GUESTS_SHOWN, 'distributing guests must preserve the supported occupancy');
    for (const person of people) {
      const { x, z } = person.position;
      assert.ok(floor.free(x, z), `${person.id} stands on walkable floor`);
      assert.ok(Math.hypot(x - door.x, z - door.z) > tile * 1.5, `${person.id} leaves the door's standing and swing space clear`);
      const route = floor.path(door.x, door.z, x, z), end = route?.at(-1);
      assert.ok(end && Math.hypot(end.x - x, end.z - z) < 0.01, `${person.id} is reachable, rather than a nearest point outside a sealed room`);
      for (const other of people) if (person.id !== other.id) {
        assert.ok(Math.hypot(x - other.position.x, z - other.position.z) >= tile * 1.8, 'guests have room for body and arms');
      }
    }
    assert.deepEqual(people.map(person => person.id), guests.slice(0, MAX_GUESTS_SHOWN).map(guest => guest.id));
  } finally { home.dispose(); kit.dispose(); }
});

test('guest appearance changes and larger occupancy retain existing deterministic social slots', () => {
  const kit = createKit(), home = buildHomeScene(kit);
  try {
    home.update(stateFor()); home.setCrowd(guests.slice(0, 2));
    const placements = () => home.tags().filter(tag => tag.kind === 'player' || tag.kind === 'npc')
      .map(tag => ({ id: tag.id, x: tag.position.x, z: tag.position.z }));
    const original = placements();
    home.setCrowd(guests.slice(0, 2).map(guest => ({ ...guest, name: `Changed ${guest.name}`, look: { body: 'woman', outfit: 'office' } })));
    assert.deepEqual(placements(), original, 'cosmetics cannot shift physical placements');
    home.setCrowd(guests);
    assert.deepEqual(placements().slice(0, 2), original, 'adding guests does not move existing people');
    home.setCrowd(guests.slice(0, 2));
    assert.deepEqual(placements(), original);
  } finally { home.dispose(); kit.dispose(); }
});

test('a furniture partition keeps guests on the floor connected to the entrance', () => {
  const kit = createKit(), home = buildHomeScene(kit);
  try {
    const state = stateFor();
    home.update(state);
    const initialFloor = home.walk.grid;
    assert.ok(initialFloor);
    const tile = home.walk.scale / 0.72, wide = Math.round((initialFloor.bounds[2] + 5 + 0.15) / tile);
    const partitionRow = Math.floor(10 / tile / 2) - 1;
    const items = Array.from({ length: wide }, (_, x) => ({ id: `partition-${x}`, itemId: 'plastic-chair' as const, x, y: partitionRow, rot: 0 }));
    home.update({ ...state, home: { ...state.home, custom: true, items } });
    home.setCrowd(guests);
    const people = home.tags().filter(tag => tag.kind === 'player' || tag.kind === 'npc');
    assert.equal(people.length, MAX_GUESTS_SHOWN);
    const door = home.homeDoor, floor = home.walk.grid;
    assert.ok(floor);
    for (const person of people) {
      const route = floor.path(door.x, door.z, person.position.x, person.position.z), end = route?.at(-1);
      assert.ok(end && Math.hypot(end.x - person.position.x, end.z - person.position.z) < 0.01, 'a free but sealed-off tile is not a guest destination');
    }
    assert.ok(people.every(person => (person.position.z + 5) / tile > partitionRow + 1), 'no guest appears beyond the chair partition');
  } finally { home.dispose(); kit.dispose(); }
});

test('rented rooms and owned house tiers preserve five guests on reachable ground-floor space', () => {
  const rentals = ['mushin', 'yaba', 'lekki', 'ikoyi', 'banana'] as const;
  const owned = ['starter', 'bq', 'bungalow', 'duplex', 'villa'] as const;
  for (const state of [
    ...rentals.map(house => { const state = stateFor(); state.estate.living = 'rent'; state.property.house = house; return state; }),
    ...owned.map(tier => { const state = stateFor(); state.estate.living = 'own'; state.estate.tier = tier; return state; }),
  ]) {
    const kit = createKit(), home = buildHomeScene(kit);
    try {
      home.update(state); home.setCrowd(guests);
      const people = home.walk.people(), floor = home.walk.grid, entrance = home.walk.entrance;
      assert.ok(floor);
      const label = state.estate.living === 'own' ? state.estate.tier : state.property.house;
      assert.equal(people.length, MAX_GUESTS_SHOWN, `${label}: keep all supported identities`);
      for (const person of people) {
        assert.ok(floor.free(person.x, person.z), `${label}: ${person.id} stands on the displayed walkable floor`);
        const path = floor.path(entrance.x, entrance.z, person.x, person.z), end = path?.at(-1);
        assert.ok(end && Math.hypot(end.x - person.x, end.z - person.z) < 0.01, `${label}: ${person.id} has an entrance route`);
      }
      assert.equal(home.crowdRendering.desired, MAX_GUESTS_SHOWN);
    } finally { home.dispose(); kit.dispose(); }
  }
});
