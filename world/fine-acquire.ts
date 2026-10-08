import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, link, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { FINE_LIMITS, type FineSourcePin } from './fine-types.ts';
import { validateFineSourcePin } from './fine.ts';

const LIMITS = Object.freeze({ durationMs: 120_000, freeBytes: 100 * 1024 * 1024, networkBytes: FINE_LIMITS.sourceBytes, aggregateNetworkBytes: 64 * 1024 * 1024,
  cacheBytes: 40 * 1024 * 1024, auditBytes: 2 * 1024 * 1024, auditEntries: 512, auditRecordBytes: 8 * 1024,
  auditReserveBytes: 16 * 1024, scanEntries: 4_096, scanDepth: 8 });
const SHA256 = /^[a-f0-9]{64}$/;
const CACHE_RELATIVE = '.cache/world-build/fine-source-cache';

export interface FineSourceAcquisitionOptions {
  repositoryRoot: string;
  signal?: AbortSignal;
  durationMs?: number;
  /** Verify retained bytes and receipt without reserving or starting a network attempt. */
  cacheOnly?: boolean;
  /** Test seam only: the exact pin URL and strict fetch options remain controlled by this module. */
  fetcher?: typeof fetch;
}
export interface FineSourceAcquisitionResult {
  inputPath: string;
  networkBytes: number;
  sourceBytes: number;
  cacheHit: boolean;
  receiptPath: string;
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('pin contains non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new TypeError('source pin is not JSON data');
}
function errorText(error: unknown): string { return error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000); }
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
async function inspectPath(targetValue: string): Promise<void> {
  const target = path.resolve(targetValue), root = path.parse(target).root;
  let cursor = root;
  const parts = target.slice(root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]!);
    let info;
    try { info = await lstat(cursor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new Error(`fine source path contains a symlink or non-directory ancestor: ${cursor}`);
  }
}
async function ensureDirectory(directory: string, root: string): Promise<void> {
  if (!inside(root, directory)) throw new Error('fine source cache path escapes repository root');
  const filesystemRoot = path.parse(directory).root;
  let cursor = filesystemRoot;
  for (const part of directory.slice(filesystemRoot.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`fine source cache directory is unsafe: ${cursor}`);
  }
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function boundedTreeBytes(directory: string, limit: number): Promise<number> {
  let entryCount = 0;
  const walk = async (current: string, depth: number): Promise<number> => {
    if (depth > LIMITS.scanDepth) throw new RangeError('fine source cache exceeds depth-8 traversal cap');
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`fine source cache contains unsafe path: ${current}`);
    let total = 0;
    const handle = await opendir(current);
    for await (const entry of handle) {
      if (++entryCount > LIMITS.scanEntries) throw new RangeError('fine source cache exceeds 4,096-entry traversal cap');
      const childPath = path.join(current, entry.name), child = await lstat(childPath);
      if (child.isSymbolicLink()) throw new Error(`fine source cache contains symlink: ${childPath}`);
      if (child.isDirectory()) total += await walk(childPath, depth + 1);
      else if (child.isFile()) total += child.size;
      else throw new Error(`fine source cache contains non-regular entry: ${childPath}`);
      if (total > limit) throw new RangeError('fine source cache already exceeds its 40 MiB cap');
    }
    return total;
  };
  try { await lstat(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  return walk(directory, 0);
}
type AuditRecord = Record<string, unknown> & { attemptId: string; event: 'started' | 'finished'; sourceSha256: string };
async function auditState(directory: string): Promise<{ entries: AuditRecord[]; bytes: number; networkBySource: Map<string, number>; aggregateNetworkBytes: number }> {
  const filename = path.join(directory, 'attempts.jsonl');
  let previous: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  try { previous = await readBoundedLocalFile(filename, LIMITS.auditBytes); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(previous); }
  catch { throw new Error('fine source attempt audit is malformed UTF-8'); }
  if (text && !text.endsWith('\n')) throw new Error('fine source attempt audit has an incomplete trailing record');
  const lines = text ? text.slice(0, -1).split('\n') : [];
  if (lines.some(line => !line || Buffer.byteLength(line) > LIMITS.auditRecordBytes)) throw new Error('fine source attempt audit contains an empty or oversized record');
  let entries: AuditRecord[];
  try { entries = lines.map(line => JSON.parse(line) as AuditRecord); }
  catch { throw new Error('fine source attempt audit contains malformed JSON'); }
  const starts = new Map<string, AuditRecord>(), finished = new Set<string>(), networkBySource = new Map<string, number>();
  for (const record of entries) {
    if (!record || typeof record !== 'object' || record.schemaVersion !== 1 || !['started', 'finished'].includes(String(record.event))
      || typeof record.attemptId !== 'string' || !SHA256.test(record.sourceSha256)) throw new Error('fine source attempt audit contains an invalid record');
      if (record.event === 'started') {
        if (starts.has(record.attemptId) || !Number.isSafeInteger(record.networkReservationUpperBoundBytes)
        || (record.networkReservationUpperBoundBytes as number) < 1 || (record.networkReservationUpperBoundBytes as number) > LIMITS.networkBytes) throw new Error('fine source attempt audit contains an invalid start reservation');
      starts.set(record.attemptId, record);
    } else {
      const start = starts.get(record.attemptId);
      if (!start || finished.has(record.attemptId) || start.sourceSha256 !== record.sourceSha256
        || typeof record.responseComplete !== 'boolean' || !Number.isSafeInteger(record.networkReservationUpperBoundBytes)
        || (record.networkReservationUpperBoundBytes as number) < 0
        || !(record.networkBytesMeasured === null || (Number.isSafeInteger(record.networkBytesMeasured) && (record.networkBytesMeasured as number) >= 0))) {
        throw new Error('fine source attempt audit contains an invalid terminal record');
      }
      if ((!record.responseComplete && record.networkReservationUpperBoundBytes !== start.networkReservationUpperBoundBytes)
        || (record.responseComplete && (record.networkBytesMeasured === null || record.networkReservationUpperBoundBytes !== record.networkBytesMeasured))) {
        throw new Error('fine source attempt audit released an unmeasured reservation');
      }
      finished.add(record.attemptId);
    }
  }
  for (const [attemptId, start] of starts) {
    const terminal = entries.find(record => record.attemptId === attemptId && record.event === 'finished');
    const reservation = terminal ? Math.max(terminal.networkReservationUpperBoundBytes as number,
      typeof terminal.networkBytesMeasured === 'number' ? terminal.networkBytesMeasured : 0)
      : start.networkReservationUpperBoundBytes as number;
    networkBySource.set(start.sourceSha256, (networkBySource.get(start.sourceSha256) ?? 0) + reservation);
  }
  const aggregateNetworkBytes = [...networkBySource.values()].reduce((sum, bytes) => {
    const total = sum + bytes;
    if (!Number.isSafeInteger(total)) throw new RangeError('fine source aggregate network audit exceeds safe integer range');
    return total;
  }, 0);
  return { entries, bytes: previous.length, networkBySource, aggregateNetworkBytes };
}
async function appendAudit(directory: string, record: Record<string, unknown>): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
  if (bytes.byteLength > LIMITS.auditRecordBytes) throw new RangeError('fine source audit record exceeds 8 KiB');
  const filename = path.join(directory, 'attempts.jsonl');
  await inspectPath(filename);
  const state = await auditState(directory);
  if (state.entries.length >= LIMITS.auditEntries || state.bytes + bytes.length > LIMITS.auditBytes) {
    throw new RangeError('fine source attempt audit exceeds its 512-entry / 2 MiB cap');
  }
  const handle = await open(filename, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(directory);
}
async function writeReceiptLast(receiptPath: string, receipt: Record<string, unknown>): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`), temporary = `${receiptPath}.${randomUUID()}.tmp`;
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    await inspectPath(receiptPath);
    await linkExclusive(temporary, receiptPath);
    await syncDirectory(path.dirname(receiptPath));
  } finally { await unlink(temporary).catch(() => {}); }
}
async function linkExclusive(source: string, target: string): Promise<void> {
  await link(source, target);
}
function withAbort<T>(pending: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => { onAbort?.(); reject(signal.reason ?? new Error('fine source acquisition aborted')); };
    if (signal.aborted) { handleAbort(); return; }
    signal.addEventListener('abort', handleAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', handleAbort));
  });
}
async function readExistingReceipt(filename: string, expected: Record<string, unknown>): Promise<void> {
  const bytes = await readBoundedLocalFile(filename, 16 * 1024);
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('fine source receipt is corrupt and was retained'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('fine source receipt is corrupt and was retained');
  const receipt = value as Record<string, unknown>;
  for (const [key, field] of Object.entries(expected)) if (canonical(receipt[key]) !== canonical(field)) throw new Error('fine source receipt pin mismatch; retained for review');
  if (receipt.schemaVersion !== 1 || typeof receipt.completedAt !== 'string' || !Number.isFinite(Date.parse(receipt.completedAt))) throw new Error('fine source receipt is corrupt and was retained');
  const evidence = receipt.evidence;
  const allowed = evidence === 'verified-existing-content-addressed-cache'
    ? ['schemaVersion', 'pinHash', 'sourceUrl', 'sha256', 'bytes', 'observedHttpStatus', 'upstreamBytes', 'completedAt', 'evidence']
    : evidence === 'exact-pinned-response-hash-verified'
      ? ['schemaVersion', 'pinHash', 'sourceUrl', 'sha256', 'bytes', 'observedHttpStatus', 'upstreamBytes', 'startedAt', 'completedAt', 'evidence'] : [];
  if (!allowed.length || Object.keys(receipt).length !== allowed.length || Object.keys(receipt).some(key => !allowed.includes(key))
    || !(receipt.observedHttpStatus === null || (Number.isSafeInteger(receipt.observedHttpStatus) && (receipt.observedHttpStatus as number) >= 200 && (receipt.observedHttpStatus as number) <= 599))
    || !Number.isSafeInteger(receipt.upstreamBytes) || (receipt.upstreamBytes as number) < 0 || (receipt.upstreamBytes as number) > LIMITS.networkBytes
    || (evidence === 'exact-pinned-response-hash-verified' && (receipt.observedHttpStatus !== 200 || receipt.upstreamBytes !== receipt.bytes
      || typeof receipt.startedAt !== 'string' || !Number.isFinite(Date.parse(receipt.startedAt))))
    || (evidence === 'verified-existing-content-addressed-cache' && (receipt.observedHttpStatus !== null || receipt.upstreamBytes !== 0))) {
    throw new Error('fine source receipt schema or upstream evidence is corrupt and was retained');
  }
}
async function verifyCachedSource(inputPath: string, receiptPath: string, pin: FineSourcePin, pinHash: string): Promise<FineSourceAcquisitionResult | null> {
  let bytes: Buffer;
  try { bytes = await readBoundedLocalFile(inputPath, FINE_LIMITS.sourceBytes); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error(`fine source cache is corrupt or unsafe and was retained: ${errorText(error)}`); }
  const actualHash = sha256(bytes);
  if (bytes.byteLength !== pin.source.bytes || actualHash !== pin.source.sha256) throw new Error('fine source cache hash/byte mismatch; corrupt content retained for review');
  const expected = { schemaVersion: 1, pinHash, sourceUrl: pin.source.url, sha256: actualHash, bytes: bytes.byteLength };
  try { await readExistingReceipt(receiptPath, expected); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeReceiptLast(receiptPath, { ...expected, observedHttpStatus: null, upstreamBytes: 0, completedAt: new Date().toISOString(), evidence: 'verified-existing-content-addressed-cache' });
  }
  return { inputPath, networkBytes: 0, sourceBytes: bytes.byteLength, cacheHit: true, receiptPath };
}

async function consumeBody(response: Response, filePath: string, signal: AbortSignal, allowance: number, onBytes: (bytes: number) => void): Promise<{ networkBytes: number; hash: string; status: number }> {
  if (!response.body) throw new Error('pinned source response has no body');
  const output = await open(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  const digest = createHash('sha256');
  let networkBytes = 0, reachedEof = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const activeReader = response.body.getReader();
    reader = activeReader;
    try {
      for (;;) {
        if (signal.aborted) throw signal.reason ?? new Error('fine source acquisition aborted');
        const next = activeReader.read();
        const item = await withAbort(next, signal, () => { void activeReader.cancel().catch(() => {}); });
        const { done, value } = item;
        if (done) { reachedEof = true; break; }
        networkBytes += value.byteLength;
        onBytes(networkBytes);
        const accepted = Math.min(value.byteLength, Math.max(0, allowance - (networkBytes - value.byteLength)));
        const bounded = value.subarray(0, accepted);
        digest.update(bounded);
        let offset = 0;
        while (offset < bounded.byteLength) {
          const result = await output.write(bounded, offset, bounded.byteLength - offset);
          if (!result.bytesWritten) throw new Error('fine source temporary file write made no progress');
          offset += result.bytesWritten;
        }
        if (accepted < value.byteLength) {
          await activeReader.cancel().catch(() => {});
          throw new RangeError(`fine source response exceeds its ${allowance}-byte remaining per-source network budget`);
        }
      }
    } finally {
      if (!reachedEof) await activeReader.cancel().catch(() => {});
      activeReader.releaseLock(); reader = null;
    }
    await output.sync();
    return { networkBytes, hash: digest.digest('hex'), status: response.status };
  } finally { await output.close(); }
}
async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body && !response.body.locked) await response.body.cancel().catch(() => {});
}

/** Acquire only the exact URL and byte identity already approved by a FineSourcePin. */
export async function acquireFineSource(pinValue: FineSourcePin, options: FineSourceAcquisitionOptions): Promise<FineSourceAcquisitionResult> {
  const startedMs = Date.now(), durationMs = options.durationMs ?? LIMITS.durationMs;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > LIMITS.durationMs) throw new RangeError('fine source duration must be between 1 and 120,000 ms');
  const pin = validateFineSourcePin(pinValue), rootValue = options.repositoryRoot;
  if (!path.isAbsolute(rootValue) || !rootValue || /[\0\r\n]/.test(rootValue)) throw new TypeError('repositoryRoot must be an absolute path');
  const repositoryRoot = path.resolve(rootValue);
  await inspectPath(repositoryRoot);
  const rootInfo = await lstat(repositoryRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('repositoryRoot must be an existing real directory');
  const cacheRoot = path.join(repositoryRoot, '.cache', 'world-build');
  const cacheDirectory = path.join(repositoryRoot, CACHE_RELATIVE);
  const inputPath = path.join(cacheDirectory, `${pin.source.sha256}.geojson`);
  const receiptPath = path.join(cacheDirectory, `${pin.source.sha256}.receipt.json`);
  const attemptsDirectory = path.join(cacheDirectory, 'attempts');
  const pinHash = sha256(Buffer.from(canonical(pin)));
  const deadline = startedMs + durationMs;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(new Error('fine source acquisition reached its wall deadline')), durationMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadlineController.signal]) : deadlineController.signal;
  let result: FineSourceAcquisitionResult | undefined;
  try {
    result = await withAcquisitionBuildLock(cacheRoot, async () => {
      if (signal.aborted || Date.now() >= deadline) throw signal.reason ?? new Error('fine source acquisition timed out before lock admission');
      await inspectPath(cacheRoot);
      await ensureDirectory(cacheDirectory, repositoryRoot);
      await ensureDirectory(attemptsDirectory, repositoryRoot);
      const current = await boundedTreeBytes(cacheDirectory, LIMITS.cacheBytes);
      if (current > LIMITS.cacheBytes) throw new RangeError('fine source cache already exceeds its 40 MiB cap');
      let receiptExists = true;
      try { await lstat(receiptPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') receiptExists = false; else throw error; }
      let inputExists = true;
      try { await lstat(inputPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') inputExists = false; else throw error; }
      if (!inputExists && receiptExists) throw new Error('fine source receipt exists without its immutable source; retained for review');
      if (inputExists && !receiptExists) {
        const diskForReceipt = await statfs(cacheRoot);
        if (current + 16 * 1024 > LIMITS.cacheBytes || diskForReceipt.bavail * diskForReceipt.bsize < LIMITS.freeBytes + 16 * 1024) {
          throw new RangeError('verified cache receipt is missing and there is insufficient 16 KiB cache/free-space headroom to restore it');
        }
      }
      const cached = await verifyCachedSource(inputPath, receiptPath, pin, pinHash);
      if (cached) {
        if (signal.aborted || Date.now() >= deadline) throw signal.reason ?? new Error('fine source cache verification exceeded its wall deadline');
        return cached;
      }
      if (options.cacheOnly) throw new Error('fine source verification is cache-only; reviewed pinned source is not cached');
      const audit = await auditState(attemptsDirectory);
      if (audit.entries.length + 2 > LIMITS.auditEntries || audit.bytes + LIMITS.auditReserveBytes > LIMITS.auditBytes) throw new RangeError('fine source attempt audit exceeds its 512-entry / 2 MiB cap');
      const previouslyCharged = audit.networkBySource.get(pin.source.sha256) ?? 0;
      const perSourceRemaining = LIMITS.networkBytes - previouslyCharged;
      if (perSourceRemaining <= 0) throw new RangeError('fine source cumulative 8 MiB network budget for this source SHA-256 is exhausted');
      const aggregateRemaining = LIMITS.aggregateNetworkBytes - audit.aggregateNetworkBytes;
      if (aggregateRemaining <= 0) throw new RangeError('fine source aggregate 64 MiB lifetime geometry-network budget is exhausted');
      const allowance = Math.min(perSourceRemaining, aggregateRemaining);
      const disk = await statfs(cacheRoot);
      if (disk.bavail * disk.bsize < LIMITS.freeBytes + allowance) throw new RangeError('fine source acquisition requires 100 MiB free reserve plus the bounded response allowance');
      if (current + allowance + LIMITS.auditReserveBytes > LIMITS.cacheBytes) throw new RangeError('fine source cache lacks room for the bounded response and audit reserve within its 40 MiB cap');

      const attemptId = randomUUID(), tempPath = path.join(cacheDirectory, `.${pin.source.sha256}.${attemptId}.partial`);
      const startRecord = { schemaVersion: 1, attemptId, event: 'started', status: 'pending', startedAt: new Date().toISOString(), pinHash,
        sourceUrl: pin.source.url, expectedSha256: pin.source.sha256, expectedBytes: pin.source.bytes,
        sourceSha256: pin.source.sha256, networkReservationUpperBoundBytes: allowance, networkBytesMeasured: null };
      await appendAudit(attemptsDirectory, startRecord);
      let networkBytes: number | null = null, responseComplete = false, observedStatus: number | null = null, finishedStatus = 'failure', failure: string | null = null;
      try {
        if (signal.aborted) throw signal.reason ?? new Error('fine source acquisition aborted');
        const response = await withAbort(Promise.resolve((options.fetcher ?? fetch)(pin.source.url, {
          method: 'GET', redirect: 'manual', signal,
          headers: { 'accept-encoding': 'identity', accept: 'application/geo+json, application/json;q=0.9, */*;q=0.1' },
        })), signal);
        observedStatus = response.status;
        const encoding = response.headers.get('content-encoding');
        if (encoding && encoding.toLowerCase() !== 'identity') {
          await cancelResponseBody(response);
          throw new Error('pinned source response ignored the identity-encoding request');
        }
        if (response.status >= 300 && response.status < 400) {
          if (response.body) {
            const measured = await consumeBody(response, tempPath, signal, allowance, count => { networkBytes = count; });
            networkBytes = measured.networkBytes;
            responseComplete = true;
          } else { networkBytes = 0; responseComplete = true; }
          throw new Error(`pinned source returned redirect status ${response.status}; redirects are disabled`);
        }
        const measured = await consumeBody(response, tempPath, signal, allowance, count => { networkBytes = count; });
        networkBytes = measured.networkBytes;
        responseComplete = true;
        if (response.status !== 200) throw new Error(`pinned source returned HTTP ${response.status}; expected 200`);
        if (measured.networkBytes !== pin.source.bytes || measured.hash !== pin.source.sha256) throw new Error('pinned source response hash or byte count does not match the reviewed pin');
        await inspectPath(inputPath);
        try { await linkExclusive(tempPath, inputPath); await syncDirectory(cacheDirectory); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const validConcurrent = await verifyCachedSource(inputPath, receiptPath, pin, pinHash);
          if (!validConcurrent) throw new Error('fine source cache collision disappeared unexpectedly');
        }
        const receipt = { schemaVersion: 1, pinHash, sourceUrl: pin.source.url, sha256: measured.hash, bytes: measured.networkBytes,
          observedHttpStatus: observedStatus, upstreamBytes: measured.networkBytes, startedAt: startRecord.startedAt,
          completedAt: new Date().toISOString(), evidence: 'exact-pinned-response-hash-verified' };
        await writeReceiptLast(receiptPath, receipt);
        await unlink(tempPath);
        finishedStatus = 'success';
        return { inputPath, networkBytes: measured.networkBytes, sourceBytes: measured.networkBytes, cacheHit: false, receiptPath };
      } catch (error) {
        failure = errorText(error);
        try { await lstat(tempPath); } catch (statError) { if ((statError as NodeJS.ErrnoException).code === 'ENOENT') networkBytes ??= null; else throw statError; }
        throw error;
      } finally {
        let retainedPartial: string | null = null;
        try { await lstat(tempPath); retainedPartial = tempPath; } catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
        await appendAudit(attemptsDirectory, { schemaVersion: 1, attemptId, event: 'finished', status: finishedStatus,
          endedAt: new Date().toISOString(), pinHash, sourceUrl: pin.source.url, expectedSha256: pin.source.sha256,
          expectedBytes: pin.source.bytes, sourceSha256: pin.source.sha256,
          networkReservationUpperBoundBytes: responseComplete ? networkBytes ?? 0 : allowance,
          networkBytesMeasured: networkBytes, responseComplete, observedHttpStatus: observedStatus, partialPath: retainedPartial,
          error: failure });
      }
    }, { signal, timeoutMs: Math.max(1, Math.min(durationMs, deadline - Date.now())) });
  } finally { clearTimeout(deadlineTimer); }
  if (!result) throw new Error('fine source acquisition ended without a result');
  return result;
}
