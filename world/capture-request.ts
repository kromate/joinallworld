import { validateAcquisitionRequest } from './acquire.ts';
import { parseCaptureJson } from './capture-json.ts';
import { canonicalJson, sha256 } from './pack.ts';
import type { AcquisitionRequest } from './production-types.ts';
import type { CaptureBytePin } from './capture-binding.ts';

export const CAPTURE_REQUEST_COMPILER = 'world-source-compiler-v2';
export const CAPTURE_SOURCE_CONFIG_BYTES = 64_000;

function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) {
    throw new TypeError(`${label} fields differ from the pinned configuration contract.`);
  }
  return result;
}

/**
 * Reconstruct the existing acquisition identity from retained source configuration.
 * No source access, ledger writes or budget reset. The raw configuration pin and
 * expected request hash must be retained independently of this computation.
 */
export function verifyCaptureRequestSource(
  bytes: Uint8Array, sourcePin: CaptureBytePin, requestHash: string, value: AcquisitionRequest,
): { compiler: typeof CAPTURE_REQUEST_COMPILER; requestHash: string; sourceConfiguration: CaptureBytePin } {
  const request = validateAcquisitionRequest(value);
  if (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(requestHash)) throw new TypeError('Expected request hash is invalid.');
  const pin = object(sourcePin, ['sha256', 'bytes'], 'Source configuration pin');
  if (typeof pin.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sha256)
    || typeof pin.bytes !== 'number' || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > CAPTURE_SOURCE_CONFIG_BYTES) {
    throw new RangeError('Source configuration pin exceeds its bound or has an invalid hash.');
  }
  if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer || bytes.byteLength !== pin.bytes) {
    throw new TypeError('Source configuration does not match its unshared byte pin.');
  }
  if (sha256(bytes) !== pin.sha256) throw new Error('Source configuration bytes differ from their pinned SHA-256.');
  const config = object(parseCaptureJson(bytes, { bytes: CAPTURE_SOURCE_CONFIG_BYTES, nodes: 1_000, depth: 8 }),
    ['schemaVersion', 'provider', 'release', 'releaseStatus', 'stac', 'licenses', 'attributionUrl', 'attribution'], 'Source configuration');
  if (config.schemaVersion !== 1 || config.provider !== request.provider || config.release !== request.release
    || config.releaseStatus !== 'official-static-stac-items-verified' || config.attributionUrl !== 'https://docs.overturemaps.org/attribution/') {
    throw new TypeError('Source configuration does not describe the admitted pinned release.');
  }
  const stac = object(config.stac, ['catalogUrl', 'collections', 'allowedAssetHost'], 'STAC configuration');
  if (stac.catalogUrl !== `https://stac.overturemaps.org/${request.release}/catalog.json`
    || stac.allowedAssetHost !== 'overturemaps-us-west-2.s3.us-west-2.amazonaws.com') throw new TypeError('STAC configuration URLs differ from pinned policy.');
  const collections = object(stac.collections, ['buildings', 'roads'], 'STAC collections');
  const licenses = object(config.licenses, ['buildings', 'roads'], 'Source licenses');
  const attribution = object(config.attribution, ['buildings', 'roads'], 'Source attribution');
  for (const layer of ['buildings', 'roads'] as const) {
    const collection = object(collections[layer], ['id', 'url', 'itemCount', 'dataType'], `STAC ${layer}`);
    const building = layer === 'buildings', id = building ? 'building' : 'segment';
    if (collection.id !== id || collection.dataType !== id || collection.itemCount !== (building ? 512 : 128)
      || collection.url !== `https://stac.overturemaps.org/${request.release}/${building ? 'buildings/building' : 'transportation/segment'}/collection.json`
      || licenses[layer] !== 'ODbL-1.0' || typeof attribution[layer] !== 'string'
      || attribution[layer].length > 4_096 || !attribution[layer].includes('https://docs.overturemaps.org/attribution/')) {
      throw new TypeError('Source collection, license or attribution differs from pinned policy.');
    }
  }
  const { schemaVersion, id, inventoryUnitId, region, provider, release, layers } = request;
  const selection = { schemaVersion, id, inventoryUnitId, region, provider, release, layers };
  // Exact compatibility with acquire.ts: no newline and no execution limits in the hash.
  const reconstructed = sha256(canonicalJson({ compiler: CAPTURE_REQUEST_COMPILER, selection, sourceConfig: config }));
  if (reconstructed !== requestHash) throw new Error('Acquisition request hash does not reconstruct from its retained source configuration and selection.');
  return { compiler: CAPTURE_REQUEST_COMPILER, requestHash: reconstructed, sourceConfiguration: { sha256: pin.sha256, bytes: pin.bytes } };
}
