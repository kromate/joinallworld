import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createNativeNeutralPose } from './native-neutral-pose.ts';

type Rig = { root: THREE.Group; bones: Map<string, THREE.Bone> };

function makeRig(): Rig {
  const root = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  const add = (parent: THREE.Object3D, name: string, offset: readonly [number, number, number], angle = 0): THREE.Bone => {
    const bone = new THREE.Bone();
    bone.name = `mixamorig${name}`;
    bone.position.set(...offset);
    if (angle) bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    parent.add(bone);
    bones.set(bone.name, bone);
    return bone;
  };

  const hips = add(root, 'Hips', [0, 1, 0]);
  const spine = add(hips, 'Spine', [0, 0.12, 0]);
  const spine1 = add(spine, 'Spine1', [0, 0.12, 0]);
  const spine2 = add(spine1, 'Spine2', [0, 0.12, 0]);
  const neck = add(spine2, 'Neck', [0, 0.09, 0]);
  add(neck, 'Head', [0, 0.16, 0]);

  for (const side of ['Left', 'Right'] as const) {
    const sign = side === 'Left' ? -1 : 1;
    const shoulder = add(spine2, `${side}Shoulder`, [sign * 0.2, 0.035, 0], sign * 0.11);
    const arm = add(shoulder, `${side}Arm`, [sign * 0.12, -0.045, 0]);
    const forearm = add(arm, `${side}ForeArm`, [sign * 0.03, -0.24, 0.015]);
    add(forearm, `${side}Hand`, [sign * 0.01, -0.21, 0.035]);

    const thigh = add(hips, `${side}UpLeg`, [sign * 0.12, -0.04, 0]);
    const calf = add(thigh, `${side}Leg`, [sign * 0.025, -0.43, 0.035]);
    const foot = add(calf, `${side}Foot`, [0, -0.42, -0.025]);
    add(foot, `${side}ToeBase`, [0, 0, 0.16]);
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

const requiredPairs = [
  ['mixamorigHips', 'mixamorigSpine'], ['mixamorigSpine', 'mixamorigSpine1'],
  ['mixamorigSpine1', 'mixamorigSpine2'], ['mixamorigSpine2', 'mixamorigNeck'],
  ['mixamorigNeck', 'mixamorigHead'],
  ...(['Left', 'Right'] as const).flatMap((side) => [
    [`mixamorig${side}Arm`, `mixamorig${side}ForeArm`],
    [`mixamorig${side}ForeArm`, `mixamorig${side}Hand`],
    [`mixamorig${side}UpLeg`, `mixamorig${side}Leg`],
    [`mixamorig${side}Leg`, `mixamorig${side}Foot`],
    [`mixamorig${side}Foot`, `mixamorig${side}ToeBase`],
  ]),
] as const;

function actorPoint(root: THREE.Group, bone: THREE.Bone): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert());
}

function segmentDirection(root: THREE.Group, bones: Map<string, THREE.Bone>, parent: string, child: string): THREE.Vector3 {
  return actorPoint(root, bones.get(child)!).sub(actorPoint(root, bones.get(parent)!)).normalize();
}

function transformSnapshot(bones: Map<string, THREE.Bone>) {
  return [...bones.values()].map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
}

function assertSnapshot(snapshot: ReturnType<typeof transformSnapshot>): void {
  for (const state of snapshot) {
    assert.ok(state.bone.position.distanceTo(state.position) < 1e-10, `${state.bone.name} local translation changed`);
    assert.ok(1 - Math.abs(state.bone.quaternion.dot(state.quaternion)) < 1e-10, `${state.bone.name} rotation differs`);
    assert.ok(state.bone.scale.distanceTo(state.scale) < 1e-10, `${state.bone.name} scale changed`);
  }
}

test('native neutral pose stands symmetrically while preserving the captured rig geometry', () => {
  const { root, bones } = makeRig();
  const before = transformSnapshot(bones);
  const lengthsBefore = requiredPairs.map(([parent, child]) => actorPoint(root, bones.get(parent)!).distanceTo(actorPoint(root, bones.get(child)!)));
  const leftClavicle = bones.get('mixamorigLeftShoulder')!.quaternion.clone();
  const rightClavicle = bones.get('mixamorigRightShoulder')!.quaternion.clone();
  const controller = createNativeNeutralPose(root);

  controller.apply();
  root.updateMatrixWorld(true);
  for (const state of before) {
    assert.ok(state.bone.position.distanceTo(state.position) < 1e-10, `${state.bone.name} translation must be authored`);
    assert.ok(state.bone.scale.distanceTo(state.scale) < 1e-10, `${state.bone.name} scale must be retained`);
  }
  const lengthsAfter = requiredPairs.map(([parent, child]) => actorPoint(root, bones.get(parent)!).distanceTo(actorPoint(root, bones.get(child)!)));
  lengthsAfter.forEach((length, index) => assert.ok(Math.abs(length - lengthsBefore[index]!) < 1e-8, `segment ${requiredPairs[index]!.join('/')} length changed`));
  assert.ok(bones.get('mixamorigLeftShoulder')!.quaternion.equals(leftClavicle), 'left clavicle local orientation is retained');
  assert.ok(bones.get('mixamorigRightShoulder')!.quaternion.equals(rightClavicle), 'right clavicle local orientation is retained');

  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);
  const thighLeft = segmentDirection(root, bones, 'mixamorigLeftUpLeg', 'mixamorigLeftLeg');
  const thighRight = segmentDirection(root, bones, 'mixamorigRightUpLeg', 'mixamorigRightLeg');
  const calfLeft = segmentDirection(root, bones, 'mixamorigLeftLeg', 'mixamorigLeftFoot');
  const calfRight = segmentDirection(root, bones, 'mixamorigRightLeg', 'mixamorigRightFoot');
  for (const direction of [thighLeft, thighRight, calfLeft, calfRight]) assert.ok(direction.dot(down) > 0.99, 'both leg segments should be close to vertical');
  assert.ok(thighLeft.x < 0 && thighRight.x > 0, 'thighs should splay outward symmetrically');
  assert.ok(calfLeft.x < 0 && calfRight.x > 0, 'calves should retain symmetric outward orientation');
  assert.ok(Math.abs(thighLeft.y - thighRight.y) < 1e-5 && Math.abs(thighLeft.z - thighRight.z) < 1e-5, 'thigh directions should mirror across the actor center');
  assert.ok(Math.abs(calfLeft.y - calfRight.y) < 1e-5 && Math.abs(calfLeft.z - calfRight.z) < 1e-5, 'calf directions should mirror across the actor center');

  const armLeft = segmentDirection(root, bones, 'mixamorigLeftArm', 'mixamorigLeftForeArm');
  const armRight = segmentDirection(root, bones, 'mixamorigRightArm', 'mixamorigRightForeArm');
  const forearmLeft = segmentDirection(root, bones, 'mixamorigLeftForeArm', 'mixamorigLeftHand');
  const forearmRight = segmentDirection(root, bones, 'mixamorigRightForeArm', 'mixamorigRightHand');
  for (const direction of [armLeft, armRight, forearmLeft, forearmRight]) assert.ok(direction.y < -0.9, 'arms should hang down in a relaxed stance');
  assert.ok(armLeft.x < 0 && armRight.x > 0 && forearmLeft.x < 0 && forearmRight.x > 0, 'arms should angle outward on each side');
  assert.ok(armLeft.dot(up) < 0 && armRight.dot(up) < 0);

  controller.dispose();
  assertSnapshot(before);
  assert.throws(() => controller.apply(), /disposed/);
});

test('cached neutral pose is stable after bone and actor transform changes, and restore returns to captured rest', () => {
  const { root, bones } = makeRig();
  const before = transformSnapshot(bones);
  const controller = createNativeNeutralPose(root);
  controller.apply();
  const neutral = transformSnapshot(bones);

  for (const bone of bones.values()) {
    bone.position.x += 0.03;
    bone.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2).multiply(bone.quaternion);
  }
  root.position.set(4, 2, -3);
  root.rotation.y = 1.1;
  controller.apply();
  assertSnapshot(neutral);
  assert.deepEqual(root.position.toArray(), [4, 2, -3], 'applying cached local bones must preserve actor translation');
  assert.ok(Math.abs(root.rotation.y - 1.1) < 1e-12, 'applying cached local bones must preserve actor yaw');

  controller.restore();
  assertSnapshot(before);
  controller.restore();
  assertSnapshot(before);
  controller.dispose();
});
