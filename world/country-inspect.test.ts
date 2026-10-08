import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inspectCountrySource } from './country-inspect.ts';
import type { CountryCaptureSpec } from './country-types.ts';
import type { InventoryPin } from './bootstrap.ts';

const release = 'a'.repeat(40), artifactPath = 'geojson/ne_10m_admin_0_countries.geojson';
const metadataPath = '.cache/world-build/evidence/country-resolution-research/ne-10m-countries-api.json';
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const gitSha = (bytes: Uint8Array) => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
function canonical(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; const o=value as Record<string,unknown>; return `{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`; }
const ring = [[-3,5],[-2,5],[-2,6],[-3,6],[-3,5]];
function geojson(nameSuffix = '',heavy=false): Buffer {
  const coordinates:[number,number][]=heavy?Array.from({length:60_000},(_,i)=>[i%2?-2:-3,5+(i%3)*0.00001] as [number,number]):ring as [number,number][];
  if(heavy)coordinates.push(coordinates[0]!);
  const features = [
    { type:'Feature', properties:{ NE_ID:1, ADMIN:`Ghana${nameSuffix}`, CONTINENT:'Africa', ISO_A2_EH:'GH' }, geometry:{type:'Polygon',coordinates:[coordinates]} },
    { type:'Feature', properties:{ NE_ID:159, ADMIN:'Nigeria', CONTINENT:'Africa', ISO_A2_EH:'NG' }, geometry:{type:'Polygon',coordinates:[heavy?coordinates:[[3,4],[4,4],[4,5],[3,5],[3,4]]]} },
  ];
  return Buffer.from(JSON.stringify({type:'FeatureCollection',features}));
}
async function fixture(run: (x:{root:string,spec:CountryCaptureSpec,pin:InventoryPin,source:Buffer,baseline:Buffer})=>Promise<void>, opts:{baselineLink?:boolean,sourceNameSuffix?:string,heavy?:boolean}={}):Promise<void> {
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'country-inspect-'));
  try {
    const source=geojson(opts.sourceNameSuffix,opts.heavy), baseline=geojson('',opts.heavy);
    const metadataFile=path.join(root,metadataPath), metadataDir=path.dirname(metadataFile); await mkdir(metadataDir,{recursive:true});
    const blob=gitSha(source), rawUrl=`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/${artifactPath}`, blobUrl=`https://api.github.com/repos/nvkelso/natural-earth-vector/git/blobs/${blob}`;
    const metadata=Buffer.from(JSON.stringify({name:'ne_10m_admin_0_countries.geojson',path:artifactPath,sha:blob,size:source.length,url:`https://api.github.com/repos/nvkelso/natural-earth-vector/contents/${artifactPath}?ref=${release}`,html_url:`https://github.com/nvkelso/natural-earth-vector/blob/${release}/${artifactPath}`,download_url:rawUrl,git_url:blobUrl,type:'file',encoding:'none',_links:{git:blobUrl}}));
    await writeFile(metadataFile,metadata);
    const spec:CountryCaptureSpec={schemaVersion:1,provider:'natural-earth',release,resolution:'10m',metadataPath,metadataSha256:sha(metadata),metadataBytes:metadata.length,expectedBytes:source.length,expectedGitBlobSha1:blob,license:'Public-domain',attribution:'Synthetic fixture only'};
    const requestHash=sha(canonical({release,path:artifactPath,blob,expectedBytes:source.length}));
    const cache=path.join(root,'.cache/world-build/country-source-cache'); await mkdir(cache,{recursive:true});
    await writeFile(path.join(cache,`${requestHash}.geojson`),source);
    const sourceRecord={id:`natural-earth-admin0-10m-${release}`,url:rawUrl,release,license:'Public-domain',attribution:spec.attribution,sha256:sha(source),bytes:source.length};
    await writeFile(path.join(cache,`${requestHash}.receipt.json`),JSON.stringify({schemaVersion:1,requestHash,requestIdentity:{release,path:artifactPath,blob,expectedBytes:source.length},sourceId:sourceRecord.id,sourceUrl:rawUrl,sha256:sha(source),bytes:source.length,gitBlobSha1:blob,observedHttpStatus:null,upstreamBytes:0,completedAt:new Date().toISOString(),evidence:'verified-existing-git-blob-cache'}));
    const baselinePath='.cache/world-build/test-baseline/baseline.geojson', baselineFile=path.join(root,baselinePath); await mkdir(path.dirname(baselineFile),{recursive:true}); await writeFile(baselineFile,baseline);
    const pin:InventoryPin={schemaVersion:1,source:{id:'natural-earth-admin0-110m-fixture',url:'https://example.test/baseline.geojson',release:'b'.repeat(40),license:'Public-domain',attribution:'Synthetic fixture only',sha256:sha(baseline),bytes:baseline.length},input:baselinePath,sourceFeatureCount:2,resolutionLimitations:['Synthetic fixture only; no real geographic evidence.']};
    if(opts.baselineLink){await rm(baselineFile);await symlink(path.join(root,'.cache/world-build/missing.geojson'),baselineFile);}
    await run({root,spec,pin,source,baseline});
  } finally { await rm(root,{recursive:true,force:true}); }
}

test('inspects only verified cached bytes, is deterministic, and writes private reports without preview output',async()=>fixture(async({root,spec,pin})=>{
  const first=await inspectCountrySource({repositoryRoot:root,spec,baselinePin:pin});
  const second=await inspectCountrySource({repositoryRoot:root,spec,baselinePin:pin});
  assert.equal(first.networkBytes,0);assert.equal(second.networkBytes,0);assert.equal(first.reportHash,second.reportHash);
  assert.equal(first.report.sourceUnits,2);assert.equal(first.report.sourceCoordinatePositions,10);assert.equal(first.report.coordinatePositions,5);
  assert.ok(first.report.exceptions.some(x=>x.includes('exclude Nigeria')));assert.match(first.reportPath,/country-inspections\/reports\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/);
  const bytes=await readFile(first.reportPath);assert.equal(sha(bytes),first.reportHash);assert.equal(bytes.at(-1),10);
  await assert.rejects(readFile(path.join(root,'.cache/world-build/output')),{code:'ENOENT'});
}));

test('rejects a baseline pin hash mismatch before starting an inspection attempt',async()=>fixture(async({root,spec,pin})=>{
  const bad={...pin,source:{...pin.source,sha256:'0'.repeat(64)}};
  await assert.rejects(inspectCountrySource({repositoryRoot:root,spec,baselinePin:bad}),/baseline source bytes differ/);
  await assert.rejects(readFile(path.join(root,'.cache/world-build/country-inspections')),{code:'ENOENT'});
}));

test('rejects symlinked baseline inputs without following them',async()=>fixture(async({root,spec,pin})=>{
  await assert.rejects(inspectCountrySource({repositoryRoot:root,spec,baselinePin:pin}),/symlink|unsafe/);
},{baselineLink:true}));

test('honors pre-aborted cancellation without preview publication',async()=>fixture(async({root,spec,pin})=>{
  const controller=new AbortController();controller.abort(new Error('synthetic cancellation'));
  await assert.rejects(inspectCountrySource({repositoryRoot:root,spec,baselinePin:pin,signal:controller.signal}),/aborted|synthetic cancellation/);
  await assert.rejects(readFile(path.join(root,'.cache/world-build/output')),{code:'ENOENT'});
}));

test('cancels admitted inspection and closes worker before lock reuse',async()=>fixture(async({root,spec,pin})=>{
  const controller=new AbortController();const pending=inspectCountrySource({repositoryRoot:root,spec,baselinePin:pin,signal:controller.signal});
  const audit=path.join(root,'.cache/world-build/country-inspections/attempts');
  const admissionDeadline=Date.now()+5_000;let attemptFile:string|undefined;
  while(Date.now()<admissionDeadline&&!attemptFile){
    const files=await readdir(audit).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error;});
    const records=files.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name));
    if(records.length){attemptFile=path.join(audit,records[0]!);const row=JSON.parse(await readFile(attemptFile,'utf8')) as Record<string,unknown>;if(row.status!=='pending')throw new Error(`inspection finished before pending-attempt admission could be observed (${String(row.status)})`);break;}
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.ok(attemptFile,'inspection did not durably admit an attempt within five seconds');
  controller.abort(new Error('synthetic admitted inspection cancellation'));
  await assert.rejects(pending,/aborted|synthetic admitted inspection cancellation/);
  const attempt=JSON.parse(await readFile(attemptFile,'utf8')) as Record<string,unknown>;
  assert.equal(attempt.status,'aborted');
  const result=await inspectCountrySource({repositoryRoot:root,spec,baselinePin:pin});assert.equal(result.networkBytes,0);
},{heavy:true}));
