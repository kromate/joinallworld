import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadCompleteCharacter } from './rig.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(repo, 'evidence/graphics-loop/authored-character-spike-v1/parametric-base-expressive.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const suitPath = path.join(here, 'authored-clothing/out/male_casualsuit01.glb');
const hidePath = path.join(here, 'authored-clothing/out/body-hide-map.json');
const shortPath = path.join(here, 'authored-hair/out/short02-mobile.glb');
const afroPath = path.join(here, 'authored-hair/out/afro01-mobile.glb');
const paths = { bodyPath, clipPath, suitPath, hidePath, shortPath, afroPath };
const pins = {
  bodyPath: '0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077',
  clipPath: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
  suitPath: '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f',
  hidePath: 'dbe0c82a3e31da4e6ce37f4f1d9dc8611143c7c9e6dbef72ffea8d281aebe099',
  shortPath: 'a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0',
  afroPath: '3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474',
};
const expectedBodyIndex = '4c29f318e20b87a2c0ddce3689fa0ab285ee390fc02e5f3a017736df772a3661';
const LEG_BONES_DIAG = new Set(['leftupleg', 'rightupleg', 'leftleg', 'rightleg', 'leftfoot', 'rightfoot', 'lefttoebase', 'righttoebase']);
const normalizeBoneName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const sourceHashes = {};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assetBytes = {};
for (const [key, file] of Object.entries(paths)) {
  const bytes = readFileSync(file);
  const actual = hash(bytes);
  assert(actual.startsWith(pins[key]), `${key} pin mismatch: ${actual}`);
  if (pins[key].length === 64) assert.equal(actual, pins[key], `${key} full SHA-256 pin`);
  sourceHashes[key] = { sha256: actual, bytes: bytes.length };
  assetBytes[key] = bytes;
}

function imageFreeGlb(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  assert(json && binary, 'GLB JSON/BIN chunks');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encoded.length + 3) & ~3, binaryLength = (binary.length + 3) & ~3;
  const output = new Uint8Array(28 + jsonLength + binaryLength), result = new DataView(output.buffer);
  result.setUint32(0, 0x46546c67, true); result.setUint32(4, 2, true); result.setUint32(8, output.length, true);
  result.setUint32(12, jsonLength, true); result.setUint32(16, 0x4e4f534a, true); output.fill(32, 20, 20 + jsonLength);
  output.set(encoded, 20); result.setUint32(20 + jsonLength, binaryLength, true); result.setUint32(24 + jsonLength, 0x004e4942, true);
  output.set(binary, 28 + jsonLength); return output.buffer;
}

// Match the adapter's source-pin checks while serving file:// inputs in Node.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl);
  if (url.protocol === 'file:') return new Response(readFileSync(fileURLToPath(url)), { status: 200 });
  return nativeFetch(input, init);
};
// No raster rendering is tested here. Parse only hash-pinned image-free GLB buffers and attach
// a 1×1 placeholder map where the production hair adapter requires an alpha material map object.
const nativeParseAsync = GLTFLoader.prototype.parseAsync;
const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
placeholder.colorSpace = THREE.SRGBColorSpace;
placeholder.needsUpdate = true;
GLTFLoader.prototype.parseAsync = async function (data, pathPrefix) {
  const parsed = await nativeParseAsync.call(this, imageFreeGlb(data), pathPrefix);
  parsed.scene.traverse((node) => {
    const mesh = node;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) if (!material.map && material.transparent) material.map = placeholder.clone();
  });
  return parsed;
};

await MeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const parsePinnedImageFree = async (bytes) => nativeParseAsync.call(loader, imageFreeGlb(bytes), '/');
const [bodyGltf, clipsGltf] = await Promise.all([parsePinnedImageFree(assetBytes.bodyPath), parsePinnedImageFree(assetBytes.clipPath)]);
const suitDiagnosticGltf = await parsePinnedImageFree(assetBytes.suitPath);
let suitDiagnostic; suitDiagnosticGltf.scene.traverse((node) => { if (node.isMesh) { const p = node.geometry.getAttribute('position'), i = node.geometry.getAttribute('skinIndex'), w = node.geometry.getAttribute('skinWeight'), ix = node.geometry.getIndex(); const ys = []; const leg = []; for (let v = 0; v < p.count; v++) { ys.push(p.getY(v)); let sum = 0; for (let k = 0; k < 4; k++) { const j = Math.round(i.getComponent(v,k)); const name = normalizeBoneName(node.userData.jointNames?.[j] ?? '').replace(/^mixamorig/, ''); if (LEG_BONES_DIAG.has(name)) sum += w.getComponent(v,k); } leg.push(sum); } let shirt = 0, trousers = 0; for (let t = 0; t < ix.count / 3; t++) { const a=ix.getX(t*3), b=ix.getX(t*3+1), c=ix.getX(t*3+2); const y=(p.getY(a)+p.getY(b)+p.getY(c))/3; const li=(leg[a]+leg[b]+leg[c])/3; if (y < .91 && li >= .12) trousers++; else shirt++; } suitDiagnostic = {name: node.name, count: p.count, triangleCount: ix.count/3, groups: node.geometry.groups, y: [Math.min(...ys), Math.max(...ys)], legInfluenceAfterPrefixRemoval: [Math.min(...leg), Math.max(...leg)], expectedSplitAfterPrefixRemoval: {shirt, trousers}, jointNames: node.userData.jointNames}; } });
console.log('SUIT_SOURCE_DIAGNOSTIC', JSON.stringify(suitDiagnostic));
let authoredMorphs; bodyGltf.scene.traverse((node) => { if (node.isMesh) authoredMorphs ??= {name: node.name, morphTargets: node.morphTargetDictionary ? Object.keys(node.morphTargetDictionary) : [], positionMorphCount: node.geometry.morphAttributes.position?.length ?? 0}; }); console.log('AUTHORED_BODY_MORPHS', JSON.stringify(authoredMorphs));
const jointNames = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
bodyGltf.scene.updateMatrixWorld(true);
clipsGltf.scene.updateMatrixWorld(true);
const sourceBones = jointNames.map((name) => clipsGltf.scene.getObjectByName(name));
assert(sourceBones.every(Boolean), 'clip hierarchy contains every expected named joint');
const sourceRig = Object.assign(clipsGltf.scene, { skeleton: new THREE.Skeleton(sourceBones, sourceBones.map((bone) => bone.matrixWorld.clone().invert())) });

const kitCallbacks = new Set();
let kitClosed = false;
const kit = {
  authoredCharacterAssets: {
    loadTemplate: async () => bodyGltf.scene,
    loadMotionRig: async () => ({ root: sourceRig, clips: clipsGltf.animations }),
  },
  onDispose(callback) {
    if (kitClosed) { callback(); return () => false; }
    kitCallbacks.add(callback); return () => kitCallbacks.delete(callback);
  },
  dispose() {
    if (kitClosed) return;
    kitClosed = true; for (const callback of [...kitCallbacks]) callback(); kitCallbacks.clear();
    const geometries = new Set(), materials = new Set();
    bodyGltf.scene.traverse((node) => { if (node.isMesh) { geometries.add(node.geometry); for (const m of Array.isArray(node.material) ? node.material : [node.material]) materials.add(m); } });
    clipsGltf.scene.traverse((node) => { if (node.isMesh) { geometries.add(node.geometry); for (const m of Array.isArray(node.material) ? node.material : [node.material]) materials.add(m); } });
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); sourceRig.skeleton.dispose();
  },
};

const temporaryModule = path.join(here, 'authored-presentation-runtime-check.ts');
const presentationSource = readFileSync(path.join(here, 'authored-presentation.ts'), 'utf8');
const urlImports = [
  ["import casualSuitUrl from './authored-clothing/out/male_casualsuit01.glb?url';", "const casualSuitUrl = new URL('./authored-clothing/out/male_casualsuit01.glb', import.meta.url).href;"],
  ["import bodyHideMapUrl from './authored-clothing/out/body-hide-map.json?url';", "const bodyHideMapUrl = new URL('./authored-clothing/out/body-hide-map.json', import.meta.url).href;"],
  ["import shortHairUrl from './authored-hair/out/short02-mobile.glb?url';", "const shortHairUrl = new URL('./authored-hair/out/short02-mobile.glb', import.meta.url).href;"],
  ["import afroHairUrl from './authored-hair/out/afro01-mobile.glb?url';", "const afroHairUrl = new URL('./authored-hair/out/afro01-mobile.glb', import.meta.url).href;"],
];
let runtimeSource = presentationSource;
// Only ?url imports are rewritten for this Node-only check; adapter semantics stay unmodified.
for (const [before, after] of urlImports) {
  assert.equal(runtimeSource.split(before).length - 1, 1, `exact URL import exists: ${before}`);
  runtimeSource = runtimeSource.replace(before, after);
}
writeFileSync(temporaryModule, runtimeSource);
let presentations = [];
let actors = [];
try {
  const presentationModule = await import(`${pathToFileURL(temporaryModule).href}?check=${Date.now()}`);
  const { applyAuthoredPresentation } = presentationModule;
  const actorLooks = [
    { body: 'man', skin: '#7a4a2c', face: 'oval', expression: 'neutral', outfit: 'casual', outfitColor: '#3f72c4', bottomsColor: '#243a66', fabric: 'plain', hair: 'lowcut', appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } },
    { body: 'woman', skin: '#c98e62', face: 'round', expression: 'smile', outfit: 'casual', outfitColor: '#c9423a', bottomsColor: '#3f9a5a', fabric: 'plain', hair: 'afro', appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } },
  ];
  const options = [
    { hairAssetUrl: pathToFileURL(shortPath).href, hairSha256: pins.shortPath, hairAssetName: 'short02' },
    { hairAssetUrl: pathToFileURL(afroPath).href, hairSha256: pins.afroPath, hairAssetName: 'afro01' },
  ];
  for (let i = 0; i < actorLooks.length; i++) actors.push(await loadCompleteCharacter(kit, actorLooks[i], `presentation-check-${i}`));
  assert.notEqual(actors[0].object, actors[1].object, 'per-actor root objects are independent');
  const bodyMesh = (actor) => { let found; actor.object.traverse((node) => { if (node.name === 'Body' && node.isSkinnedMesh) found = node; }); return found; };
  const originalGeometry = actors.map((actor) => bodyMesh(actor).geometry);
  for (let index = 0; index < actors.length; index++) {
    presentations[index] = await applyAuthoredPresentation(actors[index].object, actorLooks[index], options[index]);
  }
  assert.deepEqual(presentations.map((entry) => entry.metrics.bodySourceIndexSha256), [expectedBodyIndex, expectedBodyIndex]);
  assert.deepEqual(presentations.map((entry) => [entry.metrics.bodySourceTriangles, entry.metrics.bodyVisibleTriangles, entry.metrics.hiddenBodyTriangles, entry.metrics.outfitTriangles]), [
    [26756, 20028, 6728, 16672], [26756, 20028, 6728, 16672],
  ]);
  const invalidWeights = [];
  const weightStats = { min: Infinity, max: -Infinity, minSum: Infinity, maxSum: -Infinity, negativeByActor: [0, 0], negativeByMesh: {} };
  const overlays = actors.map((actor, index) => {
    const found = { body: bodyMesh(actor), clothing: undefined, hair: undefined };
    actor.object.traverse((node) => { if (node.isSkinnedMesh && node.name === 'Authored casual suit') found.clothing = node; if (node.isSkinnedMesh && node.name.startsWith('Authored hair ')) found.hair = node; });
    assert(found.body && found.clothing && found.hair, 'actor has body, suit, and selected hair mesh');
    assert.equal(found.body.geometry, found.body.parent.getObjectByName('Body').geometry, 'body uses presentation mask');
    for (const overlay of [found.clothing, found.hair]) {
      assert.equal(overlay.skeleton.bones.length, found.body.skeleton.bones.length, `${overlay.name} skeleton size`);
      assert(overlay.skeleton.bones.every((bone, boneIndex) => bone === found.body.skeleton.bones[boneIndex]), `${overlay.name} follows this actor bones`);
      const indices = overlay.geometry.getAttribute('skinIndex'), weights = overlay.geometry.getAttribute('skinWeight');
      assert(indices && weights && indices.count === weights.count, `${overlay.name} has skin attributes`);
      for (let vertex = 0; vertex < weights.count; vertex++) {
        let sum = 0;
        for (let lane = 0; lane < 4; lane++) {
          const joint = indices.getComponent(vertex, lane), weight = weights.getComponent(vertex, lane);
          assert(Number.isInteger(joint) && joint >= 0 && joint < found.body.skeleton.bones.length, `${overlay.name} joint index valid`);
          weightStats.min = Math.min(weightStats.min, weight); weightStats.max = Math.max(weightStats.max, weight); if (!Number.isFinite(weight) || weight < 0) { invalidWeights.push({ actor: index, mesh: overlay.name, vertex, lane, value: weight }); weightStats.negativeByActor[index]++; weightStats.negativeByMesh[overlay.name] = (weightStats.negativeByMesh[overlay.name] ?? 0) + 1; } sum += weight;
        }
        weightStats.minSum = Math.min(weightStats.minSum, sum); weightStats.maxSum = Math.max(weightStats.maxSum, sum);
        assert(Math.abs(sum - 1) < 0.01, `${overlay.name} normalized weights at vertex ${vertex}: ${sum}`);
      }
    }
    return found;
  });
  const sharedSourceGeometry = overlays[0].body.geometry === overlays[1].body.geometry;
  assert(sharedSourceGeometry, 'same pinned Body source/mask is shared between actors');
  assert.notEqual(overlays[0].body.skeleton, overlays[1].body.skeleton, 'body skeleton wrappers are actor-private');
  const sourceTemplateGeometry = new Set(); bodyGltf.scene.traverse((node) => { if (node.isMesh) sourceTemplateGeometry.add(node.geometry); });
  const sharedTemplateGeometry = new Set();
  for (const actor of actors) actor.object.traverse((node) => { if (node.isSkinnedMesh && !['Authored casual suit', 'Authored hair short02', 'Authored hair afro01'].includes(node.name)) sharedTemplateGeometry.add(node.geometry); });
  const nonSharedTemplateMeshNames = []; for (const actor of actors) actor.object.traverse((node) => { if (node.isSkinnedMesh && !['Authored casual suit', 'Authored hair short02', 'Authored hair afro01'].includes(node.name) && !sourceTemplateGeometry.has(node.geometry)) nonSharedTemplateMeshNames.push(node.name); });
  assert(sourceTemplateGeometry.has(originalGeometry[0]) && sourceTemplateGeometry.has(originalGeometry[1]), 'Body source geometry remains Kit-owned/shared');

  const materialRefs = [];
  for (let index = 0; index < overlays.length; index++) {
    const actor = actors[index], current = overlays[index];
    const clothingMaterials = Array.isArray(current.clothing.material) ? current.clothing.material : [current.clothing.material];
    const hairMaterial = current.hair.material;
    assert.equal(clothingMaterials.length, 2, 'suit has independent shirt/trouser palette materials');
    assert(!Array.isArray(hairMaterial), 'hair has one actor material');
    let clothingDisposals = 0, hairDisposals = 0;
    for (const material of clothingMaterials) material.addEventListener('dispose', () => clothingDisposals++);
    hairMaterial.addEventListener('dispose', () => hairDisposals++);
    const bodyPoseBefore = current.body.skeleton.bones.find((bone) => bone.name === 'mixamorigLeftArm').quaternion.toArray();
    actor.sample(0.62, 'walk');
    const bodyPoseAfter = current.body.skeleton.bones.find((bone) => bone.name === 'mixamorigLeftArm').quaternion.toArray();
    assert.notDeepEqual(bodyPoseAfter, bodyPoseBefore, `actor ${index} walk changes its skeleton`);
    for (const mesh of [current.clothing, current.hair]) {
      mesh.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      for (let vertex = 0; vertex < mesh.geometry.getAttribute('position').count; vertex++) {
        mesh.getVertexPosition(vertex, p); mesh.localToWorld(p);
        assert([...p.toArray()].every(Number.isFinite), `${mesh.name} deformed vertex ${vertex} finite`);
      }
    }
    materialRefs.push({ current, clothingMaterials, hairMaterial, getDisposals: () => [clothingDisposals, hairDisposals] });
  }
  const actorBPoseBefore = overlays[1].body.skeleton.bones.find((bone) => bone.name === 'mixamorigLeftArm').quaternion.toArray();
  actors[0].sample(0.9, 'dance');
  assert.deepEqual(overlays[1].body.skeleton.bones.find((bone) => bone.name === 'mixamorigLeftArm').quaternion.toArray(), actorBPoseBefore,
    'posing first actor does not change second actor bones');

  const geometryRefs = overlays.map((entry) => ({ clothing: entry.clothing.geometry, hair: entry.hair.geometry }));
  const geometryDisposals = geometryRefs.map((refs) => {
    const counts = { clothing: 0, hair: 0 };
    refs.clothing.addEventListener('dispose', () => counts.clothing++); refs.hair.addEventListener('dispose', () => counts.hair++);
    return counts;
  });
  const sharedBodyGeometry = overlays[1].body.geometry;
  presentations[0].dispose(); presentations[0] = undefined;
  assert.equal(overlays[0].body.geometry, originalGeometry[0], 'first actor body mask restores original source index');
  assert(overlays[1].body.geometry === sharedBodyGeometry, 'disposing first presentation keeps second actor masked');
  assert(overlays[1].clothing.parent && overlays[1].hair.parent, 'first actor disposal leaves second actor overlays attached');
  assert.deepEqual(materialRefs[0].getDisposals(), [2, 1], 'first actor owns/disposes its overlay materials');
  actors[0].dispose();
  presentations[1].dispose(); presentations[1] = undefined;
  assert.equal(overlays[1].body.geometry, originalGeometry[1], 'second actor body mask restores original source index');
  assert.deepEqual(materialRefs[1].getDisposals(), [2, 1], 'second actor owns/disposes its overlay materials');
  assert(geometryDisposals.every((counts) => counts.clothing === 1 && counts.hair === 1), 'presentation releases private outfit/hair geometry exactly once');
  actors[1].dispose();
  kit.dispose();
  const report = {
    status: invalidWeights.length ? 'FAIL_SOURCE_SKIN_WEIGHT_VALIDATION' : 'PASS',
    source: sourceHashes,
    adapterSourceSha256: hash(readFileSync(path.join(here, 'authored-presentation.ts'))),
    rigSourceSha256: hash(readFileSync(path.join(here, 'rig.ts'))),
    mode: 'Actual hash-pinned GLB geometry/material/skeleton data, image-free decoding after raw pin verification; placeholder 1×1 texture used only to satisfy hair material-map structure. No pixel or rendering claim.',
    actors: [0, 1].map((index) => ({ body: actorLooks[index].body, hairstyle: actorLooks[index].hair, metrics: materialRefs[index].current.metrics })),
    weightDiagnostics: { ...weightStats, invalidCount: invalidWeights.length, samples: invalidWeights.slice(0, 20) },
    checks: {
      nonnegativeWeights: invalidWeights.length === 0,
      exactBodyIndexMask: true, suitAndHairJointIndicesValid: true, fourNormalizedInfluencesPerVertex: true,
      independentActorSkeletonsAndPoses: true, bodyMaskRestoredOnPresentationDispose: true,
      perActorOverlayMaterialsDisposedOnce: true, outfitAndHairGeometryDisposedOnce: true, kitOwnedBodyGeometrySharedUntilKitTeardown: true,
    },
    limitations: ['The suit and hair rasters are intentionally omitted in this Node CPU check; material color, alpha silhouette and visual fit require the separate rendered review.', 'Morph copying is checked at actor construction; this check does not execute renderer onBeforeRender synchronization.', 'No age/fabric/accessory or mobile performance claim.'],
    elapsedMs: Math.round(performance.now()),
  };
  writeFileSync(path.join(here, 'authored-presentation-check-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (invalidWeights.length) process.exitCode = 1;
} finally {
  for (const presentation of presentations) presentation?.dispose();
  for (const actor of actors) actor.dispose();
  kit.dispose();
  placeholder.dispose();
  await unlink(temporaryModule).catch(() => {});
}
