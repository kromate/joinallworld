import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectAdmin1Source } from './admin1-inspect.ts';
import { publishAdmin1Source } from './admin1-publish.ts';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import type { Admin1ParentPin, Admin1SourcePin } from './admin1-types.ts';
import type { SourceRecord } from './types.ts';

const release='ca96624a56bd078437bca8184e78163e5039ad19';
const sha=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const blob=(v:Uint8Array)=>createHash('sha1').update(`blob ${v.byteLength}\0`).update(v).digest('hex');
function canonical(value:unknown):string{if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);if(typeof value==='number')return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object'){const row=value as Record<string,unknown>;return`{${Object.keys(row).sort().map(key=>`${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;}throw new TypeError('fixture value is not canonical JSON');}
const ring=(west:number)=>[[west,0],[west+1,0],[west+1,1],[west,1],[west,0]];
function source(id:string,artifact:'admin0'|'admin1',bytes:Uint8Array):SourceRecord{return{id,url:`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_${artifact==='admin0'?'admin_0_countries':'admin_1_states_provinces'}.geojson`,release,license:'Public-domain',attribution:'Synthetic fixture only',sha256:sha(bytes),bytes:bytes.byteLength};}
async function fixture(options:{stringKey?:boolean}={}){
 const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'admin1-publish-'));
 const admin0={type:'FeatureCollection',features:[
  {type:'Feature',id:'ne-gh',properties:{NE_ID:1,ADM0_A3:'GHA',ISO_A2_EH:'GH',ADMIN:'Ghana',CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[ring(-3)]}},
  {type:'Feature',id:'ne-ng',properties:{NE_ID:159,ADM0_A3:'NGA',ISO_A2_EH:'NG',ADMIN:'Nigeria',CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[ring(3)]}},
  {type:'Feature',id:'ne-rw',properties:{NE_ID:3,ADM0_A3:'RWA',ISO_A2_EH:'RW',ADMIN:'Rwanda',CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[ring(30)]}},
 ]};
 const parentRaw=Buffer.from(JSON.stringify(admin0)),parent=source('natural-earth-admin0-10m','admin0',parentRaw),parentInput=`.cache/world-build/country-source-cache/${sha(parentRaw)}.geojson`,parentPath=path.join(root,parentInput);await mkdir(path.dirname(parentPath),{recursive:true});await writeFile(parentPath,parentRaw);
 const compiled=compileCountryDirectory(parent,parentRaw,parent,parentRaw,'e'.repeat(64));const publishedParent=await publishCountryDirectory(compiled,path.join(root,'.cache/world-build/output/country-inventory'),path.join(root,'.cache/world-build')),parentManifestHash=publishedParent.manifestHash;
 const admin1={type:'FeatureCollection',features:[
  {type:'Feature',id:'adm1-gh',properties:{ne_id:options.stringKey?'101':101,adm0_a3:'GHA',name:'Fixture district',type:'Province',type_en:'Province',gadm_level:1},geometry:{type:'Polygon',coordinates:[ring(-2.7),[[-2.6,.1],[-2.5,.1],[-2.5,.2],[-2.6,.2],[-2.6,.1]]]}},
  {type:'Feature',id:'adm1-ng',properties:{ne_id:15901,adm0_a3:'NGA',name:'Protected fixture'},geometry:{type:'Polygon',coordinates:[ring(3.2)]}},
 ]};
 const raw=Buffer.from(JSON.stringify(admin1)),record=source('natural-earth-admin1-10m','admin1',raw),sourceInput=`.cache/world-build/admin1-source-cache/${sha(raw)}.geojson`,sourcePath=path.join(root,sourceInput);await mkdir(path.dirname(sourcePath),{recursive:true});await writeFile(sourcePath,raw);
 const sourcePin:Admin1SourcePin={schemaVersion:1,source:record,input:sourceInput,gitBlobSha1:blob(raw)},parentPin:Admin1ParentPin={manifestHash:parentManifestHash,directoryRoot:'.cache/world-build/output/country-inventory',source:parent,input:parentInput};
 const inspected=await inspectAdmin1Source({repositoryRoot:root,sourcePin,parentPin});
 return{root,sourcePin,parentPin,inspected,cleanup:()=>rm(root,{recursive:true,force:true})};
}
async function publish(f:Awaited<ReturnType<typeof fixture>>,options:Partial<Parameters<typeof publishAdmin1Source>[0]>={}){return publishAdmin1Source({repositoryRoot:f.root,sourcePin:f.sourcePin,parentPin:f.parentPin,inspectionHash:f.inspected.reportHash,inspectionPath:path.relative(f.root,f.inspected.reportPath),...options});}
async function readManifest(result:Awaited<ReturnType<typeof publishAdmin1Source>>){return JSON.parse(await readFile(result.manifestPath,'utf8')) as {sourceUnits:number;emittedUnits:number;protected:number;exceptionUnits:number;partitions:Array<{path:string;sha256:string;bytes:number}>;inspection:{path:string;sha256:string;bytes:number};globalIndex:{path:string;sha256:string;bytes:number};countries:Array<{countryId:string;status:string;sourceUnits:number;emittedUnits:number;index:{path:string;sha256:string;bytes:number}|null}>};}
async function fileSizes(root:string):Promise<number[]>{const output:number[]=[];for(const item of await readdir(root,{withFileTypes:true})){const target=path.join(root,item.name);if(item.isDirectory())output.push(...await fileSizes(target));else output.push((await stat(target)).size);}return output;}

test('publishes deterministic manifest-last product and verifies all retained source bindings, including string NE_ID keys',async()=>{
 const f=await fixture({stringKey:true});try{
  const first=await publish(f),second=await publish(f);assert.equal(first.networkBytes,0);assert.equal(first.manifestHash,second.manifestHash);assert.equal(first.bytes,second.bytes);assert.equal(first.sourceUnits,2);assert.equal(first.emittedUnits,1);assert.equal(first.partitions,1);
  const manifest=await readManifest(first);assert.equal(manifest.sourceUnits,2);assert.equal(manifest.emittedUnits,1);assert.equal(manifest.protected,1);assert.equal(manifest.exceptionUnits,1);assert.equal(manifest.countries.filter(row=>row.status==='protected').length,1);assert.equal(manifest.countries.find(row=>row.countryId==='legacy-ng')?.index,null);
  for(const ref of [manifest.inspection,manifest.globalIndex,...manifest.partitions,...manifest.countries.flatMap(row=>row.index?[row.index]:[])]){const bytes=await readFile(path.join(f.root,'.cache/world-build/output/admin1-foundation',ref.path));assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);}
  const part=JSON.parse(await readFile(path.join(f.root,'.cache/world-build/output/admin1-foundation',manifest.partitions[0]!.path),'utf8')) as {features:Array<{properties:Record<string,unknown>;geometry:{coordinates:unknown[]}}>};assert.equal(part.features.length,1);assert.equal(part.features[0]!.geometry.coordinates.length,2);assert.equal(part.features[0]!.properties.name,'Fixture district');
  const countryRef=manifest.countries.find(row=>row.countryId!=='legacy-ng'&&row.index)?.index;assert.ok(countryRef);const country=JSON.parse(await readFile(path.join(f.root,'.cache/world-build/output/admin1-foundation',countryRef!.path),'utf8')) as {rows:Array<{name:string;sourceType:string;sourceTypeEn:string;gadmLevel:number;featureSha256:string;sourceOrdinal:number}>};assert.deepEqual(country.rows.map(row=>[row.name,row.sourceType,row.sourceTypeEn,row.gadmLevel]),[['Fixture district','Province','Province',1]]);assert.equal(country.rows[0]!.sourceOrdinal,0);assert.match(country.rows[0]!.featureSha256,/^[a-f0-9]{64}$/);
 }finally{await f.cleanup();}
});

test('an interrupted asset publication leaves no manifest and resumes through verified immutable assets',async()=>{
 const f=await fixture();try{
  const controller=new AbortController();let written=0;await assert.rejects(publish(f,{signal:controller.signal,onAssetWritten:()=>{if(++written===1)controller.abort(new Error('fixture interruption'));}}),/fixture interruption/);
  const out=path.join(f.root,'.cache/world-build/output/admin1-foundation');await assert.rejects(readdir(path.join(out,'manifests')),{code:'ENOENT'});
  const audit=path.join(f.root,'.cache/world-build/admin1-publish-attempts'),records=await readdir(audit);assert.equal(records.length,1);assert.equal((JSON.parse(await readFile(path.join(audit,records[0]!),'utf8')) as {status:string}).status,'aborted');
  const resumed=await publish(f);assert.equal(resumed.manifestHash.length,64);assert.equal(resumed.emittedUnits,1);assert.ok(written>=1);
 }finally{await f.cleanup();}
});

test('aborts a live planning worker, writes terminal audit, and releases the shared lock before retry',async()=>{
 const f=await fixture();try{
  const controller=new AbortController();let online=false;await assert.rejects(publish(f,{signal:controller.signal,onWorkerOnline:()=>{online=true;controller.abort(new Error('cancel active Admin1 worker'));}}),/cancel active Admin1 worker/);assert.equal(online,true);
  const audit=path.join(f.root,'.cache/world-build/admin1-publish-attempts'),files=await readdir(audit);assert.equal(files.length,1);assert.equal((JSON.parse(await readFile(path.join(audit,files[0]!),'utf8')) as {status:string}).status,'aborted');
  const lock=path.join(f.root,'.cache/world-build/.acquisition-build.lock');await assert.rejects(import('node:fs/promises').then(fs=>fs.lstat(lock)),{code:'ENOENT'});
  const retry=await publish(f);assert.equal(retry.networkBytes,0);assert.equal(retry.emittedUnits,1);
 }finally{await f.cleanup();}
});

test('fails closed on hash-corrupted attempt history before starting another worker',async()=>{
 const f=await fixture();try{
  const controller=new AbortController();await assert.rejects(publish(f,{signal:controller.signal,onWorkerOnline:()=>controller.abort(new Error('seed attempt'))}),/seed attempt/);
  const audit=path.join(f.root,'.cache/world-build/admin1-publish-attempts'),files=await readdir(audit),file=path.join(audit,files[0]!);const record=JSON.parse(await readFile(file,'utf8')) as Record<string,unknown>;record.requestHash='0'.repeat(64);await writeFile(file,`${canonical(record)}\n`);
  let launched=false;await assert.rejects(publish(f,{onWorkerOnline:()=>{launched=true;}}),/request payload hash/);assert.equal(launched,false);
 }finally{await f.cleanup();}
});

test('rejects worker entries that have neither a geometry path nor an explicit exception',async()=>{
 const f=await fixture();try{
  await assert.rejects(publish(f,{onWorkerOutputForTest:(value)=>{const output=value as {entries:Array<{partitionPath:string|null;exception:string|null}>};const row=output.entries.find(entry=>entry.partitionPath!==null)!;row.partitionPath=null;row.exception=null;}}),/path\/exception assignment/);
  const audit=path.join(f.root,'.cache/world-build/admin1-publish-attempts'),files=await readdir(audit);assert.equal(files.length,1);assert.equal((JSON.parse(await readFile(path.join(audit,files[0]!),'utf8')) as {status:string}).status,'failed');
 }finally{await f.cleanup();}
});

test('rejects report-path rebinding and damaged immutable output collisions',async()=>{
 const f=await fixture();try{
  await assert.rejects(publish(f,{inspectionPath:`.cache/world-build/admin1-inspections/reports/${'0'.repeat(64)}/${f.inspected.reportHash}.json`}),/request identity/);
  const result=await publish(f),manifest=await readManifest(result),output=path.join(f.root,'.cache/world-build/output/admin1-foundation'),partitionPath=path.join(output,manifest.partitions[0]!.path);await writeFile(partitionPath,Buffer.alloc(manifest.partitions[0]!.bytes,0x5a));
  await assert.rejects(publish(f),/immutable output collision has different content/);
  await truncate(partitionPath,manifest.partitions[0]!.bytes+1);await assert.rejects(publish(f),/different byte length/);
 }finally{await f.cleanup();}
});

test('rejects symlinked publication output and excessive duration before worker launch',async()=>{
 const f=await fixture(),outside=await mkdtemp(path.join(await realpath(os.tmpdir()),'admin1-publish-outside-'));try{
  const output=path.join(f.root,'.cache/world-build/output/admin1-foundation');await mkdir(path.dirname(output),{recursive:true});await symlink(outside,output);
  await assert.rejects(publish(f),/symlink|unsafe|directory/);
  await rm(output);await assert.rejects(publish(f,{durationMs:120_001}),/duration/);
 }finally{await f.cleanup();await rm(outside,{recursive:true,force:true});}
});

test('enforces output-tree and lifetime attempt bounds in isolated state',async()=>{
 const f=await fixture();try{
  const output=path.join(f.root,'.cache/world-build/output/admin1-foundation');await mkdir(output,{recursive:true});const oversized=path.join(output,'reserve.bin');await writeFile(oversized,Buffer.alloc(0));await truncate(oversized,128*1024*1024+1);
  await assert.rejects(publish(f),/output tree exceeds byte cap/);assert.equal((await readdir(output)).length,1);await rm(oversized);
  const controllerRows=[] as AbortController[];
  for(let attempt=0;attempt<8;attempt++){const controller=new AbortController();controllerRows.push(controller);await assert.rejects(publish(f,{signal:controller.signal,onWorkerOnline:()=>controller.abort(new Error(`bounded attempt ${attempt+1}`))}),/bounded attempt/);}
  let launched=false;await assert.rejects(publish(f,{onWorkerOnline:()=>{launched=true;}}),/eight lifetime attempts/);assert.equal(launched,false);
  const records=await readdir(path.join(f.root,'.cache/world-build/admin1-publish-attempts'));assert.equal(records.length,8);
 }finally{await f.cleanup();}
});

test('reserves temporary asset bytes and entry while reusing a complete product',async()=>{
 const f=await fixture();try{
  const result=await publish(f),output=path.join(f.root,'.cache/world-build/output/admin1-foundation'),sizes=await fileSizes(output),current=sizes.reduce((sum,size)=>sum+size,0),scratch=Math.max(...sizes);const fill=128*1024*1024-current-scratch+1;assert.ok(fill>0);const filler=path.join(output,'reserve.bin');await writeFile(filler,Buffer.alloc(0));await truncate(filler,fill);
  await assert.rejects(publish(f),/temporary-file headroom/);assert.equal((await readFile(result.manifestPath)).length>0,true);
 }finally{await f.cleanup();}
});
