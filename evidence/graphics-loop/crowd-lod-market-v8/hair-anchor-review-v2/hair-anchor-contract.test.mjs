import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyHairWitness } from './hair-anchor-contract.mjs';

test('hair witness accepts only the requested actual style/mode and a measured overlap', () => {
  const witness = { mode: 'candidate', style: 'afro', headBounds: { min: [0, 1.5, 0], max: [0, 1.8, 0] },
    center: [0, 1.94, 0], radii: [0.16, 0.157, 0.155], bboxOverlapY: 0.017 };
  assert.deepEqual(verifyHairWitness(witness, 'candidate', 'afro'), { headTop: 1.8, centerY: 1.94, radiusY: 0.157, bboxOverlap: 0.017 });
  assert.throws(() => verifyHairWitness(witness, 'source', 'afro'), /mode\/style/);
  assert.throws(() => verifyHairWitness({ ...witness, bboxOverlapY: 0.2 }, 'candidate', 'afro'), /not derived/);
  assert.throws(() => verifyHairWitness({ ...witness, headBounds: null }, 'candidate', 'afro'), /invalid/);
});
