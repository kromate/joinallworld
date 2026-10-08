import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lstat, opendir, statfs } from 'node:fs/promises';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { loadFinePromotionContext } from './fine-promotion-load.ts';
import { buildFinePromotionRequest, buildFineSourcePromotion } from './fine-promotion.ts';
import { acquireFinePointer } from './fine-pointer-acquire.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { createOutputStore } from './storage.ts';
import { withAcquisitionBuildLock } from './acquire.ts';
import type { FinePromotionContext, FinePromotionSelection } from './fine-promotion-types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = '.cache/world-build/fine-promotions';
const MAX_BYTES = 2 * 1024 * 1024, MAX_ENTRIES = 128, RESERVE_BYTES = 320 * 1024;
const HASH = /^[a-f0-9]{64}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('expected bounded promotion configuration object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) throw new TypeError('promotion configuration has missing or unknown fields');
}
export async function loadFinePromotionSelections(repositoryRoot: string, configPath: string): Promise<{ catalogueHash: string; selections: FinePromotionSelection[] }> {
  if (!path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot || !/^world\/[a-z0-9][a-z0-9-]*\.json$/.test(configPath)) throw new TypeError('canonical repository and named world configuration are required');
  const config = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedLocalFile(path.join(repositoryRoot, configPath), 64 * 1024))) as unknown);
  keys(config, ['schemaVersion','catalogueHash','selections']);
  if (config.schemaVersion !== 1 || typeof config.catalogueHash !== 'string' || !HASH.test(config.catalogueHash) || !Array.isArray(config.selections) || config.selections.length < 1 || config.selections.length > 16) throw new TypeError('promotion configuration requires schema 1, catalogue hash and 1..16 selected pilots');
  const seen = new Set<string>();
  const selections = config.selections.map(value => {
    const row = object(value); keys(row, ['countryId','countryIso3','commit']);
    if (typeof row.countryId !== 'string' || !row.countryId || row.countryId.length > 512 || typeof row.countryIso3 !== 'string' || !/^[A-Z]{3}$/.test(row.countryIso3) || typeof row.commit !== 'string' || !/^[a-f0-9]{40}$/.test(row.commit)) throw new TypeError('selected promotion identity or commit is invalid');
    if (seen.has(row.countryIso3)) throw new Error('promotion configuration repeats a country');
    seen.add(row.countryIso3);
    return { countryId: row.countryId, countryIso3: row.countryIso3, commit: row.commit };
  });
  return { catalogueHash: config.catalogueHash, selections };
}
async function usage(root: string, signal: AbortSignal): Promise<{ bytes: number; entries: number }> {
  let bytes = 0, entries = 0;
  async function visit(dir: string, depth: number): Promise<void> {
    signal.throwIfAborted();
    if (depth > 4) throw new RangeError('promotion output exceeds depth 4');
    let info; try { info = await lstat(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && dir === root) return; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('promotion output contains an unsafe directory');
    for await (const entry of await opendir(dir)) {
      signal.throwIfAborted();
      if (++entries > MAX_ENTRIES) throw new RangeError('promotion output exceeds 128 entries');
      const file = path.join(dir, entry.name), child = await lstat(file);
      if (child.isSymbolicLink()) throw new Error('promotion output contains a symlink');
      if (child.isDirectory()) await visit(file, depth + 1);
      else if (child.isFile()) bytes += child.size;
      else throw new Error('promotion output contains a nonregular entry');
      if (bytes > MAX_BYTES) throw new RangeError('promotion output exceeds 2 MiB');
    }
  }
  await visit(root, 0); return { bytes, entries };
}
/** Publish immutable admission artifacts only. Geometry acquisition/topology are later stages. */
export async function publishFinePromotion(repositoryRoot: string, context: FinePromotionContext, selection: FinePromotionSelection, pointerBytes: Uint8Array, signal: AbortSignal, durationMs: number): Promise<{ requestHash: string; pinHash: string; pinPath: string; reportPath: string }> {
  if (!path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 120_000) throw new TypeError('canonical repository and 1..120000 ms publication duration are required');
  signal.throwIfAborted();
  // Rebuild admission instead of accepting a caller-constructed promotion/pin as proof.
  const promotion = buildFineSourcePromotion(context, selection, pointerBytes);
  const buildRoot = path.join(repositoryRoot, '.cache/world-build'), outputRoot = path.join(repositoryRoot, OUTPUT);
  return withAcquisitionBuildLock(buildRoot, async () => {
    signal.throwIfAborted();
    const before = await usage(outputRoot, signal), disk = await statfs(buildRoot);
    if (before.bytes + RESERVE_BYTES > MAX_BYTES || before.entries + 12 > MAX_ENTRIES) throw new RangeError('promotion output has insufficient reserved capacity');
    if (disk.bavail * disk.bsize < 100 * 1024 * 1024 + RESERVE_BYTES) throw new RangeError('promotion output needs 100 MiB free plus temporary publication reserve');
    const requestBytes = Buffer.from(canonicalJson(promotion.request)), requestHash = sha256(requestBytes);
    const pinBytes = Buffer.from(canonicalJson(promotion.pin)), pinHash = sha256(pinBytes);
    if (requestBytes.length > 32 * 1024 || pinBytes.length > 32 * 1024 || promotion.metadataRowBytes.length > 64 * 1024) throw new RangeError('promotion artifact exceeds its bounded size');
    const report = { schemaVersion: 1, purpose: 'local-source-admission', requestHash, pinHash, metadataRowHash: sha256(promotion.metadataRowBytes), sourceSha256: promotion.pointer.sha256, sourceBytes: promotion.pointer.bytes, geometryAcquired: false, topologyVerified: false };
    const reportBytes = Buffer.from(canonicalJson(report)), reportHash = sha256(reportBytes);
    const store = await createOutputStore(outputRoot, buildRoot);
    await store.writeImmutable(`metadata/${report.metadataRowHash}.json`, promotion.metadataRowBytes);
    signal.throwIfAborted();
    await store.writeImmutable(`requests/${requestHash}.json`, requestBytes);
    const pinPath = await store.writeImmutable(`pins/${pinHash}.json`, pinBytes);
    signal.throwIfAborted();
    const reportPath = await store.writeImmutable(`reports/${reportHash}.json`, reportBytes);
    await usage(outputRoot, signal);
    return { requestHash, pinHash, pinPath, reportPath };
  }, { signal, timeoutMs: durationMs });
}
async function main(): Promise<void> {
  const controller = new AbortController(), deadline = Date.now() + 60_000;
  const timer = setTimeout(() => controller.abort(new Error('promotion CLI exceeded its 60-second session')), 60_000); timer.unref();
  const stop = (): void => controller.abort(new Error('promotion CLI interrupted'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const [command, configFile, iso3, ...extra] = process.argv.slice(2);
    if (!['inspect','capture','cached'].includes(command ?? '') || !configFile || extra.length || (command !== 'inspect' && !iso3)) throw new TypeError('usage: fine-promotion-cli.ts inspect|capture|cached world/fine-promotion-sources.json [ISO3]; capture admits one pointer, not geometry');
    const config = await loadFinePromotionSelections(ROOT, configFile);
    const context = await loadFinePromotionContext({ repositoryRoot: ROOT, catalogueHash: config.catalogueHash, signal: controller.signal });
    const selections = iso3 ? config.selections.filter(row => row.countryIso3 === iso3) : config.selections;
    if (!selections.length) throw new Error('country is not in the explicit selected promotion configuration');
    if (command === 'inspect') {
      process.stdout.write(`${JSON.stringify(selections.map(selection => buildFinePromotionRequest(context, selection)), null, 2)}\n`);
      return;
    }
    const selection = selections[0]!, request = buildFinePromotionRequest(context, selection);
    const pointer = await acquireFinePointer(request, { repositoryRoot: ROOT, signal: controller.signal, durationMs: Math.max(1, Math.min(30_000, deadline - Date.now())), cacheOnly: command === 'cached' });
    const promotion = buildFineSourcePromotion(context, selection, pointer.pointerBytes);
    const output = await publishFinePromotion(ROOT, context, selection, pointer.pointerBytes, controller.signal, Math.max(1, deadline - Date.now()));
    process.stdout.write(`${JSON.stringify({ ...output, countryIso3: selection.countryIso3, sourceSha256: promotion.pin.source.sha256, sourceBytes: promotion.pin.source.bytes, pointerNetworkBytes: pointer.networkBytes, cacheHit: pointer.cacheHit, geometryAcquired: false, topologyVerified: false }, null, 2)}\n`);
  } catch (error) { process.stderr.write(`fine promotion failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
  finally { clearTimeout(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
