import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, lstat, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInventory } from './inventory.ts';
import { buildFineDirectoryCatalogue } from './fine-directory-catalogue.ts';
import { runFineSupervisor } from './fine-supervisor.ts';
import type { FinePromotionContext } from './fine-promotion-types.ts';
import type { FineSourcePin } from './fine-types.ts';
import type { SourceRecord } from './types.ts';
import type { FineCampaignPlan } from './fine-campaign-plan.ts';

const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const sha='e'.repeat(64),release='a'.repeat(40),spatial='e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';
async function fixture(options:{retryWaitMs?:number;maxCycles?:number;lifetimeDurationMs?:number}={}){
 const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'fine-supervisor-'))),repo=path.join(temp,'repo');await mkdir(path.join(repo,'world'),{recursive:true});
 const coarse={type:'FeatureCollection',features:[
  {type:'Feature',id:1,properties:{NE_ID:1,ADMIN:'Rwanda',CONTINENT:'Africa',ISO_A2_EH:'RW',ISO_A3_EH:'RWA',ADM0_A3:'RWA'},geometry:{type:'Polygon',coordinates:[[[28,-3],[31,-3],[31,-1],[28,-1],[28,-3]]]}},
  {type:'Feature',id:2,properties:{NE_ID:2,ADMIN:'Nigeria',CONTINENT:'Africa',ISO_A2_EH:'NG',ISO_A3_EH:'NGA',ADM0_A3:'NGA'},geometry:{type:'Polygon',coordinates:[[[3,4],[15,4],[15,14],[3,14],[3,4]]]}}
 ]};const coarseBytes=Buffer.from(JSON.stringify(coarse)),source:SourceRecord={id:'natural-earth-test',url:'https://example.invalid/ne.geojson',release,license:'Public Domain',attribution:'Natural Earth',sha256:hash(coarseBytes),bytes:coarseBytes.length},inventory=buildInventory(source,coarse);
 const metadata=Buffer.from(JSON.stringify([
  {boundaryID:'RWA-ADM1-001',boundaryISO:'RWA',boundaryName:'Rwanda',boundaryType:'ADM1',admUnitCount:'1',gjDownloadURL:`https://github.com/wmgeolab/geoBoundaries/raw/${release.slice(0,7)}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`,boundaryCanonical:'Province',boundaryYearRepresented:'2020',buildDate:'Dec 12, 2023',boundarySource:'Natural Earth',boundaryLicense:'Public Domain',licenseSource:'https://www.naturalearthdata.com/about/terms-of-use/'},
  {boundaryID:'NGA-ADM1-37',boundaryISO:'NGA',boundaryName:'Nigeria',boundaryType:'ADM1',admUnitCount:'37',gjDownloadURL:'https://example.invalid/ng',boundaryCanonical:'State',boundaryYearRepresented:'2020',buildDate:'Dec 12, 2023',boundarySource:'Legacy',boundaryLicense:'Other',licenseSource:'https://example.invalid'}
 ]));const metaPin={sourceUrl:'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/',sha256:hash(metadata),bytes:metadata.length,capturedAt:'2026-10-08T00:00:00Z'},parentHash='c'.repeat(64),catalogue=buildFineDirectoryCatalogue(metadata,metaPin,inventory,coarse,parentHash),catalogueBytes=Buffer.from(`${JSON.stringify(catalogue,null,2)}\n`),catalogueHash=hash(catalogueBytes),rw=catalogue.countries.find(row=>row.iso3==='RWA')!;
 const context:FinePromotionContext={catalogueBytes,catalogueHash,catalogue,metadataBytes:metadata,directory:{manifestHash:parentHash,manifest:{source},nodes:inventory.nodes} as unknown as FinePromotionContext['directory']};
 await writeFile(path.join(repo,'world/test-context.json'),JSON.stringify({catalogueBytes:catalogueBytes.toString('base64'),catalogueHash,catalogue,metadataBytes:metadata.toString('base64'),directory:context.directory}));
 const sourceBytes=Buffer.from('synthetic-geodata-body'),sourceHash=hash(sourceBytes),pin:FineSourcePin={schemaVersion:1,provider:'geoBoundaries',source:{id:'stable-gbopen-rwa-adm1',url:`https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`,release,license:'CC-BY-4.0',attribution:'geoBoundaries gbOpen; Natural Earth',sha256:sourceHash,bytes:sourceBytes.length},input:`.cache/world-build/fine-source-cache/${sourceHash}.geojson`,countryCode:'RW',countryIso3:'RWA',adminLevel:'ADM1',layerId:'RWA-ADM1-001',canonicalType:'Province',representedYear:'2020',buildDate:'Dec 12, 2023',expectedUnits:1,originalLicense:'Public Domain',licenseEvidence:['https://www.naturalearthdata.com/about/terms-of-use/'],metadataSha256:metaPin.sha256,metadataBytes:metadata.length,boundaryPolicy:'Follow the source depiction.'};
 const prepConfig={schemaVersion:1,catalogueHash,selections:[{countryId:rw!.countryId,countryIso3:'RWA',commit:release}]},prepBytes=Buffer.from(JSON.stringify(prepConfig)),seedConfig={schemaVersion:1,reviewed:[{pinFile:'world/seed-pin.json',topologyReportPath:`.cache/world-build/fine-topology/reports/${sha}/${sha}.json`}]},seedBytes=Buffer.from(JSON.stringify(seedConfig));
 await writeFile(path.join(repo,'world/prep.json'),prepBytes);await writeFile(path.join(repo,'world/seed.json'),seedBytes);await writeFile(path.join(repo,'world/seed-pin.json'),JSON.stringify(pin));
 const supervisorConfig={schemaVersion:1,purpose:'local-fine-preparation-and-compilation',preparationConfig:{path:'world/prep.json',sha256:hash(prepBytes)},seedCampaignConfig:{path:'world/seed.json',sha256:hash(seedBytes)},lifetimeDurationMs:options.lifetimeDurationMs??10000,maxCycles:options.maxCycles??3,stageDurationMs:100,preparationMaxJobs:1,compilationMaxJobs:2,retryWaitMs:options.retryWaitMs??0,cacheOnly:true};
 const supervisorBytes=Buffer.from(JSON.stringify(supervisorConfig));await writeFile(path.join(repo,'world/supervisor.json'),supervisorBytes);
 let prepareCalls=0,compileCalls=0;const hooks={loadContext:async()=>context,prepare:async()=>{prepareCalls++;return{schemaVersion:1 as const,purpose:'fine-source-preparation' as const,catalogueHash,prepared:[],pending:0,failed:[],attemptFailures:[],networkBytes:0,networkBytesMeasured:0,unknownNetworkTransfers:0,attempts:0};},compile:async({plan}:{plan:FineCampaignPlan})=>{compileCalls++;return{planHash:hash(JSON.stringify(plan)),reportHash:sha,reportPath:'test-report',total:plan.countryCount,ready:1,compiled:1,pending:0,exceptions:0,protected:1,networkBytes:0 as const,units:[]};}};
 return{temp,repo,context,pin,hooks,get prepareCalls(){return prepareCalls;},get compileCalls(){return compileCalls;},clean:()=>rm(temp,{recursive:true,force:true})};
}

test('supervisor terminal resume revalidates both stages as a new bounded cycle',async()=>{
 const f=await fixture();try{const first=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});assert.equal(first.status,'terminal');assert.equal(first.lifetimeCycles,1);assert.equal(first.preparedCountries.length,0);assert.equal(first.campaign?.compiled,1);assert.equal(first.scope,'frozen-administrative-inputs-only');
  const second=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});assert.equal(second.status,'terminal');assert.equal(second.lifetimeCycles,2);assert.equal(f.prepareCalls,2);assert.equal(f.compileCalls,2);
  await assert.rejects(runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:{...f.hooks,compile:async()=>{throw new Error('cached terminal assets are corrupt');}}}),/cached terminal assets are corrupt/);
 }finally{await f.clean();}
});

test('supervisor durably charges full reservation when a stage is interrupted, then resumes',async()=>{
 const f=await fixture();try{let fail=true;const hooks={...f.hooks,prepare:async()=>{if(fail){fail=false;throw new Error('synthetic crash');}return f.hooks.prepare();}};await assert.rejects(runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks}),/synthetic crash/);
  const resumed=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks});assert.equal(resumed.status,'terminal');assert.equal(resumed.lifetimeCycles,2);assert.ok(resumed.lifetimeChargedMs>=200);
 }finally{await f.clean();}
});

test('supervisor refuses changed referenced config hashes before dispatch',async()=>{
 const f=await fixture();try{await writeFile(path.join(f.repo,'world/prep.json'),'{}');await assert.rejects(runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks}),/referenced preparation\/seed config hash mismatch/);assert.equal(f.prepareCalls,0);assert.equal(f.compileCalls,0);}finally{await f.clean();}
});

test('supervisor refuses malformed saved state and symlink lock without touching targets',async()=>{
 const f=await fixture();try{const configBytes=await import('node:fs/promises').then(m=>m.readFile(path.join(f.repo,'world/supervisor.json'))),configHash=hash(configBytes),state=path.join(f.repo,'.cache/world-build/fine-supervisor',configHash),lock=path.join(f.repo,'.cache/world-build/fine-supervisor/lock');await mkdir(state,{recursive:true});const outside=path.join(f.temp,'outside');await mkdir(outside);await symlink(outside,lock);await assert.rejects(runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks}),/lock is unsafe|symlink refused/);assert.equal(await realpath(lock),await realpath(outside));await rm(lock);await writeFile(path.join(state,'state.json'),'truncated');await assert.rejects(runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks}));assert.equal(f.prepareCalls,0);}finally{await f.clean();}
});

test('budget exhaustion never replays stale terminal results as current verification',async()=>{
 const f=await fixture({maxCycles:1});try{const first=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});assert.equal(first.currentVerification,true);assert.ok(first.campaign);const denied=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});assert.equal(denied.status,'budget-exhausted');assert.equal(denied.currentVerification,false);assert.equal(denied.campaign,null);assert.deepEqual(denied.preparedCountries,[]);assert.equal(denied.preparationPending,0);assert.equal(f.prepareCalls,1);assert.equal(f.compileCalls,1);}finally{await f.clean();}
});

test('supervisor state quota aggregates separate frozen config identities',async()=>{
 const f=await fixture();try{const bytes=await readFile(path.join(f.repo,'world/supervisor.json')),identity=hash(bytes),stateRoot=path.join(f.repo,'.cache/world-build/fine-supervisor');await mkdir(path.join(stateRoot,'f'.repeat(64)),{recursive:true});await writeFile(path.join(stateRoot,'f'.repeat(64),'state.json'),Buffer.alloc(2*1024*1024+1));await assert.rejects(runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks}),/state exceeds 2 MiB/);assert.equal(await lstat(path.join(stateRoot,identity)).catch(()=>null),null,'quota refusal must precede hash-directory creation');assert.equal(f.prepareCalls,0);assert.equal(f.compileCalls,0);}finally{await f.clean();}
});

test('fully spent durable lifetime returns an unverified structured budget denial',async()=>{
 const f=await fixture({lifetimeDurationMs:10000});try{await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});const configHash=hash(await readFile(path.join(f.repo,'world/supervisor.json'))),stateFile=path.join(f.repo,'.cache/world-build/fine-supervisor',configHash,'state.json'),state=JSON.parse(await readFile(stateFile,'utf8')) as {chargedMs:number;cycles:Array<{chargedMs:number}>;lastReport:{lifetimeChargedMs:number}};state.chargedMs=10000;state.cycles[0]!.chargedMs=10000;state.lastReport.lifetimeChargedMs=10000;await writeFile(stateFile,JSON.stringify(state));const before=f.prepareCalls,denied=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});assert.equal(denied.status,'budget-exhausted');assert.equal(denied.currentVerification,false);assert.equal(denied.campaign,null);assert.deepEqual(denied.preparedCountries,[]);assert.equal(f.prepareCalls,before);}finally{await f.clean();}
});

test('supervisor persists retry-wait reservation and charges it in full after interruption',async()=>{
 const f=await fixture({retryWaitMs:100,maxCycles:2});try{const controller=new AbortController(),hooks={...f.hooks,prepare:async()=>({...await f.hooks.prepare(),pending:1}),compile:async(args:{plan:FineCampaignPlan})=>({...await f.hooks.compile(args),pending:1})};const running=runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',signal:controller.signal,hooks});
  const configHash=hash(await readFile(path.join(f.repo,'world/supervisor.json'))),stateFile=path.join(f.repo,'.cache/world-build/fine-supervisor',configHash,'state.json');let waiting=false;
  for(let i=0;i<2000&&!waiting;i++){try{const state=JSON.parse(await readFile(stateFile,'utf8')) as {cycles?:Array<{waitStatus?:string}>};waiting=state.cycles?.some(cycle=>cycle.waitStatus==='running')??false;}catch{}if(!waiting)await new Promise(resolve=>setTimeout(resolve,2));}
  assert.equal(waiting,true,'retry wait must be durably reserved before waiting');controller.abort(new Error('wait interruption'));await assert.rejects(running,/wait interruption/);
  const resumed=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks});assert.equal(resumed.lifetimeCycles,2);assert.equal(resumed.status,'budget-exhausted');assert.ok(resumed.lifetimeChargedMs>=100);const replay=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks});assert.equal(replay.currentVerification,false);
 }finally{await f.clean();}
});

test('a successfully completed retry wait is separately charged and resumable',async()=>{
 const f=await fixture({retryWaitMs:2,maxCycles:2});try{let preparation=0;const hooks={...f.hooks,prepare:async()=>{preparation++;return{...await f.hooks.prepare(),pending:preparation===1?1:0};},compile:async(args:{plan:FineCampaignPlan})=>({...await f.hooks.compile(args),pending:preparation===1?1:0})};const result=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks});assert.equal(result.status,'terminal');assert.equal(result.lifetimeCycles,2);const replay=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks});assert.equal(replay.status,'budget-exhausted');assert.equal(replay.currentVerification,false);assert.equal(replay.lifetimeChargedMs,result.lifetimeChargedMs); }finally{await f.clean();}
});

test('crash in a later cycle accepts the prior report only as history and charges recovery',async()=>{
 const f=await fixture();try{assert.equal((await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks})).currentVerification,true);let fail=true;const hooks={...f.hooks,prepare:async()=>{if(fail){fail=false;throw new Error('later cycle crash');}return f.hooks.prepare();}};await assert.rejects(runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks}),/later cycle crash/);const recovered=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});assert.equal(recovered.status,'terminal');assert.equal(recovered.currentVerification,true);assert.equal(recovered.lifetimeCycles,3);}finally{await f.clean();}
});

test('tampered duplicate cycle UUID and zero reservation are rejected before dispatch',async()=>{
 for(const tamper of ['duplicate','zero'] as const){const f=await fixture();try{await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});const configHash=hash(await readFile(path.join(f.repo,'world/supervisor.json'))),stateFile=path.join(f.repo,'.cache/world-build/fine-supervisor',configHash,'state.json'),state=JSON.parse(await readFile(stateFile,'utf8')) as {cycles:Array<{id:string;reservedMs:number}>};state.cycles.push({...state.cycles[0]!});if(tamper==='duplicate')state.cycles[1]!.id=state.cycles[0]!.id;else state.cycles[1]!.reservedMs=0;await writeFile(stateFile,JSON.stringify(state));const before=f.prepareCalls;await assert.rejects(runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks}),/reservation is malformed/);assert.equal(f.prepareCalls,before);}finally{await f.clean();}}
});

test('SIGKILL after durable reservation is recovered with full charge and closed lock',async()=>{
 const f=await fixture();let child:ChildProcess|undefined;try{
  const moduleUrl=new URL('./fine-supervisor.ts',import.meta.url).href,contextPath=path.join(f.repo,'world/test-context.json');const script=`import {readFile} from 'node:fs/promises';import {runFineSupervisor} from ${JSON.stringify(moduleUrl)};const s=JSON.parse(await readFile(${JSON.stringify(contextPath)},'utf8'));const context={...s,catalogueBytes:Buffer.from(s.catalogueBytes,'base64'),metadataBytes:Buffer.from(s.metadataBytes,'base64')};runFineSupervisor({repositoryRoot:${JSON.stringify(f.repo)},configPath:'world/supervisor.json',hooks:{loadContext:async()=>context,prepare:async()=>{process.stdout.write('RESERVED\\n');await new Promise(()=>{});throw new Error('unreachable');}}}).catch(()=>{process.exitCode=1;});`;
  child=spawn(process.execPath,['--experimental-strip-types','-e',script],{cwd:f.repo,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr?.on('data',chunk=>{stderr+=String(chunk).slice(0,2048);});const ready=new Promise<void>((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(new Error(`child did not reach durable reservation: ${stderr}`)),5000);child!.stdout?.on('data',chunk=>{output+=String(chunk);if(output.includes('RESERVED\n')){clearTimeout(timeout);resolve();}});child!.once('error',error=>{clearTimeout(timeout);reject(error);});child!.once('exit',(code,signal)=>{clearTimeout(timeout);reject(new Error(`child exited before reservation (${code}/${signal}): ${stderr}`));});});await ready;
  const configHash=hash(await readFile(path.join(f.repo,'world/supervisor.json'))),stateFile=path.join(f.repo,'.cache/world-build/fine-supervisor',configHash,'state.json'),state=JSON.parse(await readFile(stateFile,'utf8')) as {cycles:Array<{status:string;chargedMs:number;reservedMs:number}>};assert.equal(state.cycles[0]?.status,'running');assert.equal(state.cycles[0]?.chargedMs,0);child.kill('SIGKILL');await new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child=undefined;
  const resumed=await runFineSupervisor({repositoryRoot:f.repo,configPath:'world/supervisor.json',hooks:f.hooks});assert.equal(resumed.status,'terminal');assert.equal(resumed.currentVerification,true);assert.equal(resumed.lifetimeCycles,2);assert.ok(resumed.lifetimeChargedMs>=200);assert.equal(resumed.unobservedCycles,1);assert.equal(f.prepareCalls,1);
 }finally{if(child&&child.exitCode===null){child.kill('SIGKILL');await new Promise<void>(resolve=>child!.once('exit',()=>resolve()));}await f.clean();}
});
