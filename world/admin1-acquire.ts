import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import type { Admin1CaptureResult, Admin1CaptureSpec } from './admin1-types.ts';

export const ADMIN1_CAPTURE_LIMITS = Object.freeze({ sourceBytes: 64 * 1024 * 1024, networkBytes: 96 * 1024 * 1024,
  cacheBytes: 128 * 1024 * 1024, auditBytes: 512 * 1024, auditRecords: 128, recordBytes: 8 * 1024,
  reserveBytes: 16 * 1024, maxAttempts: 2, durationMs: 120_000, rssBytes: 512 * 1024 * 1024,
  freeBytes: 100 * 1024 * 1024, scanEntries: 1024, scanDepth: 6, metadataBytes: 64 * 1024, overshootBytes: 64 * 1024 });

const ARTIFACT = 'geojson/ne_10m_admin_1_states_provinces.geojson';
const METADATA_PATH = '.cache/world-build/evidence/admin1-resolution-research/source-api.json';
const CACHE_RELATIVE = '.cache/world-build/admin1-source-cache';
const RAW_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector';
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;

export interface Admin1AcquisitionOptions {
  repositoryRoot: string;
  signal?: AbortSignal;
  durationMs?: number;
  cacheOnly?: boolean;
  /** Test seam: URL, headers, redirect policy, and body checks stay fixed by this module. */
  fetcher?: typeof fetch;
}

function obj(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`${label} must be an object`);
  return v as Record<string, unknown>;
}
function exactKeys(v: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) throw new TypeError(`${label} has missing or unknown fields`);
}
function canonical(v: unknown): string {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new TypeError('non-finite capture identity'); return JSON.stringify(v); }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') { const x = v as Record<string, unknown>; return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`; }
  throw new TypeError('capture identity is not JSON data');
}
function sha256(v: Uint8Array | string): string { return createHash('sha256').update(v).digest('hex'); }
function gitBlobSha1(bytes: Uint8Array): string { const h = createHash('sha1'); h.update(`blob ${bytes.byteLength}\0`); h.update(bytes); return h.digest('hex'); }
function errorText(e: unknown): string { return (e instanceof Error ? e.message : String(e)).slice(0, 2000); }
function inside(root: string, child: string): boolean { const r = path.relative(root, child); return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r)); }

export function validateAdmin1CaptureSpec(value: unknown): Admin1CaptureSpec {
  const s = obj(value, 'Admin1 capture spec');
  exactKeys(s, ['schemaVersion','provider','release','resolution','metadataPath','metadataSha256','metadataBytes','expectedBytes','expectedGitBlobSha1','license','attribution'], 'Admin1 capture spec');
  if (s.schemaVersion !== 1 || s.provider !== 'natural-earth' || s.resolution !== '10m' || s.metadataPath !== METADATA_PATH || s.license !== 'Public-domain') throw new TypeError('Admin1 spec must identify the pinned Natural Earth 10m product');
  if (typeof s.release !== 'string' || !HEX40.test(s.release)) throw new TypeError('Admin1 release must be a full lowercase commit');
  if (typeof s.metadataSha256 !== 'string' || !HEX64.test(s.metadataSha256)) throw new TypeError('Admin1 metadata SHA-256 is invalid');
  if (!Number.isSafeInteger(s.metadataBytes) || (s.metadataBytes as number) < 1 || (s.metadataBytes as number) > ADMIN1_CAPTURE_LIMITS.metadataBytes) throw new RangeError('Admin1 metadata exceeds 64 KiB');
  if (!Number.isSafeInteger(s.expectedBytes) || (s.expectedBytes as number) < 1 || (s.expectedBytes as number) > ADMIN1_CAPTURE_LIMITS.sourceBytes) throw new RangeError('Admin1 source exceeds 64 MiB');
  if (typeof s.expectedGitBlobSha1 !== 'string' || !HEX40.test(s.expectedGitBlobSha1)) throw new TypeError('Admin1 Git blob SHA-1 is invalid');
  if (typeof s.attribution !== 'string' || !s.attribution.trim() || s.attribution.length > 512 || /[\u0000-\u001f\u007f]/.test(s.attribution)) throw new TypeError('Admin1 attribution is invalid bounded text');
  return value as Admin1CaptureSpec;
}

async function inspectPath(target: string): Promise<void> {
  const resolved = path.resolve(target), root = path.parse(resolved).root; let cursor = root;
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]!);
    try { const st = await lstat(cursor); if (st.isSymbolicLink() || (i < parts.length - 1 && !st.isDirectory())) throw new Error(`Admin1 path has unsafe ancestor: ${cursor}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  }
}
async function ensureDirectory(target: string, root: string): Promise<void> {
  if (!inside(root, target)) throw new Error('Admin1 cache escapes repository root');
  const fsroot = path.parse(target).root; let cursor = fsroot;
  for (const part of target.slice(fsroot.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const st = await lstat(cursor); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`Admin1 cache directory is unsafe: ${cursor}`);
  }
}
async function syncDirectory(dir: string): Promise<void> { const h = await open(dir, constants.O_RDONLY); try { await h.sync(); } finally { await h.close(); } }
async function treeUsage(root: string): Promise<{bytes:number;entries:number}> {
  let entries = 0;
  const walk = async (dir: string, depth: number): Promise<number> => {
    if (depth > ADMIN1_CAPTURE_LIMITS.scanDepth) throw new RangeError('Admin1 cache exceeds depth-6 traversal cap');
    const st = await lstat(dir); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Admin1 cache contains unsafe directory');
    const d = await opendir(dir); let bytes = 0;
    try { for await (const ent of d) { if (++entries > ADMIN1_CAPTURE_LIMITS.scanEntries) throw new RangeError('Admin1 cache exceeds 1,024 entries'); const p=path.join(dir,ent.name), s=await lstat(p); if(s.isSymbolicLink())throw new Error('Admin1 cache contains symlink'); if(s.isDirectory())bytes+=await walk(p,depth+1); else if(s.isFile())bytes+=s.size; else throw new Error('Admin1 cache contains non-regular entry'); if(bytes>ADMIN1_CAPTURE_LIMITS.cacheBytes)throw new RangeError('Admin1 cache exceeds 128 MiB'); } } finally { await d.close().catch(()=>{}); }
    return bytes;
  };
  try { await lstat(root); } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return{bytes:0,entries:0}; throw e; }
  return {bytes:await walk(root,0),entries};
}

type RequestIdentity = {release:string;path:string;blob:string;expectedBytes:number};
type AuditRow = { schemaVersion:1; id:string; hash:string; identity:RequestIdentity; event:'start'|'finish'; status:string; reservation:number; measured:number|null; complete:boolean; startedAt:string; endedAt?:string; error?:string; sourceBytes?:number };
async function readAudit(file: string): Promise<{rows:AuditRow[];bytes:number;reserved:number;attemptsByHash:Map<string,number>}> {
  let bytes: Buffer;
  try { bytes=await readBoundedLocalFile(file,ADMIN1_CAPTURE_LIMITS.auditBytes); } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return{rows:[],bytes:0,reserved:0,attemptsByHash:new Map()}; throw e; }
  if(bytes.length && bytes[bytes.length-1]!==10) throw new Error('Admin1 audit has a truncated final record');
  let text: string; try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('Admin1 audit is not valid UTF-8');}
  const rows:AuditRow[]=[], starts=new Map<string,AuditRow>(), finishes=new Map<string,AuditRow>(), attemptsByHash=new Map<string,number>();
  for(const [i,line] of text.split('\n').entries()) { if(!line)continue; let v:unknown; try{v=JSON.parse(line) as unknown;}catch{throw new Error(`Admin1 audit JSON malformed at line ${i+1}`);} const r=obj(v,`Admin1 audit ${i+1}`);if(canonical(r)!==line)throw new Error(`Admin1 audit line ${i+1} is not canonical JSON`);
    const allowed=r.event==='start'?['schemaVersion','id','hash','identity','event','status','reservation','measured','complete','startedAt']:['schemaVersion','id','hash','identity','event','status','reservation','measured','complete','startedAt','endedAt','error','sourceBytes'];
    if(Object.keys(r).some(key=>!allowed.includes(key))||allowed.filter(key=>key!=='error').some(key=>!(key in r)))throw new TypeError(`Admin1 audit ${i+1} has missing or unknown fields`);
    if('error'in r&&(typeof r.error!=='string'||r.error.length>2000))throw new TypeError('Admin1 audit error text is invalid');
    const identity=obj(r.identity,'Admin1 audit request identity');
    if(Object.keys(identity).length!==4||identity.path!==ARTIFACT||typeof identity.release!=='string'||!HEX40.test(identity.release)||typeof identity.blob!=='string'||!HEX40.test(identity.blob)||!Number.isSafeInteger(identity.expectedBytes)||Number(identity.expectedBytes)<1||Number(identity.expectedBytes)>ADMIN1_CAPTURE_LIMITS.sourceBytes||sha256(canonical(identity))!==r.hash)throw new Error('Admin1 audit request identity is corrupt');
    if(r.schemaVersion!==1||typeof r.id!=='string'||!/^[a-f0-9-]{36}$/.test(r.id)||typeof r.hash!=='string'||!HEX64.test(r.hash)||!['start','finish'].includes(String(r.event))||typeof r.startedAt!=='string'||!Number.isFinite(Date.parse(r.startedAt))||!Number.isSafeInteger(r.reservation)||typeof r.complete!=='boolean'||!(r.measured===null||(Number.isSafeInteger(r.measured)&&Number(r.measured)>=0)))throw new Error('Admin1 audit identity/value is corrupt');
    const row=r as AuditRow;
    if(row.event==='start'){ if(row.status!=='pending'||row.measured!==null||row.complete||row.reservation<1||row.reservation>ADMIN1_CAPTURE_LIMITS.sourceBytes+ADMIN1_CAPTURE_LIMITS.overshootBytes||starts.has(row.id))throw new Error('Admin1 audit start invalid'); starts.set(row.id,row); attemptsByHash.set(row.hash,(attemptsByHash.get(row.hash)??0)+1); }
    else { const start=starts.get(row.id); if(!start||finishes.has(row.id)||row.hash!==start.hash||canonical(row.identity)!==canonical(start.identity)||row.startedAt!==start.startedAt||!['success','failure'].includes(row.status)||typeof row.endedAt!=='string'||!Number.isFinite(Date.parse(row.endedAt))||Date.parse(row.endedAt)<Date.parse(row.startedAt)||row.reservation<0||!Number.isSafeInteger(row.reservation)||row.complete&&row.measured===null||row.complete&&row.reservation!==row.measured||!row.complete&&(row.reservation<start.reservation||row.measured!==null&&row.reservation<row.measured)||!Number.isSafeInteger(row.sourceBytes)||row.sourceBytes!==identity.expectedBytes||row.status==='success'&&(row.error!==undefined||!row.complete||row.measured!==identity.expectedBytes)||row.status==='failure'&&(!('error'in row)||typeof row.error!=='string'))throw new Error('Admin1 audit terminal invalid or releases an unknown reservation'); finishes.set(row.id,row); }
    rows.push(row);
  }
  for(const id of finishes.keys())if(!starts.has(id))throw new Error('Admin1 audit has orphan terminal');
  let reserved=0; for(const [id,start] of starts){const finish=finishes.get(id);reserved+=finish?finish.reservation:start.reservation;}
  if(rows.length>ADMIN1_CAPTURE_LIMITS.auditRecords||bytes.length>ADMIN1_CAPTURE_LIMITS.auditBytes||[...attemptsByHash.values()].some(n=>n>ADMIN1_CAPTURE_LIMITS.maxAttempts))throw new RangeError('Admin1 audit exceeds its fixed cap or per-request attempt count');
  return{rows,bytes:bytes.length,reserved,attemptsByHash};
}
async function appendAudit(cache: string,file:string,row:AuditRow,create:boolean):Promise<void>{
  const data=Buffer.from(`${canonical(row)}\n`); if(data.length>ADMIN1_CAPTURE_LIMITS.recordBytes)throw new RangeError('Admin1 audit record exceeds 8 KiB'); await inspectPath(file);
  const current=await readAudit(file); if(current.rows.length>=ADMIN1_CAPTURE_LIMITS.auditRecords||current.bytes+data.length>ADMIN1_CAPTURE_LIMITS.auditBytes)throw new RangeError('Admin1 audit is full');
  const h=await open(file,constants.O_WRONLY|constants.O_APPEND|(constants.O_NOFOLLOW??0)|(create?constants.O_CREAT|constants.O_EXCL:0),0o600); try{await h.writeFile(data);await h.sync();}finally{await h.close();} await syncDirectory(cache);
}
async function verifyMetadata(spec:Admin1CaptureSpec,root:string):Promise<{url:string;metadata:Record<string,unknown>}>{
  const file=path.resolve(root,spec.metadataPath); if(!inside(root,file)||path.relative(root,file)!==METADATA_PATH)throw new Error('Admin1 metadata path is not exact local evidence path'); await inspectPath(file);
  const bytes=await readBoundedLocalFile(file,ADMIN1_CAPTURE_LIMITS.metadataBytes); if(bytes.length!==spec.metadataBytes||sha256(bytes)!==spec.metadataSha256)throw new Error('Admin1 metadata does not match reviewed SHA/length');
  let v:unknown;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch(e){throw new Error(`Admin1 metadata is invalid UTF-8/JSON: ${errorText(e)}`);} const m=obj(v,'Admin1 GitHub metadata');
  const url=`${RAW_BASE}/${spec.release}/${ARTIFACT}`, apiBase='https://api.github.com/repos/nvkelso/natural-earth-vector'; const blob=`${apiBase}/git/blobs/${spec.expectedGitBlobSha1}`;
  if(m.name!=='ne_10m_admin_1_states_provinces.geojson'||m.path!==ARTIFACT||m.sha!==spec.expectedGitBlobSha1||m.size!==spec.expectedBytes||m.encoding!=='none'||m.content!==''||m.type!=='file'||m.download_url!==url||m.git_url!==blob||m.url!==`${apiBase}/contents/${ARTIFACT}?ref=${spec.release}`||m.html_url!==`https://github.com/nvkelso/natural-earth-vector/blob/${spec.release}/${ARTIFACT}`)throw new Error('Admin1 metadata differs from exact pinned artifact path/blob/size/URL');
  const links=obj(m._links,'Admin1 metadata links'); if(links.git!==blob||links.self!==m.url||links.html!==m.html_url)throw new Error('Admin1 metadata links do not match pinned artifact'); return{url,metadata:m};
}
function sourceFor(spec:Admin1CaptureSpec,url:string,bytes:Uint8Array){return{id:`natural-earth-admin1-10m-${spec.release}`,url,release:spec.release,license:spec.license,attribution:spec.attribution,sha256:sha256(bytes),bytes:bytes.byteLength};}
function checkResponse(response:Response,url:string):void{
  if(response.url!==url)throw new Error('Admin1 response URL differs from exact request URL');
  if(response.status!==200)throw new Error(`Admin1 returned HTTP ${response.status}; redirects/errors are not followed`);
  const encoding=response.headers.get('content-encoding'); if(encoding&&encoding.toLowerCase()!=='identity')throw new Error('Admin1 response ignored identity encoding');
  const length=response.headers.get('content-length'); if(length!==null&&(!/^\d+$/.test(length)||Number(length)>ADMIN1_CAPTURE_LIMITS.sourceBytes))throw new Error('Admin1 Content-Length exceeds source cap or is invalid');
}
async function consume(response:Response,filePath:string,signal:AbortSignal,limit:number,expectedBytes:number,setMeasured:(n:number)=>void):Promise<{bytes:number;sha:string;blob:string}>{
  if(!response.body)throw new Error('Admin1 response has no body'); const file=await open(filePath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600), reader=response.body.getReader(), h=createHash('sha256'), blob=createHash('sha1'); blob.update(`blob ${expectedBytes}\0`); let count=0,eof=false;
  const onAbort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',onAbort,{once:true});
  try{while(true){if(signal.aborted)throw signal.reason??new Error('Admin1 capture aborted');const item=await reader.read();if(signal.aborted)throw signal.reason??new Error('Admin1 capture aborted');if(item.done){eof=true;break;} const chunk=item.value;count+=chunk.byteLength;setMeasured(count);const accepted=Math.min(chunk.byteLength,Math.max(0,limit-(count-chunk.byteLength)));const bounded=chunk.subarray(0,accepted);h.update(bounded);blob.update(bounded);let offset=0;while(offset<bounded.length){const wr=await file.write(bounded,offset,bounded.length-offset);if(!wr.bytesWritten)throw new Error('Admin1 partial write made no progress');offset+=wr.bytesWritten;}if(accepted<chunk.byteLength)throw new RangeError('Admin1 response exceeded reserved network allowance');}
  }finally{signal.removeEventListener('abort',onAbort);if(!eof)await reader.cancel().catch(()=>{});reader.releaseLock();await file.sync();await file.close();}
  return{bytes:count,sha:h.digest('hex'),blob:blob.digest('hex')};
}
async function exists(file:string):Promise<boolean>{try{await lstat(file);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
async function acquireUnlocked(specValue:unknown,options:Admin1AcquisitionOptions,deadline:number):Promise<Admin1CaptureResult>{
  const spec=validateAdmin1CaptureSpec(specValue),root=options.repositoryRoot,duration=options.durationMs??ADMIN1_CAPTURE_LIMITS.durationMs;
  if(!Number.isSafeInteger(duration)||duration<1||duration>ADMIN1_CAPTURE_LIMITS.durationMs)throw new RangeError('Admin1 duration must be 1..120000 ms');
  if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root)throw new TypeError('repositoryRoot must be canonical absolute path');
  if(process.memoryUsage().rss>ADMIN1_CAPTURE_LIMITS.rssBytes)throw new Error('Admin1 capture process exceeded RSS cap before metadata read');
  if(options.signal?.aborted||Date.now()>=deadline)throw options.signal?.reason??new Error('Admin1 deadline elapsed before metadata read');
  await inspectPath(root); const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('repositoryRoot must exist as real directory');
  const buildRoot=path.join(root,'.cache','world-build'),cache=path.join(root,CACHE_RELATIVE),meta=await verifyMetadata(spec,root),identity={release:spec.release,path:ARTIFACT,blob:spec.expectedGitBlobSha1,expectedBytes:spec.expectedBytes}; const requestHash=sha256(canonical(identity));
  if(Date.now()>=deadline||process.memoryUsage().rss>ADMIN1_CAPTURE_LIMITS.rssBytes)throw new Error('Admin1 deadline or RSS cap exceeded during metadata verification');
  const inputPath=path.join(cache,`${requestHash}.geojson`),receiptPath=path.join(cache,`${requestHash}.receipt.json`),auditPath=path.join(cache,'network-audit.jsonl');
  const rssCtl=new AbortController();const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),rssCtl.signal]);
  const rssTimer=setInterval(()=>{if(process.memoryUsage().rss>ADMIN1_CAPTURE_LIMITS.rssBytes)rssCtl.abort(new Error('Admin1 capture process exceeded RSS cap'));},200);rssTimer.unref();
  const assertLive=()=>{if(process.memoryUsage().rss>ADMIN1_CAPTURE_LIMITS.rssBytes)throw new Error('Admin1 capture process exceeded RSS cap');if(signal.aborted||Date.now()>=deadline)throw signal.reason??new Error('Admin1 capture reached wall deadline');};
  try{
    assertLive();
    await inspectPath(buildRoot); const cacheExists=await exists(cache);if(!cacheExists&&options.cacheOnly)throw new Error('Admin1 cache-only directory is absent');if(!cacheExists)await ensureDirectory(cache,root);
    const usage=await treeUsage(cache); if(usage.bytes>ADMIN1_CAPTURE_LIMITS.cacheBytes)throw new RangeError('Admin1 cache exceeds 128 MiB');
    const hasInput=await exists(inputPath),hasReceipt=await exists(receiptPath);if(!hasInput&&hasReceipt)throw new Error('Admin1 orphan receipt retained for review');
    const audit=await readAudit(auditPath);
    if(hasInput){
      await inspectPath(inputPath);await inspectPath(receiptPath);assertLive();
      const raw=await readBoundedLocalFile(inputPath,ADMIN1_CAPTURE_LIMITS.sourceBytes);if(raw.length!==spec.expectedBytes||gitBlobSha1(raw)!==spec.expectedGitBlobSha1)throw new Error('Admin1 cached source size/Git blob mismatch; retained');
      assertLive();const rawSha=sha256(raw);
      if(hasReceipt){const receiptBytes=await readBoundedLocalFile(receiptPath,16*1024);let v:unknown;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receiptBytes)) as unknown;}catch{throw new Error('Admin1 receipt corrupt; retained');}const r=obj(v,'Admin1 receipt');const common=['schemaVersion','requestHash','requestIdentity','sourceId','sourceUrl','sha256','bytes','gitBlobSha1','observedHttpStatus','networkBytes','evidence'];const captured=r.evidence==='exact-pinned-response-hash-verified';const keys=captured?[...common,'startedAt','completedAt']:common;if(Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k))||r.schemaVersion!==1||r.requestHash!==requestHash||canonical(r.requestIdentity)!==canonical(identity)||r.sourceId!==`natural-earth-admin1-10m-${spec.release}`||r.sourceUrl!==meta.url||r.sha256!==rawSha||r.bytes!==raw.length||r.gitBlobSha1!==spec.expectedGitBlobSha1||r.observedHttpStatus!==(captured?200:null)||r.networkBytes!==(captured?raw.length:0)||(!captured&&r.evidence!=='verified-existing-git-blob-cache')||(captured&&(typeof r.startedAt!=='string'||!Number.isFinite(Date.parse(r.startedAt))||typeof r.completedAt!=='string'||!Number.isFinite(Date.parse(r.completedAt)))))throw new Error('Admin1 receipt does not bind exact cached source; retained');}
      else {if(usage.bytes+ADMIN1_CAPTURE_LIMITS.reserveBytes>ADMIN1_CAPTURE_LIMITS.cacheBytes||usage.entries+2>ADMIN1_CAPTURE_LIMITS.scanEntries)throw new RangeError('Admin1 cache lacks room to restore a receipt');const disk=await statfs(buildRoot);if(disk.bavail*disk.bsize<ADMIN1_CAPTURE_LIMITS.freeBytes+ADMIN1_CAPTURE_LIMITS.reserveBytes)throw new RangeError('Admin1 receipt restoration requires the 100 MiB free reserve plus 16 KiB atomic-write headroom');const body={schemaVersion:1,requestHash,requestIdentity:identity,sourceId:`natural-earth-admin1-10m-${spec.release}`,sourceUrl:meta.url,sha256:rawSha,bytes:raw.length,gitBlobSha1:spec.expectedGitBlobSha1,networkBytes:0,observedHttpStatus:null,evidence:'verified-existing-git-blob-cache'};await publishReceipt(cache,receiptPath,body);}
      assertLive();
      return{source:sourceFor(spec,meta.url,raw),input:`${CACHE_RELATIVE}/${requestHash}.geojson`,inputPath,receiptPath,cacheHit:true,networkBytes:0,requestHash};
    }
    if(options.cacheOnly)throw new Error('Admin1 cache-only source is absent');
    assertLive();
    const disk=await statfs(buildRoot);if(disk.bavail*disk.bsize<ADMIN1_CAPTURE_LIMITS.freeBytes+spec.expectedBytes)throw new RangeError('Admin1 capture requires 100 MiB free reserve plus full source reservation');
    const byHash=audit.attemptsByHash.get(requestHash)??0;if(byHash>=ADMIN1_CAPTURE_LIMITS.maxAttempts)throw new RangeError('Admin1 immutable request reached two-attempt limit');
    const reservation=spec.expectedBytes+ADMIN1_CAPTURE_LIMITS.overshootBytes;if(audit.reserved+reservation>ADMIN1_CAPTURE_LIMITS.networkBytes)throw new RangeError('Admin1 cumulative 96 MiB lifetime network allowance exhausted');
    if(audit.rows.length+2>ADMIN1_CAPTURE_LIMITS.auditRecords||audit.bytes+ADMIN1_CAPTURE_LIMITS.reserveBytes>ADMIN1_CAPTURE_LIMITS.auditBytes)throw new RangeError('Admin1 audit lacks reserved start/terminal capacity');
    if(usage.bytes+reservation+ADMIN1_CAPTURE_LIMITS.reserveBytes>ADMIN1_CAPTURE_LIMITS.cacheBytes||usage.entries+5>ADMIN1_CAPTURE_LIMITS.scanEntries)throw new RangeError('Admin1 cache lacks response/audit capacity');
    const id=randomUUID(),startedAt=new Date().toISOString(),partial=path.join(cache,`.${requestHash}.${id}.partial`);
    await appendAudit(cache,auditPath,{schemaVersion:1,id,hash:requestHash,identity,event:'start',status:'pending',reservation,measured:null,complete:false,startedAt},audit.rows.length===0);
    let measured:number|null=null,complete=false,status='failure',failure:string|null=null,httpStatus:number|null=null;
    try{
      assertLive();
      if(process.memoryUsage().rss>ADMIN1_CAPTURE_LIMITS.rssBytes)throw new Error('Admin1 capture process exceeded RSS cap before request');
      const response=await(options.fetcher??fetch)(meta.url,{method:'GET',redirect:'manual',signal,headers:{'accept-encoding':'identity',accept:'application/geo+json, application/json;q=0.9, */*;q=0.1'}});httpStatus=response.status;
      try{checkResponse(response,meta.url);}catch(e){await response.body?.cancel().catch(()=>{});throw e;}
      const hashes=await consume(response,partial,signal,reservation,spec.expectedBytes,n=>{measured=n;});measured=hashes.bytes;complete=true;
      if(hashes.bytes!==spec.expectedBytes||hashes.blob!==spec.expectedGitBlobSha1)throw new Error('Admin1 source length or Git blob SHA-1 differs from exact metadata pin');
      const raw=await readBoundedLocalFile(partial,ADMIN1_CAPTURE_LIMITS.sourceBytes);if(raw.length!==spec.expectedBytes||sha256(raw)!==hashes.sha||gitBlobSha1(raw)!==spec.expectedGitBlobSha1)throw new Error('Admin1 partial failed independent content hash checks');
      assertLive();
      await inspectPath(inputPath);try{await link(partial,inputPath);await syncDirectory(cache);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;throw new Error('Admin1 immutable source publication collision; retained');}
      const receipt={schemaVersion:1,requestHash,requestIdentity:identity,sourceId:`natural-earth-admin1-10m-${spec.release}`,sourceUrl:meta.url,sha256:hashes.sha,bytes:hashes.bytes,gitBlobSha1:hashes.blob,observedHttpStatus:httpStatus,networkBytes:measured,startedAt,completedAt:new Date().toISOString(),evidence:'exact-pinned-response-hash-verified'};
      await publishReceipt(cache,receiptPath,receipt);await unlink(partial);assertLive();status='success';
      return{source:sourceFor(spec,meta.url,raw),input:`${CACHE_RELATIVE}/${requestHash}.geojson`,inputPath,receiptPath,cacheHit:false,networkBytes:measured,requestHash};
    }catch(e){failure=errorText(e);throw e;}finally{
      const partialPath=await exists(partial)?partial:null;await appendAudit(cache,auditPath,{schemaVersion:1,id,hash:requestHash,identity,event:'finish',status, reservation:complete?measured??0:Math.max(reservation,measured??0),measured,complete,startedAt,endedAt:new Date().toISOString(),...(failure?{error:failure}:{}),sourceBytes:spec.expectedBytes},false);
      if(partialPath)await syncDirectory(cache);
    }
  }finally{clearInterval(rssTimer);}
}
async function publishReceipt(cache:string,filename:string,value:Record<string,unknown>):Promise<void>{
  const bytes=Buffer.from(`${canonical(value)}\n`);if(bytes.length>16*1024)throw new RangeError('Admin1 receipt exceeds 16 KiB');const tmp=`${filename}.${randomUUID()}.tmp`;const h=await open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}try{await inspectPath(filename);await link(tmp,filename);await syncDirectory(cache);}finally{await unlink(tmp).catch(()=>{});}
}

/** Verify or capture the exact commit-pinned Admin1 source. */
export async function acquireAdmin1Source(specValue:unknown,options:Admin1AcquisitionOptions):Promise<Admin1CaptureResult>{
  const spec=validateAdmin1CaptureSpec(specValue);const root=options.repositoryRoot;if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root)throw new TypeError('repositoryRoot must be canonical absolute path');
  const duration=options.durationMs??ADMIN1_CAPTURE_LIMITS.durationMs;if(!Number.isSafeInteger(duration)||duration<1||duration>ADMIN1_CAPTURE_LIMITS.durationMs)throw new RangeError('Admin1 duration must be 1..120000 ms');
  const started=Date.now(),deadline=started+duration,deadlineController=new AbortController(),timer=setTimeout(()=>deadlineController.abort(new Error('Admin1 capture reached wall deadline')),duration);const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),deadlineController.signal]);
  const buildRoot=path.join(root,'.cache','world-build');try{return await withAcquisitionBuildLock(buildRoot,()=>acquireUnlocked(spec,{...options,signal,durationMs:Math.max(1,deadline-Date.now())},deadline),{signal,timeoutMs:duration});}finally{clearTimeout(timer);}
}
