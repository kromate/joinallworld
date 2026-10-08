import { createHash, randomUUID } from 'node:crypto';
import { access, constants, lstat, mkdir, open, readFile, realpath, rename, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger } from './ledger.ts';
import { ALLOWED_ROOT, compileCampaignPlan, jobIdentity, OUTPUT_ROOT, REPOSITORY_ROOT, type WorldPlan } from './pipeline.ts';
import { validateManifest, validateTile } from './validate.ts';
import { sha256 } from './pack.ts';
import type { AcquisitionOptions, AcquisitionRequest, AcquisitionResult, CampaignUnit, WorldCampaign } from './production-types.ts';

const MAX_CAMPAIGN_MS = 48 * 60 * 60 * 1000;
// Source input is a campaign-wide unique-pin budget, hard capped at 64 GB.
const MAX_CAMPAIGN_INPUT_BYTES = 64_000_000_000;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(REPOSITORY_ROOT, '.cache', 'world-build', 'campaigns');
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
export type Acquire = (request: AcquisitionRequest, options: AcquisitionOptions) => Promise<AcquisitionResult>;
type AcquisitionBuildLock = <T>(root:string,operation:(acquire:Acquire)=>Promise<T>,options?:{signal?:AbortSignal;timeoutMs?:number})=>Promise<T>;
type AcquireModule = { acquireRegion?:Acquire; withAcquisitionBuildLock?:AcquisitionBuildLock };
export interface CampaignOptions { allowedRoot?: string; acquire?: Acquire; signal?: AbortSignal; maxJobs?: number; pythonExecutable?: string; inventoryManifestPath?: string }
export interface CampaignReport {
  id: string; status: 'complete'|'exception'|'running'|'stopped';
  counts: { requested:number; sourceUnits:number; compiled:number; exception:number; protected:number; unknown:number };
  stages: { acquire:number; compile:number; validate:number };
  jobs: Array<Record<string, unknown>>; failures:string[]; stopped:string|null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
};
function keys(value: object, allowed: string[], label: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`unknown ${label} field: ${key}`); }
function positive(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) throw new RangeError(`${label} must be a positive safe integer`);
  return value as number;
}
export function validateCampaign(value: unknown): WorldCampaign {
  const raw = object(value, 'campaign'); keys(raw, ['schemaVersion','id','inventoryHash','units','limits'], 'campaign');
  if (raw.schemaVersion !== 1) throw new TypeError('campaign schemaVersion must be 1');
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) throw new TypeError('campaign id is invalid');
  if (typeof raw.inventoryHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.inventoryHash)) throw new TypeError('campaign inventoryHash must be pinned SHA-256');
  if (!Array.isArray(raw.units) || raw.units.length === 0) throw new TypeError('campaign requires at least one explicit source unit');
  const ids = new Set<string>();
  const units = raw.units.map((entry, index) => {
    const unit = object(entry, `unit ${index}`); const kind = unit.kind;
    keys(unit, kind === 'local' ? ['id','inventoryUnitId','priority','kind','plan'] : kind === 'acquire' ? ['id','inventoryUnitId','priority','kind','request'] : ['id','inventoryUnitId','priority','kind','reason'], `unit ${index}`);
    if (typeof unit.id !== 'string' || !unit.id.trim() || ids.has(unit.id)) throw new TypeError('campaign unit ids must be unique non-empty strings'); ids.add(unit.id);
    if (typeof unit.inventoryUnitId !== 'string' || !unit.inventoryUnitId.trim()) throw new TypeError(`unit ${unit.id} requires inventoryUnitId`);
    if (!Number.isSafeInteger(unit.priority) || (unit.priority as number) < 0) throw new RangeError(`unit ${unit.id} priority must be a non-negative safe integer`);
    if (kind === 'local') {
      const plan = object(unit.plan, `unit ${unit.id} plan`);
      if (!plan.region || !plan.source || !plan.input) throw new TypeError(`unit ${unit.id} plan is incomplete`);
      if ((plan.region as {countryCode?:string}).countryCode === 'NG') throw new TypeError('Nigeria is a protected legacy provider and cannot be compiled by a campaign');
      return unit as unknown as CampaignUnit;
    }
    if (kind === 'acquire') {
      const request = object(unit.request, `unit ${unit.id} request`) as unknown as AcquisitionRequest;
      keys(request as object,['schemaVersion','id','inventoryUnitId','region','provider','release','layers','limits'],`unit ${unit.id} request`);
      if (request.schemaVersion !== 1 || typeof request.id!=='string' || request.inventoryUnitId !== unit.inventoryUnitId || request.provider!=='overture' || request.region?.countryCode === 'NG') throw new TypeError(`unit ${unit.id} acquisition identity is invalid or protected`);
      const region=object(request.region,`unit ${unit.id} request region`);keys(region,['id','parentId','name','kind','countryCode','timezone','bounds'],`unit ${unit.id} request region`);
      if(typeof region.id!=='string'||typeof region.name!=='string'||!Array.isArray(region.bounds)||region.bounds.length!==4)throw new TypeError(`unit ${unit.id} acquisition region is invalid`);
      if(!Array.isArray(request.layers)||!request.layers.length||request.layers.some(layer=>layer!=='buildings'&&layer!=='roads'))throw new TypeError(`unit ${unit.id} acquisition layers are invalid`);
      const limits=object(request.limits,`unit ${unit.id} request limits`);keys(limits,['networkBytes','outputBytes','features','durationMs','memoryMb','diskBytes'],`unit ${unit.id} request limits`);
      for(const field of ['networkBytes','outputBytes','features','durationMs','memoryMb','diskBytes'] as const)positive(limits[field],`unit ${unit.id} request ${field}`);
      return unit as unknown as CampaignUnit;
    }
    if (kind === 'protected' && typeof unit.reason === 'string' && unit.reason.trim()) return unit as unknown as CampaignUnit;
    throw new TypeError(`unit ${unit.id} has an unsupported kind`);
  });
  const limits = object(raw.limits, 'campaign limits'); keys(limits, ['durationMs','jobDurationMs','networkBytes','inputBytes','outputBytes','diskBytes','memoryMb','maxAttempts'], 'campaign limits');
  positive(limits.durationMs, 'durationMs', MAX_CAMPAIGN_MS); positive(limits.jobDurationMs, 'jobDurationMs', MAX_CAMPAIGN_MS);
  for (const field of ['networkBytes','outputBytes','diskBytes','memoryMb'] as const) positive(limits[field], field);
  positive(limits.inputBytes,'inputBytes',MAX_CAMPAIGN_INPUT_BYTES);
  positive(limits.memoryMb, 'memoryMb', 65_536);if((limits.memoryMb as number)<64)throw new RangeError('memoryMb must be at least 64');
  positive(limits.maxAttempts, 'maxAttempts', 10);
  return { schemaVersion:1, id:raw.id, inventoryHash:raw.inventoryHash, units:units.sort((a,b)=>a.priority-b.priority || (a.id<b.id?-1:a.id>b.id?1:0)), limits:limits as unknown as WorldCampaign['limits'] };
}
function campaignPaths(id: string, root: string) { const dir=path.join(root,id); return {dir,ledger:path.join(dir,'ledger.sqlite'),config:path.join(dir,'campaign.json'),output:path.join(dir,'output'),quarantine:path.join(dir,'quarantine'),cache:path.join(dir,'source-cache')}; }
async function ensureCanonicalDirectory(target:string):Promise<void>{
  const absolute=path.resolve(target),root=path.parse(absolute).root;let cursor=root;
  for(const part of path.relative(root,absolute).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    try{const info=await lstat(cursor);if(info.isSymbolicLink()||!info.isDirectory())throw new Error(`campaign state path must contain only directories without symlinks: ${cursor}`);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;try{await mkdir(cursor);}catch(mkdirError){if((mkdirError as NodeJS.ErrnoException).code!=='EEXIST')throw mkdirError;}const info=await lstat(cursor);if(info.isSymbolicLink()||!info.isDirectory())throw new Error(`campaign state path must contain only directories without symlinks: ${cursor}`);}
    if(await realpath(cursor)!==cursor)throw new Error(`campaign state path resolves through a symlink: ${cursor}`);
  }
}
async function verifyRegularStateFile(target:string):Promise<void>{try{const info=await lstat(target);if(info.isSymbolicLink()||!info.isFile())throw new Error(`campaign state file must be a regular file without symlinks: ${target}`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
function inside(parent:string,child:string):boolean{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));}
async function validateCampaignRoot(root:string):Promise<string>{
  const requested=path.resolve(root),production=path.resolve(DEFAULT_ROOT),tempLexical=path.resolve(tmpdir());
  if(!inside(production,requested)&&!inside(tempLexical,requested))throw new Error('campaign state root must be inside .cache/world-build/campaigns or an isolated system temporary directory');
  if(inside(production,requested)&&requested!==production)throw new Error('production campaigns must use the shared canonical campaigns root');
  let check=requested;while(check!==production&&check!==tempLexical){try{const info=await lstat(check);if(info.isSymbolicLink())throw new Error(`campaign state path contains a symlink: ${check}`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}const parent=path.dirname(check);if(parent===check)break;check=parent;}
  let ancestor=requested;const missing:string[]=[];
  while(true){try{await lstat(ancestor);break;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const parent=path.dirname(ancestor);if(parent===ancestor)throw e;missing.unshift(path.basename(ancestor));ancestor=parent;}}
  const canonical=path.join(await realpath(ancestor),...missing),productionReal=path.join(await realpath(REPOSITORY_ROOT),'.cache','world-build','campaigns'),tempReal=await realpath(tmpdir());
  if(!inside(productionReal,canonical)&&!inside(tempReal,canonical))throw new Error('campaign state root resolves outside its approved builder or temporary root');
  await ensureCanonicalDirectory(canonical);return canonical;
}
async function acquireCampaignLock(root:string):Promise<()=>Promise<void>>{
  const file=path.join(root,'.campaign-runner.lock'),owner=`${process.pid}:${randomUUID()}`;
  for(let attempt=0;attempt<2;attempt++){
    try{const handle=await open(file,'wx',0o600);await handle.writeFile(owner);await handle.sync();await handle.close();return async()=>{try{if((await readFile(file,'utf8'))===owner)await unlink(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}};}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error('campaign runner lock is not a regular file');const value=(await readFile(file,'utf8')).trim(),pid=Number(value.split(':')[0]);let alive=Number.isSafeInteger(pid)&&pid>0;if(alive){try{process.kill(pid,0);}catch(error){alive=(error as NodeJS.ErrnoException).code==='EPERM';}}if(!Number.isSafeInteger(pid)&&Date.now()-info.mtimeMs<30_000)alive=true;if(alive)throw new Error(`another campaign runner is active (pid ${pid})`);await unlink(file);}
  }
  throw new Error('could not acquire campaign runner lock');
}
async function recordStage(dir:string,unitId:string,stage:'acquire'|'compile'|'validate',state:'started'|'complete'|'exception'):Promise<void>{
  const handle=await open(path.join(dir,'stages.jsonl'),'a',0o600);try{await handle.writeFile(`${JSON.stringify({unitId,stage,state,at:Date.now()})}\n`);await handle.sync();}finally{await handle.close();}
}
async function stageCounts(dir:string):Promise<{acquire:number;compile:number;validate:number}>{
  let data='';try{data=await readFile(path.join(dir,'stages.jsonl'),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const completed=new Set<string>(),lines=data.split('\n');let validLines=lines;
  if(data&&!data.endsWith('\n')){
    const tail=lines.at(-1)!;let valid=true;try{JSON.parse(tail);}catch{valid=false;}
    if(valid){validLines=[...lines.slice(0,-1),tail];await writeFile(path.join(dir,'stages.jsonl'),`${validLines.join('\n')}\n`);}
    else{const audit=path.join(dir,'stage-journal-repair.jsonl'),handle=await open(audit,'a',0o600);try{await handle.writeFile(`${JSON.stringify({action:'discard-truncated-final-stage-record',tail,at:Date.now()})}\n`);await handle.sync();}finally{await handle.close();}validLines=lines.slice(0,-1);await writeFile(path.join(dir,'stages.jsonl'),validLines.length?`${validLines.join('\n')}\n`:'');}
  }
  for(const line of validLines.filter(Boolean)){const row=JSON.parse(line) as {unitId:string;stage:string;state:string};if(row.state==='complete')completed.add(`${row.unitId}:${row.stage}`);}
  return{acquire:[...completed].filter(x=>x.endsWith(':acquire')).length,compile:[...completed].filter(x=>x.endsWith(':compile')).length,validate:[...completed].filter(x=>x.endsWith(':validate')).length};
}
type UsageEntry={key:string;sequence:number;sourceKey:string;inputPinKey?:string;phase:'reserved'|'settled';networkBytes:number;inputBytes:number;outputBytes:number;diskBytes:number;requestHash?:string;receiptPath?:string};
async function usageEntries(dir:string):Promise<Map<string,UsageEntry>>{
  let data='';try{data=await readFile(path.join(dir,'usage.jsonl'),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const rows=new Map<string,UsageEntry>(),lines=data.split('\n');let valid=lines;
  if(data&&!data.endsWith('\n')){const tail=lines.at(-1)!;try{JSON.parse(tail);valid=lines;await writeFile(path.join(dir,'usage.jsonl'),`${data}\n`);}catch{const audit=await open(path.join(dir,'usage-journal-repair.jsonl'),'a',0o600);try{await audit.writeFile(`${JSON.stringify({action:'discard-truncated-final-usage-record',tail,at:Date.now()})}\n`);await audit.sync();}finally{await audit.close();}valid=lines.slice(0,-1);await writeFile(path.join(dir,'usage.jsonl'),valid.length?`${valid.join('\n')}\n`:'');}}
  for(const line of valid.filter(Boolean)){const row=JSON.parse(line) as UsageEntry;if(!Number.isSafeInteger(row.sequence)||row.sequence<1)throw new Error('campaign usage journal has invalid sequence');rows.set(row.key,row);}return rows;
}
async function recordUsage(dir:string,entry:Omit<UsageEntry,'sequence'>):Promise<UsageEntry>{const rows=await usageEntries(dir),sequence=Math.max(0,...[...rows.values()].map(x=>x.sequence))+1,full={...entry,sequence};const handle=await open(path.join(dir,'usage.jsonl'),'a',0o600);try{await handle.writeFile(`${JSON.stringify(full)}\n`);await handle.sync();}finally{await handle.close();}return full;}
function usageTotals(rows:Map<string,UsageEntry>){let networkBytes=0,outputBytes=0,acquisitionDiskBytes=0;for(const row of rows.values()){networkBytes+=row.networkBytes;outputBytes+=row.outputBytes;acquisitionDiskBytes+=row.diskBytes;}const unique=new Map<string,number>();for(const row of rows.values()){const key=row.inputPinKey??`reservation:${row.sourceKey}`;unique.set(key,Math.max(unique.get(key)??0,row.inputBytes));}return{networkBytes,outputBytes,inputBytes:[...unique.values()].reduce((a,b)=>a+b,0),acquisitionDiskBytes};}
function coverageCounts(campaign:WorldCampaign,jobs:Array<Record<string,unknown>>):CampaignReport['counts']{
  const byId=new Map(jobs.map(job=>[String(job.id),job])),sourceGroups=new Map<string,CampaignUnit[]>(),protectedGroups=new Map<string,CampaignUnit[]>();
  for(const unit of campaign.units){const groups=unit.kind==='protected'?protectedGroups:sourceGroups;const group=groups.get(unit.inventoryUnitId)??[];group.push(unit);groups.set(unit.inventoryUnitId,group);}
  let compiled=0,exception=0,protectedCount=0,unknown=0;
  for(const units of sourceGroups.values()){const states=units.map(unit=>byId.get(`${campaign.id}:${unit.id}`));if(states.every(job=>job?.status==='completed'&&(job.result as {status?:string}|null)?.status!=='protected'))compiled++;else if(states.some(job=>job?.status==='failed'))exception++;else unknown++;}
  for(const units of protectedGroups.values()){const states=units.map(unit=>byId.get(`${campaign.id}:${unit.id}`));if(states.every(job=>job?.status==='completed'))protectedCount++;}
  return{requested:campaign.units.length,sourceUnits:sourceGroups.size,compiled,exception,protected:protectedCount,unknown};
}
const campaignHash = (campaign: WorldCampaign) => digest(campaign);
async function ensureCampaign(campaign: WorldCampaign, root: string) {
  await ensureCanonicalDirectory(root);
  const p=campaignPaths(campaign.id,root); await mkdir(p.dir,{recursive:false}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
  await ensureCanonicalDirectory(p.dir);await ensureCanonicalDirectory(p.cache);await verifyRegularStateFile(p.config);
  let current:string|null=null;
  try{current=(await readFile(p.config,'utf8')).trim();}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const serialized=canonical(campaign);
  if(current!==null&&current!==serialized)throw new Error(`campaign ${campaign.id} already exists with a different immutable configuration`);
  if(current===null){const temp=`${p.config}.${randomUUID()}.tmp`;await writeFile(temp,serialized,{flag:'wx',mode:0o600});await rename(temp,p.config);}
  return p;
}
async function loadRealAcquireModule():Promise<Required<AcquireModule>>{
  await access(path.join(MODULE_DIR,'acquire.ts'));
  const mod=await import('./acquire.ts') as AcquireModule;
  if(typeof mod.acquireRegion!=='function')throw new Error('world/acquire.ts does not export acquireRegion');
  if(typeof mod.withAcquisitionBuildLock!=='function')throw new Error('world/acquire.ts does not export withAcquisitionBuildLock');
  return mod as Required<AcquireModule>;
}
async function resolvePython(value?:string):Promise<string>{
  if(value){if(!path.isAbsolute(value))throw new TypeError('pythonExecutable must be an absolute path');return value;}
  for(const dir of (process.env.PATH??'').split(path.delimiter)){if(!dir)continue;const candidate=path.join(dir,'python3');try{await access(candidate,constants.X_OK);return candidate;}catch{}}
  throw new Error('Python 3.12 was not found on PATH; set campaign pythonExecutable to an absolute path');
}
async function verifyInventorySnapshot(filePath:string, expectedHash:string, requiredIds:string[], protectedIds:string[]=[]):Promise<void>{
  const file=path.resolve(filePath),outputReal=await realpath(OUTPUT_ROOT).catch(()=>path.resolve(OUTPUT_ROOT)),tempReal=await realpath(tmpdir()),actualFile=await realpath(file);
  const base=inside(outputReal,actualFile)?outputReal:inside(tempReal,actualFile)?tempReal:null;
  if(!base)throw new Error('inventory manifest must be inside builder output or an isolated temporary directory');
  let cursor=base;for(const part of path.relative(base,actualFile).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const info=await lstat(cursor);if(info.isSymbolicLink())throw new Error(`inventory manifest path contains a symlink: ${cursor}`);}
  const canonicalFile=actualFile;
  const bytes=await readFile(canonicalFile);if(sha256(bytes)!==expectedHash)throw new Error('campaign inventory manifest does not match its pinned SHA-256');
  const inventoryRoot=path.dirname(path.dirname(canonicalFile)),manifest=JSON.parse(bytes.toString('utf8')) as {schemaVersion?:number;sourceUnitCount?:number;rootNodePath?:string};
  if(manifest.schemaVersion!==1||!Number.isSafeInteger(manifest.sourceUnitCount)||!manifest.rootNodePath)throw new Error('campaign inventory manifest is invalid');
  const found=new Map<string,{kind?:string;provider?:string}>(),visited=new Set<string>();let denominator=0;
  const walk=async(relative:string,expectedId?:string):Promise<void>=>{if(!/^nodes\/[a-f0-9]{64}\.json$/.test(relative)||visited.has(relative))throw new Error('campaign inventory node path is invalid or cyclic');visited.add(relative);const nodePath=path.join(inventoryRoot,...relative.split('/')),data=await readFile(nodePath);if(sha256(data)!==path.basename(relative).slice(0,-5))throw new Error(`campaign inventory node hash mismatch: ${relative}`);const row=JSON.parse(data.toString('utf8')) as {node?:{id?:string;kind?:string;provider?:string;sourceFeatureIds?:string[]};children?:Array<{id:string;path:string}>};if(!row.node||typeof row.node.id!=='string'||(expectedId&&row.node.id!==expectedId)||!Array.isArray(row.node.sourceFeatureIds)||!Array.isArray(row.children))throw new Error(`campaign inventory node is invalid: ${relative}`);found.set(row.node.id,{kind:row.node.kind,provider:row.node.provider});denominator+=row.node.sourceFeatureIds.length;for(const child of row.children){await walk(child.path,child.id);}};
  await walk(manifest.rootNodePath,'world:earth');if(denominator!==manifest.sourceUnitCount)throw new Error('campaign inventory source-unit denominator is invalid');for(const id of requiredIds){const node=found.get(id);if(!node)throw new Error(`campaign inventory does not contain reachable source unit ${id}`);if(node.kind!=='country'||node.provider!=='world')throw new Error(`campaign source unit ${id} is not a world country node`);}for(const id of protectedIds){const node=found.get(id);if(!node||node.kind!=='country'||node.provider!=='legacy-ng')throw new Error(`protected campaign unit ${id} does not resolve to the legacy provider node`);}
}
function campaignInventoryUnits(campaign:WorldCampaign){return{source:[...new Set(campaign.units.filter(unit=>unit.kind!=='protected').map(unit=>unit.inventoryUnitId))],protected:[...new Set(campaign.units.filter(unit=>unit.kind==='protected').map(unit=>unit.inventoryUnitId))]};}
async function verifyCompleted(result:unknown,output:string,plan:WorldPlan):Promise<void>{
  const sourceStat=await stat(plan.input.path);if(!sourceStat.isFile()||sourceStat.size>20_000_000)throw new Error(`campaign source cache is corrupt (${plan.input.path})`);
  const input=await readFile(plan.input.path);
  if(input.byteLength!==plan.input.bytes||sha256(input)!==plan.input.sha256||plan.source.sha256!==plan.input.sha256||plan.source.bytes!==input.byteLength)throw new Error(`campaign source cache is corrupt (${plan.input.path})`);
  const rec=object(result,'campaign result');
  if(typeof rec.manifestPath!=='string'||typeof rec.manifestHash!=='string'||rec.manifestPath!==`manifests/${rec.manifestHash}.json`)throw new Error('completed campaign result has invalid manifest identity');
  const readBounded=async(relative:string,limit:number)=>{
    if(path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('unsafe campaign output path');
    const target=path.resolve(output,...relative.split('/'));const rel=path.relative(output,target);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('campaign output escaped its root');
    let cursor=output;for(const part of relative.split('/').slice(0,-1)){cursor=path.join(cursor,part);const parent=await lstat(cursor);if(parent.isSymbolicLink()||!parent.isDirectory())throw new Error(`unsafe campaign output path ${relative}`);}
    let info;try{info=await lstat(target);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new Error(`corrupt campaign output ${relative}`);throw e;}
    if(info.isSymbolicLink()||!info.isFile()||info.size>limit||await realpath(target)!==target)throw new Error(`corrupt campaign output ${relative}`);return readFile(target);
  };
  const manifestBytes=await readBounded(rec.manifestPath,2_000_000);
  if(sha256(manifestBytes)!==rec.manifestHash)throw new Error(`corrupt campaign output ${rec.manifestPath}`);
  const manifest=validateManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown);
  if(manifest.region.id!==plan.region.id||!manifest.sources.some(s=>s.sha256===plan.source.sha256))throw new Error('campaign manifest does not match claimed source/region');
  if(manifest.tiles.reduce((count,tile)=>count+tile.drawCalls,0)===0)throw new Error('source unit has no compiled source features; empty geography is an explicit coverage exception');
  const sourceIds=new Set(manifest.sources.map(s=>s.id));
  for(const tile of manifest.tiles){const bytes=await readBounded(tile.path,10_000_000);if(bytes.byteLength!==tile.bytes||sha256(bytes)!==tile.sha256)throw new Error(`corrupt campaign output ${tile.path}`);const decoded=validateTile(JSON.parse(bytes.toString('utf8')) as unknown);if(decoded.id!==tile.id||decoded.regionId!==manifest.region.id||[...decoded.buildings,...decoded.roads].some(f=>!sourceIds.has(f.sourceId)))throw new Error(`campaign output does not resolve: ${tile.path}`);}
}
async function dirBytes(target:string):Promise<number>{let total=0;let entries;try{entries=await readdir(target,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;throw e;}for(const ent of entries){const p=path.join(target,ent.name);if(ent.isDirectory())total+=await dirBytes(p);else if(ent.isFile())total+=(await stat(p)).size;}return total;}
async function acquisitionTreeBytes(target:string):Promise<number>{let total=0;let info;try{info=await lstat(target);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;throw e;}if(info.isSymbolicLink())throw new Error(`acquisition cache accounting refuses symlink ${target}`);if(info.isFile())return info.size;if(!info.isDirectory())throw new Error(`acquisition cache accounting found a non-regular path ${target}`);for(const name of await readdir(target))total+=await acquisitionTreeBytes(path.join(target,name));return total;}
async function acquisitionCacheBytes(root:string,realAdapter:boolean):Promise<number>{if(!realAdapter)return acquisitionTreeBytes(root);let total=0;for(const name of ['acquisitions','acquisition-index','acquisition-attempts'])total+=await acquisitionTreeBytes(path.join(root,name));return total;}
export async function runCampaign(value:unknown,options:CampaignOptions={}):Promise<CampaignReport>{
  if(options.maxJobs!==undefined&&(!Number.isSafeInteger(options.maxJobs)||options.maxJobs<0))throw new RangeError('maxJobs must be a non-negative safe integer');
  const campaign=validateCampaign(value),root=await validateCampaignRoot(path.resolve(options.allowedRoot??DEFAULT_ROOT));const paths=await ensureCampaign(campaign,root),hash=campaignHash(campaign),releaseLock=await acquireCampaignLock(root);
  const failures:string[]=[],start=Date.now(),deadline=start+campaign.limits.durationMs;let stopped:string|null=null,processed=0,ledger:Ledger|undefined;
  try{
    const bindingFile=path.join(paths.dir,'inventory-binding.json'),requiresRealInventory=options.acquire===undefined&&campaign.units.some(unit=>unit.kind==='acquire');await verifyRegularStateFile(bindingFile);
    if(requiresRealInventory&&!options.inventoryManifestPath)throw new Error('real acquisition requires --inventory-manifest with the pinned inventory snapshot');
    let binding:{path:string;hash:string}|null=null;try{binding=JSON.parse(await readFile(bindingFile,'utf8')) as {path:string;hash:string};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const inventoryUnits=campaignInventoryUnits(campaign);
    if(options.inventoryManifestPath){await verifyInventorySnapshot(options.inventoryManifestPath,campaign.inventoryHash,inventoryUnits.source,inventoryUnits.protected);const candidate={path:await realpath(options.inventoryManifestPath),hash:campaign.inventoryHash};if(binding&&canonical(binding)!==canonical(candidate))throw new Error('campaign inventory binding is immutable');if(!binding){await writeFile(bindingFile,canonical(candidate),{flag:'wx',mode:0o600});binding=candidate;}}
    if(binding)await verifyInventorySnapshot(binding.path,campaign.inventoryHash,inventoryUnits.source,inventoryUnits.protected);
    await verifyRegularStateFile(paths.ledger);
    ledger=new Ledger(paths.ledger);const db=ledger;
    for(const unit of campaign.units){const unitHash=digest({campaignHash:hash,inventoryHash:campaign.inventoryHash,unit});ledger.enqueue({id:`${campaign.id}:${unit.id}`,kind:`campaign-${unit.kind}`,inputHash:unitHash,payload:{campaignId:campaign.id,campaignHash:hash,inventoryHash:campaign.inventoryHash,unit},maxAttempts:campaign.limits.maxAttempts,priority:unit.priority});}
    // A completed receipt is not trusted across process restarts: revalidate every exact manifest/tile first.
    for(const completed of ledger.list().filter(j=>j.status==='completed'&&(j.result as {status?:string}|null)?.status!=='protected')){
      const completedId=String(completed.id),result=completed.result as Record<string,unknown>|null, plan=result?.plan as WorldPlan|undefined;
      if(!plan)throw new Error(`completed campaign job ${completedId} has no resumable plan receipt`);
      try{await verifyCompleted(result,paths.output,plan);}
      catch(error){
        const message=error instanceof Error?error.message:String(error),relative=message.match(/corrupt campaign output (.+)$/)?.[1];
        if(!relative)throw error;
        const auditPath=path.join(paths.dir,'repair-audit.json');let audit:Array<{job:string;file:string;at:number}>=[];
        try{audit=JSON.parse(await readFile(auditPath,'utf8')) as typeof audit;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        if(audit.filter(item=>item.job===completedId).length>=campaign.limits.maxAttempts)throw new Error(`repair limit reached for ${completedId}: ${relative}`);
        const file=path.resolve(paths.output,...relative.split('/')),rel=path.relative(paths.output,file);
        if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('corrupt output path escaped campaign root');
        await mkdir(paths.quarantine,{recursive:true});
        try{await rename(file,path.join(paths.quarantine,`${Date.now()}-${path.basename(file)}`));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        audit.push({job:completedId,file:relative,at:Date.now()});await writeFile(auditPath,JSON.stringify(audit),'utf8');
        if(!ledger.requeueCompleted(completedId))throw new Error(`could not requeue verified corrupt campaign job ${completedId}`);
      }
    }
    while(processed<(options.maxJobs??campaign.units.length*campaign.limits.maxAttempts)){
      if(options.signal?.aborted){stopped='campaign stopped by signal';break;}if(Date.now()>=deadline){stopped='campaign duration limit reached';break;}
      const leaseMs=Math.min(campaign.limits.jobDurationMs,60_000),claim=ledger.claim(`campaign-${process.pid}`,Date.now(),leaseMs);if(!claim)break;
      const heartbeat=setInterval(()=>{db.heartbeat(claim.id,claim.token,Date.now(),leaseMs);},Math.min(15_000,Math.max(1,Math.floor(leaseMs/3))));heartbeat.unref();
      let activeStage:'acquire'|'compile'|'validate'='acquire';
      let activeAcquisitionUsage:{reservation:UsageEntry;sourceKey:string;root:string;realAdapter:boolean;beforeBytes:number}|null=null;
      try{
        const payload=object(claim.payload,'claimed campaign payload');if(payload.campaignId!==campaign.id||payload.campaignHash!==hash||payload.inventoryHash!==campaign.inventoryHash)throw new Error('claimed payload does not match immutable campaign configuration');
        const unit=payload.unit as CampaignUnit;if(!unit||!campaign.units.some(u=>digest(u)===digest(unit)))throw new Error('claimed unit is not present in campaign configuration');
        if(claim.id!==`${campaign.id}:${unit.id}`||claim.inputHash!==digest({campaignHash:hash,inventoryHash:campaign.inventoryHash,unit}))throw new Error('claimed job id or input hash does not match its unit payload');
        if(unit.kind==='protected'){ledger.complete(claim.id,claim.token,Date.now(),{status:'protected',reason:unit.reason});processed++;continue;}
        let plan:WorldPlan;let acquisition:{networkBytes:number;outputBytes:number;features:number}|null=null;
        if(unit.kind==='local'){
          plan=unit.plan;activeStage='compile';
          const usage=await usageEntries(paths.dir),sourceKey=`local:${plan.input.sha256}:${plan.input.bytes}`,known=[...usage.values()].some(row=>row.sourceKey===sourceKey);
          const totals=usageTotals(usage);if(!known&&totals.inputBytes+plan.input.bytes>campaign.limits.inputBytes)throw new RangeError('campaign input byte budget exhausted');
          if(!known)await recordUsage(paths.dir,{key:`input:${sourceKey}`,sourceKey,inputPinKey:`${plan.input.sha256}:${plan.input.bytes}`,phase:'settled',networkBytes:0,inputBytes:plan.input.bytes,outputBytes:0,diskBytes:0});
        }
        else{
          await recordStage(paths.dir,unit.id,'acquire','started');
          const executeAcquisition=async(acquire:Acquire,acquisitionRoot:string,realAdapter:boolean):Promise<AcquisitionResult>=>{
            const limits=unit.request.limits,usage=await usageEntries(paths.dir),sourceSelection={...unit.request,limits:undefined},sourceKey=digest({inventoryHash:campaign.inventoryHash,request:sourceSelection}),previous=[...usage.values()].filter(entry=>entry.sourceKey===sourceKey).at(-1),totals=usageTotals(usage),diskUsed=await dirBytes(paths.dir),fsInfo=await statfs(paths.dir),diskFree=fsInfo.bavail*fsInfo.bsize;
            if(diskFree<100_000_000||diskUsed>=campaign.limits.diskBytes)throw new RangeError('campaign disk budget exhausted');
            let cacheReceipt=false;if(previous?.phase==='settled'&&previous.receiptPath){try{await access(previous.receiptPath);cacheReceipt=true;}catch{cacheReceipt=false;}}
            const priorInputReservation=Math.max(0,...[...usage.values()].filter(entry=>entry.sourceKey===sourceKey).map(entry=>entry.inputBytes));
            const inputAllowance=priorInputReservation>0?priorInputReservation:Math.min(limits.outputBytes,campaign.limits.inputBytes-totals.inputBytes);
            const networkAllowance=cacheReceipt?1:Math.min(limits.networkBytes,campaign.limits.networkBytes-totals.networkBytes);
            const outputAllowance=cacheReceipt?Math.max(1,previous?.outputBytes??0):Math.min(limits.outputBytes,campaign.limits.outputBytes-totals.outputBytes-(await dirBytes(paths.output)),inputAllowance);
            const diskAllowance=Math.min(limits.diskBytes,campaign.limits.diskBytes-diskUsed-totals.acquisitionDiskBytes);
            if(networkAllowance<1||outputAllowance<1||diskAllowance<1)throw new RangeError('campaign acquisition budget exhausted');
            const reservationKey=`attempt:${randomUUID()}`,reservation=await recordUsage(paths.dir,{key:reservationKey,sourceKey,phase:'reserved',networkBytes:networkAllowance,inputBytes:inputAllowance,outputBytes:cacheReceipt?0:outputAllowance,diskBytes:diskAllowance});
            const diskBefore=await acquisitionCacheBytes(acquisitionRoot,realAdapter);
            activeAcquisitionUsage={reservation,sourceKey,root:acquisitionRoot,realAdapter,beforeBytes:diskBefore};
            try{
            const boundedRequest:AcquisitionRequest={...unit.request,limits:{...limits,networkBytes:cacheReceipt?1:networkAllowance,outputBytes:outputAllowance,diskBytes:diskAllowance,memoryMb:Math.min(limits.memoryMb,campaign.limits.memoryMb),durationMs:Math.min(limits.durationMs,campaign.limits.jobDurationMs,Math.max(1,deadline-Date.now()))}};
            const controller=new AbortController(),jobTimer=setTimeout(()=>controller.abort(new Error('acquisition job duration limit reached')),Math.min(limits.durationMs,campaign.limits.jobDurationMs,Math.max(1,deadline-Date.now())));jobTimer.unref();
            const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
            const pythonExecutable=options.acquire?(options.pythonExecutable??'<injected-acquisition>'):await resolvePython(options.pythonExecutable);
            let result:AcquisitionResult;try{result=await acquire(boundedRequest,{pythonExecutable,allowedRoot:acquisitionRoot,signal});}finally{clearTimeout(jobTimer);}
            if(!/^[a-f0-9]{64}$/.test(result.requestHash))throw new Error('acquisition callback returned invalid request identity');
            const inputPath=path.resolve(result.plan.input.path),receiptPath=path.resolve(result.receiptPath),cacheRoot=await realpath(acquisitionRoot);
            if(!inside(acquisitionRoot,inputPath)||!inside(acquisitionRoot,receiptPath)||await realpath(inputPath)!==inputPath||await realpath(receiptPath)!==receiptPath||await realpath(inputPath).then(real=>!inside(cacheRoot,real))||await realpath(receiptPath).then(real=>!inside(cacheRoot,real)))throw new Error('acquisition result paths must be canonical files inside the approved acquisition cache');
            if(canonical(result.plan.region)!==canonical(unit.request.region))throw new Error('acquisition result region does not match claimed request');
            const cacheHit=cacheReceipt&&previous?.requestHash===result.requestHash&&result.metrics.networkBytes===0;
            const networkUsed=result.metrics.networkBytes,outputUsed=cacheHit?0:result.metrics.outputBytes;
            if(result.metrics.networkBytes>(cacheHit?previous.networkBytes:boundedRequest.limits.networkBytes)||result.metrics.outputBytes>boundedRequest.limits.outputBytes||result.metrics.features>limits.features||totals.networkBytes+networkUsed>campaign.limits.networkBytes||totals.outputBytes+outputUsed+(await dirBytes(paths.output))>campaign.limits.outputBytes||result.plan.input.bytes>reservation.inputBytes)throw new RangeError('acquisition actual resource usage exceeds declared campaign or request limits');
            const diskAfter=await acquisitionCacheBytes(acquisitionRoot,realAdapter),sharedGrowth=realAdapter?Math.max(0,diskAfter-diskBefore):0;
            if(sharedGrowth>diskAllowance||await dirBytes(paths.dir)+totals.acquisitionDiskBytes+sharedGrowth>campaign.limits.diskBytes)throw new RangeError('campaign disk budget exceeded during acquisition');
            await recordUsage(paths.dir,{key:reservation.key,sourceKey,inputPinKey:`${result.plan.input.sha256}:${result.plan.input.bytes}`,phase:'settled',networkBytes:networkUsed,inputBytes:result.plan.input.bytes,outputBytes:outputUsed,diskBytes:sharedGrowth,requestHash:result.requestHash,receiptPath:result.receiptPath});
            activeAcquisitionUsage=null;return result;
            }catch(error){
              const active=activeAcquisitionUsage;
              if(active){
                let suffix='';
                try{const after=await acquisitionCacheBytes(active.root,active.realAdapter),growth=active.realAdapter?Math.max(0,after-active.beforeBytes):0;await recordUsage(paths.dir,{key:active.reservation.key,sourceKey:active.sourceKey,phase:'settled',networkBytes:active.reservation.networkBytes,inputBytes:active.reservation.inputBytes,outputBytes:active.reservation.outputBytes,diskBytes:growth});if(growth>active.reservation.diskBytes)suffix=`; shared acquisition cache grew ${growth} bytes past its ${active.reservation.diskBytes}-byte reservation`;}
                catch(accountingError){suffix=`; failed to settle shared acquisition disk usage: ${accountingError instanceof Error?accountingError.message:String(accountingError)}`;}
                activeAcquisitionUsage=null;
                if(suffix)throw new Error(`${error instanceof Error?error.message:String(error)}${suffix}`,{cause:error});
              }
              throw error;
            }
          };
          let result:AcquisitionResult;
          if(options.acquire)result=await executeAcquisition(options.acquire,paths.cache,false);
          else{const adapter=await loadRealAcquireModule(),lockTimeout=Math.max(1,deadline-Date.now()),deadlineController=new AbortController(),deadlineTimer=setTimeout(()=>deadlineController.abort(new Error('campaign duration limit reached while waiting for acquisition lock')),lockTimeout);deadlineTimer.unref();const lockSignal=options.signal?AbortSignal.any([options.signal,deadlineController.signal]):deadlineController.signal;try{result=await adapter.withAcquisitionBuildLock(ALLOWED_ROOT,acquire=>executeAcquisition(acquire,ALLOWED_ROOT,true),{signal:lockSignal,timeoutMs:lockTimeout});}finally{clearTimeout(deadlineTimer);}}
          acquisition={networkBytes:result.metrics.networkBytes,outputBytes:result.metrics.outputBytes,features:result.metrics.features};plan=result.plan;
          await recordStage(paths.dir,unit.id,'acquire','complete');
          activeStage='compile';
        }
        const identity=jobIdentity(plan);if(plan.region.countryCode==='NG')throw new Error('Nigeria region compilation is explicitly excluded');
        if(await dirBytes(paths.output)>=campaign.limits.diskBytes)throw new RangeError('campaign disk budget exhausted');
        const existingOutput=await dirBytes(paths.output),remainingOutput=campaign.limits.outputBytes-existingOutput,acquisitionDiskBytes=usageTotals(await usageEntries(paths.dir)).acquisitionDiskBytes,diskRemaining=campaign.limits.diskBytes-await dirBytes(paths.dir)-acquisitionDiskBytes;
        if(remainingOutput<1)throw new RangeError('campaign output budget exhausted');if(diskRemaining<1)throw new RangeError('campaign disk budget exhausted');
        await recordStage(paths.dir,unit.id,'compile','started');
        const result=await compileCampaignPlan(plan,paths.output,paths.dir,Math.min(campaign.limits.jobDurationMs,Math.max(1,deadline-Date.now())),Math.min(remainingOutput,diskRemaining),campaign.limits.memoryMb,options.signal);
        await recordStage(paths.dir,unit.id,'compile','complete');
        activeStage='validate';
        await recordStage(paths.dir,unit.id,'validate','started');
        await verifyCompleted(result,paths.output,plan);
        await recordStage(paths.dir,unit.id,'validate','complete');
        if(await dirBytes(paths.dir)+usageTotals(await usageEntries(paths.dir)).acquisitionDiskBytes>campaign.limits.diskBytes)throw new RangeError('campaign disk budget exceeded');
        if(!ledger.complete(claim.id,claim.token,Date.now(),{...result,plan,unitId:unit.id,inventoryUnitId:unit.inventoryUnitId,sourceHash:plan.source.sha256,regionId:plan.region.id,identityHash:identity.inputHash,acquisition}))throw new Error('campaign lease lost before completion');
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        const claimedUnit=(claim.payload as {unit?:CampaignUnit}|null)?.unit;
        if(claimedUnit&&claimedUnit.kind!=='protected')await recordStage(paths.dir,claimedUnit.id,activeStage,'exception');
        if(/corrupt campaign output/.test(message)){const relative=message.match(/corrupt campaign output (.+)$/)?.[1];if(relative){const file=path.resolve(paths.output,...relative.split('/')),rel=path.relative(paths.output,file);if(!rel.startsWith('..')&&!path.isAbsolute(rel)){await mkdir(paths.quarantine,{recursive:true});try{await rename(file,path.join(paths.quarantine,`${Date.now()}-${path.basename(file)}`));}catch{}}}}
        ledger.fail(claim.id,claim.token,Date.now(),message,0);failures.push(`${claim.id}: ${message}`);
      }finally{clearInterval(heartbeat);}
      processed++;
    }
    const jobs=ledger.list();if(!stopped&&jobs.some(j=>j.status==='queued'||j.status==='leased'))stopped='campaign work remains queued or leased';
    const counts=coverageCounts(campaign,jobs);
    if(!stopped&&counts.sourceUnits===0)throw new Error('campaign has no source-unit denominator; protected-only work is not world coverage');
    return{id:campaign.id,status:stopped?'stopped':counts.exception?'exception':'complete',counts,stages:await stageCounts(paths.dir),jobs,failures,stopped};
  }finally{ledger?.close();await releaseLock();}
}
export async function campaignStatus(id:string,options:Pick<CampaignOptions,'allowedRoot'>={}):Promise<CampaignReport>{
  if(!ID_RE.test(id))throw new TypeError('campaign id is invalid');const root=await validateCampaignRoot(path.resolve(options.allowedRoot??DEFAULT_ROOT));const p=campaignPaths(id,root);await ensureCanonicalDirectory(p.dir);await verifyRegularStateFile(p.config);await verifyRegularStateFile(p.ledger);const campaign=validateCampaign(JSON.parse(await readFile(p.config,'utf8')) as unknown),bindingPath=path.join(p.dir,'inventory-binding.json');await verifyRegularStateFile(bindingPath);let binding:{path:string;hash:string}|null=null;try{binding=JSON.parse(await readFile(bindingPath,'utf8')) as {path:string;hash:string};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(binding){const units=campaignInventoryUnits(campaign);await verifyInventorySnapshot(binding.path,campaign.inventoryHash,units.source,units.protected);}await usageEntries(p.dir);const ledger=new Ledger(p.ledger);
  try{const jobs=ledger.list(),counts=coverageCounts(campaign,jobs),done=counts.compiled+counts.exception+counts.protected;return{id,status:jobs.some(j=>j.status==='queued'||j.status==='leased')?'running':counts.exception?'exception':done===0?'stopped':'complete',counts,stages:await stageCounts(p.dir),jobs,failures:jobs.filter(j=>j.status==='failed').map(j=>`${j.id}: ${String(j.error)}`),stopped:null};}finally{ledger.close();}
}
