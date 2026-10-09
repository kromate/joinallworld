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

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const presentationPath = path.join(here, 'authored-presentation.ts');
const footwearPath = path.join(here, 'authored-footwear/presentation.ts');
const tempPresentation = path.join(here, `.native-body-surface-presentation-${process.pid}.ts`);
const tempFootwear = path.join(here, 'authored-footwear', `.native-body-surface-footwear-${process.pid}.ts`);
const outputPath = path.join(here, 'native-body-surface-check-result.json');
const pins = {
  body: 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
  clip: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
  shoes: '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557',
  casual: '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f',
  officeFemale: 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053',
  femaleCasual: '7063492e52bb8817981349df45e141e0bc70dbe3e339d4d2dac8df3bdc3342bd',
  femaleCasualHide: '4efb1cbdb673673f93fc4af657f12ffd59e837c04cebd3a51d2270c361e3d753',
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
function skinned(root) { const out = []; root.traverse((node) => { if (node.isSkinnedMesh) out.push(node); }); return out; }
function bodyMesh(root) { const mesh = skinned(root).find((item) => item.name === 'Body'); assert(mesh, 'Body mesh'); return mesh; }
function setFamily(root, family) {
  for (const mesh of skinned(root)) {
    const dict = mesh.morphTargetDictionary, values = mesh.morphTargetInfluences;
    assert(dict && values, `${mesh.name} family morphs`);
    values[dict.bodyFeminine] = family === 'woman' ? 1 : 0;
    values[dict.bodyMasculine] = family === 'man' ? 1 : 0;
  }
}
function updateActor(root) {
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  for (const mesh of skinned(root)) mesh.skeleton.update();
}
function geometrySnapshot(root) {
  return skinned(root).map((mesh) => ({ name: mesh.name,
    attributes: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [name,
      sha(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength))])),
    index: mesh.geometry.index ? sha(Buffer.from(mesh.geometry.index.array.buffer, mesh.geometry.index.array.byteOffset, mesh.geometry.index.array.byteLength)) : null }));
}
function rootTransform(root) { return { position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() }; }
function visible(mesh) {
  for (let node = mesh; node; node = node.parent) if (!node.visible) return false;
  return true;
}
function fullIndexedBounds(root, meshes) {
  updateActor(root);
  const point = new THREE.Vector3(); let minY = Infinity, maxY = -Infinity, verticesVisited = 0;
  const perMesh = [];
  for (const mesh of meshes) {
    if (!visible(mesh)) continue;
    const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    assert(index, `${mesh.name} oracle expects indexed geometry`);
    const start = Math.max(0, mesh.geometry.drawRange.start ?? 0);
    const count = Number.isFinite(mesh.geometry.drawRange.count) ? mesh.geometry.drawRange.count : index.count;
    const end = Math.min(index.count, start + count);
    const used = new Set();
    for (let i = start; i < end; i++) used.add(index.getX(i));
    let meshMin = Infinity, meshMax = -Infinity;
    for (const vertex of used) {
      mesh.getVertexPosition(vertex, point); mesh.localToWorld(point);
      assert(Number.isFinite(point.y), `${mesh.name} oracle vertex ${vertex} finite`);
      meshMin = Math.min(meshMin, point.y); meshMax = Math.max(meshMax, point.y);
      verticesVisited++;
    }
    assert(used.size > 0, `${mesh.name} has visible indexed vertices`);
    minY = Math.min(minY, meshMin); maxY = Math.max(maxY, meshMax);
    perMesh.push({ name: mesh.name, indexedVertices: used.size, minY: meshMin, maxY: meshMax });
  }
  assert(Number.isFinite(minY) && Number.isFinite(maxY), 'oracle has visible body/clothing/shoe geometry');
  return { minY, maxY, verticesVisited, perMesh };
}
function fileFetch() {
  const originalFetch = globalThis.fetch, originalSelf = globalThis.self, originalBitmap = globalThis.createImageBitmap;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol !== 'file:') return originalFetch(input, init);
    return new Response(readFileSync(fileURLToPath(url)), { status: 200 });
  };
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  return () => {
    globalThis.fetch = originalFetch;
    if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
    if (originalBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalBitmap;
  };
}
function prepareProductionAdapters() {
  let presentationSource = readFileSync(presentationPath, 'utf8');
  const presentationImports = [
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
  for (const [from, to] of presentationImports) { assert(presentationSource.includes(from), `presentation import ${from}`); presentationSource = presentationSource.replace(from, to); }
  writeFileSync(tempPresentation, presentationSource);
  let shoeSource = readFileSync(footwearPath, 'utf8');
  const shoeImport = "import shoesUrl from './out/shoes01-mobile.glb?url';";
  assert(shoeSource.includes(shoeImport), 'shoe URL import');
  shoeSource = shoeSource.replace(shoeImport, "const shoesUrl = new URL('./out/shoes01-mobile.glb', import.meta.url).href;");
  writeFileSync(tempFootwear, shoeSource);
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), clipBytes = readFileSync(clipPath);
const shoeBytes = readFileSync(path.join(here, 'authored-footwear/out/shoes01-mobile.glb'));
for (const [name, bytes, pin] of [['body', bodyBytes, pins.body], ['clip', clipBytes, pins.clip], ['shoes', shoeBytes, pins.shoes]]) assert.equal(sha(bytes), pin, `${name} asset pin`);
const outfitInputs = {
  casual: { path: path.join(here, 'authored-clothing/out/male_casualsuit01.glb'), sha256: pins.casual },
  office: { path: path.join(here, 'authored-clothing/office-export/out/office-female.glb'), sha256: pins.officeFemale },
};
for (const [name, input] of Object.entries(outfitInputs)) assert.equal(sha(readFileSync(input.path)), input.sha256, `${name} outfit pin`);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const bodyTemplate = (await loader.parseAsync(imageFreeGlb(bodyBytes), '/')).scene;
const clipGltf = await loader.parseAsync(imageFreeGlb(clipBytes), '/');
const bodyTemplateSnapshot = geometrySnapshot(bodyTemplate);
const sourceSampler = createNativeSourceLandmarkSampler(clipGltf.scene, clipGltf.animations);
const originalBodyTemplateHash = JSON.stringify(skinned(bodyTemplate).map((mesh) => mesh.geometry.getAttribute('position').array.length));
const restoreGlobals = fileFetch();
let applyPresentation, applyFootwear;
try {
  prepareProductionAdapters();
  ({ applyAuthoredPresentation: applyPresentation } = await import(`${pathToFileURL(tempPresentation).href}?run=${Date.now()}`));
  ({ applyAuthoredFootwear: applyFootwear } = await import(`${pathToFileURL(tempFootwear).href}?run=${Date.now()}`));
} catch (error) {
  restoreGlobals(); try { unlinkSync(tempPresentation); } catch {} try { unlinkSync(tempFootwear); } catch {}
  throw error;
}

const configurations = [
  { family: 'man', outfit: 'casual', body: 'man', hair: 'lowcut', outfitColor: '#3f72c4', bottomsColor: '#243a66', fabric: 'plain', hairColor: '#1c1917', root: { p: [1.25, 0.37, -0.82], yaw: 0.63, scale: 1.08 } },
  { family: 'woman', outfit: 'office', body: 'woman', hair: 'afro', outfitColor: '#4f6e8c', bottomsColor: '#263849', fabric: 'plain', hairColor: '#1c1917', root: { p: [-0.91, 0.28, 1.14], yaw: -0.48, scale: 0.94 } },
];
const requestedClips = ['sleep', 'lie-down', 'get-up'];
for (const clip of requestedClips) assert(sourceSampler.durations.has(clip) && sourceSampler.durations.get(clip) > 0, `source clip ${clip} exists`);
const cases = [];
const violations = [];
try {
  for (const config of configurations) {
    const root = cloneSkinnedHierarchy(bodyTemplate);
    root.position.fromArray(config.root.p); root.rotation.y = config.root.yaw; root.scale.setScalar(config.root.scale);
    setFamily(root, config.family);
    const correction = applyNativeFamilyRigCorrection(root);
    const expectedRootTransform = rootTransform(root);
    let presentation, footwear, solver;
    try {
      presentation = await applyPresentation(root, { body: config.body, outfit: config.outfit, outfitColor: config.outfitColor,
        bottomsColor: config.bottomsColor, fabric: config.fabric, hair: config.hair, hairColor: config.hairColor });
      footwear = await applyFootwear(root);
      const body = bodyMesh(root), shoe = footwear.object;
      const garmentName = config.outfit === 'office' ? 'Authored office suit' : 'Authored casual suit';
      const garment = skinned(root).find((mesh) => mesh.name === garmentName);
      assert(garment, `${config.family} actual ${config.outfit} garment is mounted`);
      assert(shoe.parent, `${config.family} shoes are mounted`);
      const includedMeshes = [body, garment, shoe];
      solver = createNativeClipSolver(root, { sourceRest: sourceSampler.restLandmarks, footSurface: shoe, bodySurfaceMeshes: includedMeshes });
      const clipRows = [];
      for (const clipName of requestedClips) {
        const duration = sourceSampler.durations.get(clipName);
        const phaseRows = [];
        for (let phase = 0; phase < 40; phase++) {
          const seconds = duration * phase / 39;
          const frame = sourceSampler.sampleClip(clipName, seconds, 'clamp');
          const applyStart = performance.now();
          const result = solver.applyFrame(frame, { kind: 'body-surface', surfaceY: 0 });
          assert.deepEqual(rootTransform(root), expectedRootTransform, `${config.family}/${clipName}@${phase} actor root placement unchanged`);
          const applyMs = performance.now() - applyStart;
          const oracleStart = performance.now();
          const oracle = fullIndexedBounds(root, includedMeshes);
          const oracleMs = performance.now() - oracleStart;
          const penetration = Math.max(0, -oracle.minY);
          const candidateUnder = result.bodyMinY - 0;
          phaseRows.push({ phase, seconds, sparse: { minY: result.bodyMinY, maxY: result.bodyMaxY },
            fullIndexOracle: oracle, penetrationMetres: penetration, sparseMinResidualMetres: candidateUnder,
            applyWallMs: applyMs, oracleWallMs: oracleMs });
          if (penetration > 0.004 + 1e-9) violations.push({ family: config.family, clipName, phase, kind: 'full-index-penetration', metres: penetration });
          if (!(result.bodyMinY >= -1e-5 && result.bodyMinY <= 1e-5)) violations.push({ family: config.family, clipName, phase, kind: 'sparse-plane-residual', metres: result.bodyMinY });
        }
        clipRows.push({ clipName, duration, phases: phaseRows,
          maximumPenetrationMetres: Math.max(...phaseRows.map((row) => row.penetrationMetres)),
          maximumSparseToOracleMinDifferenceMetres: Math.max(...phaseRows.map((row) => Math.abs(row.sparse.minY - row.fullIndexOracle.minY))),
          candidateSourceVertices: phaseRows[0].fullIndexOracle.verticesVisited,
          meanApplyWallMs: phaseRows.reduce((sum, row) => sum + row.applyWallMs, 0) / phaseRows.length,
          meanFullOracleWallMs: phaseRows.reduce((sum, row) => sum + row.oracleWallMs, 0) / phaseRows.length });
      }
      // Stand -> lie -> sleep -> get-up sequence shares one actor and solver. Each sample is consumed synchronously.
      const transition = [];
      for (const [clipName, ratio] of [['idle', 0], ['lie-down', 0.5], ['sleep', 0.25], ['get-up', 0.75]]) {
        const duration = sourceSampler.durations.get(clipName); assert(duration > 0, `${clipName} duration`);
        const frame = sourceSampler.sampleClip(clipName, duration * ratio, clipName === 'idle' ? 'loop' : 'clamp');
        const applied = solver.applyFrame(frame, { kind: 'body-surface', surfaceY: 0 });
        assert.deepEqual(rootTransform(root), expectedRootTransform, `${config.family} transition ${clipName} actor root placement unchanged`);
        const oracle = fullIndexedBounds(root, includedMeshes);
        const penetration = Math.max(0, -oracle.minY);
        transition.push({ clipName, seconds: duration * ratio, sparseMinY: applied.bodyMinY, oracleMinY: oracle.minY, penetrationMetres: penetration });
        if (penetration > 0.004 + 1e-9) violations.push({ family: config.family, clipName, kind: 'transition-full-index-penetration', metres: penetration });
      }
      cases.push({ family: config.family, outfit: config.outfit,
        rootTransform: { position: root.position.toArray(), rotationY: root.rotation.y, scale: root.scale.toArray() },
        includedMeshes: includedMeshes.map((mesh) => ({ name: mesh.name, vertices: mesh.geometry.getAttribute('position').count,
          indexCount: mesh.geometry.index.count, visible: mesh.visible })),
        excludedHair: skinned(root).filter((mesh) => !includedMeshes.includes(mesh)).map((mesh) => mesh.name),
        surfaceProbe: { candidateVerticesPerActor: solver.metrics.bodySurfaceCandidateVertices,
          footSupportVertices: solver.metrics.supportCandidateVertices,
          fullIndexedVerticesPerFrame: clipRows[0].phases[0].fullIndexOracle.verticesVisited },
        clips: clipRows, transition, presentationMetrics: presentation.metrics, footwearMetrics: footwear.metrics });
    } finally {
      solver?.dispose(); footwear?.dispose(); presentation?.dispose(); correction.dispose();
      for (const mesh of skinned(root)) mesh.skeleton.dispose();
      root.parent?.remove(root);
    }
  }
} finally {
  sourceSampler.dispose(); restoreGlobals();
  try { unlinkSync(tempPresentation); } catch {} try { unlinkSync(tempFootwear); } catch {}
  for (const root of [bodyTemplate, clipGltf.scene]) root.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
}
assert.deepEqual(geometrySnapshot(bodyTemplate), bodyTemplateSnapshot, 'shared source Body geometry remains byte-identical');
const result = { status: violations.length ? 'REJECTED_FULL_INDEX_ORACLE' : 'PASS_DIAGNOSTIC_ONLY', method: 'Actual image-stripped production Body/clip GLBs, native family correction, authored casual/office presentation and mobile footwear adapters. Compared current body-surface bounds against an independent full indexed-vertex scan over the selected visible Body, outfit, and shoe meshes.',
  inputs: { body: { path: path.relative(repo, bodyPath), bytes: bodyBytes.length, sha256: pins.body }, clipPack: { path: path.relative(repo, clipPath), bytes: clipBytes.length, sha256: pins.clip }, shoes: { path: 'evidence/graphics-loop/authored-complete-body-v1/authored-footwear/out/shoes01-mobile.glb', bytes: shoeBytes.length, sha256: pins.shoes },
    outfits: Object.fromEntries(Object.entries(outfitInputs).map(([name, input]) => [name, { path: path.relative(repo, input.path), bytes: readFileSync(input.path).length, sha256: input.sha256 }])),
    familyCorrectionSha256: sha(readFileSync(path.join(here, 'native-family-rig-correction.ts'))), bodySurfaceSha256: sha(readFileSync(path.join(here, 'native-body-surface.ts'))), clipSolverSha256: sha(readFileSync(path.join(here, 'native-clip-solver.ts'))), presentationSha256: sha(readFileSync(presentationPath)), footwearAdapterSha256: sha(readFileSync(footwearPath)) },
  sampleCount: cases.length * requestedClips.length * 40, cases, violations,
  limitations: ['CPU geometry oracle only; no rendered contact or mobile performance claim.', 'The oracle covers indexed vertices of visible Body, selected clothing mesh, and shoes; hair is excluded by design.', 'Shader-discarded body triangles are still counted by the index oracle, so the bound is conservative for those hidden regions.', 'A phase matrix is sampled, not a proof for every continuous point between the 40 clip samples.'] };
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, sampleCount: result.sampleCount, cases: cases.map((item) => ({ family: item.family, outfit: item.outfit,
  candidateVertices: item.surfaceProbe.candidateVerticesPerActor, fullVertices: item.surfaceProbe.fullIndexedVerticesPerFrame,
  clips: item.clips.map((clip) => ({ name: clip.clipName, worstPenetrationMm: clip.maximumPenetrationMetres * 1000,
    worstSparseDeltaMm: clip.maximumSparseToOracleMinDifferenceMetres * 1000, meanApplyMs: clip.meanApplyWallMs, meanOracleMs: clip.meanFullOracleWallMs })) })),
  violationCount: violations.length, worstViolationMm: Math.max(0, ...violations.map((row) => row.metres * 1000)), outputPath }, null, 2));
if (violations.length) process.exitCode = 1;
