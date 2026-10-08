import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AcquisitionOptions, AcquisitionRequest, AcquisitionResult } from './production-types.ts';
import type { Region, SourceRecord } from './types.ts';
import type { WorldPlan } from './pipeline.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(HERE, 'acquisition-sources.json');
const ADAPTER_PATH = path.join(HERE, 'tooling', 'acquire.py');
const COMPILER = 'world-source-compiler-v2';
const HARD = Object.freeze({ networkBytes: 32_000_000, outputBytes: 20_000_000, features: 50_000, durationMs: 15 * 60_000, memoryMb: 2_048, diskBytes: 256_000_000 });
const ATTEMPT_FILE_BYTES=1_000_000, ATTEMPT_RECORD_BYTES=16_000, MAX_ATTEMPTS=100;
const BUILD_LOCK_WAIT_MS=20*60_000, BUILD_LOCK_POLL_MS=100, MAX_BUILD_LOCK_WAIT_MS=48*60*60_000;
const SHA = /^[a-f0-9]{64}$/;
class CacheBudgetError extends Error {}

type SourceConfig = { schemaVersion: 1; provider: 'overture'; release: string; releaseStatus: string; stac: { baseUrl: string; collections: Record<string,string> }; licenses: Record<string,string>; attribution: string };
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: object, keys: string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`unknown ${label} field: ${key}`);
}
function safeText(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} must be a non-empty bounded string`);
  return value;
}
function positive(value: unknown, label: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`${label} must be a positive integer no greater than ${maximum}`);
  return value;
}
function validateBounds(v: unknown): [number,number,number,number] {
  if (!Array.isArray(v) || v.length !== 4 || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new TypeError('region.bounds must be four finite numbers');
  const [w,s,e,n] = v as number[];
  if (w! < -180 || w! > 180 || e! < -180 || e! > 180 || s! < -90 || s! > 90 || n! < -90 || n! > 90 || s! >= n! || w === e) throw new RangeError('region.bounds is outside WGS84 or empty');
  return [w!,s!,e!,n!];
}
export function validateAcquisitionRequest(value: unknown): AcquisitionRequest {
  const o = object(value, 'request'); exactKeys(o, ['schemaVersion','id','inventoryUnitId','region','provider','release','layers','limits'], 'request');
  if (o.schemaVersion !== 1 || o.provider !== 'overture') throw new TypeError('unsupported acquisition schema or provider');
  const region = object(o.region, 'region'); exactKeys(region, ['id','parentId','name','kind','countryCode','timezone','bounds'], 'region');
  const code = region.countryCode;
  if (code === 'NG') throw new TypeError('Nigeria acquisition is explicitly excluded');
  if (code !== null && (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code))) throw new TypeError('region.countryCode must be null or ISO alpha-2');
  if (!['continent','country','admin','city','cell'].includes(String(region.kind))) throw new TypeError('unsupported region.kind');
  const bounds = validateBounds(region.bounds);
  const normalizedRegion: Region = {
    id: safeText(region.id, 'region.id'), parentId: region.parentId === null ? null : safeText(region.parentId, 'region.parentId'),
    name: safeText(region.name, 'region.name'), kind: region.kind as Region['kind'], countryCode: code as string | null,
    timezone: region.timezone === null ? null : safeText(region.timezone, 'region.timezone'), bounds,
  };
  if (normalizedRegion.timezone !== null) { try { new Intl.DateTimeFormat('en', { timeZone: normalizedRegion.timezone }); } catch { throw new TypeError('region.timezone must be an IANA timezone'); } }
  if (!Array.isArray(o.layers) || !o.layers.length || o.layers.length > 2 || o.layers.some(x => x !== 'buildings' && x !== 'roads') || new Set(o.layers).size !== o.layers.length) throw new TypeError('layers must be unique buildings and/or roads');
  const lim = object(o.limits, 'limits'); exactKeys(lim, Object.keys(HARD), 'limits');
  const limits = Object.fromEntries(Object.entries(HARD).map(([k,max]) => [k, positive(lim[k], `limits.${k}`, max)])) as AcquisitionRequest['limits'];
  if (typeof o.release !== 'string' || o.release !== '2026-09-23.1') throw new TypeError('release must equal the pinned Overture release 2026-09-23.1');
  return { schemaVersion: 1, id: safeText(o.id, 'request.id'), inventoryUnitId: safeText(o.inventoryUnitId, 'request.inventoryUnitId'), region: normalizedRegion, provider: 'overture', release: o.release, layers: [...o.layers] as AcquisitionRequest['layers'], limits };
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function checkedPython(value: string): string {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value) || !/(^|\/)python3(?:\.12)?$/.test(value)) throw new TypeError('pythonExecutable must be an absolute Python 3.12 executable path');
  return value;
}
async function ensureRoot(value: string): Promise<string> {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new TypeError('allowedRoot must be an absolute path');
  const root = path.resolve(value);
  // Inspect every existing ancestor before mkdir: recursive mkdir follows symlinks
  // and could create directories outside the requested root before we notice.
  const parts = root.split(path.sep).filter(Boolean);
  let current = path.parse(root).root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('allowedRoot ancestors must be canonical directories without symlinks');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(current);
    }
  }
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(root) !== root) throw new Error('allowedRoot must be a canonical directory without symlinks');
  return root;
}
function within(parent: string, child: string): boolean { const rel = path.relative(parent, child); return !!rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); }
async function assertNoLinks(root: string, target: string): Promise<void> {
  if (!within(root, target)) throw new Error('acquisition path escapes allowedRoot');
  let cur = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try { const info = await lstat(cur); if (info.isSymbolicLink()) throw new Error(`symlink path refused: ${cur}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}
async function assertTreeHasNoLinks(target: string): Promise<void> {
  const info=await lstat(target);
  if(info.isSymbolicLink())throw new Error('cached acquisition contains a symlink');
  if(info.isDirectory())for(const child of await readdir(target))await assertTreeHasNoLinks(path.join(target,child));
  else if(!info.isFile())throw new Error('cached acquisition contains a non-regular file');
}
function runAdapter(python: string, input: unknown, timeoutMs: number, memoryMb: number, signal?: AbortSignal): Promise<Record<string,unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', ADAPTER_PATH], { shell: false, stdio: ['pipe','pipe','pipe'], windowsHide: true, env: { PATH: path.dirname(python), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' } });
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let outBytes=0, errBytes=0, finished=false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(`acquisition exceeded ${timeoutMs} ms`)); }, timeoutMs);
    let checkingMemory=false;
    const memoryTimer=setInterval(()=>{
      if(checkingMemory||finished||!child.pid)return;
      checkingMemory=true;
      const probe=spawn('/bin/ps',['-o','rss=','-p',String(child.pid)],{shell:false,stdio:['ignore','pipe','ignore']});
      const chunks:Buffer[]=[];let size=0;
      probe.stdout.on('data',(part:Buffer)=>{size+=part.length;if(size<=128)chunks.push(part);});
      probe.once('error',()=>{checkingMemory=false;child.kill('SIGKILL');fail(new Error('cannot verify acquisition process memory limit'));});
      probe.once('close',code=>{
        checkingMemory=false;if(finished)return;
        const rss=Number(Buffer.concat(chunks).toString('utf8').trim());
        if(code!==0||!Number.isFinite(rss)||rss<1){child.kill('SIGKILL');fail(new Error('cannot verify acquisition process memory limit'));return;}
        if(rss>memoryMb*1024){child.kill('SIGKILL');fail(new RangeError(`acquisition exceeded ${memoryMb} MB memory limit`));}
      });
    },200);
    const onAbort = () => { child.kill('SIGKILL'); fail(new Error('acquisition aborted')); };
    const fail = (error: Error) => { if (finished) return; finished=true; clearTimeout(timer); clearInterval(memoryTimer); signal?.removeEventListener('abort', onAbort); reject(error); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout.on('data', (chunk: Buffer) => { outBytes+=chunk.length; if (outBytes>4_000_000) { child.kill('SIGKILL'); fail(new RangeError('adapter response exceeded 4 MB')); } else stdout.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { errBytes+=chunk.length; if (errBytes<=16_000) stderr.push(chunk); });
    child.once('error', error => fail(error));
    child.once('close', code => {
      if (finished) return;
      finished=true; clearTimeout(timer); clearInterval(memoryTimer); signal?.removeEventListener('abort', onAbort);
      if (code !== 0) { reject(new Error(`acquisition adapter failed (${code}): ${Buffer.concat(stderr).toString('utf8').slice(0,4000)}`)); return; }
      try { const parsed=JSON.parse(Buffer.concat(stdout).toString('utf8')) as unknown; resolve(object(parsed,'adapter response')); } catch(e) { reject(new Error('acquisition adapter returned invalid JSON',{cause:e})); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
function validateResultShape(raw: Record<string,unknown>, request: AcquisitionRequest, root: string): { path:string; receiptPath:string; upstream:AcquisitionResult['upstream']; metrics:AcquisitionResult['metrics']; exceptions:string[]; sources:SourceRecord[] } {
  exactKeys(raw, ['path','receiptPath','upstream','metrics','exceptions','sources'], 'adapter response');
  const pathValue=safeText(raw.path,'adapter path',4096), receiptValue=safeText(raw.receiptPath,'adapter receiptPath',4096);
  if (!path.isAbsolute(pathValue)||!path.isAbsolute(receiptValue)||!within(root,pathValue)||!within(root,receiptValue)) throw new TypeError('adapter paths must stay inside allowedRoot');
  const m=object(raw.metrics,'adapter metrics'); exactKeys(m,['networkBytes','outputBytes','features','elapsedMs'],'metrics');
  const counter=(v:unknown,label:string,max:number,min=0)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw new RangeError(`${label} is outside its budget`);return v;};
  const metrics={networkBytes:counter(m.networkBytes,'metrics.networkBytes',request.limits.networkBytes),outputBytes:counter(m.outputBytes,'metrics.outputBytes',request.limits.outputBytes,1),features:counter(m.features,'metrics.features',request.limits.features),elapsedMs:counter(m.elapsedMs,'metrics.elapsedMs',request.limits.durationMs,1)};
  if (!Array.isArray(raw.upstream)||raw.upstream.length>1_300) throw new TypeError('upstream list is invalid');
  const upstream=raw.upstream.map((v,i)=>{const u=object(v,`upstream[${i}]`);exactKeys(u,['url','etag','bytes'],'upstream');const url=safeText(u.url,'upstream URL',2048),etag=u.etag===null?null:safeText(u.etag,'upstream ETag',512),bytes=positive(u.bytes,'upstream bytes',request.limits.networkBytes);let parsed:URL;try{parsed=new URL(url);}catch{throw new TypeError('upstream URL is invalid');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!sourceConfigHosts().has(parsed.hostname)||!parsed.pathname.includes(request.release))throw new TypeError('upstream URL is not an allowlisted pinned source URL');return{url,etag,bytes};});
  if(upstream.reduce((total,value)=>total+value.bytes,0)!==metrics.networkBytes)throw new TypeError('upstream byte receipts do not sum to measured network bytes');
  if (!Array.isArray(raw.sources)||raw.sources.length!==request.layers.length) throw new TypeError('source manifest does not match selected layers');
  const sources=raw.sources.map((v,i)=>{const s=object(v,`sources[${i}]`);exactKeys(s,['id','url','release','license','attribution','sha256','bytes'],'source');if(typeof s.sha256!=='string'||!SHA.test(s.sha256))throw new TypeError('source manifest SHA-256 invalid');positive(s.bytes,'source bytes',request.limits.outputBytes);let parsed:URL;try{parsed=new URL(String(s.url));}catch{throw new TypeError('source manifest URL is invalid');}if(s.release!==request.release||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hostname!=='stac.overturemaps.org'||parsed.search||parsed.hash||typeof s.license!=='string'||typeof s.attribution!=='string')throw new TypeError('source manifest is not pinned');return s as unknown as SourceRecord;});
  sources.forEach((source,i)=>{const layer=request.layers[i]!;const expectedUrl=layer==='buildings'?`https://stac.overturemaps.org/${request.release}/buildings/building/collection.json`:`https://stac.overturemaps.org/${request.release}/transportation/segment/collection.json`;if(source.id!==`overture-${request.release}-${layer}`||source.url!==expectedUrl||source.license!=='ODbL-1.0'||!source.attribution.includes('https://docs.overturemaps.org/attribution/'))throw new TypeError(`source manifest does not match the verified ${layer} source`);});
  if(!Array.isArray(raw.exceptions)||raw.exceptions.length>1000||raw.exceptions.some(x=>typeof x!=='string'||x.length>300))throw new TypeError('adapter exceptions list invalid');
  return {path:pathValue,receiptPath:receiptValue,upstream,metrics,exceptions:raw.exceptions as string[],sources};
}
function sourceConfigHosts():Set<string>{return new Set(['overturemaps-us-west-2.s3.us-west-2.amazonaws.com','stac.overturemaps.org']);}
type AttemptRecord = {schemaVersion:1;requestHash:string;attempt:number;event:'started'|'finished';status:'pending'|'success'|'cache-hit'|'failure';startedAt:string;endedAt?:string;selection:unknown;caps:{networkBytes:number;diskBytes:number;durationMs:number};networkBytesMeasured:number|null;networkReservationUpperBoundBytes:number;metrics?:AcquisitionResult['metrics'];receiptPath?:string;reason?:string};
async function appendAttempt(root:string,requestHash:string,record:AttemptRecord):Promise<{file:string;attempt:number}>{
  const dir=path.join(root,'acquisition-attempts',requestHash),file=path.join(dir,'attempts.jsonl');
  await assertNoLinks(root,path.dirname(dir));
  try{await mkdir(path.dirname(dir));await syncDirectory(root);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  await assertNoLinks(root,dir);
  try{await mkdir(dir);await syncDirectory(path.dirname(dir));}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  await assertNoLinks(root,file);
  let contents:Buffer;
  try{const info=await lstat(file);if(!info.isFile()||info.size>ATTEMPT_FILE_BYTES)throw new RangeError('acquisition attempt evidence file is unsafe or over limit');contents=await readFile(file);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')contents=Buffer.alloc(0);else throw error;}
  if(contents.length&&contents[contents.length-1]!==10)throw new Error('acquisition attempt evidence ends with a truncated record');
  const lines=contents.length?contents.toString('utf8').slice(0,-1).split('\n'):[];
  if(lines.length>MAX_ATTEMPTS*2)throw new RangeError('acquisition attempt evidence reached its record limit');
  let starts=0;for(const line of lines){if(Buffer.byteLength(line)>ATTEMPT_RECORD_BYTES)throw new RangeError('existing acquisition attempt record exceeds its size limit');let entry:unknown;try{entry=JSON.parse(line);}catch{throw new Error('acquisition attempt evidence has a corrupt record');}const e=object(entry,'attempt evidence');validateAttemptRecord(e,requestHash);if(e.event==='started')starts++;}
  if(record.event==='started'&&starts>=MAX_ATTEMPTS)throw new RangeError('acquisition attempt evidence reached its attempt limit');
  const attempt=record.event==='started'?starts+1:record.attempt;
  const line=JSON.stringify({...record,attempt})+'\n';
  if(Buffer.byteLength(line)>ATTEMPT_RECORD_BYTES||contents.byteLength+Buffer.byteLength(line)>ATTEMPT_FILE_BYTES)throw new RangeError('acquisition attempt evidence would exceed its 1 MB metadata byte budget');
  const handle=await open(file,constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
  try{await handle.writeFile(line);await handle.sync();}finally{await handle.close();}
  await syncDirectory(dir);
  return {file,attempt};
}
function validateAttemptRecord(e:Record<string,unknown>,requestHash:string):void{
  const started=e.event==='started',failure=e.status==='failure';
  const keys=started?['schemaVersion','requestHash','attempt','event','status','startedAt','selection','caps','networkBytesMeasured','networkReservationUpperBoundBytes']:failure?['schemaVersion','requestHash','attempt','event','status','startedAt','endedAt','selection','caps','networkBytesMeasured','networkReservationUpperBoundBytes','reason']:['schemaVersion','requestHash','attempt','event','status','startedAt','endedAt','selection','caps','networkBytesMeasured','networkReservationUpperBoundBytes','metrics','receiptPath'];
  exactKeys(e,keys,'attempt evidence');
  if(e.schemaVersion!==1||e.requestHash!==requestHash||!Number.isSafeInteger(e.attempt)||(e.attempt as number)<1||!['started','finished'].includes(String(e.event))||!(started?e.status==='pending':['success','cache-hit','failure'].includes(String(e.status)))||typeof e.startedAt!=='string'||!Number.isFinite(Date.parse(e.startedAt))||!e.selection||typeof e.selection!=='object'||Array.isArray(e.selection))throw new Error('acquisition attempt evidence has an invalid identity or status');
  const caps=object(e.caps,'attempt caps');exactKeys(caps,['networkBytes','diskBytes','durationMs'],'attempt caps');
  for(const key of ['networkBytes','diskBytes','durationMs'])if(!Number.isSafeInteger(caps[key])||(caps[key] as number)<1)throw new Error('acquisition attempt evidence has invalid requested caps');
  const reservation=e.networkReservationUpperBoundBytes,networkCap=caps.networkBytes;
  if(typeof reservation!=='number'||!Number.isSafeInteger(reservation)||reservation<0||typeof networkCap!=='number'||reservation>networkCap||started&&e.networkBytesMeasured!==null||failure&&e.networkBytesMeasured!==null)throw new Error('acquisition attempt evidence has invalid network accounting');
  if(started){if(e.networkReservationUpperBoundBytes!==caps.networkBytes)throw new Error('pending attempt does not reserve the requested network cap');return;}
  if(typeof e.endedAt!=='string'||!Number.isFinite(Date.parse(e.endedAt)))throw new Error('finished attempt lacks a valid end time');
  if(failure){if(typeof e.reason!=='string'||e.reason.length>8_000||e.networkReservationUpperBoundBytes!==caps.networkBytes)throw new Error('failure attempt evidence is incomplete');return;}
  if(typeof e.receiptPath!=='string'||!path.isAbsolute(e.receiptPath)||!e.metrics||typeof e.metrics!=='object')throw new Error('successful attempt lacks its receipt or metrics');
  const metrics=object(e.metrics,'attempt metrics');exactKeys(metrics,['networkBytes','outputBytes','features','elapsedMs'],'attempt metrics');
  for(const key of Object.keys(metrics))if(!Number.isSafeInteger(metrics[key])||(metrics[key] as number)<0)throw new Error('attempt metrics are invalid');
  const measured=e.networkBytesMeasured,metricNetworkBytes=metrics.networkBytes;
  if(typeof measured!=='number'||!Number.isSafeInteger(measured)||typeof metricNetworkBytes!=='number'||measured!==metricNetworkBytes||measured>reservation)throw new Error('successful attempt network metrics disagree');
}
async function syncDirectory(directory:string):Promise<void>{
  const handle=await open(directory,constants.O_RDONLY);
  try{await handle.sync();}catch(error){if(!['EINVAL','ENOTSUP','EISDIR','EBADF'].includes(String((error as NodeJS.ErrnoException).code)))throw error;}finally{await handle.close();}
}
async function writeDurable(file:string,bytes:Uint8Array):Promise<void>{
  const handle=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
type BuildLockRecord={pid:number;identity:string;startedAt:string};
async function readBuildLock(lockPath:string):Promise<{record:BuildLockRecord;dev:number;ino:number}|null>{
  const handle=await open(lockPath,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const info=await handle.stat();if(!info.isFile()||info.size>4_096)throw new Error('acquisition build lock is not a bounded regular file');const record=JSON.parse(await handle.readFile('utf8')) as unknown;const value=object(record,'acquisition build lock');exactKeys(value,['pid','identity','startedAt'],'acquisition build lock');if(!Number.isSafeInteger(value.pid)||(value.pid as number)<1||typeof value.identity!=='string'||!/^[-a-f0-9]{32}$/.test(value.identity)||typeof value.startedAt!=='string'||!Number.isFinite(Date.parse(value.startedAt)))throw new Error('acquisition build lock identity is invalid');return{record:value as BuildLockRecord,dev:info.dev,ino:info.ino};}finally{await handle.close();}
}
function pidIsAlive(pid:number):boolean{try{process.kill(pid,0);return true;}catch(error){const code=(error as NodeJS.ErrnoException).code;return code!=='ESRCH';}}
async function removeStaleBuildLock(lockPath:string):Promise<boolean>{
  try{const before=await lstat(lockPath);if(before.isSymbolicLink()||!before.isFile())throw new Error('acquisition build lock path is unsafe');let observed:Awaited<ReturnType<typeof readBuildLock>>;try{observed=await readBuildLock(lockPath);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;if(Date.now()-before.mtimeMs<30_000)return false;observed=null;}
    const after=await lstat(lockPath);if(before.dev!==after.dev||before.ino!==after.ino||after.isSymbolicLink()||!after.isFile())return false;
    if(observed&&pidIsAlive(observed.record.pid))return false;
    await rm(lockPath);return true;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}
}
/** Serialize all builders that mutate a shared canonical world-build root. The callback must use its provided unlocked acquirer. */
export interface AcquisitionBuildLockOptions { signal?:AbortSignal; timeoutMs?:number }
export async function withAcquisitionBuildLock<T>(rootValue:string,operation:(acquire:typeof acquireRegion)=>Promise<T>,options:AcquisitionBuildLockOptions={}):Promise<T>{
  const timeoutMs=options.timeoutMs??BUILD_LOCK_WAIT_MS;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>MAX_BUILD_LOCK_WAIT_MS)throw new RangeError(`acquisition lock timeout must be between 1 and ${MAX_BUILD_LOCK_WAIT_MS} ms`);
  const root=await ensureRoot(rootValue),lockPath=path.join(root,'.acquisition-build.lock'),identity=randomBytes(16).toString('hex'),record:BuildLockRecord={pid:process.pid,identity,startedAt:new Date().toISOString()},payload=Buffer.from(JSON.stringify(record));
  const deadline=Date.now()+timeoutMs;let handle:Awaited<ReturnType<typeof open>>|undefined,ownsLock=false,createdLock:{dev:number;ino:number}|undefined;
  const checkWait=()=>{if(options.signal?.aborted)throw new Error('acquisition build lock wait aborted');if(Date.now()>=deadline)throw new Error(`timed out waiting for acquisition build lock: ${lockPath}`);};
  while(!handle&&!ownsLock){checkWait();await assertNoLinks(root,lockPath);try{handle=await open(lockPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);const info=await handle.stat();createdLock={dev:info.dev,ino:info.ino};await handle.writeFile(payload);await handle.sync();await handle.close();handle=undefined;await syncDirectory(root);ownsLock=true;}catch(error){if(handle){await handle.close().catch(()=>{});handle=undefined;}if(createdLock){try{const info=await lstat(lockPath);if(!info.isSymbolicLink()&&info.isFile()&&info.dev===createdLock.dev&&info.ino===createdLock.ino){await rm(lockPath);await syncDirectory(root);}}catch(cleanupError){if((cleanupError as NodeJS.ErrnoException).code!=='ENOENT')throw cleanupError;}createdLock=undefined;}if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(await removeStaleBuildLock(lockPath))continue;checkWait();await new Promise(resolve=>setTimeout(resolve,Math.min(BUILD_LOCK_POLL_MS,Math.max(1,deadline-Date.now()))));}}
  const unlocked:typeof acquireRegion=async(value,options)=>{if(path.resolve(options.allowedRoot)!==root)throw new Error('locked acquisition must use the canonical build root');return acquireRegionUnlocked(value,{...options,allowedRoot:root});};
  try{checkWait();return await operation(unlocked);}finally{
    const current=await readBuildLock(lockPath);if(current?.record.identity!==identity||current.record.pid!==process.pid)throw new Error('acquisition build lock ownership changed before release');
    await rm(lockPath);await syncDirectory(root);
  }
}
/** Acquire only the explicitly pinned, bounded region described by request. */
async function acquireRegionUnlocked(value: AcquisitionRequest, options: AcquisitionOptions): Promise<AcquisitionResult> {
  const request=validateAcquisitionRequest(value), python=checkedPython(options.pythonExecutable), root=await ensureRoot(options.allowedRoot);
  const sourceConfig=JSON.parse(await readFile(SOURCES_PATH,'utf8')) as SourceConfig;
  if(sourceConfig.release!==request.release||sourceConfig.releaseStatus!=='official-static-stac-items-verified')throw new Error('requested release is not the verified pinned source configuration');
  const selection={schemaVersion:request.schemaVersion,id:request.id,inventoryUnitId:request.inventoryUnitId,region:request.region,provider:request.provider,release:request.release,layers:request.layers};
  const requestHash=sha(Buffer.from(canonical({compiler:COMPILER,selection,sourceConfig})));
  const startedAt=new Date().toISOString(),attemptEvidence=await appendAttempt(root,requestHash,{schemaVersion:1,requestHash,attempt:0,event:'started',status:'pending',startedAt,selection,caps:{networkBytes:request.limits.networkBytes,diskBytes:request.limits.diskBytes,durationMs:request.limits.durationMs},networkBytesMeasured:null,networkReservationUpperBoundBytes:request.limits.networkBytes}),attemptFile=attemptEvidence.file,attempt=attemptEvidence.attempt;
  try {
  const cacheDir=path.join(root,'acquisitions',requestHash), inputPath=path.join(cacheDir,'extract.geojson'), receiptPath=path.join(cacheDir,'receipt.json');
  const sourceIndexDir=path.join(root,'acquisition-index');
  await assertNoLinks(root,path.dirname(cacheDir)); try{await mkdir(path.dirname(cacheDir));await syncDirectory(root);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;} await assertNoLinks(root,cacheDir);
  await assertNoLinks(root,sourceIndexDir); try{await mkdir(sourceIndexDir);await syncDirectory(root);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;} await assertNoLinks(root,sourceIndexDir);
  // Resume only from a complete receipt whose request identity and exact bytes revalidate.
  let cacheFailure: unknown;
  try {
    const cacheStarted=Date.now();
    await assertTreeHasNoLinks(cacheDir);
    await assertNoLinks(root,inputPath); await assertNoLinks(root,receiptPath);
    const inputInfo=await lstat(inputPath), receiptInfo=await lstat(receiptPath);
    if(!inputInfo.isFile())throw new Error('cached extract is not a regular file');
    if(inputInfo.size>request.limits.outputBytes)throw new CacheBudgetError('valid cached extract exceeds the current output byte budget; cache retained');
    if(!receiptInfo.isFile()||receiptInfo.size>1_000_000)throw new RangeError('cached receipt exceeds its byte budget');
    const [bytes,receiptBytes]=await Promise.all([readFile(inputPath),readFile(receiptPath)]), receipt=object(JSON.parse(receiptBytes.toString('utf8')),'cached receipt');
    exactKeys(receipt,['schemaVersion','requestHash','selection','request','completedAt','inputSha256','inputBytes','metrics','upstream','sources','exceptions'],'cached receipt');
    if(receipt.schemaVersion!==1||!SHA.test(String(receipt.requestHash))||typeof receipt.completedAt!=='string'||!Number.isFinite(Date.parse(receipt.completedAt)))throw new Error('cached acquisition receipt identity is invalid');
    const receiptRequest=validateAcquisitionRequest(receipt.request);
    if(receipt.requestHash!==requestHash||receipt.inputSha256!==sha(bytes)||receipt.inputBytes!==bytes.byteLength||bytes.byteLength>request.limits.outputBytes)throw new Error('cached acquisition receipt or extract is corrupt');
    if(canonical(receipt.selection)!==canonical(selection))throw new Error('cached acquisition selection does not match current request');
    const geo=object(JSON.parse(bytes.toString('utf8')),'cached GeoJSON');
    if(geo.type!=='FeatureCollection'||!Array.isArray(geo.features))throw new Error('cached extract is invalid');
    if(geo.features.length>request.limits.features)throw new CacheBudgetError('valid cached extract exceeds the current feature budget; cache retained');
    validateGeoFeatures(geo.features,request);
    if(!Array.isArray(receipt.sources)||receipt.sources.length!==request.layers.length||!Array.isArray(receipt.upstream)||!receipt.metrics||!Array.isArray(receipt.exceptions))throw new Error('cached acquisition receipt is incomplete');
    const verified=validateResultShape({path:inputPath,receiptPath,metrics:receipt.metrics,upstream:receipt.upstream,sources:receipt.sources,exceptions:receipt.exceptions},receiptRequest,root);
    if(verified.metrics.outputBytes!==bytes.byteLength||verified.metrics.features!==geo.features.length)throw new Error('cached acquisition receipt metrics do not match its extract');
    const checked={...verified,metrics:{networkBytes:0,outputBytes:bytes.byteLength,features:geo.features.length,elapsedMs:Math.max(1,Date.now()-cacheStarted)}};
    const sources=checked.sources;
    const source=makeCombinedSource(request,sources,bytes);
    const plan:WorldPlan={region:request.region,source,input:{path:inputPath,sha256:sha(bytes),bytes:bytes.byteLength},rawExtraction:{url:`overture:${request.release}/${requestHash}`,fetched:String(receipt.completedAt),sha256:sha(bytes),bytes:bytes.byteLength}};
    const metrics={...checked.metrics,elapsedMs:Math.max(1,Date.now()-cacheStarted)};
    await appendAttempt(root,requestHash,{schemaVersion:1,requestHash,attempt,event:'finished',status:'cache-hit',startedAt,endedAt:new Date().toISOString(),selection,caps:{networkBytes:request.limits.networkBytes,diskBytes:request.limits.diskBytes,durationMs:request.limits.durationMs},networkBytesMeasured:0,networkReservationUpperBoundBytes:0,metrics,receiptPath});
    return {plan,requestHash,receiptPath,metrics,upstream:[],exceptions:receipt.exceptions as string[]};
  } catch(error) { cacheFailure=error; if(error instanceof CacheBudgetError)throw error; }
  // Keep bad cache contents as bounded audit evidence. Never delete or overwrite
  // a valid cache; after three quarantines for a request, stop for human repair.
  try {
    const info=await lstat(cacheDir);
    if(info.isSymbolicLink()||!info.isDirectory())throw new Error('partial acquisition cache path is unsafe');
    await assertTreeHasNoLinks(cacheDir);
    const prefix=`.quarantine-${requestHash}-`, names=await readdir(path.dirname(cacheDir));
    const prior=names.filter(name=>name.startsWith(prefix)).length;
    if(prior>=3)throw new Error('corrupt acquisition cache reached its three-quarantine repair limit',{cause:cacheFailure});
    const quarantine=path.join(path.dirname(cacheDir),`${prefix}${Date.now()}-${process.pid}`);
    await assertNoLinks(root,quarantine);
    await rename(cacheDir,quarantine);
    await syncDirectory(path.dirname(cacheDir));
  } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
  const staging=path.join(root,`acquisitions/.${requestHash}.${process.pid}.${Date.now()}.tmp`);
  await assertNoLinks(root,staging); await mkdir(staging,{recursive:false});
  try {
    const raw=await runAdapter(python,{request,sourceConfig,cacheDir:staging,allowedRoot:root,sourceIndexDir},request.limits.durationMs,request.limits.memoryMb,options.signal);
    const result=validateResultShape(raw,request,staging);
    if(!within(staging,result.path)||!within(staging,result.receiptPath))throw new TypeError('adapter outputs must stay inside its private staging directory');
    if(result.path!==path.join(staging,'adapter-output.geojson')||result.receiptPath!==path.join(staging,'adapter-receipt.json'))throw new TypeError('adapter output paths do not match the fixed contract');
    await assertNoLinks(root,result.path);await assertNoLinks(root,result.receiptPath);
    const outputInfo=await stat(result.path);if(!outputInfo.isFile()||outputInfo.size>request.limits.outputBytes)throw new RangeError('adapter GeoJSON exceeds output byte budget');
    const adapterReceiptInfo=await stat(result.receiptPath);if(!adapterReceiptInfo.isFile()||adapterReceiptInfo.size>1_000_000)throw new RangeError('adapter receipt is not a bounded regular file');
    const rawBytes=await readFile(result.path);
    const adapterReceipt=object(JSON.parse(await readFile(result.receiptPath,'utf8')),'adapter receipt');
    exactKeys(adapterReceipt,['schemaVersion','inputSha256','inputBytes','index'],'adapter receipt');
    if(adapterReceipt.schemaVersion!==1||adapterReceipt.inputBytes!==rawBytes.byteLength||rawBytes.byteLength!==result.metrics.outputBytes||rawBytes.byteLength>request.limits.outputBytes||adapterReceipt.inputSha256!==sha(rawBytes)) throw new Error('adapter output checksum/size verification failed');
    const geo=object(JSON.parse(rawBytes.toString('utf8')),'adapter GeoJSON');
    if(geo.type!=='FeatureCollection'||!Array.isArray(geo.features)||geo.features.length!==result.metrics.features)throw new Error('adapter output feature count mismatch');
    const metadata=object(geo.metadata,'adapter GeoJSON metadata');
    exactKeys(metadata,['provider','release','requestHash','stacIndex','exceptions'],'adapter GeoJSON metadata');
    const stacIndex=object(metadata.stacIndex,'adapter STAC index receipt');
    exactKeys(stacIndex,['sha256','itemCount','selectedCount'],'STAC index receipt');
    if(metadata.provider!=='overture'||metadata.release!==request.release||metadata.requestHash!==requestHash||!Array.isArray(metadata.exceptions)||metadata.exceptions.length>1000||metadata.exceptions.some(x=>typeof x!=='string'||x.length>300)||!SHA.test(String(stacIndex.sha256))||stacIndex.itemCount!==640||typeof stacIndex.selectedCount!=='number'||!Number.isSafeInteger(stacIndex.selectedCount)||stacIndex.selectedCount<0||stacIndex.selectedCount>640)throw new Error('adapter GeoJSON metadata does not match the pinned selection');
    if(canonical(adapterReceipt.index)!==canonical(stacIndex)||canonical(metadata.exceptions)!==canonical(result.exceptions))throw new Error('adapter metadata and receipt disagree');
    validateGeoFeatures(geo.features,request);
    const receipt={schemaVersion:1,requestHash,selection,request,completedAt:new Date().toISOString(),inputSha256:sha(rawBytes),inputBytes:rawBytes.byteLength,metrics:result.metrics,upstream:result.upstream,sources:result.sources,exceptions:result.exceptions};
    await writeDurable(path.join(staging,'extract.geojson'),rawBytes);
    await writeDurable(path.join(staging,'receipt.json'),Buffer.from(JSON.stringify(receipt)+'\n'));
    await rm(result.path,{force:true}); await rm(result.receiptPath,{force:true});
    await syncDirectory(staging);
    // Complete temp tree is visible only after all content and receipts have been verified.
    await rename(staging,cacheDir);
    await syncDirectory(path.dirname(cacheDir));
    const finalPath=path.join(cacheDir,'extract.geojson'),source=makeCombinedSource(request,result.sources,rawBytes);
    const plan:WorldPlan={region:request.region,source,input:{path:finalPath,sha256:sha(rawBytes),bytes:rawBytes.byteLength},rawExtraction:{url:`overture:${request.release}/${requestHash}`,fetched:receipt.completedAt,sha256:sha(rawBytes),bytes:rawBytes.byteLength}};
    await appendAttempt(root,requestHash,{schemaVersion:1,requestHash,attempt,event:'finished',status:'success',startedAt,endedAt:new Date().toISOString(),selection,caps:{networkBytes:request.limits.networkBytes,diskBytes:request.limits.diskBytes,durationMs:request.limits.durationMs},networkBytesMeasured:result.metrics.networkBytes,networkReservationUpperBoundBytes:request.limits.networkBytes,metrics:result.metrics,receiptPath:path.join(cacheDir,'receipt.json')});
    return {plan,requestHash,receiptPath,metrics:result.metrics,upstream:result.upstream,exceptions:result.exceptions};
  } catch(error) { await rm(staging,{recursive:true,force:true}); throw error; }
  } catch(error) {
    const reason=(error instanceof Error?error.message:String(error)).slice(0,8_000);
    let evidencePath=attemptFile;
    try { evidencePath= (await appendAttempt(root,requestHash,{schemaVersion:1,requestHash,attempt,event:'finished',status:'failure',startedAt,endedAt:new Date().toISOString(),selection,caps:{networkBytes:request.limits.networkBytes,diskBytes:request.limits.diskBytes,durationMs:request.limits.durationMs},networkBytesMeasured:null,networkReservationUpperBoundBytes:request.limits.networkBytes,reason})).file; }
    catch(recordError){throw new Error(`${reason}; failed to persist acquisition failure evidence at ${attemptFile}: ${recordError instanceof Error?recordError.message:String(recordError)}`,{cause:error});}
    throw new Error(`${reason}; acquisition failure evidence: ${evidencePath}`,{cause:error});
  }
}
export async function acquireRegion(value:AcquisitionRequest,options:AcquisitionOptions):Promise<AcquisitionResult>{
  const request=validateAcquisitionRequest(value);
  return withAcquisitionBuildLock(options.allowedRoot,acquire=>acquire(request,options),{signal:options.signal,timeoutMs:request.limits.durationMs});
}
function makeCombinedSource(request:AcquisitionRequest,sources:SourceRecord[],bytes:Uint8Array):SourceRecord {
  return {id:`overture-${request.release}-${request.layers.join('-')}`,url:`https://stac.overturemaps.org/${request.release}/catalog.json`,release:request.release,license:[...new Set(sources.map(s=>s.license))].sort().join(' + '),attribution:[...new Set(sources.map(s=>s.attribution))].sort().join('; '),sha256:sha(bytes),bytes:bytes.byteLength};
}
function validateGeoFeatures(features:unknown[],request:AcquisitionRequest):void {
  const ids=new Set<string>();
  for(const [i,item] of features.entries()){
    const f=object(item,`feature ${i}`);exactKeys(f,['type','id','properties','geometry'],'feature');
    if(f.type!=='Feature'||(typeof f.id!=='string'&&typeof f.id!=='number'))throw new TypeError(`feature ${i} has no source ID`);
    const id=String(f.id);if(!id||id.length>256||ids.has(id))throw new TypeError(`feature ${i} source ID is invalid or duplicated`);ids.add(id);
    const p=object(f.properties,`feature ${i} properties`);exactKeys(p,['building','highway','height','render_height','building:levels','layer','sourceLayer','sources'],'feature properties');
    if('building'in p){if(!request.layers.includes('buildings')||p.building!==true||p.sourceLayer!=='buildings')throw new TypeError(`feature ${i} building source tags invalid`);}
    else if('highway'in p){if(!request.layers.includes('roads')||typeof p.highway!=='string'||!p.highway||p.sourceLayer!=='transportation')throw new TypeError(`feature ${i} road source tags invalid`);}
    else throw new TypeError(`feature ${i} has no supported source layer`);
    if(!Array.isArray(p.sources)||p.sources.some(s=>typeof s!=='string'||s.length>256))throw new TypeError(`feature ${i} source list invalid`);
    if('height'in p&&(typeof p.height!=='number'&&typeof p.height!=='string'||typeof p.height==='number'&&(!Number.isFinite(p.height)||p.height<=0||p.height>1000)||typeof p.height==='string'&&(p.height.length>32||!Number.isFinite(Number(p.height.replace(/\s*m$/i,''))))))throw new TypeError(`feature ${i} height invalid`);
    const geometry=object(f.geometry,`feature ${i} geometry`);exactKeys(geometry,['type','coordinates'],`feature ${i} geometry`);
    if(!(['buildings'].includes(String(p.sourceLayer))?['Polygon','MultiPolygon'].includes(String(geometry.type)):['LineString','MultiLineString'].includes(String(geometry.type))))throw new TypeError(`feature ${i} geometry type does not match its source layer`);
  }
}
