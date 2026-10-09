import test from 'node:test';
import assert from 'node:assert/strict';
import { createKit } from './kit.ts';
import { createBatch, sceneMaterials } from './build.ts';
import { footprintRecorder } from './movement.ts';
import type { Face4 } from './types.ts';

const point = (x: number, y: number, z: number) => Object.freeze([x, y, z]) as readonly [number, number, number];
const face: Face4 = Object.freeze([point(-1, 0, 0), point(1, 0, 0), point(1, 1, 0), point(-1, 1, 0)]);

test('face4 follows nested transforms, preserves layer and part, and never mutates source points', () => {
  const kit = createKit(), batch = createBatch(kit.THREE);
  batch.at(2, 3, 4, Math.PI / 2, () => batch.face4(face, '#789abc', { layer: 'glass', part: 'cabin-pane' }));
  const built = batch.build(sceneMaterials(kit));
  assert.equal(built.meshes.length, 1);
  assert.equal(built.meshes[0]!.name, 'glass@cabin-pane');
  assert.equal(built.meshes[0]!.userData.part, 'cabin-pane');
  const pos = built.meshes[0]!.geometry.getAttribute('position');
  assert.equal(pos.count, 4);
  assert.ok(Math.abs(pos.getX(0) - 2) < 1e-6);
  assert.equal(pos.getY(0), 3);
  assert.ok(Math.abs(pos.getZ(0) - 5) < 1e-6);
  assert.deepEqual([...face[0]!], [-1, 0, 0]);
  kit.dispose();
});

test('face4 rejects mutable, non-planar, and degenerate input', () => {
  const kit = createKit(), batch = createBatch(kit.THREE);
  const mutable = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as unknown as Face4;
  assert.throws(() => batch.face4(mutable, '#fff'), /immutable tuple/);
  assert.throws(() => batch.face4(Object.freeze([point(0, 0, 0), point(1, 0, 0), point(1, 1, 0), point(0, 1, 0.1)]), '#fff'), /coplanar/);
  assert.throws(() => batch.face4(Object.freeze([point(0, 0, 0), point(0, 0, 0), point(0, 0, 0), point(0, 0, 0)]), '#fff'), /non-degenerate/);
  const concave: Face4 = Object.freeze([point(0, 0, 0), point(2, 0, 0), point(0.7, 0.6, 0), point(0, 2, 0)]);
  assert.throws(() => batch.face4(concave, '#fff'), /strictly convex/);
  const crossed: Face4 = Object.freeze([point(0, 0, 0), point(1, 1, 0), point(0, 1, 0), point(1, 0, 0)]);
  assert.throws(() => batch.face4(crossed, '#fff'), /strictly convex/);
  const shortPoint = Object.freeze([Object.freeze([0, 0]), point(1, 0, 0), point(1, 1, 0), point(0, 1, 0)]) as unknown as Face4;
  assert.throws(() => batch.face4(shortPoint, '#fff'), /three finite coordinates/);
  kit.dispose();
});

test('footprint recorder shares bounds classification and preserves transformed wall-part routing', () => {
  const kit = createKit(), recorder = footprintRecorder(createBatch(kit.THREE));
  recorder.batch.walls?.({ w: 8, d: 8 });
  const wall: Face4 = Object.freeze([point(-0.2, 0.5, -3.7), point(0.2, 0.5, -3.7), point(0.2, 1.5, -3.7), point(-0.2, 1.5, -3.7)]);
  let transformed: { x: number; z: number }[] = [];
  recorder.batch.at(0.1, 0.2, 0.1, 0.1, () => {
    recorder.batch.face4(wall, '#789abc', { ry: 0.06, rx: 0.08, rz: -0.04 });
    transformed = wall.map(([x0, y0, z0]) => {
      const ax = x0 * Math.cos(-0.04) - y0 * Math.sin(-0.04), ay = x0 * Math.sin(-0.04) + y0 * Math.cos(-0.04);
      const by = ay * Math.cos(0.08) - z0 * Math.sin(0.08), bz = ay * Math.sin(0.08) + z0 * Math.cos(0.08);
      const rx = ax * Math.cos(0.06) + bz * Math.sin(0.06), rz = -ax * Math.sin(0.06) + bz * Math.cos(0.06);
      return recorder.batch.world(rx, by, rz);
    });
  });
  const [x0, z0, x1, z1] = recorder.shapes().block[0]!;
  assert.ok(Math.abs(x0 - Math.min(...transformed.map(p => p.x))) < 1e-6, `${x0} vs ${Math.min(...transformed.map(p => p.x))}`);
  assert.ok(Math.abs(x1 - Math.max(...transformed.map(p => p.x))) < 1e-6, `${x1} vs ${Math.max(...transformed.map(p => p.x))}`);
  assert.ok(Math.abs(z0 - Math.min(...transformed.map(p => p.z))) < 1e-6, `${z0} vs ${Math.min(...transformed.map(p => p.z))}`);
  assert.ok(Math.abs(z1 - Math.max(...transformed.map(p => p.z))) < 1e-6, `${z1} vs ${Math.max(...transformed.map(p => p.z))}`);
  const built = recorder.batch.build(sceneMaterials(kit));
  assert.equal(built.meshes[0]!.name, 'solid@wallBack');
  kit.dispose();
});
