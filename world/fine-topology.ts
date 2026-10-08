import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, stat, statfs } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { createOutputStore } from './storage.ts';
import { validateFineSourcePin } from './fine.ts';
import type { FineSourcePin, FineTopologyReport } from './fine-types.ts';
import { validateFineTopologyReport as validateFineTopologyEvidence } from './fine-quality.ts';
export type { FineTopologyReport } from './fine-types.ts';

const MAX_DURATION_MS = 60_000;
const MAX_CHILD_RSS_BYTES = 512 * 1024 * 1024;
const MAX_STDOUT_BYTES = 64 * 1024 + 1;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_ATTEMPT_BYTES = 8 * 1024;
const MAX_ATTEMPTS = 256;
const MAX_TOPOLOGY_TREE_BYTES = 8 * 1024 * 1024;
const MAX_TREE_ENTRIES = 4096;
const MAX_TREE_DEPTH = 8;
const DISK_RESERVE_BYTES = 100 * 1024 * 1024 + 96 * 1024;
const MAX_ERROR_BYTES = 2_000;
const SHA256 = /^[a-f0-9]{64}$/;
const VALIDATOR = 'duckdb-spatial-ogc-planar-v1';
const DUCKDB_VERSION = '1.5.6';
const SPATIAL_VERSION = '04270fe';
const SPATIAL_SHA256 = 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = path.join(moduleRoot, '.cache', 'world-build', 'tooling', 'venv', 'bin', 'python3.12');
const PYTHON_SCRIPT = path.join(moduleRoot, 'world', 'tooling', 'fine_topology.py');

export interface FineTopologyOptions {
  repositoryRoot: string;
  pin: FineSourcePin;
  signal?: AbortSignal;
  durationMs?: number;
}
export interface FineTopologyResult {
  requestHash: string;
  reportHash: string;
  reportPath: string;
  report: FineTopologyReport;
  elapsedMs: number;
  networkBytes: 0;
  peakRssBytes: number | null;
  rssSamples: number;
}
function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('fine topology identity has a non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new TypeError('fine topology identity is not JSON data');
}
function sha256(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex'); }
function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid bounded text`);
  return value;
}
function compareCodepoints(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!);
  const b = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
/** Wrapper that validates the complete source pin before using the browser-safe report validator. */
export function validateFineTopologyReport(value: unknown, pinValue: FineSourcePin, expectedKeys: readonly string[]): FineTopologyReport {
  const pin = validateFineSourcePin(pinValue);
  return validateFineTopologyEvidence(value, pin, expectedKeys);
}

async function inspectPath(target: string): Promise<void> {
  if (!path.isAbsolute(target) || path.resolve(target) !== target || target.split(path.sep).includes('..')) throw new TypeError('fine topology paths must be canonical and absolute');
  const parsed = path.parse(target);
  let cursor = parsed.root;
  for (const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let info;
    try { info = await lstat(cursor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || (cursor !== target && !info.isDirectory())) throw new Error(`fine topology path contains a symlink or non-directory ancestor: ${cursor}`);
  }
}
async function ensureDirectory(target: string, root: string): Promise<void> {
  if (!within(root, target)) throw new Error('fine topology directory escapes canonical build root');
  const rel = path.relative(root, target);
  let cursor = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`fine topology directory is unsafe: ${cursor}`);
  }
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function syncAppendAttempt(filename: string, record: Record<string, unknown>, create: boolean): Promise<void> {
  const line = Buffer.from(`${canonical(record)}\n`);
  if (line.length > MAX_ATTEMPT_BYTES) throw new RangeError('fine topology attempt record exceeds 8 KiB');
  const flags = constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0) | (create ? constants.O_CREAT | constants.O_EXCL : 0);
  const handle = await open(filename, flags, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size + line.length > MAX_ATTEMPT_BYTES) throw new RangeError('fine topology attempt file exceeds 8 KiB');
    await handle.writeFile(line);
    await handle.sync();
  } finally { await handle.close(); }
  await syncDirectory(path.dirname(filename));
}

interface TreeUsage { entries: number; bytes: number }
async function treeUsage(root: string): Promise<TreeUsage> {
  let entries = 0, bytes = 0;
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_TREE_DEPTH) throw new RangeError('fine topology subtree exceeds depth 8');
    let dir;
    try { dir = await opendir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && directory === root) return; throw error; }
    try {
      for await (const entry of dir) {
        if (++entries > MAX_TREE_ENTRIES) throw new RangeError('fine topology subtree exceeds 4096 entries');
        const filename = path.join(directory, entry.name), info = await lstat(filename);
        if (info.isSymbolicLink()) throw new Error(`fine topology subtree contains a symlink: ${filename}`);
        if (info.isDirectory()) await visit(filename, depth + 1);
        else if (info.isFile()) {
          bytes += info.size;
          if (bytes > MAX_TOPOLOGY_TREE_BYTES) throw new RangeError('fine topology subtree exceeds 8 MiB');
        } else throw new Error(`fine topology subtree contains a non-regular path: ${filename}`);
      }
    } finally { await dir.close().catch(() => {}); }
  }
  await visit(root, 0);
  return { entries, bytes };
}
async function attemptUsage(directory: string): Promise<{ entries: number; bytes: number }> {
  let dir;
  try { dir = await opendir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: 0, bytes: 0 }; throw error; }
  let entries = 0, bytes = 0;
  try {
    for await (const entry of dir) {
      if (++entries > MAX_ATTEMPTS) throw new RangeError('fine topology attempt file cap of 256 reached');
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.jsonl$/.test(entry.name)) throw new Error('fine topology attempt directory contains an unexpected entry');
      const filename = path.join(directory, entry.name), info = await lstat(filename);
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_ATTEMPT_BYTES) throw new Error('fine topology attempt file is unsafe or exceeds 8 KiB');
      bytes += info.size;
    }
  } finally { await dir.close().catch(() => {}); }
  if (bytes > MAX_ATTEMPTS * MAX_ATTEMPT_BYTES) throw new RangeError('fine topology attempt metadata exceeds its 2 MiB budget');
  return { entries, bytes };
}
async function checkDisk(buildRoot: string): Promise<void> {
  const disk = await statfs(buildRoot);
  if (disk.bavail * disk.bsize < DISK_RESERVE_BYTES) throw new RangeError('fine topology requires 100 MiB free reserve plus 96 KiB publication headroom');
}
interface ChildOutput { code: number | null; stdout: Buffer; stderr: Buffer; peakRssBytes: number | null; rssSamples: number }
async function validateFixedRuntime(): Promise<void> {
  await inspectPath(PYTHON_SCRIPT);
  const worker = await lstat(PYTHON_SCRIPT);
  if (!worker.isFile() || worker.isSymbolicLink()) throw new Error('fixed fine topology worker must be a regular non-symlink file');
  const venv = path.join(moduleRoot, '.cache', 'world-build', 'tooling', 'venv');
  await inspectPath(venv);
  await inspectPath(path.dirname(PYTHON));
  const pythonStat = await lstat(PYTHON);
  if (!pythonStat.isSymbolicLink()) {
    if (!pythonStat.isFile() || (pythonStat.mode & 0o111) === 0) throw new Error('fixed Python runtime is not an executable regular file');
  }
  const resolved = await realpath(PYTHON);
  const runtimeSuffix = path.join('codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'bin', 'python3.12');
  if (!resolved.endsWith(`${path.sep}${runtimeSuffix}`)) throw new Error('fixed Python runtime alias resolves outside the pinned Codex Python runtime');
  const resolvedStat = await stat(resolved);
  if (!resolvedStat.isFile() || (resolvedStat.mode & 0o111) === 0) throw new Error('resolved Python runtime is not executable');
}
async function runPython(request: Record<string, unknown>, signal: AbortSignal, deadlineAt: number,
  onStarted: (pid: number) => Promise<void>, onRssSample: (peak: number, samples: number) => void): Promise<ChildOutput> {
  const payload = Buffer.from(`${JSON.stringify(request)}\n`);
  if (payload.length > 64 * 1024) throw new RangeError('fine topology worker request exceeds 64 KiB');
  const worker = spawn(PYTHON, ['-I', PYTHON_SCRIPT], {
    cwd: path.dirname(path.dirname(PYTHON_SCRIPT)), shell: false, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: path.dirname(PYTHON), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  let closed = false, closeData: ChildOutput | null = null, failure: Error | null = null;
  let stdoutBytes = 0, stderrBytes = 0;
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let probePromise: Promise<void> | null = null;
  let peakRssBytes: number | null = null, rssSamples = 0;
  const lifecycle: { startup: Promise<void> | null } = { startup: null };
  let probing = false;
  let resolveClose!: (output: ChildOutput) => void;
  const closePromise = new Promise<ChildOutput>(resolve => { resolveClose = resolve; });
  const fail = (error: Error): void => {
    if (!failure) failure = error;
    if (!closed && worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
  };
  worker.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT_BYTES) { fail(new RangeError('fine topology stdout exceeded 64 KiB plus final newline')); return; }
    stdout.push(chunk);
  });
  worker.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX_STDERR_BYTES) { fail(new RangeError('fine topology stderr exceeded 16 KiB')); return; }
    stderr.push(chunk);
  });
  worker.stdin.on('error', error => fail(error));
  worker.once('error', error => fail(error));
  worker.once('spawn', () => {
    if (!worker.pid) { fail(new Error('fine topology child did not expose a PID')); return; }
    lifecycle.startup = onStarted(worker.pid).catch(error => fail(error instanceof Error ? error : new Error(String(error))));
  });
  worker.once('close', (code, _signal) => {
    closed = true;
    closeData = { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), peakRssBytes, rssSamples };
    resolveClose(closeData);
  });
  const abort = () => fail(signal.reason instanceof Error ? signal.reason : new Error('fine topology run aborted'));
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => fail(new Error('fine topology exceeded its 60-second wall cap')),
    Math.max(1, deadlineAt - Date.now()));
  let timerProbing = false;
  const probe = async (): Promise<void> => {
    if (probing || closed || worker.pid === undefined || worker.exitCode !== null || worker.signalCode !== null) return;
    probing = true;
    probePromise = new Promise<void>(resolve => {
      const child = spawn('/bin/ps', ['-o', 'rss=', '-p', String(worker.pid)], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      let size = 0, done = false, failureReason: string | null = null;
      const probeTimeout = setTimeout(() => { failureReason = 'RSS probe timed out'; child.kill('SIGKILL'); }, 1000);
      const finish = (code: number | null): void => {
        if (done) return;
        done = true;
        clearTimeout(probeTimeout);
        const bytes = Buffer.concat(chunks).toString('utf8').trim();
        probing = false;
        if (!closed && worker.exitCode === null && worker.signalCode === null) {
          const rssKb = Number(bytes);
          if (failureReason) fail(new Error(`could not verify fine topology child RSS: ${failureReason}`));
          else if (code !== 0 || !Number.isFinite(rssKb) || rssKb < 1) fail(new Error('could not verify fine topology child RSS'));
          else {
            const measured = rssKb * 1024;
            rssSamples++;
            peakRssBytes = Math.max(peakRssBytes ?? 0, measured);
            onRssSample(peakRssBytes, rssSamples);
            if (measured > MAX_CHILD_RSS_BYTES) fail(new RangeError('fine topology child exceeded 512 MiB RSS'));
          }
        }
        resolve();
      };
      child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 128) chunks.push(chunk); else { failureReason = 'RSS probe output exceeded 128 bytes'; child.kill('SIGKILL'); } });
      child.once('error', () => { failureReason = 'RSS probe could not start'; });
      child.once('close', code => finish(code));
    });
    await probePromise;
  };
  const rssPoll = setInterval(() => {
    if (timerProbing || closed) return;
    timerProbing = true;
    void probe().finally(() => { timerProbing = false; });
  }, 250);
  if (signal.aborted) abort();
  if (Date.now() >= deadlineAt) fail(new Error('fine topology deadline elapsed before child start'));
  worker.stdin.end(payload);
  try {
    await closePromise;
    if (probePromise) await probePromise;
    if (lifecycle.startup) await lifecycle.startup;
    const output = closeData!;
    if (failure) throw failure;
    if (output.code !== 0 && output.code !== 2) throw new Error(`fine topology worker exited with code ${output.code}: ${output.stderr.toString('utf8').slice(0, MAX_ERROR_BYTES)}`);
    if (output.stdout.length < 2 || output.stdout[output.stdout.length - 1] !== 10 || output.stdout.subarray(0, -1).includes(10)) throw new Error('fine topology worker stdout must be one bounded JSON line with a final newline');
    return { ...output, peakRssBytes, rssSamples };
  } finally {
    clearTimeout(timeout); clearInterval(rssPoll); signal.removeEventListener('abort', abort);
    if (!closed) { worker.kill('SIGKILL'); await closePromise; }
    if (probePromise) await probePromise;
    if (lifecycle.startup) await lifecycle.startup.catch(() => {});
  }
}

function sourceKeys(bytes: Uint8Array, pin: FineSourcePin): string[] {
  let document: unknown;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch (error) { throw new TypeError(`cached fine source is invalid UTF-8 or JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const collection = object(document, 'cached fine source');
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) || collection.features.length !== pin.expectedUnits || collection.features.length > 32) throw new Error('cached fine source feature count differs from pin');
  const keys: string[] = [];
  for (const [index, raw] of collection.features.entries()) {
    const feature = object(raw, `fine source feature ${index}`), properties = object(feature.properties, `fine source feature ${index} properties`);
    if (feature.type !== 'Feature' || properties.shapeGroup !== pin.countryIso3 || properties.shapeType !== 'ADM1') throw new Error(`fine source feature ${index} does not match pinned country/admin level`);
    keys.push(text(properties.shapeID, `fine source feature ${index} key`, 256));
  }
  if (new Set(keys).size !== keys.length) throw new Error('cached fine source contains duplicate feature keys');
  return keys.sort(compareCodepoints);
}

async function canonicalRepositoryRoot(value: string): Promise<string> {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) throw new TypeError('repositoryRoot must be canonical and absolute');
  const parsed = path.parse(value); let cursor = parsed.root;
  for (const part of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || (cursor !== value && !info.isDirectory())) throw new Error(`repositoryRoot contains a symlink or non-directory ancestor: ${cursor}`);
  }
  if (!(await lstat(value)).isDirectory()) throw new Error('repositoryRoot must be a directory');
  return value;
}

/** Run the pinned local OGC validator; this records topology evidence without admitting compiler output. */
export async function runFineTopology(options: FineTopologyOptions): Promise<FineTopologyResult> {
  const started = Date.now(), durationMs = options.durationMs ?? MAX_DURATION_MS;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS) throw new RangeError('fine topology duration must be 1..60,000 ms');
  if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('fine topology run aborted');
  const pin = validateFineSourcePin(options.pin);
  const deadlineAt = started + durationMs, deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(new Error('fine topology deadline elapsed')), durationMs);
  deadlineTimer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  let attemptFile: string | null = null;
  let attemptBase: Record<string, unknown> | null = null;
  try {
    const repoRoot = await canonicalRepositoryRoot(options.repositoryRoot);
    const buildRoot = path.join(repoRoot, '.cache', 'world-build');
    const sourcePath = path.resolve(repoRoot, pin.input);
    if (!within(buildRoot, sourcePath) || sourcePath !== path.join(buildRoot, 'fine-source-cache', `${pin.source.sha256}.geojson`)) throw new Error('fine topology source path is outside exact world-build cache');
    const topologyRoot = path.join(buildRoot, 'fine-topology'), attemptsRoot = path.join(topologyRoot, 'attempts'), reportsRoot = path.join(topologyRoot, 'reports');
    await inspectPath(buildRoot); await inspectPath(sourcePath); await inspectPath(topologyRoot);
    const result = await withAcquisitionBuildLock(buildRoot, async () => {
      if (signal.aborted || Date.now() >= deadlineAt) throw signal.reason instanceof Error ? signal.reason : new Error('fine topology deadline elapsed while waiting for shared build lock');
      await checkDisk(buildRoot);
      await ensureDirectory(attemptsRoot, buildRoot);
      const usage = await treeUsage(topologyRoot), attemptUsageNow = await attemptUsage(attemptsRoot);
      const sourceBytes = await readBoundedLocalFile(sourcePath, 8 * 1024 * 1024);
      if (sourceBytes.byteLength !== pin.source.bytes || sha256(sourceBytes) !== pin.source.sha256) throw new Error('fine topology source bytes do not match the immutable pin');
      const expectedKeys = sourceKeys(sourceBytes, pin);
      await validateFixedRuntime();
      if (signal.aborted || Date.now() >= deadlineAt) throw signal.reason instanceof Error ? signal.reason : new Error('fine topology deadline elapsed before worker launch');
      if (attemptUsageNow.entries >= MAX_ATTEMPTS) throw new RangeError('fine topology attempt file cap of 256 reached');
      if (usage.entries + 4 > MAX_TREE_ENTRIES) throw new RangeError('fine topology subtree has no entry headroom for an attempt and report');
      if (usage.bytes + MAX_ATTEMPT_BYTES + 64 * 1024 > MAX_TOPOLOGY_TREE_BYTES) throw new RangeError('fine topology subtree lacks room for a bounded attempt and report');
      const requestHash = sha256(canonical({ validator: VALIDATOR, sourceSha256: pin.source.sha256, sourceBytes: pin.source.bytes,
        expectedUnits: pin.expectedUnits, expectedKeys, spatialSha256: SPATIAL_SHA256 }));
      const attemptId = randomUUID(); attemptFile = path.join(attemptsRoot, `${attemptId}.jsonl`);
      attemptBase = { schemaVersion: 1, attemptId, requestHash, validator: VALIDATOR, sourceSha256: pin.source.sha256,
        sourceBytes: pin.source.bytes, expectedUnits: pin.expectedUnits, startedAt: new Date().toISOString() };
      await syncAppendAttempt(attemptFile, { ...attemptBase, event: 'started', status: 'pending' }, true);
      const request = { schemaVersion: 1, input: sourcePath, sourceSha256: pin.source.sha256,
        sourceBytes: pin.source.bytes, expectedUnits: pin.expectedUnits,
        extensionRoot: path.join(buildRoot, 'tooling', 'extensions', 'v1.5.6', 'osx_arm64') };
      let sampledPeakRssBytes: number | null = null, sampledRssSamples = 0;
      try {
        const output = await runPython(request, signal, deadlineAt, async pid => {
          await syncAppendAttempt(attemptFile!, { ...attemptBase!, event: 'worker-started', status: 'running', pid, workerStartedAt: new Date().toISOString() }, false);
        }, (peak, samples) => { sampledPeakRssBytes = peak; sampledRssSamples = samples; });
        sampledPeakRssBytes = output.peakRssBytes; sampledRssSamples = output.rssSamples;
        const checkDeadline = (): void => {
          if (signal.aborted || Date.now() >= deadlineAt) throw signal.reason instanceof Error ? signal.reason : new Error('fine topology deadline elapsed');
        };
        checkDeadline();
        let parsed: unknown;
        try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output.stdout.subarray(0, -1))) as unknown; }
        catch (error) { throw new Error(`fine topology worker report is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
        const report = validateFineTopologyReport(parsed, pin, expectedKeys);
        const expectedExit = report.invalidUnits || report.unsupportedUnits ? 2 : 0;
        if (output.code !== expectedExit) throw new Error('fine topology worker exit status disagrees with report findings');
        const reportBytes = Buffer.from(`${canonical(report)}\n`);
        if (reportBytes.length > 64 * 1024) throw new RangeError('canonical fine topology report exceeds 64 KiB');
        const reportHash = sha256(reportBytes);
        const afterSource = await treeUsage(topologyRoot);
        if (afterSource.bytes + reportBytes.length + MAX_ATTEMPT_BYTES > MAX_TOPOLOGY_TREE_BYTES) throw new RangeError('fine topology subtree would exceed its 8 MiB cumulative cap');
        await checkDisk(buildRoot);
        checkDeadline();
        const store = await createOutputStore(reportsRoot, buildRoot);
        const reportPath = await store.writeImmutable(`${requestHash}/${reportHash}.json`, reportBytes);
        checkDeadline();
        const elapsedMs = Math.max(1, Date.now() - started);
        checkDeadline();
        await syncAppendAttempt(attemptFile!, { ...attemptBase!, event: 'finished', status: expectedExit === 0 ? 'success' : 'findings',
          endedAt: new Date().toISOString(), elapsedMs, reportHash, reportPath,
          validUnits: report.validUnits, invalidUnits: report.invalidUnits, unsupportedUnits: report.unsupportedUnits,
          peakRssBytes: output.peakRssBytes, rssSamples: output.rssSamples }, false);
        return { requestHash, reportHash, reportPath, report, elapsedMs, networkBytes: 0 as const,
          peakRssBytes: output.peakRssBytes, rssSamples: output.rssSamples };
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_BYTES);
        const status = options.signal?.aborted ? 'aborted' : deadline.signal.aborted ? 'timed-out' : 'failed';
        await syncAppendAttempt(attemptFile!, { ...attemptBase!, event: 'finished', status, endedAt: new Date().toISOString(), error: message,
          peakRssBytes: sampledPeakRssBytes, rssSamples: sampledRssSamples }, false);
        throw error;
      }
    }, { signal, timeoutMs: Math.max(1, deadlineAt - Date.now()) });
    return result;
  } finally {
    clearTimeout(deadlineTimer);
  }
}
