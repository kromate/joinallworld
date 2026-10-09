import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyNativeFamilyRigCorrection } from './native-family-rig-correction.ts';
import { createNativeActionController } from './native-actions.ts';
import { refineRigidFootwear } from './native-rigid-footwear.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const footwearPath = path.join(here, 'authored-footwear/presentation.ts');
const tempFootwear = path.join(here, 'authored-footwear', `.native-rigid-footwear-${process.pid}.ts`);
const outputPath = path.join(here, 'native-rigid-footwear-check-result.json');
const pins = {
  body: 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
  shoes: '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function imageFreeGlb(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67); assert.equal(view.getUint32(4, true), 2);
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
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
  const jsonLength = (encoded.length + 3) & ~3, binaryLength = (binary.length + 3) & ~3;
  const out = new Uint8Array(28 + jsonLength + binaryLength), result = new DataView(out.buffer);
  result.setUint32(0, 0x46546c67, true); result.setUint32(4, 2, true); result.setUint32(8, out.length, true);
  result.setUint32(12, jsonLength, true); result.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jsonLength); out.set(encoded, 20);
  result.setUint32(20 + jsonLength, binaryLength, true); result.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(binary, 28 + jsonLength);
  return out.buffer;
}
function skinned(root) { const rows = []; root.traverse((n) => { if (n.isSkinnedMesh) rows.push(n); }); return rows; }
function bodyMesh(root) { const mesh = skinned(root).find((item) => item.name === 'Body'); assert(mesh); return mesh; }
function setFamily(root, family) {
  for (const mesh of skinned(root)) {
    const dictionary = mesh.morphTargetDictionary, values = mesh.morphTargetInfluences;
    assert(dictionary && values, `${mesh.name} family morphs`);
    values[dictionary.bodyFeminine] = family === 'woman' ? 1 : 0;
    values[dictionary.bodyMasculine] = family === 'man' ? 1 : 0;
  }
}
function attrsHash(mesh) {
  const hashAttribute = (attribute) => sha(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
  return Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key, value]) => [key, hashAttribute(value)]));
}
function templateFetch() {
  const oldFetch = globalThis.fetch, oldSelf = globalThis.self, oldBitmap = globalThis.createImageBitmap;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol !== 'file:') return oldFetch(input, init);
    return new Response(readFileSync(fileURLToPath(url)), { status: 200 });
  };
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  return () => {
    globalThis.fetch = oldFetch;
    if (oldSelf === undefined) delete globalThis.self; else globalThis.self = oldSelf;
    if (oldBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = oldBitmap;
  };
}
function updateActor(root) { root.updateWorldMatrix(true, false); root.updateMatrixWorld(true); for (const mesh of skinned(root)) mesh.skeleton.update(); }
function worldVertices(root, mesh) {
  updateActor(root);
  const result = [], position = mesh.geometry.getAttribute('position'), point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) result.push(mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).toArray());
  return result;
}
function footLocalVertices(root, mesh, ids, side) {
  updateActor(root);
  const bone = root.getObjectByName(side === 'left' ? 'mixamorigLeftFoot' : 'mixamorigRightFoot');
  assert(bone?.isBone);
  const inv = bone.matrixWorld.clone().invert(), point = new THREE.Vector3();
  return ids.map((id) => mesh.getVertexPosition(id, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv).toArray());
}
function lowerFootIds(root, mesh, side, ankleOffset = 0.055) {
  updateActor(root);
  const prefix = side === 'left' ? 'Left' : 'Right';
  const foot = root.getObjectByName(`mixamorig${prefix}Foot`), toe = root.getObjectByName(`mixamorig${prefix}ToeBase`);
  const otherFoot = root.getObjectByName(`mixamorig${side === 'left' ? 'Right' : 'Left'}Foot`);
  assert(foot?.isBone && toe?.isBone && otherFoot?.isBone);
  const rootInverse = root.matrixWorld.clone().invert(), plane = foot.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse).y - ankleOffset;
  const otherPlane = otherFoot.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse).y - ankleOffset;
  const skeleton = mesh.skeleton, footIndex = skeleton.bones.indexOf(foot), toeIndex = skeleton.bones.indexOf(toe);
  const oppositeIndices = new Set([skeleton.bones.indexOf(root.getObjectByName(`mixamorig${side === 'left' ? 'Right' : 'Left'}Foot`)), skeleton.bones.indexOf(root.getObjectByName(`mixamorig${side === 'left' ? 'Right' : 'Left'}ToeBase`))]);
  const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight'), p = mesh.geometry.getAttribute('position');
  const ids = [], local = new THREE.Vector3(), world = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    let support = 0, opposite = 0;
    for (let lane = 0; lane < 4; lane++) {
      const joint = Math.round(indices.getComponent(i, lane)), weight = weights.getComponent(i, lane);
      if (joint === footIndex || joint === toeIndex) support += weight;
      if (oppositeIndices.has(joint)) opposite += weight;
    }
    mesh.getVertexPosition(i, local); world.copy(local).applyMatrix4(mesh.matrixWorld).applyMatrix4(rootInverse);
    if (world.y <= plane && world.y <= otherPlane && support >= 0.2 && opposite <= 0.02) ids.push(i);
  }
  return ids;
}
function maxArrayDelta(a, b) {
  assert.equal(a.length, b.length); let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]));
  return max;
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), shoeBytes = readFileSync(path.join(here, 'authored-footwear/out/shoes01-mobile.glb'));
assert.equal(sha(bodyBytes), pins.body); assert.equal(sha(shoeBytes), pins.shoes);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const bodyTemplate = (await loader.parseAsync(imageFreeGlb(bodyBytes), '/')).scene;
const shoeTemplate = (await loader.parseAsync(imageFreeGlb(shoeBytes), '/')).scene;
const sourceTemplateAttributes = skinned(bodyTemplate).map((mesh) => ({ name: mesh.name, attrs: attrsHash(mesh) }));
const sourceShoeTemplateAttributes = skinned(shoeTemplate).map((mesh) => ({ name: mesh.name, attrs: attrsHash(mesh) }));
const fetchRestore = templateFetch();
let footwearAdapter;
try {
  let source = readFileSync(footwearPath, 'utf8');
  const expectedImport = "import shoesUrl from './out/shoes01-mobile.glb?url';";
  assert(source.includes(expectedImport), 'pinned production footwear URL import');
  source = source.replace(expectedImport, "const shoesUrl = new URL('./out/shoes01-mobile.glb', import.meta.url).href;");
  writeFileSync(tempFootwear, source);
  ({ applyAuthoredFootwear: footwearAdapter } = await import(`${pathToFileURL(tempFootwear).href}?check=${Date.now()}`));
} catch (error) {
  fetchRestore(); try { unlinkSync(tempFootwear); } catch {}
  throw error;
}

const cases = [];
try {
  for (const family of ['man', 'woman']) {
    const root = cloneSkinnedHierarchy(bodyTemplate);
    root.position.set(1.13, 0.23, -0.71);
    root.quaternion.setFromEuler(new THREE.Euler(0.06, 0.71, -0.03));
    root.scale.set(1.04, 0.96, 1.02);
    setFamily(root, family);
    const correction = applyNativeFamilyRigCorrection(root);
    let shoes, action, refinement;
    try {
      shoes = await footwearAdapter(root);
      const shoe = shoes.object, shoeGeometry = shoe.geometry;
      const originalIndex = shoeGeometry.getAttribute('skinIndex'), originalWeights = shoeGeometry.getAttribute('skinWeight');
      const originalIndexHash = sha(Buffer.from(originalIndex.array.buffer, originalIndex.array.byteOffset, originalIndex.array.byteLength));
      const originalWeightHash = sha(Buffer.from(originalWeights.array.buffer, originalWeights.array.byteOffset, originalWeights.array.byteLength));
      const originalPositionHash = sha(Buffer.from(shoeGeometry.getAttribute('position').array.buffer, shoeGeometry.getAttribute('position').array.byteOffset, shoeGeometry.getAttribute('position').array.byteLength));
      const originalIndexGeometryHash = sha(Buffer.from(shoeGeometry.index.array.buffer, shoeGeometry.index.array.byteOffset, shoeGeometry.index.array.byteLength));
      const originalMorphHashes = Object.fromEntries(Object.entries(shoeGeometry.morphAttributes).map(([key, attrs]) => [key, attrs.map((attr) => sha(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)))]));
      action = createNativeActionController(root);
      const poses = [
        { name: 'idle', seconds: 0.25, support: { kind: 'floor' } },
        { name: 'walk', seconds: 0.31, support: { kind: 'floor' } },
        { name: 'walk', seconds: 0.79, support: { kind: 'floor' } },
        { name: 'sit', seconds: 0.45, support: { kind: 'seat', top: 0.52, floorY: 0 } },
      ];
      action.apply(0, 'idle', { kind: 'floor' }); root.updateMatrixWorld(true);
      const selectedIds = { left: lowerFootIds(root, shoe, 'left'), right: lowerFootIds(root, shoe, 'right') };
      const sourcePoseRows = [];
      for (const pose of poses) {
        action.apply(pose.seconds, pose.name, pose.support);
        root.updateMatrixWorld(true);
        sourcePoseRows.push({ pose: pose.name, seconds: pose.seconds,
          left: footLocalVertices(root, shoe, selectedIds.left, 'left'), right: footLocalVertices(root, shoe, selectedIds.right, 'right') });
      }
      action.apply(0, 'idle', { kind: 'floor' }); root.updateMatrixWorld(true);
      const restBefore = worldVertices(root, shoe);
      const sourceRootTransform = { position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() };
      const sourceJointExamples = [...selectedIds.left.slice(0, 2), ...selectedIds.right.slice(0, 2)].map((id) => ({ id,
        joints: Array.from({ length: 4 }, (_, lane) => originalIndex.getComponent(id, lane)),
        weights: Array.from({ length: 4 }, (_, lane) => originalWeights.getComponent(id, lane)) }));
      refinement = refineRigidFootwear(root, shoe);
      const restAfter = worldVertices(root, shoe);
      const restPositionDrift = maxArrayDelta(restBefore, restAfter);
      assert(restPositionDrift < 2e-5, `${family} rest shoe vertices changed ${restPositionDrift}`);
      assert.equal(sha(Buffer.from(shoeGeometry.getAttribute('position').array.buffer)), originalPositionHash);
      assert.equal(sha(Buffer.from(shoeGeometry.index.array.buffer, shoeGeometry.index.array.byteOffset, shoeGeometry.index.array.byteLength)), originalIndexGeometryHash, `${family} geometry index payload unchanged`);
      for (const [key, hashes] of Object.entries(originalMorphHashes)) {
        assert.deepEqual(shoeGeometry.morphAttributes[key].map((attr) => sha(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength))), hashes, `${family} ${key} morphs untouched`);
      }
      assert.deepEqual({ position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() }, sourceRootTransform, `${family} actor placement unchanged`);
      assert.deepEqual(skinned(bodyTemplate).map((mesh) => ({ name: mesh.name, attrs: attrsHash(mesh) })), sourceTemplateAttributes, 'shared body templates remain untouched');
      assert.deepEqual(skinned(shoeTemplate).map((mesh) => ({ name: mesh.name, attrs: attrsHash(mesh) })), sourceShoeTemplateAttributes, 'shared source shoe template remains untouched');
      const newIndex = shoe.geometry.getAttribute('skinIndex'), newWeights = shoe.geometry.getAttribute('skinWeight');
      const leftFootIndex = shoe.skeleton.bones.indexOf(root.getObjectByName('mixamorigLeftFoot'));
      const rightFootIndex = shoe.skeleton.bones.indexOf(root.getObjectByName('mixamorigRightFoot'));
      for (let i = 0; i < newIndex.count; i++) {
        const before = Array.from({ length: 4 }, (_, lane) => originalIndex.getComponent(i, lane));
        const after = Array.from({ length: 4 }, (_, lane) => newIndex.getComponent(i, lane));
        const oldWeights = Array.from({ length: 4 }, (_, lane) => originalWeights.getComponent(i, lane));
        const updatedWeights = Array.from({ length: 4 }, (_, lane) => newWeights.getComponent(i, lane));
        const changed = before.some((v, lane) => v !== after[lane]) || oldWeights.some((v, lane) => Math.abs(v - updatedWeights[lane]) > 1e-6);
        if (changed) {
          const joint = after[0];
          assert(joint === leftFootIndex || joint === rightFootIndex, `${family} changed vertex ${i} is bound to a Foot`);
          assert.equal(newWeights.getComponent(i, 0), 1, `${family} rigid weight`);
          assert.deepEqual([1, 2, 3].map((lane) => newWeights.getComponent(i, lane)), [0, 0, 0], `${family} other lanes cleared`);
        } else {
          assert.deepEqual(after, before, `${family} preserved sock/transition joints at ${i}`);
          assert.deepEqual(Array.from({ length: 4 }, (_, lane) => newWeights.getComponent(i, lane)), Array.from({ length: 4 }, (_, lane) => originalWeights.getComponent(i, lane)), `${family} untouched weights at ${i}`);
        }
      }
      assert.equal(refinement.metrics.selectedLeftVertices, selectedIds.left.length, `${family} left classifier matches independent selection`);
      assert.equal(refinement.metrics.selectedRightVertices, selectedIds.right.length, `${family} right classifier matches independent selection`);
      const footLocalCandidate = [];
      for (const pose of poses) {
        action.apply(pose.seconds, pose.name, pose.support); root.updateMatrixWorld(true);
        footLocalCandidate.push({ pose: pose.name, seconds: pose.seconds,
          left: footLocalVertices(root, shoe, selectedIds.left, 'left'), right: footLocalVertices(root, shoe, selectedIds.right, 'right') });
      }
      let maxCandidatePoseDrift = 0, maxSourceCandidateDifference = 0;
      let maxSourceFootLocalDrift = 0;
      for (let i = 0; i < poses.length; i++) {
        maxSourceCandidateDifference = Math.max(maxSourceCandidateDifference, maxArrayDelta(sourcePoseRows[i].left, footLocalCandidate[i].left), maxArrayDelta(sourcePoseRows[i].right, footLocalCandidate[i].right));
        if (i > 0) maxCandidatePoseDrift = Math.max(maxCandidatePoseDrift,
          maxArrayDelta(footLocalCandidate[0].left, footLocalCandidate[i].left), maxArrayDelta(footLocalCandidate[0].right, footLocalCandidate[i].right));
        if (i > 0) maxSourceFootLocalDrift = Math.max(maxSourceFootLocalDrift, maxArrayDelta(sourcePoseRows[0].left, sourcePoseRows[i].left), maxArrayDelta(sourcePoseRows[0].right, sourcePoseRows[i].right));
      }
      assert(maxCandidatePoseDrift < 2e-4, `${family} rigid shoe points move in Foot local coordinates ${maxCandidatePoseDrift}`);
      assert(maxSourceFootLocalDrift > maxCandidatePoseDrift + 1e-3, `${family} source shoe region did not show measurable deformation to correct`);
      action.apply(0, 'idle', { kind: 'floor' }); root.updateMatrixWorld(true);
      const refinedHashes = {
        skinIndex: sha(Buffer.from(newIndex.array.buffer, newIndex.array.byteOffset, newIndex.array.byteLength)),
        skinWeight: sha(Buffer.from(newWeights.array.buffer, newWeights.array.byteOffset, newWeights.array.byteLength)),
      };
      refinement.restore();
      assert.equal(shoe.geometry.getAttribute('skinIndex'), originalIndex, `${family} restore exact skinIndex object`);
      assert.equal(shoe.geometry.getAttribute('skinWeight'), originalWeights, `${family} restore exact skinWeight object`);
      assert.equal(sha(Buffer.from(originalIndex.array.buffer, originalIndex.array.byteOffset, originalIndex.array.byteLength)), originalIndexHash);
      assert.equal(sha(Buffer.from(originalWeights.array.buffer, originalWeights.array.byteOffset, originalWeights.array.byteLength)), originalWeightHash);
      cases.push({ family, source: { vertices: shoe.geometry.getAttribute('position').count, triangles: shoe.geometry.index.count / 3,
        skinIndexBytes: originalIndex.array.byteLength, skinWeightBytes: originalWeights.array.byteLength, sourceIndexSha256: originalIndexHash, sourceWeightSha256: originalWeightHash },
        candidate: refinement.metrics, restPositionDriftMetres: restPositionDrift,
        maximumRigidCandidatePoseDriftMetres: maxCandidatePoseDrift,
        maximumSourceToRigidDifferenceMetres: maxSourceCandidateDifference,
        maximumUnmodifiedSourceFootLocalDriftMetres: maxSourceFootLocalDrift,
        sourceJointExamples,
        sourceFootLocalFirst: sourcePoseRows.map((row) => ({ pose: row.pose, left: row.left[0], right: row.right[0] })),
        modifiedSkinHashes: refinedHashes, sourcePoseRows: sourcePoseRows.map((row) => ({ pose: row.pose, seconds: row.seconds,
          leftSourceVertices: row.left.length, rightSourceVertices: row.right.length })) });
    } finally {
      refinement?.dispose(); action?.dispose(); shoes?.dispose(); correction.dispose();
      for (const mesh of skinned(root)) mesh.skeleton.dispose();
      root.parent?.remove(root);
    }
  }
} finally {
  fetchRestore(); try { unlinkSync(tempFootwear); } catch {}
  for (const mesh of skinned(bodyTemplate)) mesh.skeleton.dispose();
  for (const mesh of skinned(shoeTemplate)) mesh.skeleton.dispose();
}

const result = {
  status: 'PASS_DIAGNOSTIC_ONLY',
  method: 'Production shoe adapter attached to family-corrected private actors; copied only private skin attributes, then compared source/candidate foot-local vertex coordinates across actual native idle/walk/sit poses and restored the original attribute objects.',
  inputs: { body: { path: path.relative(repo, bodyPath), bytes: bodyBytes.length, sha256: pins.body },
    shoes: { path: 'evidence/graphics-loop/authored-complete-body-v1/authored-footwear/out/shoes01-mobile.glb', bytes: shoeBytes.length, sha256: pins.shoes },
    footwearAdapterSha256: sha(readFileSync(footwearPath)), moduleSha256: sha(readFileSync(path.join(here, 'native-rigid-footwear.ts'))),
    familyCorrectionSha256: sha(readFileSync(path.join(here, 'native-family-rig-correction.ts'))), nativeActionsSha256: sha(readFileSync(path.join(here, 'native-actions.ts'))) },
  cases,
  limitations: ['CPU-only geometry and transform evidence; no rendered visual acceptance.',
    'Only source-authored mobile shoe mesh is classified. The separate sock/body mesh and authored outfit integration are not modified.',
    'Changing skin weights can alter shadows and how footwear deforms; actual GPU A/B is required before integration.',
    'The male-authored footwear has an existing measured female fit discrepancy; this refinement does not correct shoe shape or fit.'],
};
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, cases: cases.map(({ family, candidate, restPositionDriftMetres,
  maximumRigidCandidatePoseDriftMetres, maximumSourceToRigidDifferenceMetres, maximumUnmodifiedSourceFootLocalDriftMetres }) => ({ family, candidate,
  restPositionDriftMetres, maximumRigidCandidatePoseDriftMetres, maximumSourceToRigidDifferenceMetres, maximumUnmodifiedSourceFootLocalDriftMetres })), outputPath }, null, 2));
