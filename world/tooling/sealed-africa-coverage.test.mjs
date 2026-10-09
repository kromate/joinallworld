import test from 'node:test';
import assert from 'node:assert/strict';
import { citySceneAssets, LEGACY_FIRST_FIVE, LEGACY_SOURCE_SHA, selectAfricaBatches, selectedAssets } from './sealed-africa-coverage.mjs';

const expected = [
  ['yaounde', 'lome', 'accra', 'nairobi', 'algiers'],
  ['cotonou', 'abidjan', 'dakar', 'cape-town'],
  ['addis-ababa'],
];
const ten = expected.flat();
const filesFor = cities => {
  const files = new Map([['assets/index.html', { path: 'assets/index.html' }]]);
  for (const city of cities) for (const kind of ['map', 'geometry']) {
    const path = `assets/assets/city-${city}-${kind}-1234abcd.js`;
    files.set(path, { path });
  }
  return files;
};

test('selects three source-exported batches covering each admitted city exactly once', () => {
  const batches = selectAfricaBatches(expected, '80122bfb1ef8c3638b4e5968ff5073120ddd77a7');
  assert.deepEqual(batches.map(batch => batch.name), ['first-five', 'second-four', 'addis-ababa']);
  assert.deepEqual(batches.flatMap(batch => batch.cities), ten);
  assert.ok(Object.isFrozen(batches) && batches.every(batch => Object.isFrozen(batch.cities)));
});

test('rejects absent, malformed, duplicate, omitted, or unexpected batch exports', () => {
  assert.throws(() => selectAfricaBatches(undefined, '80122bfb1ef8c3638b4e5968ff5073120ddd77a7'), /does not export/);
  for (const malformed of [null, [], [...expected, ['lagos']], [['yaounde'], ...expected.slice(1)], expected.map(batch => [...batch, 'lagos'])]) {
    assert.throws(() => selectAfricaBatches(malformed, '80122bfb1ef8c3638b4e5968ff5073120ddd77a7'));
  }
});

test('legacy first-five compatibility is pinned to the inspected source SHA and fixture export', () => {
  assert.deepEqual(selectAfricaBatches(undefined, LEGACY_SOURCE_SHA, [...LEGACY_FIRST_FIVE]).map(batch => batch.cities), [LEGACY_FIRST_FIVE]);
  assert.throws(() => selectAfricaBatches(undefined, '80122bfb1ef8c3638b4e5968ff5073120ddd77a7', [...LEGACY_FIRST_FIVE]), /does not export/);
  assert.throws(() => selectAfricaBatches(undefined, LEGACY_SOURCE_SHA, ['lagos']), /exact inspected/);
});

test('requires one map and geometry chunk per city plus the HTML entry', () => {
  const files = filesFor(ten);
  const selected = selectedAssets(files, ten);
  assert.equal(selected.entries.length, 21);
  assert.equal(Object.keys(selected.byCity).length, 10);
  assert.equal(citySceneAssets(files, ten).entries.length, 20);
  files.delete('assets/assets/city-cape-town-geometry-1234abcd.js');
  assert.throws(() => selectedAssets(files, ten), /exactly one content-addressed geometry chunk for cape-town/);
  files.set('assets/assets/city-cape-town-geometry-deadbeef.js', { path: 'assets/assets/city-cape-town-geometry-deadbeef.js' });
  assert.equal(selectedAssets(files, ten).entries.length, 21);
  files.set('assets/assets/city-cape-town-geometry-1234abcd.js', { path: 'assets/assets/city-cape-town-geometry-1234abcd.js' });
  assert.throws(() => selectedAssets(files, ten), /exactly one content-addressed geometry chunk for cape-town/);
});
