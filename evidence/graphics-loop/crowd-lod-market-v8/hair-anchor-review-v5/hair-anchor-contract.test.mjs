import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyHairWitness } from './hair-anchor-contract.mjs';

test('hair witness accepts only the requested actual style/mode and a measured overlap', () => {
  const witness = { mode: 'candidate', style: 'afro', headBounds: { min: [0, 1.5, 0], max: [0, 1.8, 0] },
    center: [0, 1.94, 0], radii: [0.16, 0.157, 0.155], bboxOverlapY: 0.017 };
  const measured = verifyHairWitness(witness, 'candidate', 'afro');
  assert.equal(measured.headTop, 1.8);
  assert.equal(measured.centerY, 1.94);
  assert.equal(measured.radiusY, 0.157);
  assert.ok(Math.abs(measured.bboxOverlap - 0.017) < 1e-12);
  assert.throws(() => verifyHairWitness(witness, 'source', 'afro'), /mode\/style/);
  assert.throws(() => verifyHairWitness({ ...witness, bboxOverlapY: 0.2 }, 'candidate', 'afro'), /not derived/);
  assert.throws(() => verifyHairWitness({ ...witness, headBounds: null }, 'candidate', 'afro'), /invalid/);
});
