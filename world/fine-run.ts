import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, rename, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { readBoundedLocalFile, readCoarseInventoryCountry } from './inventory-reader.ts';
import type { InventoryNode } from './production-types.ts';
import { withAcquisitionBuildLock } from './acquire.ts';
import { validateFineSourcePin } from './fine.ts';
import { validateFineTopologyReport } from './fine-quality.ts';
import { FINE_LIMITS, type FineIdentityMigration, type FineIdentityRegistry, type FineSourcePin, type FineTopologyReport } from './fine-types.ts';

const HARD = Object.freeze({ durationMs: 120_000, processRssBytes: 512 * 1024 * 1024, freeBytes: 100 * 1024 * 1024, outputReserveBytes: FINE_LIMITS.publishedBytes, fineTreeBytes: 40 * 1024 * 1024, workerOldMb: 256, workerYoungMb: 32, auditRecordBytes: 8 * 1024, auditReplacementReserveBytes: 16 * 1024 });
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_AUDIT_ERROR = 2_000;
const FINE_COMPILER = 'fine-inventory-compiler-v2';
const TOPOLOGY_VALIDATOR = 'duckdb-spatial-ogc-planar-v1';
const TOPOLOGY_SPATIAL_SHA256 = 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';

export interface FineBuildOptions {
  repositoryRoot: string;
  coarseInventoryHash: string;
  pin: FineSourcePin;
  topologyReportPath: string;
  previousRegistryPath?: string;
  migrationPath?: string;
  signal?: AbortSignal;
  durationMs?: number;
}
export interface FineBuildResult { manifestHash: string; manifestPath: string; bytes: number; units: number; elapsedMs: number; networkBytes: 0 }
interface Published { manifestHash: string; manifestPath: string; bytes: number; units: number }
interface WorkerReply { ok: boolean; result?: Published; error?: string }

function assertPathText(value: string, label: string): void {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) throw new TypeError(`${label} must be a non-empty filesystem path`);
}
function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function inspectAncestors(targetValue: string): Promise<void> {
  const target = path.resolve(targetValue), root = path.parse(target).root;
  let cursor = root;
  const parts = target.slice(root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]!);
    let info;
    try { info = await lstat(cursor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new Error(`fine-run path contains a symlink or non-directory ancestor: ${cursor}`);
  }
}
async function ensureDirectoryChain(targetValue: string, repoRoot: string): Promise<void> {
  const target = path.resolve(targetValue);
  if (target !== repoRoot && !within(repoRoot, target)) throw new Error('fine-run directory escapes repository root');
  const root = path.parse(target).root;
  let cursor = root;
  const parts = target.slice(root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`fine-run directory is unsafe: ${cursor}`);
  }
}
async function assertCanonicalRepoRoot(value: string): Promise<string> {
  assertPathText(value, 'repositoryRoot');
  if (!path.isAbsolute(value)) throw new TypeError('repositoryRoot must be absolute');
  const root = path.resolve(value);
  await inspectAncestors(root);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('repositoryRoot must be a real directory without symlink ancestors');
  return root;
}
function resolveBuildLocalPath(value: string, repoRoot: string, buildRoot: string, label: string): string {
  assertPathText(value, label);
  const target = path.resolve(repoRoot, value);
  if (!within(buildRoot, target)) throw new Error(`${label} must be inside .cache/world-build`);
  return target;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('fine run identity has a non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new TypeError('fine run identity is not JSON data');
}
function compareCodepoints(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!);
  const b = Array.from(right, character => character.codePointAt(0)!);
  for (let index=0;index<Math.min(a.length,b.length);index++) if(a[index]!==b[index]) return a[index]!-b[index]!;
  return a.length-b.length;
}
function expectedTopologyKeys(rawBytes: Uint8Array, pin: FineSourcePin): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)) as unknown; }
  catch (error) { throw new TypeError(`cached fine source is invalid UTF-8 or JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('cached fine source must be a GeoJSON FeatureCollection');
  const collection=parsed as Record<string,unknown>;
  if(collection.type!=='FeatureCollection'||!Array.isArray(collection.features)||collection.features.length!==pin.expectedUnits||collection.features.length>FINE_LIMITS.units) throw new Error('cached fine source feature count differs from pin');
  const keys:string[]=[];
  for(const [index,raw] of collection.features.entries()){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError(`fine source feature ${index} must be an object`);
    const feature=raw as Record<string,unknown>,properties=feature.properties;
    if(feature.type!=='Feature'||!properties||typeof properties!=='object'||Array.isArray(properties))throw new TypeError(`fine source feature ${index} is malformed`);
    const props=properties as Record<string,unknown>;
    if(props.shapeGroup!==pin.countryIso3||props.shapeType!==pin.adminLevel)throw new Error(`fine source feature ${index} does not match pinned country/admin level`);
    if(typeof props.shapeID!=='string'||!props.shapeID.trim()||props.shapeID.length>256||/[\u0000-\u001f\u007f]/.test(props.shapeID))throw new TypeError(`fine source feature ${index} key is invalid`);
    keys.push(props.shapeID);
  }
  if(new Set(keys).size!==keys.length)throw new Error('cached fine source contains duplicate feature keys');
  return keys.sort(compareCodepoints);
}
function topologyRequestHash(pin: FineSourcePin, expectedKeys: readonly string[]): string {
  return createHash('sha256').update(canonical({ validator:TOPOLOGY_VALIDATOR,sourceSha256:pin.source.sha256,sourceBytes:pin.source.bytes,
    expectedUnits:pin.expectedUnits,expectedKeys:[...expectedKeys],spatialSha256:TOPOLOGY_SPATIAL_SHA256 })).digest('hex');
}
function topologyReportComponents(reportPath: string, reportsRoot: string): { reportHash:string } {
  const relative=path.relative(reportsRoot,reportPath).split(path.sep);
  if(relative.length!==2||!/^[a-f0-9]{64}$/.test(relative[0]??'')||!/^([a-f0-9]{64})\.json$/.test(relative[1]??'')) throw new Error('topologyReportPath must be reports/<requestHash>/<reportHash>.json under .cache/world-build/fine-topology');
  return {reportHash:relative[1]!.slice(0,-5)};
}
async function readTopologyReport(reportPath:string,expectedRequestHash:string,reportHash:string,pin:FineSourcePin,keys:readonly string[]):Promise<FineTopologyReport>{
  const relative=path.relative(path.dirname(path.dirname(reportPath)),reportPath).split(path.sep);
  if(relative.length!==2||relative[0]!==expectedRequestHash||relative[1]!==`${reportHash}.json`)throw new Error('topology report request directory does not match the pinned source/key/tool request hash');
  const bytes=await readBoundedLocalFile(reportPath,64*1024);
  if(createHash('sha256').update(bytes).digest('hex')!==reportHash)throw new Error('topology report bytes do not match their immutable reportHash filename');
  let parsed:unknown;
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
  catch(error){throw new TypeError(`topology report is invalid UTF-8 or JSON: ${error instanceof Error?error.message:String(error)}`);}
  const report=validateFineTopologyReport(parsed,pin,keys);
  if(report.checkedUnits!==pin.expectedUnits||report.validUnits!==pin.expectedUnits||report.invalidUnits!==0||report.unsupportedUnits!==0)throw new Error('fine publication requires all-valid topology evidence for every source unit');
  return report;
}
function parseBoundedJson<T>(bytes: Uint8Array, label: string): T {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) as T; }
  catch (error) { throw new TypeError(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
async function treeBytes(directory: string, stopAbove: number): Promise<number> {
  let entries = 0;
  const walk = async (current: string, depth: number): Promise<number> => {
    if (depth > 8) throw new RangeError('fine output subtree exceeds its depth-8 traversal cap');
    let info;
    try { info = await lstat(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && current === directory) return 0; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`fine output subtree contains a symlink or non-directory: ${current}`);
    let total = 0;
    const handle = await opendir(current);
    for await (const entry of handle) {
      if (++entries > 4_096) throw new RangeError('fine output subtree exceeds its 4,096-entry traversal cap');
      const filename = path.join(current, entry.name), child = await lstat(filename);
      if (child.isSymbolicLink()) throw new Error(`fine output subtree contains a symlink: ${filename}`);
      if (child.isDirectory()) total += await walk(filename, depth + 1);
      else if (child.isFile()) total += child.size;
      else throw new Error(`fine output subtree contains a non-regular entry: ${filename}`);
      if (total > stopAbove) throw new RangeError('fine output subtree already exceeds its 40 MiB cumulative cap');
    }
    return total;
  };
  return walk(directory, 0);
}
async function preflightBudgets(buildRoot: string): Promise<void> {
  const disk = await statfs(buildRoot);
  const requiredFree = HARD.freeBytes + HARD.outputReserveBytes;
  if (disk.bavail * disk.bsize < requiredFree) throw new RangeError('fine build requires 100 MiB free reserve plus the maximum 16 MiB output allowance');
  const current = await treeBytes(path.join(buildRoot, 'output', 'fine'), HARD.fineTreeBytes);
  if (current + HARD.outputReserveBytes > HARD.fineTreeBytes) throw new RangeError('fine output subtree requires room for a maximum 16 MiB publication within its 40 MiB cumulative cap');
}
async function auditUsage(directory: string): Promise<{ entries: number; bytes: number }> {
  let entries = 0, bytes = 0;
  const handle = await opendir(directory);
  for await (const item of handle) {
    const filename = path.join(directory, item.name), info = await lstat(filename);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('fine attempt audit contains an unsafe entry');
    entries += 1; bytes += info.size;
    if (entries > 512 || bytes > 2 * 1024 * 1024) throw new RangeError('fine attempt audit exceeds its 512-entry / 2 MiB cap');
  }
  return { entries, bytes };
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeAttempt(filename: string, record: Record<string, unknown>, create: boolean): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
  if (bytes.byteLength > HARD.auditRecordBytes) throw new RangeError('fine attempt audit record exceeds its 8 KiB cap');
  if (create) {
    const handle = await open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(path.dirname(filename));
    return;
  }
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    await inspectAncestors(filename);
    const current = await lstat(filename);
    if (current.isSymbolicLink() || !current.isFile()) throw new Error('fine attempt audit target was replaced or is unsafe');
    await rename(temporary, filename);
    await syncDirectory(path.dirname(filename));
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
function makeError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value) return new Error(value);
  return new Error(fallback);
}

async function runWorker(data: {
  pin: FineSourcePin; rawBytes: Uint8Array; coarseCountry: InventoryNode; coarseInventoryHash: string;
  topologyReport:FineTopologyReport; previousRegistry?: FineIdentityRegistry; migration?: FineIdentityMigration; buildRoot: string; outputRoot: string;
}, signal: AbortSignal, onOnline?: () => Promise<void>): Promise<Published> {
  if (process.memoryUsage().rss > HARD.processRssBytes) throw new RangeError('fine runner process RSS already exceeds 512 MiB');
  const transferable = Uint8Array.from(data.rawBytes);
  const worker = new Worker(new URL('./fine-worker.ts', import.meta.url), {
    workerData: {
      pin: data.pin, rawBuffer: transferable.buffer, coarseCountry: data.coarseCountry, coarseInventoryHash: data.coarseInventoryHash,
      topologyReport:data.topologyReport,
      ...(data.previousRegistry ? { previousRegistry: data.previousRegistry } : {}), ...(data.migration ? { migration: data.migration } : {}),
      buildRoot: data.buildRoot, outputRoot: data.outputRoot,
    },
    transferList: [transferable.buffer],
    resourceLimits: { maxOldGenerationSizeMb: HARD.workerOldMb, maxYoungGenerationSizeMb: HARD.workerYoungMb },
    execArgv: ['--experimental-strip-types'],
  });
  const state: { reply: WorkerReply | null; workerError: Error | null } = { reply: null, workerError: null };
  let exited = false;
  const startupAudit: { promise: Promise<void> | null } = { promise: null };
  let terminatePromise: Promise<number> | null = null;
  const exit = new Promise<number>((resolve) => {
    worker.once('message', (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const row = value as Record<string, unknown>;
      const keys = Object.keys(row);
      if (keys.some(key => !['ok', 'result', 'error'].includes(key)) || typeof row.ok !== 'boolean'
        || (row.ok === true && (keys.length !== 2 || !keys.includes('result') || keys.includes('error')))
        || (row.ok === false && (keys.length !== 2 || !keys.includes('error') || keys.includes('result')))) {
        state.workerError = new Error('fine worker returned a malformed reply'); return;
      }
      if (row.ok === true) {
        const result = row.result;
        if (!result || typeof result !== 'object' || Array.isArray(result)) { state.workerError = new Error('fine worker result is malformed'); return; }
        const published = result as Record<string, unknown>;
        if (Object.keys(published).length !== 4 || Object.keys(published).some(key => !['manifestHash', 'manifestPath', 'bytes', 'units'].includes(key))
          || typeof published.manifestHash !== 'string' || typeof published.manifestPath !== 'string'
          || !Number.isSafeInteger(published.bytes) || (published.bytes as number) < 1 || !Number.isSafeInteger(published.units) || (published.units as number) < 1) {
          state.workerError = new Error('fine worker result fields are invalid'); return;
        }
        state.reply = { ok: true, result: published as unknown as Published };
      } else if (typeof row.error === 'string' && row.error.length <= MAX_AUDIT_ERROR) state.reply = { ok: false, error: row.error };
      else state.workerError = new Error('fine worker failure reply is malformed');
    });
    worker.once('error', error => { state.workerError = error; });
    worker.once('exit', code => { exited = true; resolve(code); });
  });
  const terminateAndWait = (): Promise<number> => {
    if (!terminatePromise) terminatePromise = (async () => {
      const code = exited ? await exit : await worker.terminate();
      return exited ? code : await exit;
    })();
    return terminatePromise;
  };
  let rejectControl!: (error: Error) => void;
  const controlled = new Promise<never>((_, reject) => { rejectControl = reject; });
  const abortListener = () => {
    rejectControl(makeError(signal.reason, 'fine build was aborted'));
    void terminateAndWait();
  };
  worker.once('online', () => {
    if (!onOnline) return;
    startupAudit.promise = onOnline();
    void startupAudit.promise.catch(error => {
      state.workerError = makeError(error, 'could not record fine worker start');
      rejectControl(state.workerError);
      void terminateAndWait();
    });
  });
  const rssPoll = setInterval(() => {
    if (process.memoryUsage().rss > HARD.processRssBytes) {
      rejectControl(new RangeError('fine runner process RSS exceeded 512 MiB'));
      void terminateAndWait();
    }
  }, 100);
  signal.addEventListener('abort', abortListener, { once: true });
  if (signal.aborted) abortListener();
  try {
    const code = await Promise.race([exit, controlled]);
    if (startupAudit.promise) await startupAudit.promise;
    if (code !== 0) throw state.workerError ?? new Error(state.reply?.ok === false ? state.reply.error : `fine worker exited with code ${code}`);
    if (state.workerError) throw state.workerError;
    if (!state.reply?.ok || !state.reply.result) throw new Error(state.reply?.error ?? 'fine worker exited without a published result');
    return state.reply.result;
  } finally {
    clearInterval(rssPoll);
    signal.removeEventListener('abort', abortListener);
    if (!exited) await terminateAndWait();
    if (startupAudit.promise) await startupAudit.promise.catch(() => {});
  }
}

/** Build from an already cached, exact-pinned fine source. This runner never accesses the network. */
export async function runFineBuild(options: FineBuildOptions): Promise<FineBuildResult> {
  const started = Date.now();
  const durationMs = options.durationMs ?? HARD.durationMs;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > HARD.durationMs) throw new RangeError('fine run duration must be between 1 and 120,000 ms');
  if (!SHA256.test(options.coarseInventoryHash)) throw new TypeError('coarseInventoryHash must be a lowercase SHA-256 hash');
  const deadlineAt = started + durationMs, deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(new Error('fine build exceeded 120-second wall cap')), durationMs);
  deadlineTimer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  let attemptPath: string | null = null;
  let attemptRecord: Record<string, unknown> | null = null;
  try {
    const repoRoot = await assertCanonicalRepoRoot(options.repositoryRoot);
    const buildRoot = path.join(repoRoot, '.cache', 'world-build');
    const pin = validateFineSourcePin(options.pin);
    const sourcePath = resolveBuildLocalPath(pin.input, repoRoot, buildRoot, 'fine source input');
    const topologyReportPath = resolveBuildLocalPath(options.topologyReportPath, repoRoot, buildRoot, 'topologyReportPath');
    const topologyReportsRoot = path.join(buildRoot,'fine-topology','reports');
    const {reportHash:topologyReportHash}=topologyReportComponents(topologyReportPath,topologyReportsRoot);
    const registryPath = options.previousRegistryPath ? resolveBuildLocalPath(options.previousRegistryPath, repoRoot, buildRoot, 'previousRegistryPath') : undefined;
    const migrationPath = options.migrationPath ? resolveBuildLocalPath(options.migrationPath, repoRoot, buildRoot, 'migrationPath') : undefined;
    if (migrationPath && !registryPath) throw new Error('migrationPath requires previousRegistryPath');
    const outputRoot = path.join(buildRoot, 'output', 'fine', pin.countryCode.toLowerCase(), 'adm1');
    const attemptDirectory = path.join(buildRoot, 'fine-attempts');
    await inspectAncestors(buildRoot); await inspectAncestors(sourcePath); await inspectAncestors(attemptDirectory);
    await inspectAncestors(topologyReportPath);
    if (registryPath) await inspectAncestors(registryPath);
    if (migrationPath) await inspectAncestors(migrationPath);

    const result = await withAcquisitionBuildLock(buildRoot, async () => {
      if (signal.aborted || Date.now() >= deadlineAt) throw makeError(signal.reason, 'fine build deadline elapsed while waiting for shared build lock');
      await ensureDirectoryChain(attemptDirectory, repoRoot);
      const usage = await auditUsage(attemptDirectory);
      const registryBytes = registryPath ? await readBoundedLocalFile(registryPath, 128 * 1024) : undefined;
      const migrationBytes = migrationPath ? await readBoundedLocalFile(migrationPath, 128 * 1024) : undefined;
      const previousRegistry = registryBytes ? parseBoundedJson<FineIdentityRegistry>(registryBytes, 'previous identity registry') : undefined;
      const migration = migrationBytes ? parseBoundedJson<FineIdentityMigration>(migrationBytes, 'identity migration') : undefined;
      if (signal.aborted) throw makeError(signal.reason, 'fine build was aborted');
      const registryHash = registryBytes ? createHash('sha256').update(registryBytes).digest('hex') : null;
      const migrationHash = migrationBytes ? createHash('sha256').update(migrationBytes).digest('hex') : null;
      const requestHash = createHash('sha256').update(canonical({
        compiler: FINE_COMPILER, coarseInventoryHash: options.coarseInventoryHash, pin,
        previousRegistryHash: registryHash, migrationHash, topologyReportHash,
      })).digest('hex');
      const attemptId = randomUUID();
      attemptPath = path.join(attemptDirectory, `${attemptId}.json`);
      attemptRecord = { schemaVersion: 1, attemptId, requestHash, compiler: FINE_COMPILER, status: 'pending', startedAt: new Date(started).toISOString(), countryCode: pin.countryCode, coarseInventoryHash: options.coarseInventoryHash, sourceHash: pin.source.sha256, topologyReportHash, previousRegistryHash: registryHash, migrationHash, networkBytes: 0 };
      if (usage.entries + 1 > 512 || usage.bytes + HARD.auditReplacementReserveBytes > 2 * 1024 * 1024) throw new RangeError('fine attempt audit has no capacity for another bounded attempt');
      await writeAttempt(attemptPath, attemptRecord, true);
      try {
      await inspectAncestors(sourcePath); await inspectAncestors(outputRoot);
      await preflightBudgets(buildRoot);
      const rawBytes = await readBoundedLocalFile(sourcePath, FINE_LIMITS.sourceBytes);
      if (rawBytes.byteLength !== pin.source.bytes || createHash('sha256').update(rawBytes).digest('hex')!==pin.source.sha256) throw new Error('cached fine source bytes differ from their immutable length and SHA-256 pin');
      const sourceKeys=expectedTopologyKeys(rawBytes,pin);
      const expectedTopologyRequestHash=topologyRequestHash(pin,sourceKeys);
      const topologyReport=await readTopologyReport(topologyReportPath,expectedTopologyRequestHash,topologyReportHash,pin,sourceKeys);
      const coarseCountry = await readCoarseInventoryCountry(path.join(buildRoot, 'output', 'inventory'), options.coarseInventoryHash, pin.countryCode);
      if (signal.aborted) throw makeError(signal.reason, 'fine build was aborted');
      const published = await runWorker({ pin, rawBytes, coarseCountry, coarseInventoryHash: options.coarseInventoryHash,
        topologyReport,
        ...(previousRegistry ? { previousRegistry } : {}), ...(migration ? { migration } : {}), buildRoot, outputRoot }, signal, async () => {
          attemptRecord = { ...attemptRecord!, status: 'running', workerStartedAt: new Date().toISOString() };
          await writeAttempt(attemptPath!, attemptRecord, false);
        });
      if (signal.aborted || Date.now() > deadlineAt) throw makeError(signal.reason, 'fine build deadline elapsed');
      if (!SHA256.test(published.manifestHash) || published.units !== pin.expectedUnits || published.bytes < 1 || published.bytes > FINE_LIMITS.publishedBytes) throw new Error('fine worker result violates the pinned hash, unit, or byte limits');
      const expectedManifestPath = path.join(outputRoot, 'manifests', `${published.manifestHash}.json`);
      if (path.resolve(published.manifestPath) !== expectedManifestPath) throw new Error('fine worker returned a manifest path outside the country output directory');
      const manifestBytes = await readBoundedLocalFile(expectedManifestPath, 128 * 1024);
      if (createHash('sha256').update(manifestBytes).digest('hex') !== published.manifestHash) throw new Error('published fine manifest hash does not match its path');
      await treeBytes(path.join(buildRoot, 'output', 'fine'), HARD.fineTreeBytes);
      const elapsedMs = Math.max(1, Date.now() - started);
      await writeAttempt(attemptPath!, { ...attemptRecord!, status: 'succeeded', finishedAt: new Date().toISOString(), elapsedMs, manifestHash: published.manifestHash, bytes: published.bytes, units: published.units }, false);
      return { ...published, elapsedMs, networkBytes: 0 as const };
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_AUDIT_ERROR);
        const status = options.signal?.aborted ? 'aborted' : deadline.signal.aborted ? 'timed-out' : 'failed';
        await writeAttempt(attemptPath!, { ...attemptRecord!, status, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started, error: message }, false);
        throw error;
      }
    }, { signal, timeoutMs: Math.max(1, deadlineAt - Date.now()) });
    return result;
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
  }
}
