import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBatch, withBatchPart } from './build.ts';
import { footprintRecorder } from './movement.ts';
import { extra } from './props.ts';
import { drawAvatar } from './characters.ts';
import { authoredExtraHandler, captureAuthoredExtras, captureExtraPerson, resolveAuthoredPlacement, transformAuthoredPoint, type WorldPointMapper } from './authored-people.ts';

function nestedParent(): WorldPointMapper {
  // Parent A: translate (4,2,-1), yaw 90°, scale 2. Parent B: translate (1,0,3), yaw 90°, scale .5.
  // Their composed frame is deliberately queried through the same world-point contract as Batch.world().
  const map = (x: number, y: number, z: number) => {
    const bx = x * 0.5, by = y * 0.5, bz = z * 0.5;
    const b = { x: 1 + bz, y: by, z: 3 - bx };
    return { x: 4 + 2 * b.z, y: 2 + 2 * b.y, z: -1 - 2 * b.x };
  };
  return { world: map };
}

test('captured authored person retains nested parent translation, rotation, and scale', () => {
  const parent = nestedParent();
  const person = captureExtraPerson(parent, {
    key: 'market:stall-3:seller', seed: 'seller-17', x: 2, z: -1, ry: Math.PI / 2, pose: 'sit',
    more: { y: 0.35, seat: 0.48, scale: 0.8, look: { body: 'woman', outfit: 'casual', hair: 'afro' } },
  });
  assert.deepEqual(person.parent.origin, [10, 2, -3]);
  assert.deepEqual(person.parent.xAxis, [-1, 0, 0]);
  assert.deepEqual(person.parent.yAxis, [0, 1, 0]);
  assert.deepEqual(person.parent.zAxis, [0, 0, -1]);
  assert.deepEqual(transformAuthoredPoint(person.parent, [person.local.x, person.local.y, person.local.z]), [8, 2.35, -2]);
  const resolved = resolveAuthoredPlacement(person);
  assert.deepEqual(resolved.position, [8, 2.35, -2]);
  assert.ok(Math.abs(resolved.xAxis[2] - 0.8) < 1e-12, 'local yaw composes with nested parent yaw and scale');
  assert.ok(Math.abs(resolved.yAxis[1] - 0.8) < 1e-12, 'local scale composes with parent scale');
  assert.ok(Math.abs(resolved.zAxis[0] + 0.8) < 1e-12);
  assert.equal(resolved.seat, 0.48, 'seat stays available for the pose-specific canonical offset');
  assert.equal(person.baseHeight, 0.35);
  assert.equal(person.appearance.pose, 'sit');
  assert.equal(person.appearance.seat, 0.48);
  assert.equal(person.appearance.scale, 0.8);
  assert.equal(person.look && (person.look as { hair: string }).hair, 'afro');
});

test('more overrides positional draw defaults while preserving authored key and seed semantics', () => {
  const parent = { world: (x: number, y: number, z: number) => ({ x, y, z }) };
  const person = captureExtraPerson(parent, {
    key: '  park:guide-1  ', seed: 'source-seed', x: 4, z: 6, ry: 0.25, pose: 'stand',
    more: { x: -2, z: 3, ry: -0.5, pose: 'wave', seat: 0.6, seed: 'override-seed', look: { body: 'man' } },
  });
  assert.equal(person.key, 'park:guide-1');
  assert.equal(person.id, 'authored:park:guide-1');
  assert.equal(person.seed, 'override-seed');
  assert.deepEqual(person.local, { x: -2, y: 0, z: 3, ry: -0.5, scale: 1 });
  assert.equal(person.appearance.pose, 'wave');
  assert.equal(captureExtraPerson(parent, { key: 'park:guide-1', seed: 'different', x: 99, z: 99 }).id, person.id,
    'identity is stable from the authored key rather than seed or position');
  assert.notEqual(captureExtraPerson(parent, { key: 'park:guide-2', seed: 'different', x: 99, z: 99 }).id, person.id);
});

test('actual Batch tilt and nested transforms are retained after its transform stack unwinds', () => {
  const batch = createBatch(THREE);
  let captured: ReturnType<typeof captureExtraPerson> | undefined;
  let expected: { x: number; y: number; z: number } | undefined;
  batch.at(4, 2, -1, 0.7, () => {
    batch.at(-2, 0.4, 3, -0.3, () => {
      expected = batch.world(1.2, 0.35, -0.8);
      captured = captureExtraPerson(batch, { key: 'tilted-deck:seller', seed: 'seller', x: 1.2, z: -0.8,
        more: { y: 0.35, seat: 0.4 } });
    }, 0.2, -0.15, 0.5);
  }, -0.1, 0.25, 2);
  assert.ok(captured && expected);
  assert.deepEqual(batch.world(0, 0, 0), { x: 0, y: 0, z: 0 }, 'the live batch is back at its root transform');
  const actual = resolveAuthoredPlacement(captured).position;
  [expected.x, expected.y, expected.z].forEach((coordinate, axis) => {
    assert.ok(Math.abs(actual[axis]! - coordinate) < 1e-10, 'snapshot retains the real transformed placement');
  });
  assert.equal(captured.appearance.seat, 0.4);
});

test('capture rejects missing keys and non-finite transform inputs', () => {
  const parent = { world: (x: number, y: number, z: number) => ({ x, y, z }) };
  assert.throws(() => captureExtraPerson(parent, { key: '   ', seed: 'x', x: 0, z: 0 }), /stable key/);
  assert.throws(() => captureExtraPerson(parent, { key: 'bad', seed: 'x', x: Infinity, z: 0 }), /must be finite/);
  assert.throws(() => captureExtraPerson({ world: () => ({ x: NaN, y: 0, z: 0 }) }, { key: 'bad-frame', seed: 'x', x: 0, z: 0 }), /parent transform/);
});

test('props.extra without capture remains byte-for-byte the original drawAvatar call', () => {
  const direct = createBatch(THREE), throughExtra = createBatch(THREE);
  const args = { seed: 'source-3', x: 1.25, z: -0.75, ry: 0.4, pose: 'wave' as const,
    more: { x: -0.2, y: 0.3, z: 0.5, scale: 0.92, look: { body: 'woman', hair: 'afro' } } };
  const expected = drawAvatar(direct, args.more.look, Object.assign({ seed: args.seed, x: args.x, z: args.z, ry: args.ry, pose: args.pose }, args.more));
  const actual = extra(throughExtra, args.seed, args.x, args.z, args.ry, args.pose, args.more);
  assert.deepEqual(actual, expected);
  assert.equal(throughExtra.triangles, direct.triangles);
  const material = new THREE.MeshBasicMaterial();
  const meshesA = direct.build({ solid: material, glow: material, glass: material }).meshes;
  const meshesB = throughExtra.build({ solid: material, glow: material, glass: material }).meshes;
  const arrays = (meshes: THREE.Mesh[]) => meshes.map(mesh => [mesh.name,
    ...Array.from(mesh.geometry.getAttribute('position').array),
    ...Array.from(mesh.geometry.getAttribute('normal').array),
    ...Array.from(mesh.geometry.getAttribute('color').array),
    ...Array.from(mesh.geometry.index!.array)]);
  assert.deepEqual(arrays(meshesB), arrays(meshesA));
  for (const mesh of [...meshesA, ...meshesB]) mesh.geometry.dispose();
  material.dispose();
});

test('authored-extra capture delegates original calls and restores nested scopes after return or throw', () => {
  const batch = createBatch(THREE);
  const seen: unknown[] = [];
  const outerHandler = (call: Parameters<import('./authored-people.ts').AuthoredExtraHandler>[0], drawOriginal: () => import('./characters.ts').DrawnAvatar) => {
    seen.push(call); return drawOriginal();
  };
  captureAuthoredExtras(batch, outerHandler, () => {
    assert.equal(authoredExtraHandler(batch), outerHandler);
    extra(batch, 'seed-A', 2, 3, 0.25, 'sit', { y: 0.2, seat: 0.44 });
    const innerHandler: import('./authored-people.ts').AuthoredExtraHandler = (_call, drawOriginal) => drawOriginal();
    captureAuthoredExtras(batch, innerHandler, () => {
      assert.equal(authoredExtraHandler(batch), innerHandler);
      extra(batch, 'seed-B', 4, 5);
    });
    assert.equal(authoredExtraHandler(batch), outerHandler);
    assert.throws(() => captureAuthoredExtras(batch, innerHandler, () => { throw new Error('expected'); }), /expected/);
    assert.equal(authoredExtraHandler(batch), outerHandler);
  });
  assert.equal(authoredExtraHandler(batch), undefined);
  assert.throws(() => captureAuthoredExtras(batch, outerHandler, () => { throw new Error('outer expected'); }), /outer expected/);
  assert.equal(authoredExtraHandler(batch), undefined, 'a throwing outer scope leaves no stale hook');
  assert.equal(seen.length, 1, 'nested handler owns only its scope');
  assert.deepEqual(seen[0], { seed: 'seed-A', x: 2, z: 3, ry: 0.25, pose: 'sit', more: { y: 0.2, seat: 0.44 } });
  assert.equal(batch.triangles > 0, true, 'delegated calls drew into the original batch');
});

test('scoped part changes geometry storage only; footprint records and transformed geometry stay identical', () => {
  const drawRoomDetails = (b: ReturnType<typeof footprintRecorder>['batch']) => {
    b.walls?.({ w: 10, d: 8 });
    b.box(-4.7, 1.5, -3.8, 0.6, 1.2, 0.6, '#aabbcc');
    b.at(1, 0.2, 2, Math.PI / 3, () => b.box(0, 0.6, 0, 1, 1.2, 0.5, '#334455'));
    b.box(0, -0.25, 0, 10, 0.5, 8, '#bbbbbb');
  };
  const original = footprintRecorder(createBatch(THREE));
  const scopedInner = createBatch(THREE), scoped = footprintRecorder(scopedInner);
  drawRoomDetails(original.batch);
  scoped.batch.walls?.({ w: 10, d: 8 });
  withBatchPart(scopedInner, 'authored:market-seller', () => {
    scoped.batch.box(-4.7, 1.5, -3.8, 0.6, 1.2, 0.6, '#aabbcc');
    scoped.batch.at(1, 0.2, 2, Math.PI / 3, () => scoped.batch.box(0, 0.6, 0, 1, 1.2, 0.5, '#334455'));
  });
  scoped.batch.box(0, -0.25, 0, 10, 0.5, 8, '#bbbbbb');

  assert.deepEqual(scoped.shapes(), original.shapes(), 'floor, walking blocks, camera solids, and wall metadata are unchanged');
  assert.equal(scoped.batch.triangles, original.batch.triangles);
  const material = new THREE.MeshBasicMaterial();
  const baselineMeshes = original.batch.build({ solid: material, glow: material, glass: material }).meshes;
  const scopedMeshes = scoped.batch.build({ solid: material, glow: material, glass: material }).meshes;
  const vertices = (meshes: THREE.Mesh[]) => meshes.flatMap(mesh => Array.from(mesh.geometry.getAttribute('position').array)).sort((a, b) => a - b);
  assert.deepEqual(vertices(scopedMeshes), vertices(baselineMeshes), 'part routing changes no vertex positions or geometry total');
  assert.equal(scopedMeshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0),
    baselineMeshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0));
  assert.ok(baselineMeshes.some(mesh => mesh.userData.part === 'wallBack'), 'the recorder classified the baseline wall primitive');
  assert.ok(scopedMeshes.some(mesh => mesh.userData.part === 'authored:market-seller'), 'the scoped geometry part overrides only storage selection');
  for (const mesh of [...baselineMeshes, ...scopedMeshes]) mesh.geometry.dispose();
  material.dispose();
});

test('nested and throwing geometry-part scopes restore the enclosing part', () => {
  const batch = createBatch(THREE);
  withBatchPart(batch, 'outer-person', () => {
    batch.box(-2, 1, 0, 1, 1, 1, '#aa0000');
    assert.throws(() => withBatchPart(batch, 'inner-person', () => {
      batch.box(0, 1, 0, 1, 1, 1, '#00aa00');
      throw new Error('stop nested draw');
    }), /stop nested draw/);
    batch.box(2, 1, 0, 1, 1, 1, '#0000aa');
  });
  batch.box(4, 1, 0, 1, 1, 1, '#aaaa00');
  const material = new THREE.MeshBasicMaterial();
  const meshes = batch.build({ solid: material, glow: material, glass: material }).meshes;
  assert.deepEqual(meshes.map(mesh => [mesh.userData.part, mesh.geometry.getAttribute('position').count]).sort(),
    [['outer-person', 48], ['inner-person', 24], [undefined, 24]].sort());
  for (const mesh of meshes) mesh.geometry.dispose();
  material.dispose();
});

test('a part scope cannot route another batch into the same actor part', () => {
  const actor = createBatch(THREE), unrelated = createBatch(THREE);
  withBatchPart(actor, 'actor-one', () => {
    actor.box(0, 1, 0, 1, 1, 1, '#aaaaaa');
    unrelated.box(0, 1, 0, 1, 1, 1, '#bbbbbb');
  });
  const material = new THREE.MeshBasicMaterial();
  const ownMeshes = actor.build({ solid: material, glow: material, glass: material }).meshes;
  const otherMeshes = unrelated.build({ solid: material, glow: material, glass: material }).meshes;
  assert.equal(ownMeshes[0]!.userData.part, 'actor-one');
  assert.equal(otherMeshes[0]!.userData.part, undefined, 'the other batch retains its base layer');
  for (const mesh of [...ownMeshes, ...otherMeshes]) mesh.geometry.dispose();
  material.dispose();
});
