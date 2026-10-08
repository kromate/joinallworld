import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, opendir, lstat, realpath, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import {
  ADMIN1_TOPOLOGY_LIMITS as LIMITS,
  ADMIN1_TOPOLOGY_VALIDATOR,
  type Admin1TopologyBinding, type Admin1TopologyReport, type Admin1TopologyResult,
  type Admin1TopologyTooling, type Admin1TopologyWorkerReport,
} from './admin1-topology-types.ts';
import { bindAdmin1TopologyReport, validateAdmin1TopologyReport, validateAdmin1TopologyWorkerReport } from './admin1-topology-quality.ts';
import type { Admin1ParentPin, Admin1SourcePin, Admin1InspectionReport } from './admin1-types.ts';
import type { Admin1ProductManifest } from './admin1-product-types.ts';

const HASH = /^[a-f0-9]{64}$/;
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFIER = path.join(MODULE_ROOT, 'world', 'tooling', 'verify_admin1_product.ts');
const PYTHON = path.join(MODULE_ROOT, '.cache', 'world-build', 'tooling', 'venv', 'bin', 'python3.12');
const PYTHON_WORKER = path.join(MODULE_ROOT, 'world', 'tooling', 'admin1_topology.py');
const GEOMETRY_HELPER = path.join(MODULE_ROOT, 'world', 'tooling', 'fine_topology.py');
const ERR_MAX = 2_000;
const sha = (v: Uint8Array | string): string => createHash('sha256').update(v).digest('hex');
const canonical = (v: unknown): string => {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new TypeError('topology value contains non-finite number'); return JSON.stringify(v); }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`; }
  throw new TypeError('topology value is not JSON data');
};
const safeText = (v: unknown, label: string, max = ERR_MAX): string => {
  if (typeof v !== 'string' || v.length < 1 || Buffer.byteLength(v) > max || /[\u0000-\u001f\u007f]/.test(v)) throw new TypeError(`${label} is invalid bounded text`);
  return v;
};
const auditError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/[^\x20-\x7e]/g, '?').slice(0, ERR_MAX);
function check(signal: AbortSignal, deadline: number): void {
  if (signal.aborted) throw signal.reason ?? new Error('Admin1 topology run aborted');
  if (performance.now() >= deadline) throw new Error('Admin1 topology operation exceeded its deadline');
  if (process.memoryUsage().rss > LIMITS.rssBytes) throw new RangeError('Admin1 topology controller exceeded 512 MiB RSS');
}
function inside(root: string, child: string): boolean { const rel = path.relative(root, child); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); }
async function safePath(filename: string): Promise<void> {
  const target = path.resolve(filename); let cursor = path.parse(target).root;
  for (const [i, part] of target.slice(cursor.length).split(path.sep).filter(Boolean).entries()) {
    cursor = path.join(cursor, part); let info;
    try { info = await lstat(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || (cursor !== target && !info.isDirectory())) throw new Error(`Admin1 topology path has unsafe ancestor: ${cursor}`);
  }
}
async function ensureDir(target: string, root: string): Promise<void> {
  if (!inside(root, target)) throw new Error('Admin1 topology directory escaped build root');
  await safePath(root);
  const rel = path.relative(root, target); let current = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Admin1 topology directory is unsafe');
  }
}
async function treeUsage(root: string, deadline: number, signal: AbortSignal): Promise<{bytes:number;entries:number}> {
  let bytes = 0, entries = 0;
  const visit = async (dir: string, depth: number): Promise<void> => {
    check(signal, deadline); if (depth > LIMITS.treeDepth) throw new RangeError('Admin1 topology tree depth exceeds 5');
    let info; try { info = await lstat(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && dir === root) return; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Admin1 topology tree path is unsafe');
    const handle = await opendir(dir);
    try { for await (const ent of handle) {
      check(signal, deadline); if (++entries > LIMITS.treeEntries) throw new RangeError('Admin1 topology tree exceeds 512 entries');
      const file = path.join(dir, ent.name), child = await lstat(file);
      if (child.isSymbolicLink()) throw new Error('Admin1 topology tree contains symlink');
      if (child.isDirectory()) await visit(file, depth + 1); else if (child.isFile()) bytes += child.size; else throw new Error('Admin1 topology tree contains non-regular entry');
      if (bytes > LIMITS.treeBytes) throw new RangeError('Admin1 topology tree exceeds 16 MiB');
    } } finally { await handle.close().catch(() => {}); }
  };
  await visit(root, 0); return {bytes,entries};
}
function parseCanonical(bytes: Uint8Array, label: string, newline: boolean): unknown {
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  if (newline ? !text.endsWith('\n') || text.endsWith('\n\n') : text.endsWith('\n')) throw new Error(`${label} newline policy mismatch`);
  const value: unknown = JSON.parse(text);
  if (text !== `${canonical(value)}${newline ? '\n' : ''}`) throw new Error(`${label} is not canonical JSON`);
  return value;
}
async function atomicAppend(filename: string, value: Record<string,unknown>, create: boolean): Promise<void> {
  const line = Buffer.from(`${canonical(value)}\n`);
  if (line.length > LIMITS.auditRecordBytes) throw new RangeError('Admin1 topology audit record exceeds 8 KiB');
  const flags = constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0) | (create ? constants.O_CREAT | constants.O_EXCL : 0);
  const fd = await open(filename, flags, 0o600);
  try { const st = await fd.stat(); if (!st.isFile() || st.size + line.length > LIMITS.attemptsPerRequest * LIMITS.auditRecordBytes * 2) throw new RangeError('Admin1 topology request audit exceeds its eight-attempt bound'); await fd.writeFile(line); await fd.sync(); }
  finally { await fd.close(); }
  const dir = await open(path.dirname(filename), constants.O_RDONLY); try { await dir.sync(); } finally { await dir.close(); }
}
async function validateAudits(auditRoot: string, reportRoot: string, currentRequestHash: string, expectedRequest: Record<string, unknown>, binding: Admin1TopologyBinding, signal:AbortSignal,deadline:number): Promise<{entries:number;bytes:number;starts:Map<string,number>}> {
  let entries=0,bytes=0; const starts=new Map<string,number>();
  const verifiedReports=new Map<string,Admin1TopologyReport>();
  let dir; try { dir=await opendir(auditRoot); } catch (e) { if ((e as NodeJS.ErrnoException).code==='ENOENT') return {entries,bytes,starts}; throw e; }
  try { for await (const ent of dir) {
    check(signal,deadline);
    entries++; if (entries>LIMITS.auditEntries || !ent.isFile() || !/^[a-f0-9]{64}\.jsonl$/.test(ent.name)) throw new Error('Admin1 topology audit tree has invalid entries');
    const file=path.join(auditRoot,ent.name), info=await lstat(file); if(info.isSymbolicLink()||!info.isFile()||info.size>LIMITS.attemptsPerRequest*LIMITS.auditRecordBytes*2)throw new Error('Admin1 topology audit file is unsafe or oversized');
    const raw=await readBoundedLocalFile(file,LIMITS.attemptsPerRequest*LIMITS.auditRecordBytes*2); bytes+=raw.length; if(bytes>LIMITS.auditBytes)throw new RangeError('Admin1 topology audit tree exceeds 1 MiB');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);const lines=text.split('\n'); if(lines.at(-1)!=='')throw new Error('Admin1 topology audit is truncated'); const records=lines.slice(0,-1);
    let n=0; const ids=new Map<string,{request:unknown;startedAt:number;expectedUnits:number}>(); const finished=new Set<string>();
    let canonicalRequest:string|undefined;
    for(const line of records){
      check(signal,deadline);
      if(Buffer.byteLength(line)+1>LIMITS.auditRecordBytes)throw new RangeError('Admin1 topology audit record exceeds 8 KiB');
      const record=JSON.parse(line) as Record<string,unknown>;
      if(record.event==='started'){
        const start=record;
      const startKeys=['schemaVersion','requestHash','attemptId','event','status','request','startedAt'];
      const reqKeys=['schemaVersion','validator','sourceSha256','sourceBytes','parentManifestHash','inspectionSha256','publicationManifestHash','expectedUnits','expectedKeysSha256','workerSha256','geometryHelperSha256','verifierSha256','spatialSha256'];
      const req=start.request&&typeof start.request==='object'&&!Array.isArray(start.request)?start.request as Record<string,unknown>:null;
      const startedAt=typeof start.startedAt==='string'?Date.parse(start.startedAt):NaN;
        if(Object.keys(start).length!==startKeys.length||startKeys.some(k=>!Object.hasOwn(start,k))||start.schemaVersion!==1||start.event!=='started'||start.status!=='pending'||start.requestHash!==ent.name.slice(0,64)||typeof start.attemptId!=='string'||!/^[-a-f0-9]{36}$/.test(start.attemptId)||!Number.isFinite(startedAt)||new Date(startedAt).toISOString()!==start.startedAt||!req||Object.keys(req).length!==reqKeys.length||reqKeys.some(k=>!Object.hasOwn(req,k))||req.schemaVersion!==1||req.validator!==ADMIN1_TOPOLOGY_VALIDATOR||![req.sourceSha256,req.parentManifestHash,req.inspectionSha256,req.publicationManifestHash,req.expectedKeysSha256,req.workerSha256,req.geometryHelperSha256,req.verifierSha256,req.spatialSha256].every(x=>typeof x==='string'&&HASH.test(x))||!Number.isSafeInteger(req.sourceBytes)||Number(req.sourceBytes)<1||Number(req.sourceBytes)>LIMITS.sourceBytes||!Number.isSafeInteger(req.expectedUnits)||Number(req.expectedUnits)<1||Number(req.expectedUnits)>LIMITS.sourceUnits||sha(canonical(req))!==start.requestHash||canonical(start)!==line||ids.has(start.attemptId)||canonicalRequest!==undefined&&canonicalRequest!==canonical(req)||(ent.name.slice(0,64)===currentRequestHash&&canonical(req)!==canonical(expectedRequest)))throw new Error('Admin1 topology start audit record is invalid');
        canonicalRequest=canonical(req);
        ids.set(start.attemptId,{request:start.request,startedAt:Date.parse(String(start.startedAt)),expectedUnits:Number(req.expectedUnits)});n++;
      }else if(record.event==='finished'){
        const end=record,entry=typeof end.attemptId==='string'?ids.get(end.attemptId):undefined;
        const baseKeys=['attemptId','endedAt','event','requestHash','schemaVersion','status'];
        const successKeys=['checkedUnits','invalidUnits','protectedUnits','reportHash','reportPath','unsupportedUnits','validUnits'];
        const failureKeys=['error']; const extras=Object.keys(end).filter(k=>!baseKeys.includes(k)).sort();
        const successStatus=end.status==='success'||end.status==='findings';
        const endedAt=typeof end.endedAt==='string'?Date.parse(end.endedAt):NaN;
        if(!entry||finished.has(String(end.attemptId))||baseKeys.some(k=>!Object.hasOwn(end,k))||Object.keys(end).length!==baseKeys.length+(successStatus?successKeys.length:failureKeys.length)||extras.join(',')!==(successStatus?successKeys:failureKeys).sort().join(',')||end.schemaVersion!==1||end.requestHash!==ent.name.slice(0,64)||end.event!=='finished'||!['success','findings','failed','aborted','timed-out'].includes(String(end.status))||!Number.isFinite(endedAt)||new Date(endedAt).toISOString()!==end.endedAt||endedAt<entry.startedAt||canonical(end)!==line)throw new Error('Admin1 topology terminal audit record is invalid');
        if(successStatus&&(!HASH.test(String(end.reportHash))||end.reportPath!==`reports/${end.requestHash}/${end.reportHash}.json`||![end.checkedUnits,end.invalidUnits,end.protectedUnits,end.unsupportedUnits,end.validUnits].every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)||Number(end.validUnits)+Number(end.invalidUnits)!==Number(end.checkedUnits)||Number(end.checkedUnits)+Number(end.unsupportedUnits)+Number(end.protectedUnits)!==entry.expectedUnits||(end.status==='success'&&(end.invalidUnits!==0||end.unsupportedUnits!==0))||(end.status==='findings'&&end.invalidUnits===0&&end.unsupportedUnits===0)))throw new Error('Admin1 topology success audit result is invalid');
        if(successStatus&&ent.name.slice(0,64)===currentRequestHash){
          const reportHash=String(end.reportHash);let verified=verifiedReports.get(reportHash);
          if(!verified){
            check(signal,deadline);
            const reportBytes=await readBoundedLocalFile(path.join(reportRoot,`${reportHash}.json`),LIMITS.reportBytes);
            if(sha(reportBytes)!==reportHash)throw new Error('historical topology audit report hash mismatch');
            verified=validateAdmin1TopologyReport(parseCanonical(reportBytes,'historical Admin1 topology report',true),binding);
            check(signal,deadline);verifiedReports.set(reportHash,verified);
          }
          if(verified.checkedUnits!==end.checkedUnits||verified.invalidUnits!==end.invalidUnits||verified.protectedUnits!==end.protectedUnits||verified.unsupportedUnits!==end.unsupportedUnits||verified.validUnits!==end.validUnits||verified.sourceSha256!==expectedRequest.sourceSha256||verified.parentManifestHash!==expectedRequest.parentManifestHash||verified.inspectionSha256!==expectedRequest.inspectionSha256||verified.publicationManifestHash!==expectedRequest.publicationManifestHash||verified.tooling.workerSha256!==expectedRequest.workerSha256||verified.tooling.geometryHelperSha256!==expectedRequest.geometryHelperSha256)throw new Error('historical topology audit report does not match its request binding');
        }
        if(!successStatus)safeText(end.error,'topology audit error');
        finished.add(String(end.attemptId));
      }else throw new Error('Admin1 topology audit event is invalid');
    }
    if(n>LIMITS.attemptsPerRequest)throw new RangeError('Admin1 topology request exceeded its lifetime attempt cap');
    starts.set(ent.name.slice(0,64),n);
  } } finally { await dir.close().catch(()=>{}); }
  return {entries,bytes,starts};
}
interface Child { code:number|null; stdout:Buffer; stderr:Buffer; peakRssBytes:number|null; rssSamples:number }
export type Admin1RssProbe = { kind:'measured'; rssBytes:number } | { kind:'exiting' };
/** Parse `ps -o rss=,stat=` without treating a missing/zombie process as a zero-byte sample. */
export function classifyAdmin1RssProbe(output:string,processPresent:boolean,childTerminal:boolean):Admin1RssProbe {
  if(childTerminal)return {kind:'exiting'};
  const line=output.trim();
  if(!line){if(!processPresent)return {kind:'exiting'};throw new Error('invalid Admin1 topology child RSS measurement');}
  const match=/^(\d+)\s+([A-Za-z<>?]+\+?)$/.exec(line);
  if(!match)throw new Error('invalid Admin1 topology child RSS measurement');
  const kib=Number(match[1]);
  if(!Number.isSafeInteger(kib)||kib<0)throw new Error('invalid Admin1 topology child RSS measurement');
  if(match[2]!.includes('Z'))return {kind:'exiting'};
  if(kib<1){if(!processPresent)return {kind:'exiting'};throw new Error('invalid Admin1 topology child RSS measurement');}
  const rssBytes=kib*1024;
  if(!Number.isSafeInteger(rssBytes))throw new Error('invalid Admin1 topology child RSS measurement');
  return {kind:'measured',rssBytes};
}
function processPresent(pid:number):boolean {
  try { process.kill(pid,0);return true; }
  catch(error) { const code=(error as NodeJS.ErrnoException).code;if(code==='ESRCH')return false;if(code==='EPERM')return true;throw error; }
}
async function runChild(executable:string,args:string[],cwd:string,input:Buffer,maxStdout:number,maxStderr:number,signal:AbortSignal,deadline:number,acceptedCodes:readonly number[]=[0],onSpawn?:(pid:number)=>void):Promise<Child> {
  check(signal,deadline);
  const child=spawn(executable,args,{cwd,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{PATH:path.dirname(executable),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
  const stdout:Buffer[]=[],stderr:Buffer[]=[];let outSize=0,errSize=0,closed=false,closeInfo:Child|null=null,failure:Error|null=null,peak:number|null=null,samples=0;
  let resolveClose!:(v:Child)=>void;const closePromise=new Promise<Child>(resolve=>{resolveClose=resolve;});
  const fail=(error:Error):void=>{failure??=error;if(!closed&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};
  child.stdout.on('data',(b:Buffer)=>{outSize+=b.length;if(outSize>maxStdout){fail(new RangeError('Admin1 topology child stdout exceeded cap'));return;}stdout.push(b);});
  child.stderr.on('data',(b:Buffer)=>{errSize+=b.length;if(errSize>maxStderr){fail(new RangeError('Admin1 topology child stderr exceeded cap'));return;}stderr.push(b);});
  child.stdin.on('error',e=>fail(e));child.once('error',e=>fail(e));
  if(onSpawn)child.once('spawn',()=>{if(!child.pid)fail(new Error('Admin1 topology child has no PID'));else try{onSpawn(child.pid);}catch(e){fail(e instanceof Error?e:new Error(String(e)));}});
  child.once('close',(code)=>{closed=true;closeInfo={code,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),peakRssBytes:peak,rssSamples:samples};resolveClose(closeInfo);});
  if(input.length)child.stdin.end(input);else child.stdin.end();
  let probing=false,activeProbe:Promise<void>|null=null;
  const probe=():Promise<void>=>{
    if(probing)return activeProbe??Promise.resolve();
    if(closed||!child.pid||child.exitCode!==null||child.signalCode!==null)return Promise.resolve();
    probing=true;
    activeProbe=(async()=>{try {
      const p=spawn('/bin/ps',['-o','rss=,stat=','-p',String(child.pid)],{shell:false,stdio:['ignore','pipe','ignore']});let s='';
      const done=new Promise<number|null>((resolve,reject)=>{p.stdout.on('data',(b:Buffer)=>{s+=b.toString('ascii');if(s.length>128)p.kill('SIGKILL');});p.once('error',reject);p.once('close',resolve);});
      const t=setTimeout(()=>p.kill('SIGKILL'),1000);let code:number|null;try{code=await done;}finally{clearTimeout(t);}
      const terminal=closed||child.exitCode!==null||child.signalCode!==null;
      const present=processPresent(child.pid!);
      if(code!==0){if(terminal||!present)return;throw new Error('cannot measure Admin1 topology child RSS');}
      const measurement=classifyAdmin1RssProbe(s,present,terminal);if(measurement.kind==='exiting')return;
      const combined=measurement.rssBytes+process.memoryUsage().rss;peak=Math.max(peak??0,combined);samples++;
      if(combined>LIMITS.rssBytes)throw new RangeError('Admin1 topology controller plus child exceeded 512 MiB RSS');check(signal,deadline);
    }catch(e){if(!closed)fail(e instanceof Error?e:new Error(String(e)));}finally{probing=false;}})();
    return activeProbe;
  };
  const poll=setInterval(()=>void probe(),250);poll.unref();const onAbort=()=>fail(signal.reason instanceof Error?signal.reason:new Error('Admin1 topology child aborted'));signal.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>fail(new Error('Admin1 topology deadline elapsed')),Math.max(1,deadline-performance.now()));timer.unref();
  try {void probe();const result=await closePromise;await probe();if(failure)throw failure;if(result.code===null||!acceptedCodes.includes(result.code))throw new Error(`Admin1 topology child failed (${result.code}): ${result.stderr.toString('utf8').slice(0,ERR_MAX)}`);return {...result,peakRssBytes:peak,rssSamples:samples};}
  finally {clearInterval(poll);clearTimeout(timer);signal.removeEventListener('abort',onAbort);if(!closed){child.kill('SIGKILL');await closePromise;}if(activeProbe)await activeProbe;}
}
function hashFile(filename:string,max:number):Promise<Buffer>{return readBoundedLocalFile(filename,max);}

export interface RunAdmin1TopologyOptions { repositoryRoot:string; manifestHash:string; signal?:AbortSignal; durationMs?:number; /** Test-only lifecycle observation; it cannot replace the verifier or worker. */ onPythonSpawn?:(pid:number)=>void }
export async function runAdmin1Topology(options:RunAdmin1TopologyOptions):Promise<Admin1TopologyResult>{
  if(!HASH.test(options.manifestHash))throw new TypeError('Admin1 topology publication hash must be SHA-256');
  const duration=options.durationMs??LIMITS.durationMs;if(!Number.isSafeInteger(duration)||duration<1||duration>LIMITS.durationMs)throw new RangeError('Admin1 topology duration must be 1..120000 ms');
  const started=performance.now(),deadline=started+duration,controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Admin1 topology deadline elapsed')),duration);timer.unref();
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  try {
    const root=path.resolve(options.repositoryRoot);if(!path.isAbsolute(options.repositoryRoot)||root!==options.repositoryRoot||await realpath(root)!==root)throw new TypeError('repositoryRoot must be a canonical absolute directory');
    const buildRoot=path.join(root,'.cache','world-build');const topRoot=path.join(buildRoot,'admin1-topology');const reportsRoot=path.join(topRoot,'reports');const requestsRoot=path.join(topRoot,'requests');const attemptsRoot=path.join(topRoot,'attempts');
    const res=await withAcquisitionBuildLock(buildRoot,async()=>{
      check(signal,deadline);
      // The independent verifier is a child process so its bounded 40 MB parse is cancellable.
      const verifyOutput=await runChild(process.execPath,['--experimental-strip-types',VERIFIER,'--manifest-hash',options.manifestHash,'--source-pin','world/admin1-sources.json','--parent-pin','world/admin1-parent.json'],root,Buffer.alloc(0),128*1024,LIMITS.stderrBytes,signal,deadline);
      check(signal,deadline);
      const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(verifyOutput.stdout)) as Record<string,unknown>;
      if(receipt.manifestHash!==options.manifestHash||receipt.product!=='natural-earth-admin1-partitions-v1')throw new Error('independent Admin1 publication verifier returned a mismatched receipt');
      const pinBytes=await readBoundedLocalFile(path.join(root,'world/admin1-sources.json'),64*1024), parentBytes=await readBoundedLocalFile(path.join(root,'world/admin1-parent.json'),64*1024);
      const pin=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(pinBytes)) as Admin1SourcePin;
      const parent=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(parentBytes)) as Admin1ParentPin;
      const manifestPath=path.join(root,'.cache/world-build/output/admin1-foundation',`manifests/${options.manifestHash}.json`);
      const manifestBytes=await readBoundedLocalFile(manifestPath,LIMITS.requestBytes*4);
      if(sha(manifestBytes)!==options.manifestHash)throw new Error('verified Admin1 manifest changed after independent verifier');
      const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)) as Admin1ProductManifest;
      if(!manifest.inspection||!/^reports\/[a-f0-9]{64}\.json$/.test(manifest.inspection.path)||manifest.inspection.sha256!==path.basename(manifest.inspection.path,'.json'))throw new Error('verified manifest inspection reference is invalid');
      const inspectionBytes=await readBoundedLocalFile(path.join(root,'.cache/world-build/output/admin1-foundation',manifest.inspection.path),LIMITS.reportBytes);
      if(inspectionBytes.length!==manifest.inspection.bytes||sha(inspectionBytes)!==manifest.inspection.sha256)throw new Error('verified Admin1 inspection report hash/size mismatch');
      const inspection=parseCanonical(inspectionBytes,'Admin1 inspection report',true) as Admin1InspectionReport;
      const sourcePath=path.resolve(root,pin.input);const sourceReal=path.join(buildRoot,'admin1-source-cache',path.basename(pin.input));if(sourcePath!==sourceReal||!inside(buildRoot,sourcePath))throw new Error('Admin1 source path is not canonical cache input');
      if(sourcePath!==path.join(buildRoot,'admin1-source-cache',`${sha(canonical({release:pin.source.release,path:'geojson/ne_10m_admin_1_states_provinces.geojson',blob:pin.gitBlobSha1,expectedBytes:pin.source.bytes}))}.geojson`))throw new Error('Admin1 topology input is not the frozen capture cache path');
      if(pin.source.sha256!==manifest.source.sha256||pin.source.bytes!==manifest.source.bytes||pin.source.release!==manifest.source.release||parent.manifestHash!==manifest.parent.manifestHash||parent.source.sha256!==manifest.parent.source.sha256||parent.source.bytes!==manifest.parent.source.bytes||receipt.sourceSha256!==pin.source.sha256||receipt.parentManifestHash!==parent.manifestHash)throw new Error('Admin1 topology pins do not match independently verified publication');
      const workerBytes=await hashFile(PYTHON_WORKER,1024*1024),geometryBytes=await hashFile(GEOMETRY_HELPER,2*1024*1024),verifierBytes=await hashFile(VERIFIER,2*1024*1024);
      const tooling:Admin1TopologyTooling={duckdbVersion:'1.5.6',spatialVersion:'04270fe',spatialSha256:'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9',workerSha256:sha(workerBytes),geometryHelperSha256:sha(geometryBytes)};
      const binding:Admin1TopologyBinding={manifestHash:options.manifestHash,manifest,inspection,tooling};
      const keys=inspection.rows.map(row=>row.sourceKey).sort();
      const request={schemaVersion:1,validator:ADMIN1_TOPOLOGY_VALIDATOR,sourceSha256:pin.source.sha256,sourceBytes:pin.source.bytes,parentManifestHash:parent.manifestHash,inspectionSha256:manifest.inspection.sha256,publicationManifestHash:options.manifestHash,expectedUnits:inspection.sourceUnits,expectedKeysSha256:sha(canonical(keys)),workerSha256:tooling.workerSha256,geometryHelperSha256:tooling.geometryHelperSha256,verifierSha256:sha(verifierBytes),spatialSha256:tooling.spatialSha256};
      const requestHash=sha(canonical(request));const reportDir=path.join(reportsRoot,requestHash),reportRelative=`reports/${requestHash}`;
      await safePath(topRoot);await ensureDir(attemptsRoot,buildRoot);await ensureDir(reportsRoot,buildRoot);await ensureDir(requestsRoot,buildRoot);
      const usage=await treeUsage(topRoot,deadline,signal),audit=await validateAudits(attemptsRoot,path.join(reportsRoot,requestHash),requestHash,request,binding,signal,deadline);check(signal,deadline);
      const pointerPath=path.join(requestsRoot,`${requestHash}.json`);
      let pointerBytes:Buffer|undefined;
      try { pointerBytes=await readBoundedLocalFile(pointerPath,LIMITS.requestBytes); }
      catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
      if(pointerBytes){
        const pointer=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(pointerBytes)) as Record<string,unknown>;
        if(pointerBytes.length<2||pointerBytes.at(-1)!==10||canonical(pointer)!==pointerBytes.toString('utf8').slice(0,-1)||Object.keys(pointer).sort().join(',')!=='reportHash,reportPath,requestHash,schemaVersion'||pointer.schemaVersion!==1||pointer.requestHash!==requestHash||typeof pointer.reportHash!=='string'||!HASH.test(pointer.reportHash)||pointer.reportPath!==`${reportRelative}/${pointer.reportHash}.json`)throw new Error('Admin1 topology cache pointer is corrupt or mismatched');
        const rb=await readBoundedLocalFile(path.join(root,'.cache/world-build/admin1-topology',String(pointer.reportPath)),LIMITS.reportBytes);if(sha(rb)!==pointer.reportHash)throw new Error('Admin1 topology cache report hash mismatch');
        const report=parseCanonical(rb,'Admin1 topology report',true);const validated=validateAdmin1TopologyReport(report,binding);
        return {requestHash,reportHash:pointer.reportHash,reportPath:`.cache/world-build/admin1-topology/${pointer.reportPath}`,report:validated,cacheHit:true,elapsedMs:Math.max(1,Math.floor(performance.now()-started)),networkBytes:0 as const,peakRssBytes:verifyOutput.peakRssBytes,rssSamples:verifyOutput.rssSamples};
      }
      const priorAttempts=audit.starts.get(requestHash)??0;
      if(priorAttempts>=LIMITS.attemptsPerRequest)throw new RangeError('Admin1 topology lifetime attempt cap reached');
      if(priorAttempts===0&&audit.entries>=LIMITS.auditEntries)throw new RangeError('Admin1 topology audit tree has no request-entry capacity');
      if(usage.entries+6>LIMITS.treeEntries||usage.bytes+LIMITS.auditRecordBytes*2+LIMITS.reportBytes*2+LIMITS.requestBytes*2>LIMITS.treeBytes||audit.bytes+LIMITS.auditRecordBytes*2>LIMITS.auditBytes)throw new RangeError('Admin1 topology output tree lacks bounded report/pointer/audit headroom');
      const disk=await statfs(buildRoot);if(disk.bavail*disk.bsize<LIMITS.freeBytes+LIMITS.reportBytes*2+LIMITS.requestBytes*2+LIMITS.auditRecordBytes*2)throw new RangeError('Admin1 topology lacks free disk plus temporary report, pointer and audit reserve');
      const extensionRoot=path.join(buildRoot,'tooling','extensions','v1.5.6','osx_arm64');
      const extensionReal=await realpath(extensionRoot);if(extensionReal!==extensionRoot)throw new Error('Admin1 Spatial extension path is not the exact pinned local directory');
      const pythonReal=await realpath(PYTHON);const runtimeSuffix=path.join('codex-runtimes','codex-primary-runtime','dependencies','python','bin','python3.12');if(!pythonReal.endsWith(`${path.sep}${runtimeSuffix}`))throw new Error('Admin1 topology Python runtime does not resolve to the pinned Python 3.12 runtime');
      const pythonStat=await stat(pythonReal);if(!pythonStat.isFile()||(pythonStat.mode&0o111)===0)throw new Error('Admin1 topology Python runtime is not executable');
      await safePath(PYTHON_WORKER);await safePath(GEOMETRY_HELPER);if(!(await lstat(PYTHON_WORKER)).isFile()||!(await lstat(GEOMETRY_HELPER)).isFile())throw new Error('Admin1 topology tooling must be regular files');
      const attemptFile=path.join(attemptsRoot,`${requestHash}.jsonl`), attemptId=randomUUID();
      const startRecord={schemaVersion:1,requestHash,attemptId,event:'started',status:'pending',request,startedAt:new Date().toISOString()};
      await atomicAppend(attemptFile,startRecord,priorAttempts===0);check(signal,deadline);
      let status:'success'|'findings'|'failed'|'aborted'|'timed-out'='failed';let terminalFields:Record<string,unknown>={error:'topology attempt did not finish'};let operationError:unknown;let report:Admin1TopologyReport|undefined,reportHash:string|undefined,reportPath:string|undefined,childPeak=verifyOutput.peakRssBytes,childSamples=verifyOutput.rssSamples;
      try {
        const pyRequest={schemaVersion:1,input:sourcePath,sourceSha256:pin.source.sha256,sourceBytes:pin.source.bytes,expectedUnits:inspection.sourceUnits,extensionRoot:extensionReal};const payload=Buffer.from(`${JSON.stringify(pyRequest)}\n`);
        if(payload.length>LIMITS.requestBytes)throw new RangeError('Admin1 topology Python request exceeds 64 KiB');
        const result=await runChild(PYTHON,['-I',PYTHON_WORKER],MODULE_ROOT, payload,LIMITS.reportBytes+1,LIMITS.stderrBytes,signal,deadline,[0,2],options.onPythonSpawn);const measuredPeaks=[childPeak,result.peakRssBytes].filter((v):v is number=>v!==null);childPeak=measuredPeaks.length?Math.max(...measuredPeaks):null;childSamples+=result.rssSamples;
        if(result.stdout.length<2||result.stdout.at(-1)!==10||result.stdout.subarray(0,-1).includes(10))throw new Error('Admin1 Python report must be one JSON line plus LF');
        const worker=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.stdout.subarray(0,-1))) as Admin1TopologyWorkerReport;
        validateAdmin1TopologyWorkerReport(worker,binding);report=bindAdmin1TopologyReport(worker,binding);
        if(result.code!==(report.invalidUnits||report.unsupportedUnits?2:0))throw new Error('Admin1 topology worker exit status disagrees with validated findings');
        const reportBytes=Buffer.from(`${canonical(report)}\n`);if(reportBytes.length>LIMITS.reportBytes)throw new RangeError('Admin1 topology report exceeds 2 MiB');reportHash=sha(reportBytes);reportPath=`${reportRelative}/${reportHash}.json`;
        const current=await treeUsage(topRoot,deadline,signal);if(current.bytes+reportBytes.length+LIMITS.requestBytes>LIMITS.treeBytes)throw new RangeError('Admin1 topology tree would exceed its 16 MiB cap');
        check(signal,deadline);
        const reportStore=await import('./storage.ts').then(mod=>mod.createOutputStore(reportDir,topRoot));await reportStore.writeImmutable(`${reportHash}.json`,reportBytes);check(signal,deadline);
        const pointer={schemaVersion:1,requestHash,reportHash,reportPath};const pointerBytes=Buffer.from(`${canonical(pointer)}\n`);
        const requestStore=await import('./storage.ts').then(mod=>mod.createOutputStore(requestsRoot,topRoot));await requestStore.writeImmutable(`${requestHash}.json`,pointerBytes);check(signal,deadline);
        status=report.invalidUnits||report.unsupportedUnits?'findings':'success';
        terminalFields={checkedUnits:report.checkedUnits,invalidUnits:report.invalidUnits,protectedUnits:report.protectedUnits,reportHash,reportPath,unsupportedUnits:report.unsupportedUnits,validUnits:report.validUnits};
        return {requestHash,reportHash,reportPath:`.cache/world-build/admin1-topology/${reportPath}`,report,cacheHit:false,elapsedMs:Math.max(1,Math.floor(performance.now()-started)),networkBytes:0 as const,peakRssBytes:childPeak,rssSamples:childSamples};
      } catch(error) {
        operationError=error;
        status=signal.aborted?'aborted':performance.now()>=deadline?'timed-out':'failed';
        terminalFields={error:auditError(error)};
        throw error;
      } finally {
        let completionError:unknown;
        if(status==='success'||status==='findings'){
          try{check(signal,deadline);}catch(error){
            completionError=error;operationError=error;
            status=performance.now()>=deadline?'timed-out':signal.aborted?'aborted':'failed';
            terminalFields={error:auditError(error)};
          }
        }
        const end={schemaVersion:1,requestHash,attemptId,event:'finished',status,endedAt:new Date().toISOString(),...terminalFields};
        try { await atomicAppend(attemptFile,end,false); }
        catch(auditError) { throw new AggregateError(operationError===undefined?[auditError]:[operationError,auditError],'Admin1 topology terminal attempt audit could not be written'); }
        if(completionError!==undefined)throw completionError;
      }
    },{signal,timeoutMs:Math.max(1,Math.floor(deadline-performance.now()))});
    check(signal,deadline);
    return {...res,elapsedMs:Math.max(1,Math.floor(performance.now()-started))};
  } finally { clearTimeout(timer); }
}

export function topologyExitCode(report:Admin1TopologyReport):0|2{return report.invalidUnits||report.unsupportedUnits?2:0;}
