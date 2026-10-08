import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { compileSettlementProduct } from './settlement-compile.ts';
import { SETTLEMENT_PRODUCT_LIMITS as LIMITS } from './settlement-product-types.ts';
import type { SettlementBuildInput } from './settlement-product-types.ts';
import type { InventoryNode } from './production-types.ts';

const PARENT_ID = 'synthetic-admin0-source';
const SOURCE_ID = 'synthetic-settlement-source';
const PARENT_HASH = 'f'.repeat(64);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function country(id: string, code: string, neId: number, provider: 'world' | 'legacy-ng' = 'world'): InventoryNode {
  return { id, parentId: 'continent:fixture', name: `Synthetic ${code}`, kind: 'country', countryCode: code === 'NGA' ? 'NG' : code === 'GHA' ? 'GH' : code === 'RWA' ? 'RW' : code === 'EMT' ? 'ET' : 'ZZ',
    bounds: null, sourceFeatureIds: [`${PARENT_ID}:NE_ID:${neId}`], provider, outline: provider === 'legacy-ng' ? 'missing' : 'available', exceptions: [] };
}
function parentFeature(neId: number, code: string): Record<string, unknown> {
  return { type: 'Feature', properties: { NE_ID: neId, ADM0_A3: code }, geometry: null };
}
function place(key: number | string, code: string, coordinates: unknown = [10, 20], labelPatch: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'Feature', properties: { NE_ID: key, ADM0_A3: code, NAME: 'Fixture settlement', NAMEASCII: 'Fixture settlement', FEATURECLA: 'Populated place', SCALERANK: 3, ISO_A3: 'ZZZ', ...labelPatch }, geometry: { type: 'Point', coordinates } };
}
function fixtureFeatures(): Record<string, unknown>[] {
  return [
    place(1, 'NGA'),
    place('69', 'GHA', [-180, 90], { NAME: ' Fixture settlement ' }), place(70, 'RWA', [180, -90]),
    place(71, 'XYZ'), place(72, 'SDS', [0, 0], { ISO_A3: 'RWA' }),
    place(73, 'GHA', [0, 0, 4]), place(74, 'GHA', [0, 0], { NAME: '' }),
  ];
}
function makeInput(features = fixtureFeatures(), options: { parentFeatures?: Record<string, unknown>[]; nodes?: InventoryNode[] } = {}): SettlementBuildInput {
  const parentFeatures = options.parentFeatures ?? [parentFeature(1, 'GHA'), parentFeature(2, 'RWA'), parentFeature(3, 'XYZ'), parentFeature(4, 'XYZ'), parentFeature(5, 'EMT'), parentFeature(6, 'NGA')];
  const nodes = options.nodes ?? [
    { id: 'world:earth', parentId: null, name: 'Synthetic world', kind: 'world', countryCode: null, bounds: null, sourceFeatureIds: [], provider: 'world', outline: 'missing', exceptions: [] },
    { id: 'continent:fixture', parentId: 'world:earth', name: 'Synthetic continent', kind: 'continent', countryCode: null, bounds: null, sourceFeatureIds: [], provider: 'world', outline: 'missing', exceptions: [] },
    country('country:fixture:ghana', 'GHA', 1), country('country:fixture:rwanda', 'RWA', 2),
    country('country:fixture:ambiguous-a', 'AAA', 3), country('country:fixture:ambiguous-b', 'AAB', 4),
    country('country:fixture:empty', 'EMT', 5), country('legacy-ng', 'NGA', 6, 'legacy-ng'),
  ];
  const parentRaw = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: parentFeatures }));
  const raw = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }));
  return {
    source: { id: SOURCE_ID, url: 'https://example.invalid/synthetic-places', release: 'fixture-release', license: 'Public-domain', attribution: 'SYNTHETIC FIXTURE ONLY', sha256: sha(raw), bytes: raw.length },
    raw,
    parent: { manifestHash: PARENT_HASH, source: { id: PARENT_ID, url: 'https://example.invalid/synthetic-admin0', release: 'fixture-release', license: 'Public-domain', attribution: 'SYNTHETIC FIXTURE ONLY', sha256: sha(parentRaw), bytes: parentRaw.length }, raw: parentRaw, nodes },
  };
}

test('compiles all source rows with literal exact joins, protected Nigeria, and sorted compact country assets', () => {
  const first = compileSettlementProduct(makeInput()), repeat = compileSettlementProduct(makeInput());
  assert.equal(first.manifest.sourceUnits, 7); assert.equal(first.manifest.protected, 1);
  assert.equal(first.manifest.linked, 4); assert.equal(first.manifest.ambiguous, 1); assert.equal(first.manifest.unlinked, 1);
  assert.equal(first.manifest.invalidRows, 2); assert.equal(first.manifest.validPoints, 6); assert.equal(first.manifest.emittedUnits, 2);
  assert.deepEqual(first.report.rows.map(row => row.sourceKey), [...first.report.rows.map(row => row.sourceKey)].sort());
  assert.equal(first.report.rows.find(row => row.sourceKey === 'NE_ID:69')?.sourceOrdinal, 1);
  assert.equal(first.report.rows.find(row => row.sourceKey === 'NE_ID:69')?.id, 'place:natural-earth:NE_ID%3A69');
  assert.deepEqual(first.manifest.countries.filter(row => row.status === 'available').map(row => row.countryId), ['country:fixture:ghana', 'country:fixture:rwanda']);
  assert.deepEqual(first.manifest.countries.find(row => row.countryId === 'legacy-ng'), { countryId: 'legacy-ng', status: 'protected', sourceUnits: 1, emittedUnits: 0, points: null });
  assert.deepEqual(first.report.missingCountries, ['country:fixture:ambiguous-a', 'country:fixture:ambiguous-b', 'country:fixture:empty']);
  assert.equal(first.manifest.exceptionUnits, first.manifest.sourceUnits - first.manifest.emittedUnits);
  assert.equal(first.assets.at(-1)?.relative, first.manifestPath);
  assert.equal(first.assets[0]?.relative, first.manifest.inspection.path);
  assert.equal(first.bytes, first.assets.reduce((total, asset) => total + asset.body.byteLength, 0));
  assert.equal(first.manifestHash, repeat.manifestHash);
  assert.deepEqual(first.assets.map(asset => [asset.relative, sha(asset.body)]), repeat.assets.map(asset => [asset.relative, sha(asset.body)]));
});

test('validates source and parent raw pins before compilation', () => {
  const input = makeInput();
  const wrongSource = structuredClone(input); wrongSource.raw[0] = wrongSource.raw[0]! ^ 1;
  assert.throws(() => compileSettlementProduct(wrongSource), /SHA-256 differs/);
  const wrongParent = structuredClone(input); wrongParent.parent.raw[0] = wrongParent.parent.raw[0]! ^ 1;
  assert.throws(() => compileSettlementProduct(wrongParent), /SHA-256 differs/);
  const wrongSize = structuredClone(input); wrongSize.source.bytes++;
  assert.throws(() => compileSettlementProduct(wrongSize), /byte count/);
  const invalidParentHash = structuredClone(input); invalidParentHash.parent.manifestHash = 'not-hash';
  assert.throws(() => compileSettlementProduct(invalidParentHash), /manifest hash/);
});

test('accepts a valid empty selected-place source and preserves country coverage refs', () => {
  const product = compileSettlementProduct(makeInput([]));
  assert.equal(product.report.sourceUnits, 0); assert.equal(product.report.validPoints, 0);
  assert.equal(product.manifest.emittedUnits, 0); assert.equal(product.manifest.exceptionUnits, 0);
  assert.deepEqual(product.manifest.countries.find(row => row.countryId === 'legacy-ng'), {
    countryId: 'legacy-ng', status: 'protected', sourceUnits: 0, emittedUnits: 0, points: null,
  });
  assert.equal(product.assets.every(asset => !asset.relative.startsWith('points/')), true);
});

test('rejects a parent country node combined across multiple raw features even when all rows are present', () => {
  const input = makeInput();
  const nodes = input.parent.nodes.map(node => node.id === 'country:fixture:ghana'
    ? { ...node, sourceFeatureIds: [...node.sourceFeatureIds, `${PARENT_ID}:NE_ID:7`] }
    : node);
  const parentFeatures = [
    parentFeature(1, 'GHA'), parentFeature(2, 'RWA'), parentFeature(3, 'XYZ'),
    parentFeature(4, 'XYZ'), parentFeature(5, 'EMT'), parentFeature(6, 'NGA'), parentFeature(7, 'GHA'),
  ];
  assert.throws(() => compileSettlementProduct(makeInput(fixtureFeatures(), { nodes, parentFeatures })), /exactly one raw source feature/);
});

test('source keys require canonical positive safe integers and duplicates fail globally', () => {
  for (const badKey of [0, -1, 1.5, '0', '01', '+1', '9007199254740992']) {
    const input = makeInput();
    const doc = JSON.parse(Buffer.from(input.raw).toString('utf8')) as { features: Array<Record<string, unknown>> };
    const props = doc.features[1]!.properties as Record<string, unknown>; props.NE_ID = badKey;
    input.raw = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: doc.features }));
    input.source.bytes = input.raw.length; input.source.sha256 = sha(input.raw);
    assert.throws(() => compileSettlementProduct(input), /canonical positive safe integer/);
  }
  const duplicate = fixtureFeatures(); duplicate[2] = { ...duplicate[2]!, properties: { ...(duplicate[2]!.properties as Record<string, unknown>), NE_ID: 69 } };
  assert.throws(() => compileSettlementProduct(makeInput(duplicate)), /duplicate settlement NE_ID/);
});

test('never falls back to names, ISO fields, casing, or parent country names', () => {
  const features = fixtureFeatures();
  features[4] = place(72, 'gha', [0, 0], { ISO_A3: 'GHA', NAME: 'Synthetic Ghana' });
  features[5] = place(73, 'SDS', [0, 0], { ISO_A3: 'RWA', NAME: 'Synthetic Rwanda' });
  const product = compileSettlementProduct(makeInput(features));
  assert.equal(product.report.rows.find(row => row.sourceKey === 'NE_ID:72')?.joinStatus, 'unlinked');
  assert.equal(product.report.rows.find(row => row.sourceKey === 'NE_ID:73')?.joinStatus, 'unlinked');
  assert.equal(product.report.rows.find(row => row.sourceKey === 'NE_ID:71')?.joinStatus, 'ambiguous');
});

test('records invalid geometry and labels as exceptions without coordinate substitution', () => {
  const product = compileSettlementProduct(makeInput());
  const invalidPoint = product.report.rows.find(row => row.sourceKey === 'NE_ID:73')!;
  const invalidLabel = product.report.rows.find(row => row.sourceKey === 'NE_ID:74')!;
  assert.equal(invalidPoint.joinStatus, 'linked'); assert.equal(invalidPoint.pointIssue, 'point-requires-two-finite-ordinates'); assert.equal(invalidPoint.emitted, false);
  assert.equal(invalidLabel.labelIssue, 'required-source-label-or-scale-rank-invalid'); assert.equal(invalidLabel.emitted, false);
  const ghanaRef = product.manifest.countries.find(row => row.countryId === 'country:fixture:ghana')!;
  const body = product.assets.find(asset => asset.relative === ghanaRef.points?.path)!.body;
  const country = JSON.parse(Buffer.from(body).toString('utf8')) as { rows: Array<{ sourceKey: string; coordinates: number[]; name: string }> };
  assert.deepEqual(country.rows.map(row => row.sourceKey), ['NE_ID:69']);
  assert.deepEqual(country.rows[0]?.coordinates, [-180, 90]);
  assert.equal(country.rows[0]?.name, ' Fixture settlement ');
});

test('NGA joins only the protected legacy node; no fixed current-snapshot count is imposed', () => {
  const input = makeInput();
  const product = compileSettlementProduct(input);
  assert.equal(product.report.rows.filter(row => row.adm0Code === 'NGA' && row.joinStatus === 'protected' && row.countryId === 'legacy-ng').length, 1);
  const noNigeriaPoints = compileSettlementProduct(makeInput(fixtureFeatures().slice(1)));
  assert.equal(noNigeriaPoints.report.protected, 0);
  assert.deepEqual(noNigeriaPoints.manifest.countries.find(row => row.countryId === 'legacy-ng'), { countryId: 'legacy-ng', status: 'protected', sourceUnits: 0, emittedUnits: 0, points: null });
  const badNodes = input.parent.nodes.map(node => node.id === 'legacy-ng' ? { ...node, provider: 'world' as const } : node);
  assert.throws(() => compileSettlementProduct(makeInput(fixtureFeatures(), { nodes: badNodes })), /legacy-ng protected/);
  const wrongParent = input.parent.raw as Buffer;
  const parentDoc = JSON.parse(wrongParent.toString('utf8')) as { features: Array<Record<string, unknown>> };
  parentDoc.features[5] = parentFeature(6, 'NGR');
  const badParentRaw = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: parentDoc.features }));
  const badInput = structuredClone(input); badInput.parent.raw = badParentRaw; badInput.parent.source.bytes = badParentRaw.length; badInput.parent.source.sha256 = sha(badParentRaw);
  assert.throws(() => compileSettlementProduct(badInput), /legacy-ng may only be referenced|NGA must resolve/);
});

test('preserves identical source names as distinct key-derived places', () => {
  const product = compileSettlementProduct(makeInput());
  const points = product.assets.filter(asset => asset.relative.startsWith('points/'));
  const rows = points.flatMap(asset => (JSON.parse(Buffer.from(asset.body).toString('utf8')) as { rows: Array<{ id: string; name: string }> }).rows);
  assert.equal(rows.filter(row => row.name === 'Fixture settlement' || row.name === ' Fixture settlement ').length, 2);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
});

test('rejects country route overflow rather than dropping selected places', () => {
  const features = fixtureFeatures();
  const longName = 'x'.repeat(LIMITS.textBytes);
  for (let index = 0; index < 1400; index++) features.push(place(1000 + index, 'GHA', [1, 1], { NAME: longName, NAMEASCII: longName }));
  assert.throws(() => compileSettlementProduct(makeInput(features)), /512,000-byte route ceiling/);
});

test('a code mapping to multiple distinct parent identities remains ambiguous', () => {
  const product = compileSettlementProduct(makeInput());
  const row = product.report.rows.find(entry => entry.sourceKey === 'NE_ID:71')!;
  assert.equal(row.joinStatus, 'ambiguous'); assert.equal(row.countryId, null); assert.equal(row.emitted, false);
});
