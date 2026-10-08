import { createHash, randomUUID } from 'node:crypto';
import { lstat, opendir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { readCountryDirectory } from './country-directory-reader.ts';
import { createOutputStore } from './storage.ts';
import { ADMIN1_LIMITS } from './admin1-types.ts';
import type { Admin1InspectionReport, Admin1InspectionResult, Admin1ParentPin, Admin1SourcePin } from './admin1-types.ts';
import type { InventoryNode } from './production-types.ts';
import type { SourceRecord } from './types.ts';

const HARD = Object.freeze({ durationMs: 120_000, reportBytes: 2 * 1024 * 1024, treeBytes: 8 * 1024 * 1024,
  treeEntries: 512, treeDepth: 5, auditBytes: 1024 * 1024, auditEntries: 128, auditRecordBytes: 8 * 1024,
  auditReserveBytes: 16 * 1024, freeBytes: 100 * 1024 * 1024, workerOldMb: 256, workerYoungMb: 32,
  rssBytes: 512 * 1024 * 1024, maxRows: 10_000, maxPositions: 3_000_000 });
const HEX64 = /^[a-f0-9]{64}$/; const HEX40 = /^[a-f0-9]{40}$/;
const INSPECTOR = 'natural-earth-admin1-structural-v1';
type WorkerReply = { ok: true; report: Admin1InspectionReport } | { ok: false; error: string };
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const blobSha = (bytes: Uint8Array): string => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('inspection contains a non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') { const row = value as Record<string, unknown>; return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`; }
  throw new TypeError('inspection result is not canonical JSON');
}
function inside(root: string, child: string): boolean { const rel = path.relative(root, child); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); }
function check(signal: AbortSignal, deadline: number): void { if (signal.aborted) throw signal.reason ?? new Error('Admin1 inspection aborted'); if (performance.now() >= deadline) throw new Error('Admin1 inspection exceeded its deadline'); }
async function safePath(target: string): Promise<void> {
  const absolute = path.resolve(target); let cursor = path.parse(absolute).root;
  const parts = absolute.slice(cursor.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) { cursor = path.join(cursor, parts[i]!); try { const info = await lstat(cursor); if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new Error(`Admin1 inspection path has unsafe ancestor: ${cursor}`); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; } }
}
async function treeUsage(root: string): Promise<{ bytes: number; entries: number }> {
  let bytes = 0, entries = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > HARD.treeDepth) throw new RangeError('Admin1 inspection tree exceeds depth 5');
    let st; try { st = await lstat(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && dir === root) return; throw error; }
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Admin1 inspection tree has an unsafe directory');
    const handle = await opendir(dir);
    for await (const entry of handle) {
      if (++entries > HARD.treeEntries) throw new RangeError('Admin1 inspection tree exceeds 512 entries');
      const file = path.join(dir, entry.name), info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('Admin1 inspection tree contains a symlink');
      if (info.isDirectory()) await walk(file, depth + 1); else if (info.isFile()) bytes += info.size; else throw new Error('Admin1 inspection tree contains a non-regular entry');
      if (bytes > HARD.treeBytes) throw new RangeError('Admin1 inspection tree exceeds 8 MiB');
    }
  };
  await walk(root, 0); return { bytes, entries };
}
function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
function exactObject(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== fields.length || Object.keys(object).some(key => !fields.includes(key))) throw new TypeError(`${label} has missing or unknown fields`);
  return object;
}
function validateReport(value: unknown, source: SourceRecord, parent: Admin1ParentPin, parentNodes: InventoryNode[]): Admin1InspectionReport {
  const report = exactObject(value, ['schemaVersion','inspector','source','parent','sourceUnits','sourcePositions','sourcePolygons','linked','protected','unlinked','ambiguous','geometryExceptions','largestFeatureBytes','largestFeaturePositions','countries','missingCountries','rows','limitations'], 'Admin1 inspection report');
  if (report.schemaVersion !== 1 || report.inspector !== INSPECTOR || !same(report.source, source) || !same(report.parent, { manifestHash: parent.manifestHash, source: parent.source })) throw new Error('Admin1 inspection report source/parent binding is invalid');
  const int = (key: string, max = Number.MAX_SAFE_INTEGER): number => { const n = report[key]; if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > max) throw new RangeError(`Admin1 inspection ${key} is outside bounds`); return n as number; };
  const units = int('sourceUnits', HARD.maxRows), positions = int('sourcePositions', HARD.maxPositions);
  const linked = int('linked', HARD.maxRows), protectedCount = int('protected', HARD.maxRows), unlinked = int('unlinked', HARD.maxRows), ambiguous = int('ambiguous', HARD.maxRows);
  const exceptions = int('geometryExceptions', HARD.maxRows), largestBytes = int('largestFeatureBytes', source.bytes), largestPositions = int('largestFeaturePositions', HARD.maxPositions);
  int('sourcePolygons', HARD.maxRows * 100);
  if (units < 1 || units !== linked + protectedCount + unlinked + ambiguous || !parentNodes.some(node => node.kind === 'country' && node.id === 'legacy-ng') || exceptions > units || largestBytes > source.bytes || largestPositions > positions) throw new Error('Admin1 inspection report counts do not conserve source and parent denominators');
  if (!Array.isArray(report.rows) || report.rows.length !== units) throw new Error('Admin1 inspection rows do not match source unit count');
  const ids = new Set<string>(), ordinals = new Set<number>();
  const parentCountries = new Set(parentNodes.filter(node => node.kind === 'country' && node.id !== 'legacy-ng').map(node => node.id));
  const tallies = new Map<string, number>(); let p = 0, polygons = 0, lc = 0, pc = 0, uc = 0, ac = 0, ge = 0, maxFeatureBytes = 0, maxFeaturePositions = 0, previousKey = '';
  for (let i = 0; i < report.rows.length; i++) {
    const row = exactObject(report.rows[i], ['sourceOrdinal','sourceKey','id','featureSha256','adm0Code','countryId','joinStatus','positions','polygons','featureBytes','propertiesBytes','geometryIssue'], 'Admin1 inspection row');
    if (!Number.isSafeInteger(row.sourceOrdinal) || (row.sourceOrdinal as number) < 0 || (row.sourceOrdinal as number) >= units || ordinals.has(row.sourceOrdinal as number) || typeof row.sourceKey !== 'string' || !/^NE_ID:[1-9][0-9]{0,15}$/.test(row.sourceKey) || !Number.isSafeInteger(Number(row.sourceKey.slice(6))) || String(Number(row.sourceKey.slice(6))) !== row.sourceKey.slice(6) || (previousKey !== '' && previousKey >= row.sourceKey) || typeof row.id !== 'string' || row.id !== `admin1:natural-earth:${encodeURIComponent(row.sourceKey)}` || ids.has(row.id) || typeof row.featureSha256 !== 'string' || !HEX64.test(row.featureSha256)) throw new Error('Admin1 inspection row identity is invalid or duplicated or unsorted');
    previousKey = row.sourceKey;
    ordinals.add(row.sourceOrdinal as number); ids.add(row.id);
    if (row.adm0Code !== null && (typeof row.adm0Code !== 'string' || row.adm0Code.length > 32) || row.countryId !== null && typeof row.countryId !== 'string') throw new TypeError('Admin1 inspection join fields are invalid');
    if (!['linked','protected','unlinked','ambiguous'].includes(String(row.joinStatus))) throw new TypeError('Admin1 inspection join status is invalid');
    for (const [key,max] of [['positions',ADMIN1_LIMITS.positions],['polygons',100_000],['featureBytes',source.bytes],['propertiesBytes',source.bytes]] as const) if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0 || (row[key] as number) > max) throw new RangeError(`Admin1 inspection row ${key} is outside bounds`);
    if (typeof row.geometryIssue !== 'string' && row.geometryIssue !== null) throw new TypeError('Admin1 geometry issue must be bounded text or null');
    if (typeof row.geometryIssue === 'string') { if (row.geometryIssue.length > 512) throw new RangeError('Admin1 geometry issue exceeds text limit'); ge++; }
    p += row.positions as number;
    polygons += row.polygons as number; maxFeatureBytes = Math.max(maxFeatureBytes, row.featureBytes as number); maxFeaturePositions = Math.max(maxFeaturePositions, row.positions as number);
    if (row.joinStatus === 'linked' && (typeof row.countryId !== 'string' || !parentCountries.has(row.countryId))) throw new Error('Admin1 linked row references a country outside the verified parent');
    if (row.joinStatus !== 'linked' && row.countryId !== null) throw new Error('Admin1 non-linked row must not publish a parent country binding');
    if (row.joinStatus === 'linked') tallies.set(row.countryId as string, (tallies.get(row.countryId as string) ?? 0) + 1);
    if (row.joinStatus === 'linked') lc++; else if (row.joinStatus === 'protected') pc++; else if (row.joinStatus === 'unlinked') uc++; else ac++;
  }
  if (ordinals.size !== units || p !== positions || polygons !== report.sourcePolygons || maxFeatureBytes !== largestBytes || maxFeaturePositions !== largestPositions || lc !== linked || pc !== protectedCount || uc !== unlinked || ac !== ambiguous || ge !== exceptions) throw new Error('Admin1 inspection row totals differ from report counters');
  if (!Array.isArray(report.countries) || report.countries.length > 10_000 || !Array.isArray(report.missingCountries) || report.missingCountries.length > 10_000 || !Array.isArray(report.limitations) || report.limitations.length > 100) throw new TypeError('Admin1 inspection country/limitation lists are invalid');
  const countryRows = new Set<string>();
  for (const country of report.countries) { const c = exactObject(country,['countryId','units'],'Admin1 country tally'); if (typeof c.countryId !== 'string' || !parentCountries.has(c.countryId) || countryRows.has(c.countryId) || !Number.isSafeInteger(c.units) || (c.units as number) < 1 || (c.units as number) > units || tallies.get(c.countryId) !== c.units) throw new TypeError('Admin1 country tally is invalid'); countryRows.add(c.countryId); }
  const missing = new Set<string>();
  for (const countryId of report.missingCountries) { if (typeof countryId !== 'string' || !parentCountries.has(countryId) || missing.has(countryId) || tallies.has(countryId)) throw new Error('Admin1 missing-country list is inconsistent'); missing.add(countryId); }
  if (countryRows.size + missing.size !== parentCountries.size || [...parentCountries].some(id => !countryRows.has(id) && !missing.has(id))) throw new Error('Admin1 country tallies and missing-country list do not conserve parent units');
  if (!Array.isArray(report.limitations) || report.limitations.length < 3 || !report.limitations.some(x => typeof x === 'string' && x.includes('Structural WGS84')) || !report.limitations.some(x => typeof x === 'string' && x.includes('legal boundary')) || !report.limitations.some(x => typeof x === 'string' && x.toLowerCase().includes('not playable'))) throw new Error('Admin1 report lacks structural, legal, and playability limitations');
  for (const value of [...report.missingCountries, ...report.limitations]) if (typeof value !== 'string' || value.length > 2_048) throw new TypeError('Admin1 inspection text list is invalid');
  return value as Admin1InspectionReport;
}
function copyBuffer(bytes: Uint8Array): ArrayBuffer { const out = new ArrayBuffer(bytes.byteLength); new Uint8Array(out).set(bytes); return out; }

async function runWorker(input: { source: SourceRecord; raw: ArrayBuffer; parent: { manifestHash: string; source: SourceRecord; raw: ArrayBuffer; nodes: InventoryNode[] } }, signal: AbortSignal, deadline: number, onWorkerOnline?: () => void): Promise<unknown> {
  if (process.memoryUsage().rss > HARD.rssBytes) throw new RangeError('Admin1 inspection process already exceeds 512 MiB RSS');
  const worker = new Worker(new URL('./admin1-inspect-worker.ts', import.meta.url), { workerData: input, transferList: [input.raw,input.parent.raw], resourceLimits: { maxOldGenerationSizeMb: HARD.workerOldMb, maxYoungGenerationSizeMb: HARD.workerYoungMb } });
  let exited = false, reply: WorkerReply | undefined, workerError: Error | undefined, terminateTask: Promise<void> | undefined;
  let resolveExit!: (code: number) => void; const exit = new Promise<number>(resolve => { resolveExit = resolve; });
  worker.on('message',(message:unknown)=>{ try { const row=exactObject(message,['ok',...(message && typeof message==='object' && 'report' in message ? ['report'] : ['error'])],'Admin1 worker reply'); if(row.ok===true&&'report'in row)reply=row as unknown as WorkerReply; else if(row.ok===false&&typeof row.error==='string'&&row.error.length<=2_000)reply=row as unknown as WorkerReply; else workerError=new Error('Admin1 worker reply is malformed'); } catch(error) { workerError=error instanceof Error?error:new Error(String(error)); } });
  worker.on('error',error=>{workerError=error;}); worker.on('exit',code=>{exited=true;resolveExit(code);});
  if(onWorkerOnline)worker.once('online',onWorkerOnline);
  const terminateAndWait=():Promise<void>=>terminateTask??=(async()=>{if(!exited)await worker.terminate();await exit;})();
  let rejectControl!:(error:Error)=>void; const controlled=new Promise<never>((_,reject)=>{rejectControl=reject;});
  const terminate=(reason:Error)=>{rejectControl(reason);void terminateAndWait();};
  const onAbort=()=>terminate(signal.reason instanceof Error?signal.reason:new Error('Admin1 inspection aborted'));
  const timer=setInterval(()=>{if(process.memoryUsage().rss>HARD.rssBytes)terminate(new RangeError('Admin1 inspection process RSS exceeded 512 MiB'));else if(performance.now()>=deadline)terminate(new Error('Admin1 inspection exceeded its deadline'));},100); timer.unref();
  signal.addEventListener('abort',onAbort,{once:true}); if(signal.aborted)onAbort();
  try { const code=await Promise.race([exit,controlled]); if(workerError)throw workerError; if(reply&&!reply.ok)throw new Error(reply.error); if(code!==0||!reply)throw new Error(`Admin1 inspection worker exited without a valid reply (code ${code})`); return reply.report; }
  finally { clearInterval(timer); signal.removeEventListener('abort',onAbort); if(!exited)await terminateAndWait(); }
}

export interface InspectAdmin1SourceOptions {
  repositoryRoot:string; sourcePin:Admin1SourcePin; parentPin:Admin1ParentPin; signal?:AbortSignal; durationMs?:number;
  /** Test seam: runs only after the actual worker has started. */ onWorkerOnline?: () => void;
}
/** Audit a fully pinned Natural Earth Admin1 source against the verified parent directory, without publishing geometry. */
export async function inspectAdmin1Source(options:InspectAdmin1SourceOptions):Promise<Admin1InspectionResult> {
  const started=Date.now(), startedMono=performance.now(), duration=options.durationMs??HARD.durationMs;
  if(!Number.isSafeInteger(duration)||duration<1||duration>HARD.durationMs)throw new RangeError('Admin1 inspection duration must be 1..120,000 ms');
  if(!path.isAbsolute(options.repositoryRoot)||path.resolve(options.repositoryRoot)!==options.repositoryRoot)throw new TypeError('repositoryRoot must be canonical and absolute');
  const root=options.repositoryRoot, buildRoot=path.join(root,'.cache','world-build'), deadline=startedMono+duration;
  const deadlineController=new AbortController(), timer=setTimeout(()=>deadlineController.abort(new Error('Admin1 inspection exceeded its deadline')),duration); timer.unref();
  const signal=options.signal?AbortSignal.any([options.signal,deadlineController.signal]):deadlineController.signal;
  let pendingStore:Awaited<ReturnType<typeof createOutputStore>>|undefined, attemptId:string|undefined, auditBase:Record<string,unknown>|undefined;
  try {
    await safePath(root); const rootInfo=await lstat(root); if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw new Error('repositoryRoot must be a real directory');
    const sourcePin=options.sourcePin,parentPin=options.parentPin;
    exactObject(sourcePin,['schemaVersion','source','input','gitBlobSha1'],'Admin1 source pin');
    exactObject(parentPin,['manifestHash','directoryRoot','source','input'],'Admin1 parent pin');
    const sourceRecord=(value:unknown,label:string):SourceRecord=>{
      const item=exactObject(value,['id','url','release','license','attribution','sha256','bytes'],label);
      if(typeof item.id!=='string'||!item.id||item.id.length>200||typeof item.url!=='string'||typeof item.release!=='string'||!HEX40.test(item.release)||typeof item.license!=='string'||!item.license||typeof item.attribution!=='string'||typeof item.sha256!=='string'||!HEX64.test(item.sha256)||!Number.isSafeInteger(item.bytes)||(item.bytes as number)<1||(item.bytes as number)>ADMIN1_LIMITS.sourceBytes)throw new TypeError(`${label} is invalid`);
      return item as unknown as SourceRecord;
    };
    const source=sourceRecord(sourcePin.source,'Admin1 source'), parentSource=sourceRecord(parentPin.source,'Admin1 parent source');
    if(sourcePin.schemaVersion!==1||!HEX40.test(sourcePin.gitBlobSha1)||typeof sourcePin.input!=='string')throw new TypeError('Admin1 source pin is invalid');
    if(!HEX64.test(parentPin.manifestHash)||parentPin.directoryRoot!=='.cache/world-build/output/country-inventory'||typeof parentPin.input!=='string')throw new TypeError('Admin1 parent pin is invalid');
    if(parentSource.bytes>ADMIN1_LIMITS.parentSourceBytes)throw new RangeError('Admin1 parent source exceeds its 16 MiB bound');
    if(source.release!==parentSource.release)throw new Error('Admin1 and parent pins must use the same full Natural Earth release');
    const sourcePath=path.resolve(root,sourcePin.input), parentPath=path.resolve(root,parentPin.input);
    for(const [input,file,folder] of [[sourcePin.input,sourcePath,'admin1-source-cache'],[parentPin.input,parentPath,'country-source-cache']] as const){
      if(path.isAbsolute(input)||path.normalize(input)!==input||path.relative(root,file)!==input||!inside(buildRoot,file)||path.dirname(file)!==path.join(buildRoot,folder)||!new RegExp(`^[a-f0-9]{64}\\.geojson$`).test(path.basename(file)))throw new Error('Admin1 pinned source path is not an exact canonical cache-relative file');
      await safePath(file);
    }
    check(signal,deadline);
    return await withAcquisitionBuildLock(buildRoot,async()=>{
      check(signal,deadline); await safePath(sourcePath); await safePath(parentPath);
      const raw=await readBoundedLocalFile(sourcePath,ADMIN1_LIMITS.sourceBytes);
      if(process.memoryUsage().rss>HARD.rssBytes)throw new RangeError('Admin1 inspection process exceeds 512 MiB RSS after source read');
      if(raw.length!==source.bytes||sha(raw)!==source.sha256||blobSha(raw)!==sourcePin.gitBlobSha1)throw new Error('Admin1 source bytes differ from SHA-256, Git blob SHA-1, or exact pin');
      const parentRaw=await readBoundedLocalFile(parentPath,ADMIN1_LIMITS.parentSourceBytes);
      if(process.memoryUsage().rss>HARD.rssBytes)throw new RangeError('Admin1 inspection process exceeds 512 MiB RSS after parent read');
      if(parentRaw.length!==parentSource.bytes||sha(parentRaw)!==parentSource.sha256)throw new Error('Admin1 parent bytes differ from exact parent source pin');
      const directoryRoot=path.resolve(root,parentPin.directoryRoot); await safePath(directoryRoot);
      const directory=await readCountryDirectory(directoryRoot,parentPin.manifestHash,signal);
      if(process.memoryUsage().rss>HARD.rssBytes)throw new RangeError('Admin1 inspection process exceeds 512 MiB RSS after directory verification');
      if(!same(directory.manifest.source,parentSource)||directory.manifest.source.release!==source.release)throw new Error('Admin1 parent pin differs from verified directory manifest or full release');
      check(signal,deadline);
      const inspectionRoot=path.join(buildRoot,'admin1-inspections'), reports=path.join(inspectionRoot,'reports'), attempts=path.join(inspectionRoot,'attempts'); await safePath(inspectionRoot);
      const usage=await treeUsage(inspectionRoot), auditUsage=await treeUsage(attempts), disk=await statfs(buildRoot);
      if(process.memoryUsage().rss>HARD.rssBytes)throw new RangeError('Admin1 inspection process exceeds 512 MiB RSS before worker launch');
      if(auditUsage.bytes+HARD.auditReserveBytes>HARD.auditBytes||auditUsage.entries+2>HARD.auditEntries)throw new RangeError('Admin1 inspection attempt ledger exceeds its 128-entry/1 MiB bound');
      if(disk.bavail*disk.bsize<HARD.freeBytes+HARD.reportBytes+HARD.auditReserveBytes)throw new RangeError('Admin1 inspection requires 100 MiB free plus report and audit allowances');
      if(usage.bytes+HARD.reportBytes+2*HARD.auditReserveBytes>HARD.treeBytes||usage.entries+6>HARD.treeEntries)throw new RangeError('Admin1 inspection report tree lacks reserved bounded capacity');
      const requestHash=sha(canonical({inspector:INSPECTOR,sourcePin,parentPin}));
      attemptId=randomUUID(); pendingStore=await createOutputStore(attempts,buildRoot);
      auditBase={schemaVersion:1,attemptId,requestHash,inspector:INSPECTOR,status:'pending',startedAt:new Date(started).toISOString(),sourceSha256:sourcePin.source.sha256,sourceBytes:raw.length,parentManifestHash:parentPin.manifestHash,parentSha256:parentPin.source.sha256,networkBytes:0};
      const pendingBytes=Buffer.from(`${canonical(auditBase)}\n`); if(pendingBytes.length>HARD.auditRecordBytes)throw new RangeError('Admin1 attempt audit exceeds 8 KiB');
      await pendingStore.writeImmutable(`${attemptId}.json`,pendingBytes);
      try {
        check(signal,deadline);
        const reportValue=await runWorker({source,raw:copyBuffer(raw),parent:{manifestHash:parentPin.manifestHash,source:parentSource,raw:copyBuffer(parentRaw),nodes:directory.nodes}},signal,deadline,options.onWorkerOnline);
        check(signal,deadline);
        const report=validateReport(reportValue,source,parentPin,directory.nodes);
        const bytes=Buffer.from(`${canonical(report)}\n`); if(bytes.length>HARD.reportBytes)throw new RangeError('Admin1 inspection report exceeds 2 MiB');
        const reportHash=sha(bytes), relative=`${requestHash}/${reportHash}.json`, store=await createOutputStore(reports,buildRoot);
        const reportPath=await store.writeImmutable(relative,bytes); check(signal,deadline);
        const result:Admin1InspectionResult={report,reportHash,reportPath,elapsedMs:Math.max(1,Math.floor(performance.now()-startedMono)),networkBytes:0};
        const final=Buffer.from(`${canonical({...auditBase,status:'succeeded',finishedAt:new Date().toISOString(),elapsedMs:result.elapsedMs,reportHash,reportPath:relative,networkBytes:0})}\n`);
        if(final.length>HARD.auditRecordBytes)throw new RangeError('Admin1 final attempt audit exceeds 8 KiB'); await pendingStore.writeAtomic(`${attemptId}.json`,final); return result;
      } catch(error) {
        const final=Buffer.from(`${canonical({...auditBase,status:options.signal?.aborted?'aborted':deadlineController.signal.aborted?'timed-out':'failed',finishedAt:new Date().toISOString(),elapsedMs:Math.max(1,Math.floor(performance.now()-startedMono)),error:errorText(error),networkBytes:0})}\n`);
        if(final.length>HARD.auditRecordBytes)throw new AggregateError([error], 'Admin1 failure could not fit its bounded terminal audit record');
        try{await pendingStore.writeAtomic(`${attemptId}.json`,final);}
        catch(auditError){throw new AggregateError([error,auditError],'Admin1 inspection failed and its terminal audit record could not be persisted');}
        throw error;
      }
    },{signal,timeoutMs:Math.max(1,Math.floor(deadline-performance.now()))});
  } finally { clearTimeout(timer); }
}
