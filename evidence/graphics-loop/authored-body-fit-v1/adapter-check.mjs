import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachAuthoredHead } from './fit-authored-head.ts';

const started = performance.now();
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../..');
const inputs = {
  male: path.join(repo, 'src/scene/body/assets/base-body-male.glb'),
  female: path.join(repo, 'src/scene/body/assets/base-body-female.glb'),
  head: process.argv[2] ? path.resolve(process.argv[2]) : path.join(repo, 'evidence/graphics-loop/authored-head-spike-v1/downloaded-37934994451/authored-face-37934994451/generated/expressive-head-lod.glb'),
};
const expected = {
  male: 'b0078206da9f7de0bf346be8133522cf514009f03f262f716613dd196d180686',
  female: '977ca5e73ba7b19af2627dab1ba0f0ef3e3d8548bf7b4d54f45faf22cd56001c',
  head: 'ba62be0114e4656e2cf8ba636d3f85a5aadbdcc723dd7ebe96e77299917d1a81',
};
const outputPath = path.join(root, 'adapter-check-result.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function imageFreeGlb(input) {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2, 'expected GLB v2');
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) binary = chunk;
    offset += length + 8;
  }
  assert(json && binary, 'GLB chunks missing');
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encoded.length + 3) & ~3;
  const binaryLength = (binary.length + 3) & ~3;
  const out = new Uint8Array(28 + jsonLength + binaryLength);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, jsonLength, true);
  outView.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jsonLength);
  out.set(encoded, 20);
  outView.setUint32(20 + jsonLength, binaryLength, true);
  outView.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(binary, 28 + jsonLength);
  return out.buffer;
}

async function loadModel(bytes) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(imageFreeGlb(bytes), '/');
}

function checkBridge(bodyMesh, controller) {
  const bridge = bodyMesh.parent?.getObjectByName('authored-head-neck-bridge');
  assert(bridge?.isSkinnedMesh, 'adapter did not publish a skinned bridge beside the body');
  assert(bridge.skeleton === bodyMesh.skeleton, 'bridge does not share the actor skeleton');
  assert(bridge.material === bodyMesh.material, 'bridge does not use the actor skin shader');
  const geometry = bridge.geometry;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const indices = geometry.index;
  const jointIndices = geometry.getAttribute('skinIndex');
  const jointWeights = geometry.getAttribute('skinWeight');
  assert(position && uv?.itemSize === 2 && indices && jointIndices?.itemSize === 4 && jointWeights?.itemSize === 4, 'bridge geometry lacks required attributes');
  assert(indices.count === controller.metrics.neckBridgeTriangles * 3, 'bridge triangle metric disagrees with its actual index');
  for (let i = 0; i < position.count; i++) {
    assert(Number.isFinite(position.getX(i)) && Number.isFinite(position.getY(i)) && Number.isFinite(position.getZ(i)), 'bridge has nonfinite position');
    assert(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)), 'bridge has nonfinite UV');
    let sum = 0;
    for (let channel = 0; channel < 4; channel++) {
      const joint = jointIndices.getComponent(i, channel);
      const weight = jointWeights.getComponent(i, channel);
      assert(joint >= 0 && joint < bodyMesh.skeleton.bones.length, 'bridge joint index is outside the actor skeleton');
      assert(Number.isFinite(weight) && weight >= 0, 'bridge has invalid skin weight');
      sum += weight;
    }
    assert(Math.abs(sum - 1) < 1e-5, `bridge weights do not normalize at vertex ${i}: ${sum}`);
  }
  for (let i = 0; i < indices.count; i++) assert(indices.getX(i) < position.count, 'bridge index exceeds generated vertex range');
  assert(controller.metrics.neckBridgeBottomWeightMaxError < 1e-5, 'bridge bottom failed to preserve resampled source joint weights');
  return { vertices: position.count, triangles: indices.count / 3, geometryIndexType: indices.array.constructor.name };
}

await MeshoptDecoder.ready;
const bytesByKey = {};
const modelsByKey = {};
for (const key of ['male', 'female', 'head']) {
  const bytes = readFileSync(inputs[key]);
  const hash = sha(bytes);
  assert(hash === expected[key], `${key} source hash mismatch: ${hash}`);
  bytesByKey[key] = bytes;
  modelsByKey[key] = await loadModel(bytes);
}
const template = modelsByKey.head.scene;
const results = {};
for (const key of ['male', 'female']) {
  const cloned = cloneSkinnedHierarchy(modelsByKey[key].scene);
  const bodyMesh = [];
  cloned.traverse((node) => { if (node.isSkinnedMesh) bodyMesh.push(node); });
  assert(bodyMesh.length === 1, `${key} must contain exactly one skinned body`);
  bodyMesh[0].geometry = bodyMesh[0].geometry.clone();
  const object = new THREE.Group();
  object.add(cloned);
  const originalGeometry = bodyMesh[0].geometry;
  const originalIndex = originalGeometry.index;
  const controller = attachAuthoredHead({ object, key: key === 'male' ? 'male' : 'female' }, template);
  assert(bodyMesh[0].geometry === originalGeometry, `${key} body geometry identity changed`);
  assert(bodyMesh[0].geometry.index !== originalIndex, `${key} body face index was not replaced`);
  const bridge = checkBridge(bodyMesh[0], controller);
  const bridgeObject = bodyMesh[0].parent.getObjectByName('authored-head-neck-bridge');
  let bridgeGeometryDisposed = false;
  bridgeObject.geometry.addEventListener('dispose', () => { bridgeGeometryDisposed = true; });
  controller.setExpression('grin', 0.4);
  controller.setExpression('blink', 0.8);
  controller.setExpression('neutral', 1.2);
  controller.dispose();
  assert(object.getObjectByName('authored-head-neck-bridge') === undefined, `${key} bridge leaked after disposal`);
  assert(bridgeGeometryDisposed, `${key} bridge-owned geometry was not disposed`);
  assert(bodyMesh[0].geometry.index === originalIndex, `${key} original index was not restored`);
  assert(bodyMesh[0].geometry === originalGeometry, `${key} body geometry ownership changed during disposal`);
  results[key] = { pass: true, bridge, fit: controller.metrics, restoredGeometry: true };
  for (const mesh of bodyMesh) mesh.geometry.dispose();
}

const result = {
  status: 'pass',
  scope: 'bounded CPU adapter and neck-bridge ownership test; not rendered seam or animation acceptance',
  inputHashes: Object.fromEntries(Object.entries(bytesByKey).map(([key, bytes]) => [key, sha(bytes)])),
  results,
  elapsedMs: Number((performance.now() - started).toFixed(1)),
  heapUsedBytes: process.memoryUsage().heapUsed,
  rssBytes: process.memoryUsage().rss,
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
