import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { InventoryNode } from './production-types.ts';
import { INVENTORY_LIMITS, validateInventoryIndex, validateInventoryManifest } from './preview/inventory-view.ts';

/** Read bounded local data without accepting symlink ancestors or growing files. */
export async function readBoundedLocalFile(filename: string, maxBytes: number): Promise<Buffer> {
  if (!path.isAbsolute(filename) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('bounded absolute file path required');
  const resolved = path.resolve(filename);
  let cursor = path.parse(resolved).root;
  const parts = resolved.slice(cursor.length).split(path.sep);
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error('local file contains symlink or non-regular path');
  }
  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (await realpath(resolved) !== resolved) throw new Error('local file path changed to a symlink during read');
    const before = await file.stat();
    if (!before.isFile() || before.size > maxBytes) throw new RangeError('local file exceeds byte limit');
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    for (;;) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      offset += result.bytesRead;
      if (offset > before.size) throw new Error('local file grew during read');
      if (result.bytesRead === 0) break;
    }
    const after = await file.stat();
    if (await realpath(resolved) !== resolved) throw new Error('local file path changed to a symlink during read');
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('local file changed during read');
    return bytes.subarray(0, offset);
  } finally { await file.close(); }
}

/** Verify a frozen complete hierarchy before attaching a separate administrative layer. */
export async function readCoarseInventoryCountry(inventoryRoot: string, manifestHash: string, countryCode: string): Promise<InventoryNode> {
  if (!path.isAbsolute(inventoryRoot) || !/^[a-f0-9]{64}$/.test(manifestHash) || !/^[A-Z]{2}$/.test(countryCode)) throw new TypeError('invalid coarse inventory binding');
  if (countryCode === 'NG') throw new Error('Nigeria is a protected legacy provider');
  let totalBytes = 0;
  const read = async (relative: string, limit: number): Promise<unknown> => {
    if (!/^(?:manifests|nodes)\/[a-f0-9]{64}\.json$/.test(relative)) throw new Error('invalid inventory asset path');
    const bytes = await readBoundedLocalFile(path.join(inventoryRoot, relative), Math.min(limit, 16 * 1024 * 1024 - totalBytes));
    totalBytes += bytes.length;
    const expected = path.basename(relative, '.json');
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('coarse inventory content hash mismatch');
    return JSON.parse(bytes.toString('utf8')) as unknown;
  };
  const manifest = validateInventoryManifest(await read(`manifests/${manifestHash}.json`, INVENTORY_LIMITS.manifestBytes));
  if (manifest.sourceUnitCount > 10_000 || manifest.sources.length > 10 || manifest.rollups.length > 100) throw new RangeError('coarse inventory hierarchy exceeds unit cap');
  const sourceIds = new Set(manifest.sources.map(source => source.id));
  if (sourceIds.size !== manifest.sources.length) throw new Error('duplicate coarse inventory source');
  const pending: Array<{ relative: string; id: string; parent: InventoryNode | null }> = [{ relative: manifest.rootNodePath, id: 'world:earth', parent: null }];
  const ids = new Set<string>(), paths = new Set<string>(), references = new Set<string>();
  const countries: InventoryNode[] = [];
  let outlineCount = 0, nigeriaCount = 0;
  for (let offset = 0; offset < pending.length; offset++) {
    if (pending.length > 10_100) throw new RangeError('coarse inventory has too many nodes');
    const entry = pending[offset]!;
    if (ids.has(entry.id) || paths.has(entry.relative)) throw new Error('coarse inventory repeats a node or contains a cycle');
    ids.add(entry.id); paths.add(entry.relative);
    const index = validateInventoryIndex(await read(entry.relative, INVENTORY_LIMITS.indexBytes), entry.id, entry.parent?.id ?? null);
    const node = index.node;
    if (entry.parent === null ? node.kind !== 'world' : node.kind === 'world' || (entry.parent.kind !== 'world' && !(entry.parent.kind === 'continent' && node.kind === 'country'))) throw new Error('invalid coarse inventory parent hierarchy');
    if (node.kind !== 'country' && (node.countryCode !== null || node.sourceFeatureIds.length)) throw new Error('coarse grouping node contains country source references');
    if (node.countryCode === 'NG') {
      if (node.provider !== 'legacy-ng' || node.id !== 'legacy-ng') throw new Error('Nigeria must retain its protected provider');
      nigeriaCount++;
    }
    if (node.outline === 'available') outlineCount++;
    for (const reference of node.sourceFeatureIds) {
      if (references.has(reference) || ![...sourceIds].some(source => reference.startsWith(`${source}:`))) throw new Error('coarse source reference is duplicated or unresolved');
      references.add(reference);
    }
    if (node.kind === 'country') countries.push(node);
    for (const child of index.children) pending.push({ relative: child.path, id: child.id, parent: node });
  }
  if (references.size !== manifest.sourceUnitCount || outlineCount !== manifest.outlineCount || nigeriaCount !== 1) throw new Error('coarse inventory coverage denominator or protected Nigeria is incomplete');
  const matches = countries.filter(country => country.countryCode === countryCode);
  if (matches.length !== 1 || matches[0]!.provider !== 'world') throw new Error('fine source country does not resolve to exactly one coarse world provider');
  return matches[0]!;
}
