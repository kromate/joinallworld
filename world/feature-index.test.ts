// Synthetic captures and disposable databases only. No real cache/ledger/output/network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { FeatureIndex, type FeatureIndexLimits, type FeatureIndexCaptureInput, type FeatureIndexObservation } from './feature-index.ts';
import { canonicalJson } from './pack.ts';
import type { AcquisitionRequest } from './production-types.ts';

const sourceBytes = readFileSync(new URL('./acquisition-sources.json', import.meta.url));
const sourceConfig = JSON.parse(sourceBytes.toString('utf8')) as {
  stac: { collections: Record<'buildings' | 'roads', { url: string }> }; attribution: Record<'buildings' | 'roads', string>;
};
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const sourceConfiguration = { bytes: sourceBytes, pin: { bytes: 1297, sha256: '7ac2f2babcab7e4dd330a2f2e3476708129653022ba7bd0a94c9cbf69184656c' } };
const limits: FeatureIndexLimits = { databaseBytes: 4*1024*1024, captures: 100, occurrences: 1000, versions: 1000, observations: 100 };
const zero = { captures: 0, occurrences: 0, versions: 0, observations: 0, keys: 0, conflictedKeys: 0 };
const building = (id: unknown = 'fixture-1', color = 'blue') => ({ type: 'Feature', id,
  properties: { building: true, sourceLayer: 'buildings', color },
  geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } });
const context = (jobId = 'fixture-job'): FeatureIndexObservation => ({ campaignHash: sha('synthetic-campaign'),
  planHash: sha('synthetic-plan'), jobId, rootCellId: 'geo-grid-v1:l0:x162:y104', queryPath: '' });
function capture(name: string, features: unknown[]): FeatureIndexCaptureInput {
  const request: AcquisitionRequest = { schemaVersion: 1, id: `index-fixture-${name}`,
    inventoryUnitId: 'country:natural-earth:NE_ID%3A1159321243', provider: 'overture', release: '2026-09-23.1', layers: ['buildings'],
    region: { id: `index-fixture-${name}`, parentId: 'country:natural-earth:NE_ID%3A1159321243', name: 'Synthetic index fixture, not sourced geography',
      kind: 'cell', countryCode: 'SN', timezone: null, bounds: [-17.48,14.71,-17.47,14.72] },
    limits: { networkBytes: 32_000_000, outputBytes: 10_000_000, features: 5000, durationMs: 600_000, memoryMb: 256, diskBytes: 128_000_000 } };
  const { limits: _, ...selection } = request;
  const requestHash = sha(canonicalJson({ compiler: 'world-source-compiler-v2', selection, sourceConfig }));
  const extractBytes = encode({ type: 'FeatureCollection', features, metadata: {
    provider: request.provider, release: request.release, requestHash, exceptions: [],
    stacIndex: { sha256: sha('[]'), itemCount: 640, selectedCount: features.length ? 1 : 0 },
  } });
  const receiptBytes = encode({ schemaVersion: 1, requestHash, selection, request,
    completedAt: '2026-10-08T00:00:00.000Z', inputSha256: sha(extractBytes), inputBytes: extractBytes.byteLength,
    metrics: { networkBytes: 0, outputBytes: extractBytes.byteLength, features: features.length, elapsedMs: 1 },
    upstream: [], exceptions: [], sources: request.layers.map(layer => ({ id: `overture-${request.release}-${layer}`,
      release: request.release, url: sourceConfig.stac.collections[layer].url, attribution: sourceConfig.attribution[layer],
      license: 'ODbL-1.0', sha256: sha('[]'), bytes: 2 })),
  });
  return { extractBytes, receiptBytes, sourceConfiguration,
    expected: { requestHash, request, extract: { sha256: sha(extractBytes), bytes: extractBytes.byteLength }, receipt: { sha256: sha(receiptBytes), bytes: receiptBytes.byteLength } } };
}
function fixture(fn: (db: DatabaseSync, file: string) => void): void {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'allworld-feature-index-fixture-'));
  const file = path.join(root, 'features.sqlite'); const db = new DatabaseSync(file);
  try { fn(db, file); } finally { try { db.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
}

test('recognizes its exact schema and refuses another database without changing its settings/data', () => fixture(db => {
  db.exec("CREATE TABLE saves(id TEXT PRIMARY KEY); INSERT INTO saves VALUES('preserved');");
  const mode = db.prepare('PRAGMA journal_mode').get()!.journal_mode;
  assert.throws(() => new FeatureIndex(db, limits), /not an empty or recognized/);
  assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode, mode);
  assert.equal(db.prepare('SELECT id FROM saves').get()!.id, 'preserved');
}));
test('a foreign table resembling an internal SQLite name cannot bypass database admission', () => fixture(db => {
  db.exec("CREATE TABLE sqliteXforeign(id TEXT); INSERT INTO sqliteXforeign VALUES('preserved');");
  const mode = db.prepare('PRAGMA journal_mode').get()!.journal_mode;
  assert.throws(() => new FeatureIndex(db, limits), /not an empty or recognized/);
  assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode, mode);
  assert.equal(db.prepare('SELECT id FROM sqliteXforeign').get()!.id, 'preserved');
}));
test('creates a bounded file-backed format with actual durability/foreign keys and zero rows', () => fixture(db => {
  const index = new FeatureIndex(db, limits); assert.deepEqual(index.stats(), zero);
  assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA synchronous').get()!.synchronous, 2);
  assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1);
  assert.deepEqual(new FeatureIndex(db, limits).stats(), zero);
}));
test('conserves every ordinal including a duplicate and an unsupported numeric ID', () => fixture(db => {
  const index = new FeatureIndex(db, limits), input = capture('ordinals', [building(), building(), building(123)]);
  const result = index.ingest(input, context());
  assert.equal(result.features, 3); assert.equal(result.admitted, 2);
  assert.deepEqual(result.exceptions, { 'unsupported-id-representation': 1 }); assert.equal(result.insertedVersions, 1);
  assert.deepEqual(index.stats(), { captures: 1, occurrences: 3, versions: 1, observations: 1, keys: 1, conflictedKeys: 0 });
  const rows = index.ownerVersions('geo-grid-v1:l1:x360:y180', { limit: 1 });
  assert.equal(rows.length, 1); assert.equal(rows[0]!.conflicted, false);
  const identity = rows[0]!.identity, ref = index.sourceReference(identity.featureKeyHash, identity.bodyHash)!;
  assert.equal(ref.ordinal, 0); assert.equal(ref.requestHash, input.expected.requestHash);
  assert.equal(JSON.parse(ref.captureMetadata).features, 3);
  assert.equal(index.ownerVersions('geo-grid-v1:l1:x360:y180', { limit: 1, after: { key: identity.featureKeyHash, body: identity.bodyHash } }).length, 0);
}));
test('retains both complete-body versions and explicit conflict flags across overlapping requests', () => fixture(db => {
  const index = new FeatureIndex(db, limits);
  index.ingest(capture('first', [building()]));
  const second = index.ingest(capture('second', [building(), building('fixture-1', 'red')]));
  assert.equal(second.insertedVersions, 1);
  assert.deepEqual(index.stats(), { captures: 2, occurrences: 3, versions: 2, observations: 0, keys: 1, conflictedKeys: 1 });
  const rows = index.ownerVersions('geo-grid-v1:l1:x360:y180', { limit: 256 });
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.conflicted));
  assert.notEqual(rows[0]!.identity.bodyHash, rows[1]!.identity.bodyHash);
}));
test('verified replay leaves all counts/ordinals stable and adds distinct campaign observations only once', () => fixture(db => {
  const index = new FeatureIndex(db, limits), input = capture('replay', [building(), building(5)]);
  const first = index.ingest(input, context()), before = index.stats();
  const replay = index.ingest(input, context());
  assert.equal(replay.replayed, true); assert.equal(replay.insertedVersions, 0);
  assert.equal(replay.dispositionsHash, first.dispositionsHash); assert.deepEqual(index.stats(), before);
  index.ingest(input, context('other-job')); assert.equal(index.stats().observations, 2);
}));
test('zero-row synthetic capture commits its explicit empty denominator without inventing versions', () => fixture(db => {
  const index = new FeatureIndex(db, limits), result = index.ingest(capture('empty', []), context());
  assert.equal(result.dispositionsHash, sha('')); assert.equal(result.features, 0);
  assert.deepEqual(index.stats(), { ...zero, captures: 1, observations: 1 });
}));
test('changed pins for the same request roll back and poison that writer', () => fixture(db => {
  const index = new FeatureIndex(db, limits);
  index.ingest(capture('same-request', [building()])); const before = index.stats();
  assert.throws(() => index.ingest(capture('same-request', [building('fixture-1', 'changed')])), /altered capture/);
  assert.deepEqual(index.stats(), before);
  assert.throws(() => index.ingest(capture('other', [])), /must be reopened/);
}));
test('changed raw configuration pin cannot masquerade as an exact request/capture replay', () => fixture(db => {
  const index = new FeatureIndex(db, limits), input = capture('config', [building()]); index.ingest(input);
  const bytes = Buffer.concat([sourceBytes, Buffer.from('\n')]);
  assert.throws(() => index.ingest({ ...input, sourceConfiguration: { bytes, pin: { bytes: bytes.length, sha256: sha(bytes) } } }), /altered capture/);
}));
test('missing ordinal and contradictory derived metadata block replay without repairing silently', () => fixture(db => {
  const input = capture('damage', [building(), building()]); const index = new FeatureIndex(db, limits); index.ingest(input);
  db.prepare('DELETE FROM occurrences WHERE request_hash=? AND ordinal=1').run(input.expected.requestHash);
  assert.throws(() => index.ingest(input), /ordinal disposition/);
  assert.equal(index.stats().occurrences, 1);
}));
test('changed complete-body derived record is not accepted merely because hashes still match', () => fixture(db => {
  const input = capture('derived', [building()]), index = new FeatureIndex(db, limits); index.ingest(input);
  const row = db.prepare('SELECT derived FROM versions').get()!;
  const changed = JSON.parse(String(row.derived)); changed.positions++;
  db.prepare('UPDATE versions SET derived=?').run(canonicalJson(changed));
  assert.throws(() => index.ingest(input), /complete-body version/);
}));
test('missing conflict marker blocks both replay and owner paging', () => fixture(db => {
  const index = new FeatureIndex(db, limits), input = capture('conflict', [building(), building('fixture-1', 'red')]); index.ingest(input);
  db.exec('DELETE FROM conflicts');
  assert.throws(() => index.ownerVersions('geo-grid-v1:l1:x360:y180', { limit: 256 }), /conflict marker/);
  assert.throws(() => index.ingest(input), /conflict marker/);
}));
test('a new body cannot repair a missing conflict marker or conceal a spurious marker', () => {
  for (const damaged of ['missing', 'spurious']) fixture(db => {
    const index = new FeatureIndex(db, limits);
    index.ingest(capture('marker-baseline', damaged === 'missing'
      ? [building(), building('fixture-1', 'red')] : [building()]));
    if (damaged === 'missing') db.exec('DELETE FROM conflicts');
    else db.exec('INSERT INTO conflicts SELECT key FROM feature_keys');
    const before = index.stats();
    assert.throws(() => index.ingest(capture('marker-new-body', [building('fixture-1', 'green')])), /conflict marker/);
    assert.deepEqual(index.stats(), before);
  });
});
test('an orphan key is rejected before a new capture can recreate its missing version', () => fixture(db => {
  const index = new FeatureIndex(db, limits); index.ingest(capture('orphan-baseline', [building()]));
  db.exec('DELETE FROM occurrences; DELETE FROM versions;');
  const before = index.stats();
  assert.throws(() => index.ingest(capture('orphan-new', [building()])), /key\/version membership/);
  assert.deepEqual(index.stats(), before);
}));
test('owner paging checks the separate source-key tuple rather than trusting derived metadata alone', () => fixture(db => {
  const index = new FeatureIndex(db, limits); index.ingest(capture('tuple', [building()]));
  db.prepare('UPDATE feature_keys SET tuple=?').run(canonicalJson({ damaged: true }));
  assert.throws(() => index.ownerVersions('geo-grid-v1:l1:x360:y180', { limit: 1 }), /key\/body\/owner binding/);
}));
test('one source key with geometry in different owner cells flags every body and retains both references', () => fixture(db => {
  const moved = building(); moved.geometry.coordinates = [[[2,2],[3,2],[3,3],[2,2]]];
  const index = new FeatureIndex(db, limits);
  index.ingest(capture('owner-a', [building()])); index.ingest(capture('owner-b', [moved]));
  for (const cell of ['geo-grid-v1:l1:x360:y180', 'geo-grid-v1:l1:x364:y184']) {
    const rows = index.ownerVersions(cell, { limit: 1 });
    assert.equal(rows.length, 1); assert.equal(rows[0]!.conflicted, true);
    const identity = rows[0]!.identity;
    assert.ok(index.sourceReference(identity.featureKeyHash, identity.bodyHash));
  }
}));
test('same campaign/job cannot rebind to another capture and its entire new transaction rolls back', () => fixture(db => {
  const index = new FeatureIndex(db, limits); index.ingest(capture('job-a', [building()]), context());
  const before = index.stats();
  assert.throws(() => index.ingest(capture('job-b', [building('new-key')]), context()), /different plan\/query\/capture/);
  assert.deepEqual(index.stats(), before);
}));
test('row and version admission limits roll back the whole capture including newly inserted keys', () => {
  for (const smaller of [{ ...limits, occurrences: 1 }, { ...limits, versions: 1 }]) fixture(db => {
    const index = new FeatureIndex(db, smaller);
    assert.throws(() => index.ingest(capture('quota', [building('a'), building('b')])), /index bound/);
    assert.deepEqual(index.stats(), zero);
  });
});
test('capture and observation limits roll back complete new captures without changing the baseline', () => {
  for (const smaller of [{ ...limits, captures: 1 }, { ...limits, observations: 1 }]) fixture(db => {
    const index = new FeatureIndex(db, smaller);
    index.ingest(capture('quota-baseline', [building()]), context()); const before = index.stats();
    assert.throws(() => index.ingest(capture('quota-next', [building('next')]), context('next-job')), /index bound/);
    assert.deepEqual(index.stats(), before);
  });
});
test('existing index with an unexpected view is rejected instead of silently migrated', () => fixture(db => {
  new FeatureIndex(db, limits); db.exec('CREATE VIEW unexpected AS SELECT 1;');
  assert.throws(() => new FeatureIndex(db, limits), /unexpected schema/);
}));
test('a corrupt raw snapshot is rejected before any transaction writes', () => fixture(db => {
  const index = new FeatureIndex(db, limits), input = capture('bad-raw', [building()]);
  const bytes = Buffer.from(input.extractBytes); bytes[0] = 0x20;
  assert.throws(() => index.ingest({ ...input, extractBytes: bytes }), /SHA-256/);
  assert.deepEqual(index.stats(), zero);
}));
test('checkpoint blocked after commit retains durable state and requires actual same-version reopen/replay', () => fixture((db, file) => {
  const index = new FeatureIndex(db, limits); index.ingest(capture('baseline', [building('baseline')]));
  const reader = new DatabaseSync(file); const input = capture('post-commit', [building('after')]);
  try {
    reader.exec('BEGIN'); reader.prepare('SELECT COUNT(*) FROM captures').get();
    assert.throws(() => index.ingest(input, context()), /checkpoint did not complete/);
    assert.equal(index.stats().captures, 2); assert.equal(index.stats().versions, 2);
    assert.throws(() => index.ingest(input, context()), /must be reopened/);
  } finally { reader.exec('ROLLBACK'); reader.close(); }
  // Independent writer connection to the same file; the existing writer remains
  // open solely for fixture cleanup and is never used again after poisoning.
  const reopened = new DatabaseSync(file);
  try {
    const recovered = new FeatureIndex(reopened, limits), result = recovered.ingest(input, context());
    assert.equal(result.replayed, true); assert.equal(result.insertedVersions, 0);
    assert.equal(recovered.stats().captures, 2); assert.equal(recovered.stats().observations, 1);
  } finally { reopened.close(); }
}));
