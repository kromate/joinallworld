import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import * as esbuild from 'esbuild';
import { createKit } from '../../../../src/scene/kit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const entry = path.join(here, '.trouser-sock-trim-check-v2-entry.ts');
const bundle = path.join(here, '.trouser-sock-trim-check-v2.bundle.mjs');
const factory = path.join(here, 'native-prepared-factory-v29.ts');
const helper = path.join(here, 'trouser-sock-trim.ts');
const pins = Object.freeze([
  ['evidence/graphics-loop/authored-complete-body-v1/authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb', 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552'],
  ['src/scene/body/assets/clip-pack.glb', '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-footwear/out/shoes01-mobile.glb', '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/out/male_casualsuit01.glb', '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/casual-female-export/out/casual-female.glb', '7063492e52bb8817981349df45e141e0bc70dbe3e339d4d2dac8df3bdc3342bd'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/out/office-female.glb', 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-hair/out/afro01-mobile.glb', '3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-hair/out/short02-mobile.glb', 'a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0'],
  ['evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/native-prepared-factory-v29.ts', 'ecf30896371cdf65317894e5f2add34eb7679f0f8b9c5f72210457159f38f5e2'],
  ['evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/trouser-sock-trim.ts', 'b4cf4586b55a6b2324dc08b6d5969e754e3166a97f66ef81794371aede9106d7'],
]);
const actors = [];
const kits = [];
const originalFetch = globalThis.fetch;
const originalBitmap = globalThis.createImageBitmap;
const originalProgressEvent = globalThis.ProgressEvent;
const originalSelf = globalThis.self;
const originalTextureLoad = THREE.TextureLoader.prototype.load;
const result = { status: 'fail', purpose: 'actual geometry/index lifecycle check; rendered identity is assessed separately by the A/B viewer' };
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function mesh(root, name) {
  let result;
  root.traverse((node) => { if (node.name === name && node.isSkinnedMesh) result = node; });
  assert.ok(result, `Missing actor SkinnedMesh ${name}`);
  return result;
}
function look(body, outfit) {
  return {
    body, hair: body === 'man' ? 'lowcut' : 'afro', outfit, fabric: 'plain', skin: 'skin3', hairColor: 'darkbrown',
    outfitColor: body === 'man' ? 'navy' : outfit === 'office' ? 'red' : 'purple', bottomsColor: 'cream', accessories: [], face: 'oval', expression: 'neutral',
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
  };
}
async function loadActor(prepare, body, outfit) {
  const kit = createKit(); kits.push(kit);
  const actor = await prepare({ kit, seed: `sock-trim-${body}-${outfit}`, look: look(body, outfit), sceneScale: 1, retargetMode: 'directions' });
  actors.push(actor);
  actor.place(0, 0, 0, 0);
  actor.show('idle', false);
  return actor;
}
function solve(actor, phase) {
  if (phase === null) actor.show('idle', false);
  else { actor.show('walk', false); actor.stride(phase, false, 0); }
  const support = actor.solveFeet(() => 0);
  assert.equal(support.limited, false, `pose support limited at ${phase}`);
  assert.ok(support.maxError <= 0.004, `pose contact error exceeded 4mm at ${phase}: ${support.maxError}`);
  return support;
}
async function verifyActor(prepare, body, outfit) {
  const actor = await loadActor(prepare, body, outfit);
  const garmentName = outfit === 'office' ? 'Authored office suit' : 'Authored casual suit';
  const shoes = mesh(actor.object, 'Authored footwear shoes01');
  const garment = mesh(actor.object, garmentName);
  assert.equal(shoes.skeleton, garment.skeleton);
  const sourceGeometry = shoes.geometry;
  const sourceIndex = sourceGeometry.getIndex();
  assert.ok(sourceIndex && sourceIndex.count % 3 === 0);
  const sourceIndexArray = sourceIndex.array.slice();
  const sourceAttributes = { ...sourceGeometry.attributes };
  const sourceMaterial = shoes.material;
  const sourceSkeleton = shoes.skeleton;
  const phases = [null, Math.PI * 0.5, Math.PI, Math.PI * 1.5, Math.PI * 2];
  const removed = new Set();
  const protectedSoles = new Set();
  let probeCount = 0;
  for (const phase of phases) {
    solve(actor, phase);
    const probe = trimAuthoredSockAboveTrouserHem({ actorRoot: actor.object, garment, shoes, trouserOutfit: outfit === 'casual',
      additionalRemovedSourceTriangleIds: [...removed], protectedSoleSourceTriangleIds: [...protectedSoles] });
    probeCount++;
    for (const triangle of probe.metrics.removedSourceTriangleIds) removed.add(triangle);
    for (const triangle of probe.metrics.protectedSoleSourceTriangleIds) protectedSoles.add(triangle);
    probe.dispose();
    assert.equal(shoes.geometry, sourceGeometry, 'probe disposal restores source geometry');
    assert.deepEqual(sourceIndex.array, sourceIndexArray, 'probe never mutates source index bytes');
  }
  solve(actor, null);
  const lease = trimAuthoredSockAboveTrouserHem({ actorRoot: actor.object, garment, shoes, trouserOutfit: outfit === 'casual',
    additionalRemovedSourceTriangleIds: [...removed], protectedSoleSourceTriangleIds: [...protectedSoles] });
  const candidate = shoes.geometry;
  const candidateIndex = candidate.getIndex();
  assert.ok(candidateIndex, 'candidate retains a valid index');
  assert.notEqual(candidate, sourceGeometry, 'trim candidate is private geometry');
  assert.equal(shoes.skeleton, sourceSkeleton, 'trim keeps the actor skeleton');
  assert.equal(shoes.material, sourceMaterial, 'trim keeps the shoe material');
  for (const [name, attribute] of Object.entries(sourceAttributes)) assert.equal(candidate.getAttribute(name), attribute, `${name} attribute stays shared and immutable`);
  assert.deepEqual(sourceIndex.array, sourceIndexArray, 'trim leaves source index bytes unchanged');
  assert.equal(lease.metrics.sourceTriangles, sourceIndex.count / 3);
  assert.equal(lease.metrics.retainedTriangles, candidateIndex.count / 3);
  assert.equal(lease.metrics.removedTriangles, lease.metrics.removedSourceTriangleIds.length);
  assert.ok(lease.metrics.protectedSoleSourceTriangleIds.every((id) => !lease.metrics.removedSourceTriangleIds.includes(id)));
  if (outfit === 'casual') assert.ok(lease.metrics.removedTriangles > 0, `${body} trouser look removes sock triangles`);
  else {
    assert.equal(lease.metrics.status, 'skipped-skirt');
    assert.equal(candidateIndex.count, sourceIndex.count, 'office skirt retains all source sock triangles');
  }
  const indexedTrianglesAtAllPhases = [];
  for (const phase of phases) {
    const contact = solve(actor, phase);
    indexedTrianglesAtAllPhases.push({ phase, active: shoes.geometry.getIndex().count / 3, contact });
  }
  const metrics = { body, outfit, sourceTriangles: sourceIndex.count / 3, retainedTriangles: candidateIndex.count / 3,
    removedTriangles: lease.metrics.removedTriangles, protectedSoleTriangles: lease.metrics.protectedSoleSourceTriangleIds.length,
    perSide: lease.metrics.sides, probeCount, indexedTrianglesAtAllPhases };
  shoes.geometry = sourceGeometry;
  lease.dispose();
  assert.equal(shoes.geometry, sourceGeometry, 'lease disposal restores original geometry even when source A/B is selected');
  actor.dispose();
  kits.at(-1).dispose();
  actors.pop(); kits.pop();
  return metrics;
}
async function bundleEntry() {
  const contents = `export { prepareNativeSkinnedBody } from ${JSON.stringify(factory)};\nexport { trimAuthoredSockAboveTrouserHem } from ${JSON.stringify(helper)};`;
  await esbuild.build({ stdin: { contents, resolveDir: here, sourcefile: 'trouser-sock-trim-check-v2-entry.ts', loader: 'ts' }, outfile: bundle,
    bundle: true, format: 'esm', platform: 'node', target: 'node24', packages: 'external', write: true, logLevel: 'silent',
    plugins: [{ name: 'file-url-assets', setup(build) {
      build.onResolve({ filter: /\?url$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'file-url' }));
      build.onLoad({ filter: /.*/, namespace: 'file-url' }, (args) => ({ contents: `export default ${JSON.stringify(pathToFileURL(args.path).href)};`, loader: 'js' }));
    } }],
  });
  return import(`${pathToFileURL(bundle).href}?run=${Date.now()}`);
}
try {
  const inputHashes = {};
  for (const [relative, expected] of pins) {
    const bytes = await readFile(path.join(repo, relative));
    const actual = sha(bytes);
    assert.equal(actual, expected, `input source changed: ${relative}`);
    inputHashes[relative] = { sha256: actual, bytes: bytes.byteLength };
  }
  await import('three/examples/jsm/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => MeshoptDecoder.ready);
  if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
  if (typeof globalThis.ProgressEvent === 'undefined') globalThis.ProgressEvent = class extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!url.startsWith('file:')) return originalFetch(input, init);
    return new Response(await readFile(fileURLToPath(url)), { status: 200, headers: { 'content-type': url.endsWith('.json') ? 'application/json' : 'model/gltf-binary' } });
  };
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  THREE.TextureLoader.prototype.load = function (_url, onLoad, _progress, onError) {
    const texture = new THREE.Texture({ width: 1, height: 1, data: new Uint8Array(4) });
    texture.needsUpdate = true;
    queueMicrotask(() => { try { onLoad?.(texture); } catch (error) { onError?.(error); } });
    return texture;
  };
  const { prepareNativeSkinnedBody, trimAuthoredSockAboveTrouserHem } = await bundleEntry();
  const actorMetrics = [];
  actorMetrics.push(await verifyActor(prepareNativeSkinnedBody, 'man', 'casual'));
  actorMetrics.push(await verifyActor(prepareNativeSkinnedBody, 'woman', 'casual'));
  actorMetrics.push(await verifyActor(prepareNativeSkinnedBody, 'woman', 'office'));
  result.status = 'pass';
  Object.assign(result, { inputHashes, actorMetrics, interpretation: 'indices/ownership/contact checks passed for sampled poses; pixel review remains a separate gate' });
} catch (error) {
  result.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  process.exitCode = 1;
} finally {
  for (const actor of actors.splice(0)) { try { actor.dispose(); } catch {} }
  for (const kit of kits.splice(0)) { try { kit.dispose(); } catch {} }
  globalThis.fetch = originalFetch;
  globalThis.createImageBitmap = originalBitmap;
  globalThis.ProgressEvent = originalProgressEvent;
  globalThis.self = originalSelf;
  THREE.TextureLoader.prototype.load = originalTextureLoad;
  await unlink(bundle).catch(() => {});
  console.log(JSON.stringify(result, null, 2));
}
