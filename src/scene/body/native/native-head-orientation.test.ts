import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createNativeHeadOrientationController } from './native-head-orientation.ts';
import { createNativeSourceLandmarkSampler } from './native-source-sampler.ts';
import type { NativeWristSourceFrame } from './native-source-sampler.ts';

function actor(): { root: THREE.Group; head: THREE.Bone } {
  const root = new THREE.Group(), torso = new THREE.Bone(), head = new THREE.Bone();
  torso.name = 'mixamorigNeck'; head.name = 'mixamorigHead';
  root.quaternion.setFromEuler(new THREE.Euler(-0.18, 0.24, 0.11));
  torso.quaternion.setFromEuler(new THREE.Euler(0.08, 0.12, -0.17));
  root.add(torso); torso.add(head);
  head.quaternion.setFromEuler(new THREE.Euler(0.13, -0.21, 0.08));
  return { root, head };
}

function frame(headRotation: THREE.Quaternion): NativeWristSourceFrame {
  return { clipName: 'office-idle', duration: 2, landmarks: {} as NativeWristSourceFrame['landmarks'],
    wristRotations: {} as NativeWristSourceFrame['wristRotations'], headRotation };
}

test('head orientation preserves actor-relative aim through root and neck motion', () => {
  const { root, head } = actor(), neck = head.parent!, bind = head.quaternion.clone();
  const sourceRest = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.2, 0.1));
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, -0.41, 0.16));
  root.updateWorldMatrix(true, true);
  const bindRootRotation = root.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const controller = createNativeHeadOrientationController(root, sourceRest);

  // The actor may turn and the retargeter may have already aimed the neck.
  root.quaternion.setFromEuler(new THREE.Euler(0.31, -0.72, 0.19));
  neck.quaternion.setFromEuler(new THREE.Euler(-0.22, 0.47, 0.38));
  controller.apply(frame(delta.clone().multiply(sourceRest)));
  root.updateWorldMatrix(true, true);
  const actualRootRotation = root.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
  assert.ok(actualRootRotation.angleTo(delta.clone().multiply(bindRootRotation)) < 1e-6);
  controller.apply(frame(sourceRest));
  root.updateWorldMatrix(true, true);
  const restRootRotation = root.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
  assert.ok(restRootRotation.angleTo(bindRootRotation) < 1e-6);
  controller.restore();
  assert.ok(head.quaternion.angleTo(bind) < 1e-6);
  controller.dispose();
  assert.throws(() => controller.apply(frame(sourceRest)), /disposed/);
});

test('head orientation rejects missing sampled rotation instead of substituting a pose', () => {
  const { root } = actor();
  const controller = createNativeHeadOrientationController(root, new THREE.Quaternion());
  const incomplete = { clipName: 'bad', duration: 1, landmarks: {} as NativeWristSourceFrame['landmarks'],
    wristRotations: {} as NativeWristSourceFrame['wristRotations'] } as NativeWristSourceFrame;
  assert.throws(() => controller.apply(incomplete), /missing a valid head rotation/);
});

test('source sampler exposes measured corrected-rest and animated head world orientations', () => {
  const root = new THREE.Group();
  const names = ['pelvis','spine_01','spine_02','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l',
    'clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r'];
  const nodes = new Map<string, THREE.Bone>();
  for (const name of names) { const node = new THREE.Bone(); node.name = name; root.add(node); nodes.set(name, node); }
  const sourceHead = nodes.get('Head')!;
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, -0.27, 0.08));
  sourceHead.quaternion.copy(rest);
  const pose = rest.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, -0.3)));
  const track = new THREE.QuaternionKeyframeTrack('Head.quaternion', [0, 1], [
    rest.x, rest.y, rest.z, rest.w, pose.x, pose.y, pose.z, pose.w,
  ]);
  const clips = ['jog', 'dance', 'lie-down'].map((name) => new THREE.AnimationClip(name, 1, [track.clone()]));
  const sampler = createNativeSourceLandmarkSampler(root, clips);
  assert.ok(sampler.restHeadRotation.angleTo(rest) < 1e-6);
  const sampled = sampler.sample('jog', 0.5);
  assert.ok(sampled.headRotation.angleTo(rest.clone().slerp(pose, 0.5)) < 1e-5);
  sampler.dispose();
});
