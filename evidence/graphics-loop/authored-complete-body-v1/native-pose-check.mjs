import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createNativePoseController } from './native-pose.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const sourcePath = path.join(repo, 'evidence/graphics-loop/authored-complete-body-v1/parametric-base-facial.glb');
const expectedSha = '9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd';
const bytes = readFileSync(sourcePath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, expectedSha, 'authored source GLB pin');

function imageFreeGlb(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
  assert.equal(view.getUint32(4, true), 2, 'GLB v2');
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true);
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) binary = chunk;
    offset += length + 8;
  }
  assert(json && binary, 'GLB JSON and binary chunks');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encoded.length + 3) & ~3, binaryLength = (binary.length + 3) & ~3;
  const out = new Uint8Array(28 + jsonLength + binaryLength), result = new DataView(out.buffer);
  result.setUint32(0, 0x46546c67, true); result.setUint32(4, 2, true); result.setUint32(8, out.length, true);
  result.setUint32(12, jsonLength, true); result.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jsonLength); out.set(encoded, 20);
  result.setUint32(20 + jsonLength, binaryLength, true); result.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(binary, 28 + jsonLength);
  return out.buffer;
}

await MeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(imageFreeGlb(bytes), '/');
const template = gltf.scene;
const sourceMeshes = [];
template.traverse(node => { if (node.isSkinnedMesh) sourceMeshes.push(node); });
assert.equal(sourceMeshes.length, 4, 'authored source has four skinned parts');
assert.equal(sourceMeshes.find(mesh => mesh.name === 'Body')?.skeleton.bones.length, 52, '52 named native joints');

function snapshot(meshes) {
  return meshes.map(mesh => ({
    name: mesh.name,
    position: createHash('sha256').update(Buffer.from(mesh.geometry.attributes.position.array.buffer,
      mesh.geometry.attributes.position.array.byteOffset, mesh.geometry.attributes.position.array.byteLength)).digest('hex'),
    index: createHash('sha256').update(Buffer.from(mesh.geometry.index.array.buffer,
      mesh.geometry.index.array.byteOffset, mesh.geometry.index.array.byteLength)).digest('hex'),
  }));
}
const sourceSnapshot = snapshot(sourceMeshes);
const sourceBoneSnapshot = sourceMeshes[0].skeleton.bones.map(bone => ({
  name: bone.name, position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray(),
}));

function meshesIn(root) {
  const meshes = [];
  root.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  return meshes;
}
function measure(root) {
  root.updateMatrixWorld(true);
  const at = name => root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const hips = at('mixamorigHips'), head = at('mixamorigHead');
  const leftShoulder = at('mixamorigLeftShoulder'), rightShoulder = at('mixamorigRightShoulder');
  const leftHand = at('mixamorigLeftHand'), rightHand = at('mixamorigRightHand');
  const body = meshesIn(root).find(mesh => mesh.name === 'Body');
  const position = body.geometry.getAttribute('position'), vertex = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < position.count; i++) {
    body.getVertexPosition(i, vertex); body.localToWorld(vertex);
    minY = Math.min(minY, vertex.y); maxY = Math.max(maxY, vertex.y);
  }
  return {
    headAboveHips: head.y - hips.y,
    handsBelowShoulders: { left: leftShoulder.y - leftHand.y, right: rightShoulder.y - rightHand.y },
    handsFromHips: { left: leftHand.clone().sub(hips).toArray(), right: rightHand.clone().sub(hips).toArray() },
    bodyMinY: minY, bodyMaxY: maxY,
  };
}

const actors = [];
for (const bodyFamily of ['male', 'female']) {
  const actor = cloneSkinnedHierarchy(template);
  const meshes = meshesIn(actor);
  const body = meshes.find(mesh => mesh.name === 'Body');
  const familyTarget = body.morphTargetDictionary?.[bodyFamily === 'female' ? 'bodyFeminine' : 'bodyMasculine'];
  const oppositeTarget = body.morphTargetDictionary?.[bodyFamily === 'female' ? 'bodyMasculine' : 'bodyFeminine'];
  assert(Number.isInteger(familyTarget) && Number.isInteger(oppositeTarget), `${bodyFamily}: family morphs exist`);
  body.morphTargetInfluences[familyTarget] = 1;
  body.morphTargetInfluences[oppositeTarget] = 0;
  const skeleton = body.skeleton;
  skeleton.pose();
  assert(!skeleton.bones.some((bone, index) => bone === sourceMeshes[0].skeleton.bones[index]), `${bodyFamily}: private actor bones`);
  actor.updateMatrixWorld(true);
  const rest = measure(actor);
  const controller = createNativePoseController(actor);
  const shoulderRest = ['mixamorigLeftShoulder', 'mixamorigRightShoulder'].map(name => actor.getObjectByName(name).quaternion.toArray());
  const idle = { ...controller.apply(0, 'idle'), ...controller.measure() };
  const shoulderIdle = ['mixamorigLeftShoulder', 'mixamorigRightShoulder'].map(name => actor.getObjectByName(name).quaternion.toArray());
  assert.deepEqual(shoulderIdle, shoulderRest, `${bodyFamily}: native clavicle/shoulder rotations remain unchanged`);
  const walk = [];
  for (let phase = 0; phase < 8; phase++) {
    walk.push({ ...controller.apply(phase / 8, 'walk'), ...controller.measure() });
  }
  controller.restore();
  const restored = measure(actor);
  assert(rest.headAboveHips > 0.3, `${bodyFamily}: native Skeleton.pose head must be above hips`);
  assert([rest.bodyMinY, rest.bodyMaxY, idle.bodyMinY, idle.bodyMaxY, ...walk.flatMap(item => [item.bodyMinY, item.bodyMaxY])].every(Number.isFinite),
    `${bodyFamily}: native/rest/pose skinned vertex bounds must be finite`);
  assert(idle.handsBelowShoulders.left > 0.1 && idle.handsBelowShoulders.right > 0.1,
    `${bodyFamily}: both hands hang below the shoulders after native idle pose`);
  for (const side of ['left', 'right']) {
    const restX = Math.abs(rest.handsFromHips[side][0]);
    const idleX = Math.abs(idle.hands[side][0] - idle.hips[0]);
    assert(idleX < restX * 0.55, `${bodyFamily}: ${side} hand moves beside torso from native A-pose (${idleX} vs ${restX})`);
  }
  for (const phase of walk) assert(phase.bodyMinY > -0.02 && phase.bodyMinY < 0.02,
    `${bodyFamily}: sampled constrained walk keeps body surface in a small floor band (${phase.bodyMinY})`);
  assert(idle.bodyMaxY - idle.bodyMinY > 0.8, `${bodyFamily}: body extent is plausible`);
  actors.push({ bodyFamily, rest, idle, walk, restored, controller, actor, meshes });
}
assert.deepEqual(snapshot(sourceMeshes), sourceSnapshot, 'source template geometry remains immutable');
assert.deepEqual(sourceMeshes[0].skeleton.bones.map(bone => ({
  name: bone.name, position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray(),
})), sourceBoneSnapshot, 'source template skeleton remains immutable');
// Scene placement belongs to the caller and must survive pose application/restoration.
const placementActor = actors[0];
placementActor.actor.position.set(3, 2, -1);
placementActor.actor.rotation.y = 0.63;
placementActor.actor.scale.setScalar(1.4);
const placementBefore = {
  position: placementActor.actor.position.toArray(),
  rotation: placementActor.actor.rotation.toArray(),
  scale: placementActor.actor.scale.toArray(),
};
placementActor.controller.apply(0.375, 'walk');
placementActor.controller.restore();
assert.deepEqual(placementActor.actor.position.toArray(), placementBefore.position, 'pose preserves caller root position');
assert.deepEqual(placementActor.actor.rotation.toArray(), placementBefore.rotation, 'pose preserves caller root rotation');
assert.deepEqual(placementActor.actor.scale.toArray(), placementBefore.scale, 'pose preserves caller root scale');
placementActor.actor.position.set(0, 0, 0);
placementActor.actor.rotation.set(0, 0, 0);
placementActor.actor.scale.set(1, 1, 1);
for (const entry of actors) entry.controller.dispose();

const result = {
  status: 'PASS',
  source: { path: path.relative(repo, sourcePath), bytes: bytes.byteLength, sha256 },
  method: 'Skeleton.pose() baseline, then geometry-derived authored anatomical axes; no old clip-pack quaternion transfer',
  actors: actors.map(({ bodyFamily, rest, idle, walk, restored }) => ({ bodyFamily, rest, idle, walk, restored })),
  sourceGeometryUnchanged: true,
  limitations: [
    'CPU pose evidence only; no rendered naturalness or animation acceptance.',
    'Walk is a deterministic constrained local-rotation cycle, not a recovered authored walk clip.',
    'No root translation or foot IK; walk sole clearance/contact must be solved and visually checked by the host.',
    'Hands/fingers remain in native rest pose; no gesture or finger articulation is authored.',
  ],
};
writeFileSync(path.join(here, 'native-pose-check-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
