import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { bindCaptureSnapshots, CAPTURE_BINDING_VERSION } from './capture-binding.ts';
import type { CaptureExpectation } from './capture-binding.ts';
import type { AcquisitionRequest } from './production-types.ts';

const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const requestHash = 'a'.repeat(64);
const request: AcquisitionRequest = {
  schemaVersion: 1, id: 'fixture', inventoryUnitId: 'country:fixture:SN', provider: 'overture', release: '2026-09-23.1', layers: ['buildings', 'roads'],
  region: { id: 'fixture-cell', parentId: 'country:fixture:SN', name: 'Fixture', kind: 'cell', countryCode: 'SN', timezone: 'Africa/Dakar', bounds: [-18, 14, -17, 15] },
  limits: { networkBytes: 100_000, outputBytes: 20_000, features: 20, durationMs: 1_000, memoryMb: 128, diskBytes: 100_000 },
};
function fixture(features: unknown[] = [{ id: 'one', type: 'Feature' }, null, { id: 'one', type: 'Feature', changed: true }]) {
  const { limits: _, ...selection } = request;
  const extract = { type: 'FeatureCollection', features, metadata: { provider: request.provider, release: request.release, requestHash, exceptions: [], stacIndex: { sha256: 'b'.repeat(64), itemCount: 640, selectedCount: 2 } } };
  const receipt = {
    schemaVersion: 1, requestHash, selection: structuredClone(selection), request: structuredClone(request), completedAt: '2026-10-08T00:00:00.000Z',
    inputSha256: '', inputBytes: 0, metrics: { networkBytes: 2, outputBytes: 0, features: features.length, elapsedMs: 10 },
    upstream: [{ url: `https://stac.overturemaps.org/${request.release}/buildings/building/collection.json`, etag: null, bytes: 2 }],
    sources: request.layers.map(layer => ({ id: `overture-${request.release}-${layer}`, release: request.release, url: `https://stac.overturemaps.org/${request.release}/${layer === 'buildings' ? 'buildings/building' : 'transportation/segment'}/collection.json`, license: 'ODbL-1.0', attribution: 'Fixture https://docs.overturemaps.org/attribution/', sha256: 'c'.repeat(64), bytes: 1 })), exceptions: [],
  };
  function snapshots(extractText?: string, receiptText?: string) {
    const extractBytes = extractText === undefined ? encode(extract) : new TextEncoder().encode(extractText);
    receipt.inputSha256 = digest(extractBytes); receipt.inputBytes = extractBytes.byteLength; receipt.metrics.outputBytes = extractBytes.byteLength;
    const receiptBytes = receiptText === undefined ? encode(receipt) : new TextEncoder().encode(receiptText);
    const expected: CaptureExpectation = { requestHash, request: structuredClone(request), extract: { sha256: digest(extractBytes), bytes: extractBytes.byteLength }, receipt: { sha256: digest(receiptBytes), bytes: receiptBytes.byteLength } };
    return { extractBytes, receiptBytes, expected };
  }
  return { extract, receipt, snapshots };
}
const bind = (value: ReturnType<ReturnType<typeof fixture>['snapshots']>) => bindCaptureSnapshots(value.extractBytes, value.receiptBytes, value.expected);

test('bound capture conserves original order, duplicate identities and unsupported feature ordinals', () => {
  const sample = fixture(), input = sample.snapshots(), before = [input.extractBytes.slice(), input.receiptBytes.slice()];
  const result = bind(input);
  assert.deepEqual(result.features, sample.extract.features);
  assert.equal(result.features.length, 3); assert.equal(result.features[1], null);
  assert.deepEqual(result.binding, { provider: 'overture', release: request.release, layers: request.layers });
  assert.deepEqual([input.extractBytes, input.receiptBytes], before);
  const stamp = `{"extract":{"bytes":${input.expected.extract.bytes},"sha256":"${input.expected.extract.sha256}"},"receipt":{"bytes":${input.expected.receipt.bytes},"sha256":"${input.expected.receipt.sha256}"},"requestHash":"${requestHash}","version":"${CAPTURE_BINDING_VERSION}"}`;
  assert.equal(result.captureHash, digest(stamp));
  assert.equal(bind(input).captureHash, result.captureHash);
});

test('exact zero-row captures remain distinct from corrupt/missing captures', () => {
  assert.deepEqual(bind(fixture([]).snapshots()).features, []);
  const input = fixture([]).snapshots(); input.receiptBytes = new Uint8Array();
  assert.throws(() => bind(input), /byte pin/);
});

test('changed bytes and wrong pins fail before trusting parsed receipts', () => {
  for (const kind of ['extract', 'receipt'] as const) {
    const input = fixture().snapshots();
    if (kind === 'extract') input.extractBytes[0] = 32; else input.receiptBytes[0] = 32;
    assert.throws(() => bind(input), /SHA-256/);
    const wrongSize = fixture().snapshots(); wrongSize.expected[kind].bytes++;
    assert.throws(() => bind(wrongSize), /byte pin/);
  }
  const input = fixture().snapshots(); input.expected.extract.sha256 = 'ABC';
  assert.throws(() => bind(input), /pin hash/);
});

test('repinning duplicated fields cannot bypass strict raw JSON parsing', () => {
  for (const kind of ['extract', 'receipt'] as const) {
    const sample = fixture();
    const text = JSON.stringify(kind === 'extract' ? sample.extract : sample.receipt).replace('"requestHash":', `"requestHash":"${requestHash}","\\u0072equestHash":`);
    const input = kind === 'extract' ? sample.snapshots(text) : sample.snapshots(undefined, text);
    assert.throws(() => bind(input), /duplicate decoded/);
  }
});

test('request, selection, metadata, counts and receipt extract linkage must agree', () => {
  const changes: Array<(sample: ReturnType<typeof fixture>) => void> = [
    sample => { sample.receipt.request.region.countryCode = 'GH'; },
    sample => { sample.receipt.selection.id = 'another'; },
    sample => { sample.receipt.requestHash = 'd'.repeat(64); },
    sample => { sample.extract.metadata.release = '2026-01-01.1'; },
    sample => { sample.receipt.metrics.features++; },
    sample => { sample.extract.metadata.stacIndex.itemCount = 641; },
    sample => { sample.extract.metadata.stacIndex.selectedCount = 641; },
  ];
  for (const change of changes) { const sample = fixture(); change(sample); assert.throws(() => bind(sample.snapshots())); }
  const sample = fixture(), input = sample.snapshots();
  sample.receipt.inputSha256 = 'e'.repeat(64); input.receiptBytes = encode(sample.receipt);
  input.expected.receipt = { sha256: digest(input.receiptBytes), bytes: input.receiptBytes.byteLength };
  assert.throws(() => bind(input), /extract binding/);
});

test('source attribution/layer and upstream accounting remain explicit and bounded', () => {
  const changes: Array<(sample: ReturnType<typeof fixture>) => void> = [
    sample => { sample.receipt.sources[0]!.license = 'invented'; },
    sample => { sample.receipt.sources[0]!.release = '2026-01-01.1'; },
    sample => { sample.receipt.sources[0]!.attribution = 'missing link'; },
    sample => { sample.receipt.sources.reverse(); },
    sample => { sample.receipt.upstream[0]!.url = 'https://example.com/2026-09-23.1/data'; },
    sample => { sample.receipt.upstream[0]!.bytes = 3; },
    sample => { sample.receipt.metrics.networkBytes = 3; },
    sample => { sample.receipt.metrics.elapsedMs = 1_001; },
  ];
  for (const change of changes) { const sample = fixture(); change(sample); assert.throws(() => bind(sample.snapshots())); }
});

test('same request with different exact receipt bytes has a different capture stamp', () => {
  const sample = fixture(), initial = bind(sample.snapshots());
  sample.receipt.completedAt = '2026-10-08T00:00:00.001Z';
  const altered = bind(sample.snapshots());
  assert.equal(initial.requestHash, altered.requestHash);
  assert.notEqual(initial.captureHash, altered.captureHash, 'the future store must reject changed capture bytes under an existing request');
});

test('protected Nigeria and smaller resource budgets cannot be bypassed by valid pins', () => {
  const input = fixture().snapshots(); input.expected.request.region.countryCode = 'NG';
  assert.throws(() => bind(input), /Nigeria/);
  const bounded = fixture().snapshots(); bounded.expected.request.limits.outputBytes = 1;
  assert.throws(() => bind(bounded), /pin bytes/);
});

test('cache resume preserves historical network/duration accounting under smaller current budgets', () => {
  const input = fixture().snapshots(), original = bind(input);
  input.expected.request.limits.networkBytes = 1;
  input.expected.request.limits.durationMs = 1;
  assert.equal(bind(input).captureHash, original.captureHash);
  input.expected.request.limits.features = 2;
  assert.throws(() => bind(input), /feature count/);
  const sample = fixture(); sample.receipt.request.limits.networkBytes = 1;
  assert.throws(() => bind(sample.snapshots()), /Historical measured network bytes/);
});
