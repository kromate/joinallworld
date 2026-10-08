import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { InventoryNode } from './production-types.ts';
import type { FineIdentityMigration, FineIdentityRegistry, FineSourcePin, FineTopologyReport } from './fine-types.ts';
import { buildFineInventory, publishFineInventory, validateFineSourcePin } from './fine.ts';
import { FINE_PLANAR_EXCEPTION } from './fine-quality.ts';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}
const country: InventoryNode = { id: 'country:natural-earth:fixture-rw', parentId: 'continent:africa', name: 'Rwanda', kind: 'country', countryCode: 'RW', bounds: [28, -3, 31, -1], sourceFeatureIds: ['ne:fixture'], provider: 'world', outline: 'available', exceptions: [] };
const polygon = (west = 29, south = -2, east = 30, north = -1) => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
type FeatureInput = { key?: string; name?: string; group?: string; shapeType?: string; geometry?: unknown };

function sourceFixture(features: FeatureInput[] = [{ key: 'RWA-ADM1-a', name: 'North', geometry: polygon() }], expectedUnits = features.length) {
  const document: Record<string, unknown> = { type: 'FeatureCollection', features: features.map(feature => ({ type: 'Feature', properties: {
    shapeID: feature.key ?? 'RWA-ADM1-a', shapeName: feature.name ?? 'North', shapeGroup: feature.group ?? 'RWA', shapeType: feature.shapeType ?? 'ADM1',
  }, geometry: feature.geometry ?? polygon() })) };
  const raw = Buffer.from(JSON.stringify(document));
  const release = 'a'.repeat(40);
  const url = `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`;
  const layerId = 'RWA-ADM1-test-layer';
  const pin: FineSourcePin = { schemaVersion: 1, provider: 'geoBoundaries', source: {
    id: `geoboundaries:RWA:ADM1:${layerId}`, url, release, license: 'CC-BY-4.0', attribution: 'Synthetic unit-test source only', sha256: hash(raw), bytes: raw.length,
  }, input: `.cache/world-build/fine-source-cache/${hash(raw)}.geojson`, countryCode: 'RW', countryIso3: 'RWA', adminLevel: 'ADM1', layerId, canonicalType: 'Province',
  representedYear: '2021', buildDate: '2026-10-08', expectedUnits, originalLicense: 'CC BY 4.0',
  licenseEvidence: ['https://example.invalid/metadata', 'synthetic test fixture; no real source claim'],
  metadataSha256: 'b'.repeat(64), metadataBytes: 128,
  boundaryPolicy: 'Synthetic fixture depicting a source-described administrative boundary; not a legal sovereignty assertion.' };
  return { raw, pin, document };
}
const generatedId = (countryId: string, key: string) => `admin:geoBoundaries:${hash(`${countryId}\0ADM1\0geoBoundaries\0${key}`)}`;
function syntheticTopology(pin: FineSourcePin, keys: string[], status: 'valid' | 'invalid' | 'unsupported' = 'valid'): FineTopologyReport {
  const rows = [...keys].sort().map(featureKey => status === 'valid'
    ? { featureKey, status, valid: true, empty: false, reason: null }
    : status === 'invalid' ? { featureKey, status, valid: false, empty: false, reason: 'Synthetic invalid topology fixture.' }
      : { featureKey, status, valid: null, empty: null, reason: 'Synthetic unsupported topology fixture.' });
  const validUnits = status === 'valid' ? keys.length : 0;
  const invalidUnits = status === 'invalid' ? keys.length : 0;
  const unsupportedUnits = status === 'unsupported' ? keys.length : 0;
  return { schemaVersion: 1, validator: 'duckdb-spatial-ogc-planar-v1', sourceSha256: pin.source.sha256, sourceBytes: pin.source.bytes,
    expectedUnits: pin.expectedUnits, checkedUnits: validUnits + invalidUnits, validUnits, invalidUnits, unsupportedUnits,
    tooling: { duckdbVersion: '1.5.6', spatialVersion: '04270fe', spatialSha256: 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9' }, rows,
    exceptions: [FINE_PLANAR_EXCEPTION, ...(unsupportedUnits ? ['Polar, global-span, or ambiguous longitude geometries are reported unsupported, not valid.'] : [])] };
}
function build(featureInputs: FeatureInput[], options: { previousRegistry?: FineIdentityRegistry; migration?: FineIdentityMigration; topologyReport?: FineTopologyReport } = {}) {
  const fixture = sourceFixture(featureInputs);
  const features = fixture.document.features as Array<{ properties: { shapeID: string } }>;
  const keys = features.map(feature => feature.properties.shapeID);
  return { fixture, inventory: buildFineInventory(fixture.pin, fixture.raw, country, 'c'.repeat(64), { ...options, topologyReport: options.topologyReport ?? syntheticTopology(fixture.pin, keys) }) };
}

test('source pin requires immutable raw/media URL, full commit, exact hash/length and license evidence', () => {
  const { pin } = sourceFixture();
  assert.equal(validateFineSourcePin(pin), pin);
  assert.throws(() => validateFineSourcePin({ ...pin, source: { ...pin.source, release: '9469f09' } }), /full 40-hex/);
  assert.throws(() => validateFineSourcePin({ ...pin, source: { ...pin.source, url: 'https://api.geoboundaries.org/current/RWA/ADM1' }, input: 'https://api.geoboundaries.org/current/RWA/ADM1' }), /exact commit-pinned/);
  assert.throws(() => validateFineSourcePin({ ...pin, licenseEvidence: [] }), /licenseEvidence/);
  assert.throws(() => validateFineSourcePin({ ...pin, metadataBytes: 65 * 1024 }), /64 KiB/);
  assert.throws(() => validateFineSourcePin({ ...pin, countryCode: 'NG', countryIso3: 'NGA' }), /Nigeria/);
});

test('initial IDs are deterministic across feature reorder and source-release changes', () => {
  const rows = [{ key: 'RWA-ADM1-a', name: 'North', geometry: polygon() }, { key: 'RWA-ADM1-b', name: 'South', geometry: polygon(28.5, -2.5, 29.5, -2) }];
  const first = build(rows).inventory;
  const reordered = build([...rows].reverse()).inventory;
  assert.deepEqual(first.nodes.map(node => node.id), reordered.nodes.map(node => node.id));
  assert.deepEqual(first.outlines, reordered.outlines);
  assert.equal(first.nodes.find(node => node.sourceRef.featureKey === 'RWA-ADM1-a')!.id, generatedId(country.id, 'RWA-ADM1-a'));
  const next = sourceFixture(rows);
  const nextRelease = 'd'.repeat(40);
  next.pin.source.release = nextRelease;
  next.pin.source.url = `https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${nextRelease}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`;
  const refreshed = buildFineInventory(next.pin, next.raw, country, 'd'.repeat(64), { previousRegistry: first.registry,
    topologyReport: syntheticTopology(next.pin, rows.map(feature => feature.key!)) });
  assert.deepEqual(refreshed.nodes.map(node => node.id), first.nodes.map(node => node.id));
});

test('a same-key rename retains identity and adds the prior name as an alias', () => {
  const first = build([{ key: 'rwa-1', name: 'Old name', geometry: polygon() }]).inventory;
  const renamed = build([{ key: 'rwa-1', name: 'New name', geometry: polygon() }], { previousRegistry: first.registry }).inventory;
  assert.equal(renamed.nodes[0]!.id, first.nodes[0]!.id);
  assert.deepEqual(renamed.nodes[0]!.aliases, ['Old name']);
  assert.deepEqual(renamed.registry.entries.find(entry => entry.id === renamed.nodes[0]!.id)!.names, ['Old name', 'New name']);
});

test('changed provider key requires assignment; split and merge migrations retire old IDs to active replacements', () => {
  const first = build([{ key: 'old-key', name: 'Former unit', geometry: polygon() }]).inventory;
  assert.throws(() => build([{ key: 'new-key', name: 'Renamed unit', geometry: polygon() }], { previousRegistry: first.registry }), /explicit migration/);
  const renamed = build([{ key: 'new-key', name: 'Renamed unit', geometry: polygon() }], {
    previousRegistry: first.registry, migration: { assignments: { 'new-key': first.nodes[0]!.id }, retirements: [] },
  }).inventory;
  assert.equal(renamed.nodes[0]!.id, first.nodes[0]!.id);
  assert.deepEqual(renamed.nodes[0]!.aliases, ['Former unit']);

  const splitSource = build([{ key: 'unit-a', name: 'Unit A', geometry: polygon() }]).inventory;
  const splitRows = [{ key: 'unit-a-n', name: 'Unit A North', geometry: polygon() }, { key: 'unit-a-s', name: 'Unit A South', geometry: polygon(29, -2.5, 30, -1.5) }];
  const splitNorth = generatedId(country.id, 'unit-a-n'), splitSouth = generatedId(country.id, 'unit-a-s');
  const split = build(splitRows, { previousRegistry: splitSource.registry, migration: {
    assignments: { 'unit-a-n': splitNorth, 'unit-a-s': splitSouth }, retirements: [{ id: splitSource.nodes[0]!.id, replacedBy: [splitNorth, splitSouth] }],
  } }).inventory;
  assert.equal(split.registry.entries.find(entry => entry.id === splitSource.nodes[0]!.id)!.status, 'retired');
  assert.deepEqual(split.registry.entries.find(entry => entry.id === splitSource.nodes[0]!.id)!.replacedBy, [splitNorth, splitSouth]);
  assert.throws(() => build([{ key: 'unit-a', name: 'Former unit', geometry: polygon() }], { previousRegistry: split.registry,
    migration: { assignments: {}, retirements: [] } }), /retired fine identity cannot be resurrected/);

  const mergeSource = build([{ key: 'left', name: 'Left', geometry: polygon() }, { key: 'right', name: 'Right', geometry: polygon(30, -2, 31, -1) }]).inventory;
  const mergedKey = 'merged', mergedId = generatedId(country.id, mergedKey);
  const merged = build([{ key: mergedKey, name: 'Merged', geometry: polygon() }], { previousRegistry: mergeSource.registry, migration: {
    assignments: { [mergedKey]: mergedId }, retirements: mergeSource.nodes.map(node => ({ id: node.id, replacedBy: [mergedId] })),
  } }).inventory;
  assert.equal(merged.registry.entries.filter(entry => entry.status === 'retired').length, 2);
  assert.equal(merged.registry.entries.find(entry => entry.id === mergedId)!.status, 'active');
});

test('identity migrations reject unused assignments, unexpected retirements, dangling history and replacement cycles', () => {
  const first = build([{ key: 'keep', name: 'Keep', geometry: polygon() }]).inventory;
  const extraId = generatedId(country.id, 'extra');
  assert.throws(() => build([{ key: 'keep', name: 'Keep', geometry: polygon() }], {
    previousRegistry: first.registry, migration: { assignments: { extra: extraId }, retirements: [] },
  }), /unused or duplicates/);
  assert.throws(() => build([{ key: 'keep', name: 'Keep', geometry: polygon() }], {
    previousRegistry: first.registry, migration: { assignments: {}, retirements: [{ id: first.nodes[0]!.id, replacedBy: [first.nodes[0]!.id] }] },
  }), /unmatched active identity|current active replacement/);

  const dangling = structuredClone(first.registry);
  dangling.entries[0]!.status = 'retired';
  dangling.entries[0]!.replacedBy = [extraId];
  assert.throws(() => build([{ key: 'new', name: 'New', geometry: polygon() }], {
    previousRegistry: dangling, migration: { assignments: { new: generatedId(country.id, 'new') }, retirements: [] },
  }), /unknown retained ID/);

  const left = generatedId(country.id, 'left'), right = generatedId(country.id, 'right');
  const cyclic: FineIdentityRegistry = { schemaVersion: 1, provider: 'geoBoundaries', countryId: country.id, adminLevel: 'ADM1', entries: [
    { id: left, sourceFeatureKeys: ['left-old'], names: ['Left'], status: 'retired', replacedBy: [right] },
    { id: right, sourceFeatureKeys: ['right-old'], names: ['Right'], status: 'retired', replacedBy: [left] },
  ] };
  assert.throws(() => build([{ key: 'fresh', name: 'Fresh', geometry: polygon() }], {
    previousRegistry: cyclic, migration: { assignments: { fresh: generatedId(country.id, 'fresh') }, retirements: [] },
  }), /replacement chain contains a cycle/);
});

test('coarse hierarchy input requires the matching world provider and unique source feature IDs', () => {
  const fixture = sourceFixture();
  assert.throws(() => buildFineInventory(fixture.pin, fixture.raw, { ...country, provider: 'legacy-ng' }, 'c'.repeat(64)), /matching existing world-provider/);
  assert.throws(() => buildFineInventory(fixture.pin, fixture.raw, { ...country, sourceFeatureIds: ['same', 'same'] }, 'c'.repeat(64)), /source feature IDs.*unique/);
});

test('fine compilation requires matching all-valid topology evidence for exact source keys', () => {
  const fixture = sourceFixture();
  assert.throws(() => buildFineInventory(fixture.pin, fixture.raw, country, 'c'.repeat(64)), /topology report is required/);
  const correct = syntheticTopology(fixture.pin, ['RWA-ADM1-a']);
  assert.throws(() => buildFineInventory(fixture.pin, fixture.raw, country, 'c'.repeat(64), {
    topologyReport: { ...correct, sourceSha256: '0'.repeat(64) },
  }), /does not match its pinned source/);
  assert.throws(() => buildFineInventory(fixture.pin, fixture.raw, country, 'c'.repeat(64), {
    topologyReport: { ...correct, sourceBytes: correct.sourceBytes + 1 },
  }), /does not match its pinned source/);
  assert.throws(() => buildFineInventory(fixture.pin, fixture.raw, country, 'c'.repeat(64), {
    topologyReport: syntheticTopology(fixture.pin, ['different-source-key']),
  }), /feature keys are not exact/);
  assert.throws(() => build([{ key: 'invalid', name: 'Invalid' }], {
    topologyReport: syntheticTopology(sourceFixture([{ key: 'invalid', name: 'Invalid' }]).pin, ['invalid'], 'invalid'),
  }), /every expected source unit valid/);
  const unsupportedFixture = sourceFixture([{ key: 'unsupported', name: 'Unsupported' }]);
  assert.throws(() => build([{ key: 'unsupported', name: 'Unsupported' }], {
    topologyReport: syntheticTopology(unsupportedFixture.pin, ['unsupported'], 'unsupported'),
  }), /every expected source unit valid/);
});

test('only the exact CRS84 declaration is accepted when a GeoJSON CRS is present', () => {
  const exact = sourceFixture();
  exact.document.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } };
  exact.raw = Buffer.from(JSON.stringify(exact.document));
  exact.pin.source.bytes = exact.raw.length; exact.pin.source.sha256 = hash(exact.raw);
  exact.pin.input = `.cache/world-build/fine-source-cache/${hash(exact.raw)}.geojson`;
  assert.equal(buildFineInventory(exact.pin, exact.raw, country, 'c'.repeat(64), { topologyReport: syntheticTopology(exact.pin, ['RWA-ADM1-a']) }).nodes.length, 1);

  const rejected = [
    { type: 'name', properties: { name: 'EPSG:4326' } },
    { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } },
    { type: 'name', properties: { name: 'URN:OGC:DEF:CRS:OGC:1.3:CRS84' } },
    { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84', axisOrder: 'lat-lon' } },
    { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' }, extra: true },
  ];
  for (const crs of rejected) {
    const fixture = sourceFixture();
    fixture.document.crs = crs;
    fixture.raw = Buffer.from(JSON.stringify(fixture.document));
    fixture.pin.source.bytes = fixture.raw.length; fixture.pin.source.sha256 = hash(fixture.raw);
    fixture.pin.input = `.cache/world-build/fine-source-cache/${hash(fixture.raw)}.geojson`;
    assert.throws(() => buildFineInventory(fixture.pin, fixture.raw, country, 'c'.repeat(64)), /CRS/);
  }
});

test('rejects source tampering, count mismatch, duplicate or mismatched keys, malformed CRS and invalid geometry', () => {
  const fixture = sourceFixture();
  const wrongBytes = Buffer.from(fixture.raw); wrongBytes[wrongBytes.length - 2] = wrongBytes[wrongBytes.length - 2]! ^ 1;
  assert.throws(() => buildFineInventory(fixture.pin, wrongBytes, country, 'c'.repeat(64)), /pinned length and SHA/);
  assert.throws(() => buildFineInventory({ ...fixture.pin, expectedUnits: 2 }, fixture.raw, country, 'c'.repeat(64)), /count differs/);
  assert.throws(() => build([{ key: 'dup', geometry: polygon() }, { key: 'dup', geometry: polygon() }]), /duplicate fine source feature key/);
  assert.throws(() => build([{ key: 'bad-group', group: 'GHA', geometry: polygon() }]), /shapeGroup/);
  assert.throws(() => build([{ key: 'bad-level', shapeType: 'ADM2', geometry: polygon() }]), /shapeType/);
  const unclosed = polygon() as { type: string; coordinates: number[][][] };
  unclosed.coordinates[0]![4] = [29, -1.5];
  assert.throws(() => build([{ key: 'unclosed', geometry: unclosed }]), /closed/);
  const invalidCrs = sourceFixture();
  invalidCrs.document.crs = { type: 'name', properties: { name: 'EPSG:3857' } };
  invalidCrs.raw = Buffer.from(JSON.stringify(invalidCrs.document));
  invalidCrs.pin.source.bytes = invalidCrs.raw.length; invalidCrs.pin.source.sha256 = hash(invalidCrs.raw);
  invalidCrs.pin.input = `.cache/world-build/fine-source-cache/${hash(invalidCrs.raw)}.geojson`;
  assert.throws(() => buildFineInventory(invalidCrs.pin, invalidCrs.raw, country, 'c'.repeat(64)), /WGS84/);
  assert.throws(() => buildFineInventory(fixture.pin, fixture.raw, { ...country, id: 'legacy-ng', countryCode: 'NG' }, 'c'.repeat(64)), /protected/);
});

test('dateline and pole bounds are represented without dropping geometry', () => {
  const dateline = build([{ key: 'dateline', geometry: { type: 'Polygon', coordinates: [[[179, 1], [-179, 1], [-179, 2], [179, 2], [179, 1]]] } }]).inventory;
  assert.deepEqual(dateline.nodes[0]!.bounds, [179, 1, -179, 2]);
  const polar = build([{ key: 'polar', geometry: { type: 'Polygon', coordinates: [[[-120, 89], [0, 90], [120, 89], [-120, 89]]] } }]).inventory;
  assert.deepEqual(polar.nodes[0]!.bounds, [-180, 89, 180, 90]);
});

test('enforces per-feature and whole-inventory coordinate-position budgets', () => {
  const longRing = (count: number, offset: number) => {
    const ring: number[][] = [[offset, 0], [offset + 1, 0], [offset + 1, 1]];
    for (let i = ring.length; i < count - 1; i++) ring.push([offset, 1]);
    ring.push([offset, 0]);
    return ring;
  };
  const tooLargeFeature = { type: 'Polygon', coordinates: [longRing(40_001, 1)] };
  assert.throws(() => build([{ key: 'large', geometry: tooLargeFeature }]), /40,000 coordinate positions/);
  const rows = Array.from({ length: 4 }, (_, i) => ({ key: `global-${i}`, geometry: { type: 'Polygon', coordinates: [longRing(38_001, i * 2)] } }));
  assert.throws(() => build(rows), /150,000 coordinate positions/);
  assert.throws(() => validateFineSourcePin({ ...sourceFixture().pin, source: { ...sourceFixture().pin.source, bytes: 8 * 1024 * 1024 + 1 } }), /8 MiB/);
});

test('publisher writes deterministic immutable assets and manifest last within its byte cap', async () => {
  const { fixture, inventory } = build([{ key: 'publish', name: 'Publish', geometry: polygon() }]);
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-publish-'));
  try {
    const allowed = path.join(temp, 'build'); await mkdir(allowed);
    const first = await publishFineInventory(inventory, path.join(allowed, 'fine-a'), allowed, fixture.raw);
    const second = await publishFineInventory(inventory, path.join(allowed, 'fine-b'), allowed, fixture.raw);
    assert.equal(first.manifestHash, second.manifestHash);
    assert.equal(first.bytes, second.bytes);
    const manifest = JSON.parse(await readFile(first.manifestPath, 'utf8')) as { nodeIndexPath: string; registryPath: string; coveragePath: string; topologyPath: string; compiler: string; schemaVersion: number };
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.compiler, 'fine-inventory-compiler-v2');
    for (const relative of [manifest.nodeIndexPath, manifest.registryPath, manifest.coveragePath]) {
      const digest = path.basename(relative, '.json');
      assert.match(digest, /^[a-f0-9]{64}$/);
      assert.equal(hash(await readFile(path.join(path.dirname(first.manifestPath), '..', relative))), digest);
    }
    const topologyBytes = await readFile(path.join(path.dirname(first.manifestPath), '..', manifest.topologyPath));
    assert.equal(topologyBytes.at(-1), 10);
    assert.equal(hash(topologyBytes), path.basename(manifest.topologyPath, '.json'));
    assert.deepEqual(topologyBytes, Buffer.from(`${canonical(inventory.topology)}\n`));
    assert.equal((await lstat(first.manifestPath)).isFile(), true);
    assert.equal(first.units, 1);

    const oversized = structuredClone(inventory);
    const names: string[] = [];
    for (let j = 0; j < 220; j++) names.push(`${j}-${'n'.repeat(240)}`);
    const retired = Array.from({ length: 340 }, (_, i) => ({
      id: `admin:geoBoundaries:${hash(`retired-${i}`)}`, sourceFeatureKeys: [`retired-key-${i}`], names, status: 'retired' as const, replacedBy: [],
    }));
    oversized.registry.entries.push(...retired);
    const output = path.join(allowed, 'too-large');
    await assert.rejects(publishFineInventory(oversized, output, allowed, fixture.raw), /128 KiB/);
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('publisher rejects forged counts, bounds, duplicate current keys and malformed text before creating output', async () => {
  const { fixture, inventory } = build([
    { key: 'publish-a', name: 'A', geometry: polygon() },
    { key: 'publish-b', name: 'B', geometry: polygon(30, -2, 31, -1) },
  ]);
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-forgery-'));
  try {
    const allowed = path.join(temp, 'build'); await mkdir(allowed);
    const mutations: Array<[string, (value: typeof inventory) => void, RegExp]> = [
      ['count', value => { value.coverage.coordinatePositions++; }, /coordinate count/],
      ['bounds', value => { value.nodes[0]!.bounds[0] += 0.25; }, /bounds do not match/],
      ['key', value => { value.nodes[1]!.sourceRef.featureKey = value.nodes[0]!.sourceRef.featureKey; }, /source feature keys are duplicated/],
      ['alias', value => { value.nodes[0]!.aliases = ['bad\u0001alias']; }, /aliases are invalid/],
      ['exception', value => { value.coverage.exceptions.push('bad\u0001exception'); }, /coverage conservation/],
      ['topology source', value => { value.topology.sourceSha256 = '0'.repeat(64); }, /does not match its pinned source/],
      ['topology key', value => { value.topology.rows[0]!.featureKey = 'wrong-key'; }, /feature keys are not exact/],
      ['topology invalid', value => { value.topology.rows = value.topology.rows.map(row => ({ featureKey: row.featureKey, status: 'invalid', valid: false, empty: false, reason: 'forged invalid' })); value.topology.validUnits = 0; value.topology.invalidUnits = 2; value.topology.checkedUnits = 2; }, /all-valid source-bound topology evidence/],
    ];
    for (const [name, mutate, expected] of mutations) {
      const forged = structuredClone(inventory); mutate(forged);
      const output = path.join(allowed, `forged-${name}`);
      await assert.rejects(publishFineInventory(forged, output, allowed, fixture.raw), expected);
      await assert.rejects(lstat(output), { code: 'ENOENT' });
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('publisher refuses symlinked allowed-root ancestors before writing', async () => {
  const { fixture, inventory } = build([{ key: 'symlink', name: 'Symlink test', geometry: polygon() }]);
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-symlink-'));
  try {
    const realAllowed = path.join(temp, 'real-build'); await mkdir(realAllowed);
    const linkedAllowed = path.join(temp, 'linked-build'); await symlink(realAllowed, linkedAllowed, 'dir');
    const output = path.join(linkedAllowed, 'fine');
    await assert.rejects(publishFineInventory(inventory, output, linkedAllowed, fixture.raw), /allowedRoot ancestor contains a symlink/);
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('publisher binds outline geometry and source bytes to the topology-checked source before creating output', async () => {
  const { fixture, inventory } = build([{ key: 'fidelity', name: 'Fidelity', geometry: polygon() }]);
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-source-fidelity-'));
  try {
    const allowed = path.join(temp, 'build'); await mkdir(allowed);
    const forged = structuredClone(inventory);
    const ring = forged.outlines[0]!.geometry.coordinates as number[][][];
    ring[0]![1]![0] = 29.75; // Interior vertex change preserves the original bounds and position count.
    const output = path.join(allowed, 'mutated-outline');
    await assert.rejects(publishFineInventory(forged, output, allowed, fixture.raw), /outline geometry differs from pinned source feature/);
    await assert.rejects(lstat(output), { code: 'ENOENT' });

    const wrongBytes = Buffer.from(fixture.raw), mutateAt = wrongBytes.length - 2; wrongBytes[mutateAt] = wrongBytes[mutateAt]! ^ 1;
    const wrongSourceOutput = path.join(allowed, 'wrong-source');
    await assert.rejects(publishFineInventory(inventory, wrongSourceOutput, allowed, wrongBytes), /source bytes do not match pinned length and SHA-256/);
    await assert.rejects(lstat(wrongSourceOutput), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});
