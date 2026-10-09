import test from 'node:test';
import assert from 'node:assert/strict';
import { compactWardrobeRanges } from './compact-wardrobe-ranges.mjs';

test('compact wardrobe item ranges exactly track concatenated item vertex and index streams', () => {
  const result = compactWardrobeRanges([
    { id: 'outfit:hoodie', sourceVertex: [4, 8, 9], index: [0, 1, 2, 2, 1, 0] },
    { id: 'hair:afro', sourceVertex: [1, 5], index: [0, 1, 0] },
    { id: 'empty', sourceVertex: [], index: [] },
  ]);
  assert.deepEqual(result, {
    ranges: {
      'outfit:hoodie': { vertexStart: 0, vertexCount: 3, indexStart: 0, indexCount: 6 },
      'hair:afro': { vertexStart: 3, vertexCount: 2, indexStart: 6, indexCount: 3 },
    },
    vertexCount: 5,
    indexCount: 9,
  });
});

test('compact wardrobe ranges reject duplicate ids and invalid remapped triangles', () => {
  assert.throws(() => compactWardrobeRanges([
    { id: 'hair:afro', sourceVertex: [0, 1, 2], index: [0, 1, 2] },
    { id: 'hair:afro', sourceVertex: [0, 1, 2], index: [0, 1, 2] },
  ]), /unique/);
  assert.throws(() => compactWardrobeRanges([
    { id: 'hair:afro', sourceVertex: [0, 1, 2], index: [0, 1, 3] },
  ]), /triangle indices/);
});
