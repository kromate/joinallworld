// Pinned cached Dakar captures -> disposable engine measurement. No durable store/ledger writes.
import assert from 'node:assert/strict';
import { mkdtemp, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { FeatureIndex, type FeatureIndexCaptureInput, type FeatureIndexCaptureResult } from '../feature-index.ts';
import { parseCaptureJson } from '../capture-json.ts';
import { readBoundedLocalFile } from '../inventory-reader.ts';
import { sha256 } from '../pack.ts';
import type { AcquisitionRequest } from '../production-types.ts';

interface Pin { path: string; bytes: number; sha256: string }
interface Product { parentInput: Pin; parentReceipt: Pin }
const root = fileURLToPath(new URL('../../', import.meta.url));
const pinBytes = await readBoundedLocalFile(path.join(root, 'world/regional-fanout.json'), 1_000_000);
const record = parseCaptureJson(pinBytes, { bytes: 1_000_000 }) as { products: Product[] };
assert.ok(Array.isArray(record.products) && record.products.length >= 2);
const sourceConfiguration = {
  bytes: await readBoundedLocalFile(path.join(root, 'world/acquisition-sources.json'), 64_000),
  pin: { bytes: 1297, sha256: '7ac2f2babcab7e4dd330a2f2e3476708129653022ba7bd0a94c9cbf69184656c' },
};
let aggregateInputBytes = 0;
async function readPin(pin: Pin, cap: number): Promise<Buffer> {
  assert.ok(Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= cap);
  assert.match(pin.path, /^\.cache\/world-build\/acquisitions\/[a-f0-9]{64}\/(extract\.geojson|receipt\.json)$/);
  assert.match(pin.sha256, /^[a-f0-9]{64}$/);
  aggregateInputBytes += pin.bytes; assert.ok(aggregateInputBytes <= 40_000_000);
  const bytes = await readBoundedLocalFile(path.resolve(root, pin.path), cap);
  assert.equal(bytes.byteLength, pin.bytes); assert.equal(sha256(bytes), pin.sha256);
  return bytes;
}
const inputs: FeatureIndexCaptureInput[] = [];
for (const product of record.products.slice(0, 2)) {
  const receiptBytes = await readPin(product.parentReceipt, 1_000_000);
  const extractBytes = await readPin(product.parentInput, 20_000_000);
  const requestHash = product.parentInput.path.match(/acquisitions\/([a-f0-9]{64})\/extract\.geojson$/)?.[1];
  assert.ok(requestHash && /^[a-f0-9]{64}$/.test(requestHash));
  assert.ok(product.parentReceipt.path.endsWith('/' + requestHash + '/receipt.json'));
  const receipt = parseCaptureJson(receiptBytes, { bytes: 1_000_000 }) as { request: AcquisitionRequest };
  inputs.push({ extractBytes, receiptBytes, sourceConfiguration,
    expected: { requestHash, request: receipt.request,
      extract: { sha256: product.parentInput.sha256, bytes: product.parentInput.bytes },
      receipt: { sha256: product.parentReceipt.sha256, bytes: product.parentReceipt.bytes } } });
}
const temporary = await mkdtemp(path.join(tmpdir(), 'allworld-index-capacity-'));
const file = path.join(temporary, 'features.sqlite');
const limits = { databaseBytes: 4 * 1024 * 1024, captures: 4, occurrences: 5000, versions: 5000, observations: 4 };
let db: DatabaseSync | undefined;
async function size(fileName: string, optional = false): Promise<number> {
  try {
    const info = await lstat(fileName); assert.ok(info.isFile() && !info.isSymbolicLink());
    assert.ok(Number.isSafeInteger(info.size) && info.size >= 0); return info.size;
  } catch (error) {
    if (optional && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
}
const physical = async () => ({ databaseBytes: await size(file), walBytes: await size(file + '-wal', true), sharedMemoryBytes: await size(file + '-shm', true) });
const began = performance.now();
try {
  db = new DatabaseSync(file); const sqliteVersion = db.prepare('SELECT sqlite_version() version').get()!.version;
  let index = new FeatureIndex(db, limits);
  const captures: Array<FeatureIndexCaptureResult & { ingestMs: number; physical: Awaited<ReturnType<typeof physical>> }> = [];
  for (const input of inputs) {
    const start = performance.now(); const result = index.ingest(input);
    const measured = await physical(); assert.equal(measured.walBytes, 0);
    captures.push({ ...result, ingestMs: performance.now() - start, physical: measured });
  }
  const expectedStats = { captures: 2, occurrences: 2283, versions: 1810, observations: 0, keys: 1810, conflictedKeys: 0 };
  assert.deepEqual(index.stats(), expectedStats);
  assert.deepEqual(captures.map(capture => capture.features), [473, 1810]);
  assert.ok(captures.every(capture => capture.admitted === capture.features && Object.keys(capture.exceptions).length === 0));
  const firstPhysical = await physical();
  db.close(); db = undefined;
  db = new DatabaseSync(file); index = new FeatureIndex(db, limits);
  assert.equal(db.prepare('SELECT sqlite_version() version').get()!.version, sqliteVersion);
  const replays = inputs.map(input => index.ingest(input));
  assert.ok(replays.every(result => result.replayed && result.insertedVersions === 0));
  assert.deepEqual(index.stats(), expectedStats);
  assert.deepEqual(replays.map(result => result.dispositionsHash), captures.map(result => result.dispositionsHash));
  assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  const checkpointed = await physical(); assert.equal(checkpointed.walBytes, 0);
  const sourceHashes: Record<string, string> = {};
  for (const name of ['feature-index.ts', 'capture-binding.ts', 'capture-json.ts', 'capture-request.ts', 'feature-identity.ts', 'tooling/profile_feature_index.ts']) {
    sourceHashes[name] = sha256(await readBoundedLocalFile(path.join(root, 'world', name), 1_000_000));
  }
  console.log(JSON.stringify({ scope: 'disposable complete-feature engine, cached raw replay; not durable campaign/coverage acceptance',
    nodeVersion: process.version, sqliteVersion, networkBytes: 0, sourceHashes,
    sourcePinsSha256: sha256(pinBytes), sourceConfigurationPin: sourceConfiguration.pin,
    aggregateInputBytes, limits, captures, replays, stats: expectedStats,
    duplicateOrdinals: 473, firstPhysical, checkpointed,
    elapsedMs: performance.now() - began, maximumRssKiB: process.resourceUsage().maxRSS,
    limitations: ['Two cached captures do not certify maximum capacity or global throughput.',
      'Same-version close/reopen replay is not abrupt crash acceptance.',
      'No guarded durable opener, ledger completion, independent raw audit or country coverage.'] }, null, 2));
} finally {
  try { db?.close(); } finally { await rm(temporary, { recursive: true, force: true }); }
}
