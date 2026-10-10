import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareNativeStaticSurfaceQuery } from './native-static-surface.ts';
import type { NativeStaticSurfaceAccept } from './native-static-surface.ts';

type Point = readonly [number, number, number];

function queryAgainstRaycaster(
  host: THREE.Object3D, x: number, z: number, maximum: number, minimum: number,
  accepts: NativeStaticSurfaceAccept = () => true, excluded?: THREE.Object3D,
): number | null {
  host.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  host.traverseVisible((node) => {
    if (!(node instanceof THREE.Mesh) || (excluded && isWithin(node, excluded))) return;
    meshes.push(node);
  });
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(x, maximum, z), new THREE.Vector3(0, -1, 0), 0, maximum - minimum,
  );
  return raycaster.intersectObjects(meshes, false).find(accepts)?.point.y ?? null;
}

function isWithin(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) if (current === ancestor) return true;
  return false;
}

function prepare(host: THREE.Object3D, excluded?: THREE.Object3D) {
  return prepareNativeStaticSurfaceQuery(host, () => { throw new Error('static fixture unexpectedly used fallback'); }, excluded);
}

function triangle(points: readonly Point[], material: THREE.Material | THREE.Material[] = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  return new THREE.Mesh(geometry, material);
}

test('indexed query matches Raycaster on transformed, sloped static triangle', () => {
  const host = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(0.3, 0.4, -0.2);
  parent.rotation.set(0.08, 0.31, -0.04);
  parent.scale.set(1.1, 0.9, 0.8);
  host.add(parent);
  const mesh = triangle([[-1, 0, -1], [1, 0.4, -1], [0, 0.7, 1]]);
  mesh.position.set(0.1, 1, -0.15);
  parent.add(mesh);
  host.updateWorldMatrix(true, true);
  const target = mesh.localToWorld(new THREE.Vector3(0, 0, 0));
  const x = target.x, z = target.z, maximum = target.y + 3, minimum = target.y - 3;
  const indexed = prepare(host);
  const expected = queryAgainstRaycaster(host, x, z, maximum, minimum);
  assert.equal(indexed.mode, 'indexed');
  assert.ok(expected !== null);
  const actual = indexed(x, z, maximum, minimum, () => true);
  assert.ok(actual !== null);
  assert.ok(Math.abs(actual - expected) < 1e-6);
});

test('indexed side culling agrees with a downward Raycaster for all material sides', () => {
  const clockwise: readonly Point[] = [[-1, 1, -1], [0, 1, 1], [1, 1, -1]];
  const cases: readonly (readonly [THREE.Side, boolean])[] = [[THREE.FrontSide, true], [THREE.BackSide, false], [THREE.DoubleSide, true]];
  for (const [side, hit] of cases) {
    const host = new THREE.Group();
    host.add(triangle(clockwise, new THREE.MeshBasicMaterial({ side })));
    const indexed = prepare(host);
    const expected = queryAgainstRaycaster(host, 0, 0, 2, 0);
    const actual = indexed(0, 0, 2, 0, () => true);
    assert.equal(actual, expected);
    assert.equal(actual !== null, hit, `side=${side}`);
  }
});

test('indexed query honors indexed groups, drawRange, and visible material groups', () => {
  const host = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 1, -1, 0, 1, 1, 1, 1, -1,
    -1, 2, -1, 0, 2, 1, 1, 2, -1,
  ], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  geometry.setDrawRange(3, 3);
  const lower = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const upper = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, [lower, upper]);
  host.add(mesh);
  let indexed = prepare(host);
  const expected = queryAgainstRaycaster(host, 0, 0, 3, 0);
  assert.equal(expected, 2);
  assert.equal(indexed(0, 0, 3, 0, () => true), expected);
  upper.visible = false;
  indexed = prepare(host);
  assert.equal(indexed(0, 0, 3, 0, () => true), null, 'material visibility invalidates and omits the hidden group');
  geometry.setDrawRange(0, 3);
  indexed = prepare(host);
  assert.equal(indexed(0, 0, 3, 0, () => true), 1);
});

test('acceptance filter selects the first supported object and cache invalidates on transforms', () => {
  const host = new THREE.Group();
  const lower = triangle([[-1, 1, -1], [0, 1, 1], [1, 1, -1]]);
  const upper = triangle([[-1, 2, -1], [0, 2, 1], [1, 2, -1]]);
  host.add(lower, upper);
  let indexed = prepare(host);
  const accepts: NativeStaticSurfaceAccept = (hit) => hit.object !== upper;
  assert.equal(indexed(0, 0, 3, 0, accepts), queryAgainstRaycaster(host, 0, 0, 3, 0, accepts));
  upper.position.y = -1.5;
  indexed = prepare(host);
  assert.equal(indexed(0, 0, 3, 0, () => true), 1);
});

test('dynamic instanced meshes use the provided exact Raycaster fallback', () => {
  const host = new THREE.Group();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  host.add(mesh);
  const indexed = prepareNativeStaticSurfaceQuery(host, (x, z, maximum, minimum, accepts) =>
    queryAgainstRaycaster(host, x, z, maximum, minimum, accepts));
  assert.equal(indexed.mode, 'raycaster');
  assert.equal(indexed(0, 0, 2, -2, () => true), 0.5);
});


test('mirrored mesh side culling preserves the local-space Raycaster contract', () => {
  const host = new THREE.Group();
  const mesh = triangle([[-1, 1, -1], [0, 1, 1], [1, 1, -1]], new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  mesh.scale.x = -1;
  host.add(mesh);
  const indexed = prepare(host);
  assert.equal(indexed(0, 0, 2, 0, () => true), queryAgainstRaycaster(host, 0, 0, 2, 0));
});

test('interleaved position updates invalidate the exact transformed triangle index', () => {
  const host = new THREE.Group();
  const data = new THREE.InterleavedBuffer(new Float32Array([-1, 1, -1, 0, 1, 1, 1, 1, -1]), 3);
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.InterleavedBufferAttribute(data, 3, 0);
  geometry.setAttribute('position', position);
  host.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
  let indexed = prepare(host);
  assert.equal(indexed(0, 0, 3, 0, () => true), 1);
  for (let vertex = 0; vertex < 3; vertex++) position.setY(vertex, 2);
  position.needsUpdate = true;
  indexed = prepare(host);
  assert.equal(indexed(0, 0, 3, 0, () => true), queryAgainstRaycaster(host, 0, 0, 3, 0));
  assert.equal(indexed(0, 0, 3, 0, () => true), 2);
});
