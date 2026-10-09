import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadCompleteCharacter } from './rig.ts';
import { createNativeActionController } from './native-actions.ts';
import { createNativeHandPoseController } from './native-hand-pose.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'parametric-base-facial.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const pins = {
  body: '9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd',
  clip: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
};
const sha = (data) => createHash('sha256').update(data).digest('hex');

function imageFreeGlb(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67); assert.equal(view.getUint32(4, true), 2);
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true);
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) binary = chunk;
    offset += length + 8;
  }
  assert(json && binary, 'GLB JSON and BIN chunks');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encoded.length + 3) & ~3, binaryLength = (binary.length + 3) & ~3;
  const output = new Uint8Array(28 + jsonLength + binaryLength), result = new DataView(output.buffer);
  result.setUint32(0, 0x46546c67, true); result.setUint32(4, 2, true); result.setUint32(8, output.length, true);
  result.setUint32(12, jsonLength, true); result.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + jsonLength); output.set(encoded, 20);
  result.setUint32(20 + jsonLength, binaryLength, true); result.setUint32(24 + jsonLength, 0x004e4942, true);
  output.set(binary, 28 + jsonLength);
  return output.buffer;
}

async function parseGlb(bytes) {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(imageFreeGlb(bytes), '/');
}

function makeClipRig(scene) {
  scene.updateMatrixWorld(true);
  const names = ['pelvis','spine_01','spine_02','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l',
    'clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r'];
  const bones = names.map((name) => scene.getObjectByName(name));
  assert(bones.every(Boolean), 'pinned clip rig has all 22 mapped bones');
  scene.skeleton = new THREE.Skeleton(bones, bones.map((bone) => bone.matrixWorld.clone().invert()));
  return scene;
}

function makeKit(template, motionRoot, clips) {
  const callbacks = new Set(); let closed = false;
  return {
    authoredCharacterAssets: { loadTemplate: async () => template, loadMotionRig: async () => ({ root: motionRoot, clips }) },
    onDispose(fn) { if (closed) { fn(); return () => false; } callbacks.add(fn); return () => callbacks.delete(fn); },
    dispose() { if (closed) return; closed = true; for (const fn of [...callbacks]) { callbacks.delete(fn); fn(); } },
    get callbackCount() { return callbacks.size; },
  };
}

function fingerBoneSnapshot(root) {
  const out = {};
  root.traverse((node) => { if (node.isBone && /Hand(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(node.name)) out[node.name] = node.quaternion.toArray(); });
  return out;
}

function finiteSkinnedState(root) {
  root.updateMatrixWorld(true);
  const skeletons = new Set();
  root.traverse((node) => { if (node.isSkinnedMesh) skeletons.add(node.skeleton); });
  skeletons.forEach((skeleton) => skeleton.update());
  const point = new THREE.Vector3(); let count = 0, minY = Infinity, maxY = -Infinity;
  root.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const position = node.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      node.getVertexPosition(i, point); node.localToWorld(point);
      assert.ok([point.x, point.y, point.z].every(Number.isFinite), `${node.name} vertex ${i} finite`);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); count++;
    }
  });
  assert.ok(count > 0 && Number.isFinite(minY) && Number.isFinite(maxY), 'actual skinned actor bounds finite');
  return { vertexSamples: count, minY, maxY };
}

function fingerWeightedPositions(root) {
  root.updateMatrixWorld(true);
  const output = [];
  const point = new THREE.Vector3();
  root.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const indices = node.geometry.getAttribute('skinIndex'), weights = node.geometry.getAttribute('skinWeight');
    for (let i = 0; i < indices.count; i++) {
      let fingerWeight = 0;
      for (let c = 0; c < 4; c++) {
        const bone = node.skeleton.bones[indices.getComponent(i, c)];
        if (bone && /Hand(?:Thumb|Index|Middle|Ring|Pinky)[123]$/.test(bone.name)) fingerWeight += weights.getComponent(i, c);
      }
      if (fingerWeight < 0.25) continue;
      node.getVertexPosition(i, point); node.localToWorld(point);
      assert.ok([point.x, point.y, point.z].every(Number.isFinite), `${node.name} finger-weighted vertex ${i} finite`);
      output.push(point.toArray());
    }
  });
  assert.ok(output.length > 0, 'real GLB has finger-weighted skinned vertices');
  return output;
}

function assertArraysClose(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance,
    `${label}[${index}] ${value} differs from ${expected[index]}`));
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), clipBytes = readFileSync(clipPath);
assert.equal(sha(bodyBytes), pins.body, 'pinned authored body input');
assert.equal(sha(clipBytes), pins.clip, 'pinned clip-pack input');
const [bodyGltf, clipGltf] = await Promise.all([parseGlb(bodyBytes), parseGlb(clipBytes)]);
const kit = makeKit(bodyGltf.scene, makeClipRig(clipGltf.scene), clipGltf.animations);
const actors = [];
const resultRows = [];
for (const family of ['man', 'woman']) {
  const look = { body: family, face: 'oval', expression: 'neutral', skin: family === 'man' ? '#7a4a2c' : '#c98e62',
    hair: 'lowcut', outfit: 'casual', outfitColor: '#3f72c4', bottomsColor: '#243a66', fabric: 'plain', accessories: [],
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } };
  const character = await loadCompleteCharacter(kit, look, `native-hand-check-${family}`);
  const parent = new THREE.Group();
  parent.position.set(0.31, -0.12, 0.20);
  parent.rotation.set(0.05, 0.37, -0.04);
  parent.scale.setScalar(1.03);
  parent.add(character.object);
  const body = character.object.getObjectByName('Body');
  const actions = createNativeActionController(character.object);
  const hands = createNativeHandPoseController(character.object);
  character.object.position.set(0.17, 0.23, -0.31);
  character.object.rotation.set(0.08, 0.43, -0.05);
  character.object.scale.setScalar(1.07);
  parent.updateWorldMatrix(true, true);
  const beforeRoot = { position: character.object.position.toArray(), scale: character.object.scale.toArray(), quaternion: character.object.quaternion.toArray() };
  const beforeParent = { position: parent.position.toArray(), scale: parent.scale.toArray(), quaternion: parent.quaternion.toArray() };
  const rest = fingerBoneSnapshot(character.object);
  const idle = actions.apply(0.25, 'idle', { kind: 'floor' });
  const idleFingerVertices = fingerWeightedPositions(character.object);
  const relaxed = hands.apply('relaxed', 0.25);
  const relaxedState = fingerBoneSnapshot(character.object);
  const relaxedFingerVertices = fingerWeightedPositions(character.object);
  const relaxedBounds = finiteSkinnedState(character.object);
  const grip = hands.apply('grip', 0.25);
  const gripState = fingerBoneSnapshot(character.object);
  const gripFingerVertices = fingerWeightedPositions(character.object);
  const gripBounds = finiteSkinnedState(character.object);
  assert.ok(relaxed.maxJointDeltaRadians > 0.03, `${family}: relaxed mode flexes actual finger joints`);
  assert.ok(grip.maxJointDeltaRadians > relaxed.maxJointDeltaRadians + 0.2, `${family}: grip mode visibly changes more finger-joint rotation than relaxed`);
  assert.notDeepEqual(relaxedState, rest, `${family}: relaxed pose changes the authored open-hand rest pose`);
  hands.restore();
  assert.deepEqual(fingerBoneSnapshot(character.object), rest, `${family}: restore returns all 30 finger bones to their captured authored pose`);
  const maxVertexDelta = (a, b) => Math.max(...a.map((point, i) => Math.hypot(point[0] - b[i][0], point[1] - b[i][1], point[2] - b[i][2])));
  assert.ok(maxVertexDelta(idleFingerVertices, relaxedFingerVertices) > 0.001, `${family}: relaxed pose changes actual finger-weighted skin vertices`);
  assert.ok(maxVertexDelta(relaxedFingerVertices, gripFingerVertices) > 0.01, `${family}: grip changes actual finger-weighted skin vertices`);
  for (const side of ['left', 'right']) assert.ok(grip.palmGap[side] < relaxed.palmGap[side], `${family}/${side}: grip curls fingertips toward the measured palm anchor`);
  assert.ok(Object.keys(gripState).length === 30, `${family}: all 30 finger joints remain present`);
  assert.ok(gripBounds.maxY - gripBounds.minY > 0 && relaxedBounds.maxY - relaxedBounds.minY > 0, `${family}: body bounds remain finite in both modes`);
  const walk = actions.apply(0.75, 'walk', { kind: 'floor' });
  const walkHands = hands.apply('walk', 0.75);
  const oppositeWalkHands = hands.apply('walk', 1.25);
  assert.notDeepEqual(walkHands.fingertipPositions, oppositeWalkHands.fingertipPositions, `${family}: host phase changes the walk hand pose`);
  const afterRoot = { position: character.object.position.toArray(), scale: character.object.scale.toArray(), quaternion: character.object.quaternion.toArray() };
  assert.deepEqual(afterRoot, beforeRoot, `${family}: hand controller preserves actor root placement`);
  const afterParent = { position: parent.position.toArray(), scale: parent.scale.toArray(), quaternion: parent.quaternion.toArray() };
  assert.deepEqual(afterParent, beforeParent, `${family}: hand controller preserves transformed parent`);

  // The same local hand pose and actor-local palm measurements must survive removal of the
  // translated/rotated parent transform; this catches world-origin-dependent palm anchors.
  parent.position.set(0, 0, 0); parent.rotation.set(0, 0, 0); parent.scale.setScalar(1);
  character.object.position.set(0, 0, 0); character.object.rotation.set(0, 0, 0); character.object.scale.setScalar(1);
  parent.updateWorldMatrix(true, true);
  actions.apply(0.25, 'idle', { kind: 'floor' });
  const untransformedRelaxed = hands.apply('relaxed', 0.25);
  const untransformedState = fingerBoneSnapshot(character.object);
  for (const name of Object.keys(relaxedState)) assertArraysClose(untransformedState[name], relaxedState[name], 1e-8, `${family}/${name} rigid-transform equivariance`);
  for (const side of ['left', 'right']) assert.ok(Math.abs(untransformedRelaxed.palmGap[side] - relaxed.palmGap[side]) < 1e-8,
    `${family}/${side}: palm gap is invariant under parent translation and rotation`);
  parent.position.fromArray(beforeParent.position); parent.quaternion.fromArray(beforeParent.quaternion); parent.scale.fromArray(beforeParent.scale);
  character.object.position.fromArray(beforeRoot.position); character.object.quaternion.fromArray(beforeRoot.quaternion); character.object.scale.fromArray(beforeRoot.scale);
  parent.updateWorldMatrix(true, true);
  actions.apply(0.25, 'idle', { kind: 'floor' }); hands.restore();
  const nonFinger = ['mixamorigLeftArm', 'mixamorigRightArm', 'mixamorigLeftHand', 'mixamorigRightHand'];
  for (const name of nonFinger) assert.ok(character.object.getObjectByName(name)?.isBone, `${family}: parent wrist/arm bone ${name} remains present`);
  resultRows.push({ family, jointCount: Object.keys(rest).length, relaxedMaxDelta: relaxed.maxJointDeltaRadians,
    gripMaxDelta: grip.maxJointDeltaRadians, relaxedPalmGap: relaxed.palmGap, gripPalmGap: grip.palmGap,
    fingerWeightedVertexCount: idleFingerVertices.length,
    relaxedVertexDelta: maxVertexDelta(idleFingerVertices, relaxedFingerVertices),
    gripVertexDelta: maxVertexDelta(relaxedFingerVertices, gripFingerVertices),
    idleHandsBelowShoulders: idle.handsBelowShoulders, walkPhaseWitness: walkHands.fingertipPositions,
    bodyBounds: { idle: relaxedBounds, grip: gripBounds }, triangleCount: character.metrics.triangleCount });
  actors.push({ character, actions, hands, body });
}

// Posing one actor's fingers cannot alter the other actor's independent skeleton.
const femaleBeforeMaleChange = fingerBoneSnapshot(actors[1].character.object);
actors[0].hands.apply('grip', 0.91);
assert.deepEqual(fingerBoneSnapshot(actors[1].character.object), femaleBeforeMaleChange, 'male grip leaves female finger transforms unchanged');

// Diagnostic only: the current sit target is derived from the hips, not the actual thigh surface.
const sitTargets = [];
for (const actor of actors) {
  const sample = actor.actions.apply(0.4, 'sit', { kind: 'seat', top: 0.55, floorY: 0 });
  const handPoints = {};
  actor.character.object.updateMatrixWorld(true);
  for (const side of ['left', 'right']) {
    const bone = actor.character.object.getObjectByName(side === 'left' ? 'mixamorigLeftHand' : 'mixamorigRightHand');
    handPoints[side] = bone.getWorldPosition(new THREE.Vector3()).toArray();
  }
  sitTargets.push({ family: actor.character.metrics.body, controllerHands: sample.hands, actualHandWorld: handPoints,
    currentHipTargetOffset: { forward: 0.18, aboveHips: 0.10, lateral: 0.08 }, note: 'No thigh-surface target was applied in this check.' });
}

for (const actor of actors) { actor.hands.dispose(); actor.actions.dispose(); actor.character.dispose(); }
kit.dispose();
assert.equal(kit.callbackCount, 0, 'Kit callbacks are released after actor disposal');
const report = {
  status: 'pass',
  source: { bodySha256: pins.body, clipPackSha256: pins.clip,
    handControllerSha256: sha(readFileSync(path.join(here, 'native-hand-pose.ts'))),
    checkerSha256: sha(readFileSync(fileURLToPath(import.meta.url))) },
  actors: resultRows,
  sittingTargetDiagnostic: sitTargets,
  checks: { actualMaleFemaleGLTF: true, actual30FingerBones: true, actualSkinnedVerticesFinite: true,
    actualFingerWeightedVerticesRespond: true,
    relaxedAndGripPoseChanges: true, hostWalkPhaseInput: true, actorRootPlacementPreserved: true,
    parentRigidTransformEquivariance: true, independentFingerSkeletons: true, cleanup: true },
  limitations: [
    'Image-free CPU bone/skin check only; finger naturalness, contact, object grip and visual readability remain unreviewed.',
    'The hand controller must be called after the body/native-action pose for the same host frame.',
    'No production interaction timing or prop anchors are provided.',
    'The sit diagnostic records current hand positions; it does not move hands to thighs and does not prove lap contact.',
  ],
};
writeFileSync(path.join(here, 'native-hand-pose-check-result.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
