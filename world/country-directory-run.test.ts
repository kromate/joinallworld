import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildCountryDirectory } from './country-directory-run.ts';
import { buildInventory, publishInventory } from './inventory.ts';
import type { CountryCaptureSpec } from './country-types.ts';
import type { InventoryPin } from './bootstrap.ts';
import type { SourceRecord } from './types.ts';

const captureRelease='a'.repeat(40),artifact='geojson/ne_10m_admin_0_countries.geojson',metadataPath='.cache/world-build/evidence/country-resolution-research/ne-10m-countries-api.json';
const sha=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const blob=(v:Uint8Array)=>createHash('sha1').update(`blob ${v.byteLength}\0`).update(v).digest('hex');
function canonical(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;const o=v as Record<string,unknown>;return`{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;}
const box=[[-3,5],[-2,5],[-2,6],[-3,6],[-3,5]];
function features(includeGhana=true,heavy=false):unknown[]{
  const large:[number,number][]=heavy?Array.from({length:3_500},(_,i)=>[i%2?-2:-3,5+(i%3)*0.00001] as [number,number]):box as [number,number][];
  if(heavy)large.push(large[0]!);
  const rows=[{NE_ID:1,ADMIN:'Rwanda',ISO_A2_EH:'RW'},{NE_ID:159,ADMIN:'Nigeria',ISO_A2_EH:'NG'},...(includeGhana?[{NE_ID:3,ADMIN:'Ghana',ISO_A2_EH:'GH'}]:[])];
  return rows.map((row,index)=>({type:'Feature',properties:{...row,CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[heavy?large:(index===1?[[3,4],[4,4],[4,5],[3,5],[3,4]]:box)]}}));
}
function geojson(includeGhana=true,heavy=false):Buffer{return Buffer.from(JSON.stringify({type:'FeatureCollection',features:features(includeGhana,heavy)}));}

async function fixture(run:(ctx:{root:string,spec:CountryCaptureSpec,pin:InventoryPin,manifestHash:string})=>Promise<void>,options:{omitCandidateGhana?:boolean,baselinePinMismatch?:boolean,baselineLink?:boolean,heavy?:boolean}={}):Promise<void>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'country-directory-run-'));
  try{
    const buildRoot=path.join(root,'.cache/world-build'),sourceBytes=geojson(!options.omitCandidateGhana,options.heavy),baselineBytes=geojson(true,options.heavy);
    const metadataDir=path.dirname(path.join(root,metadataPath));await mkdir(metadataDir,{recursive:true});
    const b=blob(sourceBytes),rawUrl=`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${captureRelease}/${artifact}`,blobUrl=`https://api.github.com/repos/nvkelso/natural-earth-vector/git/blobs/${b}`;
    const metadata=Buffer.from(JSON.stringify({name:'ne_10m_admin_0_countries.geojson',path:artifact,sha:b,size:sourceBytes.length,url:`https://api.github.com/repos/nvkelso/natural-earth-vector/contents/${artifact}?ref=${captureRelease}`,html_url:`https://github.com/nvkelso/natural-earth-vector/blob/${captureRelease}/${artifact}`,download_url:rawUrl,git_url:blobUrl,type:'file',encoding:'none',_links:{git:blobUrl}}));await writeFile(path.join(metadataDir,path.basename(metadataPath)),metadata);
    const spec:CountryCaptureSpec={schemaVersion:1,provider:'natural-earth',release:captureRelease,resolution:'10m',metadataPath,metadataSha256:sha(metadata),metadataBytes:metadata.length,expectedBytes:sourceBytes.length,expectedGitBlobSha1:b,license:'Public-domain',attribution:'Synthetic test fixture only'};
    const requestHash=sha(canonical({release:captureRelease,path:artifact,blob:b,expectedBytes:sourceBytes.length})),cache=path.join(buildRoot,'country-source-cache');await mkdir(cache,{recursive:true});await writeFile(path.join(cache,`${requestHash}.geojson`),sourceBytes);
    const source:SourceRecord={id:`natural-earth-admin0-10m-${captureRelease}`,url:rawUrl,release:captureRelease,license:spec.license,attribution:spec.attribution,sha256:sha(sourceBytes),bytes:sourceBytes.length};
    await writeFile(path.join(cache,`${requestHash}.receipt.json`),JSON.stringify({schemaVersion:1,requestHash,requestIdentity:{release:captureRelease,path:artifact,blob:b,expectedBytes:sourceBytes.length},sourceId:source.id,sourceUrl:rawUrl,sha256:source.sha256,bytes:source.bytes,gitBlobSha1:b,observedHttpStatus:null,upstreamBytes:0,completedAt:new Date().toISOString(),evidence:'verified-existing-git-blob-cache'}));
    const baselineSource:SourceRecord={id:'natural-earth-admin0-110m-fixture',url:'https://example.test/natural-earth.geojson',release:'b'.repeat(40),license:'Public-domain',attribution:'Synthetic test fixture only',sha256:sha(baselineBytes),bytes:baselineBytes.length};
    const pinInput='.cache/world-build/source-pins/baseline.geojson',pinPath=path.join(root,pinInput);await mkdir(path.dirname(pinPath),{recursive:true});await writeFile(pinPath,baselineBytes);
    const pin:InventoryPin={schemaVersion:1,source:options.baselinePinMismatch?{...baselineSource,attribution:'mismatch'}:baselineSource,input:pinInput,sourceFeatureCount:features(true,options.heavy).length,resolutionLimitations:['Synthetic fixture only; not source-quality evidence.']};
    const baselineInventory=buildInventory(baselineSource,JSON.parse(baselineBytes.toString('utf8')) as unknown);
    const published=await publishInventory(baselineInventory,path.join(buildRoot,'output/inventory'),buildRoot);
    if(options.baselineLink){await rm(pinPath);await symlink(path.join(buildRoot,'source-pins/absent.geojson'),pinPath);}
    await run({root,spec,pin,manifestHash:published.manifestHash});
  }finally{await rm(root,{recursive:true,force:true});}
}

test('builds immutable separate directory from cache-only source and verifies source/baseline bindings',async()=>fixture(async({root,spec,pin,manifestHash})=>{
  const result=await buildCountryDirectory({repositoryRoot:root,spec,baselinePin:pin,baselineInventoryHash:manifestHash});
  assert.equal(result.networkBytes,0);assert.equal(result.sourceUnitCount,3);assert.equal(result.retained,3);assert.equal(result.missing,0);
  assert.match(result.manifestPath,/output\/country-inventory\/manifests\/[a-f0-9]{64}\.json$/);
  const bytes=await readFile(result.manifestPath);assert.equal(sha(bytes),result.manifestHash);
  const manifest=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;assert.equal(manifest.baselineInventoryHash,manifestHash);assert.equal((manifest.baselineSource as SourceRecord).sha256,pin.source.sha256);
  await assert.rejects(readFile(path.join(root,'.cache/world-build/output/fine')),{code:'ENOENT'});
}));

test('refuses a baseline manifest whose frozen source binding differs from supplied pin',async()=>fixture(async({root,spec,pin,manifestHash})=>{
  await assert.rejects(buildCountryDirectory({repositoryRoot:root,spec,baselinePin:pin,baselineInventoryHash:manifestHash}),/not bound to the exact pinned/);
  await assert.rejects(readFile(path.join(root,'.cache/world-build/country-directory-attempts')),{code:'ENOENT'});
},{baselinePinMismatch:true}));

test('rejects symlinked baseline source input',async()=>fixture(async({root,spec,pin,manifestHash})=>{
  await assert.rejects(buildCountryDirectory({repositoryRoot:root,spec,baselinePin:pin,baselineInventoryHash:manifestHash}),/symlink|unsafe/);
},{baselineLink:true}));

test('compiler failure is recorded durably and never reports success',async()=>fixture(async({root,spec,pin,manifestHash})=>{
  await assert.rejects(buildCountryDirectory({repositoryRoot:root,spec,baselinePin:pin,baselineInventoryHash:manifestHash}),/missing baseline country identities/);
  const audit=path.join(root,'.cache/world-build/country-directory-attempts'),files=await readdir(audit);assert.equal(files.length,1);
  const record=JSON.parse(await readFile(path.join(audit,files[0]!),'utf8')) as Record<string,unknown>;assert.equal(record.status,'failed');assert.equal(record.networkBytes,0);
},{omitCandidateGhana:true}));

test('aborts and closes a live compiler worker before shared lock reuse',async()=>fixture(async({root,spec,pin,manifestHash})=>{
  const controller=new AbortController(),pending=buildCountryDirectory({repositoryRoot:root,spec,baselinePin:pin,baselineInventoryHash:manifestHash,signal:controller.signal});setTimeout(()=>controller.abort(new Error('synthetic compiler cancellation')),200);
  await assert.rejects(pending,/aborted|synthetic compiler cancellation/);
  const audit=path.join(root,'.cache/world-build/country-directory-attempts'),files=await readdir(audit);assert.equal(files.length,1);assert.equal((JSON.parse(await readFile(path.join(audit,files[0]!),'utf8')) as Record<string,unknown>).status,'aborted');
  const rerun=await buildCountryDirectory({repositoryRoot:root,spec,baselinePin:pin,baselineInventoryHash:manifestHash});assert.equal(rerun.networkBytes,0);
},{heavy:true}));
