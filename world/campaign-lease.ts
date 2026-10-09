/** Shared-OFD campaign lease bridge. This is a lease primitive, not global admission. */
import { execFile, spawn, type StdioOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCaptureJson } from './capture-json.ts';

const READY_FORMAT = 'world-campaign-lease-ready-v1';
const MAX_HELPER_BYTES = 8192;
const MAX_PYTHON_BYTES = 256 * 1024 * 1024;
const MAX_OUTPUT = 4096;
const MAX_WALL_MS = 5000;
const MAX_RSS_BYTES = 96 * 1024 * 1024;
const ROOT_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const LOCK_FLAGS = constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOFOLLOW;
const HELPER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tooling', 'index_writer_lock.py');
type StdioEntry = Extract<StdioOptions, unknown[]>[number];

export interface CampaignLeaseConfiguration {
  pythonExecutable: string;
  pythonBytes: number;
  pythonSha256: string;
  helperBytes: number;
  helperSha256: string;
}
export interface CampaignLeaseOptions { signal?: AbortSignal; durationMs?: number }
export interface CampaignLeaseIdentity { device: number; inode: number }
export interface CampaignLease {
  readonly root: string;
  readonly rootIdentity: CampaignLeaseIdentity;
  readonly lockIdentity: CampaignLeaseIdentity;
  readonly closed: boolean;
  assertIdentity(): Promise<void>;
  workerStdio(existing?: readonly StdioEntry[]): Promise<StdioOptions>;
  close(): Promise<void>;
}

const LIVE = new WeakSet<object>();
const encoder = new TextEncoder();
const ownRecord = (value: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length) throw new TypeError(`${label} requires exact data fields`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} requires plain data fields`);
  }
  return value as Record<string, unknown>;
};
const nat = (value: unknown, minimum: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${label} must be a bounded integer`);
  return value;
};
const validSha = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} must be lowercase SHA-256`);
  return value;
};
function canonicalReadyJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])));
}
const userId = (): bigint => {
  const value = process.getuid?.();
  if (value === undefined) throw new Error('campaign lease requires a POSIX user identity');
  return BigInt(value);
};
const mode = (value: bigint, expected: number): boolean => (value & 0o7777n) === BigInt(expected);

async function sampleRssBytes(pid: number): Promise<number> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile('/bin/ps', ['-o', 'rss=', '-p', String(pid)], {
      cwd: '/', env: { PATH: '/bin:/usr/bin', LANG: 'C', LC_ALL: 'C' },
      encoding: 'utf8', timeout: 250, maxBuffer: 128, killSignal: 'SIGKILL', windowsHide: true,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  if (output.length > 32 || !/^\s*[0-9]{1,10}\s*$/.test(output)) throw new Error('fixed ps RSS sample is malformed');
  const kib = Number(output.trim());
  if (!Number.isSafeInteger(kib) || kib < 0) throw new Error('fixed ps RSS sample is outside its bound');
  return kib * 1024;
}

async function hashStableFile(filename: string, maximum: number, expectedBytes: number, expectedSha: string,
                              executable: boolean, requireOwner: boolean): Promise<void> {
  const canonical = await realpath(filename);
  if (canonical !== filename) throw new Error('pinned file path must be canonical');
  const before = await lstat(filename, { bigint: true });
  const ownerAllowed = requireOwner ? before.uid === userId() : before.uid === 0n || before.uid === userId();
  if (!before.isFile() || before.isSymbolicLink() || !ownerAllowed || before.nlink !== 1n
      || (before.mode & 0o022n) !== 0n || (executable && (before.mode & 0o111n) === 0n)
      || before.size < 1n || before.size > BigInt(maximum) || before.size !== BigInt(expectedBytes)) {
    throw new Error('pinned file identity, mode, or size is invalid');
  }
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
        || opened.uid !== before.uid || opened.nlink !== before.nlink || opened.mtimeNs !== before.mtimeNs
        || opened.ctimeNs !== before.ctimeNs) throw new Error('pinned file changed while opening');
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < expectedBytes) {
      const length = Math.min(buffer.length, expectedBytes - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (!bytesRead) throw new Error('pinned file ended during verification');
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(filename, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
        || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
        || named.dev !== opened.dev || named.ino !== opened.ino || !named.isFile()
        || digest.digest('hex') !== expectedSha) throw new Error('pinned file changed or failed its SHA-256 pin');
  } finally { await handle.close(); }
}

function configuration(value: CampaignLeaseConfiguration): CampaignLeaseConfiguration {
  const raw = ownRecord(value, ['pythonExecutable', 'pythonBytes', 'pythonSha256', 'helperBytes', 'helperSha256'], 'campaign lease configuration');
  const pythonExecutable = raw.pythonExecutable;
  if (typeof pythonExecutable !== 'string' || !path.isAbsolute(pythonExecutable) || path.resolve(pythonExecutable) !== pythonExecutable
      || /[\u0000-\u001f\u007f]/.test(pythonExecutable) || pythonExecutable.length > 4096) throw new TypeError('Python executable must be a canonical absolute path');
  const pythonBytes = nat(raw.pythonBytes, 1, 'Python executable size');
  if (pythonBytes > MAX_PYTHON_BYTES) throw new RangeError('Python executable exceeds its fixed byte bound');
  const helperBytes = nat(raw.helperBytes, 1, 'lease helper size');
  if (helperBytes > MAX_HELPER_BYTES) throw new RangeError('lease helper exceeds its fixed byte bound');
  return { pythonExecutable, pythonBytes, pythonSha256: validSha(raw.pythonSha256, 'Python executable pin'),
    helperBytes, helperSha256: validSha(raw.helperSha256, 'lease helper pin') };
}

async function checkRoot(root: string): Promise<{ dev: bigint; ino: bigint }> {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root || root.length > 4096
      || /[\u0000-\u001f\u007f]/.test(root)) throw new TypeError('campaign lease root must be a canonical absolute path');
  if (await realpath(root) !== root) throw new Error('campaign lease root is not canonical');
  const info = await lstat(root, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== userId() || !mode(info.mode, 0o700)) {
    throw new Error('campaign lease root must be an owned private 0700 directory');
  }
  return { dev: info.dev, ino: info.ino };
}

class HeldCampaignLease implements CampaignLease {
  readonly root: string;
  readonly rootIdentity: CampaignLeaseIdentity;
  readonly lockIdentity: CampaignLeaseIdentity;
  #file: Awaited<ReturnType<typeof open>>;
  #closed = false;

  constructor(root: string, rootIdentity: CampaignLeaseIdentity, lockIdentity: CampaignLeaseIdentity,
              file: Awaited<ReturnType<typeof open>>) {
    this.root = root;
    this.rootIdentity = Object.freeze({ ...rootIdentity });
    this.lockIdentity = Object.freeze({ ...lockIdentity });
    this.#file = file;
    LIVE.add(this);
    Object.freeze(this);
  }
  get closed(): boolean { return this.#closed; }

  async assertIdentity(): Promise<void> {
    if (!LIVE.has(this) || this.#closed) throw new Error('campaign lease is not live');
    const rootId = await checkRoot(this.root);
    const named = await lstat(path.join(this.root, 'writer.lock'), { bigint: true });
    const held = await this.#file.stat({ bigint: true });
    if (rootId.dev !== BigInt(this.rootIdentity.device) || rootId.ino !== BigInt(this.rootIdentity.inode)
        || !named.isFile() || named.isSymbolicLink() || named.uid !== userId() || named.nlink !== 1n
        || !mode(named.mode, 0o600) || named.size !== 0n || !held.isFile()
        || held.dev !== named.dev || held.ino !== named.ino || held.dev !== BigInt(this.lockIdentity.device)
        || held.ino !== BigInt(this.lockIdentity.inode) || held.uid !== userId() || held.nlink !== 1n
        || !mode(held.mode, 0o600) || held.size !== 0n) throw new Error('campaign lease root or permanent lock identity changed');
  }

  async workerStdio(existing: readonly StdioEntry[] = ['ignore', 'pipe', 'pipe']): Promise<StdioOptions> {
    await this.assertIdentity();
    if (!Array.isArray(existing) || existing.length > 6 || existing.some(item => typeof item === 'number' && item === this.#file.fd)) {
      throw new TypeError('worker stdio must leave dedicated descriptor 6 for the campaign lease');
    }
    const stdio: StdioEntry[] = [...existing];
    while (stdio.length < 6) stdio.push('ignore');
    stdio.push(this.#file.fd);
    return stdio;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (!LIVE.has(this)) throw new TypeError('campaign lease handle is not privately branded');
    await this.assertIdentity();
    await this.#file.close();
    this.#closed = true;
    LIVE.delete(this);
  }
}

function exactReady(bytes: Buffer, config: CampaignLeaseConfiguration,
                    rootIdentity: CampaignLeaseIdentity, lockIdentity: CampaignLeaseIdentity): void {
  if (!bytes.length || bytes.length > MAX_OUTPUT || bytes[bytes.length - 1] !== 0x0a
      || bytes.indexOf(0x0a) !== bytes.length - 1) throw new Error('campaign lease helper did not emit one bounded ready line');
  const line = bytes.subarray(0, -1);
  const value = ownRecord(parseCaptureJson(line, { bytes: MAX_OUTPUT, nodes: 16, depth: 3 }),
    ['format', 'rootDevice', 'rootInode', 'lockDevice', 'lockInode', 'helperSha256'], 'campaign lease ready report');
  if (value.format !== READY_FORMAT || nat(value.rootDevice, 0, 'reported root device') !== rootIdentity.device
      || nat(value.rootInode, 1, 'reported root inode') !== rootIdentity.inode
      || nat(value.lockDevice, 0, 'reported lock device') !== lockIdentity.device
      || nat(value.lockInode, 1, 'reported lock inode') !== lockIdentity.inode
      || validSha(value.helperSha256, 'reported helper hash') !== config.helperSha256
      || Buffer.from(encoder.encode(canonicalReadyJson(value))).compare(line) !== 0) {
    throw new Error('campaign lease helper report differs from the exact pinned inodes or helper');
  }
}

export class CampaignLeaseUnreaped extends Error {
  readonly child: ReturnType<typeof spawn>;
  readonly processGroup: number;
  readonly lease: CampaignLease;
  constructor(child: ReturnType<typeof spawn>, lease: CampaignLease, cause: unknown) {
    const message = cause instanceof Error ? cause.message.slice(0, 512) : 'campaign lease helper could not be reaped';
    super(`campaign lease helper is not confirmed terminal; retain its child handle and lease descriptor: ${message}`);
    this.name = 'CampaignLeaseUnreaped';
    this.child = child;
    this.processGroup = child.pid ?? -1;
    this.lease = lease;
  }
}

export class CampaignLeaseRetained extends Error {
  readonly lease: CampaignLease;
  constructor(lease: CampaignLease, cause: unknown) {
    const detail = cause instanceof Error ? cause.message.slice(0, 512) : 'campaign lock identity could not be safely released';
    super(`campaign lease descriptor remains open after an identity failure; retain this lease handle: ${detail}`);
    this.name = 'CampaignLeaseRetained';
    this.lease = lease;
  }
}

/** Acquire the permanent campaign flock through one inherited shared OFD. */
export async function openCampaignLease(rootValue: string, configValue: CampaignLeaseConfiguration,
                                        options: CampaignLeaseOptions = {}): Promise<CampaignLease> {
  const config = configuration(configValue);
  const durationMs = options.durationMs ?? MAX_WALL_MS;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > MAX_WALL_MS) throw new RangeError('campaign lease helper wall limit must be 1..5000 ms');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('campaign lease signal must be an AbortSignal');
  if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('campaign lease aborted before open');

  const root = rootValue;
  const rootBefore = await checkRoot(root);
  const rootIdentity = { device: nat(Number(rootBefore.dev), 0, 'root device'), inode: nat(Number(rootBefore.ino), 1, 'root inode') };
  if (BigInt(rootIdentity.device) !== rootBefore.dev || BigInt(rootIdentity.inode) !== rootBefore.ino) throw new Error('campaign root inode cannot be represented safely');
  const helperInfo = await lstat(HELPER_PATH, { bigint: true });
  if (!helperInfo.isFile() || helperInfo.isSymbolicLink() || helperInfo.size !== BigInt(config.helperBytes)) throw new Error('pinned lease helper path or size is invalid');
  await hashStableFile(HELPER_PATH, MAX_HELPER_BYTES, config.helperBytes, config.helperSha256, false, true);
  await hashStableFile(config.pythonExecutable, MAX_PYTHON_BYTES, config.pythonBytes, config.pythonSha256, true, false);
  const helperPath = await realpath(HELPER_PATH);
  if (helperPath !== HELPER_PATH) throw new Error('lease helper path is not canonical');
  if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('campaign lease aborted during pin verification');
  const directory = await open(root, ROOT_FLAGS);
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let lease: HeldCampaignLease | undefined;
  let terminal = true;
  try {
    const openedRoot = await directory.stat({ bigint: true });
    if (openedRoot.dev !== rootBefore.dev || openedRoot.ino !== rootBefore.ino || !openedRoot.isDirectory()
        || openedRoot.uid !== userId() || !mode(openedRoot.mode, 0o700)) throw new Error('campaign lease root changed while opening');
    const lockPath = path.join(root, 'writer.lock');
    try {
      lock = await open(lockPath, LOCK_FLAGS | constants.O_CREAT | constants.O_EXCL, 0o600);
      await lock.sync();
      await directory.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      lock = await open(lockPath, LOCK_FLAGS);
    }
    if (!lock) throw new Error('campaign writer.lock could not be opened');
    const lockInfo = await lock.stat({ bigint: true });
    const namedLock = await lstat(lockPath, { bigint: true });
    if (!lockInfo.isFile() || lockInfo.uid !== userId() || lockInfo.nlink !== 1n || !mode(lockInfo.mode, 0o600)
        || lockInfo.size !== 0n || !namedLock.isFile() || namedLock.isSymbolicLink()
        || namedLock.dev !== lockInfo.dev || namedLock.ino !== lockInfo.ino || namedLock.uid !== userId()
        || namedLock.nlink !== 1n || !mode(namedLock.mode, 0o600) || namedLock.size !== 0n) {
      throw new Error('campaign writer.lock must be an owned empty 0600 single-link regular file');
    }
    const lockIdentity = { device: nat(Number(lockInfo.dev), 0, 'lock device'), inode: nat(Number(lockInfo.ino), 1, 'lock inode') };
    if (BigInt(lockIdentity.device) !== lockInfo.dev || BigInt(lockIdentity.inode) !== lockInfo.ino) throw new Error('campaign lock inode cannot be represented safely');
    const heldLease = new HeldCampaignLease(root, rootIdentity, lockIdentity, lock);
    lease = heldLease;
    lock = undefined;
    await heldLease.assertIdentity();
    if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('campaign lease aborted before helper launch');
    const childStdio = await heldLease.workerStdio(['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore']);
    const helperChild = spawn(config.pythonExecutable, ['-I', '-B', helperPath, '--campaign-inherited-lease', root,
      String(rootIdentity.device), String(rootIdentity.inode), String(lockIdentity.device), String(lockIdentity.inode)], {
      cwd: root, shell: false, detached: true, windowsHide: true, stdio: childStdio,
      env: { PATH: path.dirname(config.pythonExecutable), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
    });
    terminal = false;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let stdoutBytes = 0, stderrBytes = 0, spawnFailure: Error | undefined, protocolFailure: Error | undefined;
    let resolveClose!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { resolveClose = resolve; });
    let rejectFailure!: (error: Error) => void;
    const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
    const failProtocol = (error: Error): void => {
      if (protocolFailure) return;
      protocolFailure = error;
      rejectFailure(error);
    };
    helperChild.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT) failProtocol(new Error('campaign lease helper stdout exceeded 4096 bytes'));
      else stdout.push(Buffer.from(chunk));
    });
    helperChild.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_OUTPUT) failProtocol(new Error('campaign lease helper stderr exceeded 4096 bytes'));
      else stderr.push(Buffer.from(chunk));
    });
    helperChild.once('error', error => { spawnFailure = error; failProtocol(error); });
    helperChild.once('close', (code, signal) => { terminal = true; resolveClose({ code, signal }); });
    if (!helperChild.pid) failProtocol(new Error('campaign lease helper has no owned process ID'));
    let monitorEnabled = true;
    const monitor = (async () => {
      while (monitorEnabled && !terminal) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!monitorEnabled || terminal) return;
        let rss: number;
        try { rss = await sampleRssBytes(helperChild.pid!); }
        catch (error) { if (terminal) return; throw error; }
        if (!terminal && rss > MAX_RSS_BYTES) throw new Error('campaign lease helper sampled RSS exceeded 96 MiB');
      }
    })();
    void monitor.catch(error => { if (!terminal) failProtocol(error instanceof Error ? error : new Error('campaign lease RSS sample failed')); });

    let timer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    const rejected = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('campaign lease helper exceeded its wall limit')), durationMs);
      if (options.signal) {
        abortListener = () => reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error('campaign lease aborted'));
        options.signal.addEventListener('abort', abortListener, { once: true });
        if (options.signal.aborted) abortListener();
      }
    });
    let result: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    try {
      result = await Promise.race([closed, rejected, failure]);
      if (protocolFailure) throw protocolFailure;
      if (spawnFailure) throw spawnFailure;
      if (result.code !== 0 || result.signal !== null) {
        const detail = Buffer.concat(stderr).toString('utf8').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512);
        throw new Error(`campaign lease helper exited without success${detail ? `: ${detail}` : ''}`);
      }
      await monitor;
      const stdoutBytesRaw = Buffer.concat(stdout);
      exactReady(stdoutBytesRaw, config, rootIdentity, lockIdentity);
      await hashStableFile(HELPER_PATH, MAX_HELPER_BYTES, config.helperBytes, config.helperSha256, false, true);
      await hashStableFile(config.pythonExecutable, MAX_PYTHON_BYTES, config.pythonBytes, config.pythonSha256, true, false);
      await heldLease.assertIdentity();
    } catch (error) {
      monitorEnabled = false;
      if (!terminal) {
        const processGroup = helperChild.pid;
        let signalFailure: unknown;
        if (processGroup) {
          try { process.kill(-processGroup, 'SIGTERM'); }
          catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') signalFailure = failure; }
        }
        const grace = await Promise.race([closed.then(value => ({ closed: value })), new Promise<null>(resolve => setTimeout(() => resolve(null), 250))]);
        if (!grace && processGroup) {
          try { process.kill(-processGroup, 'SIGKILL'); }
          catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') signalFailure ??= failure; }
        }
        const reaped = grace ?? await Promise.race([closed.then(value => ({ closed: value })), new Promise<null>(resolve => setTimeout(() => resolve(null), 500))]);
        if (!reaped) {
          await monitor.catch(() => undefined);
          throw new CampaignLeaseUnreaped(helperChild, heldLease, signalFailure ?? error);
        }
        terminal = true;
      }
      await monitor.catch(() => undefined);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
    }
    if (!terminal) throw new CampaignLeaseUnreaped(helperChild, heldLease, new Error('campaign helper terminal state is unknown'));
    return heldLease;
  } catch (error) {
    if (lease && !(error instanceof CampaignLeaseUnreaped)) {
      try { await lease.close(); }
      catch (closeError) { throw new CampaignLeaseRetained(lease, closeError); }
    } else if (lock) {
      await lock.close().catch(() => undefined);
    }
    throw error;
  } finally {
    await directory.close().catch(() => undefined);
  }
}

/** Verify a genuine live lease before placing its original OFD at child fd 6. */
export async function campaignLeaseWorkerStdio(lease: CampaignLease,
                                                existing: readonly StdioEntry[] = ['ignore', 'pipe', 'pipe']): Promise<StdioOptions> {
  if (!lease || typeof lease !== 'object' || !LIVE.has(lease)) throw new TypeError('worker inheritance requires the actual campaign lease handle');
  return lease.workerStdio(existing);
}
