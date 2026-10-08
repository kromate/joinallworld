import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, lstat, opendir, rename, rm, statfs, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { Ledger } from './ledger.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { acquireFineSource } from './fine-acquire.ts';
import { runFineBuild } from './fine-run.ts';
import { buildFineCampaignPlan, type FineCampaignPlan, type FineCampaignUnit } from './fine-campaign-plan.ts';
import type { FineDirectoryCatalogueReport } from './fine-directory-catalogue.ts';
import type { FineSourcePin } from './fine-types.ts';
import { validateFineManifest, validateFineIndex, validateFineIndexProvenance, validateFineOutline, validateFineTopology } from './preview/fine-view.ts';
import { readCountryDirectoryCountry } from './country-directory-reader.ts';

const SHA = /^[a-f0-9]{64}$/;
const STATE_BYTES = 2 * 1024 * 1024, STATE_ENTRIES = 128, STATE_DEPTH = 4;
const MAX_REPORT_BYTES = 512 * 1024;
const LEDGER_BYTES = 512 * 1024, LEDGER_WAL_RESERVE = 528 * 1024, LEDGER_SHM_RESERVE = 32 * 1024;
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function sha(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex'); }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('campaign identity contains a non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort(cmp).map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new TypeError('campaign value is not JSON data');
}
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw signal.reason ?? new DOMException('Fine campaign aborted.', 'AbortError'); }
function exactObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
async function safePath(target: string): Promise<void> {
  const absolute = path.resolve(target), root = path.parse(absolute).root;
  let cursor = root;
  for (const [index, part] of absolute.slice(root.length).split(path.sep).filter(Boolean).entries()) {
    cursor = path.join(cursor, part);
    let info;
    try { info = await lstat(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || (index < absolute.slice(root.length).split(path.sep).filter(Boolean).length - 1 && !info.isDirectory())) throw new Error(`fine campaign path contains a symlink or non-directory: ${cursor}`);
  }
}
async function mkdirSafe(target: string): Promise<void> {
  const absolute = path.resolve(target), root = path.parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`fine campaign directory is unsafe: ${cursor}`);
  }
}
async function treeUsage(root: string): Promise<{bytes:number;entries:number}> {
  let bytes=0, entries=0;
  try{const initial=await lstat(root);if(initial.isSymbolicLink()||!initial.isDirectory())throw new Error('fine campaign state root is unsafe');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {bytes:0,entries:0};throw error;}
  const visit=async (dir:string,depth:number):Promise<void>=>{
    if(depth>STATE_DEPTH)throw new RangeError('fine campaign state exceeds depth cap');
    const dh=await opendir(dir);
    for await(const ent of dh){
      if(++entries>STATE_ENTRIES)throw new RangeError('fine campaign state exceeds 128-entry cap');
      const filename=path.join(dir,ent.name), st=await lstat(filename);
      if(st.isSymbolicLink())throw new Error('fine campaign state contains a symlink');
      if(st.isDirectory())await visit(filename,depth+1); else if(st.isFile())bytes+=st.size; else throw new Error('fine campaign state contains a non-regular entry');
      if(bytes>STATE_BYTES)throw new RangeError('fine campaign state exceeds 2 MiB cap');
    }
  };
  await visit(root,0);
  return {bytes,entries};
}
async function writeAtomic(file:string,bytes:Uint8Array):Promise<void>{
  const temp=`${file}.${randomUUID()}.tmp`, h=await open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
  try{await rename(temp,file);const d=await open(path.dirname(file),constants.O_RDONLY);try{await d.sync();}finally{await d.close();}}
  catch(error){await rm(temp,{force:true});throw error;}
}
async function acquireCampaignLock(lockPath:string, signal:AbortSignal, deadline:number):Promise<()=>Promise<void>>{
  while(true){
    abort(signal); if(Date.now()>=deadline)throw new Error('fine campaign deadline elapsed waiting for its exclusive lock');
    try{
      await mkdir(lockPath);
      const owner={pid:process.pid,token:randomUUID(),startedAt:new Date().toISOString()},ownerBytes=`${JSON.stringify(owner)}\n`;
      try{
        const f=await open(path.join(lockPath,'owner.json'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
        try{await f.writeFile(ownerBytes);await f.sync();}finally{await f.close();}
        const dh=await open(path.dirname(lockPath),constants.O_RDONLY);try{await dh.sync();}finally{await dh.close();}
      }catch(error){await rmdir(lockPath).catch(()=>{});throw error;}
      const lockStat=await lstat(lockPath);
      return async()=>{
        try{
          const now=await lstat(lockPath),ownerFile=path.join(lockPath,'owner.json');
          if(now.ino!==lockStat.ino||now.isSymbolicLink()||!now.isDirectory())throw new Error('fine campaign lock ownership changed before release');
          const current=new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedLocalFile(ownerFile,1024));
          if(current!==ownerBytes)throw new Error('fine campaign lock ownership changed before release');
          await unlink(ownerFile);await rmdir(lockPath);const d=await open(path.dirname(lockPath),constants.O_RDONLY);try{await d.sync();}finally{await d.close();}
        }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      };
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      // Reap only an owner whose process is provably gone; live and malformed locks fail closed.
      try{
        const lockInfo=await lstat(lockPath);if(lockInfo.isSymbolicLink()||!lockInfo.isDirectory())throw new Error('campaign lock path is a symlink or non-directory');
        const file=path.join(lockPath,'owner.json'),st=await lstat(file),directoryBefore=lockInfo,ownerBeforeBytes=await readBoundedLocalFile(file,1024),ownerBefore=new TextDecoder('utf-8',{fatal:true}).decode(ownerBeforeBytes);
        if(st.isSymbolicLink()||!st.isFile())throw new Error('campaign lock owner is unsafe');
        const owner=JSON.parse(ownerBefore) as {pid?:unknown};
        if(!Number.isSafeInteger(owner.pid)||Number(owner.pid)<1)throw new Error('campaign lock owner record is malformed');
        let dead=false;try{process.kill(Number(owner.pid),0);}catch(e){dead=(e as NodeJS.ErrnoException).code==='ESRCH';}
        if(dead){
          const ownerAgainBytes=await readBoundedLocalFile(file,1024),ownerAgain=new TextDecoder('utf-8',{fatal:true}).decode(ownerAgainBytes),directoryAgain=await lstat(lockPath);
          if(ownerBefore===ownerAgain&&directoryBefore.ino===directoryAgain.ino){await unlink(file);await rmdir(lockPath);}
        }
      }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      await new Promise<void>((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',onAbort);resolve();};const timer=setTimeout(done,50);const onAbort=()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);reject(signal.reason??new Error('fine campaign aborted while waiting for lock'));};signal.addEventListener('abort',onAbort,{once:true});});
    }
  }
}
function parseJson(bytes:Uint8Array,label:string):unknown{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch(e){throw new TypeError(`${label} is invalid UTF-8 JSON: ${e instanceof Error?e.message:String(e)}`);}}
async function verifyCatalogue(repo:string,plan:FineCampaignPlan,cataloguePath:string):Promise<FineDirectoryCatalogueReport>{
  const expected=path.join(repo,'.cache/world-build/fine-directory-catalogue/reports',`${plan.catalogueHash}.json`);
  if(path.resolve(cataloguePath)!==expected)throw new Error('catalogueReportPath must be its exact private hash-addressed report path');
  await safePath(expected);const bytes=await readBoundedLocalFile(expected,2*1024*1024);
  if(sha(bytes)!==plan.catalogueHash)throw new Error('catalogue report bytes do not match the plan hash');
  const report=parseJson(bytes,'fine directory catalogue report') as FineDirectoryCatalogueReport;
  if(report.parent?.product!=='country-directory'||report.parent.manifestHash!==plan.parent.manifestHash||report.pin?.sha256!==plan.metadataSha256)throw new Error('catalogue report parent or metadata pin differs from campaign plan');
  const reviewed=plan.units.filter(u=>u.status==='ready').map(u=>({pin:u.pin!,topologyReportPath:u.topologyReportPath!}));
  const rebuilt=buildFineCampaignPlan(report,plan.catalogueHash,reviewed);
  if(canonical(rebuilt)!==canonical(plan))throw new Error('campaign plan does not exactly reproduce from the pinned catalogue and reviewed ready pins');
  return report;
}
function assetPath(root:string,relative:string,folder:string):string{
  if(!new RegExp(`^${folder}/[a-f0-9]{64}\\.json$`).test(relative))throw new Error(`fine campaign asset path is invalid: ${relative}`);
  return path.join(root,...relative.split('/'));
}
async function readHashed(root:string,relative:string,folder:string,max:number):Promise<{bytes:Uint8Array;value:unknown}>{
  const file=assetPath(root,relative,folder);await safePath(file);const bytes=await readBoundedLocalFile(file,max);
  const hash=path.basename(relative,'.json');if(sha(bytes)!==hash)throw new Error(`published fine asset hash mismatch: ${relative}`);
  return {bytes,value:parseJson(bytes,relative)};
}
async function fineAssetFiles(root:string):Promise<string[]>{
  const files:string[]=[];let entries=0;
  const visit=async(dir:string,depth:number):Promise<void>=>{if(depth>4)throw new RangeError('fine country output exceeds depth-4 cap');const dh=await opendir(dir);for await(const entry of dh){if(++entries>256)throw new RangeError('fine country output exceeds 256-entry cap');const file=path.join(dir,entry.name),st=await lstat(file);if(st.isSymbolicLink())throw new Error('fine country output contains a symlink');if(st.isDirectory())await visit(file,depth+1);else if(st.isFile())files.push(path.relative(root,file).split(path.sep).join('/'));else throw new Error('fine country output contains a non-regular asset');}};
  await visit(root,0);return files.sort(cmp);
}
function coordinatePositions(value:unknown):number{
  let total=0;const stack:unknown[]=[value];
  while(stack.length){const current=stack.pop();if(Array.isArray(current)){if(current.length>=2&&typeof current[0]==='number'&&typeof current[1]==='number'){total++;continue;}for(const item of current)stack.push(item);}}
  return total;
}
async function verifyFineOutput(repo:string,parentHash:string,pin:FineSourcePin,result:unknown,signal?:AbortSignal):Promise<{manifestHash:string;manifestPath:string;bytes:number;units:number}>{
  abort(signal);const row=exactObject(result,'completed fine campaign result');
  const resultKeys=Object.keys(row),fromBuild=resultKeys.length===6&&resultKeys.includes('elapsedMs')&&resultKeys.includes('networkBytes');
  if((resultKeys.length!==4&&!fromBuild)||resultKeys.some(key=>!['manifestHash','manifestPath','bytes','units','elapsedMs','networkBytes'].includes(key))||typeof row.manifestHash!=='string'||!SHA.test(row.manifestHash)||typeof row.manifestPath!=='string'||!Number.isSafeInteger(row.bytes)||!Number.isSafeInteger(row.units)||(fromBuild&&(!Number.isSafeInteger(row.elapsedMs)||row.networkBytes!==0)))throw new Error('completed fine job result is malformed');
  const build=path.join(repo,'.cache/world-build'), output=path.join(build,'output/fine',pin.countryCode.toLowerCase(),'adm1');
  const expectedManifest=path.join(output,'manifests',`${row.manifestHash}.json`);
  if(path.resolve(row.manifestPath)!==expectedManifest)throw new Error('completed fine job manifest path is outside its country output');
  const manifestFile=await readHashed(output,`manifests/${row.manifestHash}.json`,'manifests',128*1024);
  const manifest=validateFineManifest(manifestFile.value,parentHash, (await readCountryDirectoryCountry(path.join(build,'output/country-inventory'),parentHash,pin.countryCode,signal)).id);
  if(manifest.schemaVersion!==2||manifest.compiler!=='fine-inventory-compiler-v2'||canonical(manifest.source)!==canonical(pin)||manifest.sourceUnitCount!==pin.expectedUnits)throw new Error('fine manifest schema/source/count binding differs from reviewed campaign pin');
  const indexFile=await readHashed(output,manifest.nodeIndexPath,'node-index',128*1024);
  let index=validateFineIndex(indexFile.value,manifest.countryId,pin.expectedUnits);
  index=validateFineIndexProvenance(index,manifest,pin.countryCode);
  const topologyFile=await readHashed(output,manifest.topologyPath,'topology',64*1024);
  const topology=validateFineTopology(topologyFile.value,manifest,index);
  const registryFile=await readHashed(output,manifest.registryPath,'registries',128*1024);
  const registry=exactObject(registryFile.value,'fine identity registry');
  if(registry.schemaVersion!==1||registry.provider!=='geoBoundaries'||registry.countryId!==manifest.countryId||registry.adminLevel!=='ADM1'||!Array.isArray(registry.entries)||registry.entries.length!==pin.expectedUnits)throw new Error('fine identity registry binding/count is invalid');
  const coverageFile=await readHashed(output,manifest.coveragePath,'coverage',128*1024);
  const coverage=exactObject(coverageFile.value,'fine coverage');
  if(coverage.expectedUnits!==pin.expectedUnits||coverage.sourceUnits!==pin.expectedUnits||coverage.acceptedUnits!==pin.expectedUnits||coverage.rejectedUnits!==0||!Number.isSafeInteger(coverage.coordinatePositions)||Number(coverage.coordinatePositions)<1||Number(coverage.coordinatePositions)>150_000||canonical(coverage.exceptions)!==canonical(topology.exceptions)||canonical(manifest.exceptions)!==canonical(topology.exceptions))throw new Error('fine coverage conservation or topology exceptions are invalid');
  const acquired=await acquireFineSource(pin,{repositoryRoot:repo,cacheOnly:true,signal,durationMs:120_000});
  if(acquired.networkBytes!==0||!acquired.cacheHit)throw new Error('fine campaign source verification was not a cache-only hit');
  const raw=await readBoundedLocalFile(acquired.inputPath,pin.source.bytes);
  if(raw.byteLength!==pin.source.bytes||sha(raw)!==pin.source.sha256)throw new Error('fine campaign source bytes differ from the immutable pin');
  const source=parseJson(raw,'fine source'), collection=exactObject(source,'fine source');
  if(collection.type!=='FeatureCollection'||!Array.isArray(collection.features)||collection.features.length!==pin.expectedUnits)throw new Error('fine source feature denominator differs from pin');
  const byKey=new Map<string,unknown>();
  for(const rawFeature of collection.features){const feature=exactObject(rawFeature,'fine source feature'),props=exactObject(feature.properties,'fine source properties');if(typeof props.shapeID!=='string'||byKey.has(props.shapeID)||props.shapeGroup!==pin.countryIso3||props.shapeType!==pin.adminLevel)throw new Error('fine source feature keys or country/admin bindings are invalid');byKey.set(props.shapeID,feature.geometry);}
  const seen=new Set<string>();let bytes=manifestFile.bytes.byteLength+indexFile.bytes.byteLength+topologyFile.bytes.byteLength+registryFile.bytes.byteLength+coverageFile.bytes.byteLength,positionTotal=0;
  const registryEntries=new Map<string,{sourceFeatureKeys:unknown[];names:unknown[]}>();
  for(const rawEntry of registry.entries){const entry=exactObject(rawEntry,'fine registry entry');if(typeof entry.id!=='string'||registryEntries.has(entry.id)||entry.status!=='active'||!Array.isArray(entry.sourceFeatureKeys)||entry.sourceFeatureKeys.length!==1||!Array.isArray(entry.names)||entry.replacedBy===undefined||!Array.isArray(entry.replacedBy)||entry.replacedBy.length!==0)throw new Error('fine registry contains an invalid, duplicate, retired, or unmapped identity');registryEntries.set(entry.id,{sourceFeatureKeys:entry.sourceFeatureKeys,names:entry.names});}
  for(const entry of index.nodes){abort(signal);const featureKey=entry.node.sourceRef.featureKey;if(seen.has(featureKey)||!byKey.has(featureKey))throw new Error('fine index source feature references do not conserve pinned source keys');seen.add(featureKey);
    const registryEntry=registryEntries.get(entry.node.id);if(!registryEntry||registryEntry.sourceFeatureKeys[0]!==featureKey||!registryEntry.names.includes(entry.node.name))throw new Error('fine registry does not bind indexed node identity/name/source key');
    const file=await readHashed(output,entry.outlinePath,'outlines',2*1024*1024);bytes+=file.bytes.byteLength;const outline=validateFineOutline(file.value);positionTotal+=coordinatePositions(outline.coordinates);
    if(canonical(outline)!==canonical(byKey.get(featureKey)))throw new Error(`published outline differs from pinned source geometry: ${featureKey}`);
  }
  if(seen.size!==byKey.size||registryEntries.size!==index.nodes.length||positionTotal!==coverage.coordinatePositions||bytes>16*1024*1024||row.units!==pin.expectedUnits||row.bytes!==bytes)throw new Error('fine published asset count/byte total differs from its ledger result');
  const referencedFiles=[`manifests/${row.manifestHash}.json`,manifest.nodeIndexPath,manifest.registryPath,manifest.coveragePath,manifest.topologyPath,...index.nodes.map(entry=>entry.outlinePath)].sort(cmp);
  const presentFiles=await fineAssetFiles(output);if(referencedFiles.some(file=>!presentFiles.includes(file)))throw new Error('fine country output is missing one or more currently referenced immutable assets');
  const resultValue={manifestHash:row.manifestHash,manifestPath:expectedManifest,bytes,units:pin.expectedUnits};
  return resultValue;
}

export interface FineCampaignUnitResult { countryId:string; name:string; iso3:string|null; status:string; reason:string; manifestHash?:string; error?:string }
export interface FineCampaignResult { planHash:string; reportHash:string; reportPath:string; total:number; ready:number; compiled:number; pending:number; exceptions:number; protected:number; networkBytes:0; units:FineCampaignUnitResult[] }
export interface RunFineCampaignOptions { repositoryRoot:string; plan:FineCampaignPlan; catalogueReportPath:string; signal?:AbortSignal; maxJobs?:number; durationMs?:number }
export async function runFineCampaign(options:RunFineCampaignOptions):Promise<FineCampaignResult>{
  const started=Date.now(),duration=options.durationMs??120_000,maxJobs=options.maxJobs??300;
  if(!Number.isSafeInteger(duration)||duration<1||duration>120_000)throw new RangeError('fine campaign duration must be between 1 and 120,000 ms');
  if(!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>300)throw new RangeError('fine campaign maxJobs must be between 1 and 300');
  if(!path.isAbsolute(options.repositoryRoot))throw new TypeError('repositoryRoot must be absolute');
  const repo=path.resolve(options.repositoryRoot), deadline=started+duration, controller=new AbortController(), timer=setTimeout(()=>controller.abort(new Error('fine campaign reached its wall deadline')),duration);timer.unref();
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  let release:(()=>Promise<void>)|undefined,ledger:Ledger|undefined;
  try{
    abort(signal);await safePath(repo);const rootInfo=await lstat(repo);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw new Error('repository root must be a real directory');
    const plan=options.plan;if(plan.schemaVersion!==1||plan.purpose!=='administrative-build-campaign'||!SHA.test(plan.catalogueHash)||!SHA.test(plan.parent.manifestHash))throw new TypeError('fine campaign plan identity is malformed');
    await verifyCatalogue(repo,plan,options.catalogueReportPath);
    const planHash=sha(canonical(plan)),build=path.join(repo,'.cache/world-build'),state=path.join(build,'fine-campaigns',planHash);
    await mkdirSafe(state);const disk=await statfs(build);if(disk.bavail*disk.bsize<120*1024*1024)throw new RangeError('fine campaign requires 100 MiB free reserve plus 16 MiB publication and 4 MiB state headroom');
    release=await acquireCampaignLock(path.join(state,'.campaign-lock'),signal,deadline);
    const statePlan=path.join(state,'plan.json'), planBytes=Buffer.from(`${JSON.stringify(plan,null,2)}\n`);
    if(planBytes.byteLength>512*1024)throw new RangeError('fine campaign plan exceeds its 512 KiB immutable state allowance');
    let hasPlan=false;
    try{const existing=await readBoundedLocalFile(statePlan,512*1024);if(sha(existing)!==sha(planBytes))throw new Error('campaign plan state collides with different immutable bytes');hasPlan=true;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const readyUnits=plan.units.filter(u=>u.status==='ready');
    const estimatedLedger=readyUnits.reduce((sum,unit)=>sum+3*Buffer.byteLength(canonical({planHash,unit}))+512,24*1024);
    if(estimatedLedger>LEDGER_BYTES)throw new RangeError('all durable ready-job records cannot fit the campaign 512 KiB SQLite quota');
    const estimatedReportBody={planHash,total:plan.units.length,ready:readyUnits.length,compiled:readyUnits.length,pending:0,exceptions:plan.units.length-readyUnits.length,protected:plan.counts.protected,networkBytes:0,units:plan.units.map(unit=>({countryId:unit.countryId,name:unit.name,iso3:unit.iso3,status:unit.status==='ready'?'failed':unit.status,reason:unit.reason,...(unit.status==='ready'?{error:'x'.repeat(512)}:{})}))};
    const estimatedResultBytes=Buffer.byteLength(JSON.stringify(estimatedReportBody,null,2));
    if(estimatedResultBytes>MAX_REPORT_BYTES)throw new RangeError('worst-case fine campaign report cannot fit its 512 KiB immutable report allowance');
    const estimatedSummaryBytes=Buffer.byteLength(JSON.stringify({...estimatedReportBody,reportHash:'0'.repeat(64),reportPath:path.join(state,'reports','0'.repeat(64)+'.json')},null,2));
    const initialUsage=await treeUsage(state);
    const ledgerFiles=[['jobs.sqlite',LEDGER_BYTES],['jobs.sqlite-wal',LEDGER_WAL_RESERVE],['jobs.sqlite-shm',LEDGER_SHM_RESERVE]] as const;
    let ledgerGrowth=0;for(const [name,cap] of ledgerFiles){let size=0;try{const st=await lstat(path.join(state,name));if(st.isSymbolicLink()||!st.isFile())throw new Error('campaign SQLite state contains an unsafe file');size=st.size;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(size>cap)throw new RangeError(`campaign SQLite state exceeds its ${name} storage cap`);ledgerGrowth+=cap-size;}
    const requiredState=initialUsage.bytes+(hasPlan?0:planBytes.byteLength)+ledgerGrowth+MAX_REPORT_BYTES+estimatedSummaryBytes+32*1024;
    if(requiredState>STATE_BYTES||initialUsage.entries+(hasPlan?0:1)+readyUnits.length*3+8>STATE_ENTRIES)throw new RangeError('fine campaign plan and all durable jobs cannot fit the bounded 2 MiB / 128-entry state budget');
    if(!hasPlan){const h=await open(statePlan,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);try{await h.writeFile(planBytes);await h.sync();}finally{await h.close();}const d=await open(state,constants.O_RDONLY);try{await d.sync();}finally{await d.close();}}
    ledger=new Ledger(path.join(state,'jobs.sqlite'),{databaseBytes:LEDGER_BYTES});
    {const usage=await treeUsage(state);if(usage.bytes>STATE_BYTES||usage.entries>STATE_ENTRIES)throw new RangeError('fine campaign state exceeded its durable budget while initializing SQLite');}
    for(const unit of readyUnits){ledger.enqueue({id:`fine:${unit.countryId}`,kind:'fine-country-directory',inputHash:sha(canonical({planHash,unit})),payload:{planHash,unit},maxAttempts:2,priority:unit.priority});const usage=await treeUsage(state);if(usage.bytes>STATE_BYTES||usage.entries>STATE_ENTRIES)throw new RangeError('fine campaign state exceeded its durable budget while seeding jobs');}
    let jobs=0;
    while(jobs<maxJobs){abort(signal);if(Date.now()>=deadline)throw new Error('fine campaign deadline elapsed');
      const claimed=ledger.claim(`fine-campaign-${process.pid}`,Date.now(),Math.max(1,deadline-Date.now()+1_000));if(!claimed)break;jobs++;
      const payload=exactObject(claimed.payload,'fine campaign job payload'),unit=payload.unit as FineCampaignUnit;
      try{
        if(payload.planHash!==planHash||unit.status!=='ready'||!unit.pin||!unit.topologyReportPath)throw new Error('claimed fine campaign job differs from immutable plan');
        const remaining=Math.max(1,deadline-Date.now());
        const acquired=await acquireFineSource(unit.pin,{repositoryRoot:repo,cacheOnly:true,signal,durationMs:Math.min(120_000,remaining)});
        if(acquired.networkBytes!==0||!acquired.cacheHit)throw new Error('reviewed source is not a verified local cache hit; campaign performs no source downloads');
        const result=await runFineBuild({repositoryRoot:repo,coarseInventoryHash:plan.parent.manifestHash,inventoryProduct:'country-directory',pin:unit.pin,topologyReportPath:unit.topologyReportPath,signal,durationMs:Math.min(120_000,Math.max(1,deadline-Date.now()))});
        const verified=await verifyFineOutput(repo,plan.parent.manifestHash,unit.pin,result,signal);
        abort(signal);if(Date.now()>=deadline)throw new Error('fine campaign deadline elapsed before durable job completion');
        if(!ledger.complete(claimed.id,claimed.token,Date.now(),verified))throw new Error('fine campaign lease expired before durable completion');
      }catch(error){
        const message=(error instanceof Error?error.message:String(error)).slice(0,512);
        ledger.fail(claimed.id,claimed.token,Date.now(),message,0);
        const failedUsage=await treeUsage(state);if(failedUsage.bytes>STATE_BYTES||failedUsage.entries>STATE_ENTRIES)throw new RangeError('fine campaign state exceeded its durable budget while recording a job failure');
        if(signal.aborted)throw signal.reason??error;
      }
      const usage=await treeUsage(state);if(usage.bytes>STATE_BYTES)throw new RangeError('fine campaign durable state exceeds 2 MiB cap');
    }
    const rows=ledger.list(), byCountry=new Map(rows.map(row=>[String(row.id).slice('fine:'.length),row]));
    const units:FineCampaignUnitResult[]=[];
    for(const unit of plan.units){
      abort(signal);
      if(unit.status!=='ready'){units.push({countryId:unit.countryId,name:unit.name,iso3:unit.iso3,status:unit.status,reason:unit.reason});continue;}
      const row=byCountry.get(unit.countryId);if(!row){units.push({countryId:unit.countryId,name:unit.name,iso3:unit.iso3,status:'pending',reason:'Ready campaign job remains queued or unclaimed.'});continue;}
      if(row.status==='completed'){
        try{const verified=await verifyFineOutput(repo,plan.parent.manifestHash,unit.pin!,row.result,signal);units.push({countryId:unit.countryId,name:unit.name,iso3:unit.iso3,status:'compiled',reason:'Immutable fine manifest and all referenced source, topology, registry, coverage, and geometry assets verified.',manifestHash:verified.manifestHash});}
        catch(error){throw new Error(`completed fine campaign output for ${unit.countryId} failed verification; ledger remains completed and is not reset: ${error instanceof Error?error.message:String(error)}`);}
      }else if(row.status==='failed')units.push({countryId:unit.countryId,name:unit.name,iso3:unit.iso3,status:'failed',reason:'Bounded campaign attempts exhausted.',error:String(row.error??'campaign job failed').slice(0,512)});
      else units.push({countryId:unit.countryId,name:unit.name,iso3:unit.iso3,status:'pending',reason:'Ready campaign job remains queued or leased.'});
    }
    const compiled=units.filter(u=>u.status==='compiled').length,pending=units.filter(u=>u.status==='pending').length;
    const protectedCount=units.filter(u=>u.status==='protected').length;
    const exceptions=units.filter(u=>!['compiled','pending','protected'].includes(u.status)).length;
    const result:FineCampaignResult={planHash,reportHash:'',reportPath:'',total:units.length,ready:plan.counts.ready,compiled,pending,exceptions,protected:protectedCount,networkBytes:0,units};
    const reportBody={planHash:result.planHash,total:result.total,ready:result.ready,compiled:result.compiled,pending:result.pending,exceptions:result.exceptions,protected:result.protected,networkBytes:result.networkBytes,units:result.units};
    const reportBytes=Buffer.from(`${JSON.stringify(reportBody,null,2)}\n`),reportHash=sha(reportBytes),reportDir=path.join(state,'reports');await mkdirSafe(reportDir);
    if(reportBytes.byteLength>MAX_REPORT_BYTES)throw new RangeError('fine campaign report exceeds 256 KiB');
    const reportPath=path.join(reportDir,`${reportHash}.json`);try{const prior=await readBoundedLocalFile(reportPath,MAX_REPORT_BYTES);if(sha(prior)!==reportHash)throw new Error('campaign report hash collision');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeAtomic(reportPath,reportBytes);}
    const final={...result,reportHash,reportPath};const finalBytes=Buffer.from(`${JSON.stringify(final,null,2)}\n`);
    await writeAtomic(path.join(state,'summary.json'),finalBytes);
    ledger.close();ledger=undefined;
    const usage=await treeUsage(state);if(usage.bytes>STATE_BYTES||usage.entries>STATE_ENTRIES)throw new RangeError('fine campaign state exceeds bounded size after reporting');
    return final;
  }finally{ledger?.close();if(release)await release();clearTimeout(timer);}
}
