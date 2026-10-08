import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, realpath, rename, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { SETTLEMENT_CAPTURE_LIMITS as LIMITS, type SettlementCaptureResult, type SettlementCaptureSpec } from './settlement-types.ts';
import type { SourceRecord } from './types.ts';

const ARTIFACT = 'geojson/ne_10m_populated_places.geojson';
const METADATA_PATH = '.cache/world-build/evidence/settlement-admission/source-api.json';
const CACHE_REL = '.cache/world-build/settlement-source-cache';
const RAW_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector';
const API_BASE = 'https://api.github.com/repos/nvkelso/natural-earth-vector';
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const MAX_ERROR_BYTES = 2_000;

export interface SettlementAcquisitionOptions {
  repositoryRoot: string; signal?: AbortSignal; durationMs?: number; cacheOnly?: boolean;
  /** Tests only: request URL, redirect policy, and response validation remain fixed here. */
  fetcher?: typeof fetch;
}
type Identity = { release: string; path: string; blob: string; expectedBytes: number };
type AuditStart = { schemaVersion: 1; requestHash: string; attemptId: string; event: 'started'; status: 'pending'; identity: Identity; reservedNetworkBytes: number; networkBytesMeasured: null; complete: false; startedAt: string };
type AuditFinish = { schemaVersion: 1; requestHash: string; attemptId: string; event: 'finished'; status: 'success' | 'failure' | 'aborted' | 'timed-out'; identity: Identity; reservedNetworkBytes: number; networkBytesMeasured: number | null; complete: boolean; startedAt: string; endedAt: string; reason?: string; sourceSha256?: string; sourceBytes?: number };

function fail(message: string): never { throw new Error(message); }
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError(`${label} has missing or unknown fields`); }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('non-finite settlement capture identity'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') { const row = value as Record<string, unknown>; return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`; }
  throw new TypeError('settlement value is not canonical JSON');
}
const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
function gitBlobSha1(bytes: Uint8Array): string { return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex'); }
function errText(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001f\u007f]/gu, ' ');
  return Buffer.byteLength(text) <= MAX_ERROR_BYTES ? text : Buffer.from(text).subarray(0, MAX_ERROR_BYTES).toString('utf8').replace(/�+$/u, '');
}
function inside(root: string, child: string): boolean { const rel = path.relative(root, child); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); }

export function validateSettlementCaptureSpec(value: unknown): SettlementCaptureSpec {
  const spec = object(value, 'Settlement capture spec');
  exactKeys(spec, ['schemaVersion','provider','release','resolution','metadataPath','metadataSha256','metadataBytes','expectedBytes','expectedGitBlobSha1','license','attribution'], 'Settlement capture spec');
  if (spec.schemaVersion !== 1 || spec.provider !== 'natural-earth' || spec.resolution !== '10m' || spec.metadataPath !== METADATA_PATH || spec.license !== 'Public-domain') throw new TypeError('Settlement capture must identify the pinned Natural Earth 10m source');
  if (typeof spec.release !== 'string' || !HEX40.test(spec.release)) throw new TypeError('Settlement release must be a full lowercase commit');
  if (typeof spec.metadataSha256 !== 'string' || !HEX64.test(spec.metadataSha256)) throw new TypeError('Settlement metadata SHA-256 is invalid');
  if (typeof spec.metadataBytes !== 'number' || !Number.isSafeInteger(spec.metadataBytes) || spec.metadataBytes < 1 || spec.metadataBytes > LIMITS.metadataBytes) throw new RangeError('Settlement metadata exceeds 64 KiB');
  if (typeof spec.expectedBytes !== 'number' || !Number.isSafeInteger(spec.expectedBytes) || spec.expectedBytes < 1 || spec.expectedBytes > LIMITS.sourceBytes) throw new RangeError('Settlement source exceeds 32 MiB');
  if (typeof spec.expectedGitBlobSha1 !== 'string' || !HEX40.test(spec.expectedGitBlobSha1)) throw new TypeError('Settlement Git blob SHA-1 is invalid');
  if (typeof spec.attribution !== 'string' || !spec.attribution.trim() || Buffer.byteLength(spec.attribution) > 512 || /[\u0000-\u001f\u007f]/.test(spec.attribution)) throw new TypeError('Settlement attribution is invalid bounded text');
  return value as SettlementCaptureSpec;
}

async function assertPathSafe(root: string, target: string): Promise<void> {
  const base = path.resolve(root), absolute = path.resolve(target);
  if (!inside(base, absolute)) throw new Error('Settlement capture path escapes repository root');
  const rootStat = await lstat(base); if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Settlement repository root is not a real directory');
  const rel = path.relative(base, absolute); let cursor = base; const parts = rel ? rel.split(path.sep) : [];
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]!);
    try { const st = await lstat(cursor); if (st.isSymbolicLink() || (i < parts.length - 1 && !st.isDirectory())) throw new Error(`Settlement capture path has unsafe ancestor: ${cursor}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
async function ensureDir(root: string, target: string): Promise<void> {
  if (!inside(root, target)) throw new Error('Settlement cache escapes repository root');
  await assertPathSafe(root, root);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const st = await lstat(current); if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`Settlement cache directory is unsafe: ${current}`);
  }
}
async function syncDir(directory: string): Promise<void> { const handle = await open(directory, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }

function live(signal: AbortSignal, deadline: number): void {
  if (signal.aborted) throw signal.reason ?? new Error('Settlement capture aborted');
  if (performance.now() >= deadline) throw new Error('Settlement capture reached wall deadline');
  if (process.memoryUsage().rss > LIMITS.rssBytes) throw new RangeError('Settlement capture process exceeded 512 MiB RSS');
}
async function treeUsage(root: string, signal: AbortSignal, deadline: number): Promise<{ bytes: number; entries: number }> {
  let entries = 0;
  const visit = async (directory: string, depth: number): Promise<number> => {
    live(signal, deadline); if (depth > LIMITS.scanDepth) throw new RangeError('Settlement cache exceeds depth-five cap');
    let st; try { st = await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && directory === root) return 0; throw error; }
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Settlement cache directory is unsafe');
    const handle = await opendir(directory); let total = 0;
    try { for await (const entry of handle) {
      live(signal, deadline); if (++entries > LIMITS.scanEntries) throw new RangeError('Settlement cache exceeds 512 entries');
      const filename = path.join(directory, entry.name), info = await lstat(filename);
      if (info.isSymbolicLink()) throw new Error('Settlement cache contains a symlink');
      if (info.isDirectory()) total += await visit(filename, depth + 1); else if (info.isFile()) total += info.size; else throw new Error('Settlement cache contains a non-regular path');
      if (total > LIMITS.cacheBytes) throw new RangeError('Settlement cache exceeds 64 MiB');
    } } finally { await handle.close().catch(() => {}); }
    return total;
  };
  return { bytes: await visit(root, 0), entries };
}

type AuditState = { rows: Array<AuditStart | AuditFinish>; attempts: Map<string, number>; charge: number; bytes: number };
function parseAuditLine(value: unknown): AuditStart | AuditFinish {
  const row = object(value, 'settlement audit record');
  const event = row.event;
  const startKeys = ['schemaVersion','requestHash','attemptId','event','status','identity','reservedNetworkBytes','networkBytesMeasured','complete','startedAt'];
  const finishCommon = ['schemaVersion','requestHash','attemptId','event','status','identity','reservedNetworkBytes','networkBytesMeasured','complete','startedAt','endedAt'];
  const finishKeys = row.status === 'success' ? [...finishCommon,'sourceSha256','sourceBytes'] : [...finishCommon,'reason'];
  exactKeys(row, event === 'started' ? startKeys : finishKeys, 'Settlement audit record');
  const identity = object(row.identity, 'Settlement audit identity');
  exactKeys(identity, ['release','path','blob','expectedBytes'], 'Settlement audit identity');
  if (identity.path !== ARTIFACT || typeof identity.release !== 'string' || !HEX40.test(identity.release) || typeof identity.blob !== 'string' || !HEX40.test(identity.blob) || typeof identity.expectedBytes !== 'number' || !Number.isSafeInteger(identity.expectedBytes) || identity.expectedBytes < 1 || identity.expectedBytes > LIMITS.sourceBytes) throw new Error('Settlement audit identity is invalid');
  const requestHash = sha256(canonical(identity));
  const reservation = row.reservedNetworkBytes;
  if (row.schemaVersion !== 1 || row.requestHash !== requestHash || typeof row.attemptId !== 'string' || !/^[a-f0-9-]{36}$/.test(row.attemptId) || typeof reservation !== 'number' || !Number.isSafeInteger(reservation) || reservation < 0 || !(row.networkBytesMeasured === null || typeof row.networkBytesMeasured === 'number' && Number.isSafeInteger(row.networkBytesMeasured) && row.networkBytesMeasured >= 0) || typeof row.complete !== 'boolean' || typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt)) || new Date(Date.parse(row.startedAt)).toISOString() !== row.startedAt) throw new Error('Settlement audit identity or counters are invalid');
  const startReservation = Number(identity.expectedBytes) + LIMITS.overshootBytes;
  if (event === 'started') {
    if (row.status !== 'pending' || reservation !== startReservation || row.networkBytesMeasured !== null || row.complete) throw new Error('Settlement pending audit reservation is invalid');
    return row as unknown as AuditStart;
  }
  if (event !== 'finished' || !['success','failure','aborted','timed-out'].includes(String(row.status)) || typeof row.endedAt !== 'string' || !Number.isFinite(Date.parse(row.endedAt)) || new Date(Date.parse(row.endedAt)).toISOString() !== row.endedAt || Date.parse(row.endedAt) < Date.parse(row.startedAt)) throw new Error('Settlement terminal audit record is invalid');
  const measured = row.networkBytesMeasured;
  if (row.complete ? (typeof measured !== 'number' || reservation !== measured) : (reservation < startReservation || typeof measured === 'number' && reservation < measured)) throw new Error('Settlement terminal record releases unknown network reservation');
  if (row.status === 'success') {
    if (!row.complete || measured !== identity.expectedBytes || row.sourceBytes !== identity.expectedBytes || typeof row.sourceSha256 !== 'string' || !HEX64.test(row.sourceSha256)) throw new Error('Settlement successful audit does not bind exact source bytes');
  } else if (typeof row.reason !== 'string' || Buffer.byteLength(row.reason) > MAX_ERROR_BYTES || /[\u0000-\u001f\u007f]/.test(row.reason)) throw new Error('Settlement failure audit reason is invalid');
  return row as unknown as AuditFinish;
}
async function readAudit(filename: string): Promise<AuditState> {
  let bytes: Buffer; try { bytes = await readBoundedLocalFile(filename, LIMITS.auditBytes); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], attempts: new Map(), charge: 0, bytes: 0 }; throw error; }
  if (bytes.length && bytes.at(-1) !== 10) throw new Error('Settlement network audit is truncated');
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Settlement network audit is not valid UTF-8'); }
  const lines = text.split('\n'); if (lines.at(-1) !== '') throw new Error('Settlement network audit is truncated');
  const starts = new Map<string, AuditStart>(), finishes = new Set<string>(), attempts = new Map<string, number>(), rows: Array<AuditStart | AuditFinish> = [];
  for (const [index, line] of lines.slice(0, -1).entries()) {
    if (!line || Buffer.byteLength(line) + 1 > LIMITS.recordBytes) throw new Error(`Settlement audit record ${index + 1} is empty or oversized`);
    const parsed = JSON.parse(line) as unknown; const record = parseAuditLine(parsed);
    if (canonical(record) !== line) throw new Error(`Settlement audit record ${index + 1} is not canonical`);
    if (record.event === 'started') {
      if (starts.has(record.attemptId)) throw new Error('Settlement audit repeats an attempt ID');
      starts.set(record.attemptId, record); attempts.set(record.requestHash, (attempts.get(record.requestHash) ?? 0) + 1);
    } else {
      const start = starts.get(record.attemptId);
      if (!start || finishes.has(record.attemptId) || record.requestHash !== start.requestHash || canonical(record.identity) !== canonical(start.identity) || record.startedAt !== start.startedAt || (record.complete && record.reservedNetworkBytes !== record.networkBytesMeasured) || (!record.complete && record.reservedNetworkBytes < start.reservedNetworkBytes)) throw new Error('Settlement audit terminal does not match its durable start');
      finishes.add(record.attemptId);
    }
    rows.push(record);
  }
  if (rows.length > LIMITS.auditRecords || [...attempts.values()].some(count => count > LIMITS.maxAttempts)) throw new RangeError('Settlement audit exceeds its record or attempt limit');
  let charge = 0; for (const [id, start] of starts) { const finish = rows.find(row => row.event === 'finished' && row.attemptId === id) as AuditFinish | undefined; charge += finish ? finish.reservedNetworkBytes : start.reservedNetworkBytes; }
  if (!Number.isSafeInteger(charge)) throw new RangeError('Settlement lifetime network accounting is invalid');
  return { rows, attempts, charge, bytes: bytes.length };
}
async function appendAudit(cacheRoot: string, filename: string, record: AuditStart | AuditFinish): Promise<void> {
  const line = Buffer.from(`${canonical(record)}\n`); if (line.length > LIMITS.recordBytes) throw new RangeError('Settlement audit record exceeds 8 KiB');
  await assertPathSafe(cacheRoot, filename);
  const state = await readAudit(filename); if (state.rows.length >= LIMITS.auditRecords || state.bytes + line.length > LIMITS.auditBytes) throw new RangeError('Settlement audit has no room for durable terminal evidence');
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(filename, flags, 0o600);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size + line.length > LIMITS.auditBytes) throw new RangeError('Settlement audit changed beyond its bound'); await handle.writeFile(line); await handle.sync(); } finally { await handle.close(); }
  await syncDir(cacheRoot);
}

function urlFor(spec: SettlementCaptureSpec): string { return `${RAW_BASE}/${spec.release}/${ARTIFACT}`; }
function sourceFor(spec: SettlementCaptureSpec, url: string, sha: string): SourceRecord { return { id: `natural-earth-places-10m-${spec.release}`, url, release: spec.release, license: spec.license, attribution: spec.attribution, sha256: sha, bytes: spec.expectedBytes }; }
function parseCanonical(bytes: Uint8Array, label: string): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (!text.endsWith('\n') || text.endsWith('\n\n')) throw new Error(`${label} newline policy mismatch`);
  const value = JSON.parse(text) as unknown; if (canonical(value) !== text.slice(0, -1)) throw new Error(`${label} is not canonical JSON`); return value;
}
async function verifyMetadata(spec: SettlementCaptureSpec, root: string): Promise<{ url: string }> {
  const filename = path.resolve(root, spec.metadataPath); if (!inside(root, filename) || path.relative(root, filename) !== METADATA_PATH) throw new Error('Settlement metadata path is not exact frozen evidence path');
  await assertPathSafe(root, filename); const bytes = await readBoundedLocalFile(filename, LIMITS.metadataBytes);
  if (bytes.length !== spec.metadataBytes || sha256(bytes) !== spec.metadataSha256) throw new Error('Settlement metadata does not match pinned length and SHA-256');
  let metadata: unknown; try { metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { throw new Error('Settlement metadata is not valid UTF-8 JSON'); }
  const row = object(metadata, 'Settlement Git metadata');
  exactKeys(row, ['name','path','sha','size','url','html_url','git_url','download_url','type','content','encoding','_links'], 'Settlement Git metadata');
  const url = urlFor(spec), git = `${API_BASE}/git/blobs/${spec.expectedGitBlobSha1}`, content = `${API_BASE}/contents/${ARTIFACT}?ref=${spec.release}`, html = `https://github.com/nvkelso/natural-earth-vector/blob/${spec.release}/${ARTIFACT}`;
  if (row.name !== 'ne_10m_populated_places.geojson' || row.path !== ARTIFACT || row.sha !== spec.expectedGitBlobSha1 || row.size !== spec.expectedBytes || row.type !== 'file' || row.content !== '' || row.encoding !== 'none' || row.download_url !== url || row.git_url !== git || row.url !== content || row.html_url !== html) throw new Error('Settlement metadata differs from exact pinned Git artifact/path/blob/size/URL');
  const links = object(row._links, 'Settlement metadata links'); exactKeys(links, ['self','git','html'], 'Settlement metadata links');
  if (links.self !== content || links.git !== git || links.html !== html) throw new Error('Settlement metadata links differ from exact artifact');
  return { url };
}
function checkResponse(response: Response, expectedUrl: string, expectedBytes: number): void {
  if (response.url !== expectedUrl) throw new Error('Settlement response URL differs from exact request URL');
  if (response.status !== 200) throw new Error(`Settlement capture rejected HTTP ${response.status}; redirects are disabled`);
  const encoding = response.headers.get('content-encoding'); if (encoding && encoding.toLowerCase() !== 'identity') throw new Error('Settlement response is not identity encoded');
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  // GitHub raw serves the pinned .geojson artifact as octet-stream (observed HEAD).
  // Transport MIME never substitutes for exact metadata, body size and blob/hash checks.
  if (!type || !['application/json','application/geo+json','text/plain','application/octet-stream'].includes(type)) throw new Error('Settlement response content type is not an admitted JSON/GeoJSON body');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expectedBytes)) throw new Error('Settlement Content-Length differs from exact source length');
}
async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error('Settlement capture aborted');
  let listener: (() => void) | undefined;
  try { return await Promise.race([promise, new Promise<T>((_resolve, reject) => { listener = () => reject(signal.reason ?? new Error('Settlement capture aborted')); signal.addEventListener('abort', listener, { once: true }); })]); }
  finally { if (listener) signal.removeEventListener('abort', listener); }
}
async function cancelResponse(response: Response | undefined): Promise<void> {
  if (!response?.body) return;
  const cancel = response.body.cancel().catch(() => {});
  await Promise.race([cancel, new Promise<void>(resolve => setTimeout(resolve, 100))]);
}
async function consume(response: Response, partial: string, signal: AbortSignal, deadline: number, reservation: number, onBytes: (value: number) => void): Promise<{ bytes: number; sourceSha: string; gitBlobSha: string }> {
  if (!response.body) throw new Error('Settlement response has no body');
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const sourceHash = createHash('sha256'), gitHash = createHash('sha1'); gitHash.update(`blob ${reservation - LIMITS.overshootBytes}\0`);
  let measured = 0, eof = false, pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    file = await open(partial, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    reader = response.body.getReader();
    onAbort = () => { void reader?.cancel().catch(() => {}); }; signal.addEventListener('abort', onAbort, { once: true });
    while (true) {
      live(signal, deadline); pendingRead = reader.read(); const item = await awaitWithSignal(pendingRead, signal); pendingRead = undefined; live(signal, deadline);
      if (item.done) { eof = true; break; }
      const chunk = item.value; measured += chunk.byteLength; onBytes(measured);
      const before = measured - chunk.byteLength, allowed = Math.max(0, Math.min(chunk.byteLength, reservation - before));
      if (allowed > 0) { const accepted = chunk.subarray(0, allowed); sourceHash.update(accepted); gitHash.update(accepted); let offset = 0; while (offset < accepted.byteLength) { live(signal, deadline); const written = await file.write(accepted, offset, accepted.byteLength - offset); if (written.bytesWritten < 1) throw new Error('Settlement partial write made no progress'); offset += written.bytesWritten; } }
      if (allowed < chunk.byteLength) throw new RangeError('Settlement response exceeded its reserved network allowance');
    }
    return { bytes: measured, sourceSha: sourceHash.digest('hex'), gitBlobSha: gitHash.digest('hex') };
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (reader) {
      if (!eof) {
        const cancel = reader.cancel().catch(() => {});
        await Promise.race([cancel, new Promise<void>(resolve => setTimeout(resolve, 100))]);
      }
      if (pendingRead) { await Promise.race([pendingRead.then(() => undefined, () => undefined), new Promise(resolve => setTimeout(resolve, 100))]); }
      try { reader.releaseLock(); } catch { /* A hostile test stream may keep a pending read; it remains bounded by the request signal. */ }
    } else await cancelResponse(response);
    if (file) { try { await file.sync(); } finally { await file.close(); } }
  }
}
async function exists(filename: string): Promise<boolean> { try { await lstat(filename); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function writeImmutable(cacheRoot: string, target: string, data: Uint8Array, cap: number): Promise<void> {
  if (data.byteLength > cap) throw new RangeError('Settlement immutable asset exceeds its bound');
  const temp = path.join(cacheRoot, `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  try { await assertPathSafe(cacheRoot, target); await link(temp, target); await syncDir(cacheRoot); } finally { await unlink(temp).catch(() => {}); }
}
function verifyReceipt(value: unknown, identity: Identity, requestHash: string, spec: SettlementCaptureSpec, url: string, sha: string): void {
  const row = object(value, 'Settlement receipt'); const captured = row.evidence === 'exact-pinned-response-hash-verified';
  const common = ['schemaVersion','requestHash','requestIdentity','source','gitBlobSha1','networkBytes','observedHttpStatus','evidence'];
  const fields = captured ? [...common,'startedAt','completedAt'] : common;
  exactKeys(row, fields, 'Settlement receipt');
  if (row.schemaVersion !== 1 || row.requestHash !== requestHash || canonical(row.requestIdentity) !== canonical(identity) || row.gitBlobSha1 !== spec.expectedGitBlobSha1 || row.networkBytes !== (captured ? spec.expectedBytes : 0) || row.observedHttpStatus !== (captured ? 200 : null) || !captured && row.evidence !== 'verified-existing-git-blob-cache') throw new Error('Settlement receipt does not bind the frozen source/request');
  const source = object(row.source, 'Settlement receipt source'); exactKeys(source, ['id','url','release','license','attribution','sha256','bytes'], 'Settlement receipt source');
  if (source.id !== `natural-earth-places-10m-${spec.release}` || source.url !== url || source.release !== spec.release || source.license !== spec.license || source.attribution !== spec.attribution || source.sha256 !== sha || source.bytes !== spec.expectedBytes) throw new Error('Settlement receipt source identity or raw hash mismatch');
  if (captured && (typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt)) || typeof row.completedAt !== 'string' || !Number.isFinite(Date.parse(row.completedAt)) || Date.parse(row.completedAt) < Date.parse(row.startedAt))) throw new Error('Settlement captured receipt timestamps are invalid');
}

async function acquireLocked(spec: SettlementCaptureSpec, options: SettlementAcquisitionOptions, signal: AbortSignal, deadline: number): Promise<SettlementCaptureResult> {
  const root = options.repositoryRoot, buildRoot = path.join(root, '.cache', 'world-build'), cacheRoot = path.join(root, CACHE_REL);
  const rootReal = await realpath(root); if (rootReal !== root) throw new TypeError('Settlement repositoryRoot must be a canonical real directory');
  live(signal, deadline);
  const metadata = await verifyMetadata(spec, root); live(signal, deadline);
  const identity: Identity = { release: spec.release, path: ARTIFACT, blob: spec.expectedGitBlobSha1, expectedBytes: spec.expectedBytes };
  const requestHash = sha256(canonical(identity));
  await ensureDir(root, buildRoot); await ensureDir(root, cacheRoot);
  const inputRel = `${CACHE_REL}/${requestHash}.geojson`, receiptRel = `${CACHE_REL}/${requestHash}.receipt.json`;
  const inputPath = path.join(root, inputRel), receiptPath = path.join(root, receiptRel), auditPath = path.join(cacheRoot, 'network-audit.jsonl');
  const usage = await treeUsage(cacheRoot, signal, deadline); live(signal, deadline);
  const audit = await readAudit(auditPath); live(signal, deadline);
  const hasInput = await exists(inputPath), hasReceipt = await exists(receiptPath);
  if (!hasInput && hasReceipt) throw new Error('Settlement orphan receipt retained; source is absent');
  if (hasInput) {
    await assertPathSafe(root, inputPath); await assertPathSafe(root, receiptPath);
    const raw = await readBoundedLocalFile(inputPath, LIMITS.sourceBytes); live(signal, deadline);
    if (raw.length !== spec.expectedBytes || gitBlobSha1(raw) !== spec.expectedGitBlobSha1) throw new Error('Settlement cached source size/Git blob mismatch; retained without refetch');
    const rawSha = sha256(raw);
    if (hasReceipt) {
      const bytes = await readBoundedLocalFile(receiptPath, 16 * 1024); verifyReceipt(parseCanonical(bytes, 'Settlement receipt'), identity, requestHash, spec, metadata.url, rawSha);
    } else {
      const nextUsage = usage.bytes + 2 * LIMITS.reserveBytes;
      if (nextUsage > LIMITS.cacheBytes || usage.entries + 2 > LIMITS.scanEntries) throw new RangeError('Settlement cache lacks bounded receipt recovery capacity');
      const disk = await statfs(buildRoot); if (disk.bavail * disk.bsize < LIMITS.freeBytes + LIMITS.reserveBytes) throw new RangeError('Settlement receipt recovery requires 100 MiB free and atomic-write headroom');
      const receipt = receiptValue(spec, metadata.url, requestHash, identity, rawSha, 0, null, 'verified-existing-git-blob-cache');
      await writeImmutable(cacheRoot, receiptPath, Buffer.from(`${canonical(receipt)}\n`), 16 * 1024);
    }
    live(signal, deadline);
    return { source: sourceFor(spec, metadata.url, rawSha), input: inputRel, inputPath, receiptPath, cacheHit: true, networkBytes: 0, requestHash };
  }
  if (options.cacheOnly) throw new Error('Settlement cache-only source is absent');
  const attempts = audit.attempts.get(requestHash) ?? 0;
  if (attempts >= LIMITS.maxAttempts) throw new RangeError('Settlement immutable request reached its two-attempt limit');
  const reservation = spec.expectedBytes + LIMITS.overshootBytes;
  if (audit.charge + reservation > LIMITS.networkBytes) throw new RangeError('Settlement lifetime 64 MiB network allowance is exhausted');
  if (audit.rows.length + 2 > LIMITS.auditRecords || audit.bytes + 2 * LIMITS.recordBytes > LIMITS.auditBytes) throw new RangeError('Settlement audit lacks reserved start and terminal capacity');
  if (usage.entries + 5 > LIMITS.scanEntries || usage.bytes + 2 * reservation + 2 * LIMITS.recordBytes + 2 * 16 * 1024 > LIMITS.cacheBytes) throw new RangeError('Settlement cache lacks partial/source/receipt/audit headroom');
  const disk = await statfs(buildRoot); if (disk.bavail * disk.bsize < LIMITS.freeBytes + 2 * reservation + 2 * 16 * 1024 + 2 * LIMITS.recordBytes) throw new RangeError('Settlement capture requires 100 MiB free plus bounded source/temp/audit reserve');
  live(signal, deadline);
  const attemptId = randomUUID(), startedAt = new Date().toISOString(), partial = path.join(cacheRoot, `.${requestHash}.${attemptId}.partial`);
  const start: AuditStart = { schemaVersion: 1, requestHash, attemptId, event: 'started', status: 'pending', identity, reservedNetworkBytes: reservation, networkBytesMeasured: null, complete: false, startedAt };
  await appendAudit(cacheRoot, auditPath, start);
  let measured: number | null = null, complete = false, responseStatus: number | null = null, result: SettlementCaptureResult | undefined, primaryError: unknown;
  try {
    live(signal, deadline);
    let response: Response;
    try { response = await awaitWithSignal((options.fetcher ?? fetch)(metadata.url, { method: 'GET', redirect: 'manual', signal, headers: { 'accept-encoding': 'identity', accept: 'application/geo+json, application/json;q=0.9, text/plain;q=0.8' } }), signal); }
    catch (error) { throw error; }
    responseStatus = response.status;
    try { checkResponse(response, metadata.url, spec.expectedBytes); }
    catch (error) { await cancelResponse(response); throw error; }
    const stream = await consume(response, partial, signal, deadline, reservation, value => { measured = value; });
    measured = stream.bytes; complete = true;
    if (stream.bytes !== spec.expectedBytes || stream.gitBlobSha !== spec.expectedGitBlobSha1) throw new Error('Settlement source length or Git blob SHA-1 differs from the frozen pin');
    const raw = await readBoundedLocalFile(partial, LIMITS.sourceBytes); live(signal, deadline);
    const rawSha = sha256(raw); if (raw.length !== spec.expectedBytes || rawSha !== stream.sourceSha || gitBlobSha1(raw) !== spec.expectedGitBlobSha1) throw new Error('Settlement partial failed independent SHA/Git-blob verification');
    live(signal, deadline);
    await assertPathSafe(root, inputPath);
    try { await link(partial, inputPath); await syncDir(cacheRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Settlement immutable source publication collision; retained'); throw error; }
    const receipt = receiptValue(spec, metadata.url, requestHash, identity, rawSha, stream.bytes, responseStatus, 'exact-pinned-response-hash-verified', startedAt, new Date().toISOString());
    await writeImmutable(cacheRoot, receiptPath, Buffer.from(`${canonical(receipt)}\n`), 16 * 1024);
    await unlink(partial); await syncDir(cacheRoot); live(signal, deadline);
    result = { source: sourceFor(spec, metadata.url, rawSha), input: inputRel, inputPath, receiptPath, cacheHit: false, networkBytes: stream.bytes, requestHash };
  } catch (error) { primaryError = error; }
  const status: AuditFinish['status'] = primaryError === undefined ? 'success' : signal.aborted ? (performance.now() >= deadline ? 'timed-out' : 'aborted') : performance.now() >= deadline ? 'timed-out' : 'failure';
  const end: AuditFinish = status === 'success'
    ? { schemaVersion: 1, requestHash, attemptId, event: 'finished', status, identity, reservedNetworkBytes: measured ?? 0, networkBytesMeasured: measured, complete, startedAt, endedAt: new Date().toISOString(), sourceSha256: result!.source.sha256, sourceBytes: result!.source.bytes }
    : { schemaVersion: 1, requestHash, attemptId, event: 'finished', status, identity, reservedNetworkBytes: complete ? measured ?? 0 : Math.max(reservation, measured ?? 0), networkBytesMeasured: measured, complete, startedAt, endedAt: new Date().toISOString(), reason: errText(primaryError ?? signal.reason ?? 'settlement capture failed') };
  try { await appendAudit(cacheRoot, auditPath, end); }
  catch (auditError) { throw new AggregateError(primaryError === undefined ? [auditError] : [primaryError, auditError], `Settlement attempt evidence failed; inspect ${auditPath}`); }
  if (primaryError !== undefined) throw new Error(`${errText(primaryError)}; attempt evidence: ${auditPath}`, { cause: primaryError });
  if (!result) throw new Error(`Settlement capture produced no result; attempt evidence: ${auditPath}`);
  live(signal, deadline);
  return result;
}
function receiptValue(spec: SettlementCaptureSpec, url: string, requestHash: string, identity: Identity, rawSha: string, networkBytes: number, observedHttpStatus: number | null, evidence: string, startedAt?: string, completedAt?: string): Record<string, unknown> {
  return { schemaVersion: 1, requestHash, requestIdentity: identity, source: sourceFor(spec, url, rawSha), gitBlobSha1: spec.expectedGitBlobSha1, networkBytes, observedHttpStatus, evidence, ...(startedAt ? { startedAt, completedAt } : {}) };
}

/** Verify or capture only the reviewed commit-pinned Natural Earth populated-place artifact. */
export async function acquireSettlementSource(value: unknown, options: SettlementAcquisitionOptions): Promise<SettlementCaptureResult> {
  const spec = validateSettlementCaptureSpec(value), root = options.repositoryRoot;
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root) throw new TypeError('Settlement repositoryRoot must be canonical and absolute');
  const duration = options.durationMs ?? LIMITS.durationMs; if (!Number.isSafeInteger(duration) || duration < 1 || duration > LIMITS.durationMs) throw new RangeError('Settlement duration must be 1..120000 ms');
  const deadline = performance.now() + duration, deadlineController = new AbortController(), timer = setTimeout(() => deadlineController.abort(new Error('Settlement capture reached wall deadline')), duration); timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadlineController.signal]) : deadlineController.signal;
  const buildRoot = path.join(root, '.cache', 'world-build');
  try {
    const result = await withAcquisitionBuildLock(buildRoot, () => acquireLocked(spec, options, signal, deadline), { signal, timeoutMs: duration });
    live(signal, deadline);
    return result;
  } finally { clearTimeout(timer); }
}
