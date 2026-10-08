import { createHash } from 'node:crypto';
import path from 'node:path';
import { COUNTRY_DIRECTORY_LIMITS } from './country-directory-types.ts';
import type { CountryDirectoryManifest } from './country-directory-types.ts';
import type { InventoryNode } from './production-types.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { validateCountryDirectoryManifest, validateCountryDirectoryNodeIndex, validateCountryIdentity, validateCountryOutlineIndex } from './preview/country-directory-view.ts';

const HASH = /^[a-f0-9]{64}$/;
const ENTRY_LIMIT = 4096;
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Country directory read aborted.', 'AbortError');
}
function validHashPath(value: string, folder: string): boolean { return new RegExp(`^${folder}/[a-f0-9]{64}\\.json$`).test(value); }

export interface VerifiedCountryDirectory { manifest: CountryDirectoryManifest; manifestHash: string; nodes: InventoryNode[] }

/** Read and verify the complete hierarchy, identity sidecar, and outline indexes without loading geometry parts. */
export async function readCountryDirectory(directoryRoot: string, manifestHash: string, signal?: AbortSignal): Promise<VerifiedCountryDirectory> {
  if (!path.isAbsolute(directoryRoot) || !HASH.test(manifestHash)) throw new TypeError('absolute country directory root and manifest SHA-256 are required');
  checkAbort(signal);
  const root = path.resolve(directoryRoot);
  let totalBytes = 0;
  const cache = new Map<string, { value: unknown; bytes: number }>();
  const read = async (relative: string, folder: string, limit: number): Promise<{ value: unknown; bytes: number }> => {
    checkAbort(signal);
    if (!validHashPath(relative, folder)) throw new TypeError('country directory asset path is invalid');
    const cached = cache.get(relative);
    if (cached) return cached;
    const remaining = COUNTRY_DIRECTORY_LIMITS.publishedBytes - totalBytes;
    if (remaining < 1) throw new RangeError('country directory read exceeds total byte limit');
    const bytes = await readBoundedLocalFile(path.join(root, relative), Math.min(limit, remaining));
    checkAbort(signal);
    const filenameHash = path.basename(relative, '.json');
    if (sha(bytes) !== filenameHash) throw new Error(`country directory asset hash mismatch: ${relative}`);
    totalBytes += bytes.byteLength;
    if (totalBytes > COUNTRY_DIRECTORY_LIMITS.publishedBytes) throw new RangeError('country directory read exceeds total byte limit');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new TypeError(`country directory asset is not valid UTF-8 JSON: ${relative}`); }
    const result = { value, bytes: bytes.byteLength };
    cache.set(relative, result);
    return result;
  };
  const manifestFile = await read(`manifests/${manifestHash}.json`, 'manifests', COUNTRY_DIRECTORY_LIMITS.manifestBytes);
  const manifest = validateCountryDirectoryManifest(manifestFile.value);
  const identityFile = await read(manifest.identityPath, 'identity', COUNTRY_DIRECTORY_LIMITS.identityBytes);
  const identity = validateCountryIdentity(identityFile.value, manifest);
  const expectedIdentity = new Map<string, { countryId: string; name: string }>();
  for (const row of [...identity.retained, ...identity.added]) {
    const name = 'candidateName' in row ? row.candidateName : row.name;
    if (expectedIdentity.has(row.featureKey)) throw new Error('identity sidecar repeats candidate feature keys');
    expectedIdentity.set(row.featureKey, { countryId: row.countryId, name });
  }
  if (expectedIdentity.size !== manifest.sourceUnitCount || identity.candidateUnits !== manifest.sourceUnitCount || identity.missing.length !== 0) throw new Error('identity sidecar does not conserve source units');

  type Pending = { path: string; id: string; parentId: string | null; parentKind: InventoryNode['kind'] | null };
  const pending: Pending[] = [{ path: manifest.rootNodePath, id: 'world:earth', parentId: null, parentKind: null }];
  const visitedPaths = new Set<string>(), ids = new Set<string>(), sourceRefs = new Set<string>(), nodes: InventoryNode[] = [];
  const countryByFeatureKey = new Map<string, InventoryNode>();
  const outlinePaths = new Set<string>();
  let outlineCount = 0, partCount = 0, nigeriaCount = 0;
  const addPending = (entries: Pending[]): void => {
    if (pending.length + entries.length > ENTRY_LIMIT) throw new RangeError(`country directory node traversal exceeds ${ENTRY_LIMIT} entries`);
    pending.push(...entries);
  };
  for (let offset = 0; offset < pending.length; offset++) {
    checkAbort(signal);
    if (offset >= ENTRY_LIMIT) throw new RangeError(`country directory node traversal exceeds ${ENTRY_LIMIT} entries`);
    const entry = pending[offset]!;
    if (visitedPaths.has(entry.path) || ids.has(entry.id)) throw new Error('country directory hierarchy repeats a path or node ID');
    visitedPaths.add(entry.path); ids.add(entry.id);
    const loaded = await read(entry.path, 'nodes', COUNTRY_DIRECTORY_LIMITS.indexBytes);
    const index = validateCountryDirectoryNodeIndex(loaded.value, manifest, entry.id, entry.parentId);
    const node = index.node;
    if (entry.parentKind === null) {
      if (node.kind !== 'world' || node.parentId !== null || node.id !== 'world:earth') throw new Error('country directory root node is invalid');
    } else {
      if (node.kind === 'world') throw new Error('country directory hierarchy has an invalid parent kind');
      if (entry.parentKind === 'world' && node.kind !== 'continent') throw new Error('world children must be continents');
      if (entry.parentKind === 'continent' && node.kind !== 'country') throw new Error('continent children must be countries');
    }
    nodes.push(node);
    if (node.kind === 'country') {
      const reference = node.sourceFeatureIds[0]!;
      if (sourceRefs.has(reference)) throw new Error('country directory repeats a source feature reference');
      sourceRefs.add(reference);
      const featureKey = reference.slice(manifest.source.id.length + 1);
      if (countryByFeatureKey.has(featureKey)) throw new Error('country directory repeats a candidate feature key');
      countryByFeatureKey.set(featureKey, node);
      const identityRow = expectedIdentity.get(featureKey);
      if (!identityRow || identityRow.countryId !== node.id || identityRow.name !== node.name) throw new Error('identity sidecar does not match the directory country nodes');
      if (node.countryCode === 'NG') {
        if (node.id !== 'legacy-ng' || node.provider !== 'legacy-ng' || node.outline !== 'missing' || index.outlineIndexPath !== null) throw new Error('protected Nigeria node or geometry binding is invalid');
        nigeriaCount++;
      } else if (node.provider !== 'world') throw new Error('non-Nigeria country has a protected or unsupported provider');
      if (index.outlineIndexPath) {
        if (outlinePaths.has(index.outlineIndexPath)) throw new Error('country directory repeats an outline index path');
        outlinePaths.add(index.outlineIndexPath);
        const outlineFile = await read(index.outlineIndexPath, 'outline-index', COUNTRY_DIRECTORY_LIMITS.indexBytes);
        const outline = validateCountryOutlineIndex(outlineFile.value, manifest, node);
        const aggregateCountryBytes = outlineFile.bytes + outline.totalPartBytes;
        if (aggregateCountryBytes > COUNTRY_DIRECTORY_LIMITS.countryBytes) throw new RangeError('country outline index and parts exceed country byte cap');
        outlineCount++;
        partCount += outline.parts.length;
      }
    } else if (node.sourceFeatureIds.length) throw new Error('non-country directory node has source references');
    addPending(index.children.map(child => ({ path: child.path, id: child.id, parentId: node.id, parentKind: node.kind })));
  }
  if (nodes.length !== manifest.nodeCount || sourceRefs.size !== manifest.sourceUnitCount || countryByFeatureKey.size !== manifest.sourceUnitCount) throw new Error('country directory node or source-unit denominator does not match manifest');
  if (outlineCount !== manifest.outlineCount || partCount !== manifest.partCount || nigeriaCount !== 1) throw new Error('country directory outline, part, or protected Nigeria count does not match manifest');
  if (expectedIdentity.size !== countryByFeatureKey.size || [...expectedIdentity.keys()].some(key => !countryByFeatureKey.has(key))) throw new Error('identity sidecar source feature keys do not match directory nodes');

  const roots = nodes.filter(node => node.kind === 'world');
  if (roots.length !== 1 || roots[0]!.id !== 'world:earth') throw new Error('country directory must contain exactly one world root');
  const continents = nodes.filter(node => node.kind === 'continent' && node.parentId === 'world:earth');
  const actualRollups = new Map(manifest.rollups.map(row => [row.id, row]));
  if (continents.length !== manifest.rollups.length || actualRollups.size !== continents.length) throw new Error('country directory rollups do not match continent nodes');
  for (const continent of continents) {
    const countries = nodes.filter(node => node.kind === 'country' && node.parentId === continent.id);
    const rollup = actualRollups.get(continent.id);
    if (!rollup || rollup.name !== continent.name || rollup.countryCount !== countries.length || rollup.sourceUnitCount !== countries.reduce((sum, node) => sum + node.sourceFeatureIds.length, 0) || rollup.exceptionCount !== countries.reduce((sum, node) => sum + node.exceptions.length, 0)) throw new Error('country directory rollup differs from verified hierarchy');
  }
  checkAbort(signal);
  return { manifest, manifestHash, nodes };
}

export async function readCountryDirectoryCountry(directoryRoot: string, manifestHash: string, countryCode: string, signal?: AbortSignal): Promise<InventoryNode> {
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new TypeError('country code must be an uppercase ISO-2 code');
  if (countryCode === 'NG') throw new Error('Nigeria is a protected legacy provider');
  const directory = await readCountryDirectory(directoryRoot, manifestHash, signal);
  checkAbort(signal);
  const matches = directory.nodes.filter(node => node.kind === 'country' && node.countryCode === countryCode);
  if (matches.length !== 1 || matches[0]!.provider !== 'world') throw new Error('country code does not resolve to exactly one world provider');
  return matches[0]!;
}
