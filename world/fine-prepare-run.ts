import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, opendir, statfs, unlink, rmdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Ledger } from './ledger.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { loadFinePromotionSelections, publishFinePromotion } from './fine-promotion-cli.ts';
import { loadFinePromotionContext } from './fine-promotion-load.ts';
import { buildFinePromotionRequest, buildFineSourcePromotion } from './fine-promotion.ts';
import type { FinePromotionContext, FinePointerAcquisitionResult } from './fine-promotion-types.ts';
import { acquireFinePointer } from './fine-pointer-acquire.ts';
import { acquireFineSource } from './fine-acquire.ts';
import { runFineTopology } from './fine-topology.ts';
import { validateFineTopologyReport } from './fine-quality.ts';
import { buildFineInventory, validateFineSourcePin } from './fine.ts';
import { readCountryDirectoryCountry } from './country-directory-reader.ts';
import { parseFineLFSPointer } from './fine-lfs.ts';
import { FINE_LIMITS } from './fine-types.ts';
import type { FinePromotionSelection, FinePromotionRequest } from './fine-promotion-types.ts';
import type { FineSourcePin } from './fine-types.ts';
import type { ReviewedFineCampaignInput } from './fine-campaign-plan.ts';

const STATE=2*1024*1024, ENTRIES=128, DB=512*1024;
type Result={schemaVersion:1;purpose:'fine-source-preparation';catalogueHash:string;prepared:ReviewedFineCampaignInput[];pending:number;failed:Array<{countryId:string;reason:string}>;attemptFailures:Array<{countryId:string;reason:string}>;networkBytes:number|null;networkBytesMeasured:number;unknownNetworkTransfers:number;attempts:number};
class FineSourceFeatureCountMismatch extends Error {
  readonly expected:number;readonly actual:number;readonly sourceSha256:string;
  constructor(expected:number,actual:number,sourceSha256:string){super(`immutable fine source feature count mismatch: source ${sourceSha256}, expected ${expected}, actual ${actual}`);this.name='FineSourceFeatureCountMismatch';this.expected=expected;this.actual=actual;this.sourceSha256=sourceSha256;}
}
export interface FinePreparationHooks {
  loadContext?: typeof loadFinePromotionContext;
  acquirePointer?: typeof acquireFinePointer;
  publish?: typeof publishFinePromotion;
  acquireSource?: typeof acquireFineSource;
  topology?: typeof runFineTopology;
}
export interface FinePreparationOptions {repositoryRoot:string;configPath:string;signal?:AbortSignal;durationMs?:number;maxJobs?:number;cacheOnly?:boolean;hooks?:FinePreparationHooks}
function stop(signal:AbortSignal,deadline:number):void {if(signal.aborted)throw signal.reason??new Error('fine preparation aborted');if(Date.now()>=deadline)throw new Error('fine preparation session deadline exceeded');if(process.memoryUsage().rss>512*1024*1024)throw new RangeError('fine preparation RSS exceeds 512 MiB');}
function obj(v:unknown,label:string):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(`${label} must be object`);return v as Record<string,unknown>;}
async function ensureDir(p:string):Promise<void>{const root=path.parse(p).root;let cur=root;for(const part of p.slice(root.length).split(path.sep).filter(Boolean)){cur=path.join(cur,part);try{await mkdir(cur);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const s=await lstat(cur);if(s.isSymbolicLink()||!s.isDirectory())throw new Error(`unsafe fine preparation directory ${cur}`);}}
async function usage(root:string,signal:AbortSignal,deadline:number):Promise<{bytes:number;entries:number}>{let bytes=0,entries=0;const walk=async(d:string,n:number):Promise<void>=>{stop(signal,deadline);if(n>4)throw new RangeError('fine preparation state exceeds depth cap');let rootInfo;try{rootInfo=await lstat(d);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'&&d===root)return;throw e;}if(rootInfo.isSymbolicLink()||!rootInfo.isDirectory())throw new Error('fine preparation state contains unsafe directory');const dh=await opendir(d);for await(const ent of dh){stop(signal,deadline);if(++entries>ENTRIES)throw new RangeError('fine preparation state exceeds 128 entries');const p=path.join(d,ent.name),s=await lstat(p);if(s.isSymbolicLink())throw new Error('fine preparation state symlink refused');if(s.isDirectory())await walk(p,n+1);else if(s.isFile())bytes+=s.size;else throw new Error('fine preparation contains non-file');if(bytes>STATE)throw new RangeError('fine preparation state exceeds 2 MiB');}};await walk(root,0);return{bytes,entries};}
async function lock(p:string,signal:AbortSignal,deadline:number):Promise<()=>Promise<void>>{for(;;){stop(signal,deadline);try{await mkdir(p);const owner=JSON.stringify({pid:process.pid,token:randomUUID()} )+'\n';const f=await open(path.join(p,'owner'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);try{await f.writeFile(owner);await f.sync();}finally{await f.close();}const info=await lstat(p);return async()=>{const now=await lstat(p),cur=await readBoundedLocalFile(path.join(p,'owner'),1024);if(now.ino!==info.ino||now.isSymbolicLink()||cur.toString()!==owner)throw new Error('fine preparation lock ownership changed');await unlink(path.join(p,'owner'));await rmdir(p);};}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const s=await lstat(p);if(s.isSymbolicLink()||!s.isDirectory())throw new Error('fine preparation lock unsafe');try{const ownerPath=path.join(p,'owner'),ownerStat=await lstat(ownerPath),raw=await readBoundedLocalFile(ownerPath,1024),owner=JSON.parse(raw.toString()) as {pid?:unknown};if(!ownerStat.isSymbolicLink()&&Number.isSafeInteger(owner.pid)){let dead=false;try{process.kill(Number(owner.pid),0);}catch(x){dead=(x as NodeJS.ErrnoException).code==='ESRCH';}if(dead){const again=await readBoundedLocalFile(ownerPath,1024),dirAgain=await lstat(p);if(Buffer.compare(raw,again)===0&&dirAgain.ino===s.ino){await unlink(ownerPath);await rmdir(p);continue;}}}}catch(x){if((x as NodeJS.ErrnoException).code!=='ENOENT')throw x;}await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>{signal.removeEventListener('abort',a);resolve();},40);const a=()=>{clearTimeout(t);signal.removeEventListener('abort',a);reject(signal.reason??new Error('fine preparation aborted waiting for lock'));};signal.addEventListener('abort',a,{once:true});});}}
}
function sourceFeatures(bytes:Uint8Array,pin:FineSourcePin):string[]{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;const fc=obj(v,'source');if(fc.type!=='FeatureCollection'||!Array.isArray(fc.features))throw new Error('fine source is not a bounded FeatureCollection');if(fc.features.length<=32&&fc.features.length!==pin.expectedUnits)throw new FineSourceFeatureCountMismatch(pin.expectedUnits,fc.features.length,pin.source.sha256);if(fc.features.length>32)throw new RangeError('fine source feature count exceeds the hard 32-unit cap');const keys:string[]=[];for(const f0 of fc.features){const f=obj(f0,'feature'),p=obj(f.properties,'properties');if(typeof p.shapeID!=='string'||p.shapeGroup!==pin.countryIso3||p.shapeType!==pin.adminLevel||keys.includes(p.shapeID))throw new Error('source feature identity is malformed or duplicated');keys.push(p.shapeID);}return keys;}
async function validOutput(repo:string,pin:FineSourcePin,context:FinePromotionContext,request:FinePromotionRequest,pointer:FinePointerAcquisitionResult,signal:AbortSignal,deadline:number,hooks:FinePreparationHooks,topologyMode:'run'|string,cacheOnly:boolean,onNetwork:(bytes:number)=>void,onUnknown:()=>void):Promise<ReviewedFineCampaignInput>{
  const promotion=buildFineSourcePromotion(context,{countryId:request.country.id,countryIso3:request.country.iso3,commit:request.commit},pointer.pointerBytes);if(canonicalJson(promotion.pin)!==canonicalJson(pin))throw new Error('rebuilt promotion pin differs from durable job');
  await(hooks.publish??publishFinePromotion)(repo,context,{countryId:request.country.id,countryIso3:request.country.iso3,commit:request.commit},pointer.pointerBytes,signal,Math.max(1,Math.min(30_000,deadline-Date.now())));
  stop(signal,deadline);
  let acquired;try{acquired=await(hooks.acquireSource??acquireFineSource)(pin,{repositoryRoot:repo,signal,cacheOnly,durationMs:Math.max(1,Math.min(60_000,deadline-Date.now()))});onNetwork(acquired.networkBytes);}catch(error){if(!cacheOnly)onUnknown();throw error;}if(cacheOnly&&acquired.networkBytes!==0||cacheOnly&&!acquired.cacheHit)throw new Error('completed fine source must be a cache-only verified hit');
  const raw=await readBoundedLocalFile(acquired.inputPath,pin.source.bytes);if(raw.byteLength!==pin.source.bytes||sha256(raw)!==pin.source.sha256)throw new Error('acquired fine source differs from immutable pin');
  const keys=sourceFeatures(raw,pin);stop(signal,deadline);
  let reportValue:unknown, reportPath:string;
  if(topologyMode==='run') {
    const top=await(hooks.topology??runFineTopology)({repositoryRoot:repo,pin,signal,durationMs:Math.max(1,Math.min(60_000,deadline-Date.now()))});
    if(top.networkBytes!==0)throw new Error('fine topology must be local-only');
    reportPath=path.relative(repo,top.reportPath).split(path.sep).join('/'); const absoluteReport=path.resolve(repo,reportPath); const bytes=await readBoundedLocalFile(absoluteReport,64*1024);
    if(top.reportHash!==sha256(bytes))throw new Error('topology report hash/path evidence failed');
    const match=/\.cache\/world-build\/fine-topology\/reports\/([a-f0-9]{64})\/([a-f0-9]{64})\.json$/.exec(reportPath);
    if(!match||absoluteReport!==path.join(repo,'.cache/world-build/fine-topology/reports',match[1]!,`${match[2]}.json`))throw new Error('topology report path is outside hash-addressed private report tree');
    if(match[2]!==top.reportHash)throw new Error('topology report filename does not match worker-reported hash');
    const wanted=topologyRequestHash(pin,keys);if(match[1]!==wanted)throw new Error('topology report request hash does not bind this source and feature set');
    reportValue=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
  } else {
    reportPath=topologyMode;
    if(path.isAbsolute(reportPath)||reportPath.includes('..'))throw new Error('completed topology report path must be repository-relative');
    const absoluteReport=path.resolve(repo,reportPath),bytes=await readBoundedLocalFile(absoluteReport,64*1024),match=/\.cache\/world-build\/fine-topology\/reports\/([a-f0-9]{64})\/([a-f0-9]{64})\.json$/.exec(reportPath);
    if(!match||absoluteReport!==path.join(repo,'.cache/world-build/fine-topology/reports',match[1]!,`${match[2]}.json`)||sha256(bytes)!==match[2]||match[1]!==topologyRequestHash(pin,keys))throw new Error('completed topology report path/hash/request binding is invalid');
    reportValue=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
  }
  const report=validateFineTopologyReport(reportValue,pin,keys);if(report.validUnits!==pin.expectedUnits||report.invalidUnits!==0||report.unsupportedUnits!==0)throw new Error('topology report is not complete and all-valid');
  const country=await readCountryDirectoryCountry(path.join(repo,'.cache/world-build/output/country-inventory'),request.parent.manifestHash,pin.countryCode,signal);
  const compiled=buildFineInventory(pin,raw,country,request.parent.manifestHash,{topologyReport:report});if(compiled.coverage.acceptedUnits!==pin.expectedUnits||compiled.coverage.rejectedUnits!==0)throw new Error('pure fine inventory admission did not conserve all source units');
  return{pin,topologyReportPath:reportPath};
}
function topologyRequestHash(pin:FineSourcePin,keys:readonly string[]):string{
 const compare=(a:string,b:string):number=>{const x=Array.from(a,c=>c.codePointAt(0)!),y=Array.from(b,c=>c.codePointAt(0)!);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]!-y[i]!;return x.length-y.length;};
 return sha256(canonicalJson({validator:'duckdb-spatial-ogc-planar-v1',sourceSha256:pin.source.sha256,sourceBytes:pin.source.bytes,expectedUnits:pin.expectedUnits,expectedKeys:[...keys].sort(compare),spatialSha256:'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9'}));
}
export async function runFinePreparation(options:FinePreparationOptions):Promise<Result>{
 const duration=options.durationMs??120_000,maxJobs=options.maxJobs??2,cacheOnly=options.cacheOnly??false;if(!path.isAbsolute(options.repositoryRoot)||path.resolve(options.repositoryRoot)!==options.repositoryRoot||!Number.isSafeInteger(duration)||duration<1||duration>120_000||!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>16)throw new TypeError('fine preparation requires canonical root, <=120s duration, and maxJobs 1..16');
 const repo=options.repositoryRoot,started=Date.now(),deadline=started+duration,controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('fine preparation deadline elapsed')),duration);timer.unref();const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal,hooks=options.hooks??{};
 let ledger:Ledger|undefined,release:(()=>Promise<void>)|undefined,networkBytesMeasured=0,unknownNetworkTransfers=0;
 try{
  stop(signal,deadline);if(await realpath(repo)!==repo)throw new Error('repository root must not contain symlink aliases');const selected=await loadFinePromotionSelections(repo,options.configPath);const context=await(hooks.loadContext??loadFinePromotionContext)({repositoryRoot:repo,catalogueHash:selected.catalogueHash,signal});stop(signal,deadline);
  const build=path.join(repo,'.cache/world-build'),state=path.join(build,'fine-preparation');await ensureDir(state);release=await lock(path.join(state,'lock'),signal,deadline);
  const before=await usage(state,signal,deadline),disk=await statfs(build),dbPath=path.join(state,'jobs.sqlite');let dbSize=0;try{const ds=await lstat(dbPath);if(ds.isSymbolicLink()||!ds.isFile())throw new Error('fine preparation ledger path is unsafe');dbSize=ds.size;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}const dbGrowth=Math.max(0,DB-dbSize);if(before.bytes+dbGrowth+528*1024+32*1024+selected.selections.length*32*1024+256*1024>STATE||before.entries+16+selected.selections.length*3>ENTRIES)throw new RangeError('fine preparation cannot reserve state, ledger WAL/SHM and report headroom');if(disk.bavail*disk.bsize<100*1024*1024+2*1024*1024)throw new RangeError('fine preparation requires 100 MiB free space plus artifact reserve');
  ledger=new Ledger(path.join(state,'jobs.sqlite'),{databaseBytes:DB});const failed:Array<{countryId:string;reason:string}>=[],attemptFailures:Array<{countryId:string;reason:string}>=[];
  const selectedIdsBeforeClaim=new Set(selected.selections.map(selection=>`fine-prep:${sha256(canonicalJson(buildFinePromotionRequest(context,selection)))}`));if(ledger.list().some(row=>!selectedIdsBeforeClaim.has(String(row.id))&&(row.status==='queued'||row.status==='leased')))throw new Error('preparation ledger contains unselected jobs; refusing to mutate or claim them');
  for(const selection of selected.selections){stop(signal,deadline);const request=buildFinePromotionRequest(context,selection),requestHash=sha256(canonicalJson(request));ledger.enqueue({id:`fine-prep:${requestHash}`,kind:'fine-source-preparation',inputHash:requestHash,payload:{schemaVersion:1,catalogueHash:selected.catalogueHash,selection,request},maxAttempts:2});}
  let claims=0;const verifiedThisRun=new Map<string,ReviewedFineCampaignInput>();
  while(claims<maxJobs){stop(signal,deadline);const job=ledger.claim(`fine-preparation-${process.pid}`,Date.now(),Math.max(1,deadline-Date.now()+1000));if(!job)break;claims++;
   try{const payload=obj(job.payload,'preparation payload'),selection=obj(payload.selection,'selection') as unknown as FinePromotionSelection,request=obj(payload.request,'request') as unknown as FinePromotionRequest;if(payload.catalogueHash!==selected.catalogueHash||sha256(canonicalJson(request))!==job.inputHash||canonicalJson(request)!==canonicalJson(buildFinePromotionRequest(context,selection)))throw new Error('durable request differs from frozen configuration/context');
    let pointer;try{pointer=await(hooks.acquirePointer??acquireFinePointer)(request,{repositoryRoot:repo,signal,durationMs:Math.max(1,Math.min(30_000,deadline-Date.now())),cacheOnly});networkBytesMeasured+=pointer.networkBytes;}catch(error){if(!cacheOnly)unknownNetworkTransfers++;throw error;}if(pointer.requestHash!==job.inputHash||canonicalJson(pointer.pointer)!==canonicalJson(parseFineLFSPointer(pointer.pointerBytes,FINE_LIMITS.sourceBytes))||(cacheOnly&&(pointer.networkBytes!==0||!pointer.cacheHit)))throw new Error('pointer acquisition receipt does not match frozen request/body/cache mode');const promotion=buildFineSourcePromotion(context,selection,pointer.pointerBytes);const pin=validateFineSourcePin(promotion.pin);
    const item=await validOutput(repo,pin,context,request,pointer,signal,deadline,hooks,'run',cacheOnly,n=>{networkBytesMeasured+=n;},()=>{unknownNetworkTransfers++;});stop(signal,deadline);if(!ledger.complete(job.id,job.token,Date.now(),{pin:item.pin,topologyReportPath:item.topologyReportPath,requestHash:job.inputHash}))throw new Error('fine preparation lease expired before completion');verifiedThisRun.set(job.id,item);
   }catch(error){const reason=(error instanceof Error?error.message:String(error)).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,512);const recorded=error instanceof FineSourceFeatureCountMismatch?ledger.failPermanently(job.id,job.token,Date.now(),reason):ledger.fail(job.id,job.token,Date.now(),reason,60_000);if(!recorded)throw new Error('fine preparation lease expired before durable failure recording');const selection=obj(obj(job.payload,'failed payload').selection,'failed selection');attemptFailures.push({countryId:String(selection.countryId??'unknown'),reason});if(signal.aborted)throw error;}
   await usage(state,signal,deadline);
  }
  const rows=ledger.list(),prepared:ReviewedFineCampaignInput[]=[];for(const selection of selected.selections){const request=buildFinePromotionRequest(context,selection),hash=sha256(canonicalJson(request)),row=rows.find(r=>r.id===`fine-prep:${hash}`);if(!row)continue;if(row.status==='completed'){
    const current=verifiedThisRun.get(String(row.id));if(current){prepared.push(current);continue;}
    const result=obj(row.result,'completed preparation'),payload=obj(row.payload,'completed payload');if(Object.keys(result).sort().join(',')!=='pin,requestHash,topologyReportPath'||Object.keys(payload).sort().join(',')!=='catalogueHash,request,schemaVersion,selection'||payload.catalogueHash!==selected.catalogueHash||payload.schemaVersion!==1||canonicalJson(payload.selection)!==canonicalJson(selection))throw new Error('completed fine preparation payload/result has unexpected fields or identity');
    const requestSaved=payload.request as FinePromotionRequest;if(canonicalJson(requestSaved)!==canonicalJson(request)||sha256(canonicalJson(requestSaved))!==hash)throw new Error('completed fine preparation request differs from selected config');const p=await(hooks.acquirePointer??acquireFinePointer)(requestSaved,{repositoryRoot:repo,signal,cacheOnly:true,durationMs:Math.max(1,Math.min(30_000,deadline-Date.now()))});if(p.networkBytes!==0||!p.cacheHit||p.requestHash!==hash||canonicalJson(p.pointer)!==canonicalJson(parseFineLFSPointer(p.pointerBytes,FINE_LIMITS.sourceBytes)))throw new Error('completed pointer verification does not match its cached body/request');
    const promotion=buildFineSourcePromotion(context,selection,p.pointerBytes),pin=validateFineSourcePin(promotion.pin);if(canonicalJson(result.pin)!==canonicalJson(pin)||result.requestHash!==hash||typeof result.topologyReportPath!=='string')throw new Error('completed fine preparation pin/result mismatch');
    const completed=await validOutput(repo,pin,context,requestSaved,p,signal,deadline,hooks,String(result.topologyReportPath),true,()=>{},()=>{throw new Error('completed verification unexpectedly attempted a network transfer');});prepared.push(completed);
   }
  }
  const refreshed=ledger.list(),done=new Set(prepared.map(x=>x.pin.countryIso3));for(const row of refreshed){if(row.status==='failed'){const p=obj(row.payload,'failed payload'),sel=obj(p.selection,'failed selection');if(typeof sel.countryId==='string'&&!failed.some(x=>x.countryId===sel.countryId))failed.push({countryId:sel.countryId,reason:String(row.error??'preparation failed').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,512)});}}
  const pending=selected.selections.filter(s=>{const request=buildFinePromotionRequest(context,s),row=refreshed.find(r=>r.id===`fine-prep:${sha256(canonicalJson(request))}`);return !done.has(s.countryIso3)&&row?.status!=='failed';}).length;
  await usage(state,signal,deadline);
  return{schemaVersion:1,purpose:'fine-source-preparation',catalogueHash:selected.catalogueHash,prepared,pending,failed,attemptFailures,networkBytes:unknownNetworkTransfers?null:networkBytesMeasured,networkBytesMeasured,unknownNetworkTransfers,attempts:refreshed.reduce((sum,row)=>sum+Number(row.attempt??0),0)};
 }finally{try{ledger?.close();}finally{try{if(release)await release();}finally{clearTimeout(timer);}}}
}
