import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { compileCountryDirectory } from './country-directory.ts';
import { canonicalGameMapJson, GAME_MAP_CATALOGUE_LIMITS, validateGameMapCatalogue, verifyGameMapBundle } from './game-map-contract.ts';
import { buildGameMapProduct } from './game-map-bundle.ts';
import type { GameMapBundle, GameMapCatalogue, GameMapCatalogueEntry, GameMapCrosswalkRow } from './game-map-contract.ts';
import type { SourceRecord } from './types.ts';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const ATLAS_SHA = 'a'.repeat(64);
function fixture() {
  const raw = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { NE_ID: 1, ADMIN: 'Synthetic Ghana', CONTINENT: 'Africa', ISO_A2_EH: 'AA' }, geometry: { type: 'Polygon', coordinates: [[[-3,5],[-2,5],[-2,6],[-3,6],[-3,5]]] } },
    { type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: { type: 'Polygon', coordinates: [[[3,4],[4,4],[4,5],[3,5],[3,4]]] } },
  ] }));
  const source: SourceRecord = { id: 'natural-earth-admin0-10m-test', url: 'https://example.invalid/ne-10m.geojson', release: 'test-commit', license: 'Public-domain', attribution: 'Synthetic fixture only; not geographic evidence', sha256: sha(raw), bytes: raw.byteLength };
  const baseline: SourceRecord = { ...source, id: 'natural-earth-admin0-baseline', release: 'baseline-test' };
  const compiled = compileCountryDirectory(source, raw, baseline, raw, sha('synthetic baseline inventory'));
  const manifestAsset = compiled.assets.find(asset => asset.relative === compiled.manifestPath)!;
  const assetByPath = new Map(compiled.assets.map(asset => [asset.relative, asset.body]));
  const indexes = [...compiled.assets].filter(asset => asset.relative.startsWith('nodes/')).map(asset => ({ path: asset.relative, value: JSON.parse(Buffer.from(asset.body).toString('utf8')) as { node: { id: string; parentId: string | null; kind: string; countryCode: string | null; name: string; sourceFeatureIds: string[]; outline: string }; outlineIndexPath: string | null } }));
  const gh = indexes.find(asset => asset.value.node.id !== 'world:earth' && asset.value.node.kind === 'country' && asset.value.node.countryCode === 'AA')!;
  const ng = indexes.find(asset => asset.value.node.kind === 'country' && asset.value.node.countryCode === 'NG')!;
  const asEntry = (asset: typeof gh | typeof ng, code: string, id: string, availability: GameMapCatalogueEntry['availability'], atlasId: string | null): GameMapCatalogueEntry => ({
    countryId: asset.value.node.id, name: asset.value.node.name,
    sourceRef: asset.value.node.sourceFeatureIds[0]!, sourceIsoA2Eh: code,
    continentId: asset.value.node.parentId!, nodePath: asset.path, availability,
    crosswalkState: atlasId ? 'matched' : 'not-in-coarse-atlas', atlasFeatureId: atlasId,
    bundlePath: null, bundleSha256: null, bundleBytes: null,
    exception: availability === 'protected' ? 'Existing legacy Nigeria map is protected.' : null,
  });
  const ghEntry = asEntry(gh, 'AA', 'aa', 'mapped', 'aa');
  const ngEntry = asEntry(ng, 'NG', 'legacy-ng', 'protected', 'ng');
  const partPaths: string[] = [];
  const outlinePath = gh.value.outlineIndexPath!;
  const outline = JSON.parse(Buffer.from(assetByPath.get(outlinePath)!).toString('utf8')) as { parts: Array<{ path: string }> };
  partPaths.push(...outline.parts.map(part => part.path));
  const bundleAssets = [gh.path, outlinePath, ...partPaths].map(path => {
    const body = assetByPath.get(path)!;
    return { path, encoding: 'base64' as const, bytes: body.byteLength, sha256: sha(body), body: Buffer.from(body).toString('base64') };
  });
  const bundle: GameMapBundle = { schemaVersion: 1, kind: 'country-detail-bundle', countryId: ghEntry.countryId, sourceRef: ghEntry.sourceRef,
    directoryManifestHash: compiled.manifestHash, atlasSha256: ATLAS_SHA, assets: bundleAssets,
    attribution: ['Synthetic fixture only; not geographic evidence'] };
  const bundleBytes = Buffer.from(`${canonicalGameMapJson(bundle)}\n`);
  const boundGh: GameMapCatalogueEntry = { ...ghEntry, bundlePath: `world-country-detail/${sha(bundleBytes)}.txt`, bundleSha256: sha(bundleBytes), bundleBytes: bundleBytes.byteLength };
  const countryNodes = [boundGh, ngEntry].sort((a, b) => a.countryId < b.countryId ? -1 : a.countryId > b.countryId ? 1 : 0);
  const mappedCrosswalk: GameMapCrosswalkRow[] = [
    { atlasFeatureId: 'aa', sourceIsoA2Eh: 'AA', sourceNeId: 1, countryId: boundGh.countryId, state: 'matched', evidence: null },
    { atlasFeatureId: 'ng', sourceIsoA2Eh: 'NG', sourceNeId: 159, countryId: 'legacy-ng', state: 'matched', evidence: 'Protected legacy identity.' },
  ];
  const allIds = Array.from({ length: 26 * 26 }, (_, i) => `${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`).filter(id => id !== 'aa' && id !== 'ng').slice(0, GAME_MAP_CATALOGUE_LIMITS.atlasFeatures - 2).sort();
  const crosswalk = [...mappedCrosswalk, ...allIds.map(atlasFeatureId => ({ atlasFeatureId, sourceIsoA2Eh: null, sourceNeId: null, countryId: null, state: 'unmatched' as const, evidence: 'Synthetic test-only unmatched atlas feature.' }))].sort((a, b) => a.atlasFeatureId < b.atlasFeatureId ? -1 : a.atlasFeatureId > b.atlasFeatureId ? 1 : 0);
  const manifestValue = JSON.parse(Buffer.from(manifestAsset.body).toString('utf8')) as unknown;
  const catalogue: GameMapCatalogue = {
    schemaVersion: 1, kind: 'country-detail-catalogue',
    atlas: { path: 'src/map3d/geo/data/world.ts', sha256: ATLAS_SHA, bytes: 1, sourceScale: '1:50m' },
    source, directory: { manifestPath: `manifests/${compiled.manifestHash}.json`, manifestHash: compiled.manifestHash, baselineInventoryHash: compiled.manifest.baselineInventoryHash, manifest: compiled.manifest },
    crosswalk, entries: countryNodes,
  };
  return { raw, compiled, bundleBytes, ghEntry: boundGh, ngEntry, catalogue, manifestValue };
}

const expected = (catalogue: GameMapCatalogue) => ({ atlasSha256: catalogue.atlas.sha256, directoryManifestHash: catalogue.directory.manifestHash });

test('validates exact sorted 258-denominator form, embedded manifest hash, and required continent/node bindings', async () => {
  const state = fixture();
  const parsed = await validateGameMapCatalogue(state.catalogue, expected(state.catalogue));
  assert.equal(parsed.entries.length, 2, 'synthetic fixture keeps its explicit two-unit denominator');
  assert.equal(parsed.entries[0]!.continentId, state.ghEntry.continentId);
  assert.match(parsed.entries[0]!.nodePath, /^nodes\/[a-f0-9]{64}\.json$/);
  assert.equal(parsed.entries[1]!.availability, 'protected');
  assert.equal(parsed.directory.manifestHash, state.compiled.manifestHash);
});

test('rejects changed atlas/directory pins, manifest contents, unsorted rows, and missing nodePath', async () => {
  const state = fixture();
  await assert.rejects(validateGameMapCatalogue(state.catalogue, { ...expected(state.catalogue), atlasSha256: 'b'.repeat(64) }), /atlas binding/);
  await assert.rejects(validateGameMapCatalogue(state.catalogue, { ...expected(state.catalogue), directoryManifestHash: 'c'.repeat(64) }), /directory manifest/);
  const changed = structuredClone(state.catalogue); changed.directory.manifest.source.sha256 = 'd'.repeat(64);
  await assert.rejects(validateGameMapCatalogue(changed, expected(state.catalogue)), /source\/baseline\/hash binding/);
  const unsorted = structuredClone(state.catalogue); unsorted.entries.reverse();
  await assert.rejects(validateGameMapCatalogue(unsorted, expected(state.catalogue)), /sorted/);
  const noPath = structuredClone(state.catalogue) as unknown as { entries: Array<Record<string, unknown>> };
  delete noPath.entries[0]!.nodePath;
  await assert.rejects(validateGameMapCatalogue(noPath, expected(state.catalogue)), /missing or unknown fields/);
});

test('verifies original embedded node/index/part hashes and reconstructs the complete geometry', async () => {
  const state = fixture();
  const catalogue = await validateGameMapCatalogue(state.catalogue, expected(state.catalogue));
  const result = await verifyGameMapBundle(state.bundleBytes, state.ghEntry, catalogue);
  assert.equal(result.node.id, state.ghEntry.countryId);
  assert.equal(result.node.parentId, state.ghEntry.continentId);
  assert.equal(result.geometry.type, 'Polygon');
  assert.deepEqual(result.geometry.coordinates, [[[-3,5],[-2,5],[-2,6],[-3,6],[-3,5]]]);
  assert.match(result.attribution[0]!, /Synthetic fixture only/);
});

test('fails closed on mutated bundle, node semantic mismatch, missing part, and rehashed invalid coordinates', async () => {
  const state = fixture(), catalogue = await validateGameMapCatalogue(state.catalogue, expected(state.catalogue));
  const tampered = Buffer.from(state.bundleBytes); tampered[tampered.length - 4] = tampered[tampered.length - 4]! ^ 1;
  await assert.rejects(verifyGameMapBundle(tampered, state.ghEntry, catalogue), /byte\/hash pin/);
  await assert.rejects(verifyGameMapBundle(state.bundleBytes, { ...state.ghEntry, continentId: 'continent:wrong' }, catalogue), /selected bundle entry|parent|node/);
  const parsed = JSON.parse(state.bundleBytes.toString('utf8')) as GameMapBundle;
  const part = parsed.assets.at(-1)!;
  parsed.assets = parsed.assets.slice(0, -1);
  const missingBytes = Buffer.from(`${canonicalGameMapJson(parsed)}\n`);
  const missingEntry = { ...state.ghEntry, bundleBytes: missingBytes.byteLength, bundleSha256: sha(missingBytes) };
  await assert.rejects(verifyGameMapBundle(missingBytes, missingEntry, catalogue), /selected bundle entry|asset count|omits required outline part/);
  const invalid = JSON.parse(state.bundleBytes.toString('utf8')) as GameMapBundle;
  const last = invalid.assets.at(-1)!;
  const raw = Buffer.from(last.body, 'base64');
  const oldPartPath = last.path;
  const geometry = JSON.parse(raw.toString('utf8')) as { coordinates: number[][][][] };
  geometry.coordinates[0]![0]![0]![0] = 999;
  const changedRaw = Buffer.from(canonicalGameMapJson(geometry));
  const changedPartSha = sha(changedRaw), changedPartPath = `outlines/${changedPartSha}.json`;
  last.path = changedPartPath; last.bytes = changedRaw.byteLength; last.sha256 = changedPartSha; last.body = changedRaw.toString('base64');
  const outlineAsset = invalid.assets.find(asset => asset.path.startsWith('outline-index/'))!;
  const outlineIndex = JSON.parse(Buffer.from(outlineAsset.body, 'base64').toString('utf8')) as { totalPartBytes: number; parts: Array<{ path: string; bytes: number }> };
  const partRef = outlineIndex.parts.find(part => part.path === oldPartPath)!;
  outlineIndex.totalPartBytes += changedRaw.byteLength - partRef.bytes;
  partRef.path = changedPartPath; partRef.bytes = changedRaw.byteLength;
  const changedIndex = Buffer.from(canonicalGameMapJson(outlineIndex));
  const changedIndexSha = sha(changedIndex), changedIndexPath = `outline-index/${changedIndexSha}.json`;
  outlineAsset.path = changedIndexPath; outlineAsset.bytes = changedIndex.byteLength; outlineAsset.sha256 = changedIndexSha; outlineAsset.body = changedIndex.toString('base64');
  const nodeAsset = invalid.assets.find(asset => asset.path.startsWith('nodes/'))!;
  const nodeIndex = JSON.parse(Buffer.from(nodeAsset.body, 'base64').toString('utf8')) as { outlineIndexPath: string | null };
  nodeIndex.outlineIndexPath = changedIndexPath;
  const changedNode = Buffer.from(canonicalGameMapJson(nodeIndex));
  const changedNodeSha = sha(changedNode), changedNodePath = `nodes/${changedNodeSha}.json`;
  nodeAsset.path = changedNodePath; nodeAsset.bytes = changedNode.byteLength; nodeAsset.sha256 = changedNodeSha; nodeAsset.body = changedNode.toString('base64');
  const invalidBytes = Buffer.from(`${canonicalGameMapJson(invalid)}\n`);
  const invalidEntry = { ...state.ghEntry, nodePath: changedNodePath, bundleBytes: invalidBytes.byteLength, bundleSha256: sha(invalidBytes) };
  const hostileCatalogue = structuredClone(catalogue);
  hostileCatalogue.entries = hostileCatalogue.entries.map(row => row.countryId === invalidEntry.countryId ? invalidEntry : row);
  await assert.rejects(verifyGameMapBundle(invalidBytes, invalidEntry, hostileCatalogue), /position|longitude|invalid/);
  assert.ok(part.sha256.length === 64);
});

test('builds canonical catalogue and byte-identical, content-addressed country assets from a verified synthetic directory', async () => {
  const state = fixture();
  const ids = ['aa', 'ng', ...Array.from({ length: 26 * 26 }, (_, i) => `${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`).filter(id => id !== 'aa' && id !== 'ng').slice(0, 234)];
  const assets = new Map(state.compiled.assets.map(asset => [asset.relative, asset.body]));
  const product = buildGameMapProduct({ source: state.compiled.manifest.source, sourceBytes: state.raw, atlasBytes: Buffer.from('synthetic atlas bytes'), atlasFeatureIds: ids,
    directory: { manifest: state.compiled.manifest, manifestHash: state.compiled.manifestHash, nodes: state.compiled.inventory.nodes }, assets });
  const parsed = await validateGameMapCatalogue(JSON.parse(Buffer.from(product.catalogueBytes).toString('utf8')) as unknown,
    { atlasSha256: product.catalogue.atlas.sha256, directoryManifestHash: product.catalogue.directory.manifestHash });
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries.filter(row => row.availability === 'protected').length, 1);
  assert.equal(product.bundles.length, 1, 'protected Nigeria is not packaged');
  const bundle = product.bundles[0]!;
  assert.equal(sha(bundle.body), bundle.sha256);
  assert.equal(bundle.path, `world-country-detail/${bundle.sha256}.txt`);
  const mapped = parsed.entries.find(row => row.countryId === bundle.countryId)!;
  assert.deepEqual((await verifyGameMapBundle(bundle.body, mapped, parsed)).geometry.coordinates, [[[-3,5],[-2,5],[-2,6],[-3,6],[-3,5]]]);
  assert.ok(product.logicalBytes === product.catalogueBytes.byteLength + bundle.bytes);
});

test('still packages exact-ID outlines when ISO crosswalk is unmatched, without claiming an atlas overlay', async () => {
  const state = fixture();
  const parsed = JSON.parse(state.raw.toString('utf8')) as { features: Array<{ properties: Record<string, unknown> }> };
  parsed.features[0]!.properties.ISO_A2_EH = '-99';
  const raw = Buffer.from(JSON.stringify(parsed));
  const source: SourceRecord = { ...state.compiled.manifest.source, sha256: sha(raw), bytes: raw.byteLength };
  const baseline: SourceRecord = { ...source, id: 'natural-earth-admin0-baseline-test' };
  const rebuilt = compileCountryDirectory(source, raw, baseline, raw, state.compiled.manifest.baselineInventoryHash);
  const ids = ['ng', ...Array.from({ length: 26 * 26 }, (_, i) => `${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`).filter(id => id !== 'ng' && id !== 'aa').slice(0, 235)];
  const product = buildGameMapProduct({ source, sourceBytes: raw, atlasBytes: Buffer.from('synthetic atlas without AA'), atlasFeatureIds: ids,
    directory: { manifest: rebuilt.manifest, manifestHash: rebuilt.manifestHash, nodes: rebuilt.inventory.nodes },
    assets: new Map(rebuilt.assets.map(asset => [asset.relative, asset.body])) });
  const entry = product.catalogue.entries.find(row => row.sourceIsoA2Eh === null)!;
  assert.equal(entry.availability, 'mapped');
  assert.equal(entry.atlasFeatureId, null);
  assert.equal(entry.crosswalkState, 'unmatched');
  assert.equal(product.bundles.length, 1);
  const catalogue = await validateGameMapCatalogue(product.catalogue, { atlasSha256: product.catalogue.atlas.sha256, directoryManifestHash: product.catalogue.directory.manifestHash });
  assert.equal((await verifyGameMapBundle(product.bundles[0]!.body, entry, catalogue)).node.id, entry.countryId);
});

test('preserves all catalogue exceptions but returns only shared and selected-country limitations', async () => {
  const state = fixture();
  const exceptions = [
    'Source boundaries are preserved as published and do not establish legal sovereignty or political recognition.',
    'Structural coordinate checks do not establish OGC topology validity or spherical validity.',
    'The protected legacy Nigeria provider has no generated geometry in this directory.',
    ...Array.from({ length: 14 }, (_, index) => `country:unrelated-${index}: source code is ambiguous`),
  ].sort();
  const manifest = { ...state.compiled.manifest, exceptions };
  const manifestHash = sha(canonicalGameMapJson(manifest));
  const product = buildGameMapProduct({ source: manifest.source, sourceBytes: state.raw, atlasBytes: Buffer.from('synthetic atlas bytes'), atlasFeatureIds: state.catalogue.crosswalk.map(row => row.atlasFeatureId),
    directory: { manifest, manifestHash, nodes: state.compiled.inventory.nodes }, assets: new Map(state.compiled.assets.map(asset => [asset.relative, asset.body])) });
  const catalogue = await validateGameMapCatalogue(product.catalogue, { atlasSha256: product.catalogue.atlas.sha256, directoryManifestHash: manifestHash });
  assert.equal(catalogue.directory.manifest.exceptions.length, 17, 'the hashed catalogue retains the full source exception list');
  const entry = catalogue.entries.find(row => row.sourceIsoA2Eh === 'AA')!;
  const bundle = product.bundles.find(row => row.countryId === entry.countryId)!;
  const result = await verifyGameMapBundle(bundle.body, entry, catalogue);
  assert.ok(result.limitations.includes(exceptions[0]!));
  assert.ok(result.limitations.includes(exceptions[1]!));
  assert.ok(result.limitations.every(value => !value.startsWith('country:unrelated-') && !/Nigeria/i.test(value)));
  assert.ok(result.limitations.length <= 16);
});
