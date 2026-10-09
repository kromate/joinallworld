import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { canonicalJson, sha256 } from './pack.ts';
import { featureIndexObservationPin } from './feature-index.ts';
import type { FeatureIndexCaptureInput, FeatureIndexSessionAuditInput } from './feature-index-session.ts';
import { parseFeatureIndexSessionLine, validateFeatureIndexSessionDone, validateFeatureIndexSessionReady,
  validateFeatureIndexSessionResult, prepareFeatureIndexSessionConfiguration, prepareFeatureIndexSessionAudit,
  validateFeatureIndexSessionAuditResult, parseOwnedPythonRssSample,
  prepareFeatureIndexShardBinding, validateFeatureIndexShardBinding,
  isExactEmptyOwnedPythonRssResult, isZeroOwnedPythonRssCandidate,
  isOwnedPythonZeroRssResult,
  confirmOwnedPythonCloseAfterEmptyRssSample } from './feature-index-session.ts';
import { assertValidatedFeatureIndexAuditProof, featureIndexAuditWorkerDigest } from './feature-index-session.ts';

const hash = 'a'.repeat(64);
const indexHash = 'b'.repeat(64);
const staticV1Binding = Buffer.from([
  '{"captureVersion":"overture-pinned-capture-v1","engineLimits":{"captures":8,"databaseBytes":4194304,',
  '"observations":16,"occurrences":4000,"versions":3000},"engineVersion":"complete-feature-index-v1",',
  '"format":"feature-index-binding-v1","identityVersion":"overture-complete-feature-owner-v1",',
  '"processLimits":{"cpuSeconds":10,"fileBytes":4194304,"heapMiB":256,"rssBytes":402653184,"wallSeconds":15},',
  '"reservedBytes":33554432,"runtime":{"nodeBytes":167772160,"nodeSha256":"', 'd'.repeat(64),
  '","nodeVersion":"v22.19.0","sqliteVersion":"3.50.4"},"source":{"configuration":{"bytes":1297,"sha256":"',
  'a'.repeat(64), '"},"layers":["buildings","roads"],"provider":"overture","release":"2026-01-21.0"},',
  '"sourceCompiler":"world-source-compiler-v2","toolingManifest":{"bytes":2000,"sha256":"', 'b'.repeat(64), '"}}',
].join(''), 'ascii');
const staticShardPins = () => ({ planHash: 'c'.repeat(64), shardId: 'd'.repeat(64), membershipHash: 'e'.repeat(64),
  baseIndexBindingHash: sha256(staticV1Binding) });

test('owned Python RSS parser accepts only a bounded one-row sample and permits zero only for zombie state', () => {
  assert.equal(parseOwnedPythonRssSample('1234 S\n'), 1234);
  assert.equal(parseOwnedPythonRssSample('0 Z+'), 0);
  assert.equal(parseOwnedPythonRssSample('0 Zs+\n'), 0);
  assert.throws(() => parseOwnedPythonRssSample('0 S'), /zombie/i);
  assert.equal(isZeroOwnedPythonRssCandidate('0 Rs '), true);
  assert.equal(isZeroOwnedPythonRssCandidate('0 Z'), false);
  assert.equal(isZeroOwnedPythonRssCandidate('1 Rs'), false);
  assert.equal(isZeroOwnedPythonRssCandidate('0 ?'), false);
  assert.equal(isZeroOwnedPythonRssCandidate(`${'0'.repeat(257)} R`), false);
  assert.equal(isOwnedPythonZeroRssResult(null, '0 Rs ', ''), true);
  assert.equal(isOwnedPythonZeroRssResult({ code: 2, signal: null }, '0 Rs ', ''), false);
  assert.equal(isOwnedPythonZeroRssResult({ code: 1, signal: 'SIGKILL' }, '0 Rs ', ''), false);
  assert.equal(isOwnedPythonZeroRssResult({ code: 1, signal: null, killed: true }, '0 Rs ', ''), false);
  assert.equal(isOwnedPythonZeroRssResult(null, '0 Rs ', 'ps warning'), false);
  assert.equal(isOwnedPythonZeroRssResult(null, '1 Rs ', ''), false);
  assert.throws(() => parseOwnedPythonRssSample('-1 Z'), /malformed/i);
  assert.throws(() => parseOwnedPythonRssSample('9007199254740992 R'), /integer bound/i);
  assert.throws(() => parseOwnedPythonRssSample('12 R\n13 S\n'), /one process row/i);
  assert.throws(() => parseOwnedPythonRssSample(''), /malformed/i);
  assert.throws(() => parseOwnedPythonRssSample('   '), /malformed/i);
  assert.throws(() => parseOwnedPythonRssSample('12 ?'), /malformed/i);
  assert.throws(() => parseOwnedPythonRssSample('0 Zgarbage'), /malformed/i);
  assert.throws(() => parseOwnedPythonRssSample('12 R0'), /malformed/i);
  assert.throws(() => parseOwnedPythonRssSample(`${'9'.repeat(257)} Z`), /output bound/i);
});

test('only exact empty ps output with success or native exit one is a missing-row candidate', () => {
  assert.equal(isExactEmptyOwnedPythonRssResult(null, '', ''), true);
  assert.equal(isExactEmptyOwnedPythonRssResult({ code: 1, signal: null }, '', ''), true);
  assert.equal(isExactEmptyOwnedPythonRssResult({ code: 2, signal: null }, '', ''), false);
  assert.equal(isExactEmptyOwnedPythonRssResult({ code: 1, signal: 'SIGKILL' }, '', ''), false);
  assert.equal(isExactEmptyOwnedPythonRssResult({ code: 1, signal: null, killed: true }, '', ''), false);
  assert.equal(isExactEmptyOwnedPythonRssResult(null, ' ', ''), false);
  assert.equal(isExactEmptyOwnedPythonRssResult(null, '', 'ps warning'), false);
});

function fakeOwnedChild() {
  const events = new EventEmitter();
  const stdout = Object.assign(new EventEmitter(), { closed: false });
  const stderr = Object.assign(new EventEmitter(), { closed: false });
  const stdin = Object.assign(new EventEmitter(), { destroyed: false });
  const state = { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null };
  Object.defineProperties(events, {
    pid: { value: 4321, enumerable: true },
    exitCode: { get: () => state.exitCode, enumerable: true },
    signalCode: { get: () => state.signalCode, enumerable: true },
    stdout: { value: stdout, enumerable: true }, stderr: { value: stderr, enumerable: true }, stdin: { value: stdin, enumerable: true },
  });
  const child = events as never;
  let closedAt: number | undefined;
  return {
    child,
    closedAt: () => closedAt,
    close(code: number | null, signal: NodeJS.Signals | null = null, closePipes = true) {
      state.exitCode = code; state.signalCode = signal;
      if (closePipes) { stdout.closed = true; stderr.closed = true; stdin.destroyed = true; }
      closedAt = Date.now(); events.emit('close', code, signal);
    },
  };
}

test('empty RSS row waits for owned ChildProcess close and rejects a child that never closes within the original sample deadline', async () => {
  const delayed = fakeOwnedChild();
  const started = Date.now();
  assert.equal(isZeroOwnedPythonRssCandidate('0 Rs '), true);
  assert.throws(() => parseOwnedPythonRssSample('0 Rs '), /zombie/i);
  setTimeout(() => delayed.close(0), 20);
  await confirmOwnedPythonCloseAfterEmptyRssSample(delayed.child, started, delayed.closedAt);

  const interrupted = fakeOwnedChild();
  const interruptedStarted = Date.now();
  interrupted.close(1);
  await confirmOwnedPythonCloseAfterEmptyRssSample(interrupted.child, interruptedStarted, interrupted.closedAt);

  for (const [code, signal, closePipes, expected] of [
    [2, null, true, /normal or interrupted terminal/i],
    [null, 'SIGTERM', true, /normal or interrupted terminal/i],
    [0, null, false, /normal or interrupted terminal/i],
  ] as const) {
    const invalid = fakeOwnedChild();
    const invalidStarted = Date.now();
    setTimeout(() => invalid.close(code, signal, closePipes), 1);
    await assert.rejects(confirmOwnedPythonCloseAfterEmptyRssSample(invalid.child, invalidStarted, invalid.closedAt), expected);
  }

  const late = fakeOwnedChild();
  const lateStarted = Date.now() - 1001;
  late.close(0);
  await assert.rejects(confirmOwnedPythonCloseAfterEmptyRssSample(late.child, lateStarted, late.closedAt), /sample deadline/i);

  const noTimestamp = fakeOwnedChild();
  const noTimestampStarted = Date.now();
  setTimeout(() => noTimestamp.close(0), 1);
  await assert.rejects(confirmOwnedPythonCloseAfterEmptyRssSample(noTimestamp.child, noTimestampStarted), /timestamp/i);

  const never = fakeOwnedChild();
  const keeper = setTimeout(() => {}, 100);
  try {
    await assert.rejects(confirmOwnedPythonCloseAfterEmptyRssSample(never.child, Date.now() - 990, never.closedAt), /deadline/i);
  } finally { clearTimeout(keeper); }
});

test('pure report parsing and matching hash-shaped JSON cannot create an actual audit proof', () => {
  assert.throws(() => assertValidatedFeatureIndexAuditProof({ format: 'feature-index-session-audit-proof-v1' }), /not been validated/i);
  let read = false;
  const accessor = Object.defineProperty({}, 'format', { get() { read = true; throw new Error('must not read'); } });
  assert.throws(() => assertValidatedFeatureIndexAuditProof(accessor), /not been validated/i);
  assert.equal(read, false);
});

test('worker report digest uses bounded canonical Python ASCII JSON without a newline', () => {
  const report = { z: 'Lagos 🏠', a: 'é' };
  assert.equal(featureIndexAuditWorkerDigest(report), sha256('{"a":"\\u00e9","z":"Lagos \\ud83c\\udfe0"}'));
  assert.throws(() => featureIndexAuditWorkerDigest({ text: 'x'.repeat(64_001) }), /bounded cloning byte limit/i);
});

function auditInput(requestHash: string, jobId: string, padding = ''): FeatureIndexSessionAuditInput {
  const request = { schemaVersion: 1, id: `fixture-${jobId}`, inventoryUnitId: `country:${jobId}`,
    region: { id: `fixture-${jobId}`, parentId: null, name: `Fixture ${jobId}`, kind: 'country',
      countryCode: 'SN', timezone: null, bounds: [0, 0, 1, 1] }, provider: 'overture', release: '2026-09-23.1',
    layers: ['buildings'], limits: { networkBytes: 100, outputBytes: 1000, features: 10,
      durationMs: 1000, memoryMb: 64, diskBytes: 1000 }, ...(padding ? { padding } : {}) };
  return { extractPath: `/captures/${jobId}.geojson`, receiptPath: `/captures/${jobId}.receipt.json`,
    expected: { requestHash, request: request as never, extract: { sha256: hash, bytes: 1 },
      receipt: { sha256: 'c'.repeat(64), bytes: 1 } },
    requiredObservations: [{ campaignHash: hash, planHash: 'd'.repeat(64), jobId,
      rootCellId: 'geo-grid-v1:l1:x324:y209', queryPath: '0' }] };
}

const auditBinding = { reservedBytes: 64 * 1024 * 1024,
  runtime: { nodeVersion: 'v22.14.0', sqliteVersion: '3.49.0' } } as never;
const auditLimits = { fileBytes: 8 * 1024 * 1024, cpuSeconds: 30, wallSeconds: 30,
  heapMiB: 256, rssBytes: 256 * 1024 * 1024,
  engineLimits: { databaseBytes: 8 * 1024 * 1024, captures: 4096, occurrences: 250_000,
    versions: 100_000, observations: 16_384 } } as never;

function auditReport(inputs: readonly FeatureIndexSessionAuditInput[], replayed = false): Record<string, unknown> {
  const required = inputs.reduce((sum, input) => sum + input.requiredObservations.length, 0);
  const worker = { format: 'feature-index-audit-worker-v1', indexHash, inputSha256: 'e'.repeat(64),
    captureRecordSha256: 'f'.repeat(64), nodeVersion: 'v22.14.0', sqliteVersion: '3.49.0',
    result: { format: 'feature-index-raw-audit-v1', scope: 'raw-feature-conservation-and-required-observations',
      qualifications: { rawIndexConservation: 'complete', requiredObservations: 'complete' },
      counts: { captures: inputs.length, rawFeatures: 2, admitted: 2, exceptions: 0, occurrences: 2,
        versions: 2, keys: 2, conflicts: 0, crossOwnerConflictKeys: 0,
        observations: required, requiredObservations: required }, dispositionsSha256: '1'.repeat(64) },
    databaseBytes: 4096, maximumRssKiB: 65_536 };
  const guard = replayed ? null : { worker: 'index-capture-audit', case: null, returnCode: 0,
    inheritedLease: true, inheritedNamespaceLease: true, terminationSignal: null, reason: 'exit', elapsedMs: 50,
    maximumObservedWorkerRssBytes: 64 * 1024 * 1024, limits: { fileBytes: 8 * 1024 * 1024,
      cpuSeconds: 30, coreBytes: 0, wallSeconds: 30, v8HeapMiB: 256,
      sampledRssBytes: 96 * 1024 * 1024 }, scratchFilesBeforeRecovery: [],
    stdout: canonicalJson(worker), stderr: '' };
  const report: Record<string, unknown> = { audit: worker, guard,
    footprint: { scope: 'terminal-index-footprint-v1', files: {}, logicalBytes: 0, chargedBytes: 0,
      directoryAllocatedBytes: 0, aggregateLimitBytes: 64 * 1024 * 1024 },
    executionSnapshotChargedBytes: replayed ? 0 : 4096,
    auditSnapshotChargedBytes: replayed ? 0 : 8192,
    auditEnvelopeChargedBytes: replayed ? 0 : 128,
    auditController: { attempts: 1, inputSha256: '2'.repeat(64), recordSha256: '3'.repeat(64), replayed,
      scope: 'raw-feature-conservation-and-required-observations; global campaign membership is not established by pins alone' } };
  if (replayed) report.guardEvidence = { format: 'feature-index-audit-retained-guard-v1', returnCode: 0,
    reason: 'exit', maximumObservedWorkerRssBytes: 0, inheritedLease: true, inheritedNamespaceLease: true };
  return report;
}

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
  const shardBinding = prepareFeatureIndexShardBinding(binding, { planHash: hash, shardId: 'b'.repeat(64),
    membershipHash: 'c'.repeat(64), baseIndexBindingHash: sha256(binding) });
  assert.throws(() => prepareFeatureIndexSessionConfiguration({ ...config, bindingBytes: shardBinding.bytes }), /binding fields differ/i);
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

test('v2 shard binding matches the static Python-canonical v1 fixture, four pins, and golden wire digest', () => {
  const pins = staticShardPins();
  const base = Buffer.from(staticV1Binding);
  const encoded = prepareFeatureIndexShardBinding(base, pins);
  const shardJson = `{"baseIndexBindingHash":"${pins.baseIndexBindingHash}","membershipHash":"${pins.membershipHash}","planHash":"${pins.planHash}","shardId":"${pins.shardId}"}`;
  const goldenText = staticV1Binding.toString('ascii')
    .replace('"format":"feature-index-binding-v1"', '"format":"feature-index-binding-v2"')
    .replace(',"source":', `,"shard":${shardJson},"source":`);
  const golden = Buffer.from(goldenText, 'ascii');
  assert.deepEqual(encoded.bytes, golden);
  assert.equal(encoded.indexHash, sha256(golden));
  assert.equal(pins.baseIndexBindingHash, '809e15436e4348618c91f21a228cbccfdf9827d5d42559690e7a30d84ba2c418');
  assert.equal(encoded.indexHash, '7f37bcf935126aa36331b9144d976d5ec590618fd526beb6485554b337bfd09f');
  const decoded = validateFeatureIndexShardBinding(encoded.bytes);
  assert.deepEqual(decoded.baseBindingBytes, staticV1Binding);
  assert.deepEqual(decoded.shardPins, pins);
  assert.equal(sha256(decoded.baseBindingBytes), pins.baseIndexBindingHash);
});

test('v2 shard helpers copy base bytes and pins without changing legacy v1 inputs', () => {
  const original = Buffer.from(staticV1Binding), pins = staticShardPins();
  const before = Buffer.from(original), pinsBefore = { ...pins };
  const encoded = prepareFeatureIndexShardBinding(original, pins);
  original[0] = original[0]! ^ 1;
  pins.planHash = hash;
  assert.deepEqual(before, staticV1Binding);
  const checked = validateFeatureIndexShardBinding(encoded.bytes);
  assert.deepEqual(checked.baseBindingBytes, before);
  assert.deepEqual(checked.shardPins, pinsBefore);
  checked.baseBindingBytes[0] = checked.baseBindingBytes[0]! ^ 1;
  checked.shardPins.shardId = hash;
  const checkedAgain = validateFeatureIndexShardBinding(encoded.bytes);
  assert.deepEqual(checkedAgain.baseBindingBytes, before);
  assert.deepEqual(checkedAgain.shardPins, pinsBefore);
});

test('v2 shard binding refuses malformed pins, changed base identity, wrong versions, noncanonical bytes, and accessors', () => {
  const pins = staticShardPins();
  assert.throws(() => prepareFeatureIndexShardBinding(staticV1Binding, { ...pins, baseIndexBindingHash: hash }), /base binding hash/i);
  assert.throws(() => prepareFeatureIndexShardBinding(staticV1Binding, { ...pins, surprise: true }), /fields differ/i);
  assert.throws(() => prepareFeatureIndexShardBinding(staticV1Binding, { ...pins, shardId: true }), /lowercase SHA/i);
  let called = false;
  const accessor = { ...pins };
  Object.defineProperty(accessor, 'planHash', { enumerable: true, get() { called = true; return pins.planHash; } });
  assert.throws(() => prepareFeatureIndexShardBinding(staticV1Binding, accessor), /enumerable data properties/i);
  assert.equal(called, false);

  const encoded = prepareFeatureIndexShardBinding(staticV1Binding, pins);
  assert.throws(() => validateFeatureIndexShardBinding(Buffer.concat([Buffer.from(encoded.bytes), Buffer.from('\n')])), /ASCII bytes|canonical JSON/i);
  const parsed = JSON.parse(Buffer.from(encoded.bytes).toString('ascii')) as Record<string, unknown>;
  const wrongVersion = { ...parsed, engineVersion: 'complete-feature-index-v2' };
  assert.throws(() => validateFeatureIndexShardBinding(Buffer.from(canonicalJson(wrongVersion), 'ascii')), /versions differ/i);
  const changedBasePin = { ...parsed, shard: { ...(parsed.shard as object), baseIndexBindingHash: 'f'.repeat(64) } };
  assert.throws(() => validateFeatureIndexShardBinding(Buffer.from(canonicalJson(changedBasePin), 'ascii')), /base binding hash differs/i);
  assert.throws(() => validateFeatureIndexShardBinding(Buffer.from(canonicalJson({ ...parsed, unknown: true }), 'ascii')), /fields differ/i);
  assert.throws(() => validateFeatureIndexShardBinding(Buffer.from(canonicalJson({ ...parsed,
    shard: { ...(parsed.shard as object), extra: true } }), 'ascii')), /fields differ/i);
});

test('audit preparation freezes caller data, requires sorted distinct membership, and sorts observation pins', () => {
  const low = auditInput('1'.repeat(64), 'low');
  const high = auditInput('2'.repeat(64), 'high');
  const alternate = { ...low.requiredObservations[0]!, jobId: 'alternate' };
  low.requiredObservations = [alternate, low.requiredObservations[0]!];
  const prepared = prepareFeatureIndexSessionAudit([low, high], 3);
  const ordered = [...low.requiredObservations].sort((a, b) => {
    const x = featureIndexObservationPin(a), y = featureIndexObservationPin(b);
    return x.sha256 < y.sha256 ? -1 : x.sha256 > y.sha256 ? 1 : x.bytes - y.bytes;
  });
  assert.deepEqual(prepared.inputs[0]!.requiredObservations, ordered);
  assert.equal(prepared.attemptLimit, 3);
  const firstCaptureFrame = parseFeatureIndexSessionLine(prepared.frames[1]!) as Record<string, unknown>;
  assert.equal(firstCaptureFrame.ordinal, 0);
  assert.equal((firstCaptureFrame.expected as { requestHash: string }).requestHash, low.expected.requestHash);
  assert.deepEqual(firstCaptureFrame.requiredObservations, ordered);
  assert.deepEqual(parseFeatureIndexSessionLine(prepared.frames[0]!), {
    format: 'feature-index-session-audit-begin-v1', id: 1, count: 2, attemptLimit: 3 });
  assert.deepEqual(parseFeatureIndexSessionLine(prepared.frames.at(-1)!),
    { format: 'feature-index-session-audit-run-v1', id: 1 });

  const pinnedFrame = Buffer.from(prepared.frames[1]!);
  (low.expected.request as unknown as Record<string, unknown>).id = 'mutated';
  (low.requiredObservations[0] as { jobId: string }).jobId = 'mutated';
  assert.equal((prepared.inputs[0]!.expected.request as unknown as Record<string, unknown>).id, 'fixture-low');
  assert.deepEqual(prepared.frames[1], pinnedFrame);
  assert.throws(() => prepareFeatureIndexSessionAudit([high, low]), /sorted and distinct/i);
  assert.throws(() => prepareFeatureIndexSessionAudit([low, { ...low }]), /sorted and distinct/i);
  assert.throws(() => prepareFeatureIndexSessionAudit([low], 9), /attempt limit/i);

  const accessor = auditInput('3'.repeat(64), 'accessor');
  Object.defineProperty(accessor, 'requiredObservations', { enumerable: true, get: () => [] });
  assert.throws(() => prepareFeatureIndexSessionAudit([accessor]), /accessor/i);
});

test('audit preparation rejects duplicate observation pins and charges expected JSON after base64 expansion', () => {
  const duplicate = auditInput('1'.repeat(64), 'duplicate');
  duplicate.requiredObservations = [duplicate.requiredObservations[0]!, { ...duplicate.requiredObservations[0]! }];
  assert.throws(() => prepareFeatureIndexSessionAudit([duplicate]), /distinct/i);

  const padded = Array.from({ length: 9 }, (_, index) => auditInput(
    index.toString(16).repeat(64), `large-${index}`, 'x'.repeat(45_000)));
  const rawBytes = padded.reduce((sum, item) => sum + Buffer.byteLength(canonicalJson(item.expected)), 0);
  const encodedBytes = padded.reduce((sum, item) => {
    const expectedBase64 = Buffer.from(canonicalJson(item.expected), 'utf8').toString('base64');
    return sum + Buffer.byteLength(canonicalJson({ extractPath: item.extractPath, receiptPath: item.receiptPath,
      expectedBase64, requiredObservations: item.requiredObservations }));
  }, 0);
  assert.ok(rawBytes < 512_000);
  assert.ok(encodedBytes > 512_000);
  assert.throws(() => prepareFeatureIndexSessionAudit(padded), /512000/i);
});

test('audit input count is rejected before an accessor element is inspected', () => {
  const oversized = new Array(257) as FeatureIndexSessionAuditInput[];
  let accessorRead = false;
  Object.defineProperty(oversized, '0', { enumerable: true, get: () => {
    accessorRead = true;
    throw new Error('audit input element must not be read');
  } });
  assert.throws(() => prepareFeatureIndexSessionAudit(oversized), /1\.\.256/);
  assert.equal(accessorRead, false);
});

test('audit caller JSON clone enforces depth, individual string, and aggregate byte bounds', () => {
  const deep = auditInput('1'.repeat(64), 'deep');
  let nested: unknown = 'leaf';
  for (let index = 0; index < 64; index++) nested = { child: nested };
  deep.expected.request = nested as never;
  assert.throws(() => prepareFeatureIndexSessionAudit([deep]), /bounded cloning depth\/node limit/i);

  const longString = auditInput('2'.repeat(64), 'large-string');
  longString.expected.request = { payload: 'x'.repeat(600_000) } as never;
  assert.throws(() => prepareFeatureIndexSessionAudit([longString]), /bounded cloning byte limit/i);

  const aggregate = auditInput('3'.repeat(64), 'large-aggregate');
  aggregate.expected.request = Object.fromEntries(Array.from({ length: 180 }, (_, index) =>
    [`field-${index}`, 'y'.repeat(3_500)])) as never;
  assert.throws(() => prepareFeatureIndexSessionAudit([aggregate]), /bounded cloning byte limit/i);
});

test('audit result validator accepts fresh and replayed actual-shaped reports', () => {
  const inputs = [auditInput('1'.repeat(64), 'fresh'), auditInput('2'.repeat(64), 'replay')];
  const frame = (report: Record<string, unknown>) => ({ format: 'feature-index-session-audit-result-v1', id: 1, indexHash, report });
  const fresh = auditReport(inputs);
  assert.equal(validateFeatureIndexSessionAuditResult(frame(fresh), indexHash, inputs, 4, auditBinding, auditLimits), fresh);
  const replayed = auditReport(inputs, true);
  assert.equal(validateFeatureIndexSessionAuditResult(frame(replayed), indexHash, inputs, 4, auditBinding, auditLimits), replayed);
});

test('audit result validator rejects changed runtime, identity, counts, scope, guard, and allocation evidence', () => {
  const inputs = [auditInput('1'.repeat(64), 'audit-one'), auditInput('2'.repeat(64), 'audit-two')];
  const validFrame = (report: Record<string, unknown>) => ({ format: 'feature-index-session-audit-result-v1', id: 1, indexHash, report });
  const fresh = auditReport(inputs);

  const runtime = structuredClone(fresh);
  (runtime.audit as Record<string, unknown>).nodeVersion = 'v22.15.0';
  assert.throws(() => validateFeatureIndexSessionAuditResult(validFrame(runtime), indexHash, inputs, 4, auditBinding, auditLimits), /runtime|admitted/i);
  assert.throws(() => validateFeatureIndexSessionAuditResult({ ...validFrame(fresh), indexHash: hash }, indexHash, inputs, 4, auditBinding, auditLimits), /identity|order/i);

  const counts = structuredClone(fresh);
  (((counts.audit as Record<string, unknown>).result as Record<string, unknown>).counts as Record<string, unknown>).captures = 1;
  assert.throws(() => validateFeatureIndexSessionAuditResult(validFrame(counts), indexHash, inputs, 4, auditBinding, auditLimits), /counts|conserve/i);

  const scope = structuredClone(fresh);
  (scope.auditController as Record<string, unknown>).scope = 'pins-only';
  assert.throws(() => validateFeatureIndexSessionAuditResult(validFrame(scope), indexHash, inputs, 4, auditBinding, auditLimits), /scope/i);

  const guard = structuredClone(fresh);
  (guard.guard as Record<string, unknown>).reason = 'signal';
  assert.throws(() => validateFeatureIndexSessionAuditResult(validFrame(guard), indexHash, inputs, 4, auditBinding, auditLimits), /guard|terminal/i);

  const allocation = structuredClone(fresh);
  allocation.executionSnapshotChargedBytes = 0;
  assert.throws(() => validateFeatureIndexSessionAuditResult(validFrame(allocation), indexHash, inputs, 4, auditBinding, auditLimits), /allocation/i);
  const replayAllocation = auditReport(inputs, true);
  replayAllocation.auditSnapshotChargedBytes = 1;
  assert.throws(() => validateFeatureIndexSessionAuditResult(validFrame(replayAllocation), indexHash, inputs, 4, auditBinding, auditLimits), /allocation/i);
});
