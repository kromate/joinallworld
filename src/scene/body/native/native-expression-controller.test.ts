import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createNativeExpressionController } from './native-expression-controller.ts';

function actor(): { root: THREE.Group; meshes: Record<'Body' | 'Teeth' | 'Tongue', THREE.Mesh> } {
  const root = new THREE.Group();
  const meshes = {} as Record<'Body' | 'Teeth' | 'Tongue', THREE.Mesh>;
  for (const name of ['Body', 'Teeth', 'Tongue'] as const) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 0.01, 0, 0, 0.01, 0, 0, 0.01], 3)];
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = name;
    mesh.updateMorphTargets();
    mesh.morphTargetDictionary = name === 'Body'
      ? { nativeFacialJawOpen: 0, nativeFacialBlinkLeft: 1, nativeFacialBlinkRight: 2 }
      : { nativeFacialJawOpen: 0 };
    if (name === 'Body') mesh.morphTargetInfluences = [0, 0.12, 0.23];
    mesh.morphTargetInfluences![0] = name === 'Body' ? 0.18 : name === 'Teeth' ? 0.17 : 0.16;
    meshes[name] = mesh;
    root.add(mesh);
  }
  return { root, meshes };
}

test('talk jaw opens synchronously across body teeth tongue and restores saved weights', () => {
  const built = actor();
  const controller = createNativeExpressionController(built.root);
  const before = controller.snapshot();
  assert.deepEqual(before.jaw, { Body: 0.18, Teeth: 0.17, Tongue: 0.16 });

  controller.startTalk();
  const opening = controller.snapshot();
  assert.equal(opening.active, true);
  assert.equal(opening.synchronized, true);
  assert.ok(opening.jaw.Body >= 0 && opening.jaw.Body <= 1);

  controller.step(1 / 30);
  const phaseTwo = controller.snapshot();
  assert.ok(phaseTwo.elapsedSeconds <= 1 / 30);
  assert.ok(phaseTwo.jaw.Body > opening.jaw.Body);
  assert.equal(phaseTwo.synchronized, true);
  controller.step(10);
  assert.ok(controller.snapshot().elapsedSeconds <= 2 / 30 + 1e-9, 'large host delta is bounded to one sample step');

  controller.stop();
  assert.deepEqual(controller.snapshot().jaw, before.jaw);
  assert.equal(controller.snapshot().active, false);
  controller.dispose();
  controller.dispose();
  assert.throws(() => controller.startTalk(), /disposed/);
});

test('active conversation briefly blinks and restores the selected expression without an idle timer', () => {
  const built = actor();
  const controller = createNativeExpressionController(built.root);
  const before = controller.snapshot();
  controller.startTalk();
  let maximum = 0;
  for (let frame = 0; frame < 32; frame++) {
    controller.step(1 / 30);
    const sample = controller.snapshot();
    maximum = Math.max(maximum, sample.blink[0]);
    assert.equal(sample.synchronized, true);
  }
  assert.ok(maximum > 0.8, 'the actual talk clock crosses a brief closure');
  assert.deepEqual(controller.snapshot().blink, before.blink, 'blink has reopened to selected weights');
  controller.stop();
  assert.deepEqual(controller.snapshot().blink, before.blink);
  assert.deepEqual(controller.snapshot().jaw, before.jaw);
  controller.step(100);
  assert.deepEqual(controller.snapshot(), before, 'inactive host steps cannot animate the expression');
  controller.dispose();
});

test('controller refuses incomplete facial topology rather than desynchronizing the jaw', () => {
  const built = actor();
  built.root.remove(built.meshes.Tongue);
  assert.throws(() => createNativeExpressionController(built.root), /requires actor mesh Tongue/);
  built.root.add(built.meshes.Tongue);
  delete built.meshes.Teeth.morphTargetDictionary!.nativeFacialJawOpen;
  assert.throws(() => createNativeExpressionController(built.root), /Teeth is missing nativeFacialJawOpen/);
});
