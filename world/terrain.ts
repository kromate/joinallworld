import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withAcquisitionBuildLock } from './acquire.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_WORKER = path.join(HERE, 'tooling', 'terrain.py');
const HARD = Object.freeze({ durationMs: 60_000, memoryBytes: 384 * 1024 * 1024, artifactBytes: 5_000_000 });
const SHA = /^[a-f0-9]{64}$/;

export interface TerrainAcquisitionResult {
  sourcePath: string;
  sidecarPath: string;
  sha256: string;
  bytes: number;
  cacheHit: boolean;
  networkBytes: number;
  raster?: Record<string, unknown>;
}

export interface TerrainAcquisitionOptions {
  buildRoot: string;
  pythonExecutable: string;
}

function assertAbsolutePath(value: string, label: string): string {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new TypeError(`${label} must be an absolute path`);
  return path.resolve(value);
}

async function noSymlinkAncestors(value: string): Promise<string> {
  const absolute = assertAbsolutePath(value, 'buildRoot');
  const parts = absolute.split(path.sep).filter(Boolean);
  let current = path.parse(absolute).root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('terrain build root ancestor must be a real directory without symlinks');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Do not create the output root here. The worker checks each ancestor before creation.
      break;
    }
  }
  return absolute;
}

function parseResult(text: string): TerrainAcquisitionResult {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('terrain worker returned malformed JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('terrain worker result must be an object');
  const row = value as Record<string, unknown>;
  for (const key of ['sourcePath', 'sidecarPath']) if (typeof row[key] !== 'string' || !path.isAbsolute(row[key] as string)) throw new Error(`terrain worker ${key} must be absolute`);
  if (typeof row.sha256 !== 'string' || !SHA.test(row.sha256)) throw new Error('terrain worker sha256 is invalid');
  for (const key of ['bytes', 'networkBytes']) if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0 || (row[key] as number) > HARD.artifactBytes) throw new Error(`terrain worker ${key} exceeds the pilot cap`);
  if (row.bytes !== 3_511_272 || typeof row.cacheHit !== 'boolean') throw new Error('terrain worker source length/cache status differs from the pinned source contract');
  return row as unknown as TerrainAcquisitionResult;
}

async function rssBytes(pid: number): Promise<number> {
  const output: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', part => output.push(String(part)));
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error('could not read terrain worker RSS')));
  });
  const kb = Number(output.join('').trim());
  if (!Number.isFinite(kb) || kb < 0) throw new Error('terrain worker RSS is unavailable');
  return kb * 1024;
}

async function runUnlocked(root: string, python: string, totalStarted: number): Promise<TerrainAcquisitionResult> {
  const expectedWorker = path.resolve(PYTHON_WORKER);
  const workerInfo = await lstat(expectedWorker);
  if (!workerInfo.isFile() || workerInfo.isSymbolicLink() || await realpath(expectedWorker) !== expectedWorker) throw new Error('terrain worker path is unsafe');
  const child = spawn(python, ['-I', expectedWorker, '--root', root], { cwd: path.dirname(HERE), stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: path.dirname(python), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  let stdout = '';
  let stderr = '';
  let childDidClose = false;
  let resolveChildClosed!: () => void;
  const childClosed = new Promise<void>(resolve => { resolveChildClosed = resolve; });
  child.once('close', () => { childDidClose = true; resolveChildClosed(); });
  let timer: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  let closePromise: Promise<void> | undefined;
  const close = (signal: NodeJS.Signals = 'SIGTERM'): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (!childDidClose) {
        child.kill(signal);
        const escalation = setTimeout(() => { if (!childDidClose) child.kill('SIGKILL'); }, 2_000);
        try { await childClosed; } finally { clearTimeout(escalation); }
      }
    })();
    return closePromise;
  };
  try {
    const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', part => {
        stdout += String(part);
        if (Buffer.byteLength(stdout) > 1_000_000) { reject(new Error('terrain worker stdout exceeded 1 MB')); void close('SIGKILL'); }
      });
      child.stderr.on('data', part => {
        stderr += String(part);
        if (Buffer.byteLength(stderr) > 16_000) stderr = stderr.slice(-16_000);
      });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
      const remainingMs = Math.max(0, HARD.durationMs - (Date.now() - totalStarted));
      if (remainingMs === 0) { void close(); reject(new Error('terrain acquisition deadline elapsed while waiting for shared build lock')); return; }
      timer = setTimeout(() => { void close(); reject(new Error('terrain acquisition exceeded 60-second wall cap; inspect terrain/attempts/attempts.jsonl')); }, remainingMs);
      poll = setInterval(async () => {
        if (childDidClose || child.exitCode !== null || child.signalCode !== null) return;
        try {
          if (await rssBytes(child.pid!) > HARD.memoryBytes) {
            reject(new Error('terrain worker exceeded 384 MiB RSS cap; inspect terrain/attempts/attempts.jsonl'));
            void close('SIGKILL');
          }
        } catch (error) {
          if (childDidClose || child.exitCode !== null || child.signalCode !== null) return;
          reject(error);
          void close('SIGKILL');
        }
      }, 100);
    });
    if (outcome.code !== 0) throw new Error(`terrain worker failed (${outcome.signal ?? outcome.code}): ${stderr.trim() || 'inspect terrain/attempts/attempts.jsonl'}`);
    const result = parseResult(stdout.trim());
    const terrainRoot = path.join(root, 'terrain');
    for (const p of [result.sourcePath, result.sidecarPath]) {
      const relative = path.relative(terrainRoot, p);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('terrain worker returned a path outside the canonical terrain cache');
      const info = await lstat(p);
      if (!info.isFile() || info.isSymbolicLink() || info.size > HARD.artifactBytes || await realpath(p) !== p) throw new Error('terrain worker published unsafe or oversized artifact');
    }
    if ((await lstat(result.sourcePath)).size !== result.bytes || (await lstat(result.sidecarPath)).size > 1_000_000) throw new Error('terrain worker artifact size differs from its bounded receipt');
    if (Date.now() - totalStarted > HARD.durationMs) throw new Error('terrain acquisition exceeded its wall cap');
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
    if (!childDidClose) await close();
  }
}

export async function acquireAccraTerrain(options: TerrainAcquisitionOptions): Promise<TerrainAcquisitionResult> {
  const root = await noSymlinkAncestors(options.buildRoot);
  const python = assertAbsolutePath(options.pythonExecutable, 'pythonExecutable');
  if (!/(^|\/)python3(?:\.12)?$/.test(python)) throw new TypeError('pythonExecutable must name Python 3');
  const started = Date.now();
  return withAcquisitionBuildLock(root, async () => {
    if (Date.now() - started >= HARD.durationMs) throw new Error('terrain acquisition deadline elapsed while waiting for shared build lock');
    return runUnlocked(root, python, started);
  }, { timeoutMs: HARD.durationMs });
}
