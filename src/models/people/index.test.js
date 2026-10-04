import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBatch, sceneMaterials } from '../../scene/build.js';
import { APPEARANCE } from '../../game/content/traits.js';
import { DETAILS, LOOK_OPTIONS, POSES, buildAvatar, buildPerson, drawAvatar, normalizeLook, poseAvatar } from './index.js';

function makeKit() {
  const callbacks = [];
  return {
    THREE,
    onDispose(callback) { callbacks.push(callback); },
    dispose() { while (callbacks.length) callbacks.pop()(); },
  };
}

function triangleCount(look, detail, marker = 'crown') {
  const batch = createBatch(THREE);
  drawAvatar(batch, look, { detail, marker, seed: 'budget' });
  return batch.triangles;
}

function keys(values) { return values.map((value) => String(value.id ?? value).toLowerCase().replace(/[^a-z0-9]/g, '')); }

test('normalization accepts every saved trait id and keeps seeded fallbacks deterministic', () => {
  const hair = {
    woman: [...APPEARANCE.hair.woman, ...APPEARANCE.extra.hair.woman],
    man: [...APPEARANCE.hair.man, ...APPEARANCE.extra.hair.man],
  };
  const outfits = {
    woman: [...APPEARANCE.outfits.woman, ...APPEARANCE.extra.outfits.woman],
    man: [...APPEARANCE.outfits.man, ...APPEARANCE.extra.outfits.man],
  };
  for (const body of LOOK_OPTIONS.body) {
    assert.deepEqual(new Set(keys(hair[body])), new Set(LOOK_OPTIONS.hair[body]));
    assert.deepEqual(new Set(keys(outfits[body])), new Set(LOOK_OPTIONS.outfit[body]));
    for (const id of hair[body]) assert.equal(normalizeLook({ body, hair: id }, 'traits').hair, String(id).replaceAll('-', ''));
    for (const id of outfits[body]) assert.equal(normalizeLook({ body, outfit: id }, 'traits').outfit, String(id).replaceAll('-', ''));
  }
  for (const item of APPEARANCE.skin) assert.equal(normalizeLook({ skin: item.id }, 'skin').skin, item.hex);
  for (const item of APPEARANCE.hairColours) assert.equal(normalizeLook({ hairColor: item.id }, 'hair').hairColor, item.hex);
  for (const item of APPEARANCE.outfitColours) assert.equal(normalizeLook({ outfitColor: item.id }, 'outfit').outfitColor, item.hex);
  for (const id of APPEARANCE.fabrics) assert.equal(normalizeLook({ fabric: id }, 'fabric').fabric, String(id).replaceAll('-', ''));
  for (const item of APPEARANCE.accessories) assert.deepEqual(normalizeLook({ accessories: [item.id] }, 'accessory').accessories, [item.id]);
  const unknownA = normalizeLook({ body: 'robot', hair: 'mystery', outfit: 'unknown', height: 99, build: -4 }, 'same');
  const unknownB = normalizeLook({ body: 'robot', hair: 'mystery', outfit: 'unknown', height: 99, build: -4 }, 'same');
  assert.deepEqual(unknownA, unknownB);
  assert.ok(LOOK_OPTIONS.body.includes(unknownA.body));
  assert.ok(LOOK_OPTIONS.hair[unknownA.body].includes(unknownA.hair));
  assert.ok(LOOK_OPTIONS.outfit[unknownA.body].includes(unknownA.outfit));
  assert.equal(unknownA.height, 1.12);
  assert.equal(unknownA.build, 0.82);
  assert.deepEqual(normalizeLook({ accessories: ['glasses', 'sunglasses', 'watch', 'nonsense'] }, 'slots').accessories, ['glasses', 'watch']);
});

test('every look family stays inside its complete detail budget', () => {
  assert.deepEqual([...DETAILS], ['low', 'medium', 'high']);
  const limits = { low: 600, medium: 2500, high: 25000 };
  const ranges = { low: [Infinity, 0], medium: [Infinity, 0], high: [Infinity, 0] };
  const loaded = [
    [],
    ['glasses', 'earrings', 'watch', 'beads', 'backpack'],
    ['sunglasses', 'headwrap', 'chain', 'watch', 'handbag'],
    ['glasses', 'fila', 'earrings', 'chain', 'backpack'],
    ['sunglasses', 'cap', 'earrings', 'beads', 'handbag'],
  ];
  for (const body of LOOK_OPTIONS.body) for (const hair of LOOK_OPTIONS.hair[body]) for (const outfit of LOOK_OPTIONS.outfit[body]) for (const fabric of LOOK_OPTIONS.fabric) for (const accessoryList of loaded) {
    for (const detail of DETAILS) {
      const count = triangleCount({ body, hair, outfit, fabric, accessories: accessoryList }, detail);
      ranges[detail][0] = Math.min(ranges[detail][0], count);
      ranges[detail][1] = Math.max(ranges[detail][1], count);
      assert.ok(count <= limits[detail], `${detail} ${body}/${hair}/${outfit}/${fabric}/${accessoryList.join('+')}: ${count}`);
    }
  }
  // Low is the tight tier. Exercise every allowed subset of up to five accessories against each
  // hair silhouette on the measured worst clothing/fabric combination.
  const ids = LOOK_OPTIONS.accessories;
  for (const body of LOOK_OPTIONS.body) for (const hair of LOOK_OPTIONS.hair[body]) for (let mask = 0; mask < 2 ** ids.length; mask++) {
    const accessoryList = [];
    for (let i = 0; i < ids.length; i++) if ((mask >> i) & 1) accessoryList.push(ids[i]);
    if (accessoryList.length > APPEARANCE.accessoryLimit) continue;
    const outfit = LOOK_OPTIONS.outfit[body].includes('jersey') ? 'jersey' : LOOK_OPTIONS.outfit[body][0];
    const count = triangleCount({ body, hair, outfit, fabric: 'asooke', accessories: accessoryList }, 'low');
    assert.ok(count <= 600, `low worst accessories ${body}/${hair}/${accessoryList.join('+')}: ${count}`);
    ranges.low[0] = Math.min(ranges.low[0], count);
    ranges.low[1] = Math.max(ranges.low[1], count);
  }
  assert.ok(ranges.low[1] > 450, JSON.stringify(ranges));
  assert.ok(ranges.medium[0] > ranges.low[1], JSON.stringify(ranges));
  assert.ok(ranges.high[0] > ranges.medium[1], JSON.stringify(ranges));
});

test('standalone and legacy builders preserve return shapes, hierarchy, draw calls, and body variance', () => {
  const look = { body: 'woman', hair: 'braids', outfit: 'owambe', fabric: 'ankara', accessories: ['earrings', 'chain'] };
  const standalone = buildPerson(look, { detail: 'high' });
  assert.equal(standalone.object3D.userData, standalone.userData);
  assert.ok(standalone.object3D.isGroup);
  assert.ok(standalone.userData.triangles <= 25000);
  assert.equal(standalone.userData.drawCalls, 1);
  const bounds = new THREE.Box3().setFromObject(standalone.object3D, true);
  assert.ok(bounds.min.y > -0.1 && bounds.max.y > 2.5 && bounds.max.y < 3.1, `${bounds.min.y}..${bounds.max.y}`);
  standalone.object3D.traverse((object) => { if (object.isMesh) assert.deepEqual([object.castShadow, object.receiveShadow], [false, false]); });

  const short = buildPerson({ ...look, height: 'short', build: 'slim' }, { detail: 'medium' });
  const tall = buildPerson({ ...look, height: 'tall', build: 'broad' }, { detail: 'medium' });
  const shortBox = new THREE.Box3().setFromObject(short.object3D, true);
  const tallBox = new THREE.Box3().setFromObject(tall.object3D, true);
  assert.ok(tallBox.max.y > shortBox.max.y * 1.15);
  assert.ok(tallBox.max.x - tallBox.min.x > shortBox.max.x - shortBox.min.x);

  const kit = makeKit();
  const avatar = buildAvatar(kit, look, { detail: 'medium', rig: true, marker: 'crown' });
  assert.ok(avatar.isGroup);
  assert.deepEqual(Object.keys(avatar.userData.parts).sort(), ['armL', 'armR', 'body', 'head', 'legL', 'legR', 'torso']);
  assert.equal(avatar.userData.parts.armL.parent, avatar.userData.parts.torso);
  assert.equal(avatar.userData.parts.legL.parent, avatar.userData.parts.body);
  assert.equal(avatar.userData.rig.elbowL.parent, avatar.userData.parts.armL);
  assert.equal(avatar.userData.rig.kneeL.parent, avatar.userData.parts.legL);
  assert.ok(avatar.userData.drawCalls >= 10);
  avatar.traverse((object) => { if (object.isMesh) assert.deepEqual([object.castShadow, object.receiveShadow], [false, false]); });

  for (const item of [standalone, short, tall]) item.userData.dispose();
  avatar.userData.dispose();
  kit.dispose();
});

test('all poses reset deterministically and change only existing rig transforms', () => {
  assert.deepEqual([...POSES], ['stand', 'walk', 'jog', 'sit', 'wave', 'dance', 'work', 'eat', 'phone', 'relax']);
  const { object3D: avatar, userData } = buildPerson({ body: 'man', hair: 'fade', outfit: 'hoodie', fabric: 'plain' }, { detail: 'medium', rig: true, x: 2, y: 3, z: -4, ry: 0.7 });
  const rig = userData.rig;
  const root = [avatar.position.x, avatar.position.y, avatar.position.z, avatar.rotation.y];
  const geometry = [];
  avatar.traverse((object) => { if (object.geometry) geometry.push(object.geometry.uuid); });
  const snapshot = () => ['body', 'torso', 'head', 'armL', 'armR', 'elbowL', 'elbowR', 'legL', 'legR', 'kneeL', 'kneeR'].flatMap((name) => {
    const part = rig[name];
    return [part.position.x, part.position.y, part.position.z, part.rotation.x, part.rotation.y, part.rotation.z];
  });
  poseAvatar(avatar, { pose: 'stand', time: 0 });
  const rest = snapshot();
  for (const pose of POSES) poseAvatar(avatar, { pose, stride: 0.37, time: 1.25 });
  poseAvatar(avatar, { pose: 'stand', time: 0 });
  assert.deepEqual(snapshot(), rest, 'stand resets every transform after all other poses');
  poseAvatar(avatar, { pose: 'walk', stride: 0.25 });
  const firstWalk = snapshot();
  poseAvatar(avatar, { pose: 'dance', time: 8 });
  poseAvatar(avatar, { pose: 'walk', stride: 0.25 });
  assert.deepEqual(snapshot(), firstWalk, 'the same parameters reproduce the same walk frame');
  assert.notEqual(rig.kneeR.rotation.x, rig.kneeL.rotation.x, 'knees flex independently');
  poseAvatar(avatar, { pose: 'sit' });
  assert.ok(rig.body.position.y < -0.25 && rig.kneeL.rotation.x > 1);
  poseAvatar(avatar, { pose: 'wave', time: 0.3 });
  assert.ok(Math.abs(rig.elbowL.rotation.y) > 0.1 && Math.abs(rig.armL.rotation.z) > 2);
  const after = [];
  avatar.traverse((object) => { if (object.geometry) after.push(object.geometry.uuid); });
  assert.deepEqual(after, geometry, 'posing neither rebuilds nor replaces geometry');
  assert.deepEqual([avatar.position.x, avatar.position.y, avatar.position.z, avatar.rotation.y], root, 'posing never moves or turns the avatar root');
  userData.dispose();
});

test('disposal is idempotent, owns standalone resources, and leaves host materials to the kit', () => {
  const standalone = buildPerson({ body: 'woman', hair: 'gele', outfit: 'owambe', fabric: 'asooke' }, { detail: 'high', rig: true, marker: 'crown' });
  const geometries = new Set();
  const materials = new Set();
  standalone.object3D.traverse((object) => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
  let geometryEvents = 0, materialEvents = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => geometryEvents++);
  for (const material of materials) material.addEventListener('dispose', () => materialEvents++);
  standalone.userData.dispose();
  standalone.userData.dispose();
  assert.equal(geometryEvents, geometries.size);
  assert.equal(materialEvents, materials.size);
  assert.equal(standalone.object3D.children.length, 0);

  const kit = makeKit();
  const borrowed = sceneMaterials(kit);
  let borrowedEvents = 0;
  for (const material of Object.values(borrowed)) material.addEventListener('dispose', () => borrowedEvents++);
  const avatar = buildAvatar(kit, { body: 'man', hair: 'afro', outfit: 'agbada' }, { detail: 'high' });
  avatar.userData.dispose();
  avatar.userData.dispose();
  assert.equal(borrowedEvents, 0, 'avatar disposal does not free shared host materials');
  kit.dispose();
  assert.equal(borrowedEvents, 3, 'the kit remains the owner of its shared materials');
});
