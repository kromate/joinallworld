// Read-only pinned sources -> disposable capacity experiment. Not the durable index/hook.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { identifySourceFeature } from '../feature-identity.ts';
import { bindConfiguredCapture } from '../capture-binding.ts';
import { parseCaptureJson } from '../capture-json.ts';
import { readBoundedLocalFile } from '../inventory-reader.ts';
import { canonicalJson, sha256 } from '../pack.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pinRecord = await readBoundedLocalFile(path.join(root, 'world/regional-fanout.json'), 1_000_000);
const pins = JSON.parse(pinRecord.toString('utf8')).products.slice(0, 2);
assert.equal(pins.length, 2);
const sourceConfigurationPin = { bytes: 1297, sha256: '7ac2f2babcab7e4dd330a2f2e3476708129653022ba7bd0a94c9cbf69184656c' };
const sourceConfigurationBytes = await readBoundedLocalFile(path.join(root, 'world/acquisition-sources.json'), 64_000);
const temp = await mkdtemp(path.join(tmpdir(), 'allworld-feature-capacity-'));
const dbPath = path.join(temp, 'experiment.sqlite');
let db;
const began = performance.now();
const captures = [], exceptions = {}, maximum = { bodyBytes: 0, compactVersionBytes: 0, positions: 0 };
let aggregateBytes = 0, observations = 0, admitted = 0, canonicalBodyBytes = 0;
const bytes = async (file, allowMissing = false) => {
  try {
    const info = await lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'measurement requires a regular file');
    assert.ok(Number.isSafeInteger(info.size) && info.size >= 0);
    return info.size;
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return 0;
    throw error;
  }
};
const physical = async () => ({ databaseBytes: await bytes(dbPath), walBytes: await bytes(dbPath + '-wal', true), sharedMemoryBytes: await bytes(dbPath + '-shm', true) });
try {
  db = new DatabaseSync(dbPath);
  const journalMode = db.prepare('PRAGMA journal_mode=WAL').get();
  assert.equal(journalMode.journal_mode, 'wal');
  db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
  assert.match(sqliteVersion, /^\d+\.\d+\.\d+$/);
  db.exec(`CREATE TABLE captures(request TEXT PRIMARY KEY, capture TEXT NOT NULL,
      sourceConfiguration TEXT NOT NULL, inputHash TEXT NOT NULL, inputBytes INTEGER NOT NULL,
      receiptHash TEXT NOT NULL, receiptBytes INTEGER NOT NULL, rows INTEGER NOT NULL CHECK(rows>=0));
    CREATE TABLE versions(key TEXT NOT NULL, body TEXT NOT NULL, tuple TEXT NOT NULL,
      owner TEXT NOT NULL, anchor TEXT NOT NULL, bodyBytes INTEGER NOT NULL, positions INTEGER NOT NULL,
      PRIMARY KEY(key, body));
    CREATE TABLE dispositions(request TEXT NOT NULL REFERENCES captures(request), ordinal INTEGER NOT NULL CHECK(ordinal>=0),
      key TEXT, body TEXT, exception TEXT, PRIMARY KEY(request, ordinal),
      FOREIGN KEY(key,body) REFERENCES versions(key,body),
      CHECK((key IS NOT NULL AND body IS NOT NULL AND exception IS NULL)
        OR (key IS NULL AND body IS NULL AND exception IS NOT NULL)));`);
  const insert = db.prepare('INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?,?,?)');
  const observe = db.prepare('INSERT INTO dispositions VALUES(?,?,?,?,?)');
  const captureRecord = db.prepare('INSERT INTO captures VALUES(?,?,?,?,?,?,?,?)');
  for (const pin of pins) {
    async function readPin(ref, cap) {
      assert.ok(Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= cap);
      assert.match(ref.path, /^\.cache\/world-build\/acquisitions\/[a-f0-9]{64}\/(extract\.geojson|receipt\.json)$/);
      const data = await readBoundedLocalFile(path.resolve(root, ref.path), cap);
      assert.equal(data.byteLength, ref.bytes); assert.equal(sha256(data), ref.sha256);
      aggregateBytes += data.byteLength; assert.ok(aggregateBytes <= 40_000_000);
      return data;
    }
    const receiptBytes = await readPin(pin.parentReceipt, 1_000_000);
    const extractBytes = await readPin(pin.parentInput, 20_000_000);
    const receipt = parseCaptureJson(receiptBytes, { bytes: 1_000_000 });
    const requestHash = pin.parentInput.path.match(/acquisitions\/([a-f0-9]{64})\/extract\.geojson$/)?.[1];
    assert.match(requestHash, /^[a-f0-9]{64}$/);
    assert.ok(pin.parentReceipt.path.endsWith('/' + requestHash + '/receipt.json'));
    const capture = bindConfiguredCapture(extractBytes, receiptBytes, {
      requestHash, request: receipt.request,
      extract: { sha256: pin.parentInput.sha256, bytes: pin.parentInput.bytes },
      receipt: { sha256: pin.parentReceipt.sha256, bytes: pin.parentReceipt.bytes },
    }, { bytes: sourceConfigurationBytes, pin: sourceConfigurationPin });
    // Exact receipt hashes come from the already accepted regional-fanout record.
    // This experiment does not replace independent request/source/index verification.
    const start = performance.now();
    let captureExceptions = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      captureRecord.run(capture.requestHash, capture.captureHash, capture.sourceConfiguration.sha256,
        capture.extract.sha256, capture.extract.bytes, capture.receipt.sha256, capture.receipt.bytes, capture.features.length);
      for (const [ordinal, feature] of capture.features.entries()) {
        observations++;
        const result = identifySourceFeature(feature, capture.binding);
        if (result.status === 'exception') {
          exceptions[result.code] = (exceptions[result.code] ?? 0) + 1;
          observe.run(capture.requestHash, ordinal, null, null, result.code);
          captureExceptions++; continue;
        }
        admitted++; canonicalBodyBytes += result.bodyBytes;
        const compact = canonicalJson(result);
        maximum.bodyBytes = Math.max(maximum.bodyBytes, result.bodyBytes);
        maximum.compactVersionBytes = Math.max(maximum.compactVersionBytes, Buffer.byteLength(compact));
        maximum.positions = Math.max(maximum.positions, result.positions);
        insert.run(result.featureKeyHash, result.bodyHash, canonicalJson(result.tuple),
          result.ownerCellId, canonicalJson(result.ownerAnchor), result.bodyBytes, result.positions);
        observe.run(capture.requestHash, ordinal, result.featureKeyHash, result.bodyHash, null);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    captures.push({ requestHash: capture.requestHash, captureHash: capture.captureHash, inputHash: pin.parentInput.sha256,
      receiptHash: pin.parentReceipt.sha256, rows: capture.features.length,
      exceptions: captureExceptions, transactionMs: performance.now() - start,
      ...await physical() });
  }
  const count = sql => Number(db.prepare(sql).get().n);
  const uniqueVersions = count('SELECT COUNT(*) n FROM versions');
  const uniqueKeys = count('SELECT COUNT(DISTINCT key) n FROM versions');
  const conflictedKeys = count('SELECT COUNT(*) n FROM (SELECT key FROM versions GROUP BY key HAVING COUNT(*)>1)');
  assert.equal(admitted, count('SELECT COUNT(*) n FROM dispositions WHERE exception IS NULL'));
  assert.equal(observations, count('SELECT COUNT(*) n FROM dispositions'));
  assert.equal(observations, admitted + Object.values(exceptions).reduce((a, b) => a + b, 0));
  for (const capture of captures) {
    const row = db.prepare('SELECT COUNT(*) n, MIN(ordinal) first, MAX(ordinal) last FROM dispositions WHERE request=?').get(capture.requestHash);
    assert.equal(Number(row.n), capture.rows);
    assert.equal(row.first, capture.rows ? 0 : null); assert.equal(row.last, capture.rows ? capture.rows - 1 : null);
  }
  const preCheckpoint = await physical();
  const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  assert.equal(checkpoint.busy, 0, 'blocked checkpoint is not accepted as a completed truncate');
  assert.equal(checkpoint.log, 0); assert.equal(checkpoint.checkpointed, 0);
  const checkpointed = await physical();
  assert.equal(checkpointed.walBytes, 0);
  console.log(JSON.stringify({ scope: 'temporary SQLite capacity experiment; not durable index/coverage acceptance',
    nodeVersion: process.version, sqliteVersion, journalMode: journalMode.journal_mode, synchronous: 2, foreignKeys: true,
    networkBytes: 0, sourcePins: 'world/regional-fanout.json/products/0,1',
    sourcePinsSha256: sha256(pinRecord), sourceConfigurationPin,
    identityCodeSha256: sha256(await readFile(path.join(root, 'world/feature-identity.ts'))),
    captureBindingCodeSha256: sha256(await readFile(path.join(root, 'world/capture-binding.ts'))),
    captureJsonCodeSha256: sha256(await readFile(path.join(root, 'world/capture-json.ts'))),
    captureRequestCodeSha256: sha256(await readFile(path.join(root, 'world/capture-request.ts'))), captures,
    observations, admitted, exceptions, uniqueKeys, uniqueVersions,
    duplicateVersionObservations: admitted - uniqueVersions, conflictedKeys,
    maximum, canonicalBodyBytes, aggregateBytes, preCheckpoint, checkpoint, checkpointed,
    elapsedMs: performance.now() - began, maximumRssKiB: process.resourceUsage().maxRSS,
    limitations: ['Hash-pinned cached captures only; no source-wide/country coverage claim.',
      'Prototype schema and physical sizes do not freeze final store/WAL/lifetime quotas.',
      'No campaign hook, crash recovery, corruption test or independent durable-index verifier.'] }, null, 2));
} finally {
  db?.close(); await rm(temp, { recursive: true, force: true });
}
