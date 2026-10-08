import { createHash } from 'node:crypto';
import { readFile, lstat, mkdir, realpath, stat, statfs, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { validateManifest, validateTile } from './validate.ts';
import { Ledger } from './ledger.ts';
import { encodeManifest, encodeTile, sha256 } from './pack.ts';
import { createOutputStore } from './storage.ts';
import type { Region, SourceRecord } from './types.ts';

export const COMPILER_VERSION = 'world-source-compiler-v1';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.dirname(MODULE_DIR);
export const ALLOWED_ROOT = path.join(REPOSITORY_ROOT, '.cache', 'world-build');
export const OUTPUT_ROOT = path.join(ALLOWED_ROOT, 'output');
export const LEDGER_PATH = path.join(ALLOWED_ROOT, 'world.sqlite');
const RUN_LOCK_PATH = path.join(ALLOWED_ROOT, 'runner.lock');
export const RUN_LIMITS = Object.freeze({ inputBytes: 20_000_000, totalInputBytes: 50_000_000, perJobOutputBytes: 100_000_000, freeDiskReserveBytes: 100_000_000, jobs: 20, durationMs: 60_000, leaseMs: 70_000, attempts: 2 });

export interface WorldPlan { region: Region; source: SourceRecord; input: { path: string; sha256: string; bytes: number }; rawExtraction?: { url: string; fetched: string; sha256: string; bytes: number } }
export interface RunOptions { maxJobs?: number; durationMs?: number }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function assertPlan(value: unknown): WorldPlan {
  if (!value || typeof value !== 'object') throw new TypeError('plan must be an object');
  const keys = (item: object, allowed: string[], label: string) => { for (const key of Object.keys(item)) if (!allowed.includes(key)) throw new TypeError(`unknown ${label} field: ${key}`); };
  keys(value, ['region', 'source', 'input', 'rawExtraction'], 'plan');
  const plan = value as WorldPlan;
  if (!plan.region || !plan.source || !plan.input || typeof plan.input.path !== 'string') throw new TypeError('plan needs region, source, and input');
  if (plan.region.countryCode === 'NG') throw new TypeError('Nigeria region compilation is explicitly excluded');
  keys(plan.region, ['id','parentId','name','kind','countryCode','timezone','bounds'], 'region');
  keys(plan.source, ['id','url','release','license','attribution','sha256','bytes'], 'source');
  keys(plan.input, ['path','sha256','bytes'], 'input');
  if (!/^[a-f0-9]{64}$/.test(plan.source.sha256) || !Number.isSafeInteger(plan.source.bytes) || plan.source.bytes < 1) throw new TypeError('source requires pinned SHA-256 and positive byte count');
  if (!/^[a-f0-9]{64}$/.test(plan.input.sha256) || !Number.isSafeInteger(plan.input.bytes) || plan.input.bytes < 1 || plan.input.bytes > RUN_LIMITS.inputBytes) throw new TypeError('input requires a valid SHA-256 and bounded positive byte count');
  if (plan.source.sha256 !== plan.input.sha256 || plan.source.bytes !== plan.input.bytes) throw new TypeError('source record must pin the exact local GeoJSON input bytes');
  if (plan.rawExtraction) {
    keys(plan.rawExtraction, ['url','fetched','sha256','bytes'], 'rawExtraction');
    if (typeof plan.rawExtraction.url !== 'string' || typeof plan.rawExtraction.fetched !== 'string' || !/^[a-f0-9]{64}$/.test(plan.rawExtraction.sha256) || !Number.isSafeInteger(plan.rawExtraction.bytes) || plan.rawExtraction.bytes < 1) throw new TypeError('raw extraction provenance is invalid');
  }
  return plan;
}
async function checkNoSymlinkPath(target: string, base: string): Promise<void> {
  const resolvedBase = path.resolve(base), resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('path is outside the allowed world-build root');
  let cursor = resolvedBase;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { const stat = await lstat(cursor); if (stat.isSymbolicLink()) throw new Error(`symlink path refused: ${cursor}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
export async function validateBuildRoots(): Promise<void> {
  const repositoryStat = await lstat(REPOSITORY_ROOT);
  if (repositoryStat.isSymbolicLink() || !repositoryStat.isDirectory() || await realpath(REPOSITORY_ROOT) !== path.resolve(REPOSITORY_ROOT)) {
    throw new Error('repository root must be a canonical directory without symlink components');
  }
  // Create one component at a time only after lstat, so a symlinked .cache
  // cannot redirect recursive mkdir and create world-build outside the repo.
  let cursor = REPOSITORY_ROOT;
  for (const part of path.relative(REPOSITORY_ROOT, ALLOWED_ROOT).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`world-build path component must be a directory without symlinks: ${cursor}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { await mkdir(cursor); }
      catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`world-build path component must be a directory without symlinks: ${cursor}`);
    }
    if (await realpath(cursor) !== cursor) throw new Error(`world-build path component resolves through a symlink: ${cursor}`);
  }
  const real = await realpath(ALLOWED_ROOT);
  if (real !== path.resolve(ALLOWED_ROOT)) throw new Error('world-build root may not resolve through a symlink');
  await checkNoSymlinkPath(LEDGER_PATH, ALLOWED_ROOT);
  await checkNoSymlinkPath(OUTPUT_ROOT, ALLOWED_ROOT);
  await checkNoSymlinkPath(RUN_LOCK_PATH, ALLOWED_ROOT);
}
async function acquireRunLock(): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(RUN_LOCK_PATH, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`); await handle.sync();
      return async () => { await handle.close(); await unlink(RUN_LOCK_PATH).catch(() => {}); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const info = await lstat(RUN_LOCK_PATH);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('runner lock is not a regular file');
      const pid = Number((await readFile(RUN_LOCK_PATH, 'utf8')).trim());
      let alive = Number.isSafeInteger(pid) && pid > 0;
      if (alive) { try { process.kill(pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code === 'EPERM'; } }
      if (!Number.isSafeInteger(pid) && Date.now() - info.mtimeMs < 30_000) alive = true;
      if (alive) throw new Error(`another world runner is active (pid ${pid})`);
      await unlink(RUN_LOCK_PATH);
    }
  }
  throw new Error('could not acquire world runner lock');
}
export function jobIdentity(plan: WorldPlan): { id: string; inputHash: string; payload: Record<string,unknown> } {
  const config = { region: plan.region, source: plan.source, input: plan.input, ...(plan.rawExtraction ? { rawExtraction: plan.rawExtraction } : {}) };
  const inputHash = digest({ compilerVersion: COMPILER_VERSION, schemaVersion: 1, config, sourceHash: plan.source.sha256, inputHash: plan.input.sha256 });
  return { id: `world-${inputHash.slice(0,40)}`, inputHash, payload: { ...config, compilerVersion: COMPILER_VERSION, schemaVersion: 1 } };
}
export async function compileInWorker(plan: WorldPlan, timeoutMs: number, memoryMb = 512, signal?: AbortSignal): Promise<{ manifest: unknown; tiles: unknown[] }> {
  // The worker is terminated at the actual per-job wall-clock boundary, including synchronous geometry work.
  const source = `import { parentPort, workerData } from 'node:worker_threads';\nimport { pathToFileURL } from 'node:url';\nimport { stat, readFile } from 'node:fs/promises';\nimport { createHash } from 'node:crypto';\nconst info=await stat(workerData.plan.input.path);if(info.size!==workerData.plan.input.bytes||info.size>workerData.maxBytes)throw new Error('input size does not match plan or exceeds byte limit');\nconst bytes=await readFile(workerData.plan.input.path);const hash=createHash('sha256').update(bytes).digest('hex');if(bytes.byteLength!==info.size||hash!==workerData.plan.input.sha256)throw new Error('input changed after size check or SHA-256 mismatch');\nconst geojson=JSON.parse(bytes.toString('utf8'));const { manifest, tiles } = await (await import(pathToFileURL(workerData.ingest).href)).compileRegion(workerData.plan.region, workerData.plan.source, geojson);\nparentPort.postMessage({ manifest, tiles });`;
  return await new Promise((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { workerData: { ingest: path.join(MODULE_DIR, 'ingest.ts'), plan, maxBytes: RUN_LIMITS.inputBytes }, resourceLimits: { maxOldGenerationSizeMb: Math.max(32, Math.floor(memoryMb * 0.75)), maxYoungGenerationSizeMb: Math.max(16, Math.floor(memoryMb * 0.2)) }, execArgv: ['--experimental-strip-types'] });
    let finished=false;
    const finish=(error?:Error,value?:{manifest:unknown;tiles:unknown[]})=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
    const abort=()=>{void worker.terminate();finish(new Error('compile aborted by campaign signal'));};
    const timer=setTimeout(()=>{void worker.terminate();finish(new Error(`compile exceeded ${timeoutMs} ms job duration`));},timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    worker.once('message',(value:{manifest:unknown;tiles:unknown[]})=>{finish(undefined,value);void worker.terminate();});
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>{if(code!==0)finish(new Error(`compile worker exited ${code}`));});
  });
}
async function publish(plan: WorldPlan, durationMs: number, deadline: number): Promise<{ manifestHash: string; manifestPath: string; bytes: number }> {
  await validateBuildRoots();
  const reserve = RUN_LIMITS.freeDiskReserveBytes;
  const disk = await statfs(ALLOWED_ROOT);
  if (disk.bavail * disk.bsize < reserve) throw new RangeError(`free disk space is below ${reserve} byte reserve`);
  const store = await createOutputStore(OUTPUT_ROOT, ALLOWED_ROOT);
  const compiled = await compileInWorker(plan, durationMs);
  let total = 0;
  for (const value of compiled.tiles) {
    if (Date.now() >= deadline) throw new Error('job duration limit reached before output publication');
    const { ref, bytes } = encodeTile(value as never);
    total += bytes.byteLength;
    if (total > RUN_LIMITS.perJobOutputBytes) throw new RangeError('per-job output exceeds byte budget');
    await store.writeImmutable(ref.path, bytes);
  }
  const encoded = encodeManifest(compiled.manifest as never);
  if (Date.now() >= deadline) throw new Error('job duration limit reached before manifest publication');
  total += encoded.bytes.byteLength;
  if (total > RUN_LIMITS.perJobOutputBytes) throw new RangeError('per-job output exceeds byte budget');
  const manifestPath = `manifests/${encoded.hash}.json`;
  await store.writeImmutable(manifestPath, encoded.bytes);
  return { manifestHash: encoded.hash, manifestPath, bytes: total };
}

/** Compile one campaign job into its isolated immutable output store. */
export async function compileCampaignPlan(planValue: WorldPlan, outputRoot: string, allowedRoot: string, timeoutMs: number, outputLimitBytes: number, memoryMb = 512, signal?: AbortSignal): Promise<{ manifestHash: string; manifestPath: string; bytes: number }> {
  const plan = assertPlan(planValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 1) throw new RangeError('campaign compile limits must be positive safe integers');
  const deadline = Date.now() + timeoutMs;
  const disk = await statfs(allowedRoot);
  if (disk.bavail * disk.bsize < RUN_LIMITS.freeDiskReserveBytes) throw new RangeError('free disk space is below world-build reserve');
  const store = await createOutputStore(outputRoot, allowedRoot);
  const compiled = await compileInWorker(plan, timeoutMs, memoryMb, signal);
  let total = 0;
  for (const value of compiled.tiles) {
    if (Date.now() >= deadline) throw new Error('campaign job duration limit reached before output publication');
    const { ref, bytes } = encodeTile(value as never);
    total += bytes.byteLength;
    if (total > outputLimitBytes) throw new RangeError('campaign job output exceeds byte budget');
    await store.writeImmutable(ref.path, bytes);
  }
  const encoded = encodeManifest(compiled.manifest as never);
  if (Date.now() >= deadline) throw new Error('campaign job duration limit reached before manifest publication');
  total += encoded.bytes.byteLength;
  if (total > outputLimitBytes) throw new RangeError('campaign job output exceeds byte budget');
  const manifestPath = `manifests/${encoded.hash}.json`;
  await store.writeImmutable(manifestPath, encoded.bytes);
  return { manifestHash: encoded.hash, manifestPath, bytes: total };
}
async function safeReadOutput(relative: string, maxBytes: number): Promise<Uint8Array> {
  if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('unsafe output reference in completion record');
  const target = path.resolve(OUTPUT_ROOT, ...relative.split('/'));
  const rel = path.relative(OUTPUT_ROOT, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('output reference escapes output root');
  try {
    await checkNoSymlinkPath(target, OUTPUT_ROOT);
    const resolvedRoot = await realpath(OUTPUT_ROOT), resolvedTarget = await realpath(target);
    if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) throw new Error('output reference resolves outside output root');
    const info = await stat(resolvedTarget);
    if (!info.isFile() || info.size > maxBytes) throw new RangeError('published output is not a bounded regular file');
    return await readFile(resolvedTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`published output is missing (${relative}); automatic repair is not implemented and operator repair is required`);
    throw error;
  }
}
export async function loadPlan(pathValue: string): Promise<WorldPlan> {
  const absolute = path.isAbsolute(pathValue) ? pathValue : path.resolve(REPOSITORY_ROOT, pathValue);
  const size = await stat(absolute);
  if (!size.isFile() || size.size > 1_000_000) throw new RangeError('plan must be a regular file no larger than 1 MB');
  const bytes = await readFile(absolute);
  if (bytes.byteLength !== size.size) throw new Error('plan changed while it was read');
  const plan = assertPlan(JSON.parse(bytes.toString('utf8')) as unknown);
  if (!path.isAbsolute(plan.input.path)) plan.input.path = path.resolve(path.dirname(absolute), plan.input.path);
  return plan;
}
export async function runPlan(planValue: WorldPlan, options: RunOptions = {}): Promise<{ jobs: Array<Record<string,unknown>>; failures: string[]; stopped: string | null }> {
  const plan = assertPlan(planValue);
  const maxJobs = Math.min(options.maxJobs ?? RUN_LIMITS.jobs, RUN_LIMITS.jobs);
  const durationMs = Math.min(options.durationMs ?? RUN_LIMITS.durationMs, RUN_LIMITS.durationMs);
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || !Number.isFinite(durationMs) || durationMs < 1) throw new RangeError('run limits must be positive');
  await validateBuildRoots();
  // Guard before SQLite opens the file, including pre-existing database symlinks.
  await checkNoSymlinkPath(LEDGER_PATH, ALLOWED_ROOT);
  const releaseLock = await acquireRunLock();
  let ledger: Ledger | null = null;
  const identity = jobIdentity(plan), failures: string[] = [];
  const start = Date.now(); let stopped: string | null = null, totalInput = 0, processed = 0;
  try {
    ledger = new Ledger(LEDGER_PATH);
    ledger.enqueue({ ...identity, kind: 'compile-region', maxAttempts: RUN_LIMITS.attempts });
    const state = ledger.list().find(job => job.id === identity.id);
    if (state?.status === 'completed') {
      const result = state.result as { manifestHash?: string; manifestPath?: string } | null;
      if (!result?.manifestHash || result.manifestPath !== `manifests/${result.manifestHash}.json`) throw new Error('completed job receipt is malformed');
      const manifestBytes = await safeReadOutput(result.manifestPath, 2_000_000);
      if (!manifestBytes || sha256(manifestBytes) !== result?.manifestHash) throw new Error('completed job manifest hash is corrupt; automatic repair is not implemented and operator repair is required');
      const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown);
      if (manifest.region.id !== plan.region.id || manifest.sources.length === 0 || manifest.sources[0]?.sha256 !== plan.source.sha256) throw new Error('completed job manifest does not match its region/source plan');
      const sourceIds = new Set(manifest.sources.map(source => source.id));
      for (const tile of manifest.tiles) {
        const data = await safeReadOutput(tile.path, 10_000_000);
        if (data.byteLength !== tile.bytes || sha256(data) !== tile.sha256) throw new Error(`completed job tile hash is corrupt (${tile.path}); automatic repair is not implemented and operator repair is required`);
        const decoded = validateTile(JSON.parse(new TextDecoder().decode(data)) as unknown);
        if (decoded.id !== tile.id || decoded.regionId !== manifest.region.id || [...decoded.buildings,...decoded.roads].some(feature => !sourceIds.has(feature.sourceId))) throw new Error(`completed job tile does not resolve to manifest: ${tile.path}`);
      }
      return { jobs: ledger.list(), failures: [], stopped: null };
    }
    while (processed < maxJobs) {
      if (Date.now() - start >= durationMs) { stopped = 'run duration limit reached'; break; }
      const claim = ledger.claim('world-cli', Date.now(), RUN_LIMITS.leaseMs);
      if (!claim) break;
      try {
        if (claim.kind !== 'compile-region' || !claim.payload || typeof claim.payload !== 'object') throw new TypeError('claimed job has an unsupported payload');
        const payload = claim.payload as WorldPlan & { compilerVersion?: string; schemaVersion?: number };
        if (payload.compilerVersion !== COMPILER_VERSION || payload.schemaVersion !== 1) throw new Error('claimed job compiler/schema identity is unsupported');
        const claimedPlan = assertPlan({ region: payload.region, source: payload.source, input: payload.input, rawExtraction: payload.rawExtraction });
        if (!path.isAbsolute(claimedPlan.input.path)) claimedPlan.input.path = path.resolve(REPOSITORY_ROOT, claimedPlan.input.path);
        if (jobIdentity(claimedPlan).inputHash !== claim.inputHash) throw new Error('claimed job identity does not match its validated payload');
        totalInput += claimedPlan.input.bytes;
        if (totalInput > RUN_LIMITS.totalInputBytes) throw new RangeError('cumulative input byte budget exceeded');
        const jobDeadline = Math.min(start + durationMs, Date.now() + RUN_LIMITS.durationMs);
        const result = await publish(claimedPlan, Math.max(1, jobDeadline - Date.now()), jobDeadline);
        if (!ledger.complete(claim.id, claim.token, Date.now(), result)) throw new Error('job lease lost before completion');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ledger.fail(claim.id, claim.token, Date.now(), message, 0);
        failures.push(`${claim.id}: ${message}`);
      }
      processed++;
    }
    const jobs = ledger.list();
    if (!stopped && jobs.some(job => job.status === 'queued' || job.status === 'leased')) stopped = 'work remains queued or leased after the bounded run';
    return { jobs, failures, stopped };
  } finally { ledger?.close(); await releaseLock(); }
}
export async function status(): Promise<Array<Record<string,unknown>>> {
  await validateBuildRoots(); await checkNoSymlinkPath(LEDGER_PATH, ALLOWED_ROOT);
  const ledger = new Ledger(LEDGER_PATH);
  try { return ledger.list(); } finally { ledger.close(); }
}
