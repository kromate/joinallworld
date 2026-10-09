// Synthetic raw captures and disposable SQLite databases only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { CaptureExpectation } from './capture-binding.ts';
import { auditFeatureIndexConnection, type AuditCaptureInput } from './feature-index-audit.ts';
import {
  FeatureIndex, featureIndexObservationPin, type FeatureIndexLimits, type FeatureIndexObservation,
} from './feature-index.ts';
import { canonicalJson } from './pack.ts';
import type { AcquisitionRequest } from './production-types.ts';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const sourceBytes = readFileSync(new URL('./acquisition-sources.json', import.meta.url));
const sourceConfig = JSON.parse(sourceBytes.toString('utf8')) as {
  stac: { collections: Record<'buildings' | 'roads', { url: string }> }; attribution: Record<'buildings' | 'roads', string>;
};
const sourceConfiguration = { bytes: sourceBytes, pin: { sha256: digest(sourceBytes), bytes: sourceBytes.byteLength } };
const limits: FeatureIndexLimits = { databaseBytes: 4 * 1024 * 1024, captures: 100, occurrences: 1000, versions: 1000, observations: 100 };
const building = (id = 'fixture-building', color = 'blue', coordinates: unknown = [[[0, 0], [1, 0], [1, 1], [0, 0]]]) => ({
  type: 'Feature', id,
  properties: { building: true, sourceLayer: 'buildings', color },
  geometry: { type: 'Polygon', coordinates },
});
const context = (jobId: string): FeatureIndexObservation => ({
  campaignHash: digest('synthetic-campaign'), planHash: digest('synthetic-plan'), jobId,
  rootCellId: 'geo-grid-v1:l0:x162:y104', queryPath: '',
});

function capture(name: string, features: unknown[]): AuditCaptureInput {
  const request: AcquisitionRequest = {
    schemaVersion: 1, id: `audit-fixture-${name}`, inventoryUnitId: 'country:natural-earth:NE_ID%3A1159321243',
    provider: 'overture', release: '2026-09-23.1', layers: ['buildings'],
    region: { id: `audit-fixture-${name}`, parentId: 'country:natural-earth:NE_ID%3A1159321243',
      name: 'Synthetic audit fixture', kind: 'cell', countryCode: 'SN', timezone: null, bounds: [-17.48, 14.71, -17.47, 14.72] },
    limits: { networkBytes: 32_000_000, outputBytes: 10_000_000, features: 5000,
      durationMs: 600_000, memoryMb: 256, diskBytes: 128_000_000 },
  };
  const { limits: _limits, ...selection } = request;
  const requestHash = digest(canonicalJson({ compiler: 'world-source-compiler-v2', selection, sourceConfig }));
  const extractBytes = encode({ type: 'FeatureCollection', features, metadata: {
    provider: request.provider, release: request.release, requestHash, exceptions: [],
    stacIndex: { sha256: digest('[]'), itemCount: 640, selectedCount: features.length ? 1 : 0 },
  } });
  const receiptBytes = encode({ schemaVersion: 1, requestHash, selection, request,
    completedAt: '2026-10-08T00:00:00.000Z', inputSha256: digest(extractBytes), inputBytes: extractBytes.byteLength,
    metrics: { networkBytes: 0, outputBytes: extractBytes.byteLength, features: features.length, elapsedMs: 1 },
    upstream: [], exceptions: [], sources: request.layers.map(layer => ({
      id: `overture-${request.release}-${layer}`, release: request.release,
      url: sourceConfig.stac.collections[layer].url,
      attribution: sourceConfig.attribution[layer], license: 'ODbL-1.0', sha256: digest('[]'), bytes: 2,
    })),
  });
  return {
    extractBytes, receiptBytes, sourceConfiguration,
    expected: { requestHash, request, extract: { sha256: digest(extractBytes), bytes: extractBytes.byteLength },
      receipt: { sha256: digest(receiptBytes), bytes: receiptBytes.byteLength } } satisfies CaptureExpectation,
    requiredObservations: [], allowedObservationPins: [],
  };
}
function fixture(run: (file: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'world-feature-index-audit-'));
  const file = path.join(root, 'features.sqlite');
  const db = new DatabaseSync(file);
  try { run(file, db); } finally { try { db.close(); } catch { /* Fixture may close it before opening read-only. */ } finally { rmSync(root, { recursive: true, force: true }); } }
}
function sorted(...inputs: AuditCaptureInput[]): AuditCaptureInput[] {
  return inputs.sort((a, b) => a.expected.requestHash < b.expected.requestHash ? -1 : a.expected.requestHash > b.expected.requestHash ? 1 : 0);
}
function withContexts(input: AuditCaptureInput, required: FeatureIndexObservation[], allowed: FeatureIndexObservation[]): AuditCaptureInput {
  return { ...input, requiredObservations: required, allowedObservationPins: allowed.map(featureIndexObservationPin) };
}

test('empty initialized index audits only as the exact empty raw corpus', () => fixture((file, db) => {
  new FeatureIndex(db, limits);
  const reader = new DatabaseSync(file, { readOnly: true });
  try {
    assert.deepEqual(auditFeatureIndexConnection(reader, limits, []), {
      format: 'feature-index-raw-audit-v1', scope: 'raw-feature-conservation-and-required-observations',
      qualifications: { rawIndexConservation: 'complete', requiredObservations: 'complete' },
      counts: { captures: 0, rawFeatures: 0, admitted: 0, exceptions: 0, occurrences: 0, versions: 0, keys: 0,
        conflicts: 0, crossOwnerConflictKeys: 0, observations: 0, requiredObservations: 0 },
      dispositionsSha256: digest(''),
    });
  } finally { reader.close(); }
}));

test('streamed raw ordinals conserve duplicates and exceptions; required contexts exist and failed pins may be absent', () => fixture((file, db) => {
  const input = capture('duplicate-exception', [building(), building(), building('numeric-id' as unknown as string)]);
  // Numeric source IDs are deliberately invalid but preserve their raw ordinal.
  const raw = JSON.parse(Buffer.from(input.extractBytes).toString('utf8')) as { features: unknown[] };
  (raw.features[2] as { id: unknown }).id = 123;
  input.extractBytes = encode(raw);
  const receipt = JSON.parse(Buffer.from(input.receiptBytes).toString('utf8')) as { inputSha256: string; inputBytes: number; metrics: { outputBytes: number } };
  receipt.inputSha256 = digest(input.extractBytes); receipt.inputBytes = input.extractBytes.byteLength; receipt.metrics.outputBytes = input.extractBytes.byteLength;
  input.receiptBytes = encode(receipt);
  input.expected.extract = { sha256: digest(input.extractBytes), bytes: input.extractBytes.byteLength };
  input.expected.receipt = { sha256: digest(input.receiptBytes), bytes: input.receiptBytes.byteLength };
  const required = context('completed-job'), failed = context('failed-attempt'), replay = context('replay-job');
  const audited = withContexts(input, [required, replay], [required, failed, replay]);
  const index = new FeatureIndex(db, limits);
  index.ingest(input, required); index.ingest(input, replay);
  const reader = new DatabaseSync(file, { readOnly: true });
  try {
    const report = auditFeatureIndexConnection(reader, limits, [audited]);
    assert.equal(report.counts.rawFeatures, 3); assert.equal(report.counts.admitted, 2);
    assert.equal(report.counts.exceptions, 1); assert.equal(report.counts.occurrences, 3);
    assert.equal(report.counts.observations, 2); assert.equal(report.counts.requiredObservations, 2);
    assert.equal(report.counts.crossOwnerConflictKeys, 0);
  } finally { reader.close(); }
}));

test('cross-owner body versions and their conflict marker are conserved independently', () => fixture((file, db) => {
  const first = capture('owner-a', [building('same-source-id')]);
  const movedGeometry = [[[2, 2], [3, 2], [3, 3], [2, 2]]];
  const second = capture('owner-b', [building('same-source-id', 'red', movedGeometry)]);
  const inputs = sorted(first, second);
  const index = new FeatureIndex(db, limits); index.ingest(first); index.ingest(second);
  const reader = new DatabaseSync(file, { readOnly: true });
  try {
    const report = auditFeatureIndexConnection(reader, limits, inputs);
    assert.equal(report.counts.captures, 2); assert.equal(report.counts.versions, 2);
    assert.equal(report.counts.keys, 1); assert.equal(report.counts.conflicts, 1);
    assert.equal(report.counts.crossOwnerConflictKeys, 1);
  } finally { reader.close(); }
}));

test('cumulative raw ordinals exceeding the configured occurrence limit fail before ordinal comparison', () => fixture((file, db) => {
  const input = capture('cumulative-limit', [building(), building('second')]);
  new FeatureIndex(db, limits).ingest(input);
  db.prepare('DELETE FROM occurrences WHERE request_hash=? AND ordinal=1').run(input.expected.requestHash);
  const reader = new DatabaseSync(file, { readOnly: true });
  try {
    assert.throws(() => auditFeatureIndexConnection(reader, { ...limits, occurrences: 1 }, [input]), /Cumulative raw feature ordinals/);
  } finally { reader.close(); }
}));

test('a non-WAL index is refused rather than silently ignoring a copied WAL', () => fixture((file, db) => {
  const input = capture('journal-mode', [building()]);
  new FeatureIndex(db, limits).ingest(input);
  db.exec('PRAGMA journal_mode=DELETE');
  const reader = new DatabaseSync(file, { readOnly: true });
  try {
    assert.throws(() => auditFeatureIndexConnection(reader, limits, [input]), /WAL mode/);
  } finally { reader.close(); }
}));

test('a checkpointed WAL-mode private copy audits without changing its database bytes', () => fixture((file, db) => {
  const input = capture('checkpointed-copy', [building()]);
  new FeatureIndex(db, limits).ingest(input);
  db.close();
  assert.equal(existsSync(`${file}-wal`), false);
  const before = digest(readFileSync(file));
  const reader = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(auditFeatureIndexConnection(reader, limits, [input]).counts.rawFeatures, 1);
  } finally { reader.close(); }
  assert.equal(digest(readFileSync(file)), before);
}));

test('missing required observation and extra occurrence fail closed', () => {
  for (const corruption of ['required-observation', 'extra-occurrence'] as const) fixture((file, db) => {
    const input = capture(`damage-${corruption}`, [building()]);
    const required = context('completed-campaign-job');
    const audited = withContexts(input, [required], [required]);
    new FeatureIndex(db, limits).ingest(input, corruption === 'required-observation' ? undefined : required);
    if (corruption === 'extra-occurrence') db.prepare('INSERT INTO occurrences VALUES(?,?,?,?,?)')
      .run(input.expected.requestHash, 1, null, null, 'invalid-source-feature');
    const reader = new DatabaseSync(file, { readOnly: true });
    try { assert.throws(() => auditFeatureIndexConnection(reader, limits, [audited])); } finally { reader.close(); }
  });
});

test('extra orphaned version, key, or schema metadata is rejected', () => {
  for (const corruption of ['version', 'key', 'meta'] as const) fixture((file, db) => {
    const input = capture(`extra-${corruption}`, [building()]); new FeatureIndex(db, limits).ingest(input);
    if (corruption === 'version') {
      const row = db.prepare('SELECT key,body,owner,derived FROM versions').get()!;
      assert.ok(typeof row.key === 'string' && typeof row.owner === 'string' && typeof row.derived === 'string');
      db.prepare('INSERT INTO versions VALUES(?,?,?,?)').run(row.key, digest('extra-body'), row.owner, row.derived);
    } else if (corruption === 'key') {
      db.prepare('INSERT INTO feature_keys VALUES(?,?)').run(digest('extra-key'), canonicalJson({ extra: true }));
    } else db.prepare("UPDATE meta SET value='changed' WHERE key='identity'").run();
    const reader = new DatabaseSync(file, { readOnly: true });
    try { assert.throws(() => auditFeatureIndexConnection(reader, limits, [input])); } finally { reader.close(); }
  });
});
