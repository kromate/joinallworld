import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createNativeInteractionGestureController } from './native-interaction-gesture.ts';
import { createNativeSourceLandmarkSampler } from './native-source-sampler.ts';
import type { NativeSourceJoint, SourceLandmarks, NativeSourceFrame } from './native-source-pose.ts';

type Rig = { root: THREE.Group; bones: Map<string, THREE.Bone> };
const sourceJointToBone: Readonly<Record<NativeSourceJoint, string>> = {
  Hips: 'Hips', Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2', Neck: 'Neck', Head: 'Head',
  LeftShoulder: 'LeftShoulder', LeftArm: 'LeftArm', LeftForeArm: 'LeftForeArm', LeftHand: 'LeftHand',
  RightShoulder: 'RightShoulder', RightArm: 'RightArm', RightForeArm: 'RightForeArm', RightHand: 'RightHand',
  LeftUpLeg: 'LeftUpLeg', LeftLeg: 'LeftLeg', LeftFoot: 'LeftFoot', LeftToeBase: 'LeftToeBase',
  RightUpLeg: 'RightUpLeg', RightLeg: 'RightLeg', RightFoot: 'RightFoot', RightToeBase: 'RightToeBase',
};

function makeRig(): Rig {
  const root = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  const add = (parent: THREE.Object3D, name: string, offset: readonly [number, number, number]): THREE.Bone => {
    const bone = new THREE.Bone();
    bone.name = `mixamorig${name}`;
    bone.position.set(...offset);
    parent.add(bone);
    bones.set(bone.name, bone);
    return bone;
  };
  const hips = add(root, 'Hips', [0, 1, 0]);
  const spine = add(hips, 'Spine', [0, 0.12, 0]);
  const spine1 = add(spine, 'Spine1', [0, 0.12, 0]);
  const spine2 = add(spine1, 'Spine2', [0, 0.12, 0]);
  const neck = add(spine2, 'Neck', [0, 0.09, 0]);
  add(neck, 'Head', [0, 0.16, 0.04]);
  for (const side of ['Left', 'Right'] as const) {
    const sign = side === 'Left' ? -1 : 1;
    const shoulder = add(spine2, `${side}Shoulder`, [sign * 0.2, 0.035, 0]);
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

function restLandmarks(root: THREE.Group, bones: Map<string, THREE.Bone>): SourceLandmarks {
  root.updateMatrixWorld(true);
  const values = {} as Record<NativeSourceJoint, readonly [number, number, number]>;
  for (const joint of Object.keys(sourceJointToBone) as NativeSourceJoint[]) {
    const bone = bones.get(`mixamorig${sourceJointToBone[joint]}`)!;
    const point = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert());
    values[joint] = [point.x, point.y, point.z];
  }
  return values;
}

function frame(landmarks: SourceLandmarks, clipName = 'interact'): NativeSourceFrame {
  return { clipName, duration: 1.25, landmarks };
}

function armMotion(rest: SourceLandmarks): SourceLandmarks {
  const points = Object.fromEntries(Object.entries(rest).map(([key, point]) => [key, [...point]])) as Record<NativeSourceJoint, number[]>;
  // A measured-source-frame-shaped elbow/hand trajectory used to exercise the retargeting math.
  points.RightArm = [points.RightArm[0]! + 0.08, points.RightArm[1]! + 0.07, points.RightArm[2]! + 0.03];
  points.RightForeArm = [points.RightForeArm[0]! + 0.14, points.RightForeArm[1]! + 0.15, points.RightForeArm[2]! + 0.08];
  points.RightHand = [points.RightHand[0]! + 0.21, points.RightHand[1]! + 0.26, points.RightHand[2]! + 0.14];
  return points as unknown as SourceLandmarks;
}

function mirroredSourceRest(nativeRest: SourceLandmarks): SourceLandmarks {
  const mirrored = {} as Record<NativeSourceJoint, readonly [number, number, number]>;
  for (const joint of Object.keys(nativeRest) as NativeSourceJoint[]) {
    const [x, y, z] = nativeRest[joint];
    mirrored[joint] = [-x, y, z];
  }
  return mirrored;
}

function sourceBindTpose(neutral: SourceLandmarks): SourceLandmarks {
  const points = Object.fromEntries(Object.entries(neutral).map(([key, point]) => [key, [...point]])) as Record<NativeSourceJoint, number[]>;
  for (const side of ['Left', 'Right'] as const) {
    const outward = side === 'Left' ? 1 : -1;
    const shoulder = points[`${side}Shoulder`];
    points[`${side}Arm`] = [shoulder[0]! + outward * 0.16, shoulder[1]!, shoulder[2]!];
    points[`${side}ForeArm`] = [shoulder[0]! + outward * 0.4, shoulder[1]!, shoulder[2]!];
    points[`${side}Hand`] = [shoulder[0]! + outward * 0.62, shoulder[1]!, shoulder[2]!];
  }
  return points as unknown as SourceLandmarks;
}

function actorPoint(root: THREE.Group, bone: THREE.Bone): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return bone.getWorldPosition(new THREE.Vector3());
}

function transformSnapshot(bones: Iterable<THREE.Bone>) {
  return [...bones].map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
}

function assertTransformSnapshot(states: ReturnType<typeof transformSnapshot>): void {
  for (const state of states) {
    assert.ok(state.bone.position.distanceTo(state.position) < 1e-10, `${state.bone.name} translation changed`);
    assert.ok(1 - Math.abs(state.bone.quaternion.dot(state.quaternion)) < 1e-10, `${state.bone.name} rotation changed`);
    assert.ok(state.bone.scale.distanceTo(state.scale) < 1e-10, `${state.bone.name} scale changed`);
  }
}

test('measured arm motion changes the native reach while transformed-root lower body and lengths stay fixed', () => {
  const { root, bones } = makeRig();
  const nativeRest = restLandmarks(root, bones);
  // The actual source skeleton's left/right axis is mirrored relative to the native character.
  const sourceNeutral = mirroredSourceRest(nativeRest);
  const sourceRest = sourceBindTpose(sourceNeutral);
  assert.ok(sourceRest.RightShoulder[0] < sourceRest.LeftShoulder[0]);
  assert.ok(nativeRest.RightShoulder[0] > nativeRest.LeftShoulder[0]);
  assert.ok(Math.abs(sourceRest.LeftForeArm[1] - sourceRest.LeftArm[1]) < 1e-10, 'source bind is horizontally posed');
  assert.ok(sourceNeutral.LeftForeArm[1] < sourceNeutral.LeftArm[1], 'measured neutral reference differs from source bind pose');
  const controller = createNativeInteractionGestureController(root, { sourceRestLandmarks: sourceRest, sourceNeutralLandmarks: sourceNeutral });
  const sourcePose = armMotion(sourceNeutral);
  const untouched = [...bones.entries()]
    .filter(([name]) => /Hips|Spine|Neck|Head|UpLeg|LeftLeg|RightLeg|Foot|ToeBase|Hand/.test(name))
    .map(([, bone]) => bone);

  // Root yaw and translation can change after controller capture; the sampled source frame remains actor-relative.
  root.position.set(2.7, 0.3, -1.4);
  root.quaternion.setFromEuler(new THREE.Euler(0.13, 1.1, -0.07));
  root.scale.set(1.2, 0.85, 1.1);
  root.updateMatrixWorld(true);
  const lowerBodyTransforms = transformSnapshot(untouched);
  const untouchedWorldBones = untouched.filter((bone) => !bone.name.endsWith('Hand'));
  const lowerBodyWorld = untouchedWorldBones.map((bone) => actorPoint(root, bone));
  const watched = ['mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand']
    .map((name) => bones.get(name)!);
  const watchedRestTransforms = transformSnapshot(watched);
  const rootLocalLengths = [
    new THREE.Vector3(...nativeRest.RightArm).distanceTo(new THREE.Vector3(...nativeRest.RightForeArm)),
    new THREE.Vector3(...nativeRest.RightForeArm).distanceTo(new THREE.Vector3(...nativeRest.RightHand)),
  ];
  const handAtRest = actorPoint(root, watched[2]!);

  controller.apply(frame(sourceNeutral));
  const expectedUpperArmWorldDirection = new THREE.Vector3(...nativeRest.RightForeArm)
    .sub(new THREE.Vector3(...nativeRest.RightArm)).transformDirection(root.matrixWorld);
  const actualUpperArmWorldDirection = actorPoint(root, watched[1]!).sub(actorPoint(root, watched[0]!)).normalize();
  assert.ok(actualUpperArmWorldDirection.angleTo(expectedUpperArmWorldDirection) < 1e-6,
    'neutral source baseline retains corrected native direction under nonuniform actor scale');
  assert.ok(handAtRest.distanceTo(actorPoint(root, watched[2]!)) < 1e-6, 'neutral source baseline must not add bind-pose arm lowering');

  controller.apply(frame(sourcePose));
  const handAfterMotion = actorPoint(root, watched[2]!);
  assert.ok(handAtRest.distanceTo(handAfterMotion) > 0.08, 'source arm trajectory should visibly change the target hand position');
  assertTransformSnapshot(lowerBodyTransforms);
  lowerBodyWorld.forEach((point, index) => assert.ok(point.distanceTo(actorPoint(root, untouchedWorldBones[index]!)) < 1e-8));
  const rootLocalPoint = (bone: THREE.Bone) => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert());
  assert.ok(Math.abs(rootLocalLengths[0]! - rootLocalPoint(watched[0]!).distanceTo(rootLocalPoint(watched[1]!))) < 1e-8);
  assert.ok(Math.abs(rootLocalLengths[1]! - rootLocalPoint(watched[1]!).distanceTo(rootLocalPoint(watched[2]!))) < 1e-8);

  const firstResult = watched.map((bone) => bone.quaternion.clone());
  controller.apply(frame(sourcePose));
  watched.forEach((bone, index) => {
    const difference = bone.quaternion.angleTo(firstResult[index]!);
    assert.ok(difference < 1e-6, `same source frame must be deterministic for ${bone.name}; angular difference=${difference}`);
  });
  controller.restore();
  assertTransformSnapshot(watchedRestTransforms);
  controller.dispose();
});

test('rejects missing native bones and incomplete source frames without mutating the actor', () => {
  const { root, bones } = makeRig();
  const rest = restLandmarks(root, bones);
  const snapshot = transformSnapshot(bones.values());
  const missingRig = new THREE.Group();
  const options = { sourceRestLandmarks: rest, sourceNeutralLandmarks: rest };
  assert.throws(() => createNativeInteractionGestureController(missingRig, options), /requires bone/);
  const controller = createNativeInteractionGestureController(root, options);
  const bad = { ...frame(rest), landmarks: { ...rest, RightHand: undefined } } as unknown as NativeSourceFrame;
  assert.throws(() => controller.apply(bad), /finite RightHand/);
  assertTransformSnapshot(snapshot);
  controller.dispose();
  assert.throws(() => controller.apply(frame(rest)), /disposed/);
});

test('the bundled measured interact clip moves native arms relative to a sampled idle baseline', async (t) => {
  const sourceBytes = readFileSync(new URL('../assets/clip-pack.glb', import.meta.url));
  const arrayBuffer = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(arrayBuffer, '');
  const sampler = createNativeSourceLandmarkSampler(gltf.scene, gltf.animations);
  const neutralFrame = sampler.sampleClip('idle', 0, 'clamp');
  const { root, bones } = makeRig();
  const rest = restLandmarks(root, bones);
  const controller = createNativeInteractionGestureController(root, {
    sourceRestLandmarks: sampler.restLandmarks,
    sourceNeutralLandmarks: neutralFrame.landmarks,
  });
  t.after(() => { controller.dispose(); sampler.dispose(); });
  controller.apply(neutralFrame);
  const before = actorPoint(root, bones.get('mixamorigLeftHand')!);
  const interactFrame = sampler.sampleClip('interact', 0.4, 'clamp');
  controller.apply(interactFrame);
  const after = actorPoint(root, bones.get('mixamorigLeftHand')!);
  assert.ok(before.distanceTo(after) > 0.05, 'the actual clip-pack interaction hand trajectory must reach the native actor');
  assert.ok(actorPoint(root, bones.get('mixamorigHips')!).distanceTo(new THREE.Vector3(...rest.Hips)) < 1e-8);
  assert.ok(actorPoint(root, bones.get('mixamorigLeftFoot')!).distanceTo(new THREE.Vector3(...rest.LeftFoot)) < 1e-8);
});
