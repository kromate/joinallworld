import type { InventoryNode } from './production-types.ts';
import type { SourceRecord } from './types.ts';
import type { CountryDirectoryManifest, CountryDirectoryNodeIndex } from './country-directory-types.ts';
import {
  COUNTRY_DIRECTORY_LIMITS,
} from './country-directory-types.ts';
import {
  fetchCountryOutline, validateCountryDirectoryManifest, validateCountryDirectoryNodeIndex,
  validateCountryOutlineIndex,
} from './preview/country-directory-view.ts';

export const GAME_MAP_SCHEMA_VERSION = 1 as const;
export const GAME_MAP_CATALOGUE_LIMITS = Object.freeze({
  catalogueBytes: 256_000,
  bundleBytes: 5_242_880,
  bundleAssetBytes: 512_000,
  bundleCountryBytes: COUNTRY_DIRECTORY_LIMITS.countryBytes,
  bundleAssetCount: 6,
  countries: 258,
  atlasFeatures: 236,
});
const HASH = /^[a-f0-9]{64}$/;
const COUNTRY_PATH = /^country:natural-earth:NE_ID%3A(?:0|-?[1-9][0-9]*)$/;

export interface GameMapCrosswalkRow {
  atlasFeatureId: string;
  sourceIsoA2Eh: string | null;
  sourceNeId: number | null;
  countryId: string | null;
  state: 'matched' | 'ambiguous' | 'unmatched';
  evidence: string | null;
}
export interface GameMapCatalogueEntry {
  countryId: string;
  name: string;
  sourceRef: string;
  sourceIsoA2Eh: string | null;
  continentId: string;
  nodePath: string;
  availability: 'mapped' | 'protected' | 'missing-outline';
  crosswalkState: 'matched' | 'ambiguous' | 'unmatched' | 'not-in-coarse-atlas';
  atlasFeatureId: string | null;
  bundlePath: string | null;
  bundleSha256: string | null;
  bundleBytes: number | null;
  exception: string | null;
}
export interface GameMapCatalogue {
  schemaVersion: 1;
  kind: 'country-detail-catalogue';
  atlas: { path: 'src/map3d/geo/data/world.ts'; sha256: string; bytes: number; sourceScale: '1:50m' };
  source: SourceRecord;
  directory: { manifestPath: string; manifestHash: string; baselineInventoryHash: string; manifest: CountryDirectoryManifest };
  crosswalk: GameMapCrosswalkRow[];
  entries: GameMapCatalogueEntry[];
}
export interface GameMapBundleAsset {
  path: string;
  encoding: 'base64';
  bytes: number;
  sha256: string;
  body: string;
}
export interface GameMapBundle {
  schemaVersion: 1;
  kind: 'country-detail-bundle';
  countryId: string;
  sourceRef: string;
  directoryManifestHash: string;
  atlasSha256: string;
  assets: GameMapBundleAsset[];
  attribution: string[];
}
export interface GameMapExpectedCatalogue {
  atlasSha256: string;
  directoryManifestHash: string;
}
export interface VerifiedGameMapBundle {
  node: InventoryNode;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  attribution: readonly string[];
  limitations: readonly string[];
}

type JsonObject = Record<string, unknown>;
function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}
function exact(value: JsonObject, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${label} has missing or unknown fields`);
}
function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError(`${label} is not a SHA-256 hash`);
  return value;
}
function bounded(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new RangeError(`${label} is out of bounds`);
  return Number(value);
}
function nullableText(value: unknown, label: string, max = 2048): string | null {
  return value === null ? null : text(value, label, max);
}
function canonicalize(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('canonical JSON cannot encode non-finite numbers'); return value; }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('canonical JSON cannot encode cycles');
    seen.add(value); const result = value.map(entry => canonicalize(entry, seen)); seen.delete(value); return result;
  }
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (seen.has(item)) throw new TypeError('canonical JSON cannot encode cycles');
    seen.add(item); const result: Record<string, unknown> = {};
    for (const key of Object.keys(item).sort()) {
      const entry = item[key];
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') throw new TypeError('canonical JSON contains a non-JSON value');
      result[key] = canonicalize(entry, seen);
    }
    seen.delete(item); return result;
  }
  throw new TypeError('canonical JSON contains a non-JSON value');
}
export function canonicalGameMapJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!(bytes instanceof Uint8Array) || !globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function sourceRecord(value: unknown, label: string): SourceRecord {
  const row = object(value, label); exact(row, ['id','url','release','license','attribution','sha256','bytes'], label);
  const id = text(row.id, `${label}.id`, 256), url = text(row.url, `${label}.url`), release = text(row.release, `${label}.release`, 256);
  const license = text(row.license, `${label}.license`, 512), attribution = text(row.attribution, `${label}.attribution`);
  const digest = hash(row.sha256, `${label}.sha256`), bytes = bounded(row.bytes, `${label}.bytes`, 1, 100_000_000);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new TypeError(`${label}.url must be an HTTPS URL without credentials`);
  return { id, url, release, license, attribution, sha256: digest, bytes };
}
function assetPath(value: unknown, label: string, folders: readonly string[]): string {
  const candidate = text(value, label, 128);
  if (!folders.some(folder => new RegExp(`^${folder}/[a-f0-9]{64}\\.json$`).test(candidate))) throw new TypeError(`${label} is not a fixed content-hash path`);
  return candidate;
}

function validateEntry(value: unknown, index: number): GameMapCatalogueEntry {
  const row = object(value, `catalogue.entries[${index}]`);
  exact(row, ['countryId','name','sourceRef','sourceIsoA2Eh','continentId','nodePath','availability','crosswalkState','atlasFeatureId','bundlePath','bundleSha256','bundleBytes','exception'], `catalogue.entries[${index}]`);
  const countryId = text(row.countryId, 'entry countryId', 512), name = text(row.name, 'entry name', 2048), sourceRef = text(row.sourceRef, 'entry sourceRef', 512);
  if (countryId !== 'legacy-ng' && !COUNTRY_PATH.test(countryId)) throw new TypeError('entry countryId is not a stable Natural Earth ID');
  if (!sourceRef.startsWith('natural-earth-admin0-10m-') || !/:NE_ID:(?:0|[1-9][0-9]*)$/.test(sourceRef)) throw new TypeError('entry sourceRef is not bound to the pinned Natural Earth source');
  const sourceIsoA2Eh = nullableText(row.sourceIsoA2Eh, 'entry source ISO_A2_EH', 2);
  if (sourceIsoA2Eh !== null && !/^[A-Z]{2}$/.test(sourceIsoA2Eh)) throw new TypeError('entry source ISO_A2_EH must be two uppercase letters or null');
  const continentId = text(row.continentId, 'entry continentId', 256);
  const nodePath = assetPath(row.nodePath, 'entry nodePath', ['nodes']);
  const availability = row.availability;
  if (availability !== 'mapped' && availability !== 'protected' && availability !== 'missing-outline') throw new TypeError('entry availability is invalid');
  const crosswalkState = row.crosswalkState;
  if (!['matched','ambiguous','unmatched','not-in-coarse-atlas'].includes(String(crosswalkState))) throw new TypeError('entry crosswalkState is invalid');
  const atlasFeatureId = nullableText(row.atlasFeatureId, 'entry atlasFeatureId', 16);
  if (atlasFeatureId !== null && !/^[a-z]{2}$/.test(atlasFeatureId)) throw new TypeError('entry atlasFeatureId is invalid');
  const bundlePath = row.bundlePath === null ? null : text(row.bundlePath, 'entry bundlePath', 128);
  if (bundlePath !== null && !/^world-country-detail\/[a-f0-9]{64}\.txt$/.test(bundlePath)) throw new TypeError('entry bundlePath is invalid');
  const bundleSha256 = row.bundleSha256 === null ? null : hash(row.bundleSha256, 'entry bundleSha256');
  const bundleBytes = row.bundleBytes === null ? null : bounded(row.bundleBytes, 'entry bundleBytes', 1, GAME_MAP_CATALOGUE_LIMITS.bundleBytes);
  const exception = nullableText(row.exception, 'entry exception', 512);
  if (availability === 'mapped' && (!bundlePath || !bundleSha256 || !bundleBytes)) throw new Error('mapped entry must bind one outline bundle');
  if (availability !== 'mapped' && (bundlePath !== null || bundleSha256 !== null || bundleBytes !== null)) throw new Error('nonmapped entry cannot bind an outline bundle');
  if (availability === 'protected' && (countryId !== 'legacy-ng' || atlasFeatureId !== 'ng')) throw new Error('protected status is reserved for the legacy Nigeria entry');
  if (countryId === 'legacy-ng' && availability !== 'protected') throw new Error('legacy Nigeria must remain protected');
  return { countryId, name, sourceRef, sourceIsoA2Eh, continentId, nodePath, availability, crosswalkState: crosswalkState as GameMapCatalogueEntry['crosswalkState'], atlasFeatureId, bundlePath, bundleSha256, bundleBytes, exception };
}

export async function validateGameMapCatalogue(value: unknown, expected: GameMapExpectedCatalogue): Promise<GameMapCatalogue> {
  if (!HASH.test(expected.atlasSha256) || !HASH.test(expected.directoryManifestHash)) throw new TypeError('expected game map pins are invalid');
  const raw = object(value, 'country detail catalogue');
  exact(raw, ['schemaVersion','kind','atlas','source','directory','crosswalk','entries'], 'country detail catalogue');
  if (raw.schemaVersion !== 1 || raw.kind !== 'country-detail-catalogue') throw new TypeError('country detail catalogue version/kind is unsupported');
  const atlasRaw = object(raw.atlas, 'catalogue atlas'); exact(atlasRaw, ['path','sha256','bytes','sourceScale'], 'catalogue atlas');
  if (atlasRaw.path !== 'src/map3d/geo/data/world.ts' || atlasRaw.sourceScale !== '1:50m' || hash(atlasRaw.sha256, 'atlas SHA') !== expected.atlasSha256) throw new Error('atlas binding differs from generated runtime pin');
  const atlas = { path: 'src/map3d/geo/data/world.ts' as const, sha256: expected.atlasSha256, bytes: bounded(atlasRaw.bytes, 'atlas bytes', 1, 10_000_000), sourceScale: '1:50m' as const };
  const source = sourceRecord(raw.source, 'catalogue source');
  const directoryRaw = object(raw.directory, 'catalogue directory'); exact(directoryRaw, ['manifestPath','manifestHash','baselineInventoryHash','manifest'], 'catalogue directory');
  const manifestHash = hash(directoryRaw.manifestHash, 'directory manifest hash');
  if (manifestHash !== expected.directoryManifestHash) throw new Error('directory manifest differs from generated runtime pin');
  if (directoryRaw.manifestPath !== `manifests/${manifestHash}.json`) throw new Error('directory manifest path is not content-addressed');
  const baselineInventoryHash = hash(directoryRaw.baselineInventoryHash, 'baseline inventory hash');
  const manifest = validateCountryDirectoryManifest(directoryRaw.manifest);
  if (canonicalGameMapJson(source) !== canonicalGameMapJson(manifest.source) || manifest.baselineInventoryHash !== baselineInventoryHash
      || canonicalGameMapJson(manifest) !== canonicalGameMapJson(directoryRaw.manifest)
      || await sha256Hex(new TextEncoder().encode(canonicalGameMapJson(manifest))) !== manifestHash) throw new Error('directory manifest source/baseline/hash binding differs from catalogue');
  const directory = { manifestPath: `manifests/${manifestHash}.json`, manifestHash, baselineInventoryHash, manifest };
  if (!Array.isArray(raw.entries) || raw.entries.length !== manifest.sourceUnitCount || raw.entries.length > GAME_MAP_CATALOGUE_LIMITS.countries) throw new RangeError('catalogue entry count differs from source directory denominator');
  const entries = raw.entries.map(validateEntry);
  if (entries.some((row, i) => i > 0 && entries[i - 1]!.countryId >= row.countryId)) throw new Error('catalogue entries must be uniquely sorted by country ID');
  const ids = new Set(entries.map(row => row.countryId)), refs = new Set(entries.map(row => row.sourceRef));
  if (ids.size !== manifest.sourceUnitCount || refs.size !== manifest.sourceUnitCount) throw new Error('catalogue repeats a country ID or source reference');
  const protectedRows = entries.filter(row => row.availability === 'protected');
  if (protectedRows.length !== 1 || protectedRows[0]!.countryId !== 'legacy-ng' || protectedRows[0]!.sourceIsoA2Eh !== 'NG' || protectedRows[0]!.atlasFeatureId !== 'ng' || protectedRows[0]!.bundlePath !== null) throw new Error('catalogue must preserve exactly one protected Nigeria row without a bundle');
  const mapped = entries.filter(row => row.availability === 'mapped');
  if (mapped.length !== manifest.outlineCount || entries.filter(row => row.availability === 'missing-outline').length !== manifest.sourceUnitCount - manifest.outlineCount - protectedRows.length) throw new Error('catalogue outline availability does not conserve manifest counts');
  for (const entry of entries) if (!entry.sourceRef.startsWith(`${manifest.source.id}:NE_ID:`)) throw new Error('entry sourceRef is not bound to the exact pinned source ID');
  if (!Array.isArray(raw.crosswalk) || raw.crosswalk.length !== GAME_MAP_CATALOGUE_LIMITS.atlasFeatures) throw new RangeError('crosswalk does not cover the complete two-letter atlas feature set');
  const crosswalk = raw.crosswalk.map((item, index): GameMapCrosswalkRow => {
    const row = object(item, `catalogue.crosswalk[${index}]`); exact(row, ['atlasFeatureId','sourceIsoA2Eh','sourceNeId','countryId','state','evidence'], `catalogue.crosswalk[${index}]`);
    const atlasFeatureId = text(row.atlasFeatureId, 'crosswalk atlas feature ID', 2);
    if (!/^[a-z]{2}$/.test(atlasFeatureId)) throw new TypeError('crosswalk atlas feature ID is invalid');
    const sourceIsoA2Eh = nullableText(row.sourceIsoA2Eh, 'crosswalk source ISO', 2);
    if (sourceIsoA2Eh !== null && !/^[A-Z]{2}$/.test(sourceIsoA2Eh)) throw new TypeError('crosswalk ISO code is invalid');
    const sourceNeId = row.sourceNeId === null ? null : bounded(row.sourceNeId, 'crosswalk NE_ID', 0, Number.MAX_SAFE_INTEGER);
    const countryId = row.countryId === null ? null : text(row.countryId, 'crosswalk country ID', 512);
    const state = row.state;
    if (state !== 'matched' && state !== 'ambiguous' && state !== 'unmatched') throw new TypeError('crosswalk state is invalid');
    const evidence = nullableText(row.evidence, 'crosswalk evidence', 512);
    if (state === 'matched' && (sourceIsoA2Eh !== atlasFeatureId.toUpperCase() || sourceNeId === null || countryId === null || !ids.has(countryId))) throw new Error('matched crosswalk row is incomplete or unbound');
    if (state === 'matched' && !entries.some(entry => entry.countryId === countryId && entry.sourceRef === `${source.id}:NE_ID:${sourceNeId}` && entry.sourceIsoA2Eh === sourceIsoA2Eh)) throw new Error('matched crosswalk NE_ID is not bound to the exact source identity');
    if (state !== 'matched' && sourceNeId !== null) throw new Error('nonmatched crosswalk rows cannot claim a source NE_ID');
    if (state !== 'matched' && countryId !== null) throw new Error('ambiguous/unmatched crosswalk cannot claim a country ID');
    return { atlasFeatureId, sourceIsoA2Eh, sourceNeId, countryId, state, evidence };
  });
  if (crosswalk.some((row, i) => i > 0 && crosswalk[i - 1]!.atlasFeatureId >= row.atlasFeatureId) || new Set(crosswalk.map(row => row.atlasFeatureId)).size !== crosswalk.length) throw new Error('crosswalk must be uniquely sorted by atlas feature ID');
  const entryById = new Map(entries.map(row => [row.countryId, row]));
  for (const row of crosswalk) if (row.state === 'matched') {
    const entry = entryById.get(row.countryId!);
    if (!entry || entry.sourceIsoA2Eh !== row.sourceIsoA2Eh || entry.atlasFeatureId !== row.atlasFeatureId) throw new Error('crosswalk does not match its directory entry');
  }
  for (const entry of entries) {
    if (entry.countryId === 'legacy-ng') continue;
    const row = crosswalk.find(candidate => candidate.atlasFeatureId === entry.atlasFeatureId);
    if (entry.atlasFeatureId && (!row || row.state !== entry.crosswalkState || row.countryId !== entry.countryId)) throw new Error('entry crosswalk binding is inconsistent');
    if (!entry.atlasFeatureId && entry.crosswalkState === 'matched') throw new Error('matched entry has no atlas feature ID');
  }
  return { schemaVersion: 1, kind: 'country-detail-catalogue', atlas, source, directory, crosswalk, entries };
}

function decodeBase64(encoded: string, maxBytes: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) || encoded.length > Math.ceil(maxBytes / 3) * 4) throw new TypeError('bundle asset base64 is malformed or exceeds its encoded bound');
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > maxBytes) throw new RangeError('decoded bundle asset exceeds its byte cap');
  return bytes;
}
function parseJson(bytes: Uint8Array, label: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new TypeError(`${label} is not valid UTF-8 JSON`); }
}

function selectedLimitations(manifest: CountryDirectoryManifest, node: InventoryNode): string[] {
  const shared = manifest.exceptions.filter(value => !value.startsWith('country:') && !value.startsWith('legacy-ng:') && !/\bnigeria\b/i.test(value));
  const selected = [...new Set([...shared, ...node.exceptions])];
  if (selected.length > 16) throw new RangeError('selected country limitations exceed the display cap');
  return selected;
}

export async function verifyGameMapBundle(bytes: Uint8Array, entryValue: GameMapCatalogueEntry, catalogue: GameMapCatalogue): Promise<VerifiedGameMapBundle> {
  catalogue = await validateGameMapCatalogue(catalogue, { atlasSha256: catalogue.atlas.sha256, directoryManifestHash: catalogue.directory.manifestHash });
  const entry = validateEntry(entryValue, 0);
  const pinnedEntry = catalogue.entries.find(row => row.countryId === entry.countryId);
  if (!pinnedEntry || canonicalGameMapJson(pinnedEntry) !== canonicalGameMapJson(entry)) throw new Error('selected bundle entry differs from the validated catalogue row');
  if (entry.availability !== 'mapped' || !entry.bundleSha256 || !entry.bundleBytes || !entry.bundlePath) throw new Error('country has no downloadable outline bundle');
  if (bytes.byteLength !== entry.bundleBytes || bytes.byteLength > GAME_MAP_CATALOGUE_LIMITS.bundleBytes || await sha256Hex(bytes) !== entry.bundleSha256) throw new Error('country bundle byte/hash pin mismatch');
  const textBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed = parseJson(bytes, 'country detail bundle');
  if (`${canonicalGameMapJson(parsed)}\n` !== textBody) throw new Error('country bundle is not canonical JSON plus LF');
  const bundle = object(parsed, 'country detail bundle'); exact(bundle, ['schemaVersion','kind','countryId','sourceRef','directoryManifestHash','atlasSha256','assets','attribution'], 'country detail bundle');
  if (bundle.schemaVersion !== 1 || bundle.kind !== 'country-detail-bundle' || bundle.countryId !== entry.countryId || bundle.sourceRef !== entry.sourceRef || bundle.directoryManifestHash !== catalogue.directory.manifestHash || bundle.atlasSha256 !== catalogue.atlas.sha256) throw new Error('country bundle product binding differs from the selected catalogue row');
  if (!Array.isArray(bundle.assets) || bundle.assets.length < 3 || bundle.assets.length > GAME_MAP_CATALOGUE_LIMITS.bundleAssetCount) throw new RangeError('country bundle asset count is invalid');
  const assets = new Map<string, Uint8Array>(); let total = 0;
  for (let i = 0; i < bundle.assets.length; i++) {
    const row = object(bundle.assets[i], `bundle.assets[${i}]`); exact(row, ['path','encoding','bytes','sha256','body'], `bundle.assets[${i}]`);
    const path = assetPath(row.path, 'bundle asset path', ['nodes','outline-index','outlines']);
    if (row.encoding !== 'base64' || assets.has(path)) throw new Error('bundle asset encoding/path is invalid or repeated');
    const declared = bounded(row.bytes, 'bundle asset bytes', 1, GAME_MAP_CATALOGUE_LIMITS.bundleAssetBytes);
    const digest = hash(row.sha256, 'bundle asset SHA-256');
    const body = text(row.body, 'bundle asset body', Math.ceil(GAME_MAP_CATALOGUE_LIMITS.bundleAssetBytes / 3) * 4);
    const decoded = decodeBase64(body, GAME_MAP_CATALOGUE_LIMITS.bundleAssetBytes);
    if (decoded.byteLength !== declared || await sha256Hex(decoded) !== digest || path.slice(path.lastIndexOf('/') + 1, -5) !== digest) throw new Error(`bundle asset content binding mismatch: ${path}`);
    total += decoded.byteLength;
    if (total > GAME_MAP_CATALOGUE_LIMITS.bundleCountryBytes) throw new RangeError('country bundle decoded aggregate exceeds 2 MiB');
    assets.set(path, decoded);
  }
  const nodeBytes = assets.get(entry.nodePath);
  if (!nodeBytes) throw new Error('country bundle does not include the selected node index');
  const nodeValue = parseJson(nodeBytes, 'country node index');
  const nodeIndex: CountryDirectoryNodeIndex = validateCountryDirectoryNodeIndex(nodeValue, catalogue.directory.manifest, entry.countryId, entry.continentId);
  const node = nodeIndex.node;
  if (node.id !== entry.countryId || node.name !== entry.name || node.sourceFeatureIds.length !== 1 || node.sourceFeatureIds[0] !== entry.sourceRef || node.kind !== 'country' || node.provider !== 'world' || node.countryCode === 'NG' || node.countryCode !== entry.sourceIsoA2Eh || node.outline !== 'available' || nodeIndex.outlineIndexPath === null) throw new Error('country bundle node does not exactly match catalogue entry');
  const referenced = new Set([entry.nodePath, nodeIndex.outlineIndexPath]);
  const indexBytes = assets.get(nodeIndex.outlineIndexPath);
  if (!indexBytes) throw new Error('country bundle omits the referenced outline index');
  const outlineValue = parseJson(indexBytes, 'country outline index');
  const outline = validateCountryOutlineIndex(outlineValue, catalogue.directory.manifest, node);
  if (outline.countryId !== entry.countryId || outline.sourceRef !== entry.sourceRef || indexBytes.byteLength + outline.totalPartBytes > GAME_MAP_CATALOGUE_LIMITS.bundleCountryBytes) throw new Error('country outline index identity/aggregate is invalid');
  for (const part of outline.parts) { referenced.add(part.path); if (!assets.has(part.path)) throw new Error(`country bundle omits required outline part ${part.path}`); }
  if (assets.size !== referenced.size || [...assets.keys()].some(path => !referenced.has(path))) throw new Error('country bundle has missing or unreferenced assets');
  const expectedAssetOrder = [entry.nodePath, nodeIndex.outlineIndexPath, ...outline.parts.map(part => part.path)];
  if (bundle.assets.map(item => object(item, 'bundle asset').path).some((value, index) => value !== expectedAssetOrder[index]) || bundle.assets.length !== expectedAssetOrder.length) throw new Error('bundle assets are not in canonical node/index/part order');
  const client = {
    async getJson(urlValue: string, expectedHash: string, maxBytes: number, signal: AbortSignal): Promise<{ value: unknown; bytes: number }> {
      if (signal.aborted) throw signal.reason ?? new DOMException('Country bundle validation aborted.', 'AbortError');
      const url = new URL(urlValue);
      if (url.origin !== 'https://country-detail.invalid' || url.search || url.hash) throw new Error('outline validator requested an unexpected URL');
      const match = /^\/world-output\/country-inventory\/(?:outline-index|outlines)\/([a-f0-9]{64})\.json$/.exec(url.pathname);
      if (!match || match[1] !== expectedHash) throw new Error('outline validator requested an unexpected asset path');
      const path = `${url.pathname.split('/').at(-2)}/${expectedHash}.json`, body = assets.get(path);
      if (!body || body.byteLength > maxBytes) throw new Error('outline validator requested a missing or oversized embedded asset');
      return { value: parseJson(body, 'embedded outline asset'), bytes: body.byteLength };
    },
  };
  const geometry = await fetchCountryOutline(client, new URL('https://country-detail.invalid/'), catalogue.directory.manifest, node, nodeIndex.outlineIndexPath, new AbortController().signal);
  if (bundle.attribution === null || !Array.isArray(bundle.attribution) || bundle.attribution.length < 1 || bundle.attribution.length > 8) throw new TypeError('country bundle attribution is invalid');
  const attribution = bundle.attribution.map((item, index) => text(item, `bundle attribution[${index}]`, 512));
  if (attribution.length !== 1 || attribution[0] !== catalogue.source.attribution) throw new Error('bundle attribution differs from the pinned source attribution');
  return { node, geometry, attribution, limitations: selectedLimitations(catalogue.directory.manifest, node) };
}
