import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from '/workspace/remote-verification/repositories/coordinator-graphics-wiring/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/workspace/remote-verification/repositories/coordinator-graphics-wiring/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/workspace/remote-verification/repositories/coordinator-graphics-wiring/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
import { createNativeSourceLandmarkSampler } from '/workspace/remote-verification/repositories/worker-graphics-native-interaction-temporal-29df/src/scene/body/native/native-source-sampler.ts';
import { createNativeNeutralPose } from '/workspace/remote-verification/repositories/worker-graphics-native-interaction-temporal-29df/src/scene/body/native/native-neutral-pose.ts';
import { applyNativeFamilyRigCorrection } from '/workspace/remote-verification/repositories/worker-graphics-native-interaction-temporal-29df/src/scene/body/native/native-family-rig-correction.ts';
import { createNativeWristOrientationController } from '/workspace/remote-verification/repositories/worker-graphics-native-interaction-temporal-29df/src/scene/body/native/native-wrist-orientation/native-wrist-controller.ts';

const repo = '/workspace/remote-verification/repositories/worker-graphics-native-interaction-temporal-29df';
const authoredPath = path.join(repo, 'src/scene/body/native/authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const expected = {
  authored: 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
  clips: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const authoredBytes = readFileSync(authoredPath), clipBytes = readFileSync(clipPath);
assert.equal(digest(authoredBytes), expected.authored, 'authored source must match pinned native 52-bone target asset');
assert.equal(digest(clipBytes), expected.clips, 'source clips must match pinned source clip pack');

function reconstructAuthoredRig(bytes, family) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const jointIndices = new Set(document.skins[0].joints);
  const objects = document.nodes.map((node, index) => {
    const object = jointIndices.has(index) ? new THREE.Bone() : new THREE.Group();
    object.name = node.name?.startsWith('mixamorig:') ? node.name.replace('mixamorig:', 'mixamorig') : node.name ?? `node-${index}`;
    if (node.translation) object.position.set(...node.translation);
    if (node.rotation) object.quaternion.set(...node.rotation);
    if (node.scale) object.scale.set(...node.scale);
    return object;
  });
  document.nodes.forEach((node, index) => node.children?.forEach((child) => objects[index].add(objects[child])));
  const root = new THREE.Group();
  for (const sceneRoot of document.scenes[document.scene ?? 0].nodes) root.add(objects[sceneRoot]);
  const bones = new Map();
  root.traverse((node) => { if (node instanceof THREE.Bone) bones.set(node.name, node); });
  root.updateMatrixWorld(true);
  const skeletonBones = document.skins[0].joints.map((index) => objects[index]);
  const skeleton = new THREE.Skeleton(skeletonBones, skeletonBones.map((bone) => bone.matrixWorld.clone().invert()));
  let body;
  for (const name of ['Body', 'Eyes', 'Teeth', 'Tongue']) {
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = name;
    mesh.bind(skeleton, new THREE.Matrix4());
    if (name === 'Body') {
      mesh.morphTargetDictionary = { bodyFeminine: 0, bodyMasculine: 1 };
      mesh.morphTargetInfluences = family === 'female' ? [1, 0] : [0, 1];
      body = mesh;
    }
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  assert.equal(bones.size, 52);
  return { root, bones, body };
}
function angle(a, b) { return a.angleTo(b); }
function relQuat(root, node) {
  root.updateWorldMatrix(true, true);
  return root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(node.getWorldQuaternion(new THREE.Quaternion())).normalize();
}
function relWrist(forearm, hand) { return forearm.clone().invert().multiply(hand).normalize(); }
function quaternionRecord(q) { return { xyzw: q.toArray(), norm: q.length() }; }
function segment(root, parent, child) {
  root.updateMatrixWorld(true);
  return root.getObjectByName(parent).getWorldPosition(new THREE.Vector3())
    .distanceTo(root.getObjectByName(child).getWorldPosition(new THREE.Vector3()));
}
function sideSnapshot(root, side) {
  const forearm = root.getObjectByName(`mixamorig${side}ForeArm`);
  const hand = root.getObjectByName(`mixamorig${side}Hand`);
  const forearmRoot = relQuat(root, forearm);
  const handRoot = relQuat(root, hand);
  return {
    forearmLocal: quaternionRecord(forearm.quaternion.clone()), forearmRoot: quaternionRecord(forearmRoot),
    handLocal: quaternionRecord(hand.quaternion.clone()), handRoot: quaternionRecord(handRoot),
    handRelativeToForearm: quaternionRecord(relWrist(forearmRoot, handRoot)),
    forearmHandLengthMeters: segment(root, `mixamorig${side}ForeArm`, `mixamorig${side}Hand`),
  };
}
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const clipArray = clipBytes.buffer.slice(clipBytes.byteOffset, clipBytes.byteOffset + clipBytes.byteLength);
const sourceGltf = await gltfLoader.parseAsync(clipArray, '');
const sampler = createNativeSourceLandmarkSampler(sourceGltf.scene, sourceGltf.animations);
const sourceFrame = (clipName, seconds) => {
  const frame = sampler.sampleClip(clipName, seconds, 'clamp');
  return Object.fromEntries(['left', 'right'].map((side) => {
    const forearm = frame.wristRotations.forearm[side].clone();
    const hand = frame.wristRotations.hand[side].clone();
    return [side, {
      forearmRoot: quaternionRecord(forearm), handRoot: quaternionRecord(hand),
      handRelativeToForearm: quaternionRecord(relWrist(forearm, hand)),
    }];
  }));
};
const source = {
  restWrist: Object.fromEntries(['left', 'right'].map((side) => [side, {
    forearmRoot: quaternionRecord(sampler.restWristRotations.forearm[side].clone()),
    handRoot: quaternionRecord(sampler.restWristRotations.hand[side].clone()),
    handRelativeToForearm: quaternionRecord(relWrist(sampler.restWristRotations.forearm[side], sampler.restWristRotations.hand[side])),
  }])),
  idle0: sourceFrame('idle', 0),
  idle7667: sourceFrame('idle', 0.7666666666666667),
  interact7667: sourceFrame('interact', 0.7666666666666667),
};
const families = {};
for (const family of ['male', 'female']) {
  const { root, bones } = reconstructAuthoredRig(authoredBytes, family);
  const correction = applyNativeFamilyRigCorrection(root);
  const bind = Object.fromEntries(['Left', 'Right'].map((side) => [side, sideSnapshot(root, side)]));
  const neutral = createNativeNeutralPose(root);
  neutral.apply();
  const neutralFrame = Object.fromEntries(['Left', 'Right'].map((side) => [side, sideSnapshot(root, side)]));
  neutral.restore();
  const wrist = createNativeWristOrientationController(root, sampler.restWristRotations);
  neutral.apply();
  const controllerInput = {};
  for (const [label, seconds] of [['idle0', 0], ['idle7667', 0.7666666666666667], ['interact7667', 0.7666666666666667]]) {
    const clip = label.startsWith('idle') ? 'idle' : 'interact';
    const frame = sampler.sampleClip(clip, seconds, 'clamp');
    const before = Object.fromEntries(['Left', 'Right'].map((side) => [side, sideSnapshot(root, side)]));
    const result = wrist.apply(frame);
    const after = Object.fromEntries(['Left', 'Right'].map((side) => [side, sideSnapshot(root, side)]));
    controllerInput[label] = { controller: result, before, after,
      deltaFromNeutralLocalHandRadians: Object.fromEntries(['Left', 'Right'].map((side) => [side,
        angle(new THREE.Quaternion().fromArray(neutralFrame[side].handLocal.xyzw), new THREE.Quaternion().fromArray(after[side].handLocal.xyzw))])) };
    wrist.restore();
  }
  const familyDelta = Object.fromEntries(['Left', 'Right'].map((side) => [side, {
    bindToNeutralForearmRootRadians: angle(new THREE.Quaternion().fromArray(bind[side].forearmRoot.xyzw), new THREE.Quaternion().fromArray(neutralFrame[side].forearmRoot.xyzw)),
    bindToNeutralHandRootRadians: angle(new THREE.Quaternion().fromArray(bind[side].handRoot.xyzw), new THREE.Quaternion().fromArray(neutralFrame[side].handRoot.xyzw)),
    bindToNeutralHandLocalRadians: angle(new THREE.Quaternion().fromArray(bind[side].handLocal.xyzw), new THREE.Quaternion().fromArray(neutralFrame[side].handLocal.xyzw)),
    neutralForearmHandLengthMeters: neutralFrame[side].forearmHandLengthMeters,
  }]));
  families[family] = { correctionMetrics: correction.metrics, bind, correctedNeutral: neutralFrame, familyDelta, controllerInput };
  wrist.dispose(); neutral.dispose(); correction.dispose();
  // Keep references alive until disposal, then dispose the synthetic mesh/material data.
  root.traverse((node) => { if (node instanceof THREE.SkinnedMesh) { node.geometry.dispose(); node.material.dispose(); } });
  for (const bone of bones.values()) bone.clear();
}
sampler.dispose();
const report = {
  schema: 'native-wrist-source-target-causal-diagnostic.v1',
  status: 'measured-source-and-authored-native-rest-frames',
  provenance: { sourceHead: '93bc1acc87dc7e80373910d20a25daf6078e5b24', sourceClean: true,
    authoredPath: path.relative(repo, authoredPath), authoredSha256: digest(authoredBytes), authoredBoneCount: 52,
    clipPath: path.relative(repo, clipPath), clipSha256: digest(clipBytes),
    sourceSourceRig: 'clip-pack.glb private source skeleton, sampled by production NativeSourceLandmarkSampler',
    targetRig: 'pinned authored-body GLB node hierarchy reconstructed with actual authored bind transforms and 52 source joint nodes; actual native family correction and NativeNeutralPose applied; no skin/garment claims',
    dependencyRealpath: '/workspace/remote-verification/repositories/coordinator-graphics-wiring/node_modules (same-lockfile shared dependency symlink)' },
  clipSampling: { idle: [0, 0.7666666666666667], interact: [0.7666666666666667], secondsClamped: true },
  source, families,
  sourceDeltas: Object.fromEntries(['left', 'right'].map((side) => {
    const quat = (x) => new THREE.Quaternion().fromArray(x[side].handRelativeToForearm.xyzw);
    return [side, {
      restToIdle0Radians: angle(quat(source.restWrist), quat(source.idle0)),
      restToIdle7667Radians: angle(quat(source.restWrist), quat(source.idle7667)),
      idle0ToInteract7667Radians: angle(quat(source.idle0), quat(source.interact7667)),
      bindRestToInteract7667Radians: angle(quat(source.restWrist), quat(source.interact7667)),
    }];
  })),
};
const out = '/workspace/remote-verification/worker-results/native-interaction-temporal/wrist-causal/wrist-causal-measurement.json';
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, output: out, sourceHead: report.provenance.sourceHead,
  authoredSha256: report.provenance.authoredSha256, clipSha256: report.provenance.clipSha256,
  sourceDeltas: report.sourceDeltas, familyDelta: Object.fromEntries(Object.entries(families).map(([name, value]) => [name, value.familyDelta])) }, null, 2));
