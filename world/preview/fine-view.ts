import type { FineAdminNode, FineSourcePin, FineTopologyReport } from '../fine-types.ts';
import { FINE_PLANAR_EXCEPTION, validateFineTopologyReport } from '../fine-quality.ts';
import { fetchInventoryAsset } from './inventory-view.ts';

interface FineManifestBase {
  countryId: string;
  coarseInventoryHash: string;
  source: FineSourcePin;
  sourceUnitCount: number;
  nodeIndexPath: string;
  registryPath: string;
  coveragePath: string;
  exceptions: string[];
}
export interface FineManifestV1 extends FineManifestBase { schemaVersion: 1 }
export interface FineManifestV2 extends FineManifestBase {
  schemaVersion: 2;
  compiler: 'fine-inventory-compiler-v2';
  topologyPath: string;
}
export type FineManifest = FineManifestV1 | FineManifestV2;

export interface FineIndexEntry { node: FineAdminNode; outlinePath: string }
export interface FineIndex { schemaVersion: 1; countryId: string; nodes: FineIndexEntry[] }
export interface FineGeometry { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }

export const FINE_VIEW_LIMITS = Object.freeze({ manifestBytes: 128 * 1024, indexBytes: 128 * 1024, topologyBytes: 64 * 1024, outlineBytes: 2 * 1024 * 1024, nodes: 32, positions: 40_000, requestTimeoutMs: 25_000 });
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const COUNTRY_ID = /^(?!legacy-ng$)[A-Za-z0-9][A-Za-z0-9:_%.-]{0,255}$/;
const HASH_PATHS = {
  nodeIndexPath: /^node-index\/[a-f0-9]{64}\.json$/,
  registryPath: /^registries\/[a-f0-9]{64}\.json$/,
  coveragePath: /^coverage\/[a-f0-9]{64}\.json$/,
  topologyPath: /^topology\/[a-f0-9]{64}\.json$/,
  outlinePath: /^outlines\/[a-f0-9]{64}\.json$/,
} as const;
const own = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
};
function exact(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${label} has missing or unknown fields`);
}
function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
function stringArray(value: unknown, label: string, maxItems: number, maxText = 2048, allowEmpty = true): string[] {
  if (!Array.isArray(value) || value.length > maxItems || (!allowEmpty && value.length === 0)) throw new TypeError(`${label} is invalid`);
  return value.map((item, i) => text(item, `${label}[${i}]`, maxText));
}
function hashPath(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${label} must be a content-hash path`);
  return value;
}
function validateSourcePin(value: unknown): FineSourcePin {
  const pin = own(value, 'fine source pin');
  exact(pin, ['schemaVersion','provider','source','input','countryCode','countryIso3','adminLevel','layerId','canonicalType','representedYear','buildDate','expectedUnits','originalLicense','licenseEvidence','metadataSha256','metadataBytes','boundaryPolicy'], 'fine source pin');
  if (pin.schemaVersion !== 1 || pin.provider !== 'geoBoundaries' || pin.adminLevel !== 'ADM1') throw new TypeError('fine source pin schema/provider/level is invalid');
  const countryCode = text(pin.countryCode, 'fine country code', 2), countryIso3 = text(pin.countryIso3, 'fine ISO3', 3);
  if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{3}$/.test(countryIso3) || countryCode === 'NG' || countryIso3 === 'NGA') throw new TypeError('fine source country is invalid or protected Nigeria');
  const source = own(pin.source, 'fine source');
  exact(source, ['id','url','release','license','attribution','sha256','bytes'], 'fine source');
  text(source.id, 'fine source id', 256);
  const release = text(source.release, 'fine source release', 40);
  if (!COMMIT.test(release)) throw new TypeError('fine source release must be a full commit');
  const url = text(source.url, 'fine source URL', 2048);
  const suffix = `${release}/releaseData/gbOpen/${countryIso3}/ADM1/geoBoundaries-${countryIso3}-ADM1.geojson`;
  if (url !== `https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${suffix}` && url !== `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${suffix}`) throw new TypeError('fine source URL is not the exact pinned geoBoundaries asset');
  text(source.license, 'fine package license', 256); text(source.attribution, 'fine attribution', 2048);
  if (typeof source.sha256 !== 'string' || !HASH.test(source.sha256) || !Number.isSafeInteger(source.bytes) || Number(source.bytes) < 1 || Number(source.bytes) > 8 * 1024 * 1024) throw new TypeError('fine source byte/hash pin is invalid');
  const input = text(pin.input, 'fine input path', 512);
  if (input !== `.cache/world-build/fine-source-cache/${source.sha256}.geojson`) throw new TypeError('fine input path must match pinned source hash');
  if (typeof pin.layerId !== 'string' || !pin.layerId.startsWith(`${countryIso3}-ADM1-`)) throw new TypeError('fine source layer ID does not match pin');
  text(pin.canonicalType, 'fine canonical type', 128);
  if (typeof pin.representedYear !== 'string' || !/^(?:19|20)\d{2}$/.test(pin.representedYear)) throw new TypeError('fine represented year is invalid');
  text(pin.buildDate, 'fine build date', 32);
  if (!Number.isSafeInteger(pin.expectedUnits) || Number(pin.expectedUnits) < 1 || Number(pin.expectedUnits) > FINE_VIEW_LIMITS.nodes) throw new TypeError('fine expected source units exceed limit');
  text(pin.originalLicense, 'fine original license', 512);
  const licenseEvidence = stringArray(pin.licenseEvidence, 'fine license evidence', 16, 2048, false);
  if (new Set(licenseEvidence).size !== licenseEvidence.length) throw new TypeError('fine license evidence entries must be unique');
  if (typeof pin.metadataSha256 !== 'string' || !HASH.test(pin.metadataSha256) || !Number.isSafeInteger(pin.metadataBytes) || Number(pin.metadataBytes) < 1 || Number(pin.metadataBytes) > 64 * 1024) throw new TypeError('fine metadata pin is invalid');
  text(pin.boundaryPolicy, 'fine boundary policy', 2048);
  return value as FineSourcePin;
}

export function validateFineManifest(value: unknown, expectedCoarseHash: string, expectedCountryId: string): FineManifest {
  if (!HASH.test(expectedCoarseHash) || !COUNTRY_ID.test(expectedCountryId)) throw new TypeError('expected coarse inventory identity is invalid');
  const manifest = own(value, 'fine manifest');
  if (manifest.countryId !== expectedCountryId || manifest.coarseInventoryHash !== expectedCoarseHash) throw new TypeError('fine manifest is for a different country or coarse inventory');
  if (manifest.schemaVersion === 1) exact(manifest, ['schemaVersion','countryId','coarseInventoryHash','source','sourceUnitCount','nodeIndexPath','registryPath','coveragePath','exceptions'], 'fine manifest');
  else if (manifest.schemaVersion === 2) exact(manifest, ['schemaVersion','countryId','coarseInventoryHash','source','sourceUnitCount','nodeIndexPath','registryPath','coveragePath','exceptions','compiler','topologyPath'], 'fine manifest');
  else throw new TypeError('fine manifest schema version is unsupported');
  const source = validateSourcePin(manifest.source);
  if (!Number.isSafeInteger(manifest.sourceUnitCount) || manifest.sourceUnitCount !== source.expectedUnits) throw new TypeError('fine manifest source count does not match its source pin');
  const nodeIndexPath = hashPath(manifest.nodeIndexPath, HASH_PATHS.nodeIndexPath, 'fine node index path');
  const registryPath = hashPath(manifest.registryPath, HASH_PATHS.registryPath, 'fine registry path');
  const coveragePath = hashPath(manifest.coveragePath, HASH_PATHS.coveragePath, 'fine coverage path');
  const exceptions = stringArray(manifest.exceptions, 'fine manifest exceptions', 256);
  const base = { countryId: expectedCountryId, coarseInventoryHash: expectedCoarseHash, source,
    sourceUnitCount: Number(manifest.sourceUnitCount), nodeIndexPath, registryPath, coveragePath, exceptions };
  if (manifest.schemaVersion === 1) return { schemaVersion: 1, ...base };
  if (manifest.compiler !== 'fine-inventory-compiler-v2') throw new TypeError('fine manifest compiler is unsupported');
  const topologyPath = hashPath(manifest.topologyPath, HASH_PATHS.topologyPath, 'fine topology path');
  if (!exceptions.includes(FINE_PLANAR_EXCEPTION)) throw new TypeError('fine manifest is missing the exact planar topology limitation');
  if (exceptions.some(exception => /structural|not (?:yet )?(?:validated|checked|established)|topology (?:is )?not/i.test(exception))) throw new TypeError('fine manifest contains an obsolete or unsupported topology claim');
  return { schemaVersion: 2, ...base, compiler: 'fine-inventory-compiler-v2', topologyPath };
}

/** A schema-2 manifest is not admitted until its report proves every indexed source unit valid. */
export function validateFineTopology(value: unknown, manifest: FineManifestV2, index: FineIndex): FineTopologyReport {
  if (index.countryId !== manifest.countryId || index.nodes.length !== manifest.sourceUnitCount) throw new TypeError('fine topology index/manifest binding is invalid');
  const expectedKeys = index.nodes.map(({ node }) => node.sourceRef.featureKey);
  const report = validateFineTopologyReport(value, manifest.source, expectedKeys);
  if (report.validUnits !== manifest.sourceUnitCount || report.checkedUnits !== manifest.sourceUnitCount || report.invalidUnits !== 0 || report.unsupportedUnits !== 0) {
    throw new Error('fine topology report must pass every indexed source division with no invalid or unsupported units');
  }
  if (JSON.stringify(manifest.exceptions) !== JSON.stringify(report.exceptions)) throw new Error('fine topology report limitations differ from the manifest');
  return report;
}

function bounds(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) throw new TypeError(`${label} bounds are invalid`);
  const values = value as number[];
  const west = values[0]!, south = values[1]!, east = values[2]!, north = values[3]!;
  if (west < -180 || west > 180 || east < -180 || east > 180 || south < -90 || north > 90 || south > north) throw new RangeError(`${label} bounds are outside WGS84`);
  return [...value] as number[];
}
function validateAdminNode(value: unknown, expectedCountryId: string): FineAdminNode {
  const node = own(value, 'fine admin node');
  exact(node, ['id','parentId','countryCode','name','kind','adminLevel','adminType','bounds','aliases','sourceRef','coverage','exceptions'], 'fine admin node');
  const id = text(node.id, 'fine admin ID', 128);
  if (!/^admin:geoBoundaries:[a-f0-9]{64}$/.test(id)) throw new TypeError('fine admin ID is invalid');
  if (node.parentId !== expectedCountryId || node.kind !== 'admin' || node.adminLevel !== 'ADM1' || node.coverage !== 'geographic-outline') throw new TypeError('fine admin hierarchy or coverage is invalid');
  const countryCode = text(node.countryCode, 'fine node country code', 2);
  if (!/^[A-Z]{2}$/.test(countryCode) || countryCode === 'NG') throw new TypeError('fine node country code is invalid or protected');
  const name = text(node.name, 'fine admin name', 256), adminType = text(node.adminType, 'fine admin type', 128);
  const nodeBounds = bounds(node.bounds, 'fine admin node');
  const aliases = stringArray(node.aliases, 'fine admin aliases', 256, 256);
  const exceptions = stringArray(node.exceptions, 'fine admin exceptions', 32);
  const sourceRef = own(node.sourceRef, 'fine source reference');
  exact(sourceRef, ['sourceId','release','layerId','featureKey'], 'fine source reference');
  const sourceId = text(sourceRef.sourceId, 'fine source reference ID', 256);
  const release = text(sourceRef.release, 'fine source reference release', 40);
  if (!COMMIT.test(release)) throw new TypeError('fine source reference release is not commit-pinned');
  const layerId = text(sourceRef.layerId, 'fine source reference layer', 256);
  if (!/^[A-Z]{3}-ADM1-[A-Za-z0-9-]+$/.test(layerId)) throw new TypeError('fine source reference layer is invalid');
  const featureKey = text(sourceRef.featureKey, 'fine source feature key', 256);
  return { id, parentId: expectedCountryId, countryCode, name, kind: 'admin', adminLevel: 'ADM1', adminType,
    bounds: nodeBounds as FineAdminNode['bounds'], aliases, sourceRef: { sourceId, release, layerId, featureKey }, coverage: 'geographic-outline', exceptions };
}

export function validateFineIndex(value: unknown, expectedCountryId: string, expectedUnits: number): FineIndex {
  if (!COUNTRY_ID.test(expectedCountryId) || !Number.isSafeInteger(expectedUnits) || expectedUnits < 1 || expectedUnits > FINE_VIEW_LIMITS.nodes) throw new TypeError('expected fine index identity/count is invalid');
  const index = own(value, 'fine node index');
  exact(index, ['schemaVersion','countryId','nodes'], 'fine node index');
  if (index.schemaVersion !== 1 || index.countryId !== expectedCountryId || !Array.isArray(index.nodes) || index.nodes.length !== expectedUnits) throw new TypeError('fine node index schema/country/count is invalid');
  const ids = new Set<string>(), keys = new Set<string>();
  let provenance: string | undefined;
  const nodes = index.nodes.map((raw, i) => {
    const item = own(raw, `fine node entry ${i}`);
    exact(item, ['node','outlinePath'], `fine node entry ${i}`);
    const node = validateAdminNode(item.node, expectedCountryId);
    if (ids.has(node.id)) throw new TypeError('fine node IDs must be unique');
    ids.add(node.id);
    if (keys.has(node.sourceRef.featureKey)) throw new TypeError('fine source feature keys must be unique');
    keys.add(node.sourceRef.featureKey);
    const identity = `${node.sourceRef.sourceId}\0${node.sourceRef.release}\0${node.sourceRef.layerId}`;
    if (provenance !== undefined && provenance !== identity) throw new TypeError('fine index mixes source provenance');
    provenance = identity;
    const outlinePath = hashPath(item.outlinePath, HASH_PATHS.outlinePath, 'fine outline path');
    return { node, outlinePath };
  });
  return { schemaVersion: 1, countryId: expectedCountryId, nodes };
}

/** Bind the bounded index to the already-validated manifest and selected coarse country. */
export function validateFineIndexProvenance(index: FineIndex, manifest: FineManifest, expectedCountryCode: string): FineIndex {
  if (!index || !manifest || index.countryId !== manifest.countryId || !/^[A-Z]{2}$/.test(expectedCountryCode) || expectedCountryCode === 'NG') throw new TypeError('fine index/manifest/country provenance is invalid');
  if (manifest.source.countryCode !== expectedCountryCode || manifest.source.countryIso3 === 'NGA') throw new TypeError('fine source pin does not match selected coarse country');
  for (const { node } of index.nodes) {
    if (node.countryCode !== expectedCountryCode || node.sourceRef.sourceId !== manifest.source.source.id
      || node.sourceRef.release !== manifest.source.source.release || node.sourceRef.layerId !== manifest.source.layerId
      || node.adminType !== manifest.source.canonicalType) throw new TypeError(`fine node ${node.id} provenance does not match its manifest/country`);
  }
  return index;
}

function ring(value: unknown, state: { positions: number }): number[][] {
  if (!Array.isArray(value) || value.length < 4) throw new TypeError('fine polygon ring requires at least four positions');
  const result = value.map((raw, i) => {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4 || raw.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new TypeError(`fine polygon position ${i} is invalid`);
    const lon = raw[0] as number, lat = raw[1] as number;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new RangeError('fine polygon position is outside WGS84');
    state.positions++;
    if (state.positions > FINE_VIEW_LIMITS.positions) throw new RangeError('fine outline exceeds 40,000 coordinate positions');
    return raw.map(Number);
  });
  const first = result[0]!, last = result[result.length - 1]!;
  if (first.length !== last.length || first.some((value, i) => value !== last[i])) throw new TypeError('fine polygon ring is not closed');
  if (new Set(result.slice(0, -1).map(point => `${point[0]},${point[1]}`)).size < 3) throw new TypeError('fine polygon ring has fewer than three distinct vertices');
  return result;
}
function polygon(value: unknown, state: { positions: number }): number[][][] {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError('fine polygon must contain an exterior ring');
  return value.map(rawRing => ring(rawRing, state));
}
export function validateFineOutline(value: unknown): FineGeometry {
  const geometry = own(value, 'fine outline');
  exact(geometry, ['type','coordinates'], 'fine outline');
  const state = { positions: 0 };
  if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: polygon(geometry.coordinates, state) };
  if (geometry.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 1) throw new TypeError('fine outline must be Polygon or MultiPolygon');
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(item => polygon(item, state)) };
}

/** Fetch bounded JSON, enforce its content hash, and leave schema validation to the caller. */
export async function fetchFineJson(url: string, expectedHash: string, maxBytes: number, signal?: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<{ value: unknown; bytes: number }> {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { throw new TypeError('fine JSON URL/hash is invalid'); }
  const loopbackHttp = parsedUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname.toLowerCase());
  if ((parsedUrl.protocol !== 'https:' && !loopbackHttp) || parsedUrl.username || parsedUrl.password || !HASH.test(expectedHash)) throw new TypeError('fine JSON URL/hash is invalid');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > FINE_VIEW_LIMITS.outlineBytes) throw new RangeError('fine JSON byte limit must be within 1..2 MiB');
  if (signal?.aborted) throw signal.reason ?? new DOMException('Fine asset request was aborted.', 'AbortError');
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new DOMException('Fine asset request exceeded 25 seconds.', 'TimeoutError');
      controller.abort(error);
      reject(error);
      }, FINE_VIEW_LIMITS.requestTimeoutMs);
  });
  try {
    return await Promise.race([
      fetchInventoryAsset(url, expectedHash, maxBytes, controller.signal, value => value, fetcher),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
