import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256 } from './pack.ts';
import type { FeatureIndexCaptureInput } from './feature-index-session.ts';
import { parseFeatureIndexSessionLine, validateFeatureIndexSessionDone, validateFeatureIndexSessionReady,
  validateFeatureIndexSessionResult, prepareFeatureIndexSessionConfiguration } from './feature-index-session.ts';

const hash = 'a'.repeat(64);
const indexHash = 'b'.repeat(64);

test('session line parser accepts a bounded frame and rejects duplicate keys, non-finite numbers, truncation, and oversize', () => {
  assert.deepEqual(parseFeatureIndexSessionLine(Buffer.from('{"format":"ready","count":2}\n')),
    { format: 'ready', count: 2 });
  assert.throws(() => parseFeatureIndexSessionLine(Buffer.from('{"format":"ready","format":"bad"}\n')), /duplicate/i);
  assert.throws(() => parseFeatureIndexSessionLine(Buffer.from('{"count":NaN}\n')), /invalid value|nonfinite/i);
  assert.throws(() => parseFeatureIndexSessionLine(Buffer.from('{"format":"ready"}')), /newline/i);
  assert.throws(() => parseFeatureIndexSessionLine(Buffer.from(`${' '.repeat(128_000)}\n`)), RangeError);
});

test('ready frame pins every admission identity field and rejects altered root/hash fields', () => {
  const frame = { format: 'feature-index-session-ready-v1', indexHash,
    admission: { indexHash, reservedBytes: 64 * 1024 * 1024, replayed: true,
      rootDevice: 1, rootInode: 2, lockDevice: 1, lockInode: 3 } };
  assert.deepEqual(validateFeatureIndexSessionReady(frame, indexHash, 64 * 1024 * 1024),
    { indexHash, admission: frame.admission });
  assert.throws(() => validateFeatureIndexSessionReady({ ...frame, indexHash: hash }, indexHash, 64 * 1024 * 1024), /identity/i);
  assert.throws(() => validateFeatureIndexSessionReady({ ...frame, admission: { ...frame.admission, rootInode: 0 } }, indexHash, 64 * 1024 * 1024), /integer/i);
  assert.throws(() => validateFeatureIndexSessionReady({ ...frame, extra: true }, indexHash, 64 * 1024 * 1024), /fields/i);
});

test('done frame is fenced to the exact number of sequential capture replies', () => {
  const done = { format: 'feature-index-session-done-v1', indexHash, captures: 2 };
  assert.deepEqual(validateFeatureIndexSessionDone(done, indexHash, 2), { indexHash, captures: 2 });
  assert.throws(() => validateFeatureIndexSessionDone({ ...done, captures: 1 }, indexHash, 2), /counters/i);
  assert.throws(() => validateFeatureIndexSessionDone({ ...done, indexHash: hash }, indexHash, 2), /counters/i);
  assert.throws(() => validateFeatureIndexSessionDone({ ...done, duplicate: true }, indexHash, 2), /fields/i);
});

test('capture result rejects stale, duplicate, out-of-order, and error-shaped frames before report acceptance', () => {
  const input: FeatureIndexCaptureInput = { extractPath: '/captures/extract.geojson', receiptPath: '/captures/receipt.json', observation: null,
    expected: { requestHash: hash, request: { schemaVersion: 1, id: 'fixture', inventoryUnitId: 'country:fixture',
      region: { id: 'fixture', parentId: null, name: 'Fixture', kind: 'country', countryCode: 'SN', timezone: null, bounds: [0, 0, 1, 1] },
      provider: 'overture', release: '2026-09-23.1', layers: ['buildings'],
      limits: { networkBytes: 100, outputBytes: 1000, features: 10, durationMs: 1000, memoryMb: 64, diskBytes: 1000 } },
      extract: { sha256: hash, bytes: 1 }, receipt: { sha256: hash, bytes: 1 } } };
  const binding = {} as never;
  const limits = {} as never;
  assert.throws(() => validateFeatureIndexSessionResult({ format: 'feature-index-session-result-v1', id: 2,
    indexHash, report: {} }, 1, indexHash, input, binding, limits), /ordering|identity/i);
  assert.throws(() => validateFeatureIndexSessionResult({ format: 'feature-index-session-result-v1', id: 1,
    indexHash: hash, report: {} }, 1, indexHash, input, binding, limits), /ordering|identity/i);
  assert.throws(() => validateFeatureIndexSessionResult({ format: 'feature-index-session-result-v1', id: 1,
    indexHash, error: 'ordinary worker failure' }, 1, indexHash, input, binding, limits), /fields/i);
  assert.throws(() => validateFeatureIndexSessionResult({ format: 'feature-index-session-result-v1', id: 1,
    indexHash, report: {}, extra: true }, 1, indexHash, input, binding, limits), /fields/i);
});

test('prepared session configuration freezes binding identity and returns defensive byte copies without filesystem checks', () => {
  const sourceConfiguration = Buffer.from('{"source":1}');
  const manifest = Buffer.from(canonicalJson({ format: 'feature-index-tooling-inputs-v1', files: {
    'world/tooling/index_admission.py': { sha256: hash, bytes: 1 },
  } }));
  const binding = Buffer.from(canonicalJson({ format: 'feature-index-binding-v1', engineVersion: 'complete-feature-index-v1',
    identityVersion: 'overture-complete-feature-owner-v1', captureVersion: 'overture-pinned-capture-v1', sourceCompiler: 'world-source-compiler-v2',
    source: { provider: 'overture', release: '2026-09-23.1', layers: ['buildings'],
      configuration: { sha256: sha256(sourceConfiguration), bytes: sourceConfiguration.byteLength } },
    toolingManifest: { sha256: sha256(manifest), bytes: manifest.byteLength },
    runtime: { nodeVersion: 'v22.14.0', sqliteVersion: '3.49.0', nodeSha256: hash, nodeBytes: 1 },
    engineLimits: { databaseBytes: 8 * 1024 * 1024, captures: 4096, occurrences: 250_000, versions: 100_000, observations: 16_384 },
    processLimits: { fileBytes: 8 * 1024 * 1024, cpuSeconds: 30, wallSeconds: 30, heapMiB: 256, rssBytes: 256 * 1024 * 1024 },
    reservedBytes: 64 * 1024 * 1024,
  }));
  const config = { pythonExecutable: '/opt/python/bin/python3',
    pythonRuntime: { pythonVersion: '3.13.0', sqliteVersion: '3.49.0', pythonBytes: 1, pythonSha256: hash },
    nodeExecutable: '/opt/node/bin/node', namespaceRoot: '/private/index', aggregateBytes: 32 * 1024 * 1024,
    repositoryRoot: '/workspace/repo', manifestBytes: manifest, sourceConfiguration, bindingBytes: binding };

  const prepared = prepareFeatureIndexSessionConfiguration(config);
  const pinnedHash = sha256(binding);
  assert.equal(prepared.indexHash, pinnedHash);
  const invalidProvider = JSON.parse(binding.toString('utf8')) as Record<string, unknown>;
  (invalidProvider.source as Record<string, unknown>).provider = 'fixture';
  assert.throws(() => prepareFeatureIndexSessionConfiguration({ ...config, bindingBytes: Buffer.from(canonicalJson(invalidProvider)) }), /provider/i);
  const invalidLimits = JSON.parse(binding.toString('utf8')) as Record<string, unknown>;
  (invalidLimits.processLimits as Record<string, unknown>).fileBytes = 64 * 1024 * 1024;
  assert.throws(() => prepareFeatureIndexSessionConfiguration({ ...config, bindingBytes: Buffer.from(canonicalJson(invalidLimits)) }), /reservation|contradictory/i);
  binding[0] = binding[0]! ^ 1;
  manifest[0] = manifest[0]! ^ 1;
  sourceConfiguration[0] = sourceConfiguration[0]! ^ 1;
  assert.equal(prepared.indexHash, pinnedHash);
  assert.equal(sha256(prepared.bindingBytes), pinnedHash);
  const exposed = prepared.bindingBytes;
  exposed[0] = exposed[0]! ^ 1;
  assert.equal(sha256(prepared.bindingBytes), pinnedHash);
  assert.equal(prepareFeatureIndexSessionConfiguration(prepared), prepared);
  assert.equal(prepared.pythonExecutable, config.pythonExecutable);
});
