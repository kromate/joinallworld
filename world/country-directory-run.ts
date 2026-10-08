import { createHash, randomUUID } from 'node:crypto';
import { lstat, opendir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { acquireCountrySource, validateCountryCaptureSpec } from './country-acquire.ts';
import { withAcquisitionBuildLock } from './acquire.ts';
import { readBoundedLocalFile, readCoarseInventoryCountry } from './inventory-reader.ts';
import { validateInventoryPin } from './bootstrap.ts';
import { validateInventoryManifest } from './preview/inventory-view.ts';
import { createOutputStore } from './storage.ts';
import { COUNTRY_DIRECTORY_COMPILER, COUNTRY_DIRECTORY_LIMITS, type CountryDirectoryBuildResult } from './country-directory-types.ts';
import type { CountryCaptureSpec } from './country-types.ts';
import type { InventoryPin } from './bootstrap.ts';
import type { SourceRecord } from './types.ts';

const HARD=Object.freeze({durationMs:120_000,sourceBytes:16*1024*1024,baselineBytes:20_000_000,outputBytes:COUNTRY_DIRECTORY_LIMITS.publishedBytes,
  outputTreeBytes:40*1024*1024,outputEntries:4_096,auditBytes:1024*1024,auditEntries:128,auditRecordBytes:8*1024,auditReserveBytes:16*1024,
  freeBytes:100*1024*1024,workerOldMb:256,workerYoungMb:32,processRssBytes:512*1024*1024});
const SHA=/^[a-f0-9]{64}$/;
function sha(bytes:Uint8Array|string):string{return createHash('sha256').update(bytes).digest('hex');}
function canonical(value:unknown):string{if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('country directory identity has a non-finite number');return JSON.stringify(value);}if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object'){const o=value as Record<string,unknown>;return`{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;}throw new TypeError('country directory identity is not canonical JSON');}
function inside(parent:string,child:string):boolean{const r=path.relative(parent,child);return r!==''&&r!=='..'&&!r.startsWith(`..${path.sep}`)&&!path.isAbsolute(r);}
function errorText(error:unknown):string{return(error instanceof Error?error.message:String(error)).slice(0,2_000);}
function check(signal:AbortSignal,deadline:number):void{if(signal.aborted)throw signal.reason??new Error('country directory build aborted');if(Date.now()>=deadline)throw new Error('country directory build exceeded its 120-second deadline');}
async function inspectPath(targetValue:string):Promise<void>{const target=path.resolve(targetValue);let cursor=path.parse(target).root;const parts=target.slice(cursor.length).split(path.sep).filter(Boolean);for(let i=0;i<parts.length;i++){cursor=path.join(cursor,parts[i]!);let info;try{info=await lstat(cursor);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}if(info.isSymbolicLink()||(i<parts.length-1&&!info.isDirectory()))throw new Error(`country directory path contains a symlink or non-directory ancestor: ${cursor}`);}}
async function treeUsage(root:string,byteCap:number,entryCap:number):Promise<{bytes:number;entries:number}>{let bytes=0,entries=0;const walk=async(dir:string,depth:number):Promise<void>=>{if(depth>8)throw new RangeError('country directory tree exceeds depth 8');let info;try{info=await lstat(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&dir===root)return;throw error;}if(info.isSymbolicLink()||!info.isDirectory())throw new Error('country directory tree contains an unsafe directory');const handle=await opendir(dir);for await(const item of handle){if(++entries>entryCap)throw new RangeError(`country directory tree exceeds ${entryCap} entries`);const file=path.join(dir,item.name),child=await lstat(file);if(child.isSymbolicLink())throw new Error('country directory tree contains a symlink');if(child.isDirectory())await walk(file,depth+1);else if(child.isFile())bytes+=child.size;else throw new Error('country directory tree contains a non-regular entry');if(bytes>byteCap)throw new RangeError(`country directory tree exceeds ${byteCap} bytes`);}};await walk(root,0);return{bytes,entries};}
function copyBuffer(bytes:Uint8Array):ArrayBuffer{const result=new ArrayBuffer(bytes.byteLength);new Uint8Array(result).set(bytes);return result;}
function sourceEqual(a:unknown,b:SourceRecord):boolean{return canonical(a)===canonical(b);}

interface WorkerResult extends CountryDirectoryBuildResult{}
type WorkerReply={ok:true;result:WorkerResult}|{ok:false;error:string};
async function runWorker(data:{source:SourceRecord,rawBytes:Uint8Array,baselineSource:SourceRecord,baselineRaw:Uint8Array,baselineInventoryHash:string,outputRoot:string,buildRoot:string},signal:AbortSignal,deadline:number):Promise<WorkerResult>{
  if(process.memoryUsage().rss>HARD.processRssBytes)throw new RangeError('country directory parent RSS already exceeds 512 MiB');
  const input={...data,rawBuffer:copyBuffer(data.rawBytes),baselineBuffer:copyBuffer(data.baselineRaw)};delete (input as Partial<typeof input>).rawBytes;delete (input as Partial<typeof input>).baselineRaw;
  const worker=new Worker(new URL('./country-directory-worker.ts',import.meta.url),{workerData:input,transferList:[input.rawBuffer,input.baselineBuffer],resourceLimits:{maxOldGenerationSizeMb:HARD.workerOldMb,maxYoungGenerationSizeMb:HARD.workerYoungMb}});
  let exited=false,reply:WorkerReply|undefined,workerError:Error|undefined,terminating:Promise<void>|undefined;
  let resolveExit!:(code:number)=>void;const exit=new Promise<number>(resolve=>{resolveExit=resolve;});
  worker.on('message',(value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value)){workerError=new Error('country directory worker reply is malformed');return;}const row=value as Record<string,unknown>;if(row.ok===true&&Object.keys(row).length===2&&'result'in row)reply=row as unknown as WorkerReply;else if(row.ok===false&&Object.keys(row).length===2&&typeof row.error==='string'&&row.error.length<=2_000)reply=row as unknown as WorkerReply;else workerError=new Error('country directory worker reply is malformed');});
  worker.on('error',error=>{workerError=error;});worker.on('exit',code=>{exited=true;resolveExit(code);});
  const terminateAndWait=():Promise<void>=>terminating??=(async()=>{if(!exited)await worker.terminate();await exit;})();
  let reject!: (error:Error)=>void;const control=new Promise<never>((_,r)=>{reject=r;});const abort=()=>{reject(signal.reason instanceof Error?signal.reason:new Error('country directory build aborted'));void terminateAndWait();};
  const poll=setInterval(()=>{if(process.memoryUsage().rss>HARD.processRssBytes){reject(new RangeError('country directory parent RSS exceeded 512 MiB'));void terminateAndWait();}if(Date.now()>=deadline){reject(new Error('country directory build exceeded its 120-second deadline'));void terminateAndWait();}},100);poll.unref();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  try{const code=await Promise.race([exit,control]);if(workerError)throw workerError;if(code!==0||!reply)throw new Error(reply&&!reply.ok?reply.error:`country directory worker exited without a valid reply (code ${code})`);if(!reply.ok)throw new Error(reply.error);return reply.result;}
  finally{clearInterval(poll);signal.removeEventListener('abort',abort);if(!exited)await terminateAndWait();}
}
function validateWorkerResult(value:unknown,baselineUnits:number,outputRoot:string):WorkerResult{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('country directory worker result must be an object');const r=value as Record<string,unknown>;
  const keys=['manifestHash','manifestPath','bytes','sourceUnitCount','nodeCount','outlineCount','partCount','retained','added','missing','networkBytes','elapsedMs'];
  if(Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k))||typeof r.manifestHash!=='string'||!SHA.test(r.manifestHash)||typeof r.manifestPath!=='string'||!Number.isSafeInteger(r.bytes)||Number(r.bytes)<1||Number(r.bytes)>HARD.outputBytes||![r.sourceUnitCount,r.nodeCount,r.outlineCount,r.partCount,r.retained,r.added,r.missing].every(n=>Number.isSafeInteger(n)&&Number(n)>=0)||r.networkBytes!==0||!Number.isSafeInteger(r.elapsedMs)||Number(r.elapsedMs)<1)throw new Error('country directory worker result fields are invalid');
  const expected=path.join(outputRoot,'manifests',`${r.manifestHash}.json`);if(path.resolve(r.manifestPath)!==expected)throw new Error('country directory worker returned a manifest outside its fixed output directory');
  if(Number(r.sourceUnitCount)<1||Number(r.sourceUnitCount)>10_000||Number(r.nodeCount)<Number(r.sourceUnitCount)+1||Number(r.nodeCount)>10_100||Number(r.outlineCount)!==Number(r.sourceUnitCount)-1||Number(r.partCount)>4_096||Number(r.partCount)<Number(r.outlineCount)||Number(r.sourceUnitCount)!==Number(r.retained)+Number(r.added)||Number(r.retained)!==baselineUnits||r.missing!==0)throw new Error('country directory worker counts do not conserve source units, retain the baseline, or protect Nigeria');
  return r as unknown as WorkerResult;
}
function validatePublishedManifest(value:unknown,result:WorkerResult,source:SourceRecord,baseline:SourceRecord,baselineInventoryHash:string):void{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('published country directory manifest must be an object');
  const m=value as Record<string,unknown>,keys=['schemaVersion','compiler','source','baselineSource','baselineInventoryHash','sourceUnitCount','nodeCount','outlineCount','partCount','rootNodePath','identityPath','rollups','representation','limits','exceptions'];
  if(Object.keys(m).length!==keys.length||Object.keys(m).some(k=>!keys.includes(k)))throw new TypeError('published country directory manifest has missing or unknown fields');
  if(m.schemaVersion!==1||m.compiler!==COUNTRY_DIRECTORY_COMPILER||!sourceEqual(m.source,source)||!sourceEqual(m.baselineSource,baseline)||m.baselineInventoryHash!==baselineInventoryHash
    ||m.sourceUnitCount!==result.sourceUnitCount||m.nodeCount!==result.nodeCount||m.outlineCount!==result.outlineCount||m.partCount!==result.partCount||m.representation!=='whole-polygon-groups')throw new Error('published country directory manifest source/baseline/count binding mismatch');
  if(typeof m.rootNodePath!=='string'||!/^nodes\/[a-f0-9]{64}\.json$/.test(m.rootNodePath)||typeof m.identityPath!=='string'||!/^identity\/[a-f0-9]{64}\.json$/.test(m.identityPath))throw new Error('published country directory manifest paths are invalid');
  if(canonical(m.limits)!==canonical({partBytes:512000,countryBytes:2097152,positions:100000}))throw new Error('published country directory limits changed');
  if(!Array.isArray(m.rollups)||m.rollups.length>100)throw new TypeError('published country directory rollups are invalid');
  for(const value of m.rollups){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('published country directory rollup must be an object');const row=value as Record<string,unknown>;const fields=['id','name','countryCount','sourceUnitCount','exceptionCount'];if(Object.keys(row).length!==fields.length||Object.keys(row).some(k=>!fields.includes(k))||typeof row.id!=='string'||!row.id||typeof row.name!=='string'||!row.name||![row.countryCount,row.sourceUnitCount,row.exceptionCount].every(x=>Number.isSafeInteger(x)&&Number(x)>=0))throw new TypeError('published country directory rollup fields are invalid');}
  if(!Array.isArray(m.exceptions)||m.exceptions.length>10_000||m.exceptions.some(x=>typeof x!=='string'||x.length>2_048||/[\u0000-\u001f\u007f]/.test(x)))throw new TypeError('published country directory exceptions are invalid');
}

export interface BuildCountryDirectoryOptions{repositoryRoot:string;spec:CountryCaptureSpec;baselinePin:InventoryPin;baselineInventoryHash:string;signal?:AbortSignal;durationMs?:number}
/** Build the separate country directory from verified, already-cached Natural Earth bytes. */
export async function buildCountryDirectory(options:BuildCountryDirectoryOptions):Promise<CountryDirectoryBuildResult>{
  const started=Date.now(),duration=options.durationMs??HARD.durationMs;if(!Number.isSafeInteger(duration)||duration<1||duration>HARD.durationMs)throw new RangeError('country directory duration must be 1..120,000 ms');
  const root=options.repositoryRoot;if(!path.isAbsolute(root)||path.resolve(root)!==root)throw new TypeError('repositoryRoot must be canonical and absolute');
  const spec=validateCountryCaptureSpec(options.spec),pin=validateInventoryPin(options.baselinePin);if(!SHA.test(options.baselineInventoryHash))throw new TypeError('baseline inventory hash must be lowercase SHA-256');
  const buildRoot=path.join(root,'.cache','world-build'),baselineInput=path.resolve(root,pin.input),inventoryRoot=path.join(buildRoot,'output','inventory'),outputRoot=path.join(buildRoot,'output','country-inventory');
  if(path.isAbsolute(pin.input)||path.normalize(pin.input)!==pin.input||path.relative(root,baselineInput)!==pin.input||!inside(buildRoot,baselineInput))throw new Error('baseline input must be a canonical relative path inside .cache/world-build');
  const deadline=started+duration,deadlineController=new AbortController(),deadlineTimer=setTimeout(()=>deadlineController.abort(new Error('country directory build exceeded its 120-second deadline')),duration);deadlineTimer.unref();
  const signal=options.signal?AbortSignal.any([options.signal,deadlineController.signal]):deadlineController.signal;
  try{
    await inspectPath(root);const rootInfo=await lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw new Error('repositoryRoot must be a real directory');await inspectPath(baselineInput);
    check(signal,deadline);const acquired=await acquireCountrySource(spec,{repositoryRoot:root,cacheOnly:true,signal,durationMs:Math.max(1,deadline-Date.now())});if(!acquired.cacheHit||acquired.networkBytes!==0)throw new Error('country directory build requires a verified zero-network source cache hit');
    const sourcePath=path.resolve(root,acquired.input);if(sourcePath!==acquired.inputPath||!inside(path.join(buildRoot,'country-source-cache'),sourcePath))throw new Error('country source cache path is outside its fixed immutable cache');
    const result=await withAcquisitionBuildLock(buildRoot,async()=>{
      check(signal,deadline);await inspectPath(sourcePath);await inspectPath(baselineInput);await inspectPath(path.join(inventoryRoot,'manifests',`${options.baselineInventoryHash}.json`));
      const sourceBytes=await readBoundedLocalFile(sourcePath,HARD.sourceBytes);if(sourceBytes.length!==spec.expectedBytes||sourceBytes.length!==acquired.source.bytes||sha(sourceBytes)!==acquired.source.sha256)throw new Error('cached country source differs from exact verified byte pin');
      const baselineBytes=await readBoundedLocalFile(baselineInput,HARD.baselineBytes);if(baselineBytes.length!==pin.source.bytes||sha(baselineBytes)!==pin.source.sha256)throw new Error('baseline source input differs from exact inventory pin');
      const manifestBytes=await readBoundedLocalFile(path.join(inventoryRoot,'manifests',`${options.baselineInventoryHash}.json`),COUNTRY_DIRECTORY_LIMITS.manifestBytes);if(sha(manifestBytes)!==options.baselineInventoryHash)throw new Error('baseline inventory manifest hash differs from its filename');
      const manifest=validateInventoryManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)) as unknown);if(manifest.sources.length!==1||!sourceEqual(manifest.sources[0],pin.source)||manifest.sourceUnitCount!==pin.sourceFeatureCount)throw new Error('baseline inventory manifest is not bound to the exact pinned Natural Earth source/count');
      await readCoarseInventoryCountry(inventoryRoot,options.baselineInventoryHash,'RW');
      check(signal,deadline);
      const outputUse=await treeUsage(outputRoot,HARD.outputTreeBytes,HARD.outputEntries);if(outputUse.bytes+HARD.outputBytes>HARD.outputTreeBytes)throw new RangeError('country directory output lacks space under its 40 MiB cumulative cap');const disk=await statfs(buildRoot);if(disk.bavail*disk.bsize<HARD.freeBytes+HARD.outputBytes)throw new RangeError('country directory requires 100 MiB free reserve plus 16 MiB output allowance');
      const auditRoot=path.join(buildRoot,'country-directory-attempts'),audit=await treeUsage(auditRoot,HARD.auditBytes,HARD.auditEntries);if(audit.entries+1>HARD.auditEntries||audit.bytes+HARD.auditReserveBytes>HARD.auditBytes)throw new RangeError('country directory audit exceeds 128 entries/1 MiB');
      if(outputUse.entries+7>HARD.outputEntries)throw new RangeError('country directory reserves seven entries within the 4,096-entry output cap');
      const requestHash=sha(canonical({compiler:COUNTRY_DIRECTORY_COMPILER,source:acquired.source,sourceRawSha256:sha(sourceBytes),baselinePinHash:sha(canonical(pin)),baselineInventoryHash:options.baselineInventoryHash}));
      const attemptId=randomUUID(),store=await createOutputStore(auditRoot,buildRoot),startRecord={schemaVersion:1,attemptId,requestHash,compiler:COUNTRY_DIRECTORY_COMPILER,status:'pending',startedAt:new Date(started).toISOString(),sourceSha256:acquired.source.sha256,baselineSourceSha256:pin.source.sha256,baselineInventoryHash:options.baselineInventoryHash,networkBytes:0};
      const pending=Buffer.from(`${canonical(startRecord)}\n`);if(pending.length>HARD.auditRecordBytes)throw new RangeError('country directory audit record exceeds 8 KiB');await store.writeImmutable(`${attemptId}.json`,pending);
      let succeeded=false,errorTextValue='country directory build did not complete';
      try{
        const workerResult=await runWorker({source:acquired.source,rawBytes:sourceBytes,baselineSource:pin.source,baselineRaw:baselineBytes,baselineInventoryHash:options.baselineInventoryHash,outputRoot,buildRoot},signal,deadline);check(signal,deadline);
        const result=validateWorkerResult(workerResult,pin.sourceFeatureCount,outputRoot);
        const manifestPath=path.join(outputRoot,'manifests',`${result.manifestHash}.json`),published=await readBoundedLocalFile(manifestPath,COUNTRY_DIRECTORY_LIMITS.manifestBytes);if(sha(published)!==result.manifestHash)throw new Error('published country directory manifest hash mismatch');
        const publishedManifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(published)) as unknown;
        validatePublishedManifest(publishedManifest,result,acquired.source,pin.source,options.baselineInventoryHash);
        const finalUsage=await treeUsage(outputRoot,HARD.outputTreeBytes,HARD.outputEntries);if(finalUsage.bytes>HARD.outputTreeBytes)throw new RangeError('published country directory exceeds its 40 MiB cumulative cap');
        check(signal,deadline);
        const finalResult={...result,networkBytes:0 as const,elapsedMs:Math.max(1,Date.now()-started)};
        const final=Buffer.from(`${canonical({...startRecord,status:'succeeded',finishedAt:new Date().toISOString(),elapsedMs:finalResult.elapsedMs,manifestHash:result.manifestHash,bytes:result.bytes,networkBytes:0})}\n`);if(final.length>HARD.auditRecordBytes)throw new RangeError('country directory terminal audit record exceeds 8 KiB');await store.writeAtomic(`${attemptId}.json`,final);succeeded=true;return finalResult;
      }catch(error){errorTextValue=errorText(error);throw error;}
      finally{if(!succeeded){const status=options.signal?.aborted?'aborted':deadlineController.signal.aborted?'timed-out':'failed';const final=Buffer.from(`${canonical({...startRecord,status,finishedAt:new Date().toISOString(),elapsedMs:Math.max(1,Date.now()-started),error:errorTextValue,networkBytes:0})}\n`);if(final.length<=HARD.auditRecordBytes)await store.writeAtomic(`${attemptId}.json`,final);}}
    },{signal,timeoutMs:Math.max(1,deadline-Date.now())});return result;
  }finally{clearTimeout(deadlineTimer);}
}
