import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadCompleteCharacter } from './rig.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const authoredPath = path.join(repo, 'evidence/graphics-loop/authored-character-spike-v1/parametric-base-expressive.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const expected = {
  authored: '0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077',
  clip: '89a2c636d3',
};
const sha = (data) => createHash('sha256').update(data).digest('hex');
function imageFreeGlb(input) {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
  assert.equal(view.getUint32(4, true), 2, 'GLB v2');
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) binary = chunk;
    offset += length + 8;
  }
  assert(json && binary, 'GLB JSON/BIN chunks');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encoded.length + 3) & ~3;
  const binaryLength = (binary.length + 3) & ~3;
  const out = new Uint8Array(28 + jsonLength + binaryLength);
  const result = new DataView(out.buffer);
  result.setUint32(0, 0x46546c67, true); result.setUint32(4, 2, true); result.setUint32(8, out.length, true);
  result.setUint32(12, jsonLength, true); result.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jsonLength); out.set(encoded, 20);
  result.setUint32(20 + jsonLength, binaryLength, true); result.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(binary, 28 + jsonLength);
  return out.buffer;
}
async function loadGlb(bytes, stripImages) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(stripImages ? imageFreeGlb(bytes) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '/');
}
function makeSourceRig(scene) {
  scene.updateMatrixWorld(true);
  // clip-pack.glb intentionally contains the named animation hierarchy but no skin.
  // Treat its named hierarchy nodes as the source skeleton for SkeletonUtils.
  const boneNames = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
  const bones = boneNames.map((name) => scene.getObjectByName(name));
  assert(bones.every(Boolean), `clip source hierarchy is missing named joint(s): ${boneNames.filter((_, i) => !bones[i]).join(', ')}`);
  const inverses = bones.map((bone) => bone.matrixWorld.clone().invert());
  const skeleton = new THREE.Skeleton(bones, inverses);
  scene.skeleton = skeleton;
  return { root: scene, skeleton };
}
function hashObjectState(meshes) {
  return meshes.map((mesh) => ({
    name: mesh.name,
    morphs: Object.keys(mesh.morphTargetDictionary ?? {}).length,
    triangles: (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
    joints: mesh.skeleton.bones.length,
  }));
}
function boneSnapshot(actor) {
  actor.object.updateMatrixWorld(true);
  return actor.object.getObjectByName('mixamorigLeftArm').quaternion.toArray();
}
function posture(actor) {
  actor.object.updateMatrixWorld(true);
  const point = (name) => actor.object.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const hips = point('mixamorigHips'), head = point('mixamorigHead');
  const leftFoot = point('mixamorigLeftFoot'), rightFoot = point('mixamorigRightFoot');
  const leftHand = point('mixamorigLeftHand'), rightHand = point('mixamorigRightHand');
  const leftShoulder = point('mixamorigLeftShoulder'), rightShoulder = point('mixamorigRightShoulder');
  let bodyMinY = Infinity, bodyMaxY = -Infinity;
  actor.object.traverse((node) => {
    const mesh = node;
    if (!mesh.isSkinnedMesh || mesh.name !== 'Body') return;
    const vertex = new THREE.Vector3();
    const count = mesh.geometry.getAttribute('position').count;
    for (let index = 0; index < count; index++) {
      mesh.getVertexPosition(index, vertex);
      mesh.localToWorld(vertex);
      bodyMinY = Math.min(bodyMinY, vertex.y); bodyMaxY = Math.max(bodyMaxY, vertex.y);
    }
  });
  return {
    headAboveHips: head.y - hips.y,
    hipsAboveFeet: Math.min(hips.y - leftFoot.y, hips.y - rightFoot.y),
    leftHandBelowShoulder: leftShoulder.y - leftHand.y,
    rightHandBelowShoulder: rightShoulder.y - rightHand.y,
    leftHandFromHips: leftHand.clone().sub(hips).toArray(),
    rightHandFromHips: rightHand.clone().sub(hips).toArray(),
    leftArmLength: leftShoulder.distanceTo(leftHand),
    rightArmLength: rightShoulder.distanceTo(rightHand),
    bodyMinY, bodyMaxY,
    head: head.toArray(), hips: hips.toArray(), leftFoot: leftFoot.toArray(), rightFoot: rightFoot.toArray(),
    leftHand: leftHand.toArray(), rightHand: rightHand.toArray(),
  };
}

await MeshoptDecoder.ready;
const authoredBytes = readFileSync(authoredPath);
const clipBytes = readFileSync(clipPath);
const authoredSha = sha(authoredBytes), clipSha = sha(clipBytes);
assert.equal(authoredSha, expected.authored, 'authored source pin');
assert.equal(clipSha.slice(0, 10), expected.clip, 'clip-pack source pin');
const [authoredGltf, clipGltf] = await Promise.all([loadGlb(authoredBytes, true), loadGlb(clipBytes, false)]);
const sourceRig = makeSourceRig(clipGltf.scene);
const kits = [];
function makeKit() {
  const callbacks = new Set();
  let closed = false;
  const kit = {
    authoredCharacterAssets: {
      loadTemplate: async () => authoredGltf.scene,
      loadMotionRig: async () => ({ root: sourceRig.root, clips: clipGltf.animations }),
    },
    onDispose(callback) {
      if (closed) { callback(); return () => false; }
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    dispose() { if (closed) return; closed = true; for (const callback of [...callbacks]) callback(); callbacks.clear(); },
    get closed() { return closed; },
  };
  kits.push(kit);
  return kit;
}

const kit = makeKit();
const sourceMixer = new THREE.AnimationMixer(sourceRig.root);
let activeSourcePose = null;
function sourcePosture(seconds, pose) {
  if (activeSourcePose !== pose) {
    for (const clip of clipGltf.animations) sourceMixer.clipAction(clip).stop();
    sourceMixer.clipAction(clipGltf.animations.find((clip) => clip.name === pose)).reset().play();
    activeSourcePose = pose;
  }
  const clip = clipGltf.animations.find((candidate) => candidate.name === pose);
  sourceMixer.setTime(clip.duration > 0 ? seconds % clip.duration : 0);
  sourceRig.root.updateMatrixWorld(true);
  const point = (name) => sourceRig.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const hips = point('pelvis'), head = point('Head'), leftHand = point('hand_l'), rightHand = point('hand_r');
  const leftShoulder = point('clavicle_l'), rightShoulder = point('clavicle_r');
  return {
    height: head.y - hips.y,
    leftHandForward: Math.abs(leftHand.z - hips.z),
    rightHandForward: Math.abs(rightHand.z - hips.z),
    leftArmLength: leftShoulder.distanceTo(leftHand),
    rightArmLength: rightShoulder.distanceTo(rightHand),
  };
}
const looks = [
  { body: 'man', face: 'oval', expression: 'neutral', skin: '#7a4a2c', appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } },
  { body: 'woman', face: 'round', expression: 'smile', skin: '#c98e62', appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } },
];
const actors = [];
for (let i = 0; i < looks.length; i++) actors.push(await loadCompleteCharacter(kit, looks[i], `authored-rig-check-${i}`));
const postureSamples = [];
for (const [actorIndex, actor] of actors.entries()) {
  for (const pose of ['idle', 'walk'] ) {
    const clip = clipGltf.animations.find((candidate) => candidate.name === pose);
    assert(clip, `pinned clip ${pose} exists`);
    const times = pose === 'idle' ? [0, clip.duration * 0.25, clip.duration * 0.5] : [0, 0.25, 0.5, 0.75, 1.0, 1.25];
    for (const seconds of times) {
      actor.sample(seconds, pose);
      const measured = posture(actor);
      const sourceMeasured = sourcePosture(seconds, pose);
      const targetHeight = measured.headAboveHips;
      const sourceScale = targetHeight / sourceMeasured.height;
      const leftForwardTolerance = Math.abs(measured.leftArmLength - sourceMeasured.leftArmLength * sourceScale) + targetHeight * 0.025;
      const rightForwardTolerance = Math.abs(measured.rightArmLength - sourceMeasured.rightArmLength * sourceScale) + targetHeight * 0.025;
      const leftForwardError = Math.abs(Math.abs(measured.leftHandFromHips[2]) - sourceMeasured.leftHandForward * sourceScale);
      const rightForwardError = Math.abs(Math.abs(measured.rightHandFromHips[2]) - sourceMeasured.rightHandForward * sourceScale);
      postureSamples.push({ actorIndex, body: looks[actorIndex].body, pose, seconds, ...measured, sourceMeasured, sourceScale, leftForwardError, rightForwardError });
      assert(measured.headAboveHips > 0.3, `${looks[actorIndex].body} ${pose}@${seconds}: head must stay above hips`);
      assert(measured.hipsAboveFeet > 0.35, `${looks[actorIndex].body} ${pose}@${seconds}: legs must extend below hips`);
      assert(Math.abs(measured.hips[2]) < 0.2, `${looks[actorIndex].body} ${pose}@${seconds}: hip drifted out of the authored Y-up ground plane`);
      assert(measured.bodyMinY >= -0.04 && measured.bodyMinY <= 0.02,
        `${looks[actorIndex].body} ${pose}@${seconds}: deformed body surface left the authored floor band (${measured.bodyMinY})`);
      assert(leftForwardError <= leftForwardTolerance && rightForwardError <= rightForwardTolerance,
        `${looks[actorIndex].body} ${pose}@${seconds}: hand-forward error L/R ${leftForwardError}/${rightForwardError} exceeds arm-length-scaled tolerances ${leftForwardTolerance}/${rightForwardTolerance}`);
      assert(measured.leftHandBelowShoulder > -0.05 && measured.rightHandBelowShoulder > -0.05,
        `${looks[actorIndex].body} ${pose}@${seconds}: hands must not rise above shoulders`);
    }
  }
}
assert.notEqual(actors[0].object, actors[1].object, 'actor roots are independent');
const meshesA = []; actors[0].object.traverse((node) => { if (node.isSkinnedMesh) meshesA.push(node); });
const meshesB = []; actors[1].object.traverse((node) => { if (node.isSkinnedMesh) meshesB.push(node); });
assert.equal(meshesA.length, 4); assert.equal(meshesB.length, 4);
for (let i = 0; i < meshesA.length; i++) {
  assert.equal(meshesA[i].geometry, meshesB[i].geometry, `${meshesA[i].name} immutable geometry shared`);
  assert.notEqual(meshesA[i].skeleton, meshesB[i].skeleton, `${meshesA[i].name} skeleton independent`);
  assert.notEqual(meshesA[i].material, meshesB[i].material, `${meshesA[i].name} material independent`);
}
const actor0Initial = boneSnapshot(actors[0]);
const actor1Initial = boneSnapshot(actors[1]);
assert.equal(meshesA.find((mesh) => mesh.name === 'Body').morphTargetInfluences[
  meshesA.find((mesh) => mesh.name === 'Body').morphTargetDictionary.bodyMasculine
], 1, 'man look applies masculine body morph');
assert.equal(meshesB.find((mesh) => mesh.name === 'Body').morphTargetInfluences[
  meshesB.find((mesh) => mesh.name === 'Body').morphTargetDictionary.bodyFeminine
], 1, 'woman look applies feminine body morph');
actors[0].sample(0.73, 'walk');
const actor0Walk = boneSnapshot(actors[0]);
const actor1AfterOtherWalk = boneSnapshot(actors[1]);
assert.notDeepEqual(actor0Walk, actor0Initial, 'walk retarget changes a target bone');
assert.deepEqual(actor1AfterOtherWalk, actor1Initial, 'other actor pose is isolated');
actors[1].sample(0.91, 'dance');
const actor1Dance = boneSnapshot(actors[1]);
assert.notDeepEqual(actor1Dance, actor1Initial, 'dance retarget changes a target bone');
actors[0].setExpression('grin', 0);
const bodyA = meshesA.find((mesh) => mesh.name === 'Body');
const grinIndex = bodyA.morphTargetDictionary.mouthCornersUp;
assert.ok(bodyA.morphTargetInfluences[grinIndex] > 0.5, 'grin expression applies authored morph');
const sharedGeometry = meshesA[0].geometry;
const ownedMaterial = meshesA[0].material;
let materialDisposeEvents = 0, geometryDisposeEvents = 0;
ownedMaterial.addEventListener('dispose', () => materialDisposeEvents++);
sharedGeometry.addEventListener('dispose', () => geometryDisposeEvents++);
actors[0].dispose();
assert.equal(materialDisposeEvents, 1, 'actor disposal releases its owned material');
assert.equal(geometryDisposeEvents, 0, 'actor disposal leaves Kit-owned shared geometry alive');
assert.equal(meshesB[0].geometry, sharedGeometry, 'disposing actor leaves shared geometry alive');
const stage = new THREE.Group();
stage.add(actors[1].object);
kit.dispose();
assert.equal(actors[1].object.parent, null, 'Kit teardown detaches remaining actor');
assert.equal(actors[1].metrics.triangleCount, actors[0].metrics.triangleCount);
const disposedKit = makeKit(); disposedKit.dispose();
await assert.rejects(loadCompleteCharacter(disposedKit, looks[0], 'disposed-kit'), /kit was disposed/,
  'an already-disposed Kit cannot publish a new actor');
const report = {
  status: 'PASS',
  source: { authoredSha256: authoredSha, authoredBytes: authoredBytes.length, clipPackSha256: clipSha, clipPackBytes: clipBytes.length },
  template: hashObjectState(meshesA),
  clips: clipGltf.animations.map((clip) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })),
  retargeted: actors[0].metrics.retargetedClipNames,
  actors: actors.map((actor) => actor.metrics),
  isolation: { actorRoots: true, independentSkeletons: true, independentMaterials: true, sharedGeometry: true, independentWalkAndDance: true, kitTeardownDetachesActors: true },
  postureSamples,
  caveats: ['CPU-only loader/rig check; no rendered visual acceptance.', 'Authored body material is image-stripped for this bounded test.', 'Look-to-morph values are provisional; skin-color match, wardrobe, hair, accessories and non-adult age variation are not validated.'],
  elapsedMs: Math.round(performance.now()),
};
writeFileSync(path.join(here, 'rig-posture-check-result.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
