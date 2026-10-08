import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInventory } from './inventory.ts';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { buildFineDirectoryCatalogue } from './fine-directory-catalogue.ts';
import { buildFineCampaignPlan } from './fine-campaign-plan.ts';
import { acquireFineSource } from './fine-acquire.ts';
import { runFineCampaign } from './fine-campaign-run.ts';
import { FINE_PLANAR_EXCEPTION } from './fine-quality.ts';
import type { FineSourcePin, FineTopologyReport } from './fine-types.ts';
import type { SourceRecord } from './types.ts';

const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const canon=(v:unknown):string=>v===null||typeof v==='string'||typeof v==='boolean'?JSON.stringify(v):typeof v==='number'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canon).join(',')}]`:`{${Object.keys(v as Record<string,unknown>).sort().map(k=>`${JSON.stringify(k)}:${canon((v as Record<string,unknown>)[k])}`).join(',')}}`;
const release='a'.repeat(40), spatial='e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';
function setupData(complex=false){
  const sourceGeo={type:'FeatureCollection',features:[
    {type:'Feature',properties:{NE_ID:1,ADMIN:'Rwanda',CONTINENT:'Africa',ISO_A2_EH:'RW',ISO_A3_EH:'RWA'},geometry:{type:'Polygon',coordinates:[[[28,-3],[31,-3],[31,-1],[28,-1],[28,-3]]]}},
    {type:'Feature',properties:{NE_ID:2,ADMIN:'Nigeria',CONTINENT:'Africa',ISO_A2_EH:'NG',ISO_A3_EH:'NGA'},geometry:{type:'Polygon',coordinates:[[[3,4],[15,4],[15,14],[3,14],[3,4]]]}}]};
  const raw=Buffer.from(JSON.stringify(sourceGeo));
  const coarseSource:SourceRecord={id:'natural-earth-admin0-test',url:'https://example.invalid/ne.geojson',release,license:'Public domain',attribution:'Synthetic test fixture',sha256:hash(raw),bytes:raw.length};
  const inventory=buildInventory(coarseSource,sourceGeo);
  const ring:number[][]=[];const positionCount=complex?18_000:5;
  if(complex){for(let i=0;i<positionCount-1;i++){const angle=2*Math.PI*i/(positionCount-1);ring.push([29.5+0.4*Math.cos(angle),-1.5+0.4*Math.sin(angle)]);}ring.push([...ring[0]!]);}
  else ring.push([29,-2],[30,-2],[30,-1],[29,-1],[29,-2]);
  const pinGeo=Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{shapeID:'RWA-ADM1-001',shapeName:'Test Province',shapeGroup:'RWA',shapeType:'ADM1'},geometry:{type:'Polygon',coordinates:[ring]}}]}));
  const sourceHash=hash(pinGeo), licenseUrl='https://creativecommons.org/licenses/by/4.0/';
  const pin:FineSourcePin={schemaVersion:1,provider:'geoBoundaries',source:{id:'stable-gbopen-rwa-adm1',url:`https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`,release,license:'CC-BY-4.0',attribution:'geoBoundaries gbOpen; Rwanda Geo Portal',sha256:sourceHash,bytes:pinGeo.length},input:`.cache/world-build/fine-source-cache/${sourceHash}.geojson`,countryCode:'RW',countryIso3:'RWA',adminLevel:'ADM1',layerId:'RWA-ADM1-1',canonicalType:'Province',representedYear:'2020',buildDate:'Dec 12, 2023',expectedUnits:1,originalLicense:'Creative Commons Attribution 4.0',licenseEvidence:[licenseUrl],metadataSha256:'b'.repeat(64),metadataBytes:128,boundaryPolicy:'Follow source boundary depiction policy.'};
  const metadata=Buffer.from(JSON.stringify([
    {boundaryID:'RWA-ADM1-1',boundaryISO:'RWA',boundaryName:'Rwanda',boundaryType:'ADM1',admUnitCount:'1',gjDownloadURL:`https://github.com/wmgeolab/geoBoundaries/raw/${release.slice(0,7)}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`,boundaryCanonical:'Province',boundaryYearRepresented:'2020',buildDate:'Dec 12, 2023',boundarySource:'Rwanda Geo Portal',boundaryLicense:'Creative Commons Attribution 4.0',licenseSource:licenseUrl},
    {boundaryID:'NGA-ADM1-1',boundaryISO:'NGA',boundaryName:'Nigeria',boundaryType:'ADM1',admUnitCount:'37',gjDownloadURL:`https://github.com/wmgeolab/geoBoundaries/raw/${release.slice(0,7)}/releaseData/gbOpen/NGA/ADM1/geoBoundaries-NGA-ADM1.geojson`,boundaryCanonical:'State',boundaryYearRepresented:'2020',buildDate:'Dec 12, 2023',boundarySource:'Nigeria source',boundaryLicense:'CC BY 4.0',licenseSource:licenseUrl},
  ]));
  return {sourceGeo,raw,coarseSource,inventory,pinGeo,pin,metadata,licenseUrl};
}
async function fixture(run:(ctx:{repo:string;plan:ReturnType<typeof buildFineCampaignPlan>;reportPath:string;pin:FineSourcePin;finePath:string;topologyPath:string;parentHash:string})=>Promise<void>,complex=false){
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'fine-campaign-'))), repo=path.join(root,'repo');await mkdir(repo);
  const data=setupData(complex);
  try{
    const build=path.join(repo,'.cache/world-build');await mkdir(build,{recursive:true});
    const base=path.join(build,'output/country-inventory');
    const directory=compileCountryDirectory(data.coarseSource,data.raw,data.coarseSource,data.raw,'c'.repeat(64));
    const published=await publishCountryDirectory(directory,base,build),parentHash=published.manifestHash;
    const metadataHash=hash(data.metadata),metadataPin={sourceUrl:'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/',sha256:metadataHash,bytes:data.metadata.length,capturedAt:'2026-10-08T00:00:00Z'};
    const report=buildFineDirectoryCatalogue(data.metadata,metadataPin,data.inventory,data.sourceGeo,parentHash);
    const reportBytes=Buffer.from(`${JSON.stringify(report,null,2)}\n`),catalogueHash=hash(reportBytes);
    const reportPath=path.join(build,'fine-directory-catalogue/reports',`${catalogueHash}.json`);await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,reportBytes);
    const key='RWA-ADM1-001',keys=[key];
    const requestHash=hash(canon({validator:'duckdb-spatial-ogc-planar-v1',sourceSha256:data.pin.source.sha256,sourceBytes:data.pin.source.bytes,expectedUnits:1,expectedKeys:keys,spatialSha256:spatial}));
    const topology:FineTopologyReport={schemaVersion:1,validator:'duckdb-spatial-ogc-planar-v1',sourceSha256:data.pin.source.sha256,sourceBytes:data.pin.source.bytes,expectedUnits:1,checkedUnits:1,validUnits:1,invalidUnits:0,unsupportedUnits:0,tooling:{duckdbVersion:'1.5.6',spatialVersion:'04270fe',spatialSha256:spatial},rows:[{featureKey:key,status:'valid',valid:true,empty:false,reason:null}],exceptions:[FINE_PLANAR_EXCEPTION]};
    const topologyBytes=Buffer.from(`${canon(topology)}\n`),topologyHash=hash(topologyBytes),topologyPath=path.join(build,'fine-topology/reports',requestHash,`${topologyHash}.json`);await mkdir(path.dirname(topologyPath),{recursive:true});await writeFile(topologyPath,topologyBytes);
    const reviewed=[{pin:data.pin,topologyReportPath:path.relative(repo,topologyPath).split(path.sep).join('/')}];
    const plan=buildFineCampaignPlan(report,catalogueHash,reviewed);
    // Test setup primes the private content-addressed cache with synthetic bytes. The campaign itself is cache-only.
    const cached=await acquireFineSource(data.pin,{repositoryRoot:repo,fetcher:async()=>new Response(data.pinGeo,{status:200,headers:{'content-type':'application/json','content-length':String(data.pinGeo.length)}})});
    assert.equal(cached.cacheHit,false);
    const finePath=path.join(build,'output/fine/rw/adm1');
    await run({repo,plan,reportPath,pin:data.pin,finePath,topologyPath,parentHash});
  }finally{await rm(root,{recursive:true,force:true});}
}

test('cache-only campaign compiles once, durably resumes, and re-verifies every completed asset',async()=>fixture(async ctx=>{
  const first=await runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath,maxJobs:2});
  assert.equal(first.networkBytes,0);assert.equal(first.compiled,1,JSON.stringify(first));assert.equal(first.pending,0);assert.equal(first.protected,1);assert.equal(first.exceptions,0);
  const second=await runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath,maxJobs:1});
  assert.equal(second.compiled,1);assert.equal(second.units.find(u=>u.status==='compiled')?.manifestHash,first.units.find(u=>u.status==='compiled')?.manifestHash);
  const rwDir=ctx.finePath, outlines=await readdir(path.join(rwDir,'outlines'));assert.equal(outlines.length,1);
  await writeFile(path.join(rwDir,'outlines',outlines[0]!),'{"corrupt":true}');
  await assert.rejects(runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath,maxJobs:1}),/failed verification; ledger remains completed/);
}));

test('campaign report hash mismatch is rejected before campaign state or fine output is created',async()=>fixture(async ctx=>{
  const tampered=Buffer.from(await readFile(ctx.reportPath)),byteIndex=tampered.length-3;tampered.writeUInt8(tampered.readUInt8(byteIndex)^1,byteIndex);await writeFile(ctx.reportPath,tampered);
  await assert.rejects(runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath}),/do not match the plan hash/);
  await assert.rejects(readdir(path.join(ctx.repo,'.cache/world-build/fine-campaigns')));
  await assert.rejects(readdir(ctx.finePath));
}));

test('campaign state headroom is preflighted before ledger or plan creation',async()=>fixture(async ctx=>{
  const planHash=hash(canon(ctx.plan)),state=path.join(ctx.repo,'.cache/world-build/fine-campaigns',planHash);
  await mkdir(state,{recursive:true});await writeFile(path.join(state,'prior-audit.json'),Buffer.alloc(1_400_000,0x61));
  await assert.rejects(runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath}),/cannot fit the bounded 2 MiB/);
  await assert.rejects(lstat(path.join(state,'plan.json')),{code:'ENOENT'});
  await assert.rejects(lstat(path.join(state,'jobs.sqlite')),{code:'ENOENT'});
  await assert.rejects(lstat(path.join(state,'.campaign-lock')),{code:'ENOENT'});
}));

test('campaign lock rejects symlink lock roots without following or removing the target',async()=>fixture(async ctx=>{
  const planHash=hash(canon(ctx.plan)),state=path.join(ctx.repo,'.cache/world-build/fine-campaigns',planHash),lock=path.join(state,'.campaign-lock');
  await mkdir(state,{recursive:true});const outside=path.join(path.dirname(ctx.repo),'outside-lock-target');await mkdir(outside);await symlink(outside,lock);
  await assert.rejects(runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath}),/lock path is a symlink/);
  assert.equal((await lstat(outside)).isDirectory(),true);assert.equal((await lstat(lock)).isSymbolicLink(),true);
}));

test('failed job remains durable and dedicated campaign lock is released for a later resume',async()=>fixture(async ctx=>{
  // Corrupt topology after planning. It is rejected by fine-run before publication and costs at most two durable attempts.
  await writeFile(ctx.topologyPath,'{}');
  const first=await runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath,maxJobs:1});
  assert.equal(first.pending,1);assert.equal(first.compiled,0);
  const second=await runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath,maxJobs:1});
  assert.equal(second.exceptions,1);assert.equal(second.pending,0);
  const lock=path.join(ctx.repo,'.cache/world-build/fine-campaigns',first.planHash,'.campaign-lock');
  await assert.rejects(lstat(lock),{code:'ENOENT'});
}));

test('cancellation after worker admission waits for closure, releases campaign lock, and resumes safely',async()=>fixture(async ctx=>{
  const controller=new AbortController(),build=runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath,maxJobs:1,signal:controller.signal});
  const attemptsDir=path.join(ctx.repo,'.cache/world-build/fine-attempts');let admitted=false;
  for(let i=0;i<2_000&&!admitted;i++){
    try{for(const file of await readdir(attemptsDir)){const record=JSON.parse(await readFile(path.join(attemptsDir,file),'utf8')) as {status?:string};if(record.status==='running'){admitted=true;break;}}}catch{}
    if(!admitted)await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(admitted,true,'fine worker must be observably admitted before cancellation');controller.abort(new Error('synthetic cancellation test'));
  await assert.rejects(build,/synthetic cancellation test/);
  const planHash=hash(canon(ctx.plan)),lock=path.join(ctx.repo,'.cache/world-build/fine-campaigns',planHash,'.campaign-lock');
  await assert.rejects(lstat(lock),{code:'ENOENT'});
  const resumed=await runFineCampaign({repositoryRoot:ctx.repo,plan:ctx.plan,catalogueReportPath:ctx.reportPath,maxJobs:2});
  assert.equal(resumed.compiled,1);assert.equal(resumed.networkBytes,0);
},true));
