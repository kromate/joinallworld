import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, lstat, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFinePreparation } from './fine-prepare-run.ts';
import { buildInventory } from './inventory.ts';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { buildFineDirectoryCatalogue } from './fine-directory-catalogue.ts';
import { FINE_PLANAR_EXCEPTION } from './fine-quality.ts';
import { canonicalJson } from './pack.ts';
import { Ledger } from './ledger.ts';
import { DatabaseSync } from 'node:sqlite';
import type { FinePromotionContext } from './fine-promotion-types.ts';
import type { FineTopologyReport, FineSourcePin } from './fine-types.ts';
import type { SourceRecord } from './types.ts';

const hash=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
const spatial='e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';
async function setup(sourceCount=1){
 const tmp=await realpath(await mkdtemp(path.join(os.tmpdir(),'fine-prepare-'))),repo=path.join(tmp,'repo');await mkdir(repo);
 const features=[['Rwanda','RW','RWA',1,[[28,-3],[31,-3],[31,-1],[28,-1],[28,-3]]],['Nigeria','NG','NGA',2,[[3,4],[15,4],[15,14],[3,14],[3,4]]]] as const;
 const coarse={type:'FeatureCollection',features:features.map(([name,iso2,iso3,id,ring])=>({type:'Feature',id,properties:{NE_ID:id,ADMIN:name,CONTINENT:'Africa',ISO_A2_EH:iso2,ISO_A3_EH:iso3,ADM0_A3:iso3},geometry:{type:'Polygon',coordinates:[ring]}}))};
 const coarseRaw=Buffer.from(JSON.stringify(coarse)),source:SourceRecord={id:'natural-earth-admin0-test',url:'https://example.invalid/ne.geojson',release:'a'.repeat(40),license:'Public Domain',attribution:'test',sha256:hash(coarseRaw),bytes:coarseRaw.length};
 const inventory=buildInventory(source,coarse);const build=path.join(repo,'.cache/world-build');await mkdir(build,{recursive:true});
 const compiled=compileCountryDirectory(source,coarseRaw,source,coarseRaw,'c'.repeat(64));const published=await publishCountryDirectory(compiled,path.join(build,'output/country-inventory'),build);
 const commit='b'.repeat(40),short=commit.slice(0,7),metadata=Buffer.from(JSON.stringify([
  {boundaryID:'RWA-ADM1-1',boundaryISO:'RWA',boundaryName:'Rwanda',boundaryType:'ADM1',admUnitCount:'1',gjDownloadURL:`https://github.com/wmgeolab/geoBoundaries/raw/${short}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`,boundaryCanonical:'Province',boundaryYearRepresented:'2020',buildDate:'Dec 12, 2023',boundarySource:'Natural Earth',boundaryLicense:'Public Domain',licenseSource:'https://www.naturalearthdata.com/about/terms-of-use/'},
  {boundaryID:'NGA-ADM1-1',boundaryISO:'NGA',boundaryName:'Nigeria',boundaryType:'ADM1',admUnitCount:'37',gjDownloadURL:'https://example.invalid/ng',boundaryCanonical:'State',boundaryYearRepresented:'2020',buildDate:'Dec 12, 2023',boundarySource:'legacy',boundaryLicense:'other',licenseSource:'https://example.invalid'}
 ]));
 const metaPin={sourceUrl:'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/',sha256:hash(metadata),bytes:metadata.length,capturedAt:'2026-10-08T00:00:00Z'};
 const catalogue=buildFineDirectoryCatalogue(metadata,metaPin,inventory,coarse,published.manifestHash),catalogueBytes=Buffer.from(`${JSON.stringify(catalogue,null,2)}\n`),catalogueHash=hash(catalogueBytes),rw=catalogue.countries.find(x=>x.iso3==='RWA')!;
 const directory={manifestHash:published.manifestHash,manifest:{source},nodes:inventory.nodes} as unknown as FinePromotionContext['directory'];
 const context:FinePromotionContext={catalogueBytes,catalogueHash,catalogue,metadataBytes:metadata,directory};
 const configPath='world/fine-preparation-test.json';await mkdir(path.join(repo,'world'));await writeFile(path.join(repo,configPath),JSON.stringify({schemaVersion:1,catalogueHash,selections:[{countryId:rw.countryId,countryIso3:'RWA',commit}]}));
 const sourceGeo=Buffer.from(JSON.stringify({type:'FeatureCollection',features:Array.from({length:sourceCount},(_,index)=>({type:'Feature',properties:{shapeID:`RWA-ADM1-${index+1}`,shapeName:'Test Province',shapeGroup:'RWA',shapeType:'ADM1'},geometry:{type:'Polygon',coordinates:[[[29,-2],[30,-2],[30,-1],[29,-1],[29,-2]]]}}))}));
 const pointer=Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${hash(sourceGeo)}\nsize ${sourceGeo.length}\n`);let topologyCalls=0,sourceCalls=0,pointerCalls=0;
 const hooks={loadContext:async()=>context,publish:async()=>({requestHash:'x',pinHash:'x',pinPath:'x',reportPath:'x'}),acquirePointer:async(request:import('./fine-promotion-types.ts').FinePromotionRequest,options:{cacheOnly?:boolean})=>{pointerCalls++;return{requestHash:hash(canonicalJson(request)),pointerPath:'',receiptPath:'',pointerBytes:pointer,pointer:{sha256:hash(sourceGeo),bytes:sourceGeo.length},networkBytes:options.cacheOnly?0:123,cacheHit:options.cacheOnly===true};},acquireSource:async(pin:FineSourcePin,options:{cacheOnly?:boolean})=>{sourceCalls++;const input=path.join(repo,pin.input);await mkdir(path.dirname(input),{recursive:true});try{await lstat(input);}catch{await writeFile(input,sourceGeo);}return{inputPath:input,receiptPath:'',networkBytes:options.cacheOnly?0:sourceGeo.length,cacheHit:options.cacheOnly===true,sourceBytes:pin.source.bytes};},topology:async({pin}:{pin:FineSourcePin})=>{topologyCalls++;const report:FineTopologyReport={schemaVersion:1,validator:'duckdb-spatial-ogc-planar-v1',sourceSha256:pin.source.sha256,sourceBytes:pin.source.bytes,expectedUnits:1,checkedUnits:1,validUnits:1,invalidUnits:0,unsupportedUnits:0,tooling:{duckdbVersion:'1.5.6',spatialVersion:'04270fe',spatialSha256:spatial},rows:[{featureKey:'RWA-ADM1-1',status:'valid',valid:true,empty:false,reason:null}],exceptions:[FINE_PLANAR_EXCEPTION]};const requestHash=hash(canonicalJson({validator:'duckdb-spatial-ogc-planar-v1',sourceSha256:pin.source.sha256,sourceBytes:pin.source.bytes,expectedUnits:1,expectedKeys:['RWA-ADM1-1'],spatialSha256:spatial})),bytes=Buffer.from(`${canonicalJson(report)}\n`),reportHash=hash(bytes),reportPath=path.join(build,'fine-topology/reports',requestHash,`${reportHash}.json`);await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,bytes);return{requestHash,reportHash,reportPath,report,elapsedMs:1,networkBytes:0 as const,peakRssBytes:null,rssSamples:0};}};
 return{tmp,repo,configPath,hooks,get topologyCalls(){return topologyCalls;},get sourceCalls(){return sourceCalls;},get pointerCalls(){return pointerCalls;},sourceGeo,clean:()=>rm(tmp,{recursive:true,force:true})};
}

test('preparation runner rejects invalid duration/job bounds before reading config or writing state',async()=>{
  const root='/tmp/fine-preparation-test';
  await assert.rejects(runFinePreparation({repositoryRoot:root,configPath:'world/fine-sources.json',durationMs:120_001}),/duration/);
  await assert.rejects(runFinePreparation({repositoryRoot:root,configPath:'world/fine-sources.json',maxJobs:17}),/maxJobs/);
  await assert.rejects(runFinePreparation({repositoryRoot:root,configPath:'world/fine-sources.json',maxJobs:0}),/maxJobs/);
  await assert.rejects(runFinePreparation({repositoryRoot:'/tmp/../tmp/fine-preparation-test',configPath:'world/fine-sources.json'}),/canonical/);
});

test('preparation runner requires an explicit relative config name and canonical repository root',async()=>{
  const root='/tmp/fine-preparation-test';
  await assert.rejects(runFinePreparation({repositoryRoot:root,configPath:'/tmp/sources.json'}));
  await assert.rejects(runFinePreparation({repositoryRoot:root,configPath:'../sources.json'}));
});

test('preparation durably resumes completed pin and topology evidence without a second topology run',async()=>{
 const f=await setup();try{
  const first=await runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:f.hooks,maxJobs:1});assert.equal(first.networkBytes,123+f.sourceGeo.length);assert.equal(first.prepared.length,1,JSON.stringify(first));assert.equal(first.pending,0,JSON.stringify(first));assert.equal(first.attempts,1,JSON.stringify(first));assert.equal(f.topologyCalls,1);
  const second=await runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:f.hooks,maxJobs:1});assert.equal(second.networkBytes,0);assert.equal(second.prepared.length,1);assert.equal(second.attempts,1);assert.equal(f.topologyCalls,1);assert.equal(f.sourceCalls,2);assert.equal(f.pointerCalls,2);
  const sourcePath=path.join(f.repo,second.prepared[0]!.pin.input);await writeFile(sourcePath,'corrupt');await assert.rejects(runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:f.hooks,maxJobs:1}),/acquired fine source differs/);await writeFile(sourcePath,f.sourceGeo);
  const report=path.join(f.repo,second.prepared[0]!.topologyReportPath);await writeFile(report,'{}');await assert.rejects(runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:f.hooks,maxJobs:1}),/completed topology report path\/hash\/request binding/);
  await assert.rejects(runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:{...f.hooks,topology:async()=>{throw new Error('must not rerun');}},maxJobs:1}),/completed topology report path\/hash\/request binding/);
 }finally{await f.clean();}
});

test('dedicated preparation lock refuses symlink locks and leaves target untouched',async()=>{
 const f=await setup();try{const state=path.join(f.repo,'.cache/world-build/fine-preparation');await mkdir(state,{recursive:true});const outside=path.join(f.tmp,'outside');await mkdir(outside);await symlink(outside,path.join(state,'lock'));
  await assert.rejects(runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:f.hooks}),/lock/);
  assert.equal((await realpath(path.join(state,'lock'))),await realpath(outside));
 }finally{await f.clean();}
});

test('abort after topology admission retains the durable attempt and releases the dedicated lock',async()=>{
 const f=await setup();try{let signalStarted!:()=>void;const started=new Promise<void>(resolve=>{signalStarted=resolve;}),controller=new AbortController();
  const hooks={...f.hooks,topology:async({signal}:{signal?:AbortSignal})=>{signalStarted();await new Promise<never>((_resolve,reject)=>{if(signal?.aborted)reject(signal.reason);else signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});throw new Error('unreachable');}};
  const run=runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks,maxJobs:1,signal:controller.signal});await started;controller.abort(new Error('test interruption'));await assert.rejects(run,/test interruption/);
  const state=path.join(f.repo,'.cache/world-build/fine-preparation'),lock=path.join(state,'lock');await assert.rejects(lstat(lock),{code:'ENOENT'});
  const db=new Ledger(path.join(state,'jobs.sqlite'),{databaseBytes:512*1024});try{const rows=db.list();assert.equal(rows.length,1);assert.equal(rows[0]?.attempt,1);assert.equal(rows[0]?.status,'queued');}finally{db.close();}
 }finally{await f.clean();}
});

test('failed preparation remains pending once and becomes terminal after its second lifetime attempt',async()=>{
 const f=await setup();try{const failing={...f.hooks,topology:async()=>{throw new Error('synthetic topology failure');}};
  const first=await runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:failing,maxJobs:1});assert.equal(first.pending,1);assert.equal(first.failed.length,0);assert.equal(first.attemptFailures.length,1);assert.equal(first.attempts,1);
  const db=new DatabaseSync(path.join(f.repo,'.cache/world-build/fine-preparation/jobs.sqlite'));try{db.prepare("UPDATE jobs SET available_at=0 WHERE kind='fine-source-preparation'").run();}finally{db.close();}
  const second=await runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:failing,maxJobs:1});assert.equal(second.pending,0);assert.equal(second.failed.length,1);assert.equal(second.attempts,2);
 }finally{await f.clean();}
});

test('preexisting unselected ledger work is rejected before it is claimed or changed',async()=>{
 const f=await setup();try{const state=path.join(f.repo,'.cache/world-build/fine-preparation');await mkdir(state,{recursive:true});const db=new Ledger(path.join(state,'jobs.sqlite'),{databaseBytes:512*1024});db.enqueue({id:'fine-prep:unselected',kind:'fine-source-preparation',inputHash:'f'.repeat(64),payload:{foreign:true},maxAttempts:2});db.close();
  await assert.rejects(runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:f.hooks,maxJobs:1}),/unselected jobs/);
  const verify=new Ledger(path.join(state,'jobs.sqlite'),{databaseBytes:512*1024});try{const row=verify.list()[0];assert.equal(row?.attempt,0);assert.equal(row?.status,'queued');assert.equal(verify.list().length,1);}finally{verify.close();}
 }finally{await f.clean();}
});

test('hash-verified source feature-count mismatch fails permanently after one attempt and is not reacquired on resume',async()=>{
 const f=await setup(2);try{
  const first=await runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:f.hooks,maxJobs:1});assert.equal(first.prepared.length,0);assert.equal(first.pending,0);assert.equal(first.failed.length,1);assert.match(first.failed[0]!.reason,/expected 1, actual 2/);assert.match(first.failed[0]!.reason,/source [a-f0-9]{64}/);assert.equal(first.attempts,1);assert.equal(f.pointerCalls,1);assert.equal(f.sourceCalls,1);assert.equal(f.topologyCalls,0);
  const second=await runFinePreparation({repositoryRoot:f.repo,configPath:f.configPath,hooks:f.hooks,maxJobs:1});assert.equal(second.failed.length,1);assert.equal(second.pending,0);assert.equal(second.attempts,1);assert.equal(f.pointerCalls,1);assert.equal(f.sourceCalls,1);assert.equal(f.topologyCalls,0);
 }finally{await f.clean();}
});
