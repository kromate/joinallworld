import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, statfs, link, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { FINE_LIMITS } from './fine-types.ts';
import { FINE_POINTER_LIMITS, type FinePointerAcquisitionOptions, type FinePointerAcquisitionResult, type FinePromotionRequest } from './fine-promotion-types.ts';
import { validateFinePromotionRequest } from './fine-promotion.ts';
import { parseFineLFSPointer } from './fine-lfs.ts';

const CACHE = '.cache/world-build/fine-pointer-cache';
const AUDIT = '.cache/world-build/fine-pointer-audit';
const SHA = /^[a-f0-9]{64}$/;
type AuditRecord = { schemaVersion: 1; attemptId: string; event: 'started' | 'finished'; requestHash: string; requestIdentity: string; startedAt?: string; endedAt?: string; status: string; networkReservationUpperBoundBytes: number; networkBytesMeasured: number | null; responseComplete?: boolean; reason?: string | null };

function errText(e: unknown): string { return (e instanceof Error ? e.message : String(e)).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1000); }
function abortable<T>(work:Promise<T>,signal:AbortSignal,onLate?:(value:T)=>void):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    let settled=false;
    const abort=()=>{if(settled)return;settled=true;reject(signal.reason??new Error('fine pointer acquisition aborted'));};
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    work.then(value=>{if(settled){onLate?.(value);return;}settled=true;signal.removeEventListener('abort',abort);resolve(value);},error=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(error);});
  });
}
function inside(root: string, target: string): boolean { const rel = path.relative(root, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); }
async function inspectPath(target: string): Promise<void> {
  const resolved = path.resolve(target), fsRoot = path.parse(resolved).root;
  let cursor = fsRoot;
  for (const [i, part] of resolved.slice(fsRoot.length).split(path.sep).filter(Boolean).entries()) {
    cursor = path.join(cursor, part);
    try { const st = await lstat(cursor); if (st.isSymbolicLink() || (i < resolved.slice(fsRoot.length).split(path.sep).filter(Boolean).length - 1 && !st.isDirectory())) throw new Error(`unsafe symlink/non-directory path: ${cursor}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  }
}
async function ensureDirectory(target: string, root: string): Promise<void> {
  if (!inside(root, target)) throw new Error('fine pointer path escapes repository');
  const fsRoot = path.parse(target).root; let cursor = fsRoot;
  for (const part of target.slice(fsRoot.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const st = await lstat(cursor); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`unsafe pointer directory: ${cursor}`);
  }
}
async function syncDir(dir: string): Promise<void> { const h = await open(dir, constants.O_RDONLY); try { await h.sync(); } finally { await h.close(); } }
async function treeBytes(root: string,check:()=>void): Promise<{bytes:number;entries:number}> {
  let entries=0, bytes=0;
  const walk=async(dir:string,depth:number):Promise<void>=>{
    check();
    if(depth>FINE_POINTER_LIMITS.scanDepth) throw new RangeError('fine pointer cache exceeds depth cap');
    const st=await lstat(dir); if(st.isSymbolicLink()||!st.isDirectory()) throw new Error('fine pointer cache contains unsafe directory');
    const dh=await opendir(dir);
    for await(const ent of dh){ check();if(++entries>FINE_POINTER_LIMITS.scanEntries) throw new RangeError('fine pointer cache exceeds entry cap'); const p=path.join(dir,ent.name), cs=await lstat(p); if(cs.isSymbolicLink()) throw new Error('fine pointer cache symlink refused'); if(cs.isDirectory()) await walk(p,depth+1); else if(cs.isFile()) bytes+=cs.size; else throw new Error('fine pointer cache contains non-file entry'); if(bytes>FINE_POINTER_LIMITS.cacheBytes) throw new RangeError('fine pointer cache exceeds byte cap'); }
  };
  try { await lstat(root); } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT') return {bytes,entries}; throw e; }
  await walk(root,0); return {bytes,entries};
}
async function readAudit(filename:string):Promise<{records:AuditRecord[];bytes:number;charged:number}> {
  let b:Buffer;
  try { b=await readBoundedLocalFile(filename,FINE_POINTER_LIMITS.auditBytes); } catch(e){ if((e as NodeJS.ErrnoException).code==='ENOENT') return {records:[],bytes:0,charged:0}; throw new Error(`fine pointer audit cannot be verified: ${errText(e)}`); }
  if(b.length && b[b.length-1]!==10) throw new Error('fine pointer audit has an incomplete trailing record');
  const records:AuditRecord[]=[];
  try { const text=new TextDecoder('utf-8',{fatal:true}).decode(b); const lines=text?text.slice(0,-1).split('\n'):[]; if(lines.some(line=>!line||Buffer.byteLength(line)>4096))throw new Error('invalid audit record boundary/size'); for(const line of lines) records.push(JSON.parse(line) as AuditRecord); } catch { throw new Error('fine pointer audit is malformed UTF-8/JSON'); }
  if(records.length>FINE_POINTER_LIMITS.auditEntries) throw new RangeError('fine pointer audit exceeds record cap');
  const starts=new Map<string,AuditRecord>(), finished=new Set<string>(); let charged=0;
  for(const r of records){
    if(!r||r.schemaVersion!==1||!/^[-a-f0-9]{36}$/.test(r.attemptId)||!['started','finished'].includes(r.event)||!SHA.test(r.requestHash)||!SHA.test(r.requestIdentity)||!Number.isSafeInteger(r.networkReservationUpperBoundBytes)||r.networkReservationUpperBoundBytes<0||!(r.networkBytesMeasured===null||(Number.isSafeInteger(r.networkBytesMeasured)&&r.networkBytesMeasured>=0))) throw new Error('fine pointer audit contains invalid record');
    const fields=Object.keys(r).sort().join(',');
    if(r.event==='started'){
      if(fields!==['attemptId','event','networkBytesMeasured','networkReservationUpperBoundBytes','requestHash','requestIdentity','schemaVersion','startedAt','status'].sort().join(',')||starts.has(r.attemptId)||r.requestHash!==r.requestIdentity||r.status!=='pending'||r.networkReservationUpperBoundBytes!==FINE_POINTER_LIMITS.pointerBytes||r.networkBytesMeasured!==null||typeof r.startedAt!=='string'||!Number.isFinite(Date.parse(r.startedAt))) throw new Error('fine pointer audit contains invalid start');
      starts.set(r.attemptId,r);
    } else {
      if(fields!==['attemptId','endedAt','event','networkBytesMeasured','networkReservationUpperBoundBytes','reason','requestHash','requestIdentity','responseComplete','schemaVersion','status'].sort().join(',')||!['success','failure'].includes(r.status)||typeof r.endedAt!=='string'||!Number.isFinite(Date.parse(r.endedAt))||!(r.reason===null||(typeof r.reason==='string'&&r.reason.length<=1000))) throw new Error('fine pointer audit contains invalid terminal shape');
      const s=starts.get(r.attemptId); if(!s||finished.has(r.attemptId)||s.requestHash!==r.requestHash||s.requestIdentity!==r.requestIdentity||typeof r.responseComplete!=='boolean') throw new Error('fine pointer audit contains invalid terminal');
      if(r.responseComplete ? (r.networkBytesMeasured===null||r.networkReservationUpperBoundBytes!==r.networkBytesMeasured) : r.networkReservationUpperBoundBytes<Math.max(FINE_POINTER_LIMITS.pointerBytes,r.networkBytesMeasured??0)) throw new Error('fine pointer audit releases unknown transfer reservation');
      if(r.status==='success' ? (!r.responseComplete||r.reason!==null) : (r.reason===null)) throw new Error('fine pointer audit status/evidence mismatch');
      finished.add(r.attemptId);
    }
  }
  for(const [id,s] of starts){const t=records.find(x=>x.attemptId===id&&x.event==='finished'); charged+=t ? t.networkReservationUpperBoundBytes : s.networkReservationUpperBoundBytes; if(!Number.isSafeInteger(charged))throw new RangeError('fine pointer cumulative audit charge is outside safe integer range');}
  return {records,bytes:b.length,charged};
}
async function appendAudit(dir:string,record:AuditRecord):Promise<void>{
  const data=Buffer.from(`${canonicalJson(record)}\n`); if(data.length>4096) throw new RangeError('fine pointer audit record exceeds reservation');
  const filename=path.join(dir,'attempts.jsonl'); await inspectPath(filename); const old=await readAudit(filename);
  if(old.records.length>=FINE_POINTER_LIMITS.auditEntries||old.bytes+data.length>FINE_POINTER_LIMITS.auditBytes) throw new RangeError('fine pointer audit capacity exhausted');
  const h=await open(filename,constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600); try{await h.writeFile(data);await h.sync();}finally{await h.close();} await syncDir(dir);
}
async function writeImmutable(target:string,bytes:Uint8Array,dir:string):Promise<void>{
  const tmp=path.join(dir,`.${path.basename(target)}.${randomUUID()}.partial`), h=await open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
  try{await inspectPath(target);await link(tmp,target);await syncDir(dir);}finally{await unlink(tmp).catch(()=>{});}
}
async function consume(response:Response,signal:AbortSignal):Promise<{bytes:Uint8Array;complete:boolean;delivered:number;failure?:unknown}>{
  if(!response.body) return {bytes:new Uint8Array(),complete:true,delivered:0};
  const chunks:Uint8Array[]=[];let retained=0,delivered=0,complete=false,pending:Promise<ReadableStreamReadResult<Uint8Array>>|null=null; const reader=response.body.getReader();
  try{
    for(;;){
      if(signal.aborted) throw signal.reason??new Error('pointer acquisition aborted');
      pending=reader.read(); const item=await abortable(pending,signal); pending=null;
      if(item.done){complete=true;break;}
      const chunk=item.value; delivered+=chunk.byteLength;
      if(retained+chunk.byteLength>FINE_POINTER_LIMITS.pointerBytes){void reader.cancel().catch(()=>{});return {bytes:new Uint8Array(),complete:false,delivered};}
      chunks.push(chunk.slice());retained+=chunk.byteLength;
    }
  } catch(failure) {
    const out=new Uint8Array(retained);let off=0;for(const c of chunks){out.set(c,off);off+=c.length;}return {bytes:out,complete:false,delivered,failure};
  } finally {
    if(!complete){void reader.cancel().catch(()=>{}); if(pending){void pending.finally(()=>{try{reader.releaseLock();}catch{}}).catch(()=>{});}else{try{reader.releaseLock();}catch{}}}
    else reader.releaseLock();
  }
  const out=new Uint8Array(retained);let off=0;for(const c of chunks){out.set(c,off);off+=c.length;}return {bytes:out,complete,delivered};
}
function strictPointerUrl(request:FinePromotionRequest):void {
  const expected=`https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${request.commit}/releaseData/gbOpen/${request.country.iso3}/ADM1/geoBoundaries-${request.country.iso3}-ADM1.geojson`;
  if(!/^[a-f0-9]{40}$/.test(request.commit)||request.pointerUrl!==expected) throw new TypeError('pointer URL must be the exact pinned raw GitHub ADM1 path');
}

/** Fetch and retain only the exact, bounded LFS pointer selected by a reviewed promotion request. */
export async function acquireFinePointer(requestValue:FinePromotionRequest,options:FinePointerAcquisitionOptions):Promise<FinePointerAcquisitionResult>{
  const request=validateFinePromotionRequest(requestValue); strictPointerUrl(request);
  if(!options||typeof options.repositoryRoot!=='string'||!path.isAbsolute(options.repositoryRoot)||/[\0\r\n]/.test(options.repositoryRoot)) throw new TypeError('repositoryRoot must be an absolute canonical path');
  const duration=options.durationMs??FINE_POINTER_LIMITS.durationMs; if(!Number.isSafeInteger(duration)||duration<1||duration>FINE_POINTER_LIMITS.durationMs) throw new RangeError('fine pointer duration must be 1..30,000 ms');
  const root=path.resolve(options.repositoryRoot); await inspectPath(root); const rootStat=await lstat(root); if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||await realpath(root)!==root) throw new Error('repositoryRoot must be an existing canonical real directory');
  const buildRoot=path.join(root,'.cache','world-build'), cache=path.join(root,CACHE), audit=path.join(root,AUDIT);
  const identity=sha256(canonicalJson(request)), requestHash=identity, pointerPath=path.join(cache,`${requestHash}.pointer`), receiptPath=path.join(cache,`${requestHash}.receipt.json`), auditPath=path.join(audit,'attempts.jsonl');
  const started=Date.now(), deadline=started+duration, timerController=new AbortController(), timer=setTimeout(()=>timerController.abort(new Error('fine pointer acquisition reached wall deadline')),duration), signal=options.signal?AbortSignal.any([options.signal,timerController.signal]):timerController.signal;
  try{
    return await withAcquisitionBuildLock(buildRoot,async()=>{
      if(signal.aborted||Date.now()>=deadline) throw signal.reason??new Error('fine pointer deadline expired before cache admission');
      await ensureDirectory(cache,root); await ensureDirectory(audit,root);
      const live=()=>{if(signal.aborted||Date.now()>=deadline)throw signal.reason??new Error('fine pointer acquisition deadline expired during local verification');};
      live();const ctree=await treeBytes(cache,live), atree=await treeBytes(audit,live); if(atree.bytes>FINE_POINTER_LIMITS.auditBytes||ctree.entries+atree.entries>FINE_POINTER_LIMITS.scanEntries) throw new RangeError('fine pointer audit/cache exceeds traversal cap');live();
      const ast=await readAudit(auditPath);
      let body:Buffer|null=null; try{body=await readBoundedLocalFile(pointerPath,FINE_POINTER_LIMITS.pointerBytes);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT') throw new Error(`pointer cache is unsafe/corrupt and retained: ${errText(e)}`);}
      let receipt:Record<string,unknown>|null=null; try{const rb=await readBoundedLocalFile(receiptPath,8192),parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rb));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('receipt must be object');receipt=parsed as Record<string,unknown>;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT') throw new Error(`pointer receipt is corrupt/unsafe and retained: ${errText(e)}`);}
      if(!body&&receipt) throw new Error('pointer receipt exists without body; retained for review');
      if(body){
        const parsed=parseFineLFSPointer(body,FINE_LIMITS.sourceBytes), bodyHash=sha256(body);
        const expected={schemaVersion:1,requestHash,requestIdentity:identity,pointerSha256:bodyHash,pointerBytes:body.length,lfs:parsed};
        if(receipt){
          const evidence=receipt.evidence;
          const allowed=evidence==='verified-existing-content-addressed-cache'
            ? ['schemaVersion','requestHash','requestIdentity','pointerSha256','pointerBytes','lfs','evidence','completedAt']
            : evidence==='exact-pinned-response-hash-verified'
              ? ['schemaVersion','requestHash','requestIdentity','pointerSha256','pointerBytes','lfs','evidence','observedHttpStatus','networkBytes','startedAt','completedAt'] : [];
          if(!allowed.length||Object.keys(receipt).length!==allowed.length||Object.keys(receipt).some(k=>!allowed.includes(k))) throw new Error('pointer receipt schema is invalid; retained');
          for(const[k,v]of Object.entries(expected))if(canonicalJson(receipt[k])!==canonicalJson(v))throw new Error('pointer receipt does not bind cached body/request; retained');
          if(typeof receipt.completedAt!=='string'||!Number.isFinite(Date.parse(receipt.completedAt))
            ||(evidence==='exact-pinned-response-hash-verified'&&(receipt.observedHttpStatus!==200||receipt.networkBytes!==body.length||typeof receipt.startedAt!=='string'||!Number.isFinite(Date.parse(receipt.startedAt))))) throw new Error('pointer receipt evidence is invalid; retained');
        }
        else {
          const rec={...expected,evidence:'verified-existing-content-addressed-cache',completedAt:new Date().toISOString()},receiptBytes=Buffer.from(`${canonicalJson(rec)}\n`);
          const disk=await statfs(buildRoot); if(ctree.bytes+2*receiptBytes.length>FINE_POINTER_LIMITS.cacheBytes||ctree.entries+2>FINE_POINTER_LIMITS.scanEntries||disk.bavail*disk.bsize<FINE_POINTER_LIMITS.freeBytes+2*receiptBytes.length) throw new RangeError('pointer cache lacks receipt/free-space headroom');
          await writeImmutable(receiptPath,receiptBytes,cache);
        }
        if(signal.aborted||Date.now()>=deadline) throw signal.reason??new Error('pointer cache verification exceeded deadline');
        return {requestHash,pointerPath,receiptPath,pointerBytes:new Uint8Array(body),pointer:parsed,networkBytes:0,cacheHit:true};
      }
      if(options.cacheOnly) throw new Error('fine pointer cache-only request has no verified pointer');
      if(ast.charged+FINE_POINTER_LIMITS.pointerBytes>FINE_POINTER_LIMITS.networkBytes) throw new RangeError('fine pointer lifetime network reservation exhausted');
      if(ast.records.length+2>FINE_POINTER_LIMITS.auditEntries||ast.bytes+8192>FINE_POINTER_LIMITS.auditBytes) throw new RangeError('fine pointer audit cannot reserve start and terminal records');
      if(ctree.bytes+FINE_POINTER_LIMITS.pointerBytes+8192+8192>FINE_POINTER_LIMITS.cacheBytes||ctree.entries+4>FINE_POINTER_LIMITS.scanEntries) throw new RangeError('fine pointer cache lacks body, receipt, temporary-entry and traversal headroom');
      const fs=await statfs(buildRoot);if(fs.bavail*fs.bsize<FINE_POINTER_LIMITS.freeBytes+FINE_POINTER_LIMITS.pointerBytes+16*1024)throw new RangeError('fine pointer acquisition requires 100 MiB free reserve and output/audit headroom');
      const attemptId=randomUUID(), startAt=new Date().toISOString(); await appendAudit(audit,{schemaVersion:1,attemptId,event:'started',requestHash,requestIdentity:identity,startedAt:startAt,status:'pending',networkReservationUpperBoundBytes:FINE_POINTER_LIMITS.pointerBytes,networkBytesMeasured:null});
      let measured:number|null=null, complete=false,status='failure',reason:string|null=null,observedStatus:number|null=null;
      try{
        if(signal.aborted||Date.now()>=deadline) throw signal.reason??new Error('pointer deadline expired before request');
        const fetchPromise=Promise.resolve((options.fetcher??fetch)(request.pointerUrl,{method:'GET',redirect:'manual',signal,headers:{'accept-encoding':'identity','accept':'text/plain, */*;q=0.1'}}));
        const response=await abortable(fetchPromise,signal,late=>{void late.body?.cancel().catch(()=>{});}); observedStatus=response.status;
        const enc=response.headers.get('content-encoding'),len=response.headers.get('content-length');
        if(response.status!==200||response.url!==request.pointerUrl||(enc&&enc.toLowerCase()!=='identity')||len===null||!/^[1-9][0-9]*$/.test(len)||Number(len)>FINE_POINTER_LIMITS.pointerBytes){void response.body?.cancel().catch(()=>{});throw new Error('pointer response status, URL, encoding, or Content-Length failed strict admission');}
        const consumed=await consume(response,signal); complete=consumed.complete; measured=consumed.complete?consumed.delivered:(consumed.delivered>0?consumed.delivered:null);
        if(consumed.failure) throw consumed.failure;
        if(Number(len)!==consumed.delivered) throw new Error('pointer Content-Length does not match delivered bytes');
        if(!complete||consumed.delivered>FINE_POINTER_LIMITS.pointerBytes) throw new RangeError('pointer response exceeded bounded complete body');
        const lfs=parseFineLFSPointer(consumed.bytes,FINE_LIMITS.sourceBytes), bodyHash=sha256(consumed.bytes);
        if(signal.aborted||Date.now()>=deadline) throw signal.reason??new Error('pointer acquisition deadline expired before publication');
        const rec={schemaVersion:1,requestHash,requestIdentity:identity,pointerSha256:bodyHash,pointerBytes:consumed.bytes.length,lfs,evidence:'exact-pinned-response-hash-verified',observedHttpStatus:observedStatus,networkBytes:consumed.delivered,startedAt:startAt,completedAt:new Date().toISOString()};
        await writeImmutable(pointerPath,consumed.bytes,cache);
        if(signal.aborted||Date.now()>=deadline) throw signal.reason??new Error('pointer acquisition deadline expired before receipt publication');
        await writeImmutable(receiptPath,Buffer.from(`${canonicalJson(rec)}\n`),cache);
        if(signal.aborted||Date.now()>=deadline) throw signal.reason??new Error('pointer acquisition deadline expired after receipt publication');
        status='success';
        return {requestHash,pointerPath,receiptPath,pointerBytes:consumed.bytes,pointer:lfs,networkBytes:consumed.delivered,cacheHit:false};
      }catch(e){reason=errText(e);throw new Error(`${reason}; failure evidence: ${auditPath}`);}finally{
        await appendAudit(audit,{schemaVersion:1,attemptId,event:'finished',requestHash,requestIdentity:identity,endedAt:new Date().toISOString(),status,networkReservationUpperBoundBytes:complete?measured??0:Math.max(FINE_POINTER_LIMITS.pointerBytes,measured??0),networkBytesMeasured:measured,responseComplete:complete,reason});
      }
    },{signal,timeoutMs:Math.max(1,Math.min(duration,deadline-Date.now()))});
  }finally{clearTimeout(timer);}
}
