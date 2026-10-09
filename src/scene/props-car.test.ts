import test from 'node:test';
import assert from 'node:assert/strict';
import { createKit } from './kit.ts';
import { createBatch, sceneMaterials } from './build.ts';
import { car } from './props.ts';
import { footprintRecorder } from './movement.ts';
import type { Batch } from './types.ts';

function originalCar(b: Batch): void {
  b.at(0, 0, 0, 0, () => {
    b.box(0, 0.62, 0, 1.9, 0.6, 4.2, '#49535a');
    b.box(0, 1.2, -0.2, 1.7, 0.6, 2.3, '#49535a');
    b.box(0, 1.22, -0.2, 1.74, 0.42, 2.0, '#7395a2');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.9, 0.36, sz * 1.35, 0.36, 0.24, '#22252a', { seg: 8, rz: Math.PI / 2 });
    for (const sx of [-1, 1]) b.box(sx * 0.62, 0.72, 2.11, 0.36, 0.16, 0.04, '#ffd58a', { layer: 'glow' });
  });
}

function geometry(draw: (batch: Batch) => void) {
  const kit = createKit(), batch = createBatch(kit.THREE);
  draw(batch);
  const built = batch.build(sceneMaterials(kit));
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let vertices = 0, triangles = 0, bytes = 0;
  for (const mesh of built.meshes) {
    const g = mesh.geometry, p = g.getAttribute('position');
    vertices += p.count; triangles += g.index!.count / 3;
    for (const attr of Object.values(g.attributes)) bytes += attr.array.byteLength;
    bytes += g.index!.array.byteLength;
    g.computeBoundingBox(); const box = g.boundingBox!;
    bounds[0] = Math.min(bounds[0]!, box.min.x); bounds[1] = Math.min(bounds[1]!, box.min.y); bounds[2] = Math.min(bounds[2]!, box.min.z);
    bounds[3] = Math.max(bounds[3]!, box.max.x); bounds[4] = Math.max(bounds[4]!, box.max.y); bounds[5] = Math.max(bounds[5]!, box.max.z);
  }
  kit.dispose();
  return { bounds, vertices, triangles, bytes, meshes: built.meshes.length };
}

test('car cabin keeps body bounds, wheel contact, mesh count, and allocation budget', () => {
  const baseline = geometry(originalCar), candidate = geometry(batch => car(batch, 0, 0, { color: '#49535a', glass: '#7395a2' }));
  assert.equal(candidate.meshes, baseline.meshes);
  assert.ok(candidate.vertices <= baseline.vertices);
  assert.ok(candidate.triangles <= baseline.triangles);
  assert.ok(candidate.bytes <= baseline.bytes);
  assert.deepEqual(candidate.bounds, baseline.bounds);
});

test('each cabin pane closes its four frame edges with no uncovered or overlapping inner edges', () => {
  const kit = createKit(), batch = createBatch(kit.THREE);
  car(batch, 0, 0, { color: '#49535a', glass: '#7395a2' });
  const solid = batch.build(sceneMaterials(kit)).meshes.find(mesh => mesh.name === 'solid')!;
  const g = solid.geometry, pos = g.getAttribute('position'), index = g.index!;
  const point = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map(value => Math.round(value * 1e5) / 1e5).join(',');
  const edge = (a: number, b: number) => [point(a), point(b)].sort().join('|');
  for (let face = 0; face < 4; face++) {
    const start = 36 + face * 30, uses = new Map<string, number>();
    for (let i = start; i < start + 30; i += 3) {
      const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (let j = 0; j < 3; j++) {
        const key = edge(tri[j]!, tri[(j + 1) % 3]!);
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
    assert.equal([...uses.values()].filter(count => count === 1).length, 4, `pane ${face} exposes only its four intended outside edges`);
    assert.ok([...uses.values()].every(count => count <= 2), `pane ${face} has no overlapping shared edge`);
  }
  kit.dispose();
});

test('car replacement preserves the original recorder collision union', () => {
  const kit = createKit();
  const collect = (draw: (batch: Batch) => void) => {
    const recorder = footprintRecorder(createBatch(kit.THREE)); draw(recorder.batch); return recorder.shapes().block;
  };
  const baseline = collect(originalCar), candidate = collect(batch => car(batch, 0, 0, { color: '#49535a', glass: '#7395a2' }));
  const contains = (rects: number[][], x: number, z: number) => rects.some(([x0, z0, x1, z1]) => x >= x0! - 1e-7 && x <= x1! + 1e-7 && z >= z0! - 1e-7 && z <= z1! + 1e-7);
  for (let x = -0.96; x <= 0.96; x += 0.04) for (let z = -2.12; z <= 2.12; z += 0.04) {
    assert.equal(contains(candidate, x, z), contains(baseline, x, z), `walk-block union at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
  kit.dispose();
});
