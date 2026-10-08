import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireRegion, validateAcquisitionRequest, withAcquisitionBuildLock } from './acquire.ts';
import type { AcquisitionRequest } from './production-types.ts';

function request(overrides:Record<string,unknown>={}):AcquisitionRequest {
  return {
    schemaVersion:1,id:'accra-cell-1',inventoryUnitId:'country-gh',provider:'overture',release:'2026-09-23.1',
    region:{id:'accra-cell-1',parentId:'accra',name:'Accra cell 1',kind:'cell',countryCode:'GH',timezone:'Africa/Accra',bounds:[-0.207,5.552,-0.203,5.556]},
    layers:['buildings','roads'],limits:{networkBytes:2_000_000,outputBytes:2_000_000,features:10_000,durationMs:60_000,memoryMb:1024,diskBytes:64_000_000},
    ...overrides,
  } as AcquisitionRequest;
}

test('strictly accepts an explicit bounded pinned regional request',()=>{
  const valid=validateAcquisitionRequest(request());
  assert.equal(valid.release,'2026-09-23.1');
  assert.deepEqual(valid.layers,['buildings','roads']);
});

test('rejects unknown fields, Nigeria, and floating/unpinned releases',()=>{
  assert.throws(()=>validateAcquisitionRequest({...request(),sql:'select * from read_parquet(\'*\')'}),/unknown request field/);
  assert.throws(()=>validateAcquisitionRequest(request({release:'latest'})),/pinned Overture release/);
  assert.throws(()=>validateAcquisitionRequest(request({region:{...request().region,countryCode:'NG'}})),/Nigeria/);
});

test('rejects unsupported layers, malformed bounds and limits above hard caps',()=>{
  assert.throws(()=>validateAcquisitionRequest(request({layers:['places']})),/unique buildings and\/or roads/);
  assert.throws(()=>validateAcquisitionRequest(request({region:{...request().region,bounds:[0,5,0,6]}})),/outside WGS84 or empty/);
  assert.throws(()=>validateAcquisitionRequest(request({limits:{...request().limits,networkBytes:32_000_001}})),/no greater than/);
  assert.throws(()=>validateAcquisitionRequest(request({limits:{...request().limits,sql:'anything'}})),/unknown limits field/);
});

test('keeps dateline crossing bounds intact for later split selection',()=>{
  const requestValue=request({region:{...request().region,bounds:[179.8,-1,-179.8,1]}});
  assert.deepEqual(validateAcquisitionRequest(requestValue).region.bounds,[179.8,-1,-179.8,1]);
});

function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function cacheFixture(root:string) {
  const req=validateAcquisitionRequest(request());
  const sourceConfig=JSON.parse(await readFile(new URL('./acquisition-sources.json',import.meta.url),'utf8')) as unknown;
  const selection={schemaVersion:req.schemaVersion,id:req.id,inventoryUnitId:req.inventoryUnitId,region:req.region,provider:req.provider,release:req.release,layers:req.layers};
  const requestHash=createHash('sha256').update(canonical({compiler:'world-source-compiler-v2',selection,sourceConfig})).digest('hex');
  const cache=path.join(root,'acquisitions',requestHash); await mkdir(cache,{recursive:true});
  const bytes=Buffer.from('{"type":"FeatureCollection","features":[]}');
  const source=(layer:'buildings'|'roads')=>({id:`overture-${req.release}-${layer}`,url:layer==='buildings'?`https://stac.overturemaps.org/${req.release}/buildings/building/collection.json`:`https://stac.overturemaps.org/${req.release}/transportation/segment/collection.json`,release:req.release,license:'ODbL-1.0',attribution:'Overture https://docs.overturemaps.org/attribution/',sha256:'a'.repeat(64),bytes:1});
  const receipt={schemaVersion:1,requestHash,selection,request:req,completedAt:'2026-10-01T00:00:00.000Z',inputSha256:createHash('sha256').update(bytes).digest('hex'),inputBytes:bytes.byteLength,metrics:{networkBytes:0,outputBytes:bytes.byteLength,features:0,elapsedMs:1},upstream:[],sources:[source('buildings'),source('roads')],exceptions:[]};
  await writeFile(path.join(cache,'extract.geojson'),bytes); await writeFile(path.join(cache,'receipt.json'),JSON.stringify(receipt));
  return {request:req,requestHash,cache};
}

test('reuses a valid bounded cache without starting the adapter',async()=>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'acquire-cache-hit-'));
  try {
    const fixture=await cacheFixture(root);
    const result=await acquireRegion(fixture.request,{allowedRoot:root,pythonExecutable:'/missing/python3'});
    assert.equal(result.requestHash,fixture.requestHash);
    assert.deepEqual(result.upstream,[]);
    assert.equal(result.plan.input.bytes,Buffer.byteLength('{"type":"FeatureCollection","features":[]}'));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('quarantines a corrupt exact request cache and retains it after adapter failure',async()=>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'acquire-cache-corrupt-'));
  try {
    const fixture=await cacheFixture(root);
    await writeFile(path.join(fixture.cache,'extract.geojson'),'corrupt');
    await assert.rejects(acquireRegion(fixture.request,{allowedRoot:root,pythonExecutable:'/missing/python3'}));
    const names=await readdir(path.join(root,'acquisitions'));
    const quarantines=names.filter(name=>name.startsWith(`.quarantine-${fixture.requestHash}-`));
    assert.equal(quarantines.length,1);
    assert.equal(await readFile(path.join(root,'acquisitions',quarantines[0]!,'extract.geojson'),'utf8'),'corrupt');
    assert.equal(names.includes(fixture.requestHash),false);
    const events=(await readFile(path.join(root,'acquisition-attempts',fixture.requestHash,'attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events[0].status,'pending'); assert.equal(events[0].networkBytesMeasured,null); assert.equal(events[0].networkReservationUpperBoundBytes,2_000_000);
    assert.equal(events[1].status,'failure'); assert.equal(events[1].networkBytesMeasured,null); assert.equal(events[1].networkReservationUpperBoundBytes,2_000_000);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('keeps a valid cache when current output budget is too small',async()=>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'acquire-cache-budget-'));
  try {
    const fixture=await cacheFixture(root);
    await assert.rejects(acquireRegion({...fixture.request,limits:{...fixture.request.limits,outputBytes:1}},{allowedRoot:root,pythonExecutable:'/missing/python3'}),/current output byte budget; cache retained/);
    assert.equal((await readFile(path.join(fixture.cache,'extract.geojson'))).byteLength,Buffer.byteLength('{"type":"FeatureCollection","features":[]}'));
    assert.deepEqual((await readdir(path.join(root,'acquisitions'))).filter(name=>name.startsWith('.quarantine-')),[]);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('preserves a pending attempt record and continues numbering on a cache resume',async()=>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'acquire-attempt-resume-'));
  try {
    const fixture=await cacheFixture(root), directory=path.join(root,'acquisition-attempts',fixture.requestHash);
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'attempts.jsonl'),JSON.stringify({schemaVersion:1,requestHash:fixture.requestHash,attempt:1,event:'started',status:'pending',startedAt:'2026-10-08T00:00:00.000Z',selection:{id:fixture.request.id},caps:{networkBytes:2_000_000,diskBytes:64_000_000,durationMs:60_000},networkBytesMeasured:null,networkReservationUpperBoundBytes:2_000_000})+'\n');
    await acquireRegion(fixture.request,{allowedRoot:root,pythonExecutable:'/missing/python3'});
    const events=(await readFile(path.join(directory,'attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events[0].status,'pending'); assert.equal(events[0].networkBytesMeasured,null);
    assert.equal(events[1].attempt,2); assert.equal(events[1].event,'started'); assert.equal(events[1].status,'pending');
    assert.equal(events[2].attempt,2); assert.equal(events[2].status,'cache-hit');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('refuses malformed or truncated attempt evidence without altering it',async()=>{
  for(const [original,pattern] of [['not-json','truncated record'],['not-json\n','corrupt record'],[' '.repeat(16_001)+'\n','record exceeds its size limit'],['x'.repeat(1_000_001),'over limit']] as const){
    const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'acquire-attempt-corrupt-'));
    try {
      const fixture=await cacheFixture(root), directory=path.join(root,'acquisition-attempts',fixture.requestHash);
      await mkdir(directory,{recursive:true});
      const log=path.join(directory,'attempts.jsonl'); await writeFile(log,original);
      await assert.rejects(acquireRegion(fixture.request,{allowedRoot:root,pythonExecutable:'/missing/python3'}),new RegExp(pattern));
      assert.equal(await readFile(log,'utf8'),original);
    } finally { await rm(root,{recursive:true,force:true}); }
  }
});

test('rejects a symlinked allowedRoot ancestor before creating through it',async()=>{
  const parent=await mkdtemp(path.join(await realpath(os.tmpdir()),'acquire-path-guard-'));
  const target=path.join(parent,'outside'); await mkdir(target);
  const link=path.join(parent,'linked'); await symlink(target,link);
  try {
    await assert.rejects(acquireRegion(request(),{allowedRoot:path.join(link,'would-create'),pythonExecutable:'/missing/python3'}),/ancestors.*symlinks/);
    assert.deepEqual(await readdir(target),[]);
  } finally { await rm(parent,{recursive:true,force:true}); }
});

test('serializes shared build-root work and reclaims a dead owner lock',async()=>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'acquire-build-lock-'));
  try{
    let releaseFirst!:()=>void,enteredFirst!:()=>void,inside=0,maxInside=0,secondEntered=false;
    const gate=new Promise<void>(resolve=>{releaseFirst=resolve;}),firstEntered=new Promise<void>(resolve=>{enteredFirst=resolve;});
    const first=withAcquisitionBuildLock(root,async()=>{inside++;maxInside=Math.max(maxInside,inside);enteredFirst();await gate;inside--;return 'first';});
    await firstEntered;
    const second=withAcquisitionBuildLock(root,async()=>{inside++;maxInside=Math.max(maxInside,inside);secondEntered=true;inside--;return 'second';});
    await new Promise(resolve=>setTimeout(resolve,150)); assert.equal(secondEntered,false);
    releaseFirst(); assert.deepEqual(await Promise.all([first,second]),['first','second']); assert.equal(maxInside,1);
    const lock=path.join(root,'.acquisition-build.lock');
    await writeFile(lock,JSON.stringify({pid:2_147_483_647,identity:'a'.repeat(32),startedAt:'2026-10-08T00:00:00.000Z'}));
    assert.equal(await withAcquisitionBuildLock(root,async()=> 'recovered'),'recovered');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cancels a blocked lock wait without removing another live owner lock',async()=>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'acquire-build-lock-cancel-'));
  try{
    const lock=path.join(root,'.acquisition-build.lock'),record={pid:process.pid,identity:'b'.repeat(32),startedAt:new Date().toISOString()};
    await writeFile(lock,JSON.stringify(record));
    const controller=new AbortController();let called=false;
    const pending=withAcquisitionBuildLock(root,async()=>{called=true;return 'unexpected';},{signal:controller.signal,timeoutMs:5_000});
    setTimeout(()=>controller.abort(),150);
    await assert.rejects(pending,/wait aborted/);
    assert.equal(called,false);assert.deepEqual(JSON.parse(await readFile(lock,'utf8')),record);
    await assert.rejects(withAcquisitionBuildLock(root,async()=> 'unexpected',{timeoutMs:50}),/timed out waiting/);
  }finally{await rm(root,{recursive:true,force:true});}
});
