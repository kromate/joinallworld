import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNeckResidualClosure } from './closure.ts';

test('neck complement closes the measured residual source-face set and area', () => {
  assert.doesNotThrow(() => assertNeckResidualClosure({
    residualSourceFaceIds: [7, 11, 18], residualAreaSquareMetres: 0.06173905623,
    residualAreaBySourceFace: { '7': 0.02, '11': 0.02173905623, '18': 0.02 },
    complementTriangleSourceFaceIds: [7, 11, 11, 18], complementAreaSquareMetres: 0.0617390564,
    complementAreaBySourceFace: { '7': 0.02, '11': 0.0217390564, '18': 0.02 },
  }));
});

test('neck closure rejects a missing face even when the total area matches', () => {
  assert.throws(() => assertNeckResidualClosure({
    residualSourceFaceIds: [7, 11, 18], residualAreaSquareMetres: 0.06173905623,
    residualAreaBySourceFace: { '7': 0.02, '11': 0.02173905623, '18': 0.02 },
    complementTriangleSourceFaceIds: [7, 11], complementAreaSquareMetres: 0.06173905623,
    complementAreaBySourceFace: { '7': 0.02, '11': 0.02173905623 },
  }), /face set differs/);
});

test('neck closure rejects overdraw despite a matching source-face set', () => {
  assert.throws(() => assertNeckResidualClosure({
    residualSourceFaceIds: [7, 11, 18], residualAreaSquareMetres: 0.06173905623,
    residualAreaBySourceFace: { '7': 0.02, '11': 0.02173905623, '18': 0.02 },
    complementTriangleSourceFaceIds: [7, 11, 18], complementAreaSquareMetres: 0.064,
    complementAreaBySourceFace: { '7': 0.02, '11': 0.024, '18': 0.02 },
  }), /area does not close/);
});

test('neck closure rejects per-face maps that omit a face while aggregate areas still match', () => {
  assert.throws(() => assertNeckResidualClosure({
    residualSourceFaceIds: [7, 11, 18], residualAreaSquareMetres: 0.06173905623,
    residualAreaBySourceFace: { '7': 0.02, '11': 0.04173905623 },
    complementTriangleSourceFaceIds: [7, 11, 18], complementAreaSquareMetres: 0.06173905623,
    complementAreaBySourceFace: { '7': 0.02, '11': 0.04173905623 },
  }), /area map does not match/);
});

test('neck closure rejects invalid source identifiers and nonfinite area', () => {
  assert.throws(() => assertNeckResidualClosure({
    residualSourceFaceIds: [7, -1], residualAreaSquareMetres: 0.2,
    residualAreaBySourceFace: { '7': 0.1, '-1': 0.1 },
    complementTriangleSourceFaceIds: [7, -1], complementAreaSquareMetres: 0.2,
    complementAreaBySourceFace: { '7': 0.1, '-1': 0.1 },
  }), /Invalid residual source face/);
  assert.throws(() => assertNeckResidualClosure({
    residualSourceFaceIds: [7], residualAreaSquareMetres: Number.NaN,
    residualAreaBySourceFace: { '7': Number.NaN },
    complementTriangleSourceFaceIds: [7], complementAreaSquareMetres: 0,
    complementAreaBySourceFace: { '7': 0 },
  }), /finite nonnegative/);
});
