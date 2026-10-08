import { parseCaptureJson } from './capture-json.ts';
import { validateAcquisitionRequest } from './acquire.ts';
import { canonicalJson, sha256 } from './pack.ts';
import type { AcquisitionRequest } from './production-types.ts';
import type { FeatureIdentityBinding } from './feature-identity.ts';
import { verifyCaptureRequestSource } from './capture-request.ts';

export const CAPTURE_BINDING_VERSION = 'overture-pinned-capture-v1';
export interface CaptureBytePin { sha256: string; bytes: number }
export interface CaptureExpectation {
  requestHash: string;
  request: AcquisitionRequest;
  extract: CaptureBytePin;
  receipt: CaptureBytePin;
}
export interface BoundCapture {
  version: typeof CAPTURE_BINDING_VERSION;
  captureHash: string;
  requestHash: string;
  extract: CaptureBytePin;
  receipt: CaptureBytePin;
  binding: FeatureIdentityBinding;
  /** Original order, including malformed/unsupported features for explicit disposition. */
  features: readonly unknown[];
}
export type ConfiguredCapture = BoundCapture & {
  sourceCompiler: ReturnType<typeof verifyCaptureRequestSource>['compiler'];
  sourceConfiguration: CaptureBytePin;
};

/** Mandatory composition for the future ingestion hook; the stages below remain independently testable. */
export function bindConfiguredCapture(
  extractBytes: Uint8Array, receiptBytes: Uint8Array, expected: CaptureExpectation,
  sourceConfiguration: { bytes: Uint8Array; pin: CaptureBytePin },
): ConfiguredCapture {
  if (!sourceConfiguration || !expected) throw new TypeError('Configured capture requires its source configuration and expectations.');
  const source = verifyCaptureRequestSource(sourceConfiguration.bytes, sourceConfiguration.pin, expected.requestHash, expected.request);
  const capture = bindCaptureSnapshots(extractBytes, receiptBytes, expected);
  return { ...capture, sourceCompiler: source.compiler, sourceConfiguration: source.sourceConfiguration };
}

const SHA = /^[a-f0-9]{64}$/;
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, expected: string[], label: string): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} fields do not match the capture contract.`);
  }
}
function count(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} is outside its bound.`);
  }
  return value;
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be bounded text.`);
  }
  return value;
}
function pin(bytes: Uint8Array, value: CaptureBytePin, max: number, label: string): CaptureBytePin {
  const raw = record(value, `${label} pin`);
  fields(raw, ['sha256', 'bytes'], `${label} pin`);
  if (typeof raw.sha256 !== 'string' || !SHA.test(raw.sha256)) throw new TypeError(`${label} pin hash is invalid.`);
  const size = count(raw.bytes, 1, max, `${label} pin bytes`);
  if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer || bytes.byteLength !== size) {
    throw new TypeError(`${label} does not match its unshared byte pin.`);
  }
  if (sha256(bytes) !== raw.sha256) throw new Error(`${label} SHA-256 does not match its pin.`);
  return { sha256: raw.sha256, bytes: size };
}
function selection(request: AcquisitionRequest): object {
  const { schemaVersion, id, inventoryUnitId, region, provider, release, layers } = request;
  return { schemaVersion, id, inventoryUnitId, region, provider, release, layers };
}

/**
 * Verify already acquired snapshots without acquisition, filesystem writes or ledger changes.
 * Expectations must come from the existing pinned acquisition/plan chain. This check does
 * not reconstruct the acquisition request hash from its historical source configuration,
 * authenticate upstream contents, establish coverage, or admit individual feature geometry.
 */
export function bindCaptureSnapshots(extractBytes: Uint8Array, receiptBytes: Uint8Array, expected: CaptureExpectation): BoundCapture {
  if (!expected || typeof expected.requestHash !== 'string' || !SHA.test(expected.requestHash)) throw new TypeError('Expected capture request hash is invalid.');
  const request = validateAcquisitionRequest(expected.request);
  const extractPin = pin(extractBytes, expected.extract, request.limits.outputBytes, 'Extract');
  const receiptPin = pin(receiptBytes, expected.receipt, 1_000_000, 'Receipt');
  const receipt = record(parseCaptureJson(receiptBytes, { bytes: 1_000_000 }), 'Receipt');
  fields(receipt, ['schemaVersion', 'requestHash', 'selection', 'request', 'completedAt', 'inputSha256', 'inputBytes', 'metrics', 'upstream', 'sources', 'exceptions'], 'Receipt');
  if (receipt.schemaVersion !== 1 || receipt.requestHash !== expected.requestHash
    || receipt.inputSha256 !== extractPin.sha256 || receipt.inputBytes !== extractPin.bytes) {
    throw new Error('Receipt identity or extract binding disagrees with its pins.');
  }
  const receiptRequest = validateAcquisitionRequest(receipt.request);
  // Acquisition identity excludes execution budgets: a later cache-only request may
  // reduce its limits without changing the original capture or paid network history.
  if (canonicalJson(selection(receiptRequest)) !== canonicalJson(selection(request))) throw new Error('Receipt request selection differs from the expected acquisition request.');
  count(extractPin.bytes, 1, receiptRequest.limits.outputBytes, 'Original extract bytes');
  const selected = record(receipt.selection, 'Receipt selection');
  fields(selected, ['schemaVersion', 'id', 'inventoryUnitId', 'region', 'provider', 'release', 'layers'], 'Receipt selection');
  // Validate all nested keys before canonicalization, which must never drop __proto__.
  validateAcquisitionRequest({ ...selected, limits: request.limits });
  if (canonicalJson(selected) !== canonicalJson(selection(request))) throw new Error('Receipt selection differs from its request.');
  const completedAt = text(receipt.completedAt, 64, 'Receipt completedAt');
  if (!Number.isFinite(Date.parse(completedAt))) throw new TypeError('Receipt completion timestamp is invalid.');

  const metrics = record(receipt.metrics, 'Receipt metrics');
  fields(metrics, ['networkBytes', 'outputBytes', 'features', 'elapsedMs'], 'Receipt metrics');
  const networkBytes = count(metrics.networkBytes, 0, receiptRequest.limits.networkBytes, 'Historical measured network bytes');
  count(metrics.elapsedMs, 1, receiptRequest.limits.durationMs, 'Historical measured duration');
  if (metrics.outputBytes !== extractPin.bytes) throw new Error('Receipt measured output bytes differ from the extract.');
  const featureCount = count(metrics.features, 0, Math.min(request.limits.features, receiptRequest.limits.features), 'Measured feature count');
  if (!Array.isArray(receipt.upstream) || receipt.upstream.length > 1_300) throw new TypeError('Receipt upstream list is invalid.');
  let measured = 0;
  for (const item of receipt.upstream) {
    const upstream = record(item, 'Upstream'); fields(upstream, ['url', 'etag', 'bytes'], 'Upstream');
    const url = new URL(text(upstream.url, 2_048, 'Upstream URL'));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !['stac.overturemaps.org', 'overturemaps-us-west-2.s3.us-west-2.amazonaws.com'].includes(url.hostname)
      || !url.pathname.includes(request.release)) throw new TypeError('Upstream URL is outside the pinned source policy.');
    if (upstream.etag !== null) text(upstream.etag, 512, 'Upstream ETag');
    measured += count(upstream.bytes, 1, receiptRequest.limits.networkBytes, 'Historical upstream bytes');
    if (measured > networkBytes) throw new Error('Upstream byte sum exceeds measured network bytes.');
  }
  if (measured !== networkBytes) throw new Error('Upstream byte sum differs from measured network bytes.');
  if (!Array.isArray(receipt.sources) || receipt.sources.length !== request.layers.length) throw new TypeError('Receipt sources do not match selected layers.');
  for (let i = 0; i < request.layers.length; i++) {
    const source = record(receipt.sources[i], 'Source');
    fields(source, ['id', 'url', 'release', 'license', 'attribution', 'sha256', 'bytes'], 'Source');
    const layer = request.layers[i]!;
    const suffix = layer === 'buildings' ? 'buildings/building' : 'transportation/segment';
    if (source.id !== `overture-${request.release}-${layer}` || source.release !== request.release
      || source.url !== `https://stac.overturemaps.org/${request.release}/${suffix}/collection.json`
      || source.license !== 'ODbL-1.0' || typeof source.sha256 !== 'string' || !SHA.test(source.sha256)
      || !text(source.attribution, 4_096, 'Source attribution').includes('https://docs.overturemaps.org/attribution/')) {
      throw new TypeError('Receipt source disagrees with its pinned layer policy.');
    }
    count(source.bytes, 1, receiptRequest.limits.outputBytes, 'Historical source bytes');
  }
  if (!Array.isArray(receipt.exceptions) || receipt.exceptions.length > 1_000
    || receipt.exceptions.some(item => typeof item !== 'string' || item.length > 300)) throw new TypeError('Receipt exceptions are invalid.');

  const extract = record(parseCaptureJson(extractBytes, { bytes: request.limits.outputBytes }), 'Extract');
  fields(extract, ['type', 'features', 'metadata'], 'Extract');
  if (extract.type !== 'FeatureCollection' || !Array.isArray(extract.features) || extract.features.length !== featureCount) {
    throw new Error('Extract type or original feature count disagrees with its receipt.');
  }
  const metadata = record(extract.metadata, 'Extract metadata');
  fields(metadata, ['provider', 'release', 'requestHash', 'exceptions', 'stacIndex'], 'Extract metadata');
  if (!Array.isArray(metadata.exceptions) || metadata.exceptions.length > 1_000
    || metadata.exceptions.some(item => typeof item !== 'string' || item.length > 300)) throw new TypeError('Extract exceptions are invalid.');
  if (metadata.provider !== request.provider || metadata.release !== request.release || metadata.requestHash !== expected.requestHash
    || canonicalJson(metadata.exceptions) !== canonicalJson(receipt.exceptions)) throw new Error('Extract metadata disagrees with its receipt.');
  const index = record(metadata.stacIndex, 'STAC index'); fields(index, ['sha256', 'itemCount', 'selectedCount'], 'STAC index');
  if (typeof index.sha256 !== 'string' || !SHA.test(index.sha256)) throw new TypeError('STAC index hash is invalid.');
  if (index.itemCount !== 640) throw new TypeError('STAC item count differs from the existing pinned release policy.');
  const itemCount = index.itemCount;
  count(index.selectedCount, 0, itemCount, 'STAC selected count');
  const stamp = { version: CAPTURE_BINDING_VERSION, requestHash: expected.requestHash, extract: extractPin, receipt: receiptPin } as const;
  return { ...stamp, captureHash: sha256(canonicalJson(stamp)), binding: { provider: request.provider, release: request.release, layers: [...request.layers] }, features: extract.features };
}
