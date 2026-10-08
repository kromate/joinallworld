import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { compileCountryDirectory } from './country-directory.ts';
import { buildGameMapProduct } from './game-map-bundle.ts';
import { GAME_MAP_CATALOGUE_LIMITS, validateGameMapCatalogue, verifyGameMapBundle } from './game-map-contract.ts';
import type { SourceRecord } from './types.ts';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const atlasIds = ['ng', ...Array.from({ length: 26 * 26 }, (_, i) => `${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`).filter(id => id !== 'ng').slice(0, GAME_MAP_CATALOGUE_LIMITS.atlasFeatures - 1)];

function syntheticFixture() {
  const sourceBytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { NE_ID: 1, ADMIN: 'Fixture island', CONTINENT: 'Synthetic', ISO_A2_EH: '-99' }, geometry: { type: 'Polygon', coordinates: [[[-3,5],[-2,5],[-2,6],[-3,6],[-3,5]]] } },
    { type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: { type: 'Polygon', coordinates: [[[3,4],[4,4],[4,5],[3,5],[3,4]]] } },
  ] }));
  const source: SourceRecord = { id: 'natural-earth-admin0-10m-synthetic-test', url: 'https://example.invalid/synthetic.geojson', release: 'synthetic-fixture-commit', license: 'Public-domain', attribution: 'Synthetic test data; not geographic evidence', sha256: sha(sourceBytes), bytes: sourceBytes.byteLength };
  const baseline: SourceRecord = { ...source, id: 'natural-earth-admin0-baseline-synthetic' };
  const compiled = compileCountryDirectory(source, sourceBytes, baseline, sourceBytes, sha('synthetic baseline inventory'));
  const assets = new Map(compiled.assets.map(asset => [asset.relative, asset.body]));
  const atlasBytes = Buffer.from('synthetic checked atlas');
  const directory = { manifest: compiled.manifest, manifestHash: compiled.manifestHash, nodes: compiled.inventory.nodes };
  const product = buildGameMapProduct({ source, sourceBytes, atlasBytes, atlasFeatureIds: atlasIds, directory, assets });
  return { sourceBytes, source, compiled, assets, atlasBytes, directory, product };
}

test('bundles the exact stable-ID outline without requiring an atlas crosswalk and never packages protected Nigeria', async () => {
  const { product } = syntheticFixture();
  assert.equal(product.catalogue.entries.length, 2);
  assert.equal(product.catalogue.crosswalk.length, GAME_MAP_CATALOGUE_LIMITS.atlasFeatures);
  assert.equal(product.catalogue.entries.filter(row => row.availability === 'protected').length, 1);
  assert.equal(product.bundles.length, 1);
  const entry = product.catalogue.entries.find(row => row.sourceIsoA2Eh === null)!;
  assert.equal(entry.crosswalkState, 'unmatched');
  assert.equal(entry.atlasFeatureId, null);
  const decoded = await validateGameMapCatalogue(JSON.parse(new TextDecoder().decode(product.catalogueBytes)) as unknown,
    { atlasSha256: product.catalogue.atlas.sha256, directoryManifestHash: product.catalogue.directory.manifestHash });
  const bundle = product.bundles[0]!;
  assert.equal(bundle.path, `world-country-detail/${bundle.sha256}.txt`);
  assert.equal(sha(bundle.body), bundle.sha256);
  assert.equal((await verifyGameMapBundle(bundle.body, entry, decoded)).node.id, entry.countryId);
  assert.equal(product.logicalBytes, product.catalogueBytes.byteLength + bundle.bytes);
});

test('rejects changed source bytes and altered content-addressed node assets before emitting a product', () => {
  const fixture = syntheticFixture();
  const build = (sourceBytes: Uint8Array, assets: ReadonlyMap<string, Uint8Array>) => buildGameMapProduct({ source: fixture.source, sourceBytes, atlasBytes: fixture.atlasBytes, atlasFeatureIds: atlasIds, directory: fixture.directory, assets });
  assert.throws(() => build(Buffer.from(`${Buffer.from(fixture.sourceBytes).toString('utf8')} `), fixture.assets), /source pin/);
  const changed = new Map(fixture.assets);
  const nodePath = [...changed.keys()].find(value => value.startsWith('nodes/'))!;
  changed.set(nodePath, Buffer.from('tampered index'));
  assert.throws(() => build(fixture.sourceBytes, changed), /node index bytes do not match path|hash mismatch|not valid JSON/);
});
