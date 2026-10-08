import { createHash } from 'node:crypto';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { buildFineDirectoryCatalogue } from './fine-directory-catalogue.ts';
import type { FineCataloguePin } from './fine-catalogue.ts';
import { buildInventory } from './inventory.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { readCountryDirectory } from './country-directory-reader.ts';
import { createOutputStore } from './storage.ts';
import type { WorldInventory } from './production-types.ts';

const HARD = Object.freeze({ metadata: 2 * 1024 * 1024, source: 16 * 1024 * 1024, frozen: 1_000_000, report: 1_000_000 });
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): string => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('non-finite inventory value'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new TypeError('unsupported inventory value');
};
function inside(root: string, file: string): boolean { const rel = path.relative(root, file); return !!rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); }
function cachePath(repositoryRoot: string, relative: unknown): string {
  if (typeof relative !== 'string' || !relative.startsWith('.cache/world-build/')) throw new TypeError('pinned source path must remain inside .cache/world-build');
  const base = path.resolve(repositoryRoot, '.cache/world-build'), resolved = path.resolve(repositoryRoot, relative);
  if (!inside(base, resolved)) throw new TypeError('pinned source path escapes the private build cache');
  return resolved;
}
async function readJson(filename: string, maxBytes: number): Promise<Record<string, unknown>> {
  const bytes = await readBoundedLocalFile(filename, maxBytes);
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`expected JSON object: ${filename}`);
  return value as Record<string, unknown>;
}
function assertDirectoryMatches(inventory: WorldInventory, directory: Awaited<ReturnType<typeof readCountryDirectory>>, pin: WorldInventory['sources'][number], expectedHash: string): void {
  if (directory.manifestHash !== expectedHash || directory.manifest.sourceUnitCount !== inventory.sourceUnitCount || directory.nodes.length !== inventory.nodes.length
      || canonical(directory.manifest.source) !== canonical(pin)) throw new Error('published country-directory source, manifest identity, or unit counts differ from rebuilt pinned 10m inventory');
  const order = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (canonical([...directory.nodes].sort(order)) !== canonical([...inventory.nodes].sort(order))) throw new Error('published country-directory hierarchy differs from rebuilt pinned source inventory');
}
async function run(data: { repositoryRoot: string; directoryHash: string }): Promise<Record<string, unknown>> {
  const repositoryRoot = data.repositoryRoot, cacheRoot = path.join(repositoryRoot, '.cache', 'world-build');
  if (!path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot || !/^[a-f0-9]{64}$/.test(data.directoryHash)) throw new TypeError('worker received invalid repository or directory binding');
  const frozenMetadata = await readJson(path.join(repositoryRoot, 'world', 'fine-catalogue-sources.json'), HARD.frozen);
  if (frozenMetadata.schemaVersion !== 1 || frozenMetadata.purpose !== 'metadata-discovery-only' || !frozenMetadata.pin || typeof frozenMetadata.pin !== 'object') throw new TypeError('frozen fine-catalogue source pin is invalid');
  const pin = frozenMetadata.pin as FineCataloguePin;
  if (typeof pin.sourceUrl !== 'string' || typeof pin.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) || typeof pin.capturedAt !== 'string') throw new TypeError('frozen fine-catalogue metadata pin is malformed');
  const metadataBytes = await readBoundedLocalFile(path.join(cacheRoot, 'fine-catalogue-cache', `all-adm1-metadata.${pin.sha256}.json`), HARD.metadata);
  if (metadataBytes.byteLength !== pin.bytes || sha(metadataBytes) !== pin.sha256) throw new Error('cached metadata does not match its frozen byte/hash pin');

  const sourceConfig = await readJson(path.join(repositoryRoot, 'world', 'inventory-10m-sources.json'), 64 * 1024);
  const rawSource = sourceConfig.source;
  if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource) || !Number.isSafeInteger(sourceConfig.sourceFeatureCount)) throw new TypeError('frozen Natural Earth 10m source pin is invalid');
  const sourcePin = rawSource as WorldInventory['sources'][number];
  if (typeof sourcePin.id !== 'string' || typeof sourcePin.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourcePin.sha256) || !Number.isSafeInteger(sourcePin.bytes)) throw new TypeError('frozen Natural Earth 10m source hash or byte count is invalid');
  const sourceBytes = await readBoundedLocalFile(cachePath(repositoryRoot, sourceConfig.input), HARD.source);
  if (sourceBytes.byteLength !== sourcePin.bytes || sha(sourceBytes) !== sourcePin.sha256) throw new Error('cached Natural Earth 10m bytes do not match the frozen pin');
  const rawGeoJSON: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes));
  const inventory = buildInventory(sourcePin, rawGeoJSON);
  if (inventory.sourceUnitCount !== sourceConfig.sourceFeatureCount) throw new Error('rebuilt Natural Earth 10m map-unit count differs from frozen source config');
  const directory = await readCountryDirectory(path.join(cacheRoot, 'output', 'country-inventory'), data.directoryHash);
  assertDirectoryMatches(inventory, directory, sourcePin, data.directoryHash);
  const report = buildFineDirectoryCatalogue(metadataBytes, pin, inventory, rawGeoJSON, data.directoryHash);
  const body = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  if (body.byteLength > HARD.report) throw new RangeError('fine directory catalogue report exceeds 1 MB');
  const reportHash = sha(body), storeRoot = path.join(cacheRoot, 'fine-directory-catalogue'), relative = `reports/${reportHash}.json`, reportPath = path.join(storeRoot, relative);
  try {
    const existing = await readBoundedLocalFile(reportPath, HARD.report);
    if (!existing.equals(body) || sha(existing) !== reportHash) throw new Error('immutable fine directory catalogue report collision is corrupt');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await (await createOutputStore(storeRoot, cacheRoot)).writeImmutable(relative, body);
  }
  return { reportHash, reportPath, bytes: body.byteLength, directoryHash: data.directoryHash, mapUnits: inventory.sourceUnitCount,
    metadataRecords: report.counts.metadataRecords, networkBytes: 0 };
}

try { const result = await run(workerData as { repositoryRoot: string; directoryHash: string }); parentPort?.postMessage({ ok: true, result }); }
catch (error) { parentPort?.postMessage({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000) }); }
