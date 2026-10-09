import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyNativeFamilyRigCorrection } from './native-family-rig-correction.ts';
import { createNativeSourceLandmarkSampler } from './native-source-sampler.ts';
import { createNativeClipSolver } from './native-clip-solver.ts';
import { createNativeSeatSurfaceProbe, seatAnchorDelta } from './native-seat-surface.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const presentationPath = path.join(here, 'authored-presentation.ts');
const footwearPath = path.join(here, 'authored-footwear/presentation.ts');
const tempPresentation = path.join(here, `.native-seat-presentation-${process.pid}.ts`);
const tempFootwear = path.join(here, 'authored-footwear', `.native-seat-footwear-${process.pid}.ts`);
const outputPath = path.join(here, 'native-seat-surface-check-result.json');
const pins = {
  body: 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
  clips: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
  shoes: '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557',
  maleCasual: '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f',
  femaleCasual: '7063492e52bb8817981349df45e141e0bc70dbe3e339d4d2dac8df3bdc3342bd',
  femaleOffice: 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function imageFreeGlb(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67); assert.equal(view.getUint32(4, true), 2);
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = view.getUint32(offset + 0, true), kind = view.getUint32(offset + 4, true);
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
function skinned(root) { const result = []; root.traverse((node) => { if (node.isSkinnedMesh) result.push(node); }); return result; }
function updateActor(root) {
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  for (const mesh of skinned(root)) mesh.skeleton.update();
}
function setFamily(root, family) {
  for (const mesh of skinned(root)) {
    const dict = mesh.morphTargetDictionary, values = mesh.morphTargetInfluences;
    assert(dict && values, `${mesh.name} family morphs`);
    values[dict.bodyFeminine] = family === 'woman' ? 1 : 0;
    values[dict.bodyMasculine] = family === 'man' ? 1 : 0;
  }
}
function rootState(root) { return { position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() }; }
const SEAT_BONE_NAMES = ['mixamorigHips', 'mixamorigLeftUpLeg', 'mixamorigRightUpLeg'];
function independentSeatRegionSelection(root, meshes, region, minimumRelevantWeight = 0.15) {
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.skeleton.update();
  const inverseRoot = root.matrixWorld.clone().invert();
  const hipWorld = root.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
  const forward = new THREE.Vector3(...region.forwardLocal), lateral = new THREE.Vector3(...region.lateralLocal);
  const position = new THREE.Vector3(), result = [];
  for (const mesh of meshes) {
    const index = mesh.geometry.index, indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    assert(index && indices && weights, `${mesh.name} oracle inputs`);
    const support = Object.fromEntries(SEAT_BONE_NAMES.map((name) => {
      const found = mesh.skeleton.bones.findIndex((bone) => bone.name === name);
      assert(found >= 0, `${mesh.name} has ${name}`); return [name, found];
    }));
    const start = Math.max(0, mesh.geometry.drawRange.start ?? 0);
    const count = Number.isFinite(mesh.geometry.drawRange.count) ? mesh.geometry.drawRange.count : index.count;
    const end = Math.min(index.count, start + count), used = new Set();
    for (let i = start; i < end; i++) used.add(index.getX(i));
    const selected = [];
    for (const vertex of used) {
      let hipWeight = 0, leftWeight = 0, rightWeight = 0;
      for (let channel = 0; channel < 4; channel++) {
        const bone = indices.getComponent(vertex, channel), weight = weights.getComponent(vertex, channel);
        if (bone === support.mixamorigHips) hipWeight += weight;
        else if (bone === support.mixamorigLeftUpLeg) leftWeight += weight;
        else if (bone === support.mixamorigRightUpLeg) rightWeight += weight;
      }
      if (hipWeight < minimumRelevantWeight || hipWeight < leftWeight + rightWeight) continue;
      mesh.getVertexPosition(vertex, position); position.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot).sub(hipWorld);
      const rearward = -position.dot(forward), lateralOffset = Math.abs(position.dot(lateral));
      if (rearward >= region.rearwardAtLeast && lateralOffset <= region.lateralAbsAtMost
        && position.y >= region.verticalFromHip[0] && position.y <= region.verticalFromHip[1]) selected.push(vertex);
    }
    result.push({ mesh, vertices: Uint32Array.from(selected), indexedVertices: used.size });
  }
  return result;
}
function fullSeatRegionOracle(root, regionSamples) {
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  const point = new THREE.Vector3(), perMesh = [];
  let minY = Infinity, maxY = -Infinity, indexedRegionVertices = 0;
  for (const { mesh, vertices, indexedVertices } of regionSamples) {
    let meshMin = Infinity, meshMax = -Infinity;
    for (const vertex of vertices) {
      mesh.getVertexPosition(vertex, point); mesh.localToWorld(point);
      assert(Number.isFinite(point.y), `${mesh.name}/${vertex} oracle result finite`);
      meshMin = Math.min(meshMin, point.y); meshMax = Math.max(meshMax, point.y);
    }
    if (!vertices.length) { perMesh.push({ name: mesh.name, indexedVertices, seatRegionVertices: 0, minY: null, maxY: null }); continue; }
    perMesh.push({ name: mesh.name, indexedVertices, seatRegionVertices: vertices.length, minY: meshMin, maxY: meshMax });
    indexedRegionVertices += vertices.length; minY = Math.min(minY, meshMin); maxY = Math.max(maxY, meshMax);
  }
  assert(Number.isFinite(minY) && Number.isFinite(maxY), 'full seat region oracle found indexed pelvis vertices');
  return { minY, maxY, indexedRegionVertices, perMesh };
}
function imageFreeJson(input) { return imageFreeGlb(input); }
function fileFetch() {
  const oldFetch = globalThis.fetch, oldSelf = globalThis.self, oldBitmap = globalThis.createImageBitmap;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol !== 'file:') return oldFetch(input, init);
    return new Response(readFileSync(fileURLToPath(url)), { status: 200 });
  };
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  return () => { globalThis.fetch = oldFetch; if (oldSelf === undefined) delete globalThis.self; else globalThis.self = oldSelf;
    if (oldBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = oldBitmap; };
}
function prepareAdapters() {
  let source = readFileSync(presentationPath, 'utf8');
  const imports = [
    ["import casualSuitUrl from './authored-clothing/out/male_casualsuit01.glb?url';", "const casualSuitUrl = new URL('./authored-clothing/out/male_casualsuit01.glb', import.meta.url).href;"],
    ["import bodyHideMapUrl from './authored-clothing/out/body-hide-map.json?url';", "const bodyHideMapUrl = new URL('./authored-clothing/out/body-hide-map.json', import.meta.url).href;"],
    ["import shortHairUrl from './authored-hair/out/short02-mobile.glb?url';", "const shortHairUrl = new URL('./authored-hair/out/short02-mobile.glb', import.meta.url).href;"],
    ["import afroHairUrl from './authored-hair/out/afro01-mobile.glb?url';", "const afroHairUrl = new URL('./authored-hair/out/afro01-mobile.glb', import.meta.url).href;"],
    ["import officeMaleUrl from './authored-clothing/office-export/out/office-male.glb?url';", "const officeMaleUrl = new URL('./authored-clothing/office-export/out/office-male.glb', import.meta.url).href;"],
    ["import officeFemaleUrl from './authored-clothing/office-export/out/office-female.glb?url';", "const officeFemaleUrl = new URL('./authored-clothing/office-export/out/office-female.glb', import.meta.url).href;"],
    ["import officeMaleHideUrl from './authored-clothing/office-export/out/office-male-body-hide-map.json?url';", "const officeMaleHideUrl = new URL('./authored-clothing/office-export/out/office-male-body-hide-map.json', import.meta.url).href;"],
    ["import officeFemaleHideUrl from './authored-clothing/office-export/out/office-female-body-hide-map.json?url';", "const officeFemaleHideUrl = new URL('./authored-clothing/office-export/out/office-female-body-hide-map.json', import.meta.url).href;"],
    ["import femaleCasualUrl from './authored-clothing/casual-female-export/out/casual-female.glb?url';", "const femaleCasualUrl = new URL('./authored-clothing/casual-female-export/out/casual-female.glb', import.meta.url).href;"],
    ["import femaleCasualHideUrl from './authored-clothing/casual-female-export/out/casual-female-body-hide-map.json?url';", "const femaleCasualHideUrl = new URL('./authored-clothing/casual-female-export/out/casual-female-body-hide-map.json', import.meta.url).href;"],
  ];
  for (const [from, to] of imports) {
    assert(source.includes(from), `presentation import ${from}`);
    source = source.replace(from, to);
  }
  writeFileSync(tempPresentation, source);
  let shoes = readFileSync(footwearPath, 'utf8');
  const shoeImport = "import shoesUrl from './out/shoes01-mobile.glb?url';";
  assert(shoes.includes(shoeImport), 'shoe URL import');
  shoes = shoes.replace(shoeImport, "const shoesUrl = new URL('./out/shoes01-mobile.glb', import.meta.url).href;");
  writeFileSync(tempFootwear, shoes);
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), clipBytes = readFileSync(clipPath);
const shoePath = path.join(here, 'authored-footwear/out/shoes01-mobile.glb'), shoeBytes = readFileSync(shoePath);
for (const [name, bytes, pin] of [['body', bodyBytes, pins.body], ['clips', clipBytes, pins.clips], ['shoes', shoeBytes, pins.shoes]]) assert.equal(sha(bytes), pin, `${name} input pin`);
const outfits = {
  maleCasual: { path: path.join(here, 'authored-clothing/out/male_casualsuit01.glb'), pin: pins.maleCasual, family: 'man', outfit: 'casual', body: 'man' },
  femaleCasual: { path: path.join(here, 'authored-clothing/casual-female-export/out/casual-female.glb'), pin: pins.femaleCasual, family: 'woman', outfit: 'casual', body: 'woman' },
  femaleOffice: { path: path.join(here, 'authored-clothing/office-export/out/office-female.glb'), pin: pins.femaleOffice, family: 'woman', outfit: 'office', body: 'woman' },
};
for (const [name, input] of Object.entries(outfits)) assert.equal(sha(readFileSync(input.path)), input.pin, `${name} outfit input pin`);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const bodyTemplate = (await loader.parseAsync(imageFreeGlb(bodyBytes), '/')).scene;
const clipScene = await loader.parseAsync(imageFreeGlb(clipBytes), '/');
const sourceSampler = createNativeSourceLandmarkSampler(clipScene.scene, clipScene.animations);
assert(sourceSampler.durations.has('sit') && sourceSampler.durations.get('sit') > 0, 'exact source sit clip available');
const restoreGlobals = fileFetch();
let applyPresentation, applyFootwear;
try {
  prepareAdapters();
  ({ applyAuthoredPresentation: applyPresentation } = await import(`${pathToFileURL(tempPresentation).href}?run=${Date.now()}`));
  ({ applyAuthoredFootwear: applyFootwear } = await import(`${pathToFileURL(tempFootwear).href}?run=${Date.now()}`));
} catch (error) {
  restoreGlobals(); try { unlinkSync(tempPresentation); } catch {} try { unlinkSync(tempFootwear); } catch {}
  throw error;
}

const SEAT_TOP = 0.55;
const FLOOR_Y = 0;
const phases = 40;
const cases = [];
const failures = [];
try {
  for (const [key, outfit] of Object.entries(outfits)) {
    const root = cloneSkinnedHierarchy(bodyTemplate);
    setFamily(root, outfit.family);
    const correction = applyNativeFamilyRigCorrection(root);
    let presentation, footwear, solver, seatProbe;
    try {
      presentation = await applyPresentation(root, { body: outfit.body, outfit: outfit.outfit, outfitColor: '#496c9a',
        bottomsColor: '#273e62', fabric: 'plain', hair: outfit.family === 'man' ? 'lowcut' : 'afro', hairColor: '#201b19' });
      footwear = await applyFootwear(root);
      const body = skinned(root).find((mesh) => mesh.name === 'Body');
      const garment = skinned(root).find((mesh) => mesh.name === (outfit.outfit === 'office' ? 'Authored office suit' : 'Authored casual suit'));
      assert(body && garment, `${key} visible production Body and authored outfit`);
      const seatMeshes = [body, garment];
      seatProbe = createNativeSeatSurfaceProbe(root, seatMeshes);
      const oracleRegion = independentSeatRegionSelection(root, seatMeshes, seatProbe.metrics.posteriorRegion,
        seatProbe.metrics.minimumRelevantWeight);
      const oracleCountByMesh = Object.fromEntries(oracleRegion.map(({ mesh, vertices }) => [mesh.name, vertices.length]));
      assert.deepEqual(oracleCountByMesh, seatProbe.metrics.candidateVerticesByMesh,
        `${key}: independent complete-index region selection matches cached candidate membership`);
      solver = createNativeClipSolver(root, { sourceRest: sourceSampler.restLandmarks, footSurface: footwear.object, bodySurfaceMeshes: [...seatMeshes, footwear.object] });
      const duration = sourceSampler.durations.get('sit');
      const phaseRows = [];
      for (let phase = 0; phase < phases; phase++) {
        const seconds = duration * phase / (phases - 1);
        const frame = sourceSampler.sampleClip('sit', seconds, 'clamp');
        const applyStart = performance.now();
        const anchored = solver.applyFrame(frame, { kind: 'seat-anchor', hipWorld: [0, SEAT_TOP, 0], floorY: FLOOR_Y });
        const applyMs = performance.now() - applyStart;
        const before = seatProbe.sample();
        const beforeOracle = fullSeatRegionOracle(root, oracleRegion);
        assert(Math.abs(before.minY - beforeOracle.minY) <= 1e-7, `${key}/${phase}: cached seat min matches independent full region oracle before adjustment`);
        const requestedPelvisDelta = seatAnchorDelta(SEAT_TOP, before.minY);
        const corrected = solver.applyFrame(frame, { kind: 'seat-anchor', hipWorld: [0, SEAT_TOP + requestedPelvisDelta, 0], floorY: FLOOR_Y });
        const after = seatProbe.sample();
        const afterOracle = fullSeatRegionOracle(root, oracleRegion);
        assert(Math.abs(after.minY - afterOracle.minY) <= 1e-7, `${key}/${phase}: cached seat min matches independent full region oracle after adjustment`);
        const row = { phase, seconds, anchoredHipY: SEAT_TOP, supportStatus: anchored.supportStatus,
          feetStatus: anchored.seatFeetStatus ?? null, seatRegionBefore: before, fullRegionOracleBefore: beforeOracle, requestedPelvisDelta,
          correctedHipY: SEAT_TOP + requestedPelvisDelta, seatRegionAfter: after,
          fullRegionOracleAfter: afterOracle,
          remainingSeatSurfaceError: after.minY - SEAT_TOP, correctedFeetStatus: corrected.seatFeetStatus ?? null,
          solverReach: corrected.reach, applyWallMs: applyMs };
        phaseRows.push(row);
        if (Math.abs(row.remainingSeatSurfaceError) > 0.001) failures.push({ outfit: key, phase, kind: 'seat-surface-anchor-residual', metres: row.remainingSeatSurfaceError });
      }
      cases.push({ key, family: outfit.family, outfit: outfit.outfit, sourceClip: 'sit', duration, phaseCount: phases,
        virtualSeatOnly: { topY: SEAT_TOP, floorY: FLOOR_Y, note: 'Diagnostic plane; not a measured in-game chair.' },
        supportRegion: seatProbe.metrics, phases: phaseRows,
        presentationMetrics: presentation.metrics, footwearMetrics: footwear.metrics,
        claims: ['The seat-region vertex predicate is based on actual indexed Body/outfit skin weights for Hips and proximal thighs.',
          'The reported delta aligns sampled pelvis/proximal-thigh minimum to the supplied virtual plane; it does not certify a particular chair, continuous motion, or visual comfort.'] });
    } catch (error) {
      failures.push({ outfit: key, kind: 'fixture-or-probe-error', error: String(error?.stack ?? error) });
    } finally {
      solver?.dispose(); seatProbe = undefined; footwear?.dispose(); presentation?.dispose(); correction.dispose();
      for (const mesh of skinned(root)) mesh.skeleton.dispose();
      root.parent?.remove(root);
    }
  }
} finally {
  sourceSampler.dispose(); restoreGlobals();
  try { unlinkSync(tempPresentation); } catch {} try { unlinkSync(tempFootwear); } catch {}
  for (const scene of [bodyTemplate, clipScene.scene]) scene.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
}

const result = {
  status: failures.length ? 'DIAGNOSTIC_REJECTED' : 'DIAGNOSTIC_ONLY',
  method: 'CPU-only actual GLTFLoader run using image-stripped pinned body/clip GLBs, family rig correction, shipped authored outfit and shoe adapters, and a cached indexed pelvis/proximal-thigh weight region. For 40 clamped samples of the source sit clip, solve seat anchoring at a stated virtual plane, measure the region, derive the vertical pelvis correction, and resample at the corrected anchor.',
  inputs: { body: { path: path.relative(repo, bodyPath), bytes: bodyBytes.length, sha256: pins.body },
    clips: { path: path.relative(repo, clipPath), bytes: clipBytes.length, sha256: pins.clips },
    shoes: { path: path.relative(repo, shoePath), bytes: shoeBytes.length, sha256: pins.shoes },
    outfits: Object.fromEntries(Object.entries(outfits).map(([name, item]) => [name, { path: path.relative(repo, item.path), bytes: readFileSync(item.path).length, sha256: item.pin }])),
    familyCorrection: sha(readFileSync(path.join(here, 'native-family-rig-correction.ts'))),
    sourceSampler: sha(readFileSync(path.join(here, 'native-source-sampler.ts'))),
    clipSolver: sha(readFileSync(path.join(here, 'native-clip-solver.ts'))),
    seatSurface: sha(readFileSync(path.join(here, 'native-seat-surface.ts'))),
    presentation: sha(readFileSync(presentationPath)), footwear: sha(readFileSync(footwearPath)) },
  supportDefinition: { supportBone: 'mixamorigHips', minimumHipsWeight: 0.15,
    dominance: 'hips weight must be at least the combined left/right proximal-thigh weight',
    envelope: 'posterior to the measured foot-to-toe forward axis, within pelvis-width and hip-to-knee derived vertical bounds',
    maxCachedVertices: 4096, meshes: 'currently indexed Body + one selected authored outfit; empty hidden Body region is permitted; excludes shoes, lower legs and hair' },
  cases, failures,
  limitations: ['No renderer/browser image or mobile performance claim.',
    'The virtual seat top is a diagnostic input, not an actual game chair measurement.',
    'The sampled minimum is a pelvis/proximal-thigh weight-region support proxy, not a continuous collision surface or comfort assessment.',
    'Forty clip samples do not prove bounds between samples.',
    'A positive pelvis delta is only a measured correction proposal; it does not prove arms, legs, garment folds, or furniture contact remain acceptable.'],
};
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, sampleCount: cases.reduce((sum, row) => sum + row.phaseCount, 0),
  cases: cases.map((row) => ({ family: row.family, outfit: row.outfit, cachedVertices: row.supportRegion.candidateVertices,
    sourceVertices: row.supportRegion.sourceIndexedVertices,
    deltaRange: [Math.min(...row.phases.map((phase) => phase.requestedPelvisDelta)), Math.max(...row.phases.map((phase) => phase.requestedPelvisDelta))],
    correctedErrorMaxMm: Math.max(...row.phases.map((phase) => Math.abs(phase.remainingSeatSurfaceError) * 1000)) })),
  failureCount: failures.length, outputPath }, null, 2));
if (failures.length) process.exitCode = 1;
