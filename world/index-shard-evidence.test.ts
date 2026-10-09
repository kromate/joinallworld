import test from 'node:test';
import assert from 'node:assert/strict';
import { featureIndexObservationPin } from './feature-index.ts';
import type { FeatureIndexObservation } from './feature-index.ts';
import { asciiJsonLine } from './feature-index-session.ts';
import type { FeatureIndexSessionAuditInput } from './feature-index-session.ts';
import { sha256 } from './pack.ts';
import { calculateFeatureIndexShardEnvelopeOverhead, prepareFeatureIndexShardPlanRequest } from './index-shard-evidence.ts';

const h = (letter: string) => letter.repeat(64);
const observation = (jobId = 'caf\u00e9'): FeatureIndexObservation => ({
  campaignHash: h('a'), planHash: h('b'), jobId, rootCellId: 'geo-grid-v1:l0:x0:y0', queryPath: '0123',
});
const input = (contexts: FeatureIndexObservation[] = [observation()]): FeatureIndexSessionAuditInput => ({
  extractPath: '/capture/extract.json', receiptPath: '/capture/receipt.json',
  expected: { requestHash: h('c'), request: { z: 1, a: '\u00e9' },
    extract: { sha256: h('d'), bytes: 3 }, receipt: { sha256: h('e'), bytes: 4 } },
  requiredObservations: contexts,
});

test('prepared request hashes match explicit Python ensure_ascii canonical bytes and freezes independent values', () => {
  const source = input();
  const prepared = prepareFeatureIndexShardPlanRequest(source, 1);
  const expectedBytes = Buffer.from(
    `{"extract":{"bytes":3,"sha256":"${h('d')}"},"receipt":{"bytes":4,"sha256":"${h('e')}"},"request":{"a":"\\u00e9","z":1},"requestHash":"${h('c')}"}`,
    'ascii');
  const observationBytes = Buffer.from(
    `{"campaignHash":"${h('a')}","jobId":"caf\\u00e9","planHash":"${h('b')}","queryPath":"0123","rootCellId":"geo-grid-v1:l0:x0:y0"}`,
    'ascii');
  const observationPinBytes = Buffer.from(
    `{"campaignHash":"${h('a')}","jobId":"café","planHash":"${h('b')}","queryPath":"0123","rootCellId":"geo-grid-v1:l0:x0:y0"}`,
    'utf8');
  const descriptorBytes = Buffer.from(
    `{"allowedObservationPins":[{"bytes":${observationPinBytes.byteLength},"sha256":"${sha256(observationPinBytes)}"}],"expectedBase64":"${expectedBytes.toString('base64')}","extractPath":"/capture/extract.json","receiptPath":"/capture/receipt.json","requiredObservations":[${observationBytes.toString('ascii')}]}`,
    'ascii');
  const wireBytes = Buffer.from(
    `{"expected":{"extract":{"bytes":3,"sha256":"${h('d')}"},"receipt":{"bytes":4,"sha256":"${h('e')}"},"request":{"a":"\\u00e9","z":1},"requestHash":"${h('c')}"},"extractPath":"/capture/extract.json","format":"feature-index-session-audit-capture-v1","id":9007199254740991,"ordinal":255,"receiptPath":"/capture/receipt.json","requiredObservations":[${observationBytes.toString('ascii')}]}`,
    'ascii');
  const captureInputBytes = Buffer.from(
    `{"expected":{"bytes":${expectedBytes.byteLength},"sha256":"${sha256(expectedBytes)}"},"extractPath":"/capture/extract.json","receiptPath":"/capture/receipt.json"}`,
    'ascii');
  const requiredSetBytes = Buffer.from(`[${observationBytes.toString('ascii')}]`, 'ascii');

  assert.deepEqual(prepared.descriptor, {
    extractPath: '/capture/extract.json', receiptPath: '/capture/receipt.json',
    expectedBase64: expectedBytes.toString('base64'),
    requiredObservations: [observation()],
    allowedObservationPins: [featureIndexObservationPin(observation())],
  });
  assert.equal(asciiJsonLine(prepared.descriptor, 512_001, 'test descriptor').subarray(0, -1).toString('ascii'), descriptorBytes.toString('ascii'));
  assert.equal(asciiJsonLine({ format: 'feature-index-session-audit-capture-v1', id: Number.MAX_SAFE_INTEGER,
    ordinal: 255, ...prepared.input }, 128_000, 'test audit wire').subarray(0, -1).toString('ascii'), wireBytes.toString('ascii'));
  assert.equal(prepared.request.captureInputHash, sha256(captureInputBytes));
  assert.equal(prepared.request.requiredObservationSetHash, sha256(requiredSetBytes));
  assert.equal(prepared.request.auditDescriptorBytes, descriptorBytes.byteLength + 1);
  assert.equal(prepared.request.requestHash, h('c'));
  assert.equal(prepared.request.requiredObservationCount, 1);
  assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.input) && Object.isFrozen(prepared.input.expected));
  assert.ok(Object.isFrozen(prepared.descriptor.requiredObservations[0]));
  assert.ok(Object.isFrozen(prepared.descriptor.allowedObservationPins[0]));
  assert.equal(Object.isFrozen(source), false);
});

test('request preparation pins every canonical context and binds exact count and descriptor charge', () => {
  const contexts = [observation('z'), observation('a')];
  const prepared = prepareFeatureIndexShardPlanRequest(input(contexts), 2);
  const pins = contexts.map(featureIndexObservationPin).sort((a, b) => a.sha256.localeCompare(b.sha256));
  assert.deepEqual(prepared.descriptor.allowedObservationPins, pins);
  assert.equal(prepared.request.requiredObservationCount, 2);
  assert.equal(prepared.request.requiredObservationSetHash,
    sha256(asciiJsonLine(prepared.input.requiredObservations, 128_000, 'test contexts').subarray(0, -1)));
  assert.equal(prepared.request.auditDescriptorBytes,
    asciiJsonLine(prepared.descriptor, 512_001, 'test descriptor').byteLength);
  assert.ok(Object.isFrozen(prepared.input.requiredObservations));
});

test('attempt allowance must cover every required context and required set is nonempty', () => {
  assert.throws(() => prepareFeatureIndexShardPlanRequest(input([]), 1), /required observation/i);
  assert.throws(() => prepareFeatureIndexShardPlanRequest(input([observation(), observation('other')]), 1), /durable capture attempt/i);
  assert.throws(() => prepareFeatureIndexShardPlanRequest(input([observation()]), 0), /attempt limit/i);
  assert.throws(() => prepareFeatureIndexShardPlanRequest(input(Array.from({ length: 9 }, (_, i) => observation(`job-${i}`))), 8), /required contexts exceed8/i);
});

test('oversized expectation is rejected by the bounded frame/preflight contract', () => {
  const large = input();
  large.expected.request = { value: 'x'.repeat(70_000) };
  assert.throws(() => prepareFeatureIndexShardPlanRequest(large, 1), /fixed line byte bound|bounded cloning byte limit/i);
});

test('wrapper estimate includes the final ASCII wrapper, maximal pins and one separator byte', () => {
  const root = '/tmp/campaign';
  const fileBytes = 8 * 1024 * 1024;
  const databaseBytes = 4 * 1024 * 1024;
  const digest = 'f'.repeat(64);
  const wrapper = {
    format: 'feature-index-audit-input-v1', indexHash: digest,
    captureRecord: { sha256: digest, bytes: 512_000 },
    snapshotRoot: { path: `${root}/${digest}/audit.execution`, device: '9'.repeat(19), inode: '9'.repeat(19) },
    database: { sha256: digest, bytes: databaseBytes }, wal: { sha256: digest, bytes: fileBytes }, captures: [],
  };
  assert.equal(calculateFeatureIndexShardEnvelopeOverhead(root, fileBytes, databaseBytes),
    asciiJsonLine(wrapper, 100_000, 'test wrapper').byteLength + 1);
  assert.throws(() => calculateFeatureIndexShardEnvelopeOverhead('/root/../escape', fileBytes, databaseBytes), /canonical absolute/i);
  assert.throws(() => calculateFeatureIndexShardEnvelopeOverhead('/tmp/caf\u00e9', fileBytes, databaseBytes), /canonical absolute/i);
  assert.throws(() => calculateFeatureIndexShardEnvelopeOverhead('/tmp/campaign\n', fileBytes, databaseBytes), /canonical absolute/i);
  assert.throws(() => calculateFeatureIndexShardEnvelopeOverhead('/root', fileBytes, fileBytes + 1), /database limit/i);
  assert.throws(() => calculateFeatureIndexShardEnvelopeOverhead('/root', 65_535, 65_536), /file limit/i);
  assert.throws(() => calculateFeatureIndexShardEnvelopeOverhead('/root', 64 * 1024 * 1024 + 1, 65_536), /file limit/i);
  assert.throws(() => calculateFeatureIndexShardEnvelopeOverhead('/root', 1_000_000, 65_537), /page-aligned/i);
  assert.throws(() => calculateFeatureIndexShardEnvelopeOverhead('/root', 1_000_000, 64 * 1024 * 1024 + 1), /database limit/i);
});
