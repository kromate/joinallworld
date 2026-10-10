import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { createNativeNeutralPose } from './native-neutral-pose.ts';
import { applyNativeFamilyRigCorrection } from './native-family-rig-correction.ts';
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

type AuthoredNodeRecord = {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
};

function reconstructedAuthoredRig(): Rig {
  const bytes = readFileSync(new URL('./authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb', import.meta.url));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
    'reconstructed native rig test must use the pinned authored body asset');
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as {
    readonly nodes: readonly AuthoredNodeRecord[];
    readonly scenes: readonly { readonly nodes: readonly number[] }[];
    readonly scene?: number;
    readonly skins: readonly { readonly joints: readonly number[] }[];
  };
  const jointIndices = new Set(document.skins[0]!.joints);
  const objects = document.nodes.map((node, index) => {
    const object = jointIndices.has(index) ? new THREE.Bone() : new THREE.Group();
    object.name = node.name?.startsWith('mixamorig:') ? node.name.replace('mixamorig:', 'mixamorig') : node.name ?? `node-${index}`;
    if (node.translation) object.position.set(node.translation[0]!, node.translation[1]!, node.translation[2]!);
    if (node.rotation) object.quaternion.set(node.rotation[0]!, node.rotation[1]!, node.rotation[2]!, node.rotation[3]!);
    if (node.scale) object.scale.set(node.scale[0]!, node.scale[1]!, node.scale[2]!);
    return object;
  });
  document.nodes.forEach((node, index) => node.children?.forEach((child) => objects[index]!.add(objects[child]!)));
  const root = new THREE.Group();
  for (const sceneRoot of document.scenes[document.scene ?? 0]!.nodes) root.add(objects[sceneRoot]!);
  const bones = new Map<string, THREE.Bone>();
  root.traverse((node) => { if (node instanceof THREE.Bone) bones.set(node.name, node); });
  root.updateMatrixWorld(true);
  const skeletonBones = document.skins[0]!.joints.map((index) => objects[index] as THREE.Bone);
  const inverseBinds = skeletonBones.map((bone) => bone.matrixWorld.clone().invert());
  const skeleton = new THREE.Skeleton(skeletonBones, inverseBinds);
  let bodyMesh: THREE.SkinnedMesh | undefined;
  for (const name of ['Body', 'Eyes', 'Teeth', 'Tongue']) {
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = name;
    mesh.bind(skeleton, new THREE.Matrix4());
    if (name === 'Body') {
      mesh.morphTargetDictionary = { bodyFeminine: 0, bodyMasculine: 1 };
      mesh.morphTargetInfluences = [0, 1];
      bodyMesh = mesh;
    }
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  assert.ok(bodyMesh);
  return { root, bones, body: bodyMesh };
}

test('measured arm motion changes the native reach while transformed-root lower body and lengths stay fixed', () => {
  const { root, bones } = makeRig();
  // Give both right arm segments a measurable axial twist before the controller captures
  // the corrected native rest. Their segment directions are unchanged, but distal frame
  // orientation is not; a swing-only reconstruction would silently erase this twist.
  const rightArm = bones.get('mixamorigRightArm')!;
  const rightForeArm = bones.get('mixamorigRightForeArm')!;
  rightArm.quaternion.setFromAxisAngle(rightForeArm.position.clone().normalize(), 0.63);
  const rightHand = bones.get('mixamorigRightHand')!;
  rightForeArm.quaternion.setFromAxisAngle(rightHand.position.clone().normalize(), -0.41);
  root.updateMatrixWorld(true);
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
  const rightShoulder = bones.get('mixamorigRightShoulder')!;
  const twistedShoulderRest = rightShoulder.quaternion.clone();
  const twistedArmRest = rightArm.quaternion.clone();
  const twistedForeArmRest = rightForeArm.quaternion.clone();
  rightHand.updateWorldMatrix(true, false);
  const handWorldMatrixAtNeutral = rightHand.matrixWorld.clone();
  const handWorldOrientationAtNeutral = new THREE.Quaternion();
  handWorldMatrixAtNeutral.decompose(new THREE.Vector3(), handWorldOrientationAtNeutral, new THREE.Vector3());
  const captureDecomposedQuaternionLength = handWorldOrientationAtNeutral.length();
  const accessorQuaternionAtNeutral = rightHand.getWorldQuaternion(new THREE.Quaternion());
  handWorldOrientationAtNeutral.normalize();
  const rootLocalLengths = [
    new THREE.Vector3(...nativeRest.RightArm).distanceTo(new THREE.Vector3(...nativeRest.RightForeArm)),
    new THREE.Vector3(...nativeRest.RightForeArm).distanceTo(new THREE.Vector3(...nativeRest.RightHand)),
  ];
  const handAtRest = actorPoint(root, watched[2]!);

  controller.apply(frame(sourceNeutral));
  assert.ok(1 - Math.abs(rightShoulder.quaternion.dot(twistedShoulderRest)) < 1e-10,
    'neutral retarget must preserve the captured shoulder axial twist');
  assert.ok(1 - Math.abs(rightArm.quaternion.dot(twistedArmRest)) < 1e-10,
    'neutral retarget must preserve the captured upper-arm axial twist');
  assert.ok(1 - Math.abs(rightForeArm.quaternion.dot(twistedForeArmRest)) < 1e-10,
    'neutral retarget must preserve the captured forearm axial twist');
  rightHand.updateWorldMatrix(true, false);
  const handMatrixDelta = Math.max(...rightHand.matrixWorld.elements.map((value, index) => Math.abs(value - handWorldMatrixAtNeutral.elements[index]!)));
  assert.ok(handMatrixDelta < 1e-10, `neutral retarget must preserve distal hand world matrix (max delta=${handMatrixDelta})`);
  const handWorldOrientationAfterNeutral = new THREE.Quaternion();
  rightHand.matrixWorld.decompose(new THREE.Vector3(), handWorldOrientationAfterNeutral, new THREE.Vector3());
  const postDecomposedQuaternionLength = handWorldOrientationAfterNeutral.length();
  const accessorQuaternionAfterNeutral = rightHand.getWorldQuaternion(new THREE.Quaternion());
  handWorldOrientationAfterNeutral.normalize();
  if (process.env.NATIVE_INTERACTION_WORLD_MATRIX_DIAGNOSTICS === '1') {
    const diagnostics = {
      captureSequence: 'updateWorldMatrix(root=true, children=false); clone matrixWorld; decompose; then getWorldQuaternion refresh',
      postSequence: 'controller.apply; updateWorldMatrix(root=true, children=false); compare matrixWorld; decompose; then getWorldQuaternion refresh',
      maxHandWorldMatrixElementDelta: handMatrixDelta,
      captureDecomposedQuaternionLengthBeforeNormalize: captureDecomposedQuaternionLength,
      postDecomposedQuaternionLengthBeforeNormalize: postDecomposedQuaternionLength,
      captureAccessorQuaternionLength: accessorQuaternionAtNeutral.length(),
      postAccessorQuaternionLength: accessorQuaternionAfterNeutral.length(),
      captureVsPostAccessorAngleRadians: accessorQuaternionAtNeutral.angleTo(accessorQuaternionAfterNeutral),
      captureVsPostNormalizedMatrixQuaternionAngleRadians: handWorldOrientationAtNeutral.angleTo(handWorldOrientationAfterNeutral),
    };
    if (!process.env.NATIVE_INTERACTION_WORLD_MATRIX_REPORT) throw new Error('world matrix diagnostics requires an explicit report path');
    writeFileSync(process.env.NATIVE_INTERACTION_WORLD_MATRIX_REPORT, `${JSON.stringify(diagnostics, null, 2)}\n`);
  }
  assert.ok(1 - Math.abs(handWorldOrientationAfterNeutral.dot(handWorldOrientationAtNeutral)) < 1e-10,
    `neutral retarget must preserve the distal hand world orientation (angle=${handWorldOrientationAfterNeutral.angleTo(handWorldOrientationAtNeutral)})`);
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

test('actual authored male and female family-corrected neutral frames retain local axial twist and hand orientation', async (t) => {
  const sourceBytes = readFileSync(new URL('../assets/clip-pack.glb', import.meta.url));
  const arrayBuffer = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(arrayBuffer, '');
  const sampler = createNativeSourceLandmarkSampler(gltf.scene, gltf.animations);
  const neutralSource = sampler.sampleClip('idle', 0, 'clamp');
  t.after(() => sampler.dispose());

  for (const asset of ['male', 'female'] as const) {
    const { root, bones, body } = reconstructedAuthoredRig();
    body.morphTargetInfluences![0] = asset === 'female' ? 1 : 0;
    body.morphTargetInfluences![1] = asset === 'male' ? 1 : 0;
    const familyCorrection = applyNativeFamilyRigCorrection(root);
    assert.equal(familyCorrection.metrics.familyWeights[asset], 1);
    const neutralPose = createNativeNeutralPose(root);
    neutralPose.apply();
    const nativeNeutral = restLandmarks(root, bones);
    const armNames = [
      'mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm',
      'mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm',
    ];
    const localNeutralQuaternions = armNames.map((name) => bones.get(name)!.quaternion.clone());
    const handOrientations = ['mixamorigLeftHand', 'mixamorigRightHand']
      .map((name) => bones.get(name)!.getWorldQuaternion(new THREE.Quaternion()));
    const controller = createNativeInteractionGestureController(root, {
      sourceRestLandmarks: sampler.restLandmarks,
      sourceNeutralLandmarks: neutralSource.landmarks,
    });
    controller.apply(neutralSource);
    armNames.forEach((name, index) => assert.ok(
      1 - Math.abs(bones.get(name)!.quaternion.dot(localNeutralQuaternions[index]!)) < 1e-8,
      `${asset} ${name} corrected neutral local rotation must be retained`,
    ));
    ['mixamorigLeftHand', 'mixamorigRightHand'].forEach((name, index) => assert.ok(
      1 - Math.abs(bones.get(name)!.getWorldQuaternion(new THREE.Quaternion()).dot(handOrientations[index]!)) < 1e-8,
      `${asset} ${name} world orientation must be retained`,
    ));
    assert.ok(actorPoint(root, bones.get('mixamorigHips')!).distanceTo(new THREE.Vector3(...nativeNeutral.Hips)) < 1e-8);
    controller.dispose();
    neutralPose.dispose();
    familyCorrection.dispose();
  }
});
