import test from 'node:test';
import assert from 'node:assert/strict';
import { scalpMarkerPartition } from './scalp-marker-contract.mjs';

test('scalp marker partition retains exact alpha vertices and touching triangles, including unreferenced markers', () => {
  const result = scalpMarkerPartition([0, 0.501, 0, 1, 0], [0, 1, 2, 0, 2, 4]);
  assert.deepEqual(result.vertices, [1, 3]);
  assert.deepEqual([...result.triangleFlags], [1, 0]);
});

test('scalp marker partition rejects invalid alpha and out-of-range triangle data', () => {
  assert.throws(() => scalpMarkerPartition([0, NaN, 1], [0, 1, 2]), /Invalid alpha/);
  assert.throws(() => scalpMarkerPartition([0, 0, 0], [0, 1, 3]), /Invalid triangle index/);
});
