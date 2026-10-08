import { createHash, randomUUID } from 'node:crypto';
import { lstat, opendir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { createOutputStore } from './storage.ts';

const HARD = Object.freeze({ durationMs: 120_000, workerOldMb: 256, workerYoungMb: 32, rss: 512 * 1024 * 1024,
  reportBytes: 1_000_000, outputBytes: 20 * 1024 * 1024, outputEntries: 128, freeBytes: 100 * 1024 * 1024,
  auditEntries: 128, auditRecordBytes: 8 * 1024, auditReserveBytes: 16 * 1024, reportReserveBytes: 1_000_000, reserveEntries: 8 });
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): string => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('non-finite audit value'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new TypeError('unsupported audit value');
};
function errorText(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 2_000); }
function inside(root: string, child: string): boolean { const rel = path.relative(root, child); return !!rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); }
function check(signal: AbortSignal, deadline: number): void { if (signal.aborted) throw signal.reason ?? new Error('fine directory catalogue aborted'); if (Date.now() >= deadline) throw new Error('fine directory catalogue exceeded its 120-second deadline'); }

async function treeUsage(root: string): Promise<{ bytes: number; entries: number }> {
  let bytes = 0, entries = 0;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 4) throw new RangeError('fine directory catalogue output exceeds depth cap');
    let info; try { info = await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && directory === root) return; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('fine directory catalogue tree contains an unsafe directory');
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (++entries > HARD.outputEntries) throw new RangeError('fine directory catalogue tree exceeds 128 entries');
      const target = path.join(directory, entry.name), child = await lstat(target);
      if (child.isSymbolicLink()) throw new Error('fine directory catalogue tree contains a symlink');
      if (child.isDirectory()) await walk(target, depth + 1);
      else if (child.isFile()) { bytes += child.size; if (bytes > HARD.outputBytes) throw new RangeError('fine directory catalogue tree exceeds 20 MiB'); }
      else throw new Error('fine directory catalogue tree contains a non-regular entry');
    }
  };
  await walk(root, 0); return { bytes, entries };
}
function validateWorkerReply(value: unknown, directoryHash: string, outputRoot: string): { reportHash: string; reportPath: string; bytes: number; directoryHash: string; mapUnits: number; metadataRecords: number; networkBytes: 0 } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('fine directory catalogue worker reply is malformed');
  const row = value as Record<string, unknown>, keys = ['reportHash','reportPath','bytes','directoryHash','mapUnits','metadataRecords','networkBytes'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) throw new TypeError('fine directory catalogue worker reply has unknown fields');
  if (typeof row.reportHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.reportHash) || row.directoryHash !== directoryHash
      || typeof row.reportPath !== 'string' || path.resolve(row.reportPath) !== row.reportPath
      || row.reportPath !== path.join(outputRoot, 'reports', `${row.reportHash}.json`)
      || !Number.isSafeInteger(row.bytes) || (row.bytes as number) < 1 || (row.bytes as number) > HARD.reportBytes
      || !Number.isSafeInteger(row.mapUnits) || (row.mapUnits as number) < 1 || (row.mapUnits as number) > 10_000
      || !Number.isSafeInteger(row.metadataRecords) || (row.metadataRecords as number) < 1 || (row.metadataRecords as number) > 300
      || row.networkBytes !== 0) throw new TypeError('fine directory catalogue worker reply values are invalid');
  return row as { reportHash: string; reportPath: string; bytes: number; directoryHash: string; mapUnits: number; metadataRecords: number; networkBytes: 0 };
}
async function runWorker(data: { repositoryRoot: string; directoryHash: string }, signal: AbortSignal, deadline: number): Promise<unknown> {
  if (process.memoryUsage().rss > HARD.rss) throw new RangeError('fine directory catalogue parent RSS already exceeds 512 MiB');
  const worker = new Worker(new URL('./fine-directory-catalogue-worker.ts', import.meta.url), { workerData: data,
    resourceLimits: { maxOldGenerationSizeMb: HARD.workerOldMb, maxYoungGenerationSizeMb: HARD.workerYoungMb } });
  let reply: unknown, workerError: Error | undefined, exited = false, resolveExit!: (code: number) => void, terminating: Promise<void> | undefined;
  const exit = new Promise<number>(resolve => { resolveExit = resolve; });
  worker.on('message', (value: unknown) => { reply = value; });
  worker.on('error', error => { workerError = error; });
  worker.on('exit', code => { exited = true; resolveExit(code); });
  const terminateAndWait = (): Promise<void> => terminating ??= (async () => { if (!exited) await worker.terminate(); await exit; })();
  let rejectControl!: (error: Error) => void;
  const control = new Promise<never>((_resolve, reject) => { rejectControl = reject; });
  const stop = (): void => { rejectControl(signal.reason instanceof Error ? signal.reason : new Error('fine directory catalogue aborted')); void terminateAndWait(); };
  const poll = setInterval(() => {
    if (process.memoryUsage().rss > HARD.rss) { rejectControl(new RangeError('fine directory catalogue parent RSS exceeded 512 MiB')); void terminateAndWait(); }
    if (Date.now() >= deadline) { rejectControl(new Error('fine directory catalogue exceeded its 120-second deadline')); void terminateAndWait(); }
  }, 100); poll.unref(); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
  try {
    const code = await Promise.race([exit, control]);
    if (workerError) throw workerError;
    if (code !== 0) throw new Error(`fine directory catalogue worker exited with code ${code}`);
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new Error('fine directory catalogue worker exited without a reply');
    const envelope = reply as Record<string, unknown>;
    if (Object.keys(envelope).length !== 2 || envelope.ok !== true && envelope.ok !== false) throw new TypeError('fine directory catalogue worker envelope is malformed');
    if (envelope.ok === false) { if (typeof envelope.error !== 'string' || envelope.error.length > 2_000) throw new TypeError('fine directory catalogue worker error is malformed'); throw new Error(envelope.error); }
    return envelope.result;
  } finally { clearInterval(poll); signal.removeEventListener('abort', stop); if (!exited) await terminateAndWait(); }
}

export interface FineDirectoryCatalogueCacheOptions { repositoryRoot?: string; directoryHash: string; signal?: AbortSignal; durationMs?: number }

/** Runs a bounded, cache-only v2 report build under the shared world-build lock. */
export async function buildFineDirectoryCatalogueFromCache(options: FineDirectoryCatalogueCacheOptions): Promise<Record<string, unknown>> {
  if (!/^[a-f0-9]{64}$/.test(options.directoryHash)) throw new TypeError('usage: --directory-hash <64-hex country-directory manifest SHA-256>');
  const durationMs = options.durationMs ?? HARD.durationMs;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > HARD.durationMs) throw new RangeError('fine directory catalogue duration must be 1..120,000 ms');
  const repositoryRoot = path.resolve(options.repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  if (options.repositoryRoot && repositoryRoot !== options.repositoryRoot) throw new TypeError('repositoryRoot must be canonical and absolute');
  const buildRoot = path.join(repositoryRoot, '.cache', 'world-build'), outputRoot = path.join(buildRoot, 'fine-directory-catalogue');
  const started = Date.now(), deadline = started + durationMs, deadlineController = new AbortController();
  const timer = setTimeout(() => deadlineController.abort(new Error('fine directory catalogue exceeded its 120-second deadline')), durationMs); timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadlineController.signal]) : deadlineController.signal;
  try {
    return await withAcquisitionBuildLock(buildRoot, async () => {
      check(signal, deadline);
      const usage = await treeUsage(outputRoot);
      if (usage.bytes + HARD.reportReserveBytes + HARD.auditReserveBytes > HARD.outputBytes || usage.entries + HARD.reserveEntries > HARD.outputEntries) throw new RangeError('fine directory catalogue output lacks reserved space under 20 MiB/128-entry caps');
      const disk = await statfs(buildRoot);
      if (disk.bavail * disk.bsize < HARD.freeBytes + HARD.reportReserveBytes + HARD.auditReserveBytes) throw new RangeError('fine directory catalogue requires 100 MiB free plus report/audit reserve');
      check(signal, deadline);

      const attemptId = randomUUID(), requestHash = sha(Buffer.from(canonical({ compiler: 'fine-directory-catalogue-v2', directoryHash: options.directoryHash })));
      const store = await createOutputStore(outputRoot, buildRoot);
      const startRecord = { schemaVersion: 1, attemptId, requestHash, compiler: 'fine-directory-catalogue-v2', directoryHash: options.directoryHash,
        status: 'pending', startedAt: new Date(started).toISOString(), networkBytes: 0 };
      const startBytes = Buffer.from(`${canonical(startRecord)}\n`);
      if (startBytes.length > HARD.auditRecordBytes) throw new RangeError('fine directory catalogue audit record exceeds 8 KiB');
      await store.writeImmutable(`attempts/${attemptId}.json`, startBytes);
      let terminalWritten = false;
      try {
        check(signal, deadline);
        const raw = await runWorker({ repositoryRoot, directoryHash: options.directoryHash }, signal, deadline);
        check(signal, deadline);
        const result = validateWorkerReply(raw, options.directoryHash, outputRoot);
        const reportBytes = await readBoundedLocalFile(result.reportPath, HARD.reportBytes);
        if (reportBytes.byteLength !== result.bytes || sha(reportBytes) !== result.reportHash) throw new Error('published fine directory catalogue report failed hash/byte verification');
        let report: unknown;
        try { report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(reportBytes)) as unknown; } catch { throw new Error('published fine directory catalogue report is not valid UTF-8 JSON'); }
        if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('published fine directory catalogue report has invalid shape');
        const row = report as Record<string, unknown>, counts = row.counts as Record<string, unknown> | undefined, parent = row.parent as Record<string, unknown> | undefined;
        if (row.schemaVersion !== 2 || row.purpose !== 'metadata-discovery-only' || parent?.product !== 'country-directory' || parent.manifestHash !== options.directoryHash
            || !counts || counts.metadataRecords !== result.metadataRecords || row.sourceCounts === null || typeof row.sourceCounts !== 'object'
            || (row.sourceCounts as Record<string, unknown>).coarseSourceUnits !== result.mapUnits) throw new Error('published fine directory catalogue report does not match worker result bindings');
        const finalUsage = await treeUsage(outputRoot);
        if (finalUsage.bytes > HARD.outputBytes || finalUsage.entries > HARD.outputEntries) throw new RangeError('fine directory catalogue output exceeded preflighted tree limits');
        const final = Buffer.from(`${canonical({ ...startRecord, status: 'succeeded', finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
          reportHash: result.reportHash, bytes: result.bytes, mapUnits: result.mapUnits, metadataRecords: result.metadataRecords, networkBytes: 0 })}\n`);
        if (final.length > HARD.auditRecordBytes) throw new RangeError('fine directory catalogue terminal audit exceeds 8 KiB');
        await store.writeAtomic(`attempts/${attemptId}.json`, final); terminalWritten = true;
        return { status: 'verified', purpose: 'metadata-discovery-only', attemptId, requestHash, reportHash: result.reportHash, reportPath: result.reportPath,
          bytes: result.bytes, directoryHash: result.directoryHash, mapUnits: result.mapUnits, metadataRecords: result.metadataRecords, networkBytes: 0, elapsedMs: Date.now() - started };
      } catch (error) {
        if (!terminalWritten) {
          const status = options.signal?.aborted ? 'aborted' : deadlineController.signal.aborted ? 'timed-out' : 'failed';
          const final = Buffer.from(`${canonical({ ...startRecord, status, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started, error: errorText(error), networkBytes: 0 })}\n`);
          if (final.length <= HARD.auditRecordBytes) await store.writeAtomic(`attempts/${attemptId}.json`, final);
        }
        throw error;
      }
    }, { signal, timeoutMs: Math.max(1, deadline - Date.now()) });
  } finally { clearTimeout(timer); }
}

async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--directory-hash') throw new TypeError('usage: node --experimental-strip-types world/fine-directory-catalogue-cli.ts --directory-hash <64-hex country-directory manifest SHA-256>');
    const result = await buildFineDirectoryCatalogueFromCache({ directoryHash: args[1]! });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) { process.stderr.write(`fine directory catalogue cache verification failed: ${errorText(error)}\n`); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
