import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { applyBodyMaskUnion } from './body-mask-union.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const bodyPath = path.join(here, 'parametric-base-facial.glb');
const clothingMapPath = path.join(here, 'authored-clothing/out/body-hide-map.json');
const shoeMapPath = path.join(here, 'authored-footwear/out/shoes01-body-hide-map.json');
const pins = {
  body: '9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd',
  bodyIndex: '4c29f318e20b87a2c0ddce3689fa0ab285ee390fc02e5f3a017736df772a3661',
  clothingMap: 'dbe0c82a3e31da4e6ce37f4f1d9dc8611143c7c9e6dbef72ffea8d281aebe099',
  shoeMap: 'ba75d7ab36418434c40ad7c8c41d3723740782714e45890c3183d582b507ad71',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const asset = (file, expected) => {
  const bytes = readFileSync(file);
  assert.equal(hash(bytes), expected, `${path.basename(file)} source pin`);
  return bytes;
};

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
  output.set(binary, 28 + jsonLength);
  return output.buffer;
}

function geometrySnapshot(geometry) {
  const rows = [];
  const add = (label, attribute) => rows.push([label, hash(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength))]);
  for (const [name, attribute] of Object.entries(geometry.attributes)) add(`attribute:${name}`, attribute);
  for (const [name, attributes] of Object.entries(geometry.morphAttributes)) attributes.forEach((attribute, index) => add(`morph:${name}:${index}`, attribute));
  const index = geometry.getIndex(); if (index) add('index', index);
  return rows;
}

const bodyBytes = asset(bodyPath, pins.body);
const clothingMapBytes = asset(clothingMapPath, pins.clothingMap);
const shoeMapBytes = asset(shoeMapPath, pins.shoeMap);
const clothingMap = JSON.parse(clothingMapBytes.toString('utf8'));
const shoeMap = JSON.parse(shoeMapBytes.toString('utf8'));
assert.equal(clothingMap.bodySourceTriangleCount, 26756);
assert.equal(shoeMap.bodySourceTriangleCount, 26756);
const hideSets = [
  { asset: clothingMap.asset, bodySourceTriangleCount: clothingMap.bodySourceTriangleCount, triangleIds: clothingMap.bodyHideSourceTriangleIds },
  { asset: shoeMap.asset, bodySourceTriangleCount: shoeMap.bodySourceTriangleCount, triangleIds: shoeMap.sourceBodyTriangleIds },
];

await MeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const bodyGltf = await loader.parseAsync(imageFreeGlb(bodyBytes), '/');
let sourceBody;
bodyGltf.scene.traverse((node) => { if (node.name === 'Body' && node.isSkinnedMesh) sourceBody = node; });
assert(sourceBody, 'pinned GLB contains the authored Body SkinnedMesh');
const source = sourceBody.geometry, sourceIndex = source.getIndex();
assert(sourceIndex, 'Body source index is present');
assert.equal(sourceIndex.count / 3, 26756, 'real Body triangle layout');
assert.equal(hash(new Uint8Array(sourceIndex.array.buffer, sourceIndex.array.byteOffset, sourceIndex.array.byteLength)), pins.bodyIndex,
  'real Body index matches the map coordinate system');
assert.equal(source.groups.length, 0, 'source has no material groups');

const before = geometrySnapshot(source);
const sourceIndexArray = sourceIndex.array;
const bodyA = sourceBody;
const bodyB = sourceBody.clone();
bodyB.geometry = source;
const options = { expectedSourceIndexSha256: pins.bodyIndex, expectedSourceTriangleCount: 26756, hideSets };
let wrapperDisposals = 0;
let leaseA, leaseB;
try {
  [leaseA, leaseB] = await Promise.all([applyBodyMaskUnion(bodyA, options), applyBodyMaskUnion(bodyB, options)]);
  const wrapper = leaseA.geometry;
  wrapper.addEventListener('dispose', () => wrapperDisposals++);
  assert.equal(leaseA.geometry, leaseB.geometry, 'same source geometry and hide union share cached index wrapper');
  assert.equal(bodyA.geometry, wrapper); assert.equal(bodyB.geometry, wrapper);
  assert.equal(leaseA.metrics.sourceTriangles, 26756);
  assert.equal(leaseA.metrics.hiddenTriangles, 11256, 'suit+shoes hide union count');
  assert.equal(leaseA.metrics.visibleTriangles, 15500);
  assert.equal(leaseA.metrics.maskIndexBytes, wrapper.getIndex().array.byteLength);
  assert.equal(leaseA.metrics.assets.join(','), 'male_casualsuit01,shoes01');
  assert.deepEqual(geometrySnapshot(source), before, 'all original source attributes, morphs, and index bytes remain unchanged');
  assert.equal(source.getIndex().array, sourceIndexArray, 'source retains its original index array');
  assert.deepEqual(geometrySnapshot(wrapper).filter(([name]) => name !== 'index'), before.filter(([name]) => name !== 'index'),
    'wrapper reuses all source vertex and morph attribute bytes');

  const hidden = new Set([...clothingMap.bodyHideSourceTriangleIds, ...shoeMap.sourceBodyTriangleIds]);
  assert.equal(hidden.size, 11256, 'fixture maps have a true disjoint union');
  const expected = [];
  for (let triangle = 0; triangle < 26756; triangle++) {
    if (hidden.has(triangle)) continue;
    expected.push(sourceIndex.getX(triangle * 3), sourceIndex.getX(triangle * 3 + 1), sourceIndex.getX(triangle * 3 + 2));
  }
  assert.deepEqual(Array.from(wrapper.getIndex().array), expected, 'wrapper preserves every retained original triangle in order');
  await assert.rejects(applyBodyMaskUnion(bodyA, options), /active mask owner/, 'one Body cannot have duplicate active owners');

  leaseA.dispose(); leaseA.dispose();
  assert.equal(bodyA.geometry, source, 'first lease restores its Body');
  assert.equal(bodyB.geometry, wrapper, 'shared wrapper remains assigned to second Body');
  assert.equal(wrapperDisposals, 0, 'reference count keeps wrapper alive for second actor');
  leaseB.dispose(); leaseB.dispose();
  assert.equal(bodyB.geometry, source, 'last lease restores its Body');
  assert.equal(wrapperDisposals, 1, 'last lease disposes the private wrapper exactly once');

  const wrongHashBody = sourceBody.clone(); wrongHashBody.geometry = source;
  await assert.rejects(applyBodyMaskUnion(wrongHashBody, { ...options, expectedSourceIndexSha256: '0'.repeat(64) }), /SHA-256 mismatch/);
  assert.equal(wrongHashBody.geometry, source, 'hash mismatch leaves Body unchanged');
  const wrongLength = sourceBody.clone(); wrongLength.geometry = source;
  await assert.rejects(applyBodyMaskUnion(wrongLength, { ...options, expectedSourceTriangleCount: 26755 }), /index length/);
  const malformedMap = sourceBody.clone(); malformedMap.geometry = source;
  await assert.rejects(applyBodyMaskUnion(malformedMap, { ...options, hideSets: [
    { asset: 'duplicate-triangle', bodySourceTriangleCount: 26756, triangleIds: [12, 12] },
  ] }), /duplicate source triangle/);
  const duplicateOwner = sourceBody.clone(); duplicateOwner.geometry = source;
  await assert.rejects(applyBodyMaskUnion(duplicateOwner, { ...options, hideSets: [hideSets[0], hideSets[0]] }), /duplicate hide-set ownership/);
  assert.equal(wrongLength.geometry, source); assert.equal(malformedMap.geometry, source); assert.equal(duplicateOwner.geometry, source);

  console.log(JSON.stringify({ status: 'pass', pins, sourceTriangles: 26756,
    suitHidden: clothingMap.bodyHideSourceTriangleIds.length, shoesHidden: shoeMap.sourceBodyTriangleIds.length,
    overlapTriangles: clothingMap.bodyHideSourceTriangleIds.filter((id) => shoeMap.sourceBodyTriangleIds.includes(id)).length,
    unionHidden: 11256, visible: 15500, wrapperDisposals,
    checks: { actualBodyGlbAndMapsPinned: true, exactUnionIndex: true, sourceAttributesMorphsAndIndexUnchanged: true,
      sharedGeometryRefcountAndRestore: true, duplicateBodyOwnershipRejected: true, mismatchAndMalformedMapsRejected: true } }, null, 2));
} finally {
  leaseA?.dispose(); leaseB?.dispose();
  bodyGltf.scene.traverse((node) => { if (node.isMesh) { node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose(); } });
}
