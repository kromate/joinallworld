import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { publishSettlementSource } from './settlement-publish.ts';
import type { SettlementParentPin } from './settlement-product-types.ts';
import type { SettlementSourcePin } from './settlement-types.ts';
import type { SourceRecord } from './types.ts';

const release='ca96624a56bd078437bca8184e78163e5039ad19';
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const blob=(value:Uint8Array)=>createHash('sha1').update(`blob ${value.byteLength}\0`).update(value).digest('hex');
function canonical(value:unknown):string{if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);if(typeof value==='number')return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object'){const row=value as Record<string,unknown>;return`{${Object.keys(row).sort().map(key=>`${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;}throw new TypeError('fixture is not canonical JSON');}
function record(id:string,kind:'places'|'admin0',raw:Uint8Array):SourceRecord{void id;const file=kind==='places'?'ne_10m_populated_places.geojson':'ne_10m_admin_0_countries.geojson';return{id:`natural-earth-${kind==='places'?'places':'admin0'}-10m-${release}`,url:`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/${file}`,release,license:'Public-domain',attribution:'SYNTHETIC TEST FIXTURE; no upstream data or source claim',sha256:sha(raw),bytes:raw.byteLength};}
const ring=(west:number)=>[[west,0],[west+1,0],[west+1,1],[west,1],[west,0]];
async function fixture(options:{emptySource?:boolean}={}){
 const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'settlement-publish-'));
 const admin0={type:'FeatureCollection',features:[
  {type:'Feature',properties:{NE_ID:1,ADM0_A3:'GHA',ISO_A2_EH:'GH',ADMIN:'Ghana',CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[ring(-2)]}},
  {type:'Feature',properties:{NE_ID:2,ADM0_A3:'NGA',ISO_A2_EH:'NG',ADMIN:'Nigeria',CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[ring(3)]}},
 ]};const parentRaw=Buffer.from(JSON.stringify(admin0)),parent=record('p','admin0',parentRaw),parentBlob=blob(parentRaw),parentRequest=sha(canonical({release,path:'geojson/ne_10m_admin_0_countries.geojson',blob:parentBlob,expectedBytes:parentRaw.length})),parentInput=`.cache/world-build/country-source-cache/${parentRequest}.geojson`;await mkdir(path.dirname(path.join(root,parentInput)),{recursive:true});await writeFile(path.join(root,parentInput),parentRaw);
 const compiledParent=compileCountryDirectory(parent,parentRaw,parent,parentRaw,'e'.repeat(64));const published=await publishCountryDirectory(compiledParent,path.join(root,'.cache/world-build/output/country-inventory'),path.join(root,'.cache/world-build'));
 const features=options.emptySource?[]:Array.from({length:68},(_,i)=>({type:'Feature',properties:{NE_ID:100+i,ADM0_A3:'NGA',NAME:`Protected ${i}`,NAMEASCII:`Protected ${i}`,FEATURECLA:'Admin-0 capital',SCALERANK:2},geometry:{type:'Point',coordinates:[3+i/100,6]}}));if(!options.emptySource)features.push({type:'Feature',properties:{NE_ID:999,ADM0_A3:'GHA',NAME:'Fixture City',NAMEASCII:'Fixture City',FEATURECLA:'Populated place',SCALERANK:4},geometry:{type:'Point',coordinates:[-0.2,5.5]}});
 const raw=Buffer.from(JSON.stringify({type:'FeatureCollection',features})),source=record('s','places',raw),sourcePin:SettlementSourcePin={schemaVersion:1,source,input:'',gitBlobSha1:blob(raw)};const sourceRequest=sha(canonical({release,path:'geojson/ne_10m_populated_places.geojson',blob:sourcePin.gitBlobSha1,expectedBytes:source.bytes}));sourcePin.input=`.cache/world-build/settlement-source-cache/${sourceRequest}.geojson`;await mkdir(path.dirname(path.join(root,sourcePin.input)),{recursive:true});await writeFile(path.join(root,sourcePin.input),raw);
 const parentPin:SettlementParentPin={manifestHash:published.manifestHash,directoryRoot:'.cache/world-build/output/country-inventory',source:parent,input:parentInput};
 return{root,sourcePin,parentPin,cleanup:()=>rm(root,{recursive:true,force:true})};
}
function run(f:Awaited<ReturnType<typeof fixture>>,extra:Partial<Parameters<typeof publishSettlementSource>[0]>={}){return publishSettlementSource({repositoryRoot:f.root,sourcePin:f.sourcePin,parentPin:f.parentPin,...extra});}

test('publishes source-bound selected points, protects Nigeria, and reuses a fully verified immutable product',async()=>{
 const f=await fixture();try{const first=await run(f);assert.equal(first.networkBytes,0);assert.equal(first.cacheHit,false);assert.equal(first.sourceUnits,69);assert.equal(first.emittedUnits,1);const second=await run(f);assert.equal(second.cacheHit,true);assert.equal(second.manifestHash,first.manifestHash);assert.equal(second.bytes,first.bytes);const audit=path.join(f.root,'.cache/world-build/settlement-publish-attempts');assert.equal((await readdir(audit)).length,1);const manifest=JSON.parse(await readFile(first.manifestPath,'utf8')) as {protected:number;countries:Array<{countryId:string;status:string;points:unknown}>};assert.equal(manifest.protected,68);assert.deepEqual(manifest.countries.find(c=>c.countryId==='legacy-ng'),{countryId:'legacy-ng',status:'protected',sourceUnits:68,emittedUnits:0,points:null});}
 finally{await f.cleanup();}
});

test('rebuilds cache from pinned source and rejects self-consistent rehashed coordinate tampering',async()=>{
 const f=await fixture();try{const result=await run(f),output=path.join(f.root,'.cache/world-build/output/selected-places'),manifest=JSON.parse(await readFile(result.manifestPath,'utf8')) as {countries:Array<{points:{path:string;sha256:string;bytes:number}|null}>};const ref=manifest.countries.find(row=>row.points)?.points;assert.ok(ref);const pointPath=path.join(output,ref!.path),points=JSON.parse(await readFile(pointPath,'utf8')) as {rows:Array<{coordinates:[number,number]}>};points.rows[0]!.coordinates[0]+=0.125;const pointBody=Buffer.from(`${canonical(points)}\n`),pointHash=sha(pointBody),newPointPath=`points/${pointHash}.json`;await writeFile(path.join(output,newPointPath),pointBody);await rm(pointPath);ref!.path=newPointPath;ref!.sha256=pointHash;ref!.bytes=pointBody.length;const newManifestBody=Buffer.from(`${canonical(manifest)}\n`),newHash=sha(newManifestBody),newPath=path.join(output,'manifests',`${newHash}.json`);await writeFile(newPath,newManifestBody);await rm(result.manifestPath);await assert.rejects(run(f),/deterministic source compilation/);}
 finally{await f.cleanup();}
});

test('validates a cache hit even after the eight lifetime publication attempts are exhausted',async()=>{
 const f=await fixture();try{const result=await run(f),audit=path.join(f.root,'.cache/world-build/settlement-publish-attempts'),files=await readdir(audit),original=JSON.parse(await readFile(path.join(audit,files[0]!),'utf8')) as Record<string,unknown>;for(let i=0;i<7;i++){const clone={...original,attemptId:randomUUID()};await writeFile(path.join(audit,`${clone.attemptId as string}.json`),`${canonical(clone)}\n`);}const reused=await run(f);assert.equal(reused.cacheHit,true);assert.equal(reused.manifestHash,result.manifestHash);assert.equal((await readdir(audit)).length,8);}
 finally{await f.cleanup();}
});

test('admits exactly the eighth build attempt and refuses an uncached ninth',async()=>{
 for(const startingAttempts of [7,8] as const){const f=await fixture();try{const controller=new AbortController();await assert.rejects(run(f,{signal:controller.signal,onWorkerOnline:()=>controller.abort(new Error('seed pending attempt'))}),/seed pending attempt/);const audit=path.join(f.root,'.cache/world-build/settlement-publish-attempts'),files=await readdir(audit),seed=JSON.parse(await readFile(path.join(audit,files[0]!),'utf8')) as Record<string,unknown>;const pending:Record<string,unknown>={...seed,status:'pending'};delete pending.finishedAt;delete pending.error;await writeFile(path.join(audit,`${seed.attemptId as string}.json`),`${canonical(pending)}\n`);for(let i=1;i<startingAttempts;i++){const clone={...pending,attemptId:randomUUID()};await writeFile(path.join(audit,`${clone.attemptId as string}.json`),`${canonical(clone)}\n`);}if(startingAttempts===7){const accepted=await run(f);assert.equal(accepted.cacheHit,false);assert.equal((await readdir(audit)).length,8);}else{let launched=false;await assert.rejects(run(f,{onWorkerOnline:()=>{launched=true;}}),/exhausted its eight lifetime attempts/);assert.equal(launched,false);}}
 finally{await f.cleanup();}}
});

test('publishes and revalidates an explicitly empty source feature collection',async()=>{
 const f=await fixture({emptySource:true});try{const first=await run(f),second=await run(f);assert.equal(first.sourceUnits,0);assert.equal(first.emittedUnits,0);assert.equal(second.cacheHit,true);assert.equal(second.manifestHash,first.manifestHash);const audit=path.join(f.root,'.cache/world-build/settlement-publish-attempts'),row=JSON.parse(await readFile(path.join(audit,(await readdir(audit))[0]!),'utf8')) as {sourceUnits:number};assert.equal(row.sourceUnits,0);}
 finally{await f.cleanup();}
});

test('aborted worker remains charged and later resumes through immutable assets',async()=>{
 const f=await fixture();try{const controller=new AbortController();let online=false;await assert.rejects(run(f,{signal:controller.signal,onWorkerOnline:()=>{online=true;controller.abort(new Error('cancel settlement worker'));}}),/cancel settlement worker/);assert.equal(online,true);const out=path.join(f.root,'.cache/world-build/output/selected-places');await assert.rejects(readdir(path.join(out,'manifests')),{code:'ENOENT'});const audit=path.join(f.root,'.cache/world-build/settlement-publish-attempts'),rows=await readdir(audit);assert.equal(rows.length,1);assert.equal((JSON.parse(await readFile(path.join(audit,rows[0]!),'utf8')) as {status:string}).status,'aborted');const result=await run(f);assert.equal(result.cacheHit,false);assert.equal(result.emittedUnits,1);}
 finally{await f.cleanup();}
});

test('rejects corrupt/missing referenced assets and corrupt pins without repair',async()=>{
 const f=await fixture();try{const first=await run(f),manifest=JSON.parse(await readFile(first.manifestPath,'utf8')) as {inspection:{path:string};countries:Array<{points:{path:string}|null}>};const output=path.join(f.root,'.cache/world-build/output/selected-places');const point=manifest.countries.find(c=>c.points)?.points;assert.ok(point);const pointPath=path.join(output,point!.path);await writeFile(pointPath,'{}\n');await assert.rejects(run(f),/hash\/length mismatch/);await writeFile(pointPath,Buffer.alloc(0));await assert.rejects(run(f),/hash\/length mismatch/);const bad=structuredClone(f.sourcePin);bad.gitBlobSha1='0'.repeat(40);await assert.rejects(run(f,{sourcePin:bad}),/capture request identity|full pin/);}
 finally{await f.cleanup();}
});

test('worker interruption after a country asset preserves partials and writes no manifest',async()=>{
 const f=await fixture();try{const controller=new AbortController();let wrote=0;await assert.rejects(run(f,{signal:controller.signal,onAssetWritten:()=>{if(++wrote===1)controller.abort(new Error('interrupt after immutable asset'));}}),/interrupt after immutable asset/);assert.ok(wrote>=1);const out=path.join(f.root,'.cache/world-build/output/selected-places');await assert.rejects(readdir(path.join(out,'manifests')),{code:'ENOENT'});const done=await run(f);assert.equal(done.manifestHash.length,64);assert.equal(done.emittedUnits,1);}
 finally{await f.cleanup();}
});

test('rejects symlinked output and malformed pins before creating publication audit',async()=>{
 const f=await fixture(),outside=await mkdtemp(path.join(await realpath(os.tmpdir()),'settlement-outside-'));try{const output=path.join(f.root,'.cache/world-build/output/selected-places');await mkdir(path.dirname(output),{recursive:true});await (await import('node:fs/promises')).symlink(outside,output);await assert.rejects(run(f),/unsafe|symlink/);assert.deepEqual(await readdir(outside),[]);const malformed=structuredClone(f.parentPin);malformed.manifestHash='../bad';await assert.rejects(run(f,{parentPin:malformed}),/manifest|parent source record/);await assert.rejects(readdir(path.join(f.root,'.cache/world-build/settlement-publish-attempts')),{code:'ENOENT'});}
 finally{await f.cleanup();await rm(outside,{recursive:true,force:true});}
});

test('rejects a symlinked audit root before writing outside the build cache',async()=>{
 const f=await fixture(),outside=await mkdtemp(path.join(await realpath(os.tmpdir()),'settlement-audit-outside-'));try{const audit=path.join(f.root,'.cache/world-build/settlement-publish-attempts');await mkdir(path.dirname(audit),{recursive:true});await (await import('node:fs/promises')).symlink(outside,audit);await assert.rejects(run(f),/audit root|symlink|unsafe/);assert.deepEqual(await readdir(outside),[]);}
 finally{await f.cleanup();await rm(outside,{recursive:true,force:true});}
});
