import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnvironmentManifest, ENVIRONMENT_LIMITS, fetchPilotBatch, fetchPowerMonthly, loadCachedRaw, powerMonthlyUrl, publishEnvironment, validateEnvironmentManifest, validateEnvironmentRequest } from './environment.ts';
import type { EnvironmentRequest } from './environment-types.ts';

const fixturePath=fileURLToPath(new URL('./environment-fixtures/accra-power-monthly-1991-2020.json',import.meta.url));
const rawBytes=new Uint8Array(await readFile(fixturePath));
const raw=JSON.parse(new TextDecoder().decode(rawBytes)) as Record<string,unknown>;
const request:EnvironmentRequest={schemaVersion:1,id:'accra',regionId:'pilot:accra',name:'Accra',longitude:-0.2,latitude:5.55,baseline:{startYear:1991,endYear:2020}};
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function tempRoot(){const temp=await mkdtemp(path.join(os.tmpdir(),'environment-test-'));const canonical=await realpath(temp),allowed=path.join(canonical,'world-build');await mkdir(allowed);return {temp:canonical,allowed};}
function rawCopy(){return structuredClone(raw) as Record<string,unknown>;}

test('pins a single monthly point query to four MERRA-2 parameters and the requested 30-year period',()=>{
 const url=new URL(powerMonthlyUrl(request));assert.equal(url.origin,'https://power.larc.nasa.gov');assert.equal(url.pathname,'/api/temporal/monthly/point');assert.equal(url.searchParams.get('parameters'),'T2M,RH2M,PRECTOTCORR,WS10M');assert.equal(url.searchParams.get('community'),'SB');assert.equal(url.searchParams.get('longitude'),'-0.2');assert.equal(url.searchParams.get('latitude'),'5.55');assert.equal(url.searchParams.get('start'),'1991');assert.equal(url.searchParams.get('end'),'2020');
 assert.throws(()=>validateEnvironmentRequest({...request,baseline:{startYear:1981,endYear:2020}}),/pinned 1991/);
 assert.throws(()=>validateEnvironmentRequest({...request,extra:true}),/unknown request field/);
});

test('derives 12 monthly normals from 360 monthly records, excludes annual month 13, and converts daily precipitation rates by actual days',()=>{
 const manifest=buildEnvironmentManifest(request,rawBytes);
 assert.equal(manifest.profile.months.length,12);assert.equal(manifest.profile.period,'1991–2020 monthly normals');assert.equal(manifest.baseline.years,30);
 assert.equal(manifest.source.monthlyRecordCount,360);assert.equal(manifest.source.annualRecordCount,30);assert.equal(manifest.source.timeStandard,'LST');assert.deepEqual(manifest.source.units,{T2M:'C',RH2M:'%',PRECTOTCORR:'mm/day',WS10M:'m/s'});
 assert.equal(manifest.source.spatialResolution.latitudeDegrees,0.5);assert.equal(manifest.source.spatialResolution.longitudeDegrees,0.625);
 const parameters=(raw.properties as Record<string,unknown>).parameter as Record<string,Record<string,number>>;
 const januaryTemp=Array.from({length:30},(_,i)=>parameters.T2M![`${1991+i}01`]!);const januaryRain=Array.from({length:30},(_,i)=>parameters.PRECTOTCORR![`${1991+i}01`]!*31);
 assert.ok(Math.abs(manifest.profile.months[0]!.temperatureC-januaryTemp.reduce((a,b)=>a+b,0)/30)<1e-10);
 assert.ok(Math.abs(manifest.profile.months[0]!.precipitationMm-januaryRain.reduce((a,b)=>a+b,0)/30)<1e-10);
 assert.equal(manifest.profile.months[0]!.temperatureC,27.216000000000008);
 assert.equal(manifest.profile.months[0]!.precipitationMm,21.111);
 assert.deepEqual(manifest.point,{longitude:-0.2,latitude:5.55,requestedLongitude:-0.2,requestedLatitude:5.55,semantics:'representative-point-selected-on-native-source-grid'});
 assert.match(manifest.derivation.humidity,/direct provider RH2M/);assert.match(manifest.derivation.wind,/scalar WS10M/);assert.match(manifest.derivation.precipitation,/actual calendar days/);
 assert.equal(manifest.profile.sourceId,manifest.source.id);assert.equal(manifest.source.sha256,digest(rawBytes));
});

test('rejects fill values, missing months, changed units, non-MERRA sources, and invalid derived manifests',()=>{
 const fill=rawCopy();((fill.properties as Record<string,unknown>).parameter as Record<string,Record<string,number>>).T2M!['199101']=-999;assert.throws(()=>buildEnvironmentManifest(request,new TextEncoder().encode(JSON.stringify(fill))),/fill/);
 const missing=rawCopy();delete ((missing.properties as Record<string,unknown>).parameter as Record<string,Record<string,number>>).RH2M!['199112'];assert.throws(()=>buildEnvironmentManifest(request,new TextEncoder().encode(JSON.stringify(missing))),/360 month records/);
 const changedUnits=rawCopy(),precipitationMetadata=(changedUnits.parameters as Record<string,{units:string}>).PRECTOTCORR;assert.ok(precipitationMetadata);precipitationMetadata.units='kg/m2';assert.throws(()=>buildEnvironmentManifest(request,new TextEncoder().encode(JSON.stringify(changedUnits))),/unit changed/);
 const wrongSource=rawCopy();(wrongSource.header as Record<string,unknown>).sources=['OTHER'];assert.throws(()=>buildEnvironmentManifest(request,new TextEncoder().encode(JSON.stringify(wrongSource))),/metadata does not match/);
 const wrongPoint=rawCopy();(wrongPoint.geometry as {coordinates:number[]}).coordinates[0]=0;assert.throws(()=>buildEnvironmentManifest(request,new TextEncoder().encode(JSON.stringify(wrongPoint))),/does not match the requested point rounded/);
 const valid=buildEnvironmentManifest(request,rawBytes);assert.throws(()=>validateEnvironmentManifest({...valid,source:{...valid.source,sha256:'broken'}}),/source provenance/);
});

test('fetch retries one transient response, bounds bytes and time, caches exact raw bytes, and serializes requests',async()=>{
 const {temp,allowed}=await tempRoot();let calls=0,active=0,maxActive=0;
 const fetcher=(async(_url:string,init?:RequestInit)=>{calls++;active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,2));active--;if(calls===1)return new Response('retry',{status:429});assert.ok(init?.signal);return new Response(rawBytes,{status:200,headers:{'content-length':String(rawBytes.length)}});}) as typeof fetch;
 try{const result=await fetchPowerMonthly(request,{allowedRoot:allowed,fetcher,sleep:async()=>{},now:()=>new Date('2026-10-08T00:00:00.000Z')});assert.equal(calls,2);assert.equal(maxActive,1);assert.equal(result.receipt.sha256,digest(rawBytes));assert.equal(result.receipt.bytes,rawBytes.byteLength);assert.equal(result.receipt.fetchedAt,'2026-10-08T00:00:00.000Z');assert.ok((await stat(result.receipt.sourceCachePath)).size===rawBytes.byteLength);assert.ok((await readFile(result.receipt.sourceCachePath)).equals(Buffer.from(rawBytes)));assert.equal(result.manifest.profile.months.length,12);
  const tooLarge=new Uint8Array(ENVIRONMENT_LIMITS.responseBytes+1);let largeCalls=0;const large=(async()=>{largeCalls++;return new Response(tooLarge);}) as typeof fetch;await assert.rejects(fetchPowerMonthly(request,{allowedRoot:allowed,fetcher:large,sleep:async()=>{}}),/1 MB/);assert.equal(largeCalls,1);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('publishes the raw source and environment manifest immutably under an isolated build root',async()=>{
 const {temp,allowed}=await tempRoot(),output=path.join(allowed,'output','environment'),manifest=buildEnvironmentManifest(request,rawBytes);
 try{const published=await publishEnvironment(manifest,rawBytes,output,allowed);assert.match(published.manifestHash,/^[a-f0-9]{64}$/);assert.equal(published.manifestPath,`manifests/${published.manifestHash}.json`);assert.deepEqual(await readFile(path.join(output,published.sourcePath)),Buffer.from(rawBytes));const manifestBytes=await readFile(path.join(output,published.manifestPath));assert.equal(digest(new Uint8Array(manifestBytes)),published.manifestHash);assert.equal(JSON.parse(manifestBytes.toString()).profile.months.length,12);await assert.rejects(publishEnvironment(manifest,new Uint8Array([1,2]),output,allowed),/do not match/);await assert.rejects(publishEnvironment(manifest,rawBytes,path.join(temp,'outside'),allowed),/inside .cache/);await assert.rejects(loadCachedRaw(path.join(output,published.sourcePath),'0'.repeat(64),rawBytes.length,allowed),/corrupt/);await assert.rejects(loadCachedRaw(path.join(temp,'missing.json'),digest(rawBytes),ENVIRONMENT_LIMITS.responseBytes+1,allowed),/1 MB/);
  const outsideFile=path.join(temp,'outside-source.json');await writeFile(outsideFile,rawBytes);const linkPath=path.join(allowed,'source-link.json');await symlink(outsideFile,linkPath);await assert.rejects(loadCachedRaw(linkPath,digest(rawBytes),rawBytes.length,allowed),/regular pinned-size file/);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('allows at most six sequential regional pilot builds within a six megabyte response ceiling',async()=>{
 const {temp,allowed}=await tempRoot(),output=path.join(allowed,'output','environment');let active=0,maxActive=0,calls=0;
 const fetcher=(async()=>{calls++;active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,2));active--;return new Response(rawBytes,{status:200,headers:{'content-length':String(rawBytes.length)}});}) as typeof fetch;
 const requests=Array.from({length:6},(_,i)=>({...request,id:`pilot-${i}`,regionId:`pilot:${i}`,name:`Pilot ${i}`}));
 try{const results=await fetchPilotBatch(requests,{allowedRoot:allowed,outputRoot:output,fetcher,sleep:async()=>{},now:()=>new Date('2026-10-08T00:00:00.000Z')});assert.equal(results.length,6);assert.equal(calls,6);assert.equal(maxActive,1);assert.ok(results.reduce((sum,x)=>sum+x.bytes,0)<=ENVIRONMENT_LIMITS.totalResponseBytes);assert.ok(results.every(x=>x.publishedBytes>x.bytes));
  await assert.rejects(fetchPilotBatch([...requests,{...request,id:'7'}],{allowedRoot:allowed,outputRoot:output,fetcher}),/one to six/);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('charges retryable error bodies against the whole batch response-byte ceiling',async()=>{
 const {temp,allowed}=await tempRoot(),output=path.join(allowed,'output','environment');let calls=0;
 const largeError=new Uint8Array(980_000);
 const fetcher=(async()=>{calls++;if(calls%2===1)return new Response(largeError,{status:503,headers:{'content-length':String(largeError.byteLength)}});return new Response(rawBytes,{status:200,headers:{'content-length':String(rawBytes.byteLength)}});}) as typeof fetch;
 const requests=Array.from({length:6},(_,i)=>({...request,id:`retry-pilot-${i}`,regionId:`retry:${i}`,name:`Retry Pilot ${i}`}));
 try{await assert.rejects(fetchPilotBatch(requests,{allowedRoot:allowed,outputRoot:output,fetcher,sleep:async()=>{}}),/6 MB cumulative response budget/);assert.equal(calls,12);}
 finally{await rm(temp,{recursive:true,force:true});}
});
