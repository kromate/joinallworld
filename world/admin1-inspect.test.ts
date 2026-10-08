import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectAdmin1Source } from './admin1-inspect.ts';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import type { Admin1ParentPin, Admin1SourcePin } from './admin1-types.ts';

const release='ca96624a56bd078437bca8184e78163e5039ad19';
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const blob=(bytes:Uint8Array)=>createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
function source(id:string,url:string,bytes:Uint8Array){return{id,url,release,license:'Public-domain',attribution:'Natural Earth',sha256:hash(bytes),bytes:bytes.byteLength};}
async function fixture(){
  const tempRoot=await realpath(os.tmpdir()), repositoryRoot=await mkdtemp(path.join(tempRoot,'admin1-inspect-'));
  const sourceBytes=Buffer.from('{"type":"FeatureCollection","features":[]}');
  const parentBytes=Buffer.from('{"type":"FeatureCollection","features":[]}');
  const sourceRecord=source('natural-earth-admin1-10m',`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_1_states_provinces.geojson`,sourceBytes);
  const parentRecord=source('natural-earth-admin0-10m',`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_0_countries.geojson`,parentBytes);
  const sourceInput=`.cache/world-build/admin1-source-cache/${'a'.repeat(64)}.geojson`;
  const parentInput=`.cache/world-build/country-source-cache/${'b'.repeat(64)}.geojson`;
  await mkdir(path.dirname(path.join(repositoryRoot,sourceInput)),{recursive:true}); await mkdir(path.dirname(path.join(repositoryRoot,parentInput)),{recursive:true});
  await writeFile(path.join(repositoryRoot,sourceInput),sourceBytes); await writeFile(path.join(repositoryRoot,parentInput),parentBytes);
  const sourcePin:Admin1SourcePin={schemaVersion:1,source:sourceRecord,input:sourceInput,gitBlobSha1:blob(sourceBytes)};
  const parentPin:Admin1ParentPin={manifestHash:'c'.repeat(64),directoryRoot:'.cache/world-build/output/country-inventory',source:parentRecord,input:parentInput};
  return{repositoryRoot,sourceBytes,sourcePin,parentPin,cleanup:()=>rm(repositoryRoot,{recursive:true,force:true})};
}
async function completeFixture(f:Awaited<ReturnType<typeof fixture>>){
  const ring=(west:number)=>[[west,0],[west+1,0],[west+1,1],[west,1],[west,0]];
  const admin0={type:'FeatureCollection',features:[
    {type:'Feature',id:'ng',properties:{NE_ID:1,ADM0_A3:'NGA',ISO_A2_EH:'NG',ADMIN:'Nigeria',CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[ring(0)]}},
    {type:'Feature',id:'gh',properties:{NE_ID:2,ADM0_A3:'GHA',ISO_A2_EH:'GH',ADMIN:'Ghana',CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[ring(2)]}},
  ]};
  const admin0Bytes=Buffer.from(JSON.stringify(admin0));
  const parentSource=source('natural-earth-admin0-10m',`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_0_countries.geojson`,admin0Bytes);
  f.parentPin.source=parentSource;
  const parentInput=`.cache/world-build/country-source-cache/${'d'.repeat(64)}.geojson`;
  f.parentPin.input=parentInput;
  await mkdir(path.dirname(path.join(f.repositoryRoot,parentInput)),{recursive:true}); await writeFile(path.join(f.repositoryRoot,parentInput),admin0Bytes);
  const compiled=compileCountryDirectory(parentSource,admin0Bytes,parentSource,admin0Bytes,'e'.repeat(64));
  await publishCountryDirectory(compiled,path.join(f.repositoryRoot,'.cache/world-build/output/country-inventory'),path.join(f.repositoryRoot,'.cache/world-build'));
  const admin1={type:'FeatureCollection',features:[{type:'Feature',id:'district-1',properties:{ne_id:101,adm0_a3:'GHA'},geometry:{type:'Polygon',coordinates:[ring(2.2)]}}]};
  const admin1Bytes=Buffer.from(JSON.stringify(admin1));
  const admin1Source=source('natural-earth-admin1-10m',`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_1_states_provinces.geojson`,admin1Bytes);
  const admin1Input=`.cache/world-build/admin1-source-cache/${'f'.repeat(64)}.geojson`;
  await mkdir(path.dirname(path.join(f.repositoryRoot,admin1Input)),{recursive:true}); await writeFile(path.join(f.repositoryRoot,admin1Input),admin1Bytes);
  f.sourcePin.source=admin1Source; f.sourcePin.input=admin1Input; f.sourcePin.gitBlobSha1=blob(admin1Bytes);
  f.parentPin.manifestHash=compiled.manifestHash;
}

test('rejects damaged pinned Admin1 source before creating inspection outputs',async()=>{
  const f=await fixture();
  try{
    await writeFile(path.join(f.repositoryRoot,f.sourcePin.input),'tampered');
    await assert.rejects(inspectAdmin1Source(f),/Admin1 source bytes differ/);
    await assert.rejects(import('node:fs/promises').then(fs=>fs.lstat(path.join(f.repositoryRoot,'.cache/world-build/admin1-inspections'))),{code:'ENOENT'});
  }finally{await f.cleanup();}
});

test('rejects symlinked source-cache ancestors before opening source bytes',async()=>{
  const f=await fixture(), outside=await mkdtemp(path.join(await realpath(os.tmpdir()),'admin1-outside-'));
  try{
    await rm(path.join(f.repositoryRoot,'.cache/world-build/admin1-source-cache'),{recursive:true,force:true});
    await symlink(outside,path.join(f.repositoryRoot,'.cache/world-build/admin1-source-cache'));
    await assert.rejects(inspectAdmin1Source(f),/symlink|unsafe ancestor/);
  }finally{await f.cleanup();await rm(outside,{recursive:true,force:true});}
});

test('honors an already-aborted signal before taking the shared build lock',async()=>{
  const f=await fixture(),controller=new AbortController(); controller.abort(new Error('fixture cancelled'));
  try{
    await assert.rejects(inspectAdmin1Source({...f,signal:controller.signal}),/fixture cancelled/);
    await assert.rejects(import('node:fs/promises').then(fs=>fs.lstat(path.join(f.repositoryRoot,'.cache/world-build/.acquisition-build.lock'))),{code:'ENOENT'});
  }finally{await f.cleanup();}
});

test('bounds inspection deadlines to two minutes',async()=>{
  const f=await fixture();
  try{await assert.rejects(inspectAdmin1Source({...f,durationMs:120_001}),/duration must be/);}
  finally{await f.cleanup();}
});

test('supervises a synthetic inspection and reuses identical immutable report bytes',async()=>{
  const f=await fixture();
  try{
    await completeFixture(f);
    const first=await inspectAdmin1Source(f), second=await inspectAdmin1Source(f);
    assert.equal(first.networkBytes,0); assert.equal(first.reportHash,second.reportHash);
    assert.equal(first.reportPath,second.reportPath); assert.equal(first.report.linked,1); assert.equal(first.report.protected,0);
    assert.equal(first.report.rows[0]?.sourceKey,'NE_ID:101');
  }finally{await f.cleanup();}
});

test('aborts a running worker, waits for teardown, records failure, and releases the build lock',async()=>{
  const f=await fixture(),controller=new AbortController(); let workerOnline=false;
  try{
    await completeFixture(f);
    await assert.rejects(inspectAdmin1Source({...f,signal:controller.signal,onWorkerOnline:()=>{workerOnline=true;controller.abort(new Error('abort active inspection worker'));}}),/abort active inspection worker/);
    assert.equal(workerOnline,true);
    await assert.rejects(import('node:fs/promises').then(fs=>fs.lstat(path.join(f.repositoryRoot,'.cache/world-build/.acquisition-build.lock'))),{code:'ENOENT'});
    const attempts=await import('node:fs/promises').then(fs=>fs.readdir(path.join(f.repositoryRoot,'.cache/world-build/admin1-inspections/attempts')));
    assert.equal(attempts.length,1);
    const audit=JSON.parse(await import('node:fs/promises').then(fs=>fs.readFile(path.join(f.repositoryRoot,'.cache/world-build/admin1-inspections/attempts',attempts[0]!), 'utf8'))) as {status:string};
    assert.equal(audit.status,'aborted');
    const retry=await inspectAdmin1Source(f);
    assert.equal(retry.networkBytes,0);
  }finally{await f.cleanup();}
});

test('rejects report-tree quota before creating an attempt record and preserves existing bytes',async()=>{
  const f=await fixture();
  try{
    await completeFixture(f);
    const reserve=path.join(f.repositoryRoot,'.cache/world-build/admin1-inspections/reports/reserve.bin');
    await mkdir(path.dirname(reserve),{recursive:true}); const preserved=Buffer.alloc(6*1024*1024,0x5a); await writeFile(reserve,preserved);
    await assert.rejects(inspectAdmin1Source(f),/report tree lacks reserved bounded capacity/);
    assert.deepEqual(await import('node:fs/promises').then(fs=>fs.readFile(reserve)),preserved);
    await assert.rejects(import('node:fs/promises').then(fs=>fs.lstat(path.join(f.repositoryRoot,'.cache/world-build/admin1-inspections/attempts'))),{code:'ENOENT'});
  }finally{await f.cleanup();}
});
