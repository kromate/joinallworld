import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from '../../scene/kit.js';
import { modelLibraryEnabled } from './flags.js';

test('model flag defaults to the library and only legacy query disables it', () => {
  assert.equal(modelLibraryEnabled(''), true);
  assert.equal(modelLibraryEnabled('?models=legacy'), false);
  assert.equal(modelLibraryEnabled('?models=library'), true);
});

test('default facade keeps the scene exports, rig shape, crowd tags, and disposal contract', async () => {
  const characters = await import('../../scene/characters.js?integration=default');
  assert.deepEqual([...characters.DETAILS], ['low', 'medium', 'high']);
  assert.equal(typeof characters.drawAvatar, 'function');
  assert.equal(typeof characters.buildAvatar, 'function');
  assert.equal(typeof characters.buildCrowd, 'function');
  assert.equal(typeof characters.appearanceToLook, 'function');

  const kit = createKit();
  const avatar = characters.buildAvatar(kit, { body: 'man', hair: 'fade', outfit: 'casual' }, { detail: 'medium', rig: true });
  assert.ok(avatar.isGroup);
  assert.ok(avatar.userData.parts.body && avatar.userData.parts.torso);
  assert.ok(avatar.userData.rig.elbowL && avatar.userData.rig.kneeL);
  const crowd = characters.buildCrowd(kit, [{ id: 'a', name: 'Ada', kind: 'player', x: 1, z: 2 }]);
  assert.deepEqual([crowd.tags[0].id, crowd.tags[0].text, crowd.tags[0].marker], ['a', '@Ada', 'tag']);
  assert.ok(crowd.group instanceof THREE.Group);
  avatar.userData.dispose(); crowd.dispose(); crowd.dispose(); kit.dispose();
  assert.equal(avatar.children.length, 0);
  assert.equal(crowd.group.children.length, 0);
});

test('legacy query selects the preserved implementation', async () => {
  const previous = globalThis.location;
  globalThis.location = { search: '?models=legacy' };
  try {
    const characters = await import('../../scene/characters.js?integration=legacy');
    const look = characters.normalizeLook({ body: 'woman', outfitColor: 'gold' }, 'legacy');
    assert.equal(look.outfitColor, '#d6a83a');
    assert.equal('height' in look, false);
    assert.equal('build' in look, false);
    assert.equal(characters.PARTS.includes('body'), false);
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});
