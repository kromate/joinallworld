import { createHash } from 'node:crypto';
import type { CountryDirectoryNodeIndex, CountryDirectoryManifest, CountryOutlineIndex } from './country-directory-types.ts';
import type { VerifiedCountryDirectory } from './country-directory-reader.ts';
import type { InventoryNode } from './production-types.ts';
import type { SourceRecord } from './types.ts';
import { canonicalGameMapJson, GAME_MAP_CATALOGUE_LIMITS } from './game-map-contract.ts';
import type { GameMapCatalogue, GameMapCatalogueEntry, GameMapCrosswalkRow } from './game-map-contract.ts';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const enc = new TextEncoder();
const strictText = (bytes: Uint8Array, label: string): string => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new TypeError(`${label} is not valid UTF-8`); }
};
const parse = (bytes: Uint8Array, label: string): unknown => {
  try { return JSON.parse(strictText(bytes, label)) as unknown; }
  catch (error) { throw new TypeError(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
};
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function safeCountrySource(value: unknown): { id: number; iso: string | null } {
  const row = object(value, 'Natural Earth source feature');
  if (row.type !== 'Feature') throw new TypeError('source row is not a GeoJSON Feature');
  const properties = object(row.properties, 'Natural Earth properties');
  const neId = properties.NE_ID;
  const id = typeof neId === 'number' ? neId : typeof neId === 'string' && /^(?:0|[1-9][0-9]*)$/.test(neId) ? Number(neId) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError('Natural Earth NE_ID must be a positive safe integer');
  const code = properties.ISO_A2_EH;
  const iso = code === null || code === undefined || code === '-99' ? null : typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null;
  if (code !== null && code !== undefined && code !== '-99' && iso === null) throw new TypeError('Natural Earth ISO_A2_EH has an unsupported source representation');
  return { id, iso };
}
function entryNodePath(node: InventoryNode, directory: VerifiedCountryDirectory, assets: ReadonlyMap<string, Uint8Array>): string {
  const pending = [directory.manifest.rootNodePath];
  const seen = new Set<string>();
  while (pending.length) {
    const assetPath = pending.pop()!;
    if (seen.has(assetPath)) throw new Error('verified directory node paths unexpectedly repeat');
    seen.add(assetPath);
    const bytes = assets.get(assetPath);
    if (!bytes) throw new Error(`verified node index bytes are missing: ${assetPath}`);
    const index = parse(bytes, assetPath) as CountryDirectoryNodeIndex;
    if (index.node.id === node.id) return assetPath;
    for (const child of index.children) pending.push(child.path);
  }
  throw new Error(`country directory node index not found for ${node.id}`);
}

export interface GameMapBundleBuildInput {
  source: SourceRecord;
  sourceBytes: Uint8Array;
  atlasBytes: Uint8Array;
  atlasFeatureIds: readonly string[];
  directory: VerifiedCountryDirectory;
  /** Exact published source bytes for node/index/outline assets. Keys are safe relative asset paths. */
  assets: ReadonlyMap<string, Uint8Array>;
}
export interface GameMapBundleBuildProduct {
  catalogue: GameMapCatalogue;
  cataloguePath: string;
  catalogueBytes: Uint8Array;
  bundles: Array<{ path: string; sha256: string; bytes: number; body: Uint8Array; countryId: string }>;
  logicalBytes: number;
}

/** Deterministically binds the exact atlas/source/directory and packages whole verified outline assets. */
export function buildGameMapProduct(input: GameMapBundleBuildInput): GameMapBundleBuildProduct {
  const { source, sourceBytes, atlasBytes, directory, assets } = input;
  if (source.bytes > 16_000_000 || sourceBytes.byteLength !== source.bytes || sha(sourceBytes) !== source.sha256 || canonicalGameMapJson(source) !== canonicalGameMapJson(directory.manifest.source)) throw new Error('raw country source does not match the directory source pin');
  if (directory.manifestHash !== sha(canonicalGameMapJson(directory.manifest)) || directory.manifestHash.length !== 64) throw new Error('directory manifest is not bound to canonical bytes');
  const atlasSha256 = sha(atlasBytes);
  const atlasIds = [...input.atlasFeatureIds];
  if (atlasIds.length !== GAME_MAP_CATALOGUE_LIMITS.atlasFeatures || new Set(atlasIds).size !== atlasIds.length || atlasIds.some(id => !/^[a-z]{2}$/.test(id))) throw new Error(`atlas crosswalk must contain exactly ${GAME_MAP_CATALOGUE_LIMITS.atlasFeatures} unique lowercase two-letter feature IDs`);
  atlasIds.sort();
  const raw = object(parse(sourceBytes, 'pinned Natural Earth source'), 'pinned Natural Earth FeatureCollection');
  if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features) || raw.features.length !== directory.manifest.sourceUnitCount || raw.features.length > GAME_MAP_CATALOGUE_LIMITS.countries) throw new Error('source feature array does not match the verified directory denominator');
  const byId = new Map<number, { iso: string | null; sourceRef: string }>();
  const sourceByRef = new Map<string, { id: number; iso: string | null }>();
  const sourceByIso = new Map<string, number[]>();
  for (const feature of raw.features) {
    const { id, iso } = safeCountrySource(feature);
    if (byId.has(id)) throw new Error('source repeats a Natural Earth NE_ID');
    const sourceRef = `${source.id}:NE_ID:${id}`;
    byId.set(id, { iso, sourceRef });
    sourceByRef.set(sourceRef, { id, iso });
    if (iso) { const rows = sourceByIso.get(iso) ?? []; rows.push(id); sourceByIso.set(iso, rows); }
  }
  const nodes = directory.nodes.filter(node => node.kind === 'country');
  if (nodes.length !== raw.features.length) throw new Error('directory country-node denominator differs from source');
  const nodeBySourceRef = new Map<string, InventoryNode>();
  for (const node of nodes) {
    if (node.sourceFeatureIds.length !== 1) throw new Error(`country node ${node.id} must bind exactly one source feature`);
    const reference = node.sourceFeatureIds[0]!;
    const sourceRow = [...byId.values()].find(row => row.sourceRef === reference);
    if (!sourceRow) throw new Error(`country node has an unknown source reference: ${reference}`);
    const numericKey = Number(reference.slice(reference.lastIndexOf(':') + 1));
    const expectedId = sourceRow.iso === 'NG' ? 'legacy-ng' : `country:natural-earth:NE_ID%3A${numericKey}`;
    if (node.id !== expectedId || node.countryCode !== sourceRow.iso) throw new Error(`country node identity/code does not match its exact NE_ID source row: ${reference}`);
    if (nodeBySourceRef.has(reference)) throw new Error('directory repeats a country source reference');
    nodeBySourceRef.set(reference, node);
  }
  if (nodeBySourceRef.size !== byId.size || [...byId.values()].some(row => !nodeBySourceRef.has(row.sourceRef))) throw new Error('source identities and directory country nodes do not conserve exactly');
  const atlasByCode = new Map(atlasIds.map(id => [id.toUpperCase(), id]));
  const crosswalk: GameMapCrosswalkRow[] = atlasIds.map(atlasFeatureId => {
    const iso = atlasFeatureId.toUpperCase(), ids = sourceByIso.get(iso) ?? [];
    if (ids.length === 1) {
      const sourceFeature = byId.get(ids[0]!)!, node = nodeBySourceRef.get(sourceFeature.sourceRef)!;
      return { atlasFeatureId, sourceIsoA2Eh: iso, sourceNeId: ids[0]!, countryId: node.id, state: 'matched', evidence: null };
    }
    return { atlasFeatureId, sourceIsoA2Eh: ids.length > 1 ? iso : null, sourceNeId: null, countryId: null,
      state: ids.length > 1 ? 'ambiguous' : 'unmatched', evidence: ids.length > 1 ? `ISO_A2_EH ${iso} occurs on ${ids.length} source units; no row was selected.` : 'No exact ISO_A2_EH source match; no name fallback was used.' };
  });
  const crosswalkByIso = new Map(crosswalk.map(row => [row.atlasFeatureId.toUpperCase(), row]));
  const bundles: GameMapBundleBuildProduct['bundles'] = [];
  const entries: GameMapCatalogueEntry[] = [];
  const sortedNodes = nodes.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const node of sortedNodes) {
    const ref = node.sourceFeatureIds[0]!, src = sourceByRef.get(ref);
    if (!src) throw new Error(`directory source reference is not in pinned source: ${ref}`);
    const match = src.iso ? crosswalkByIso.get(src.iso) : undefined;
    const uniqueMatch = match?.state === 'matched' && match.countryId === node.id ? match : null;
    const crosswalkState: GameMapCatalogueEntry['crosswalkState'] = uniqueMatch ? 'matched' : match?.state === 'ambiguous' ? 'ambiguous' : src.iso && !atlasByCode.has(src.iso) ? 'not-in-coarse-atlas' : 'unmatched';
    const protectedNode = node.id === 'legacy-ng' || node.countryCode === 'NG' || node.provider === 'legacy-ng';
    if (protectedNode && (node.id !== 'legacy-ng' || src.iso !== 'NG' || match?.atlasFeatureId !== 'ng' || node.outline !== 'missing')) throw new Error('Nigeria does not match the protected legacy identity policy');
    const nodePath = entryNodePath(node, directory, assets);
    const availability: GameMapCatalogueEntry['availability'] = protectedNode ? 'protected' : node.outline === 'available' ? 'mapped' : 'missing-outline';
    let bundlePath: string | null = null, bundleSha256: string | null = null, bundleBytes: number | null = null;
    if (availability === 'mapped') {
      const nodeAsset = assets.get(nodePath);
      if (!nodeAsset) throw new Error(`node index missing for ${node.id}`);
      if (sha(nodeAsset) !== nodePath.slice(nodePath.lastIndexOf('/') + 1, -5)) throw new Error(`node index bytes do not match path: ${nodePath}`);
      const nodeIndex = parse(nodeAsset, nodePath) as CountryDirectoryNodeIndex;
      if (canonicalGameMapJson(nodeIndex.node) !== canonicalGameMapJson(node) || !nodeIndex.outlineIndexPath) throw new Error('country node index does not bind the selected outline');
      const outlinePath = nodeIndex.outlineIndexPath;
      const outlineBytes = assets.get(outlinePath);
      if (!outlineBytes) throw new Error(`outline index missing for ${node.id}`);
      if (sha(outlineBytes) !== outlinePath.slice(outlinePath.lastIndexOf('/') + 1, -5)) throw new Error(`outline index bytes do not match path: ${outlinePath}`);
      const outline = parse(outlineBytes, outlinePath) as CountryOutlineIndex;
      if (outline.schemaVersion !== 1 || outline.countryId !== node.id || outline.sourceRef !== ref || outline.parts.length < 1 || outline.parts.length > 4 || !Number.isSafeInteger(outline.totalPartBytes)) throw new Error('outline index has unsupported identity or part count');
      const paths = [nodePath, outlinePath, ...outline.parts.map(part => part.path)];
      const uniquePaths = new Set(paths);
      if (uniquePaths.size !== paths.length) throw new Error('country bundle repeats a source asset path');
      let totalSourceBytes = 0;
      const bundleAssets = paths.map(assetPath => {
        if (!/^(?:nodes|outline-index|outlines)\/[a-f0-9]{64}\.json$/.test(assetPath)) throw new Error('directory references an unsafe bundle path');
        const body = assets.get(assetPath);
        if (!body || body.byteLength < 1 || body.byteLength > GAME_MAP_CATALOGUE_LIMITS.bundleAssetBytes) throw new Error(`missing or oversized original bundle asset ${assetPath}`);
        const digest = sha(body);
        if (assetPath.slice(assetPath.lastIndexOf('/') + 1, -5) !== digest) throw new Error(`source asset does not match its content address: ${assetPath}`);
        const part = outline.parts.find(value => value.path === assetPath);
        if (assetPath !== nodePath && assetPath !== outlinePath && (!part || part.bytes !== body.byteLength)) throw new Error(`outline part byte reference differs from its original asset: ${assetPath}`);
        totalSourceBytes += body.byteLength;
        return { path: assetPath, encoding: 'base64' as const, bytes: body.byteLength, sha256: digest, body: Buffer.from(body).toString('base64') };
      });
      if (totalSourceBytes > GAME_MAP_CATALOGUE_LIMITS.bundleCountryBytes) throw new RangeError(`country ${node.id} exceeds decoded asset aggregate cap`);
      const bundle = { schemaVersion: 1 as const, kind: 'country-detail-bundle' as const, countryId: node.id, sourceRef: ref,
        directoryManifestHash: directory.manifestHash, atlasSha256, assets: bundleAssets, attribution: [source.attribution] };
      const body = enc.encode(`${canonicalGameMapJson(bundle)}\n`);
      if (body.byteLength > GAME_MAP_CATALOGUE_LIMITS.bundleBytes) throw new RangeError(`country ${node.id} bundle exceeds byte cap`);
      bundlePath = `world-country-detail/${sha(body)}.txt`; bundleSha256 = sha(body); bundleBytes = body.byteLength;
      bundles.push({ path: bundlePath, sha256: bundleSha256, bytes: bundleBytes, body, countryId: node.id });
    }
    entries.push({ countryId: node.id, name: node.name, sourceRef: ref, sourceIsoA2Eh: src.iso, continentId: node.parentId!, nodePath,
      availability, crosswalkState, atlasFeatureId: uniqueMatch?.atlasFeatureId ?? null, bundlePath, bundleSha256, bundleBytes,
      exception: protectedNode ? 'The existing legacy Nigeria map is protected; this bundle set contains no Nigeria geometry.' : availability === 'missing-outline' ? 'The pinned source feature is retained, but the directory has no admitted outline.' : crosswalkState === 'ambiguous' ? 'The source ISO_A2_EH is ambiguous in the atlas crosswalk; no country name fallback was used.' : null });
  }
  const catalogue: GameMapCatalogue = { schemaVersion: 1, kind: 'country-detail-catalogue',
    atlas: { path: 'src/map3d/geo/data/world.ts', sha256: atlasSha256, bytes: atlasBytes.byteLength, sourceScale: '1:50m' },
    source, directory: { manifestPath: `manifests/${directory.manifestHash}.json`, manifestHash: directory.manifestHash, baselineInventoryHash: directory.manifest.baselineInventoryHash, manifest: directory.manifest },
    crosswalk, entries };
  const catalogueBytes = enc.encode(`${canonicalGameMapJson(catalogue)}\n`);
  if (catalogueBytes.byteLength > GAME_MAP_CATALOGUE_LIMITS.catalogueBytes) throw new RangeError(`catalogue exceeds ${GAME_MAP_CATALOGUE_LIMITS.catalogueBytes} bytes`);
  const logicalBytes = catalogueBytes.byteLength + bundles.reduce((sum, bundle) => sum + bundle.bytes, 0);
  if (logicalBytes > 100_000_000) throw new RangeError('catalogue and bundles exceed the existing 100 MB package allowance');
  return { catalogue, cataloguePath: `world-country-detail/catalogue-v1-${sha(catalogueBytes)}.txt`, catalogueBytes, bundles, logicalBytes };
}
