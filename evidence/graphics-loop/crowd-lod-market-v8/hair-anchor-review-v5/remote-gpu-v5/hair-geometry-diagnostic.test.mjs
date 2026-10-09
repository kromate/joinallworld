import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseGeometryToggle } from './hair-geometry-diagnostic.mjs';

const shot = (patch = {}) => ({
  normalizedLook: { body: 'man', hair: 'afro' },
  recipeMetrics: { wardrobe: [{ id: 'hair:afro', sourceTriangles: 100, outputTriangles: 54 }] },
  actualHairGeometryWitness: {
    placement: { radii: [0.1, 0.2, 0.3] },
    hairAttributeSignatures: { color: { bytes: 4, sha256: 'a' }, skinWeight: { bytes: 4, sha256: 'b' } },
    generatedHairTriangles: 100,
    generatedHairVertices: 60,
    generatedHairVertexBoundsWorldSceneUnits: { min: [0, 0, 0], max: [1, 1, 1] },
  },
  ...patch,
});

test('diagnostic equality ignores JS object key insertion order without ignoring values', () => {
  const a = shot();
  const b = shot({ actualHairGeometryWitness: {
    ...a.actualHairGeometryWitness,
    hairAttributeSignatures: { skinWeight: { sha256: 'b', bytes: 4 }, color: { sha256: 'a', bytes: 4 } },
  } });
  const result = diagnoseGeometryToggle(a, b, 'hair:afro');
  assert.equal(result.checks.hairAttributes, true);
  assert.equal(result.exactGuardPassed, true);
});

test('diagnostic refuses an actual attribute hash mismatch', () => {
  const a = shot();
  const b = shot({ actualHairGeometryWitness: {
    ...a.actualHairGeometryWitness,
    hairAttributeSignatures: { ...a.actualHairGeometryWitness.hairAttributeSignatures,
      color: { bytes: 4, sha256: 'different' } },
  } });
  const result = diagnoseGeometryToggle(a, b, 'hair:afro');
  assert.equal(result.checks.hairAttributes, false);
  assert.equal(result.exactGuardPassed, false);
});

test('diagnostic preserves and reports a compact triangle-count mismatch', () => {
  const a = shot();
  const b = shot({ actualHairGeometryWitness: { ...a.actualHairGeometryWitness, generatedHairTriangles: 54 } });
  const result = diagnoseGeometryToggle(a, b, 'hair:afro');
  assert.equal(result.checks.generatedHairTriangles, false);
  assert.equal(result.exactGuardPassed, false);
  assert.equal(result.checks.compactRangeMatchesRecipe, true);
});

test('diagnostic rejects an observed compact range that disagrees with its recipe', () => {
  const a = shot();
  const b = shot({ actualHairGeometryWitness: { ...a.actualHairGeometryWitness, generatedHairTriangles: 53 } });
  const result = diagnoseGeometryToggle(a, b, 'hair:afro');
  assert.equal(result.checks.compactRangeMatchesRecipe, false);
  assert.equal(result.recipeProvenancePassed, false);
});
