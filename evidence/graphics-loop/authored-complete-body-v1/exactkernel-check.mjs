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
import { createNativeSourceLandmarkSampler } from './native-source-sampler.ts';
import { createNativeClipSolver } from './native-clip-solver.ts';
import { createNativeBodySurfaceProbe } from './native-body-surface.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const tempPresentation = path.join(here, `.exactkernel-presentation-${process.pid}.ts`);
const tempFootwear = path.join(here, 'authored-footwear', `.exactkernel-footwear-${process.pid}.ts`);
const outputPath = path.join(here, 'exactkernel-check-result.json');
const pins = {
  body: 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
  clip: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
  shoes: '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557',
  casual: '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f',
  officeFemale: 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053',
};
const sha = (data) => createHash('sha256').update(data).digest('hex');

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

function meshes(root) { const result = []; root.traverse((node) => { if (node.isSkinnedMesh) result.push(node); }); return result; }
function bodyMesh(root) { const mesh = meshes(root).find((item) => item.name === 'Body'); assert(mesh, 'Body mesh'); return mesh; }
function visible(mesh) { for (let node = mesh; node; node = node.parent) if (!node.visible) return false; return true; }
function update(root) { root.updateWorldMatrix(true, false); root.updateMatrixWorld(true); for (const mesh of meshes(root)) mesh.skeleton.update(); }

function prepareAdapters() {
  const presentationPath = path.join(here, 'authored-presentation.ts');
  const footwearPath = path.join(here, 'authored-footwear/presentation.ts');
  let presentation = readFileSync(presentationPath, 'utf8');
  const replacements = [
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
  for (const [from, to] of replacements) { assert(presentation.includes(from), `missing import ${from}`); presentation = presentation.replace(from, to); }
  writeFileSync(tempPresentation, presentation);
  const footwearPathActual = path.join(here, 'authored-footwear/presentation.ts');
  let footwear = readFileSync(footwearPathActual, 'utf8');
  const shoeImport = "import shoesUrl from './out/shoes01-mobile.glb?url';";
  assert(footwear.includes(shoeImport), 'shoe URL import');
  footwear = footwear.replace(shoeImport, "const shoesUrl = new URL('./out/shoes01-mobile.glb', import.meta.url).href;");
  writeFileSync(tempFootwear, footwear);
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), clipBytes = readFileSync(clipPath);
const shoePath = path.join(here, 'authored-footwear/out/shoes01-mobile.glb');
assert.equal(sha(bodyBytes), pins.body, 'body asset pin');
assert.equal(sha(clipBytes), pins.clip, 'clip asset pin');
assert.equal(sha(readFileSync(shoePath)), pins.shoes, 'shoe asset pin');
assert.equal(sha(readFileSync(path.join(here, 'authored-clothing/out/male_casualsuit01.glb'))), pins.casual, 'casual asset pin');
assert.equal(sha(readFileSync(path.join(here, 'authored-clothing/office-export/out/office-female.glb'))), pins.officeFemale, 'office asset pin');

const originalFetch = globalThis.fetch, originalSelf = globalThis.self, originalBitmap = globalThis.createImageBitmap;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  return url.protocol === 'file:' ? new Response(readFileSync(fileURLToPath(url)), { status: 200 }) : originalFetch(input, init);
};
globalThis.self = globalThis; globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const template = (await loader.parseAsync(imageFreeGlb(bodyBytes), '/')).scene;
const clipGltf = await loader.parseAsync(imageFreeGlb(clipBytes), '/');
let applyPresentation, applyFootwear;
try {
  prepareAdapters();
  ({ applyAuthoredPresentation: applyPresentation } = await import(`${pathToFileURL(tempPresentation).href}?kernel=${Date.now()}`));
  ({ applyAuthoredFootwear: applyFootwear } = await import(`${pathToFileURL(tempFootwear).href}?kernel=${Date.now()}`));
} catch (error) {
  globalThis.fetch = originalFetch;
  if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
  if (originalBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalBitmap;
  try { unlinkSync(tempPresentation); } catch {} try { unlinkSync(tempFootwear); } catch {}
  throw error;
}

const sampler = createNativeSourceLandmarkSampler(clipGltf.scene, clipGltf.animations);
const reports = [];
try {
  for (const family of ['man', 'woman']) {
    const root = cloneSkinnedHierarchy(template);
    for (const mesh of meshes(root)) {
      const dictionary = mesh.morphTargetDictionary, influences = mesh.morphTargetInfluences;
      assert(dictionary && influences, `${mesh.name} morph state`);
      if (dictionary.bodyMasculine !== undefined) influences[dictionary.bodyMasculine] = family === 'man' ? 1 : 0;
      if (dictionary.bodyFeminine !== undefined) influences[dictionary.bodyFeminine] = family === 'woman' ? 1 : 0;
    }
    const correction = applyNativeFamilyRigCorrection(root);
    let presentation, footwear, solver;
    try {
      presentation = await applyPresentation(root, { body: family, outfit: family === 'man' ? 'casual' : 'office',
        outfitColor: '#3f72c4', bottomsColor: '#243a66', fabric: 'plain', hair: family === 'man' ? 'lowcut' : 'afro', hairColor: '#1c1917' });
      footwear = await applyFootwear(root);
      const body = bodyMesh(root), shoe = footwear.object;
      const outfitName = family === 'man' ? 'Authored casual suit' : 'Authored office suit';
      const outfit = meshes(root).find((mesh) => mesh.name === outfitName);
      assert(outfit && shoe.parent, `${family}: body outfit and shoes mounted`);
      const included = [body, outfit, shoe].filter((mesh) => visible(mesh));
      const probe = createNativeBodySurfaceProbe(root, included);
      solver = createNativeClipSolver(root, { sourceRest: sampler.restLandmarks, footSurface: shoe, bodySurfaceMeshes: included });
      const poses = [
        ['idle', 0.17, 'loop'], ['walk', 0.23, 'loop'], ['cook', 0.61, 'clamp'],
        ['sit', 0.45, 'clamp'],
      ];
      const poseRows = [];
      for (const [clipName, phase, mode] of poses) {
        assert(sampler.durations.has(clipName), `pinned clip ${clipName} available`);
        const duration = sampler.durations.get(clipName);
        const frame = sampler.sampleClip(clipName, duration * phase, mode);
        solver.applyFrame(frame, { kind: 'body-surface', surfaceY: 0 });
        update(root);
        const verification = probe.verifyAgainstThree();
        assert(verification.verticesChecked === probe.candidateCount, `${family}/${clipName}: all active vertices checked`);
        assert(verification.maxPositionError <= 1e-6, `${family}/${clipName}: kernel position delta ${verification.maxPositionError}`);
        const exact = probe.sample();
        const sampleTimes = [];
        for (let repeat = 0; repeat < 15; repeat++) { const started = performance.now(); probe.sample(); sampleTimes.push(performance.now() - started); }
        sampleTimes.sort((a, b) => a - b);
        const timing = { samples: sampleTimes.length, medianMs: sampleTimes[Math.floor(sampleTimes.length / 2)], maxMs: sampleTimes.at(-1), note: 'Remote runner CPU, not phone performance' };
        const oracle = (() => {
          let minY = Infinity, maxY = -Infinity; const point = new THREE.Vector3();
          for (const mesh of included) {
            const seen = new Set();
            for (let i = 0; i < mesh.geometry.index.count; i++) seen.add(mesh.geometry.index.getX(i));
            for (const vertex of seen) {
              mesh.getVertexPosition(vertex, point); point.applyMatrix4(mesh.matrixWorld);
              minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
            }
          }
          return { minY, maxY };
        })();
        assert(Math.abs(exact.minY - oracle.minY) <= 1e-6 && Math.abs(exact.maxY - oracle.maxY) <= 1e-6,
          `${family}/${clipName}: exact bound mismatch`);
        poseRows.push({ clipName, phase, timing, indexedVertices: verification.verticesChecked, maxPositionError: verification.maxPositionError,
          minYError: verification.minYError, maxYError: verification.maxYError, minY: exact.minY, maxY: exact.maxY });
      }
      reports.push({ family, activeMeshes: included.map((mesh) => ({ name: mesh.name,
        positionCount: mesh.geometry.getAttribute('position').count, indexCount: mesh.geometry.index?.count ?? null,
        drawRange: { ...mesh.geometry.drawRange }, groupCount: mesh.geometry.groups.length })),
        exactIndexedVertices: probe.candidateCount, poses: poseRows });
    } finally {
      solver?.dispose(); footwear?.dispose(); presentation?.dispose(); correction.dispose();
      for (const mesh of meshes(root)) mesh.skeleton.dispose();
      root.parent?.remove(root);
    }
  }
} finally {
  sampler.dispose();
  globalThis.fetch = originalFetch;
  if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
  if (originalBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalBitmap;
  try { unlinkSync(tempPresentation); } catch {} try { unlinkSync(tempFootwear); } catch {}
  for (const scene of [template, clipGltf.scene]) scene.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
}
const result = { status: 'PASS_EXACT_KERNEL_DIAGNOSTIC', method: 'Batched morph + bind + Float32 skeleton palette + bind inverse + mesh world transform compared vertex-by-vertex with SkinnedMesh.getVertexPosition and matrixWorld.', pins, reports,
  limitations: ['Exact CPU geometry parity only; no rendered visual quality or mobile performance conclusion.', 'Bounds use visible indexed vertices in drawRange and material groups at probe creation; sample refreshes those ranges when their signature changes.', 'The same pose clips are applied by the existing native clip solver; this check validates its current visible surface bounds, not contact quality.'] };
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, reports: reports.map((report) => ({ family: report.family,
  indexedVertices: report.exactIndexedVertices, maxPositionError: Math.max(...report.poses.map((pose) => pose.maxPositionError)), poses: report.poses.length })), outputPath }, null, 2));
