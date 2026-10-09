import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';
import { reclassifyExposedNeckRing } from './neck-skin-semantics.ts';

function mesh(index: number[], displayed = false, normalizedUint8Color = false): THREE.SkinnedMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 0.02, 0.01, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1, 0,0,1], 3));
  const colors = normalizedUint8Color
    ? new THREE.BufferAttribute(new Uint8Array([255,0,0,0, 127,128,0,0, 80,175,0,0, 0,255,0,0]), 4, true)
    : new THREE.Float32BufferAttribute([1,0,0,0, .25,.75,0,0, 0,1,0,0, 0,1,0,0], 4);
  geometry.setAttribute('color', colors);
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    1, 1, 1, 1,
    2, 2, 2, 2,
    2, 2, 2, 2,
    3, 3, 3, 3,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
  ], 4));
  geometry.setIndex(index);
  if (displayed) geometry.setDrawRange(0, index.length);
  const root = new THREE.Bone(), neck = new THREE.Bone(), spine = new THREE.Bone(), clavicle = new THREE.Bone();
  root.name = 'root'; neck.name = 'neck_01'; spine.name = 'spine_03'; clavicle.name = 'clavicle_l';
  root.add(neck, spine, clavicle);
  const result = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  result.add(root); result.bind(new THREE.Skeleton([root, neck, spine, clavicle]));
  return result;
}

const sha256 = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function complement() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, .01,0,0, 0,.01,0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([1,0,0,0, 0,1,0,0, 0,1,0,0], 4));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0,0,0,0, 2,2,2,2, 2,2,2,2], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0], 4));
  geometry.setIndex([0,1,2]);
  return {
    geometry,
    sourceFaceIds: [0],
    sourceBindings: [
      { vertices: [0,1,2] as const, barycentric: [1,0,0] as const },
      { vertices: [0,1,2] as const, barycentric: [0,1,0] as const },
      { vertices: [0,1,2] as const, barycentric: [0,0,1] as const },
    ],
  };
}

test('only visible spine_03 vertices in the neck_01 source ring move top tint to skin', async () => {
  const source = mesh([0, 1, 2, 1, 3, 2]);
  const displayed = mesh([0, 1, 2], true);
  const beforeAttribute = displayed.geometry.getAttribute('color').array as ArrayBufferView;
  const before = new Uint8Array(beforeAttribute.buffer, beforeAttribute.byteOffset, beforeAttribute.byteLength).slice();
  const restPoints = [0, 1, 2, 3].map(index => new THREE.Vector3(index * 0.01, index * 0.01, 0));
  const addedNeck = complement();
  const report = await reclassifyExposedNeckRing(displayed, source, restPoints, sha256, addedNeck);
  assert.deepEqual(report.changedVertexIds, [1, 2]);
  assert.equal(report.changedVertices, 2);
  assert.equal(report.exposedNeckSeedVertices, 1);
  assert.equal(report.attributeLayoutUnchanged, true);
  assert.equal(report.unrelatedColorBytesUnchanged, true);
  assert.equal(report.complementColorChangedVertices, 2);
  assert.ok(report.complementColorMaxBarycentricError! <= 2e-6);
  const color = displayed.geometry.getAttribute('color');
  assert.deepEqual([color.getX(1), color.getY(1), color.getZ(1), color.getW(1)], [1, 0, 0, 0]);
  assert.deepEqual([color.getX(2), color.getY(2), color.getZ(2), color.getW(2)], [1, 0, 0, 0]);
  assert.deepEqual([color.getX(0), color.getY(0), color.getZ(0), color.getW(0)], [1, 0, 0, 0]);
  assert.ok(report.colorBytesBeforeSha256 !== report.colorBytesAfterSha256);
  assert.equal(before.byteLength, (color.array as ArrayBufferView).byteLength);
  const addedColors = addedNeck.geometry.getAttribute('color');
  assert.deepEqual([addedColors.getX(1), addedColors.getY(1)], [1, 0]);
  assert.deepEqual([addedColors.getX(2), addedColors.getY(2)], [1, 0]);
  source.geometry.dispose(); displayed.geometry.dispose(); addedNeck.geometry.dispose();
  (source.material as THREE.Material).dispose(); (displayed.material as THREE.Material).dispose();
});

test('normalized Uint8 COLOR_0 retains layout and transfers a mixed skin/top ring', async () => {
  const source = mesh([0, 1, 2, 1, 3, 2], false, true);
  const displayed = mesh([0, 1, 2], true, true);
  const restPoints = [0, 1, 2, 3].map(index => new THREE.Vector3(index * 0.01, index * 0.01, 0));
  const color = displayed.geometry.getAttribute('color');
  const beforeLayout = { type: color.array.constructor, bytes: color.array.byteLength, normalized: color.normalized, itemSize: color.itemSize };
  const report = await reclassifyExposedNeckRing(displayed, source, restPoints, sha256);
  assert.deepEqual({ type: color.array.constructor, bytes: color.array.byteLength, normalized: color.normalized, itemSize: color.itemSize }, beforeLayout);
  assert.ok(report.changedColorByteCount > 0);
  assert.ok(report.changedColorByteCount <= report.changedVertices * 2);
  for (const vertex of report.changedVertexIds) {
    assert.equal(color.getX(vertex), 1);
    assert.equal(color.getY(vertex), 0);
  }
  source.geometry.dispose(); displayed.geometry.dispose();
  (source.material as THREE.Material).dispose(); (displayed.material as THREE.Material).dispose();
});

test('the one-ring classifier does not recolor a hidden source vertex or a clavicle face', async () => {
  const source = mesh([0, 1, 2, 1, 3, 2]);
  const displayed = mesh([0, 1, 2], true);
  displayed.geometry.setDrawRange(0, 0);
  const restPoints = [0, 1, 2, 3].map(index => new THREE.Vector3(index * 0.01, index * 0.01, 0));
  await assert.rejects(reclassifyExposedNeckRing(displayed, source, restPoints, sha256), /No visible top-colored/);
  source.geometry.dispose(); displayed.geometry.dispose();
  (source.material as THREE.Material).dispose(); (displayed.material as THREE.Material).dispose();
});
