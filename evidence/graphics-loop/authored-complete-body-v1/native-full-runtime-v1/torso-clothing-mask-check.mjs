import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import * as esbuild from 'esbuild';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createKit } from '../../../../src/scene/kit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const bundled = path.join(here, '.torso-clothing-mask-check.bundle.mjs');
const inputs = Object.freeze([
  ['evidence/graphics-loop/authored-complete-body-v1/authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb', 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552'],
  ['src/scene/body/assets/clip-pack.glb', '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/out/office-female.glb', 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/out/office-female-body-hide-map.json', '47c3999dd2facb11511965925d2adfa160519a72f4cbb4834ccfd636be7cfa66'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-footwear/out/shoes01-mobile.glb', '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-footwear/out/shoes01-body-hide-map.json', 'ba75d7ab36418434c40ad7c8c41d3723740782714e45890c3183d582b507ad71'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-hair/out/afro01-mobile.glb', '3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474'],
  ['evidence/graphics-loop/authored-complete-body-v1/skin-assets/mobile/1024/middleage_african_female_q90.jpg', 'd2f3d02e63a705173e888578ea91ecfb56ffdc207f59b6407687f1fe66cbd3c1'],
]);
const relativeSource = path.join(here, 'native-prepared-factory.ts');
const relativeHelper = path.join(here, 'torso-clothing-mask.ts');
const checkSourcePaths = [
  relativeSource,
  relativeHelper,
  path.join(here, '../native-family-rig-correction.ts'),
  path.join(repo, 'evidence/graphics-loop/authored-complete-body-v1/authored-presentation.ts'),
  path.join(repo, 'src/scene/body/skinned.ts'),
];
const sourceHashes = {};
const sourceStats = { fetchedBytes: 0, files: 0, imageDecodes: 0 };
const originalFetch = globalThis.fetch;
const originalBitmap = globalThis.createImageBitmap;
const originalProgressEvent = globalThis.ProgressEvent;
const originalSelf = globalThis.self;
const originalTextureLoad = THREE.TextureLoader.prototype.load;
const loadedRoots = [];
const actors = [];
const kits = [];
let sourceGeometry;
let outcome = { status: 'fail', purpose: 'active factory geometry diagnostic only; candidate IDs are not visually accepted' };

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function getSkinned(root, name) {
  let found;
  root.traverse((node) => { if (node.name === name && node.isSkinnedMesh) found = node; });
  assert.ok(found, `missing SkinnedMesh ${name}`);
  return found;
}
function savedLook() {
  return {
    body: 'woman', hair: 'afro', outfit: 'office', fabric: 'plain',
    skin: 'skin3', hairColor: 'black', outfitColor: 'red', bottomsColor: 'cream',
    accessories: [], face: 'round', expression: 'smile',
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
  };
}
async function parseGlb(relative) {
  const bytes = await readFile(path.join(repo, relative));
  sourceStats.fetchedBytes += bytes.byteLength;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const root = (await loader.parseAsync(buffer, pathToFileURL(path.dirname(path.join(repo, relative)) + path.sep).href)).scene;
  loadedRoots.push(root);
  return root;
}
async function prepareBundle() {
  const stdin = {
    contents: [
      `export { prepareNativeSkinnedBody } from ${JSON.stringify(relativeSource)};`,
      `export { createTorsoClothingHideSet } from ${JSON.stringify(relativeHelper)};`,
    ].join('\n'),
    resolveDir: here,
    sourcefile: 'torso-clothing-mask-check-entry.ts',
    loader: 'ts',
  };
  await esbuild.build({
    stdin, outfile: bundled, bundle: true, format: 'esm', platform: 'node', target: 'node24',
    packages: 'external', write: true, logLevel: 'silent',
    plugins: [{
      name: 'file-url-assets',
      setup(build) {
        build.onResolve({ filter: /\?url$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'file-url',
        }));
        build.onLoad({ filter: /.*/, namespace: 'file-url' }, (args) => ({
          contents: `export default ${JSON.stringify(pathToFileURL(args.path).href)};`, loader: 'js',
        }));
      },
    }],
  });
  return import(`${pathToFileURL(bundled).href}?t=${Date.now()}`);
}

try {
  for (const [relative, expected] of inputs) {
    const bytes = await readFile(path.join(repo, relative));
    const actual = sha(bytes);
    assert.equal(actual, expected, `input pin changed: ${relative}`);
    sourceHashes[relative] = actual;
  }
  for (const filename of checkSourcePaths) {
    const bytes = await readFile(filename);
    sourceHashes[path.relative(repo, filename)] = sha(bytes);
  }
  await MeshoptDecoder.ready;
  if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
  if (typeof globalThis.ProgressEvent === 'undefined') {
    globalThis.ProgressEvent = class extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } };
  }
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!raw.startsWith('file:')) return originalFetch(input, init);
    const bytes = await readFile(fileURLToPath(raw));
    sourceStats.files++;
    sourceStats.fetchedBytes += bytes.byteLength;
    return new Response(bytes, { status: 200, headers: { 'content-type': raw.endsWith('.json') ? 'application/json' : 'model/gltf-binary' } });
  };
  globalThis.createImageBitmap = async () => {
    sourceStats.imageDecodes++;
    return { width: 1, height: 1, close() {} };
  };
  THREE.TextureLoader.prototype.load = function (_url, onLoad, _progress, onError) {
    const texture = new THREE.Texture({ width: 1, height: 1, data: new Uint8Array(4) });
    texture.needsUpdate = true;
    queueMicrotask(() => { try { onLoad?.(texture); } catch (error) { onError?.(error); } });
    return texture;
  };

  const { prepareNativeSkinnedBody, createTorsoClothingHideSet } = await prepareBundle();
  const kit = createKit();
  kits.push(kit);
  const actor = await prepareNativeSkinnedBody({
    kit,
    seed: 'prepared-npc-v1',
    look: savedLook(),
    sceneScale: 1,
    retargetMode: 'directions',
  });
  actors.push(actor);
  actor.place(0.78, 0, 0, 0);
  actor.show('idle', false);
  actor.object.updateWorldMatrix(true, false);
  actor.object.updateMatrixWorld(true);

  const body = getSkinned(actor.object, 'Body');
  const garment = getSkinned(actor.object, 'Authored office suit');
  assert.equal(body.skeleton, garment.skeleton, 'factory garment uses this actor corrected skeleton');
  assert.equal(actor.preparedMetrics.retargetMode, 'directions', 'same prepared direction-retarget path as V29');
  assert.equal(actor.preparedMetrics.bodyKey, 'female');
  assert.equal(actor.pose, 'idle');
  assert.deepEqual(actor.object.position.toArray(), [0.78, 0, 0], 'same prepared NPC translation');
  assert.ok(Math.abs(actor.object.rotation.y) < 1e-8, 'same prepared NPC yaw');

  // Recover the original source triangle index while retaining the exact active actor's
  // (family-corrected, morphed, skinned, masked) attribute and material/pose state.
  const rawSourceRoot = await parseGlb(inputs[0][0]);
  const rawBody = getSkinned(rawSourceRoot, 'Body');
  const rawIndex = rawBody.geometry.getIndex();
  assert.ok(rawIndex && rawIndex.count % 3 === 0, 'pinned source Body is indexed');
  sourceGeometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(body.geometry.attributes)) {
    const sourceAttribute = rawBody.geometry.getAttribute(name);
    assert.ok(sourceAttribute, `raw body source is missing ${name}`);
    assert.equal(attribute.count, sourceAttribute.count, `active actor ${name} vertex count matches pinned raw source`);
    assert.equal(attribute.itemSize, sourceAttribute.itemSize, `active actor ${name} layout matches pinned raw source`);
    sourceGeometry.setAttribute(name, attribute);
  }
  sourceGeometry.morphAttributes = Object.fromEntries(Object.entries(body.geometry.morphAttributes).map(([name, attributes]) => [name, [...attributes]]));
  sourceGeometry.morphTargetsRelative = body.geometry.morphTargetsRelative;
  sourceGeometry.setIndex(rawIndex.clone());
  const indexBytes = new Uint8Array(rawIndex.array.buffer, rawIndex.array.byteOffset, rawIndex.array.byteLength);
  const actualSourceIndexSha256 = sha(indexBytes);
  assert.equal(actualSourceIndexSha256, '4c29f318e20b87a2c0ddce3689fa0ab285ee390fc02e5f3a017736df772a3661',
    'original source Body triangle IDs match presentation hide-map provenance');
  assert.equal(actor.wardrobe.hiddenTriangles >= 0, true);

  const officeHide = JSON.parse(await readFile(path.join(repo, inputs[3][0]), 'utf8'));
  const shoesHide = JSON.parse(await readFile(path.join(repo, inputs[5][0]), 'utf8'));
  assert.equal(officeHide.bodySourceTriangleCount, rawIndex.count / 3);
  assert.equal(shoesHide.bodySourceTriangleCount, rawIndex.count / 3);
  const alreadyHidden = new Set([...officeHide.bodyHideSourceTriangleIds, ...shoesHide.sourceBodyTriangleIds]);
  const result = createTorsoClothingHideSet({
    asset: 'female-office-v29-active-direction-idle',
    body,
    garment,
    sourceGeometry,
    alreadyHiddenTriangleIds: alreadyHidden,
    maxPenetrationMetres: 0.04,
  });
  const activeTransform = {
    actorPosition: actor.object.position.toArray(),
    actorQuaternion: actor.object.quaternion.toArray(),
    actorScale: actor.object.scale.toArray(),
    bodyMatrixWorld: body.matrixWorld.toArray(),
    garmentMatrixWorld: garment.matrixWorld.toArray(),
    bodyMorphs: Object.fromEntries(Object.entries(body.morphTargetDictionary ?? {}).map(([name, index]) => [name, body.morphTargetInfluences?.[index] ?? 0])),
    garmentMorphs: Object.fromEntries(Object.entries(garment.morphTargetDictionary ?? {}).map(([name, index]) => [name, garment.morphTargetInfluences?.[index] ?? 0])),
    actualPose: actor.pose,
    actualFamily: actor.preparedMetrics.bodyKey,
    actualRetarget: actor.preparedMetrics.retargetMode,
    lastDirectionContactSolve: actor.lastDirectionContactSolve,
  };
  assert.ok(result.hideSet.triangleIds.every((id) => !alreadyHidden.has(id)), 'candidate IDs are not already hidden by office/shoe maps');
  assert.ok(result.hideSet.triangleIds.every((id) => Number.isInteger(id) && id >= 0 && id < rawIndex.count / 3));
  outcome = {
    status: 'pass',
    resultKind: 'geometry diagnostic only; no render/A-B acceptance',
    sourceHashes,
    pins: Object.fromEntries(inputs.map(([name, digest]) => [name, digest])),
    actor: {
      look: savedLook(), seed: 'prepared-npc-v1', family: 'female', retargetMode: 'directions', pose: 'idle',
      activeTransform, preparedMetrics: actor.preparedMetrics,
      bodyIndexSha256: actualSourceIndexSha256,
      sourceTriangles: rawIndex.count / 3,
      activeVisibleTriangles: body.geometry.getIndex().count / 3,
      baseHiddenTriangles: alreadyHidden.size,
    },
    candidate: result,
    sourceStats,
    interpretation: result.metrics.clothBehindSkinTriangles > 0
      ? 'These source triangle IDs are torso-weighted skin faces with office cloth behind them in the actual direction-retargeted female office idle actor. They are candidates for a masked A/B, not proof that every ray corresponds to the visible tan patch.'
      : 'No qualifying cloth-behind-skin triangles were found at this exact active actor state; do not apply a torso mask from this result.',
    limitations: [
      'No GPU pixels were rendered in this CPU check.',
      'A geometric ray hit is not sufficient to identify the exact pixels in the reported tan patch.',
      'Only source triangle IDs are proposed; the production hide map and renderer are unchanged.',
    ],
  };
} catch (error) {
  outcome = { ...outcome, status: 'fail', error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error), sourceHashes, sourceStats };
} finally {
  try { sourceGeometry?.dispose(); } catch {}
  for (const actor of actors.reverse()) try { actor.dispose(); } catch {}
  for (const kit of kits.reverse()) try { kit.dispose(); } catch {}
  for (const root of loadedRoots) root.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
  if (originalFetch) globalThis.fetch = originalFetch;
  if (originalBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalBitmap;
  if (originalProgressEvent === undefined) delete globalThis.ProgressEvent; else globalThis.ProgressEvent = originalProgressEvent;
  if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
  THREE.TextureLoader.prototype.load = originalTextureLoad;
  await unlink(bundled).catch(() => {});
}
console.log(JSON.stringify(outcome, null, 2));
if (outcome.status !== 'pass') process.exitCode = 1;
