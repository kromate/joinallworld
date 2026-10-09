import test from 'node:test';
import assert from 'node:assert/strict';
import { exactHairItemMap } from './exact-hair-item-map.mjs';

test('hair map preserves the complete item vertex range and original triangle order', () => {
  const source = Uint16Array.from([12, 14, 13, 13, 14, 15]);
  const map = exactHairItemMap(source, 12, 4);
  assert.deepEqual(map.sourceVertex, [12, 13, 14, 15]);
  assert.deepEqual(map.index, [0, 2, 1, 1, 2, 3]);
  assert.equal(map.metrics.sourceTriangles, 2);
  assert.equal(map.metrics.outputTriangles, 2);
  assert.equal(map.metrics.outputVertices, 4);
  assert.equal(map.metrics.exactHairIdentity, true);
});

test('hair map rejects partial, malformed, and out-of-range item data', () => {
  assert.throws(() => exactHairItemMap([], 0, 2), /nonempty triangle/);
  assert.throws(() => exactHairItemMap([0, 1], 0, 2), /nonempty triangle/);
  assert.throws(() => exactHairItemMap([0, 1, 2], 0, 2), /escapes authored item range/);
  assert.throws(() => exactHairItemMap([4, 5, 7], 4, 3), /escapes authored item range/);
});
