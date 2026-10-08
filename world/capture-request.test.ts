import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CAPTURE_SOURCE_CONFIG_BYTES, verifyCaptureRequestSource } from './capture-request.ts';
import type { AcquisitionRequest } from './production-types.ts';
import { bindConfiguredCapture } from './capture-binding.ts';

// Retained positive Dakar request vector. Tests read repository source config only;
// never the actual acquisition cache, ledger or immutable world output.
const sourceBytes = readFileSync(new URL('./acquisition-sources.json', import.meta.url));
const sourcePin = { bytes: 1_297, sha256: '7ac2f2babcab7e4dd330a2f2e3476708129653022ba7bd0a94c9cbf69184656c' };
const requestHash = '9bc75fe39e8bde3be9394b941776939c7bb6a13acd03172f773acf91267d8bbe';
const request: AcquisitionRequest = {
  schemaVersion: 1, id: 'dakar-overture-sample', inventoryUnitId: 'country:natural-earth:NE_ID%3A1159321243', provider: 'overture', release: '2026-09-23.1', layers: ['buildings', 'roads'],
  region: { id: 'sn-dakar-urban-sample', parentId: 'country:natural-earth:NE_ID%3A1159321243', name: 'Dakar Natural Earth populated-place sample cell', kind: 'cell', countryCode: 'SN', timezone: 'Africa/Dakar', bounds: [-17.477076, 14.715777999999998, -17.473076000000002, 14.719778] },
  limits: { networkBytes: 32_000_000, outputBytes: 10_000_000, features: 5_000, durationMs: 600_000, memoryMb: 1_536, diskBytes: 128_000_000 },
};
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function changed(text: string) {
  const bytes = new TextEncoder().encode(text);
  return { bytes, pin: { bytes: bytes.byteLength, sha256: sha(bytes) } };
}

test('reconstructs the retained positive request from exact pinned source configuration', () => {
  const before = Buffer.from(sourceBytes), result = verifyCaptureRequestSource(sourceBytes, sourcePin, requestHash, request);
  assert.equal(result.requestHash, requestHash);
  assert.equal(result.compiler, 'world-source-compiler-v2');
  assert.deepEqual(result.sourceConfiguration, sourcePin); assert.deepEqual(sourceBytes, before);
});

test('execution budgets are excluded but geographic/layer selection remains in identity', () => {
  const smaller = structuredClone(request);
  smaller.limits = { networkBytes: 1, outputBytes: 1, features: 1, durationMs: 1, memoryMb: 1, diskBytes: 1 };
  assert.equal(verifyCaptureRequestSource(sourceBytes, sourcePin, requestHash, smaller).requestHash, requestHash);
  for (const change of ['id', 'bounds', 'layers'] as const) {
    const altered = structuredClone(request);
    if (change === 'id') altered.id = 'different';
    if (change === 'bounds') altered.region.bounds[0] = -17.478;
    if (change === 'layers') altered.layers = ['buildings'];
    assert.throws(() => verifyCaptureRequestSource(sourceBytes, sourcePin, requestHash, altered), /does not reconstruct/);
  }
});

test('reordering configuration keys/whitespace preserves canonical identity but changes raw configuration pin', () => {
  const config = JSON.parse(sourceBytes.toString('utf8')) as Record<string, unknown>;
  const reordered = changed(JSON.stringify(Object.fromEntries(Object.entries(config).reverse())) + '\n');
  assert.notEqual(reordered.pin.sha256, sourcePin.sha256);
  assert.equal(verifyCaptureRequestSource(reordered.bytes, reordered.pin, requestHash, request).requestHash, requestHash);
});

test('changed policy and changed attribution cannot be hidden by re-pinning raw bytes', () => {
  const policy = changed(sourceBytes.toString('utf8').replace('"itemCount": 512', '"itemCount": 513'));
  assert.throws(() => verifyCaptureRequestSource(policy.bytes, policy.pin, requestHash, request), /pinned policy/);
  const attribution = changed(sourceBytes.toString('utf8').replace('© Overture Maps Foundation.', 'Changed source attribution.'));
  assert.throws(() => verifyCaptureRequestSource(attribution.bytes, attribution.pin, requestHash, request), /does not reconstruct/);
});

test('duplicate decoded fields, unknown fields and invalid pins fail closed', () => {
  const duplicate = changed(sourceBytes.toString('utf8').replace('"provider":', '"provider":"overture","\\u0070rovider":'));
  assert.throws(() => verifyCaptureRequestSource(duplicate.bytes, duplicate.pin, requestHash, request), /duplicate decoded/);
  const extra = changed(sourceBytes.toString('utf8').replace('"schemaVersion":', '"__proto__":{},"schemaVersion":'));
  assert.throws(() => verifyCaptureRequestSource(extra.bytes, extra.pin, requestHash, request), /configuration contract/);
  assert.throws(() => verifyCaptureRequestSource(sourceBytes, { ...sourcePin, bytes: CAPTURE_SOURCE_CONFIG_BYTES + 1 }, requestHash, request), /bound/);
  assert.throws(() => verifyCaptureRequestSource(sourceBytes, { ...sourcePin, sha256: '0'.repeat(64) }, requestHash, request), /pinned SHA/);
  assert.throws(() => verifyCaptureRequestSource(sourceBytes, sourcePin, 'ABC', request), /request hash/);
});

test('a wrong expected request and protected Nigeria are never accepted', () => {
  assert.throws(() => verifyCaptureRequestSource(sourceBytes, sourcePin, 'f'.repeat(64), request), /does not reconstruct/);
  const nigeria = structuredClone(request); nigeria.region.countryCode = 'NG';
  assert.throws(() => verifyCaptureRequestSource(sourceBytes, sourcePin, requestHash, nigeria), /Nigeria/);
});

test('configured ingestion binds a source-derived request and exact zero-row capture together', () => {
  // Synthetic empty envelope for composition only. The actual pinned Dakar capture
  // has473 features; these invented fixture pins never enter the real ledger/output.
  const config = JSON.parse(sourceBytes.toString('utf8')) as {
    stac: { collections: Record<'buildings' | 'roads', { url: string }> };
    attribution: Record<'buildings' | 'roads', string>;
  };
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const extractBytes = encode({ type: 'FeatureCollection', features: [], metadata: {
    provider: request.provider, release: request.release, requestHash, exceptions: [],
    stacIndex: { sha256: sha('[]'), itemCount: 640, selectedCount: 0 },
  } });
  const { limits: _, ...selection } = request;
  const receiptBytes = encode({ schemaVersion: 1, requestHash, selection, request,
    completedAt: '2026-10-08T00:00:00.000Z', inputSha256: sha(extractBytes), inputBytes: extractBytes.byteLength,
    metrics: { networkBytes: 0, outputBytes: extractBytes.byteLength, features: 0, elapsedMs: 1 }, upstream: [], exceptions: [],
    sources: request.layers.map(layer => ({ id: `overture-${request.release}-${layer}`, release: request.release,
      url: config.stac.collections[layer].url, attribution: config.attribution[layer], license: 'ODbL-1.0', sha256: sha('[]'), bytes: 2 })),
  });
  const expected = { requestHash, request, extract: { sha256: sha(extractBytes), bytes: extractBytes.byteLength }, receipt: { sha256: sha(receiptBytes), bytes: receiptBytes.byteLength } };
  const result = bindConfiguredCapture(extractBytes, receiptBytes, expected, { bytes: sourceBytes, pin: sourcePin });
  assert.deepEqual(result.features, []);
  assert.deepEqual(result.sourceConfiguration, sourcePin);
  assert.equal(result.sourceCompiler, 'world-source-compiler-v2');
  assert.throws(() => bindConfiguredCapture(extractBytes, receiptBytes, expected, undefined as never), /requires its source configuration/);
  assert.throws(() => bindConfiguredCapture(extractBytes, receiptBytes, { ...expected, requestHash: 'f'.repeat(64) }, { bytes: sourceBytes, pin: sourcePin }), /does not reconstruct/);
  const corrupt = receiptBytes.slice(); corrupt[0] = 32;
  assert.throws(() => bindConfiguredCapture(extractBytes, corrupt, expected, { bytes: sourceBytes, pin: sourcePin }), /SHA-256/);
});
