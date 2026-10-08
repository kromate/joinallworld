import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { buildInventory, ensureInventoryDirectory, validateInventory } from './inventory.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { compareCountryIdentities } from './country-identity.ts';
import { createOutputStore } from './storage.ts';
import { COUNTRY_DIRECTORY_COMPILER, COUNTRY_DIRECTORY_LIMITS } from './country-directory-types.ts';
import type { CompiledCountryDirectory, CountryDirectoryManifest, CountryDirectoryNodeIndex, CountryOutlineIndex } from './country-directory-types.ts';
import type { WorldInventory, InventoryNode } from './production-types.ts';
import type { SourceRecord } from './types.ts';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const admissions = new WeakMap<object, string>();
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('non-finite canonical number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new TypeError('value is not canonical JSON data');
}
function json(raw: Uint8Array, label: string): unknown {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new TypeError(`${label} is not valid UTF-8`); }
  try { return JSON.parse(text) as unknown; } catch { throw new TypeError(`${label} is not valid JSON`); }
}
function verifyRaw(source: SourceRecord, raw: Uint8Array, label: string): unknown {
  if (!(raw instanceof Uint8Array) || raw.byteLength !== source.bytes || sha(raw) !== source.sha256) throw new Error(`${label} source bytes differ from its exact SHA-256 pin`);
  return json(raw, label);
}
function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
async function rejectSymlinkAncestors(target: string): Promise<void> {
  const resolved = path.resolve(target), root = path.parse(resolved).root;
  let cursor = root;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { const info = await lstat(cursor); if (info.isSymbolicLink()) throw new Error(`symlink path component refused: ${cursor}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

type Asset = { relative: string; body: Uint8Array };
type Built = { manifest: CountryDirectoryManifest; manifestHash: string; manifestPath: string; bytes: number; assets: Asset[] };
function makeDirectory(inventoryValue: WorldInventory, identity: CompiledCountryDirectory['identity'], source: SourceRecord, baselineSource: SourceRecord, baselineInventoryHash: string): Built {
  const inventory = validateInventory(inventoryValue);
  if (inventory.sources.length !== 1 || canonical(inventory.sources[0]) !== canonical(source)) throw new Error('candidate inventory does not bind the pinned source');
  if (!/^[a-f0-9]{64}$/.test(baselineInventoryHash)) throw new TypeError('baseline inventory hash must be a SHA-256');
  if (!identity || identity.schemaVersion !== 1 || identity.baselineSourceId !== baselineSource.id || identity.candidateSourceId !== source.id || identity.missing.length !== 0 || identity.protectedCountryId !== 'legacy-ng' || identity.candidateUnits !== inventory.sourceUnitCount || identity.baselineUnits !== identity.retained.length || identity.exceptions.length !== 0) throw new Error('country identity comparison is incomplete or inconsistent');
  const candidateIdentity = new Map<string, { countryId: string; name: string }>();
  for (const node of inventory.nodes.filter(value => value.kind === 'country')) {
    if (node.sourceFeatureIds.length !== 1) throw new Error('country identity candidate does not assign exactly one source feature per country');
    const prefix = `${source.id}:`;
    if (!node.sourceFeatureIds[0]!.startsWith(prefix)) throw new Error('country identity candidate source reference is not pinned');
    const featureKey = node.sourceFeatureIds[0]!.slice(prefix.length);
    if (candidateIdentity.has(featureKey)) throw new Error('country identity candidate repeats a source key');
    candidateIdentity.set(featureKey, { countryId: node.id, name: node.name });
  }
  const assignedIdentity = new Set<string>();
  for (const row of identity.retained) {
    const candidate = candidateIdentity.get(row.featureKey);
    if (!candidate || candidate.countryId !== row.countryId || candidate.name !== row.candidateName || typeof row.metadataChanged !== 'boolean' || assignedIdentity.has(row.featureKey)) throw new Error('retained country identity does not match candidate inventory');
    assignedIdentity.add(row.featureKey);
  }
  for (const row of identity.added) {
    const candidate = candidateIdentity.get(row.featureKey);
    if (!candidate || candidate.countryId !== row.countryId || candidate.name !== row.name || assignedIdentity.has(row.featureKey)) throw new Error('added country identity does not match candidate inventory');
    assignedIdentity.add(row.featureKey);
  }
  if (assignedIdentity.size !== candidateIdentity.size) throw new Error('country identity comparison does not conserve candidate inventory units');
  const assets = new Map<string, Uint8Array>();
  let total = 0;
  const add = (relative: string, text: string, max: number, label: string): string => {
    const body = Buffer.from(text, 'utf8');
    if (body.byteLength > max) throw new RangeError(`${label} exceeds ${max} byte cap`);
    const digest = sha(body), expected = relative.replaceAll('{hash}', digest);
    if (!expected.includes(digest)) throw new Error('asset path is not content-addressed');
    const previous = assets.get(expected);
    if (previous) { if (sha(previous) !== digest) throw new Error('asset hash collision'); }
    else { assets.set(expected, body); total += body.byteLength; }
    return expected;
  };
  const outlineByNode = new Map(inventory.outlines.map(outline => [outline.nodeId, outline.geometry]));
  const nodeById = new Map(inventory.nodes.map(node => [node.id, node]));
  const byParent = new Map<string | null, InventoryNode[]>();
  for (const node of inventory.nodes) { const values = byParent.get(node.parentId) ?? []; values.push(node); byParent.set(node.parentId, values); }
  let outlineCount = 0, partCount = 0;
  const publishOutline = (node: InventoryNode): string | null => {
    const geometry = outlineByNode.get(node.id);
    if (!geometry) return null;
    if (node.id === 'legacy-ng' || node.countryCode === 'NG' || node.provider === 'legacy-ng') throw new Error('protected Nigeria geometry must never be emitted');
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates as unknown[];
    if (!Array.isArray(polygons) || polygons.length < 1) throw new TypeError(`outline ${node.id} has no polygons`);
    let positions = 0;
    for (const polygon of polygons) {
      if (!Array.isArray(polygon)) throw new TypeError('outline polygon is malformed');
      for (const ring of polygon) { if (!Array.isArray(ring)) throw new TypeError('outline ring is malformed'); positions += ring.length; }
    }
    if (positions > COUNTRY_DIRECTORY_LIMITS.positions) throw new RangeError(`country ${node.id} exceeds coordinate position cap`);
    const parts: CountryOutlineIndex['parts'] = [];
    let current: unknown[][] = [];
    let currentBodyBytes = 0;
    const wrapperBytes = Buffer.byteLength('{"coordinates":[') + Buffer.byteLength('],"type":"MultiPolygon"}');
    const polygonBodies = (polygons as unknown[][]).map(polygon => canonical(polygon));
    const polygonByteLengths = polygonBodies.map(body => Buffer.byteLength(body));
    const flush = (): void => {
      if (!current.length) return;
      const partText = canonical({ type: 'MultiPolygon', coordinates: current });
      const bodyBytes = Buffer.byteLength(partText);
      if (bodyBytes !== wrapperBytes + currentBodyBytes) throw new Error('polygon group canonical size accounting differs from serialized bytes');
      if (bodyBytes > COUNTRY_DIRECTORY_LIMITS.partBytes) throw new RangeError(`single whole polygon in ${node.id} exceeds part byte cap`);
      const first = parts.reduce((sum, part) => sum + part.polygonCount, 0);
      const partPath = add(`outlines/${'{hash}'}.json`, partText, COUNTRY_DIRECTORY_LIMITS.partBytes, 'geometry part');
      const partPositions = current.reduce<number>((sum, polygon) => sum + polygon.reduce<number>((polySum, ring) => polySum + (ring as unknown[]).length, 0), 0);
      parts.push({ path: partPath, polygonOffset: first, polygonCount: current.length, bytes: bodyBytes, coordinatePositions: partPositions });
      partCount++;
      current = [];
      currentBodyBytes = 0;
    };
    for (let polygonIndex = 0; polygonIndex < (polygons as unknown[][]).length; polygonIndex++) {
      const polygon = (polygons as unknown[][])[polygonIndex]!;
      const polygonBytes = polygonByteLengths[polygonIndex]!;
      const single = wrapperBytes + polygonBytes;
      if (single > COUNTRY_DIRECTORY_LIMITS.partBytes) throw new RangeError(`single whole polygon in ${node.id} exceeds part byte cap`);
      const candidateBytes = currentBodyBytes + (current.length ? 1 : 0) + polygonBytes;
      if (wrapperBytes + candidateBytes > COUNTRY_DIRECTORY_LIMITS.partBytes && current.length) flush();
      current.push(polygon);
      currentBodyBytes += (current.length > 1 ? 1 : 0) + polygonBytes;
    }
    flush();
    const totalPartBytes = parts.reduce((sum, part) => sum + part.bytes, 0);
    const index: CountryOutlineIndex = { schemaVersion: 1, countryId: node.id, sourceRef: node.sourceFeatureIds[0]!, geometryType: geometry.type, polygonCount: polygons.length, coordinatePositions: positions, totalPartBytes, parts };
    const indexText = canonical(index);
    const indexPath = add(`outline-index/${'{hash}'}.json`, indexText, COUNTRY_DIRECTORY_LIMITS.indexBytes, 'outline index');
    const countryBytes = totalPartBytes + Buffer.byteLength(indexText);
    if (countryBytes > COUNTRY_DIRECTORY_LIMITS.countryBytes) throw new RangeError(`country ${node.id} exceeds total country byte cap`);
    outlineCount++;
    return indexPath;
  };
  const publishNode = (node: InventoryNode): string => {
    const outlineIndexPath = publishOutline(node);
    const children = (byParent.get(node.id) ?? []).slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const childRefs = children.map(child => ({ id: child.id, name: child.name, path: publishNode(child) }));
    const value: CountryDirectoryNodeIndex = { schemaVersion: 1, node, outlineIndexPath, children: childRefs };
    return add(`nodes/${'{hash}'}.json`, canonical(value), COUNTRY_DIRECTORY_LIMITS.indexBytes, 'node index');
  };
  const root = inventory.nodes.find(node => node.kind === 'world');
  if (!root) throw new Error('inventory has no world root');
  const rootNodePath = publishNode(root);
  if (inventory.outlines.some(outline => !nodeById.has(outline.nodeId))) throw new Error('orphan outline');
  const identityPath = add(`identity/${'{hash}'}.json`, canonical(identity), COUNTRY_DIRECTORY_LIMITS.identityBytes, 'identity comparison');
  const rollups = (byParent.get(root.id) ?? []).map(parent => {
    const countries = byParent.get(parent.id) ?? [];
    return { id: parent.id, name: parent.name, countryCount: countries.length, sourceUnitCount: countries.reduce((sum, node) => sum + node.sourceFeatureIds.length, 0), exceptionCount: countries.reduce((sum, node) => sum + node.exceptions.length, 0) };
  });
  const exceptions = [...new Set([
    ...inventory.exceptions,
    'Structural coordinate checks do not establish OGC topology validity or spherical validity.',
    'Source boundaries are preserved as published and do not establish legal sovereignty or political recognition.',
    'The protected legacy Nigeria provider has no generated geometry in this directory.',
  ])].sort();
  const manifest: CountryDirectoryManifest = {
    schemaVersion: 1, compiler: COUNTRY_DIRECTORY_COMPILER, source, baselineSource, baselineInventoryHash,
    sourceUnitCount: inventory.sourceUnitCount, nodeCount: inventory.nodes.length, outlineCount, partCount,
    rootNodePath, identityPath, rollups, representation: 'whole-polygon-groups',
    limits: { partBytes: 512000, countryBytes: 2097152, positions: 100000 }, exceptions,
  };
  const manifestText = canonical(manifest), manifestHash = sha(manifestText), manifestPath = `manifests/${manifestHash}.json`;
  const manifestBody = Buffer.from(manifestText);
  if (manifestBody.length > COUNTRY_DIRECTORY_LIMITS.manifestBytes) throw new RangeError('country directory manifest exceeds byte cap');
  total += manifestBody.length;
  if (total > COUNTRY_DIRECTORY_LIMITS.publishedBytes) throw new RangeError('country directory publication exceeds total byte cap');
  assets.set(manifestPath, manifestBody);
  return { manifest, manifestHash, manifestPath, bytes: total, assets: [...assets].map(([relative, body]) => ({ relative, body })) };
}

export function compileCountryDirectory(source: SourceRecord, raw: Uint8Array, baselineSource: SourceRecord, baselineRaw: Uint8Array, baselineInventoryHash: string): CompiledCountryDirectory {
  const sourceJson = verifyRaw(source, raw, 'candidate');
  const baselineJson = verifyRaw(baselineSource, baselineRaw, 'baseline');
  const inventory = buildInventory(source, sourceJson);
  const baselineInventory = buildInventory(baselineSource, baselineJson);
  const identity = compareCountryIdentities(baselineInventory, inventory);
  if (identity.missing.length) throw new Error('candidate source is missing baseline country identities');
  const built = makeDirectory(inventory, identity, source, baselineSource, baselineInventoryHash);
  const result = { ...built, inventory, identity };
  admissions.set(result, fingerprint(result));
  return result;
}

function fingerprint(value: CompiledCountryDirectory): string {
  return sha(canonical({ manifest: value.manifest, manifestHash: value.manifestHash, manifestPath: value.manifestPath, bytes: value.bytes,
    inventory: value.inventory, identity: value.identity, assets: value.assets.map(asset => ({ relative: asset.relative, bytes: asset.body.byteLength, sha256: sha(asset.body) })) }));
}

function sameAssets(left: Asset[], right: Asset[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Map(left.map(asset => [asset.relative, asset.body]));
  if (values.size !== left.length) return false;
  return right.every(asset => { const body = values.get(asset.relative); return body !== undefined && body.byteLength === asset.body.byteLength && sha(body) === sha(asset.body); });
}

export async function publishCountryDirectory(compiled: CompiledCountryDirectory, outputRoot: string, allowedRoot: string): Promise<{ manifestHash: string; manifestPath: string; bytes: number }> {
  if (!compiled || typeof compiled !== 'object') throw new TypeError('compiled country directory is required');
  const admission = admissions.get(compiled);
  if (!admission || fingerprint(compiled) !== admission) throw new Error('compiled country directory was not admitted unchanged by this compiler invocation');
  const regenerated = makeDirectory(compiled.inventory, compiled.identity, compiled.manifest.source, compiled.manifest.baselineSource, compiled.manifest.baselineInventoryHash);
  if (canonical(compiled.manifest) !== canonical(regenerated.manifest) || compiled.manifestHash !== regenerated.manifestHash || compiled.manifestPath !== regenerated.manifestPath || compiled.bytes !== regenerated.bytes || !sameAssets(compiled.assets, regenerated.assets)) throw new Error('compiled country directory failed integrity revalidation');
  const out = path.resolve(outputRoot), allowed = path.resolve(allowedRoot);
  if (!inside(allowed, out)) throw new Error('country directory output must be a child of allowedRoot');
  // All serialized assets and aggregate size are checked before path creation.
  await rejectSymlinkAncestors(allowed);
  await rejectSymlinkAncestors(out);
  await ensureInventoryDirectory(allowed);
  const store = await createOutputStore(out, allowed);
  const writeOrReuse = async (asset: Asset): Promise<void> => {
    const target = path.join(out, asset.relative);
    try {
      const existing = await readBoundedLocalFile(target, asset.body.byteLength);
      if (existing.byteLength !== asset.body.byteLength || sha(existing) !== sha(asset.body) || !existing.equals(Buffer.from(asset.body))) throw new Error(`existing country directory asset is corrupt: ${asset.relative}`);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await store.writeImmutable(asset.relative, asset.body);
  };
  const ordered = regenerated.assets.filter(asset => asset.relative !== regenerated.manifestPath).sort((a, b) => a.relative.localeCompare(b.relative));
  for (const asset of ordered) await writeOrReuse(asset);
  const manifest = regenerated.assets.find(asset => asset.relative === regenerated.manifestPath)!;
  await writeOrReuse(manifest);
  return { manifestHash: regenerated.manifestHash, manifestPath: path.join(out, regenerated.manifestPath), bytes: regenerated.bytes };
}
