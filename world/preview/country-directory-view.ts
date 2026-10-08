import type { InventoryNode } from '../production-types.ts';
import { COUNTRY_DIRECTORY_COMPILER, COUNTRY_DIRECTORY_LIMITS } from '../country-directory-types.ts';
import type { CountryDirectoryManifest, CountryDirectoryNodeIndex, CountryOutlineIndex } from '../country-directory-types.ts';
import type { CountryIdentityComparison } from '../country-types.ts';
import type { SourceRecord } from '../types.ts';
import type { InventoryGeometry } from './inventory-view.ts';

const HASH = /^[a-f0-9]{64}$/;
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
};
function exact(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${label} has missing or unknown fields`);
}
function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
function strings(value: unknown, label: string, max = 10_000): string[] {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${label} is invalid`);
  return value.map((entry, index) => text(entry, `${label}[${index}]`));
}
function hashPath(value: unknown, folder: string): value is string { return typeof value === 'string' && new RegExp(`^${folder}/[a-f0-9]{64}\\.json$`).test(value); }
function source(value: unknown, label: string): SourceRecord {
  const item = object(value, label);
  exact(item, ['id','url','release','license','attribution','sha256','bytes'], label);
  const id = text(item.id, `${label}.id`, 256), url = text(item.url, `${label}.url`, 2048), release = text(item.release, `${label}.release`, 256);
  const license = text(item.license, `${label}.license`, 512), attribution = text(item.attribution, `${label}.attribution`, 2048);
  if (typeof item.sha256 !== 'string' || !HASH.test(item.sha256) || !Number.isSafeInteger(item.bytes) || Number(item.bytes) < 1 || Number(item.bytes) > 100_000_000) throw new TypeError(`${label} byte/hash pin is invalid`);
  return { id, url, release, license, attribution, sha256: item.sha256, bytes: Number(item.bytes) };
}

export function validateCountryDirectoryManifest(value: unknown): CountryDirectoryManifest {
  const manifest = object(value, 'country directory manifest');
  exact(manifest, ['schemaVersion','compiler','source','baselineSource','baselineInventoryHash','sourceUnitCount','nodeCount','outlineCount','partCount','rootNodePath','identityPath','rollups','representation','limits','exceptions'], 'country directory manifest');
  if (manifest.schemaVersion !== 1 || manifest.compiler !== COUNTRY_DIRECTORY_COMPILER || manifest.representation !== 'whole-polygon-groups') throw new TypeError('country directory schema/compiler/representation is unsupported');
  const src = source(manifest.source, 'candidate source'), baseline = source(manifest.baselineSource, 'baseline source');
  if (typeof manifest.baselineInventoryHash !== 'string' || !HASH.test(manifest.baselineInventoryHash)) throw new TypeError('baseline inventory hash is invalid');
  const boundedCount = (value: unknown, label: string, max: number): number => {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) throw new RangeError(`${label} is outside its bounded range`);
    return Number(value);
  };
  const sourceUnitCount = boundedCount(manifest.sourceUnitCount, 'source unit count', 10_000);
  const nodeCount = boundedCount(manifest.nodeCount, 'node count', 10_100);
  const outlineCount = boundedCount(manifest.outlineCount, 'outline count', 10_000);
  const partCount = boundedCount(manifest.partCount, 'part count', 100_000);
  if (sourceUnitCount < 1 || nodeCount < 1 || outlineCount > sourceUnitCount || partCount < outlineCount) throw new TypeError('country directory counts are inconsistent');
  if (!hashPath(manifest.rootNodePath, 'nodes') || !hashPath(manifest.identityPath, 'identity')) throw new TypeError('country directory references must be content-hashed paths');
  const limits = object(manifest.limits, 'country directory limits');
  exact(limits, ['partBytes','countryBytes','positions'], 'country directory limits');
  if (limits.partBytes !== COUNTRY_DIRECTORY_LIMITS.partBytes || limits.countryBytes !== COUNTRY_DIRECTORY_LIMITS.countryBytes || limits.positions !== COUNTRY_DIRECTORY_LIMITS.positions) throw new Error('country directory limits differ from the compiled contract');
  if (!Array.isArray(manifest.rollups) || manifest.rollups.length > 512) throw new TypeError('country directory rollups are invalid');
  const rollups = manifest.rollups.map((raw, index) => {
    const item = object(raw, `rollups[${index}]`); exact(item, ['id','name','countryCount','sourceUnitCount','exceptionCount'], `rollups[${index}]`);
    const id = text(item.id, `rollups[${index}].id`, 256), name = text(item.name, `rollups[${index}].name`, 256);
    const countryCount = boundedCount(item.countryCount, 'rollup country count', 10_000), units = boundedCount(item.sourceUnitCount, 'rollup source count', 10_000), exceptionCount = boundedCount(item.exceptionCount, 'rollup exception count', 100_000);
    return { id, name, countryCount, sourceUnitCount: units, exceptionCount };
  });
  if (new Set(rollups.map(item => item.id)).size !== rollups.length || rollups.reduce((sum, item) => sum + item.sourceUnitCount, 0) !== sourceUnitCount
      || rollups.some(item => item.countryCount !== item.sourceUnitCount)) throw new Error('country directory rollups are duplicated or do not conserve source countries');
  return { schemaVersion: 1, compiler: COUNTRY_DIRECTORY_COMPILER, source: src, baselineSource: baseline, baselineInventoryHash: manifest.baselineInventoryHash,
    sourceUnitCount, nodeCount, outlineCount, partCount, rootNodePath: manifest.rootNodePath, identityPath: manifest.identityPath,
    rollups, representation: 'whole-polygon-groups', limits: { partBytes: 512000, countryBytes: 2097152, positions: 100000 }, exceptions: strings(manifest.exceptions, 'manifest exceptions') };
}

export function validateCountryIdentity(value: unknown, manifest: CountryDirectoryManifest): CountryIdentityComparison {
  const identity = object(value, 'country identity comparison');
  exact(identity, ['schemaVersion','baselineSourceId','candidateSourceId','baselineUnits','candidateUnits','retained','added','missing','protectedCountryId','exceptions'], 'country identity comparison');
  if (identity.schemaVersion !== 1 || identity.baselineSourceId !== manifest.baselineSource.id || identity.candidateSourceId !== manifest.source.id || identity.protectedCountryId !== 'legacy-ng') throw new Error('country identity source/protection binding is invalid');
  const count = (candidate: unknown, label: string): number => {
    if (!Number.isSafeInteger(candidate) || Number(candidate) < 0 || Number(candidate) > 10_000) throw new RangeError(`${label} is invalid`);
    return Number(candidate);
  };
  const baselineUnits = count(identity.baselineUnits, 'baseline identity units'), candidateUnits = count(identity.candidateUnits, 'candidate identity units');
  if (candidateUnits !== manifest.sourceUnitCount || !Array.isArray(identity.retained) || !Array.isArray(identity.added) || !Array.isArray(identity.missing)
      || identity.retained.length > 10_000 || identity.added.length > 10_000 || identity.missing.length > 10_000 || identity.missing.length !== 0) throw new Error('country identity comparison counts are incomplete');
  const rows = <T>(input: unknown[], label: string, keys: string[]): T[] => input.map((raw, index) => {
    const row = object(raw, `${label}[${index}]`); exact(row, keys, `${label}[${index}]`); return row as T;
  });
  const retained = rows<CountryIdentityComparison['retained'][number]>(identity.retained, 'retained identities', ['featureKey','countryId','baselineName','candidateName','metadataChanged']);
  const added = rows<CountryIdentityComparison['added'][number]>(identity.added, 'added identities', ['featureKey','countryId','name']);
  const missing = rows<CountryIdentityComparison['missing'][number]>(identity.missing, 'missing identities', ['featureKey','countryId','name']);
  const validateRow = (row: { featureKey: string; countryId: string }, label: string): void => { text(row.featureKey, `${label} feature key`, 512); text(row.countryId, `${label} country ID`, 512); };
  const featureKeys = new Set<string>(), countryIds = new Set<string>(); let protectedNigeria = 0;
  const validateIdentity = (row: { featureKey: string; countryId: string }, label: string): void => {
    validateRow(row, label);
    const match = /^NE_ID:(0|-?[1-9][0-9]*)$/.exec(row.featureKey);
    if (!match || !Number.isSafeInteger(Number(match[1])) || String(Number(match[1])) !== match[1]) throw new TypeError(`${label} feature key is not a canonical Natural Earth NE_ID`);
    const expectedId = `country:natural-earth:${encodeURIComponent(row.featureKey)}`;
    if (row.countryId === 'legacy-ng') protectedNigeria++;
    else if (row.countryId !== expectedId) throw new Error(`${label} country ID does not match its stable Natural Earth identity`);
    if (featureKeys.has(row.featureKey) || countryIds.has(row.countryId)) throw new Error('country identity rows repeat a feature key or country ID');
    featureKeys.add(row.featureKey); countryIds.add(row.countryId);
  };
  retained.forEach((row, index) => {
    validateIdentity(row, `retained[${index}]`); text(row.baselineName, 'baseline country name', 2048); text(row.candidateName, 'candidate country name', 2048);
    if (typeof row.metadataChanged !== 'boolean') throw new TypeError('identity metadata change flag is invalid');
  });
  added.forEach((row, index) => { validateIdentity(row, `added[${index}]`); text(row.name, `added[${index}] name`, 2048); });
  missing.forEach((row, index) => { validateRow(row, `missing[${index}]`); text(row.name, `missing[${index}] name`, 2048); });
  if (protectedNigeria !== 1 || retained.length !== baselineUnits || retained.length + added.length !== candidateUnits) throw new Error('country identity rows do not conserve source units or protected Nigeria');
  return { schemaVersion: 1, baselineSourceId: manifest.baselineSource.id, candidateSourceId: manifest.source.id, baselineUnits, candidateUnits,
    retained, added, missing, protectedCountryId: 'legacy-ng', exceptions: strings(identity.exceptions, 'identity exceptions') };
}

function validateNode(value: unknown, expectedId?: string, expectedParent?: string | null): InventoryNode {
  const node = object(value, 'directory node');
  exact(node, ['id','parentId','name','kind','countryCode','bounds','sourceFeatureIds','provider','outline','exceptions'], 'directory node');
  const id = text(node.id, 'node ID', 512), name = text(node.name, 'node name', 2048);
  if (expectedId !== undefined && id !== expectedId || expectedParent !== undefined && node.parentId !== expectedParent) throw new Error('directory node identity or parent binding mismatch');
  const kind = node.kind;
  if (kind !== 'world' && kind !== 'continent' && kind !== 'country') throw new TypeError('directory node kind is invalid');
  if (!(node.parentId === null || typeof node.parentId === 'string') || (node.countryCode !== null && (typeof node.countryCode !== 'string' || !/^[A-Z]{2}$/.test(node.countryCode)))) throw new TypeError('directory node hierarchy or country code is invalid');
  if (node.provider !== 'world' && node.provider !== 'legacy-ng') throw new TypeError('directory node provider is invalid');
  if (node.outline !== 'available' && node.outline !== 'missing') throw new TypeError('directory outline availability is invalid');
  if (node.bounds !== null && (!Array.isArray(node.bounds) || node.bounds.length !== 4 || !node.bounds.every(Number.isFinite) || Number(node.bounds[0]) < -180 || Number(node.bounds[0]) > 180 || Number(node.bounds[2]) < -180 || Number(node.bounds[2]) > 180 || Number(node.bounds[1]) < -90 || Number(node.bounds[3]) > 90 || Number(node.bounds[1]) > Number(node.bounds[3]))) throw new TypeError('directory node bounds are invalid');
  const sourceFeatureIds = strings(node.sourceFeatureIds, 'node source references', 10_000), exceptions = strings(node.exceptions, 'node exceptions', 10_000);
  if (new Set(sourceFeatureIds).size !== sourceFeatureIds.length) throw new Error('directory node source references are duplicated');
  if (kind !== 'country' && sourceFeatureIds.length !== 0 || kind === 'country' && sourceFeatureIds.length !== 1) throw new Error('directory node source references do not match its hierarchy kind');
  if (node.provider === 'legacy-ng' && (id !== 'legacy-ng' || kind !== 'country' || node.countryCode !== 'NG' || node.outline !== 'missing')) throw new Error('protected legacy Nigeria node is invalid');
  if (node.countryCode === 'NG' && node.provider !== 'legacy-ng') throw new Error('Nigeria must use the protected legacy provider');
  return { id, parentId: node.parentId as string | null, name, kind, countryCode: node.countryCode as string | null,
    bounds: node.bounds as InventoryNode['bounds'], sourceFeatureIds, provider: node.provider, outline: node.outline, exceptions };
}

export function validateCountryDirectoryNodeIndex(value: unknown, manifest: CountryDirectoryManifest, expectedId: string, expectedParent: string | null): CountryDirectoryNodeIndex {
  const index = object(value, 'country directory node index');
  exact(index, ['schemaVersion','node','outlineIndexPath','children'], 'country directory node index');
  if (index.schemaVersion !== 1) throw new TypeError('country directory node index schema is unsupported');
  const node = validateNode(index.node, expectedId, expectedParent);
  if (node.sourceFeatureIds.some(reference => !reference.startsWith(`${manifest.source.id}:`))) throw new Error('node source references do not match candidate source pin');
  if (node.kind === 'country') {
    const featureKey = node.sourceFeatureIds[0]!.slice(manifest.source.id.length + 1);
    const match = /^NE_ID:(0|-?[1-9][0-9]*)$/.exec(featureKey);
    if (!match || !Number.isSafeInteger(Number(match[1])) || String(Number(match[1])) !== match[1]) throw new Error('country source reference is not a canonical NE_ID');
    const expectedStableId = node.countryCode === 'NG' ? 'legacy-ng' : `country:natural-earth:${encodeURIComponent(featureKey)}`;
    if (node.id !== expectedStableId || (node.countryCode === 'NG') !== (node.provider === 'legacy-ng')) throw new Error('country node ID/provider differs from its source identity');
  }
  if (!(index.outlineIndexPath === null || hashPath(index.outlineIndexPath, 'outline-index'))) throw new TypeError('outline index path is invalid');
  if (node.kind !== 'country' && (index.outlineIndexPath !== null || node.outline !== 'missing')) throw new Error('world and continent indexes cannot hold outlines');
  if (node.kind === 'country' && ((node.outline === 'available') !== (index.outlineIndexPath !== null))) throw new Error('country outline state and index reference disagree');
  if (node.id === 'legacy-ng' || node.countryCode === 'NG' || node.provider === 'legacy-ng') {
    if (index.outlineIndexPath !== null) throw new Error('protected Nigeria outline reference is forbidden');
  }
  if (!Array.isArray(index.children) || index.children.length > manifest.nodeCount) throw new TypeError('directory children are invalid');
  const children = index.children.map((raw, position) => {
    const child = object(raw, `directory child ${position}`); exact(child, ['id','name','path'], `directory child ${position}`);
    return { id: text(child.id, 'child ID', 512), name: text(child.name, 'child name', 2048), path: (() => { if (!hashPath(child.path, 'nodes')) throw new TypeError('child node path is invalid'); return child.path; })() };
  });
  if (new Set(children.map(child => child.id)).size !== children.length || (node.kind === 'country' && children.length)) throw new Error('directory children are duplicated or a country has children');
  return { schemaVersion: 1, node, outlineIndexPath: index.outlineIndexPath as string | null, children };
}

export function validateCountryOutlineIndex(value: unknown, manifest: CountryDirectoryManifest, node: InventoryNode): CountryOutlineIndex {
  if (node.id === 'legacy-ng' || node.countryCode === 'NG' || node.provider === 'legacy-ng') throw new Error('Nigeria outline requests are prohibited');
  const index = object(value, 'country outline index');
  exact(index, ['schemaVersion','countryId','sourceRef','geometryType','polygonCount','coordinatePositions','totalPartBytes','parts'], 'country outline index');
  if (index.schemaVersion !== 1 || index.countryId !== node.id || index.sourceRef !== node.sourceFeatureIds[0] || node.outline !== 'available') throw new Error('country outline index source binding is invalid');
  if (node.sourceFeatureIds.length !== 1) throw new Error('country outline must have exactly one pinned source feature reference');
  if (index.geometryType !== 'Polygon' && index.geometryType !== 'MultiPolygon') throw new TypeError('country geometry type is invalid');
  const bounded = (candidate: unknown, label: string, min: number, max: number): number => {
    if (!Number.isSafeInteger(candidate) || Number(candidate) < min || Number(candidate) > max) throw new RangeError(`${label} is out of bounds`);
    return Number(candidate);
  };
  const polygonCount = bounded(index.polygonCount, 'polygon count', 1, COUNTRY_DIRECTORY_LIMITS.positions);
  const coordinatePositions = bounded(index.coordinatePositions, 'country position count', 1, COUNTRY_DIRECTORY_LIMITS.positions);
  const totalPartBytes = bounded(index.totalPartBytes, 'total part bytes', 1, COUNTRY_DIRECTORY_LIMITS.countryBytes);
  if (!Array.isArray(index.parts) || index.parts.length < 1 || index.parts.length > 1024) throw new TypeError('country outline parts are invalid');
  let polygonOffset = 0, positions = 0, bytes = 0;
  const parts = index.parts.map((raw, partNumber) => {
    const part = object(raw, `outline part ${partNumber}`); exact(part, ['path','polygonOffset','polygonCount','bytes','coordinatePositions'], `outline part ${partNumber}`);
    if (!hashPath(part.path, 'outlines')) throw new TypeError(`outline part ${partNumber} path is invalid`);
    const offset = bounded(part.polygonOffset, `outline part ${partNumber} offset`, 0, polygonCount - 1);
    const count = bounded(part.polygonCount, `outline part ${partNumber} polygons`, 1, polygonCount);
    const partBytes = bounded(part.bytes, `outline part ${partNumber} bytes`, 1, COUNTRY_DIRECTORY_LIMITS.partBytes);
    const partPositions = bounded(part.coordinatePositions, `outline part ${partNumber} positions`, 1, coordinatePositions);
    if (offset !== polygonOffset) throw new Error('outline parts do not form contiguous polygon offsets');
    polygonOffset += count; positions += partPositions; bytes += partBytes;
    return { path: part.path, polygonOffset: offset, polygonCount: count, bytes: partBytes, coordinatePositions: partPositions };
  });
  if (polygonOffset !== polygonCount || positions !== coordinatePositions || bytes !== totalPartBytes || bytes > COUNTRY_DIRECTORY_LIMITS.countryBytes) throw new Error('outline part counts or totals do not conserve the country geometry');
  if (index.geometryType === 'Polygon' && polygonCount !== 1) throw new Error('Polygon geometry must contain exactly one polygon');
  if (manifest.partCount < parts.length) throw new Error('outline part count exceeds manifest denominator');
  return { schemaVersion: 1, countryId: node.id, sourceRef: node.sourceFeatureIds[0]!, geometryType: index.geometryType,
    polygonCount, coordinatePositions, totalPartBytes, parts };
}

function validatePartGeometry(value: unknown, expectedPositions: number, expectedPolygons: number): unknown[][] {
  const part = object(value, 'geometry part'); exact(part, ['type','coordinates'], 'geometry part');
  if (part.type !== 'MultiPolygon' || !Array.isArray(part.coordinates) || part.coordinates.length !== expectedPolygons) throw new TypeError('geometry part polygon count is invalid');
  let positions = 0;
  const polygons = part.coordinates.map((polygon, polygonIndex) => {
    if (!Array.isArray(polygon) || !polygon.length) throw new TypeError(`geometry polygon ${polygonIndex} is invalid`);
    return polygon.map((rawRing, ringIndex) => {
      if (!Array.isArray(rawRing) || rawRing.length < 4) throw new TypeError(`geometry ring ${polygonIndex}/${ringIndex} is invalid`);
      const ring = rawRing.map((rawPoint, pointIndex) => {
        if (!Array.isArray(rawPoint) || rawPoint.length !== 2 || !rawPoint.every(Number.isFinite) || Number(rawPoint[0]) < -180 || Number(rawPoint[0]) > 180 || Number(rawPoint[1]) < -90 || Number(rawPoint[1]) > 90) throw new TypeError(`geometry position ${polygonIndex}/${ringIndex}/${pointIndex} is invalid`);
        positions++;
        return [Number(rawPoint[0]), Number(rawPoint[1])];
      });
      const first = ring[0]!, last = ring.at(-1)!;
      if (first[0] !== last[0] || first[1] !== last[1]) throw new TypeError('geometry ring is not closed');
      return ring;
    });
  });
  if (positions !== expectedPositions) throw new Error('geometry part coordinate count differs from its index');
  return polygons;
}

export interface CountryDirectoryJsonClient {
  getJson(url: string, hash: string, maxBytes: number, signal: AbortSignal): Promise<{ value: unknown; bytes: number }>;
}

export function validateCountryDirectoryIdentity(value: unknown, manifest: CountryDirectoryManifest): CountryIdentityComparison {
  return validateCountryIdentity(value, manifest);
}

export async function fetchCountryOutline(client: CountryDirectoryJsonClient, base: URL, manifest: CountryDirectoryManifest,
  node: InventoryNode, outlineIndexPath: string | null, signal: AbortSignal): Promise<InventoryGeometry> {
  if (node.id === 'legacy-ng' || node.countryCode === 'NG' || node.provider === 'legacy-ng') throw new Error('Nigeria outline requests are prohibited');
  if (!outlineIndexPath || !hashPath(outlineIndexPath, 'outline-index')) throw new TypeError('country outline index path is missing or invalid');
  const indexHash = outlineIndexPath.slice(outlineIndexPath.lastIndexOf('/') + 1, -5);
  const indexUrl = directoryAssetUrl(base, 'outline-index', indexHash);
  const loadedIndex = await client.getJson(indexUrl.href, indexHash, COUNTRY_DIRECTORY_LIMITS.indexBytes, signal);
  if (loadedIndex.bytes > COUNTRY_DIRECTORY_LIMITS.indexBytes) throw new RangeError('country outline index exceeds byte limit');
  const index = validateCountryOutlineIndex(loadedIndex.value, manifest, node);
  if (loadedIndex.bytes + index.totalPartBytes > COUNTRY_DIRECTORY_LIMITS.countryBytes) throw new RangeError('country outline index and declared parts exceed the aggregate byte limit');
  if (loadedIndex.bytes + index.totalPartBytes > COUNTRY_DIRECTORY_LIMITS.countryBytes) throw new RangeError('country outline index and parts exceed aggregate country byte limit');
  let totalBytes = loadedIndex.bytes, totalPositions = 0, nextOffset = 0;
  const polygons: unknown[][] = [];
  for (const partRef of index.parts) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Country outline read aborted.', 'AbortError');
    const hash = partRef.path.slice(partRef.path.lastIndexOf('/') + 1, -5);
    const assetUrl = directoryAssetUrl(base, 'outlines', hash);
    const fetched = await client.getJson(assetUrl.href, hash, COUNTRY_DIRECTORY_LIMITS.partBytes, signal);
    if (fetched.bytes !== partRef.bytes) throw new Error('geometry part byte count differs from its outline index');
    const parsed = validatePartGeometry(fetched.value, partRef.coordinatePositions, partRef.polygonCount);
    if (partRef.polygonOffset !== nextOffset) throw new Error('geometry parts are not in indexed polygon order');
    polygons.push(...parsed); nextOffset += parsed.length; totalPositions += partRef.coordinatePositions; totalBytes += fetched.bytes;
    if (totalPositions > COUNTRY_DIRECTORY_LIMITS.positions || totalBytes > COUNTRY_DIRECTORY_LIMITS.countryBytes) throw new RangeError('country outline exceeds aggregate geometry limits');
  }
  if (nextOffset !== index.polygonCount || totalPositions !== index.coordinatePositions || totalBytes !== loadedIndex.bytes + index.totalPartBytes || totalBytes > COUNTRY_DIRECTORY_LIMITS.countryBytes) throw new Error('country outline parts do not conserve indexed geometry');
  if (index.geometryType === 'Polygon') return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

export function directoryAssetUrl(base: URL, routeCategory: 'manifests' | 'nodes' | 'outline-index' | 'outlines' | 'identity', hash: string): URL {
  if (!HASH.test(hash)) throw new TypeError('country directory asset hash is invalid');
  const url = new URL(`/world-output/country-inventory/${routeCategory}/${hash}.json`, base);
  return url;
}

/** Hash-verifying bounded JSON client with a raw-response-byte-accounted LRU and two-request gate. */
export class CountryDirectoryJsonCache implements CountryDirectoryJsonClient {
  private readonly entries = new Map<string, { value: unknown; bytes: number }>();
  private used = 0;
  private active = 0;
  private readonly queue: Array<{ resolve: () => void; reject: (error: unknown) => void; signal: AbortSignal; abort: () => void }> = [];
  private readonly fetcher: typeof fetch;
  private readonly downloaded?: (bytes: number) => void;
  readonly maxBytes: number;
  get byteLength(): number { return this.used; }
  constructor(options: { maxBytes?: number; fetcher?: typeof fetch; downloaded?: (bytes: number) => void } = {}) {
    this.maxBytes = options.maxBytes ?? COUNTRY_DIRECTORY_LIMITS.cacheBytes;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0 || this.maxBytes > COUNTRY_DIRECTORY_LIMITS.cacheBytes) throw new RangeError('country directory cache limit is invalid');
    this.fetcher = options.fetcher ?? fetch;
    this.downloaded = options.downloaded;
  }
  private async permit(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError');
    if (this.active < COUNTRY_DIRECTORY_LIMITS.requests) { this.active++; return () => this.release(); }
    await new Promise<void>((resolve, reject) => {
      const item = { resolve, reject, signal, abort: () => { const index = this.queue.indexOf(item); if (index >= 0) this.queue.splice(index, 1); reject(signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError')); } };
      signal.addEventListener('abort', item.abort, { once: true }); this.queue.push(item);
    });
    if (signal.aborted) { this.release(); throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError'); }
    return () => this.release();
  }
  private release(): void {
    while (this.queue.length) {
      const item = this.queue.shift()!;
      item.signal.removeEventListener('abort', item.abort);
      if (item.signal.aborted) { item.reject(item.signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError')); continue; }
      item.resolve(); return; // Transfer the occupied slot directly to the queued request.
    }
    this.active--;
  }
  async getJson(urlValue: string, hash: string, maxBytes: number, signal: AbortSignal): Promise<{ value: unknown; bytes: number }> {
    if (!HASH.test(hash) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > COUNTRY_DIRECTORY_LIMITS.manifestBytes) throw new TypeError('country asset hash or byte cap is invalid');
    const url = new URL(urlValue);
    const localHttp = url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname.toLowerCase());
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password) throw new TypeError('country directory URL is invalid');
    const key = `${url.href}:${hash}`, cached = this.entries.get(key);
    if (signal.aborted) throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError');
    if (cached) {
      if (cached.bytes > maxBytes) throw new RangeError('cached country directory asset exceeds the requested byte limit');
      this.entries.delete(key); this.entries.set(key, cached); return cached;
    }
    const release = await this.permit(signal);
    try {
      const again = this.entries.get(key);
      if (signal.aborted) throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError');
      if (again) {
        if (again.bytes > maxBytes) throw new RangeError('cached country directory asset exceeds the requested byte limit');
        this.entries.delete(key); this.entries.set(key, again); return again;
      }
      const fetched = await fetchCountryDirectoryJson(url.href, hash, maxBytes, signal, this.fetcher);
      if (signal.aborted) throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError');
      if (fetched.bytes <= this.maxBytes) {
        const previous = this.entries.get(key);
        if (previous) { this.entries.delete(key); this.used -= previous.bytes; }
        while (this.used + fetched.bytes > this.maxBytes && this.entries.size) { const oldest = this.entries.keys().next().value as string; const removed = this.entries.get(oldest)!; this.entries.delete(oldest); this.used -= removed.bytes; }
        if (this.used + fetched.bytes <= this.maxBytes) { const entry = { value: fetched.value, bytes: fetched.bytes }; this.entries.set(key, entry); this.used += fetched.bytes; }
      }
      this.downloaded?.(fetched.bytes);
      return fetched;
    } finally { release(); }
  }
}

async function fetchCountryDirectoryJson(url: string, hash: string, maxBytes: number, signal: AbortSignal, fetcher: typeof fetch): Promise<{ value: unknown; bytes: number }> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError');
  const response = await fetcher(url, { signal });
  if (signal.aborted) { await response.body?.cancel(signal.reason); throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Country directory request failed (${response.status}).`); }
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) { await response.body?.cancel(); throw new RangeError('Country directory response exceeds byte limit'); }
  if (!response.body) throw new Error('Country directory response has no readable body');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0, complete = false;
  let cancelPromise: Promise<void> | undefined;
  const cancelOnAbort = (): void => { cancelPromise ??= reader.cancel(signal.reason).then(() => undefined, () => undefined); };
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError');
      const next = await reader.read();
      if (signal.aborted) throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError');
      if (next.done) { complete = true; break; }
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new RangeError('Country directory response exceeds byte limit');
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    if (!complete && !cancelPromise) { cancelPromise = reader.cancel(signal.reason).then(() => undefined, () => undefined); }
    if (cancelPromise) await cancelPromise;
    reader.releaseLock();
  }
  if (signal.aborted) throw signal.reason ?? new DOMException('Country directory request aborted.', 'AbortError');
  const raw = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw.slice().buffer as ArrayBuffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== hash) throw new Error('Country directory content hash mismatch');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as unknown; }
  catch { throw new TypeError('Country directory response is not valid UTF-8 JSON'); }
  return { value: parsed, bytes };
}
