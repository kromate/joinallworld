import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createNativeActionController } from './native-actions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'parametric-base-facial.glb');
const presentationPath = path.join(here, 'authored-presentation.ts');
const bodySha = '9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd';
const suitSha = '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f';
const sha = data => createHash('sha256').update(data).digest('hex');

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
  assert(json && binary, 'GLB JSON and BIN');
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
async function parseBody(bytes) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(imageFreeGlb(bytes), '/');
}
function skinnedMeshes(root) {
  const meshes = [];
  root.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  return meshes;
}
function measureSkinned(root, meshes) {
  root.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity, vertices = 0, minMesh = '', minVertex = -1, minPosition = null, minInfluences = [];
  for (const mesh of meshes) {
    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      mesh.getVertexPosition(i, vertex); mesh.localToWorld(vertex);
      assert.ok([vertex.x, vertex.y, vertex.z].every(Number.isFinite), `${mesh.name} vertex ${i} is finite`);
      if (vertex.y < minY) {
        minY = vertex.y; minMesh = mesh.name; minVertex = i; minPosition = vertex.toArray();
        const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
        minInfluences = indices && weights ? Array.from({ length: 4 }, (_, c) => ({ bone: mesh.skeleton.bones[indices.getComponent(i, c)]?.name, weight: weights.getComponent(i, c) })) : [];
      }
      maxY = Math.max(maxY, vertex.y); vertices++;
    }
  }
  assert.ok(Number.isFinite(minY) && Number.isFinite(maxY), 'skinned body and clothing bounds are finite');
  return { minY, maxY, vertices, minMesh, minVertex, minPosition, minInfluences };
}
function finiteWeights(mesh) {
  const weights = mesh.geometry.getAttribute('skinWeight');
  assert(weights, `${mesh.name} skin weights`);
  for (let i = 0; i < weights.count; i++) {
    const total = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
    assert.ok(Number.isFinite(total) && Math.abs(total - 1) < 0.025, `${mesh.name} vertex ${i} normalized weights ${total}`);
  }
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath);
assert.equal(sha(bodyBytes), bodySha, 'authored body GLB pin');
const bodyGltf = await parseBody(bodyBytes);
const bodyTemplate = bodyGltf.scene;
const sourceMeshes = skinnedMeshes(bodyTemplate);
assert.equal(sourceMeshes.length, 4, 'authored body has four skinned parts');
const sourceBody = sourceMeshes.find(mesh => mesh.name === 'Body');
assert(sourceBody && sourceBody.skeleton.bones.length === 52, '52-bone source Body exists');
const sourceGeometry = sourceBody.geometry;
const sourceSkeletonSnapshot = sourceBody.skeleton.bones.map(bone => [bone.name, bone.position.toArray(), bone.quaternion.toArray()]);

// The real presentation module imports GLB/JSON URLs through Vite. For this CPU-only probe, make a temporary
// same-folder copy with those four URL imports expressed as file URLs, then provide a narrow file:// fetch.
const tempPresentation = path.join(here, `.native-actions-presentation-check-${process.pid}.ts`);
const originalFetch = globalThis.fetch;
const originalSelf = globalThis.self;
const originalCreateImageBitmap = globalThis.createImageBitmap;
const presentationSource = readFileSync(presentationPath, 'utf8')
  .replace("import casualSuitUrl from './authored-clothing/out/male_casualsuit01.glb?url';", "const casualSuitUrl = new URL('./authored-clothing/out/male_casualsuit01.glb', import.meta.url).href;")
  .replace("import bodyHideMapUrl from './authored-clothing/out/body-hide-map.json?url';", "const bodyHideMapUrl = new URL('./authored-clothing/out/body-hide-map.json', import.meta.url).href;")
  .replace("import shortHairUrl from './authored-hair/out/short02-mobile.glb?url';", "const shortHairUrl = new URL('./authored-hair/out/short02-mobile.glb', import.meta.url).href;")
  .replace("import afroHairUrl from './authored-hair/out/afro01-mobile.glb?url';", "const afroHairUrl = new URL('./authored-hair/out/afro01-mobile.glb', import.meta.url).href;")
  .replace("import officeMaleUrl from './authored-clothing/office-export/out/office-male.glb?url';", "const officeMaleUrl = new URL('./authored-clothing/office-export/out/office-male.glb', import.meta.url).href;")
  .replace("import officeFemaleUrl from './authored-clothing/office-export/out/office-female.glb?url';", "const officeFemaleUrl = new URL('./authored-clothing/office-export/out/office-female.glb', import.meta.url).href;")
  .replace("import officeMaleHideUrl from './authored-clothing/office-export/out/office-male-body-hide-map.json?url';", "const officeMaleHideUrl = new URL('./authored-clothing/office-export/out/office-male-body-hide-map.json', import.meta.url).href;")
  .replace("import officeFemaleHideUrl from './authored-clothing/office-export/out/office-female-body-hide-map.json?url';", "const officeFemaleHideUrl = new URL('./authored-clothing/office-export/out/office-female-body-hide-map.json', import.meta.url).href;");
assert.notEqual(presentationSource, readFileSync(presentationPath, 'utf8'), 'temporary Vite URL import shim applied');
writeFileSync(tempPresentation, presentationSource);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.protocol !== 'file:') return originalFetch(input, init);
  return new Response(readFileSync(fileURLToPath(url)), { status: 200 });
};
globalThis.self = globalThis;
// The adapter uses GLTFLoader's image path. The CPU probe needs only the real geometry and does not sample texture pixels.
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
let applyCharacterPresentation;
try {
  ({ applyAuthoredPresentation: applyCharacterPresentation } = await import(`${pathToFileURL(tempPresentation).href}?check=${Date.now()}`));
} catch (error) {
  globalThis.fetch = originalFetch;
  if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
  if (originalCreateImageBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalCreateImageBitmap;
  unlinkSync(tempPresentation);
  throw error;
}
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  globalThis.fetch = originalFetch;
  if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
  if (originalCreateImageBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalCreateImageBitmap;
  try { unlinkSync(tempPresentation); } catch {}
}
process.once('exit', cleanup);

const actors = [];
for (const family of ['man', 'woman']) {
  const root = cloneSkinnedHierarchy(bodyTemplate);
  const body = skinnedMeshes(root).find(mesh => mesh.name === 'Body');
  const familyMorph = body.morphTargetDictionary[family === 'woman' ? 'bodyFeminine' : 'bodyMasculine'];
  assert(Number.isInteger(familyMorph), `${family} body shape morph exists`);
  body.morphTargetInfluences[familyMorph] = 1;
  body.skeleton.pose(); root.updateMatrixWorld(true);
  const presentation = await applyCharacterPresentation(root, {
    body: family, outfit: 'casual', outfitColor: '#3f72c4', bottomsColor: '#243a66', fabric: 'plain',
    hair: 'lowcut',
  }, { hairAssetUrl: pathToFileURL(path.join(here, 'authored-hair/out/short02-mobile.glb')).href,
    hairSha256: 'a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0', hairAssetName: 'short02' });
  const meshes = skinnedMeshes(root);
  assert(meshes.some(mesh => mesh.name === 'Authored casual suit'), `${family}: actual authored suit is mounted`);
  for (const mesh of meshes) finiteWeights(mesh);
  actors.push({ family, root, body, presentation, meshes, controller: createNativeActionController(root) });
}

const output = [];
for (const actor of actors) {
  const states = [];
  let femaleArmClearanceSweep = [];
  for (const [pose, support] of [
    ['idle', { kind: 'floor' }], ['walk', { kind: 'floor' }], ['sit', { kind: 'seat', top: 0.55, floorY: 0 }],
    ['interact', { kind: 'floor' }], ['cook', { kind: 'floor' }], ['eat', { kind: 'floor' }], ['drink', { kind: 'floor' }],
  ]) {
    const sample = actor.controller.apply(0.375, pose, support);
    const bounds = measureSkinned(actor.root, actor.meshes);
    const geometry = actor.controller.measure();
    assert.ok(sample.head[1] > sample.hips[1] + 0.2, `${actor.family}/${pose}: head stays above hips`);
    if (pose === 'idle' || pose === 'walk') {
      assert.ok(geometry.armSurfaceOutsideTorso.left >= 0.90 && geometry.armSurfaceOutsideTorso.right >= 0.90,
        `${actor.family}/${pose}: arm-weighted surface remains outside measured torso envelope`);
    }
    let seatBoundsNearSupport = null, feetBelowPelvis = null, pelvisClearanceOk = null;
    if (pose === 'sit') {
      pelvisClearanceOk = Math.abs(sample.pelvisSeatClearance - 0.10) < 1e-5;
      feetBelowPelvis = sample.feet.left[1] < sample.hips[1] && sample.feet.right[1] < sample.hips[1];
      seatBoundsNearSupport = Math.abs(geometry.footSoleMinY.left - support.floorY) <= 0.001
        && Math.abs(geometry.footSoleMinY.right - support.floorY) <= 0.001;
      assert.ok(pelvisClearanceOk, `${actor.family}: pelvis preserves explicit seat clearance`);
      assert.ok(feetBelowPelvis, `${actor.family}: seated feet remain below pelvis`);
      assert.ok(sample.footTargetError.left < 0.01 && sample.footTargetError.right < 0.01, `${actor.family}: seated feet reach measured ankle targets`);
      assert.ok(sample.handTargetError.left < 0.08 && sample.handTargetError.right < 0.08, `${actor.family}: both hands reach proximal-thigh targets`);
      assert.ok(geometry.handToBodySupportVertex.left < 0.10 && geometry.handToBodySupportVertex.right < 0.10,
        `${actor.family}: hands remain near actual torso/thigh support vertices`);
      assert.ok(seatBoundsNearSupport, `${actor.family}: actual weighted foot/toe sole vertices contact floor within 1mm`);
    }
    states.push({ ...sample, geometry, ...(pose === 'sit' ? {
      lapTargetsWithinReach: sample.handTargetError.left < 0.08 && sample.handTargetError.right < 0.08,
      bothFeetNearFloor: sample.footTargetError.left < 0.01 && sample.footTargetError.right < 0.01,
      handToKnee: {
        left: Math.hypot(sample.hands.left[0] - sample.knees.left[0], sample.hands.left[1] - sample.knees.left[1], sample.hands.left[2] - sample.knees.left[2]),
        right: Math.hypot(sample.hands.right[0] - sample.knees.right[0], sample.hands.right[1] - sample.knees.right[1], sample.hands.right[2] - sample.knees.right[2]),
      },
      seatBoundsNearSupport, feetBelowPelvis, pelvisClearanceOk,
    } : {}), bounds });
  }
  const standing = actor.controller.apply(0, 'idle', {kind:'floor'});
  const bonePoint = name => actor.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const forward = bonePoint('mixamorigLeftToeBase').sub(bonePoint('mixamorigLeftFoot'))
    .add(bonePoint('mixamorigRightToeBase').sub(bonePoint('mixamorigRightFoot'))).setY(0).normalize();
  const gait = [];
  for (const time of [.25,.75]) {
    const walking = actor.controller.apply(time,'walk',{kind:'floor'});
    const advances = Object.fromEntries(['left','right'].map(side => [side,
      new THREE.Vector3().fromArray(walking.feet[side]).sub(new THREE.Vector3().fromArray(standing.feet[side])).dot(forward)]));
    assert.ok(advances.left*advances.right < -.0025, `${actor.family}: feet advance in opposing directions at ${time}s`);
    gait.push({time,advances});
  }
  let rejectedNoSeat = false, rejectedMissingFloor = false, rejectedUnsupportedPose = false;
  try { actor.controller.apply(0, 'sit', { kind: 'floor' }); } catch { rejectedNoSeat = true; }
  try { actor.controller.apply(0, 'sit', { kind: 'seat', top: 0.55 }); } catch { rejectedMissingFloor = true; }
  try { actor.controller.apply(0, 'lie', { kind: 'floor' }); } catch { rejectedUnsupportedPose = true; }
  assert(rejectedNoSeat && rejectedMissingFloor && rejectedUnsupportedPose, `${actor.family}: unsupported cases fail explicitly`);
  if (actor.family === 'woman') {
    actor.controller.dispose();
    femaleArmClearanceSweep = [];
    for (const clearance of [null, 0.025, 0.05, 0.075, 0.10, 0.15, 0.20]) {
      const candidate = clearance === null ? createNativeActionController(actor.root) : createNativeActionController(actor.root, { armClearance: clearance });
      const pose = candidate.apply(0, 'idle', { kind: 'floor' });
      femaleArmClearanceSweep.push({ clearance: clearance ?? 'adaptive-quarter-envelope', handClearance: pose.handClearance, hands: pose.hands, geometry: candidate.measure() });
      candidate.dispose();
    }
    actor.controller = createNativeActionController(actor.root);
  }
  actor.controller.restore();
  actor.presentation.dispose();
  assert.equal(actor.body.geometry, sourceGeometry, `${actor.family}: presentation restored owned body geometry`);
  output.push({ family: actor.family, states, gait, femaleArmClearanceSweep, presentation: actor.presentation.metrics, rejectedNoSeat, rejectedMissingFloor, rejectedUnsupportedPose });
}
assert.deepEqual(sourceBody.skeleton.bones.map(bone => [bone.name, bone.position.toArray(), bone.quaternion.toArray()]), sourceSkeletonSnapshot,
  'source template rig remained immutable');
for (const actor of actors) actor.controller.dispose();
cleanup();

const result = {
  status: 'CPU_CHECKS_PASS_VISUAL_PENDING',
  sources: Object.fromEntries(['native-actions.ts', 'native-pose.ts', 'authored-presentation.ts', 'native-actions-check.mjs']
    .map(file => [file, sha(readFileSync(path.join(here, file)))])),
  inputs: { authoredBody: { bytes: bodyBytes.byteLength, sha256: sha(bodyBytes) }, authoredSuit: { sha256: suitSha } },
  method: 'Actual GLB body + actual applyAuthoredPresentation casual suit/hair loader; actor-cloned skeleton; image-free geometry parsing; no rendering.',
  actors: output,
  limitations: [
    'CPU skinning and landmark evidence only; no rendered naturalness, seat collision, prop contact, or user-facing interaction acceptance.',
    'Sit uses supplied seat/floor heights, two-leg IK and proximal-thigh hand targets. Actual knee landmarks remain about 0.38–0.40m from the hands; this is not hands-to-knees acceptance. No enter/exit transitions or external contact solver is implemented.',
    'Interact is a right-hand reach; cook is a two-hand waist reach; eat/drink use a head-bone mouth proxy. These are pose landmarks, not task choreography or prop attachment.',
    'Walk is a constrained in-place cycle; no root travel or foot IK is implemented.',
    'The arm-vs-torso metric counts arm-weighted vertices outside the same-height lateral body/clothing envelope; it is a silhouette proxy, not triangle-intersection or visual proof. The adaptive clearance still needs rendered review.',
    'Only the authored casual suit and short02 hair are checked. This does not establish all look, wardrobe, hair, accessory, or fallback parity.',
  ],
};
writeFileSync(path.join(here, 'native-actions-check-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
assert.equal(result.status, 'CPU_CHECKS_PASS_VISUAL_PENDING');
