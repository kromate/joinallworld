import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import type { CountryCaptureResult, CountryCaptureSpec } from './country-types.ts';

const LIMITS = Object.freeze({ durationMs: 120_000, freeBytes: 100 * 1024 * 1024, responseBytes: 16 * 1024 * 1024,
  cacheBytes: 64 * 1024 * 1024, auditBytes: 2 * 1024 * 1024, auditRecords: 512, recordBytes: 8 * 1024,
  reserveBytes: 16 * 1024, scanEntries: 4_096, scanDepth: 8, metadataBytes: 64 * 1024 });
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const CACHE_RELATIVE = '.cache/world-build/country-source-cache';
const METADATA_PATH = '.cache/world-build/evidence/country-resolution-research/ne-10m-countries-api.json';
const ARTIFACT_PATH = 'geojson/ne_10m_admin_0_countries.geojson';
const GITHUB_RAW = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector';

export interface CountryAcquisitionOptions {
  repositoryRoot: string;
  signal?: AbortSignal;
  durationMs?: number;
  cacheOnly?: boolean;
  /** Test seam only; request URL, headers and redirect policy remain controlled here. */
  fetcher?: typeof fetch;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${label} has missing or unknown fields`);
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('country capture identity contains a non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new TypeError('country capture identity is not JSON data');
}
function sha256(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function gitBlobSha1(bytes: Uint8Array): string {
  const digest = createHash('sha1'); digest.update(`blob ${bytes.byteLength}\0`); digest.update(bytes); return digest.digest('hex');
}
function errorText(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 2_000); }
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Restrict capture specs to this exact Natural Earth artifact; allow separately reviewed immutable commits. */
export function validateCountryCaptureSpec(value: unknown): CountryCaptureSpec {
  const spec = object(value, 'country capture spec');
  exactKeys(spec, ['schemaVersion', 'provider', 'release', 'resolution', 'metadataPath', 'metadataSha256', 'metadataBytes',
    'expectedBytes', 'expectedGitBlobSha1', 'license', 'attribution'], 'country capture spec');
  if (spec.schemaVersion !== 1 || spec.provider !== 'natural-earth' || spec.resolution !== '10m' || spec.metadataPath !== METADATA_PATH
      || spec.license !== 'Public-domain') throw new TypeError('country capture spec must identify the pinned Natural Earth 10m countries artifact');
  if (typeof spec.release !== 'string' || !HEX40.test(spec.release)) throw new TypeError('country release must be a full lowercase 40-hex commit');
  if (typeof spec.metadataSha256 !== 'string' || !HEX64.test(spec.metadataSha256)) throw new TypeError('metadata SHA-256 pin is invalid');
  if (!Number.isSafeInteger(spec.metadataBytes) || (spec.metadataBytes as number) < 1 || (spec.metadataBytes as number) > LIMITS.metadataBytes) throw new RangeError('metadata exceeds its 64 KiB cap');
  if (!Number.isSafeInteger(spec.expectedBytes) || (spec.expectedBytes as number) < 1 || (spec.expectedBytes as number) > LIMITS.responseBytes) throw new RangeError('country source exceeds its 16 MiB expected-byte cap');
  if (typeof spec.expectedGitBlobSha1 !== 'string' || !HEX40.test(spec.expectedGitBlobSha1)) throw new TypeError('expected Git blob SHA-1 is invalid');
  if (typeof spec.attribution !== 'string' || !spec.attribution.trim() || spec.attribution.length > 512 || /[\u0000-\u001f\u007f]/.test(spec.attribution)) throw new TypeError('country attribution is invalid bounded text');
  return value as CountryCaptureSpec;
}

async function inspectPath(target: string): Promise<void> {
  const resolved = path.resolve(target), root = path.parse(resolved).root;
  let cursor = root;
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]!);
    let info;
    try { info = await lstat(cursor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new Error(`country source path contains a symlink or non-directory ancestor: ${cursor}`);
  }
}
async function ensureDirectory(target: string, root: string): Promise<void> {
  if (!inside(root, target)) throw new Error('country source cache escapes repository root');
  const filesystemRoot = path.parse(target).root;
  let cursor = filesystemRoot;
  for (const part of target.slice(filesystemRoot.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`country source cache directory is unsafe: ${cursor}`);
  }
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function treeBytes(directory: string): Promise<{ bytes: number; entries: number }> {
  let entries = 0;
  const visit = async (current: string, depth: number): Promise<number> => {
    if (depth > LIMITS.scanDepth) throw new RangeError('country source cache exceeds depth-8 traversal cap');
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`country source cache has an unsafe path: ${current}`);
    const dir = await opendir(current); let bytes = 0;
    try {
      for await (const entry of dir) {
        if (++entries > LIMITS.scanEntries) throw new RangeError('country source cache exceeds 4,096 entries');
        const target = path.join(current, entry.name), child = await lstat(target);
        if (child.isSymbolicLink()) throw new Error(`country source cache contains a symlink: ${target}`);
        if (child.isDirectory()) bytes += await visit(target, depth + 1);
        else if (child.isFile()) bytes += child.size;
        else throw new Error(`country source cache contains a non-regular entry: ${target}`);
        if (bytes > LIMITS.cacheBytes) throw new RangeError('country source cache exceeds 64 MiB');
      }
    } finally { await dir.close().catch(() => {}); }
    return bytes;
  };
  try { await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, entries: 0 }; throw error; }
  return { bytes: await visit(directory, 0), entries };
}

interface AttemptRecord extends Record<string, unknown> {
  schemaVersion: 1; attemptId: string; requestHash: string; event: 'started' | 'finished';
}
async function readAudit(filename: string, requestHash: string): Promise<{ records: AttemptRecord[]; reserved: number; bytes: number }> {
  let bytes: Buffer;
  try { bytes = await readBoundedLocalFile(filename, LIMITS.auditBytes); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], reserved: 0, bytes: 0 }; throw error; }
  const records: AttemptRecord[] = [], starts = new Map<string, AttemptRecord>(), terminals = new Map<string, AttemptRecord>();
  const lines = bytes.toString('utf8').split('\n').filter(Boolean);
  for (const [index, line] of lines.entries()) {
    let parsed: unknown; try { parsed = JSON.parse(line) as unknown; } catch { throw new Error(`country source audit JSONL is malformed at line ${index + 1}`); }
    const row = object(parsed, `country source audit line ${index + 1}`) as AttemptRecord;
    if (row.schemaVersion !== 1 || row.requestHash !== requestHash || typeof row.attemptId !== 'string' || !/^[a-f0-9-]{36}$/.test(row.attemptId)
        || (row.event !== 'started' && row.event !== 'finished')) throw new Error('country source audit identity is corrupt');
    const prior = row.event === 'started' ? starts : terminals;
    if (prior.has(row.attemptId)) throw new Error('country source audit repeats an attempt event');
    if (row.event === 'started') {
      if (row.status !== 'pending' || !Number.isSafeInteger(row.networkReservationUpperBoundBytes) || (row.networkReservationUpperBoundBytes as number) < 1 || (row.networkReservationUpperBoundBytes as number) > LIMITS.responseBytes) throw new Error('country source audit start reservation is invalid');
      starts.set(row.attemptId, row);
    } else {
      const start = starts.get(row.attemptId);
      if (!start || !Number.isSafeInteger(row.networkReservationUpperBoundBytes) || (row.networkReservationUpperBoundBytes as number) < 0
          || !(row.networkBytesMeasured === null || (Number.isSafeInteger(row.networkBytesMeasured) && (row.networkBytesMeasured as number) >= 0))
          || typeof row.responseComplete !== 'boolean') throw new Error('country source audit terminal record is invalid');
      if ((!row.responseComplete && row.networkReservationUpperBoundBytes !== start.networkReservationUpperBoundBytes)
          || (row.responseComplete && (row.networkBytesMeasured === null || row.networkReservationUpperBoundBytes !== row.networkBytesMeasured))
          || (row.networkReservationUpperBoundBytes as number) > (start.networkReservationUpperBoundBytes as number)
          || !['success', 'failure'].includes(String(row.status))) throw new Error('country source audit releases an unmeasured reservation');
      terminals.set(row.attemptId, row);
    }
    records.push(row);
  }
  let reserved = 0;
  for (const [id, start] of starts) {
    const terminal = terminals.get(id);
    reserved += terminal ? terminal.networkReservationUpperBoundBytes as number : start.networkReservationUpperBoundBytes as number;
  }
  return { records, reserved, bytes: bytes.length };
}
async function appendAudit(directory: string, record: Record<string, unknown>, create = false): Promise<void> {
  const bytes = Buffer.from(`${canonical(record)}\n`);
  if (bytes.length > LIMITS.recordBytes) throw new RangeError('country source audit record exceeds 8 KiB');
  const filename = path.join(directory, 'attempts.jsonl');
  await inspectPath(filename);
  const current = await readAudit(filename, String(record.requestHash));
  if (current.records.length >= LIMITS.auditRecords || current.bytes + bytes.length > LIMITS.auditBytes) throw new RangeError('country source audit exceeds 512 events/2 MiB');
  const handle = await open(filename, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0) | (create ? constants.O_CREAT | constants.O_EXCL : 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(directory);
}
async function writeReceipt(filename: string, record: Record<string, unknown>): Promise<void> {
  const temporary = `${filename}.${randomUUID()}.tmp`, bytes = Buffer.from(`${canonical(record)}\n`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    await inspectPath(filename); await link(temporary, filename); await syncDirectory(path.dirname(filename));
  } finally { await unlink(temporary).catch(() => {}); }
}
async function verifyMetadata(spec: CountryCaptureSpec, repositoryRoot: string): Promise<{ url: string; metadata: Record<string, unknown> }> {
  const filename = path.resolve(repositoryRoot, spec.metadataPath);
  if (!inside(repositoryRoot, filename) || path.relative(repositoryRoot, filename) !== METADATA_PATH) throw new Error('country metadata path escapes the exact local evidence path');
  await inspectPath(filename);
  const bytes = await readBoundedLocalFile(filename, LIMITS.metadataBytes);
  if (bytes.length !== spec.metadataBytes || sha256(bytes) !== spec.metadataSha256) throw new Error('country metadata bytes do not match the reviewed metadata pin');
  let raw: unknown; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch (error) { throw new TypeError(`country metadata is invalid UTF-8 or JSON: ${errorText(error)}`); }
  const metadata = object(raw, 'Natural Earth metadata');
  const expectedUrl = `${GITHUB_RAW}/${spec.release}/${ARTIFACT_PATH}`;
  const blobUrl = `https://api.github.com/repos/nvkelso/natural-earth-vector/git/blobs/${spec.expectedGitBlobSha1}`;
  if (metadata.name !== 'ne_10m_admin_0_countries.geojson' || metadata.path !== ARTIFACT_PATH || metadata.sha !== spec.expectedGitBlobSha1
      || metadata.size !== spec.expectedBytes || metadata.encoding !== 'none' || metadata.type !== 'file'
      || metadata.download_url !== expectedUrl || metadata.git_url !== blobUrl
      || metadata.url !== `https://api.github.com/repos/nvkelso/natural-earth-vector/contents/${ARTIFACT_PATH}?ref=${spec.release}`
      || metadata.html_url !== `https://github.com/nvkelso/natural-earth-vector/blob/${spec.release}/${ARTIFACT_PATH}`) throw new Error('country metadata does not match the exact pinned artifact URL/blob/size/encoding');
  const links = object(metadata._links, 'Natural Earth metadata links');
  if (links.git !== blobUrl) throw new Error('country metadata Git blob link does not match the exact blob pin');
  return { url: expectedUrl, metadata };
}
function makeSource(spec: CountryCaptureSpec, url: string, bytes: Uint8Array) {
  return { id: `natural-earth-admin0-10m-${spec.release}`, url, release: spec.release, license: spec.license,
    attribution: spec.attribution, sha256: sha256(bytes), bytes: bytes.byteLength };
}
async function verifyCache(inputPath: string, receiptPath: string, spec: CountryCaptureSpec, url: string, requestHash: string): Promise<CountryCaptureResult | null> {
  let raw: Buffer;
  try { raw = await readBoundedLocalFile(inputPath, LIMITS.responseBytes); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error(`country source cache is unsafe or corrupt and retained: ${errorText(error)}`); }
  if (raw.length !== spec.expectedBytes || gitBlobSha1(raw) !== spec.expectedGitBlobSha1) throw new Error('country source cache size/Git blob SHA mismatch; retained for review');
  const requestIdentity = { release: spec.release, path: ARTIFACT_PATH, blob: spec.expectedGitBlobSha1, expectedBytes: spec.expectedBytes };
  const source = makeSource(spec, url, raw), expected = { schemaVersion: 1, requestHash, requestIdentity, sourceId: source.id, sourceUrl: url,
    sha256: source.sha256, bytes: source.bytes, gitBlobSha1: spec.expectedGitBlobSha1 };
  let receiptExists = true;
  try { await lstat(receiptPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') receiptExists = false; else throw error; }
  if (receiptExists) {
    const receiptBytes = await readBoundedLocalFile(receiptPath, 16 * 1024);
    let parsed: unknown; try { parsed = JSON.parse(receiptBytes.toString('utf8')) as unknown; } catch { throw new Error('country source receipt is corrupt and retained'); }
    const receipt = object(parsed, 'country source receipt');
    for (const [key, value] of Object.entries(expected)) if (canonical(receipt[key]) !== canonical(value)) throw new Error('country source receipt does not match retained verified bytes');
    const responseReceipt = receipt.evidence === 'exact-pinned-response-hash-verified';
    const allowed = responseReceipt
      ? ['schemaVersion', 'requestHash', 'requestIdentity', 'sourceId', 'sourceUrl', 'sha256', 'bytes', 'gitBlobSha1', 'observedHttpStatus', 'upstreamBytes', 'startedAt', 'completedAt', 'evidence']
      : ['schemaVersion', 'requestHash', 'requestIdentity', 'sourceId', 'sourceUrl', 'sha256', 'bytes', 'gitBlobSha1', 'observedHttpStatus', 'upstreamBytes', 'completedAt', 'evidence'];
    exactKeys(receipt, allowed, 'country source receipt');
    if (receipt.schemaVersion !== 1 || typeof receipt.completedAt !== 'string' || !Number.isFinite(Date.parse(receipt.completedAt))
        || (responseReceipt && (receipt.observedHttpStatus !== 200 || receipt.upstreamBytes !== raw.length || typeof receipt.startedAt !== 'string' || !Number.isFinite(Date.parse(receipt.startedAt))))
        || (!responseReceipt && (receipt.evidence !== 'verified-existing-git-blob-cache' || receipt.observedHttpStatus !== null || receipt.upstreamBytes !== 0))) throw new Error('country source receipt evidence is invalid');
  } else {
    const disk = await statfs(path.dirname(inputPath)), subtree = await treeBytes(path.dirname(inputPath));
    if (disk.bavail * disk.bsize < LIMITS.freeBytes + LIMITS.reserveBytes || subtree.bytes + LIMITS.reserveBytes > LIMITS.cacheBytes) throw new RangeError('country source cache receipt restoration lacks reserved disk/cache headroom');
    await writeReceipt(receiptPath, { ...expected, observedHttpStatus: null, upstreamBytes: 0, completedAt: new Date().toISOString(), evidence: 'verified-existing-git-blob-cache' });
  }
  return { source, input: `${CACHE_RELATIVE}/${requestHash}.geojson`, inputPath, receiptPath, cacheHit: true, networkBytes: 0, requestHash };
}

async function consume(response: Response, partialPath: string, signal: AbortSignal, remaining: number, expectedBytes: number,
  setMeasured: (value: number) => void): Promise<{ bytes: number; sha256: string; gitBlobSha1: string }> {
  if (!response.body) throw new Error('country source response has no body');
  const file = await open(partialPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  const hash = createHash('sha256'), gitPrefix = createHash('sha1');
  gitPrefix.update(`blob ${expectedBytes}\0`);
  let measured = 0, eof = false;
  try {
    const reader = response.body.getReader();
    try {
      for (;;) {
        if (signal.aborted) throw signal.reason ?? new Error('country source acquisition aborted');
        const next = reader.read();
        const item = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
          if (signal.aborted) { reject(signal.reason ?? new Error('country source acquisition aborted')); return; }
          const abort = () => { void reader.cancel().catch(() => {}); reject(signal.reason ?? new Error('country source acquisition aborted')); };
          signal.addEventListener('abort', abort, { once: true });
          next.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        });
        if (item.done) { eof = true; break; }
        const chunk = item.value; measured += chunk.byteLength; setMeasured(measured);
        const accepted = Math.min(chunk.byteLength, Math.max(0, remaining - (measured - chunk.byteLength)));
        const bounded = chunk.subarray(0, accepted);
        hash.update(bounded); gitPrefix.update(bounded);
        let offset = 0;
        while (offset < bounded.length) {
          const result = await file.write(bounded, offset, bounded.length - offset);
          if (!result.bytesWritten) throw new Error('country source partial write made no progress');
          offset += result.bytesWritten;
        }
        if (accepted < chunk.byteLength) { await reader.cancel().catch(() => {}); throw new RangeError('country source response exceeds its 16 MiB cumulative network allowance'); }
      }
    } finally { if (!eof) await reader.cancel().catch(() => {}); reader.releaseLock(); }
    await file.sync();
    return { bytes: measured, sha256: hash.digest('hex'), gitBlobSha1: gitPrefix.digest('hex') };
  } finally { await file.close(); }
}

async function cancelBody(response: Response): Promise<void> { if (response.body && !response.body.locked) await response.body.cancel().catch(() => {}); }

/** Acquire the exact commit-pinned Natural Earth 10m country artifact and preserve auditable byte identity. */
export async function acquireCountrySource(specValue: unknown, options: CountryAcquisitionOptions): Promise<CountryCaptureResult> {
  const startedMs = Date.now(), durationMs = options.durationMs ?? LIMITS.durationMs;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > LIMITS.durationMs) throw new RangeError('country source duration must be 1..120,000 ms');
  const spec = validateCountryCaptureSpec(specValue);
  if (typeof options.repositoryRoot !== 'string' || !path.isAbsolute(options.repositoryRoot) || path.resolve(options.repositoryRoot) !== options.repositoryRoot) throw new TypeError('repositoryRoot must be canonical and absolute');
  await inspectPath(options.repositoryRoot);
  const rootStat = await lstat(options.repositoryRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('repositoryRoot must be an existing real directory');
  const cacheRoot = path.join(options.repositoryRoot, '.cache', 'world-build');
  const cacheDir = path.join(options.repositoryRoot, CACHE_RELATIVE);
  const metadata = await verifyMetadata(spec, options.repositoryRoot);
  const requestIdentity = { release: spec.release, path: ARTIFACT_PATH, blob: spec.expectedGitBlobSha1, expectedBytes: spec.expectedBytes };
  const requestHash = sha256(canonical(requestIdentity));
  const inputPath = path.join(cacheDir, `${requestHash}.geojson`), receiptPath = path.join(cacheDir, `${requestHash}.receipt.json`);
  const attemptsDir = path.join(cacheDir, 'attempts', requestHash), auditPath = path.join(attemptsDir, 'attempts.jsonl');
  const deadlineAt = startedMs + durationMs, deadlineCtrl = new AbortController(), rssCtrl = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineCtrl.abort(new Error('country source acquisition reached its wall deadline')), Math.max(1, deadlineAt - Date.now()));
  deadlineTimer.unref();
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), deadlineCtrl.signal, rssCtrl.signal]);
  let peakRssBytes = process.memoryUsage().rss;
  const rssTimer = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    if (peakRssBytes > 512 * 1024 * 1024) rssCtrl.abort(new Error('country source acquisition process exceeded 512 MiB RSS'));
  }, 250);
  rssTimer.unref();
  try {
    return await withAcquisitionBuildLock(cacheRoot, async () => {
      if (signal.aborted || Date.now() >= deadlineAt) throw signal.reason ?? new Error('country source acquisition timed out before lock admission');
      await inspectPath(cacheRoot);
      const cacheDirExists = await lstat(cacheDir).then(() => true, error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : Promise.reject(error));
      if (!cacheDirExists && options.cacheOnly) throw new Error('country source cache-only verification failed; cache directory is absent');
      if (!cacheDirExists) await ensureDirectory(cacheDir, options.repositoryRoot);
      const subtree = await treeBytes(cacheDir), subtreeBytes = subtree.bytes;
      if (subtreeBytes > LIMITS.cacheBytes) throw new RangeError('country source cache exceeds 64 MiB');
      const inputExists = await lstat(inputPath).then(() => true, error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : Promise.reject(error));
      const receiptExists = await lstat(receiptPath).then(() => true, error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : Promise.reject(error));
      if (!inputExists && receiptExists) throw new Error('country source receipt exists without its immutable input; retained for review');
      if (inputExists) {
        // Inspect retained attempt evidence before even restoring a missing receipt.
        const auditExists = await lstat(auditPath).then(() => true, error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : Promise.reject(error));
        if (auditExists) await readAudit(auditPath, requestHash);
        const hit = await verifyCache(inputPath, receiptPath, spec, metadata.url, requestHash);
        if (hit) {
          return hit; // A verified cache hit remains available after the network allowance is exhausted.
        }
      }
      if (options.cacheOnly) throw new Error('country source cache-only verification failed; reviewed source is not cached');
      if (signal.aborted || Date.now() >= deadlineAt) throw signal.reason ?? new Error('country source deadline elapsed before attempt admission');
      const disk = await statfs(cacheRoot);
      if (disk.bavail * disk.bsize < LIMITS.freeBytes + LIMITS.responseBytes) throw new RangeError('country source capture requires 100 MiB free reserve plus 16 MiB response allowance');
      await ensureDirectory(attemptsDir, options.repositoryRoot);
      const audit = await readAudit(auditPath, requestHash);
      if (audit.records.length + 2 > LIMITS.auditRecords || audit.bytes + LIMITS.reserveBytes > LIMITS.auditBytes) throw new RangeError('country source audit requires room for start/terminal records within 512 events/2 MiB');
      const remainingAllowance = LIMITS.responseBytes - audit.reserved;
      if (remainingAllowance < spec.expectedBytes) throw new RangeError('country source cumulative 16 MiB network allowance cannot cover the expected source bytes');
      if (subtreeBytes + remainingAllowance + LIMITS.reserveBytes > LIMITS.cacheBytes) throw new RangeError('country source cache lacks room for the reserved response under its 64 MiB cap');
      if (subtree.entries + 4 > LIMITS.scanEntries) throw new RangeError('country source cache lacks room under its 4,096-entry cap');
      const attemptId = randomUUID(), startedAt = new Date().toISOString(), partialPath = path.join(cacheDir, `.${requestHash}.${attemptId}.partial`);
      const startRecord = { schemaVersion: 1, attemptId, requestHash, event: 'started', status: 'pending', startedAt,
        networkReservationUpperBoundBytes: remainingAllowance, networkBytesMeasured: null, requestIdentity };
      await appendAudit(attemptsDir, startRecord, audit.records.length === 0);
      let measured: number | null = null, responseComplete = false, httpStatus: number | null = null, terminalStatus = 'failure', failure: string | null = null;
      try {
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        if (peakRssBytes > 512 * 1024 * 1024) throw new Error('country source acquisition process exceeded 512 MiB RSS before request');
        if (signal.aborted) throw signal.reason ?? new Error('country source acquisition aborted');
        const response = await (options.fetcher ?? fetch)(metadata.url, { method: 'GET', redirect: 'manual', signal,
          headers: { 'accept-encoding': 'identity', accept: 'application/geo+json, application/json;q=0.9, */*;q=0.1' } });
        httpStatus = response.status;
        const encoding = response.headers.get('content-encoding');
        if (encoding && encoding.toLowerCase() !== 'identity') { await cancelBody(response); throw new Error('country source response ignored identity-encoding request'); }
        if (!response.body) {
          if (response.status >= 300 && response.status < 400) { measured = 0; responseComplete = true; throw new Error(`country source redirected with HTTP ${response.status}; redirects are disabled`); }
          throw new Error('country source response has no body');
        }
        const hashes = await consume(response, partialPath, signal, remainingAllowance, spec.expectedBytes, value => { measured = value; });
        measured = hashes.bytes; responseComplete = true;
        if (response.status >= 300 && response.status < 400) throw new Error(`country source redirected with HTTP ${response.status}; redirects are disabled`);
        if (response.status !== 200) throw new Error(`country source returned HTTP ${response.status}; expected 200`);
        if (hashes.bytes !== spec.expectedBytes || hashes.gitBlobSha1 !== spec.expectedGitBlobSha1) throw new Error('country source length or Git blob SHA-1 differs from frozen metadata');
        const raw = await readBoundedLocalFile(partialPath, LIMITS.responseBytes);
        if (raw.length !== spec.expectedBytes || sha256(raw) !== hashes.sha256 || gitBlobSha1(raw) !== spec.expectedGitBlobSha1) throw new Error('country source partial failed independent size/hash verification');
        await inspectPath(inputPath);
        try { await link(partialPath, inputPath); await syncDirectory(cacheDir); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const concurrent = await verifyCache(inputPath, receiptPath, spec, metadata.url, requestHash);
          if (!concurrent) throw new Error('country source immutable publication collision disappeared unexpectedly');
        }
        const source = makeSource(spec, metadata.url, raw);
        const receipt = { schemaVersion: 1, requestHash, requestIdentity, sourceId: source.id, sourceUrl: metadata.url,
          sha256: source.sha256, bytes: source.bytes, gitBlobSha1: spec.expectedGitBlobSha1, observedHttpStatus: httpStatus,
          upstreamBytes: measured, startedAt, completedAt: new Date().toISOString(), evidence: 'exact-pinned-response-hash-verified' };
        await writeReceipt(receiptPath, receipt);
        await unlink(partialPath);
        terminalStatus = 'success';
        return { source, input: `${CACHE_RELATIVE}/${requestHash}.geojson`, inputPath, receiptPath, cacheHit: false, networkBytes: measured, requestHash };
      } catch (error) { failure = errorText(error); throw error; }
      finally {
        const retainedPartial = await lstat(partialPath).then(() => partialPath, error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error));
        await appendAudit(attemptsDir, { schemaVersion: 1, attemptId, requestHash, event: 'finished', status: terminalStatus,
          endedAt: new Date().toISOString(), networkReservationUpperBoundBytes: responseComplete ? measured ?? 0 : remainingAllowance,
          networkBytesMeasured: measured, responseComplete, observedHttpStatus: httpStatus, partialPath: retainedPartial, error: failure,
          peakRssBytes, requestIdentity });
      }
    }, { signal, timeoutMs: Math.max(1, Math.min(durationMs, deadlineAt - Date.now())) });
  } finally { clearTimeout(deadlineTimer); clearInterval(rssTimer); }
}
