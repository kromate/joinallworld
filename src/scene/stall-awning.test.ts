import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBatch } from './build.ts';
import { footprintRecorder } from './movement.ts';
import { WOOD, WOOD_DARK, stall } from './props.ts';
import type { Batch } from './types.ts';

const AWNING = ['#d33011', '#17c43b', '#284ef0', '#f0b317', '#a32cbe', '#13b9c1'];

/** Exact pre-change stall authoring, retained here only as an A/B geometry and footprint control. */
function oldBoxAwningStall(b: Batch, x: number, z: number, ry: number): void {
  const w = 3.6;
  b.at(x, 0, z, ry, () => {
    for (const side of [-1, 1]) {
      b.box(side * (w / 2 - 0.08), 1.5, 0.75, 0.12, 3, 0.12, WOOD_DARK);
      b.box(side * (w / 2 - 0.08), 1.75, -0.75, 0.12, 3.5, 0.12, WOOD_DARK);
    }
    for (let i = 0; i < 6; i++) b.box(-w / 2 + (i + 0.5) * (w / 6), 3.32, 0.1, w / 6, 0.1, 2.3, AWNING[i]!, { rx: 0.2 });
    b.box(0, 0.95, 0.2, w - 0.3, 0.12, 1.3, WOOD);
    b.box(0, 0.45, 0.2, w - 0.5, 0.9, 1.1, WOOD_DARK);
    const goods = ['#d9482f', '#e8a13a', '#5f9a48'];
    for (let i = 0; i < goods.length; i++) {
      const gx = -w / 2 + 0.3 + (i + 0.5) * ((w - 0.6) / goods.length);
      b.box(gx, 1.08, 0.2, (w - 0.9) / goods.length, 0.16, 1.05, '#c9a56a');
      b.ico(gx, 1.3, 0.2, (w - 1.3) / goods.length / 2, 0.26, 0.42, goods[i]!);
    }
  });
}

function assertShapesNear(actual: ReturnType<ReturnType<typeof footprintRecorder>['shapes']>, expected: typeof actual): void {
  const close = (a: unknown, e: unknown, path: string): void => {
    if (typeof a === 'number' && typeof e === 'number') {
      assert.ok(Math.abs(a - e) < 1e-7, `${path}: ${a} differs from ${e}`);
    } else if (Array.isArray(a) && Array.isArray(e)) {
      assert.equal(a.length, e.length, `${path} length`);
      a.forEach((value, index) => close(value, e[index], `${path}[${index}]`));
    } else if (a && e && typeof a === 'object' && typeof e === 'object') {
      const ak = Object.keys(a), ek = Object.keys(e);
      assert.deepEqual(ak, ek, `${path} keys`);
      for (const key of ak) close((a as Record<string, unknown>)[key], (e as Record<string, unknown>)[key], `${path}.${key}`);
    } else assert.deepEqual(a, e, path);
  };
  close(actual, expected, 'footprint shapes');
}

function built(recorder: ReturnType<typeof footprintRecorder>) {
  const material = new THREE.MeshBasicMaterial();
  const result = recorder.batch.build({ solid: material, glow: material, glass: material });
  return { ...result, material };
}

test('thin market awning panels preserve the old transformed footprint and batch while saving 48 triangles', () => {
  const before = footprintRecorder(createBatch(THREE)), after = footprintRecorder(createBatch(THREE));
  const place = (b: Batch, draw: (target: Batch) => void) => b.at(2.4, 0.6, -3.1, 0.43, () => {
    b.at(-0.7, 0.15, 1.2, -0.31, () => draw(b), 0.12, -0.08, 1.15);
  }, -0.09, 0.16, 0.9);
  place(before.batch, b => oldBoxAwningStall(b, -1.1, 0.8, Math.PI / 5));
  place(after.batch, b => stall(b, -1.1, 0.8, { ry: Math.PI / 5, awning: AWNING }));

  assertShapesNear(after.shapes(), before.shapes());
  assert.equal(before.batch.triangles - after.batch.triangles, 48);
  const oldBuilt = built(before), newBuilt = built(after);
  assert.deepEqual(newBuilt.meshes.map(mesh => [mesh.name, mesh.userData.part]), oldBuilt.meshes.map(mesh => [mesh.name, mesh.userData.part]));
  assert.equal(newBuilt.meshes.length, oldBuilt.meshes.length, 'same batched mesh/draw count');
  const vertexCount = (meshes: THREE.Mesh[]) => meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0);
  const geometryBytes = (meshes: THREE.Mesh[]) => meshes.reduce((sum, mesh) => {
    const geometry = mesh.geometry;
    const attributes = ['position', 'normal', 'color'].reduce((bytes, name) => bytes + (geometry.getAttribute(name) as THREE.BufferAttribute).array.byteLength, 0);
    return sum + attributes + (mesh.geometry.index?.array.byteLength ?? 0);
  }, 0);
  assert.equal(vertexCount(oldBuilt.meshes) - vertexCount(newBuilt.meshes), 96);
  assert.equal(geometryBytes(oldBuilt.meshes) - geometryBytes(newBuilt.meshes), 3744);
  for (const mesh of [...oldBuilt.meshes, ...newBuilt.meshes]) mesh.geometry.dispose();
  oldBuilt.material.dispose(); newBuilt.material.dispose();
});

test('each colored awning stripe has two oppositely wound faces, a 12 mm gap, and meets its neighbors', () => {
  const batch = createBatch(THREE);
  stall(batch, 0, 0, { awning: AWNING });
  const material = new THREE.MeshBasicMaterial();
  const meshes = batch.build({ solid: material, glow: material, glass: material }).meshes;
  assert.equal(meshes.length, 1);
  const geometry = meshes[0]!.geometry;
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), color = geometry.getAttribute('color');
  const stripes = AWNING.map(hex => {
    const target = new THREE.Color(hex);
    const ids: number[] = [];
    for (let i = 0; i < color.count; i++) if (Math.abs(color.getX(i) - target.r) < 1e-6 && Math.abs(color.getY(i) - target.g) < 1e-6 && Math.abs(color.getZ(i) - target.b) < 1e-6) ids.push(i);
    assert.equal(ids.length, 8, `${hex}: four top and four underside vertices`);
    const dot = normal.getX(ids[0]!) * normal.getX(ids[4]!) + normal.getY(ids[0]!) * normal.getY(ids[4]!) + normal.getZ(ids[0]!) * normal.getZ(ids[4]!);
    assert.ok(dot < -0.999, `${hex}: underside normal opposes the top normal`);
    const separation = Math.hypot(position.getX(ids[0]!) - position.getX(ids[7]!), position.getY(ids[0]!) - position.getY(ids[7]!), position.getZ(ids[0]!) - position.getZ(ids[7]!));
    assert.ok(Math.abs(separation - 0.012) < 1e-6, `${hex}: thin fabric separation is 12 mm`);
    const xs = ids.map(id => position.getX(id));
    return [Math.min(...xs), Math.max(...xs)] as const;
  });
  for (let i = 1; i < stripes.length; i++) assert.ok(Math.abs(stripes[i - 1]![1] - stripes[i]![0]) < 1e-6, `stripes ${i - 1}/${i} meet without a gap`);
  assert.ok(Math.abs(stripes[0]![0] + 1.8) < 1e-6 && Math.abs(stripes.at(-1)![1] - 1.8) < 1e-6);
  for (const mesh of meshes) mesh.geometry.dispose();
  material.dispose();
});
