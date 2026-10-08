import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, opendir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { acquireCountrySource, validateCountryCaptureSpec } from './country-acquire.ts';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { validateInventoryPin } from './bootstrap.ts';
import { createOutputStore } from './storage.ts';
import type { CountryCaptureSpec, CountryInspectionReport, CountryInspectionWorkerInput, CountryInspectionWorkerReply } from './country-types.ts';
import type { InventoryPin } from './bootstrap.ts';
import type { SourceRecord } from './types.ts';

const HARD = Object.freeze({ durationMs: 60_000, sourceBytes: 16 * 1024 * 1024, baselineBytes: 20_000_000,
  reportBytes: 256 * 1024, reportTreeBytes: 8 * 1024 * 1024, reportEntries: 512, auditBytes: 1024 * 1024,
  auditEntries: 128, auditRecordBytes: 8 * 1024, auditReserveBytes: 16 * 1024, freeBytes: 100 * 1024 * 1024, workerOldMb: 256, workerYoungMb: 32,
  processRssBytes: 512 * 1024 * 1024 });
const SHA = /^[a-f0-9]{64}$/;
const INSPECTOR = 'country-source-inspector-v1';
function sha(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function transferableCopy(bytes: Uint8Array): ArrayBuffer { const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); return buffer; }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('country inspection identity has a non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`; }
  throw new TypeError('country inspection value is not canonical JSON');
}
function inside(parent: string, child: string): boolean { const relative = path.relative(parent, child); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function errText(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 2_000); }
function check(signal: AbortSignal, deadline: number): void { if (signal.aborted) throw signal.reason ?? new Error('country inspection aborted'); if (Date.now() >= deadline) throw new Error('country inspection exceeded its 60-second deadline'); }
async function checkPath(target: string): Promise<void> {
  const resolved = path.resolve(target); let cursor = path.parse(resolved).root; const parts = resolved.slice(cursor.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) { cursor = path.join(cursor, parts[i]!); let info; try { info = await lstat(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new Error(`country inspection path contains a symlink or non-directory ancestor: ${cursor}`); }
}
async function boundedTree(root: string): Promise<{ bytes: number; entries: number }> {
  let entries = 0, bytes = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) throw new RangeError('country inspection tree exceeds depth 8');
    let info; try { info = await lstat(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && dir === root) return; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('country inspection tree has an unsafe directory');
    const handle = await opendir(dir);
    for await (const entry of handle) { if (++entries > HARD.reportEntries) throw new RangeError('country inspection tree exceeds 512 entries'); const file = path.join(dir, entry.name), child = await lstat(file);
      if (child.isSymbolicLink()) throw new Error('country inspection tree contains a symlink');
      if (child.isDirectory()) await walk(file, depth + 1); else if (child.isFile()) bytes += child.size; else throw new Error('country inspection tree contains a non-regular entry');
      if (bytes > HARD.reportTreeBytes) throw new RangeError('country inspection tree exceeds 8 MiB'); }
  };
  await walk(root, 0); return { bytes, entries };
}
function sourceEqual(actual: SourceRecord, expected: SourceRecord): boolean { return canonical(actual) === canonical(expected); }
function stringArray(value: unknown, max: number): value is string[] { return Array.isArray(value) && value.length <= max && value.every(x => typeof x === 'string' && x.length <= 2_048 && !/[\u0000-\u001f\u007f]/.test(x)); }
function validateReport(value: unknown, source: SourceRecord, baseline: SourceRecord, baselineUnits: number): CountryInspectionReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('country inspection report must be an object');
  const r = value as Record<string, unknown>;
  const fields = ['schemaVersion','inspector','source','baselineSource','sourceUnits','nodes','outlines','sourceCoordinatePositions','coordinatePositions','outlineBytes','largestOutlineBytes','outlineLimits','oversizedOutlines','identity','exceptions'];
  if (Object.keys(r).length !== fields.length || Object.keys(r).some(k => !fields.includes(k))) throw new TypeError('country inspection report has missing or unknown fields');
  if (r.schemaVersion !== 1 || r.inspector !== INSPECTOR || !sourceEqual(r.source as SourceRecord, source) || !sourceEqual(r.baselineSource as SourceRecord, baseline)) throw new Error('country inspection report source binding is invalid');
  for (const key of ['sourceUnits','nodes','outlines','sourceCoordinatePositions','coordinatePositions','outlineBytes','largestOutlineBytes']) if (!Number.isSafeInteger(r[key]) || (r[key] as number) < 0) throw new TypeError(`country inspection ${key} is invalid`);
  if ((r.sourceUnits as number) < 1 || (r.sourceUnits as number) > 10_000 || (r.nodes as number) < (r.sourceUnits as number) + 1 || (r.nodes as number) > 10_100 || (r.outlines as number) > 10_000
      || (r.outlines as number) + 1 !== (r.sourceUnits as number) || (r.sourceCoordinatePositions as number) < 1 || (r.coordinatePositions as number) < 1 || (r.coordinatePositions as number) > (r.sourceCoordinatePositions as number)
      || (r.largestOutlineBytes as number) > (r.outlineBytes as number)) throw new RangeError('country inspection report counts are inconsistent or exceed bounds');
  if (canonical(r.outlineLimits) !== canonical({ bytes: 512000, positions: 100000 })) throw new Error('country inspection outline limits changed');
  if (!Array.isArray(r.oversizedOutlines) || r.oversizedOutlines.length > (r.sourceUnits as number)) throw new TypeError('country oversized outline list is invalid');
  for (const row of r.oversizedOutlines) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('country oversized outline entry is invalid'); const o = row as Record<string, unknown>;
    if (Object.keys(o).length !== 4 || Object.keys(o).some(k => !['countryId','name','bytes','positions'].includes(k)) || typeof o.countryId !== 'string' || !o.countryId || typeof o.name !== 'string' || !Number.isSafeInteger(o.bytes) || !Number.isSafeInteger(o.positions) || (o.bytes as number) < 0 || (o.positions as number) < 0 || ((o.bytes as number) <= 512000 && (o.positions as number) <= 100000)) throw new TypeError('country oversized outline entry fields are invalid');
  }
  if (!stringArray(r.exceptions, 2_000) || !(r.exceptions as string[]).some(x => x.includes('Source coordinate positions include protected Nigeria')) || !(r.exceptions as string[]).some(x => x.includes('No country geometry or preview manifest is published'))) throw new Error('country inspection report lacks required scope exceptions');
  if (!r.identity || typeof r.identity !== 'object' || Array.isArray(r.identity)) throw new TypeError('country identity comparison is invalid');
  const identity = r.identity as Record<string, unknown>, keys = ['schemaVersion','baselineSourceId','candidateSourceId','baselineUnits','candidateUnits','retained','added','missing','protectedCountryId','exceptions'];
  if (Object.keys(identity).length !== keys.length || Object.keys(identity).some(k => !keys.includes(k)) || identity.schemaVersion !== 1 || identity.baselineSourceId !== baseline.id || identity.candidateSourceId !== source.id || identity.protectedCountryId !== 'legacy-ng') throw new Error('country identity comparison binding is invalid');
  if (!Number.isSafeInteger(identity.baselineUnits) || identity.baselineUnits !== baselineUnits || !Number.isSafeInteger(identity.candidateUnits) || identity.candidateUnits !== r.sourceUnits) throw new Error('country identity comparison counts are invalid');
  const list = (name: 'retained'|'added'|'missing', fields: string[]) => {
    const rows = identity[name]; if (!Array.isArray(rows) || rows.length > 10_000) throw new TypeError(`identity ${name} list is invalid`); const seen = new Set<string>(); let prior = '';
    for (const row of rows) { if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`identity ${name} entry is invalid`); const x = row as Record<string, unknown>;
      if (Object.keys(x).length !== fields.length || Object.keys(x).some(k => !fields.includes(k)) || typeof x.featureKey !== 'string' || !/^NE_ID:(0|-?[1-9][0-9]*)$/.test(x.featureKey)) throw new TypeError(`identity ${name} entry fields are invalid`);
      const num = Number(x.featureKey.slice(6)); if (!Number.isSafeInteger(num) || String(num) !== x.featureKey.slice(6)) throw new Error(`identity ${name} feature key is not a safe integer`);
      if (seen.has(x.featureKey) || (prior && prior >= x.featureKey)) throw new Error(`identity ${name} entries are duplicated or unsorted`); seen.add(x.featureKey); prior = x.featureKey;
      const expectedCountryId = `country:natural-earth:${encodeURIComponent(x.featureKey)}`;
      if (typeof x.countryId !== 'string' || (x.countryId !== expectedCountryId && x.countryId !== 'legacy-ng') || (name !== 'retained' && (typeof x.name !== 'string' || !x.name || x.name.length > 2_048)) || (name === 'retained' && (typeof x.baselineName !== 'string' || !x.baselineName || typeof x.candidateName !== 'string' || !x.candidateName || typeof x.metadataChanged !== 'boolean'))) throw new TypeError(`identity ${name} entry values are invalid`);
    } return rows.length;
  };
  const retained = list('retained',['featureKey','countryId','baselineName','candidateName','metadataChanged']);
  const added = list('added',['featureKey','countryId','name']); const missing = list('missing',['featureKey','countryId','name']);
  const allKeys = [identity.retained,identity.added,identity.missing].flatMap(rows => (rows as Array<{featureKey:string}>).map(row => row.featureKey));
  const candidateLegacy = [...identity.retained as Array<Record<string,unknown>>, ...identity.added as Array<Record<string,unknown>>].filter(row => row.countryId === 'legacy-ng').length;
  if (retained + missing !== identity.baselineUnits || retained + added !== identity.candidateUnits || new Set(allKeys).size !== allKeys.length
      || candidateLegacy !== 1 || (identity.missing as Array<Record<string,unknown>>).some(row => row.countryId === 'legacy-ng') || !stringArray(identity.exceptions,10_000)) throw new Error('country identity comparison does not conserve or protect its source identities');
  return value as CountryInspectionReport;
}

async function runWorker(input: CountryInspectionWorkerInput, signal: AbortSignal, deadline: number): Promise<CountryInspectionReport> {
  if (process.memoryUsage().rss > HARD.processRssBytes) throw new RangeError('country inspection parent already exceeds 512 MiB RSS');
  const transfer: ArrayBuffer[] = [input.rawBuffer, input.baselineBuffer];
  const worker = new Worker(new URL('./country-inspect-worker.ts', import.meta.url), { workerData: input, transferList: transfer,
    resourceLimits: { maxOldGenerationSizeMb: HARD.workerOldMb, maxYoungGenerationSizeMb: HARD.workerYoungMb } });
  let exited = false, reply: CountryInspectionWorkerReply | undefined, workerError: Error | undefined, terminatePromise: Promise<void> | undefined;
  let resolveExit!: (code: number) => void; const exit = new Promise<number>(resolve => { resolveExit = resolve; });
  worker.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) { workerError = new Error('country inspection worker reply is malformed'); return; }
    const row = message as Record<string, unknown>;
    if (row.ok === true && Object.keys(row).length === 2 && 'report' in row) reply = row as unknown as CountryInspectionWorkerReply;
    else if (row.ok === false && Object.keys(row).length === 2 && typeof row.error === 'string' && row.error.length <= 2_000) reply = row as unknown as CountryInspectionWorkerReply;
    else workerError = new Error('country inspection worker reply is malformed');
  });
  worker.on('error', error => { workerError = error; }); worker.on('exit', code => { exited = true; resolveExit(code); });
  const terminateAndWait = (): Promise<void> => terminatePromise ??= (async () => { if (!exited) await worker.terminate(); await exit; })();
  let rejectControl!: (error: Error) => void; const controlled = new Promise<never>((_, reject) => { rejectControl = reject; });
  const abort = () => { rejectControl(signal.reason instanceof Error ? signal.reason : new Error('country inspection aborted')); void terminateAndWait(); };
  const timer = setInterval(() => { if (process.memoryUsage().rss > HARD.processRssBytes) { rejectControl(new RangeError('country inspection parent RSS exceeded 512 MiB')); void terminateAndWait(); } if (Date.now() >= deadline) { rejectControl(new Error('country inspection exceeded its 60-second deadline')); void terminateAndWait(); } }, 100);
  timer.unref(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  try {
    const code = await Promise.race([exit, controlled]);
    if (workerError) throw workerError;
    if (code !== 0 || !reply) throw new Error(reply && !reply.ok ? reply.error : `country inspection worker exited without a valid reply (code ${code})`);
    if (!reply.ok) throw new Error(reply.error);
    return reply.report;
  } finally { clearInterval(timer); signal.removeEventListener('abort', abort); if (!exited) await terminateAndWait(); }
}

export interface InspectCountrySourceOptions { repositoryRoot: string; spec: CountryCaptureSpec; baselinePin: InventoryPin; signal?: AbortSignal; durationMs?: number }
export interface InspectCountrySourceResult { report: CountryInspectionReport; reportHash: string; reportPath: string; elapsedMs: number; networkBytes: 0 }

/** Inspect an already pinned and cached source without network access or preview publication. */
export async function inspectCountrySource(options: InspectCountrySourceOptions): Promise<InspectCountrySourceResult> {
  const started = Date.now(), duration = options.durationMs ?? HARD.durationMs;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > HARD.durationMs) throw new RangeError('country inspection duration must be 1..60,000 ms');
  if (!path.isAbsolute(options.repositoryRoot) || path.resolve(options.repositoryRoot) !== options.repositoryRoot) throw new TypeError('repositoryRoot must be canonical and absolute');
  const root = options.repositoryRoot, buildRoot = path.join(root,'.cache','world-build'), spec = validateCountryCaptureSpec(options.spec), pin = validateInventoryPin(options.baselinePin);
  const deadline = started + duration, deadlineController = new AbortController(), timer = setTimeout(() => deadlineController.abort(new Error('country inspection exceeded its 60-second deadline')), duration); timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadlineController.signal]) : deadlineController.signal;
  try {
    await checkPath(root); const rootStat = await lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('repositoryRoot must be a real directory');
    const basePath = path.resolve(root,pin.input); if (path.isAbsolute(pin.input) || path.normalize(pin.input) !== pin.input || path.relative(root,basePath) !== pin.input || !inside(buildRoot,basePath)) throw new Error('baseline source input must be a canonical relative path inside .cache/world-build');
    await checkPath(basePath);
    check(signal,deadline);
    const acquired = await acquireCountrySource(spec,{repositoryRoot:root,cacheOnly:true,signal,durationMs:Math.max(1,deadline-Date.now())});
    if (!acquired.cacheHit || acquired.networkBytes !== 0) throw new Error('country inspection requires a verified zero-network cache hit');
    const expectedSourcePath = path.resolve(root,acquired.input);
    if (expectedSourcePath !== acquired.inputPath || !inside(path.join(buildRoot,'country-source-cache'),expectedSourcePath)) throw new Error('country acquisition returned a source path outside its immutable cache');
    check(signal,deadline);
    return await withAcquisitionBuildLock(buildRoot,async () => {
      check(signal,deadline);
      await checkPath(expectedSourcePath); await checkPath(basePath);
      const capture = await readBoundedLocalFile(expectedSourcePath,HARD.sourceBytes);
      if (capture.length !== spec.expectedBytes || sha(capture) !== acquired.source.sha256 || capture.length !== acquired.source.bytes) throw new Error('cached country source differs from verified source bytes/hash');
      const baseline = await readBoundedLocalFile(basePath,HARD.baselineBytes);
      if (baseline.length !== pin.source.bytes || sha(baseline) !== pin.source.sha256) throw new Error('baseline source bytes differ from their exact inventory pin');
      check(signal,deadline);
      const inspectionsRoot = path.join(buildRoot,'country-inspections');
      const reportRoot = path.join(inspectionsRoot,'reports'); const auditRoot = path.join(inspectionsRoot,'attempts');
      await checkPath(inspectionsRoot);
      const tree = await boundedTree(inspectionsRoot); if (tree.bytes + HARD.reportBytes + HARD.auditReserveBytes > HARD.reportTreeBytes) throw new RangeError('country inspection tree lacks room for report and atomic audit allowances');
      const disk = await statfs(buildRoot); if (disk.bavail * disk.bsize < HARD.freeBytes + HARD.reportBytes) throw new RangeError('country inspection requires 100 MiB free reserve plus report allowance');
      const baselinePinHash = sha(canonical(pin));
      const requestHash = sha(canonical({ inspector:INSPECTOR,source:acquired.source,sourceRawSha256:sha(capture),baselinePinHash }));
      const auditUsage = await boundedTree(auditRoot); if (auditUsage.entries + 1 > HARD.auditEntries || auditUsage.bytes + HARD.auditReserveBytes > HARD.auditBytes) throw new RangeError('country inspection attempt audit exceeds 128 entries/1 MiB');
      if (tree.entries + 6 > HARD.reportEntries) throw new RangeError('country inspection tree lacks six entries for attempt, report path, and atomic temporaries');
      const attemptId = randomUUID(), store = await createOutputStore(auditRoot,buildRoot);
      const startedRecord = { schemaVersion:1,attemptId,requestHash,inspector:INSPECTOR,status:'pending',startedAt:new Date(started).toISOString(),sourceSha256:acquired.source.sha256,sourceBytes:capture.length,baselinePinHash,networkBytes:0 };
      const pendingBytes = Buffer.from(`${canonical(startedRecord)}\n`); if (pendingBytes.length > HARD.auditRecordBytes) throw new RangeError('country inspection attempt record exceeds 8 KiB');
      await store.writeImmutable(`${attemptId}.json`,pendingBytes);
      let finalStatus = 'failed', finalError: string | undefined;
      try {
        check(signal,deadline);
        const input: CountryInspectionWorkerInput = { source:acquired.source,rawBuffer:transferableCopy(capture),baselinePin:pin,baselineBuffer:transferableCopy(baseline) };
        const rawReport = await runWorker(input,signal,deadline); check(signal,deadline);
        const report = validateReport(rawReport,acquired.source,pin.source,pin.sourceFeatureCount);
        const reportBytes = Buffer.from(`${canonical(report)}\n`); if (reportBytes.length > HARD.reportBytes) throw new RangeError('country inspection report exceeds 256 KiB');
        const reportHash = sha(reportBytes), reportRelative = `${requestHash}/${reportHash}.json`;
        const reportStore = await createOutputStore(reportRoot,buildRoot); const reportPath = await reportStore.writeImmutable(`${requestHash}/${reportHash}.json`,reportBytes);
        check(signal,deadline);
        const result = { report,reportHash,reportPath,elapsedMs:Math.max(1,Date.now()-started),networkBytes:0 as const };
        const finalBytes = Buffer.from(`${canonical({...startedRecord,status:'succeeded',finishedAt:new Date().toISOString(),elapsedMs:result.elapsedMs,reportHash,reportPath:reportRelative,networkBytes:0})}\n`);
        if (finalBytes.length > HARD.auditRecordBytes) throw new RangeError('country inspection final attempt record exceeds 8 KiB'); await store.writeAtomic(`${attemptId}.json`,finalBytes);
        finalStatus = 'succeeded';
        return result;
      } catch (error) { finalError = errText(error); throw error; }
      finally {
        if (finalStatus !== 'succeeded') {
          const status = options.signal?.aborted ? 'aborted' : deadlineController.signal.aborted ? 'timed-out' : 'failed';
          const finalBytes = Buffer.from(`${canonical({...startedRecord,status,finishedAt:new Date().toISOString(),elapsedMs:Math.max(1,Date.now()-started),error:finalError ?? 'inspection did not complete',networkBytes:0})}\n`);
          if (finalBytes.length <= HARD.auditRecordBytes) await store.writeAtomic(`${attemptId}.json`,finalBytes);
        }
      }
    },{signal,timeoutMs:Math.max(1,deadline-Date.now())});
  } finally { clearTimeout(timer); }
}
