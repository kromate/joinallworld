import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acquireFinePointer } from './fine-pointer-acquire.ts';
import { FINE_POINTER_LIMITS, FINE_PROMOTION_POLICY, type FinePromotionRequest } from './fine-promotion-types.ts';

const commit='a'.repeat(40), objectHash='b'.repeat(64);
const pointer=Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${objectHash}\nsize 17\n`);
function request():FinePromotionRequest{return {schemaVersion:1,policy:FINE_PROMOTION_POLICY,parent:{product:'country-directory',manifestHash:'c'.repeat(64)},catalogueHash:'d'.repeat(64),metadataSnapshot:{sha256:'e'.repeat(64),bytes:50},metadataRow:{ordinal:1,sha256:'f'.repeat(64),bytes:20},country:{id:'world:DJ',code:'DJ',iso3:'DJI',name:'Djibouti'},layer:{id:'DJI-ADM1-abc',canonicalType:'ADM1',representedYear:'2024',buildDate:'2025-01-01',expectedUnits:1},commit,pointerUrl:`https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${commit}/releaseData/gbOpen/DJI/ADM1/geoBoundaries-DJI-ADM1.geojson`};}
async function withRoot(fn:(root:string)=>Promise<void>):Promise<void>{const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'fine-pointer-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
function response(body:Uint8Array,status=200,url=request().pointerUrl,headers:Record<string,string>={}){const bytes=Buffer.from(body),r=new Response(bytes,{status,headers:{'content-length':String(bytes.length),...headers}});Object.defineProperty(r,'url',{value:url});return r;}
const opts=(root:string,fetcher:typeof fetch)=>({repositoryRoot:root,fetcher,durationMs:5_000});

test('pointer is strictly fetched once, durably cached, then returned as a verified zero-network hit',async()=>withRoot(async root=>{
  let calls=0;const fetcher=(async(input:RequestInfo|URL)=>{calls++;assert.equal(String(input),request().pointerUrl);return response(pointer,200,request().pointerUrl,{'content-length':String(pointer.length)});}) as typeof fetch;
  const first=await acquireFinePointer(request(),opts(root,fetcher));assert.equal(first.cacheHit,false);assert.equal(first.networkBytes,pointer.length);assert.deepEqual(Buffer.from(first.pointerBytes),pointer);assert.equal(calls,1);
  const second=await acquireFinePointer(request(),opts(root,(async()=>{throw new Error('cache hit attempted network');}) as typeof fetch));assert.equal(second.cacheHit,true);assert.equal(second.networkBytes,0);assert.deepEqual(Buffer.from(second.pointerBytes),pointer);
  const receipt=JSON.parse(await readFile(second.receiptPath,'utf8')) as Record<string,unknown>;assert.equal(receipt.requestHash,second.requestHash);assert.equal(receipt.pointerBytes,pointer.length);
}));

test('redirect, wrong URL and malformed LFS body fail with durable evidence and measured transfer accounting',async()=>withRoot(async root=>{
  for(const [status,url,body] of [[302,request().pointerUrl,pointer],[200,'https://raw.githubusercontent.com/elsewhere/file',pointer],[200,request().pointerUrl,Buffer.from('not an lfs pointer\n')]] as const){
    await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>response(body,status,url)) as typeof fetch)),/failure evidence:/);
  }
  const audit=await readFile(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),'utf8'),rows=audit.trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
  assert.equal(rows.filter(r=>r.event==='started').length,3);const terminals=rows.filter(r=>r.event==='finished');assert.equal(terminals.length,3);assert.equal(terminals[0]?.responseComplete,false);assert.equal(terminals[0]?.networkBytesMeasured,null);assert.equal(terminals[1]?.responseComplete,false);assert.equal(terminals[1]?.networkBytesMeasured,null);assert.equal(terminals[2]?.responseComplete,true);assert.equal(terminals[2]?.networkBytesMeasured,Buffer.byteLength('not an lfs pointer\n'));
}));

test('compressed and wrong-length responses are rejected without releasing measured bytes',async()=>withRoot(async root=>{
  const badBodies=[response(pointer,200,request().pointerUrl,{'content-length':String(pointer.length),'content-encoding':'gzip'}),response(pointer,200,request().pointerUrl,{'content-length':String(pointer.length+1)})];
  for(const bad of badBodies) await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>bad) as typeof fetch)),/failure evidence:/);
  const rows=(await readFile(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
  const finished=rows.filter(r=>r.event==='finished');assert.equal(finished[0]?.responseComplete,false);assert.equal(finished[0]?.networkBytesMeasured,null);assert.equal(finished[1]?.responseComplete,true);assert.equal(finished[1]?.networkBytesMeasured,pointer.length);assert.equal(finished[1]?.networkReservationUpperBoundBytes,pointer.length);
}));

test('orphan body restores only after LFS validation; changed body and receipt-only cache fail closed',async()=>withRoot(async root=>{
  const fetcher=(async()=>response(pointer,200,request().pointerUrl,{'content-length':String(pointer.length)})) as typeof fetch;
  const first=await acquireFinePointer(request(),opts(root,fetcher));await (await import('node:fs/promises')).unlink(first.receiptPath);
  const restored=await acquireFinePointer(request(),opts(root,(async()=>{throw new Error('must use retained body');}) as typeof fetch));assert.equal(restored.cacheHit,true);
  await writeFile(first.pointerPath,'tampered');await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>{throw new Error('must fail closed');}) as typeof fetch)),/Git LFS pointer/);
}));

test('receipt without body fails closed and malformed UTF-8 audit is not silently repaired',async()=>withRoot(async root=>{
  const result=await acquireFinePointer(request(),opts(root,(async()=>response(pointer)) as typeof fetch));await (await import('node:fs/promises')).unlink(result.pointerPath);
  await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>{throw new Error('no refetch');}) as typeof fetch)),/receipt exists without body/);
  await rm(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'));
  await writeFile(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),Buffer.from([0xff,0x0a]));
  await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>{throw new Error('no refetch');}) as typeof fetch)),/UTF-8/);
}));

test('audit rejects an interrupted record that releases its reservation',async()=>withRoot(async root=>{
  await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>{throw new Error('synthetic transport break');}) as typeof fetch)),/failure evidence:/);
  const file=path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),rows=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);const terminal=rows.find(r=>r.event==='finished')!;terminal.networkReservationUpperBoundBytes=0;await writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>{throw new Error('audit tampering must fail before fetch');}) as typeof fetch)),/releases unknown transfer reservation/);
}));

test('request wall deadline stops a fetcher that ignores abort and leaves the reservation visible',async()=>withRoot(async root=>{
  const never=new Promise<Response>(()=>{});const begin=Date.now();
  await assert.rejects(acquireFinePointer(request(),{repositoryRoot:root,durationMs:500,fetcher:(async()=>never) as typeof fetch}));assert.ok(Date.now()-begin<2_000);
  const rows=(await readFile(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
  const terminal=rows.find(r=>r.event==='finished');assert.equal(terminal?.networkBytesMeasured,null);assert.equal(terminal?.networkReservationUpperBoundBytes,FINE_POINTER_LIMITS.pointerBytes);
}));

test('hanging response reader cannot hold the operation past deadline',async()=>withRoot(async root=>{
  const stream=new ReadableStream<Uint8Array>({start(){},cancel(){return new Promise<void>(()=>{});}});
  const pending=new Response(stream,{status:200,headers:{'content-length':String(pointer.length)}});Object.defineProperty(pending,'url',{value:request().pointerUrl});
  const began=Date.now();await assert.rejects(acquireFinePointer(request(),{repositoryRoot:root,durationMs:500,fetcher:(async()=>pending) as typeof fetch}));assert.ok(Date.now()-began<2_000);
  const rows=(await readFile(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>),end=rows.find(r=>r.event==='finished');assert.equal(end?.networkBytesMeasured,null);assert.equal(end?.networkReservationUpperBoundBytes,FINE_POINTER_LIMITS.pointerBytes);
}));

test('oversize delivered chunk is measured and cannot be hidden by the nominal reservation',async()=>withRoot(async root=>{
  const large=Buffer.alloc(6_000,97),fetcher=(async()=>response(large,200,request().pointerUrl,{'content-length':String(pointer.length)})) as typeof fetch;
  await assert.rejects(acquireFinePointer(request(),opts(root,fetcher)),/failure evidence:/);
  const rows=(await readFile(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>),end=rows.find(r=>r.event==='finished');
  assert.equal(end?.responseComplete,false);assert.equal(end?.networkBytesMeasured,6_000);assert.equal(end?.networkReservationUpperBoundBytes,6_000);
  for(let i=0;i<14;i++){const failed=request();failed.country.name=`after known oversize ${i}`;await assert.rejects(acquireFinePointer(failed,opts(root,(async()=>{throw new Error('unknown transfer');}) as typeof fetch)),/failure evidence:/);}
  const next=request();next.country.name='after known oversize final';let calls=0;await assert.rejects(acquireFinePointer(next,opts(root,(async()=>{calls++;return response(pointer,200,next.pointerUrl,{'content-length':String(pointer.length)});}) as typeof fetch)),/lifetime network reservation exhausted/);assert.equal(calls,0);
}));

test('delivered chunk beyond lifetime cap is preserved in audit and blocks any further network',async()=>withRoot(async root=>{
  const large=Buffer.alloc(70_000,97);await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>response(large,200,request().pointerUrl,{'content-length':String(pointer.length)})) as typeof fetch)),/failure evidence:/);
  const rows=(await readFile(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>),end=rows.find(r=>r.event==='finished');
  assert.equal(end?.networkBytesMeasured,70_000);assert.equal(end?.networkReservationUpperBoundBytes,70_000);let calls=0;const next=request();next.country.name='after over-cap transfer';
  await assert.rejects(acquireFinePointer(next,opts(root,(async()=>{calls++;return response(pointer);}) as typeof fetch)),/lifetime network reservation exhausted/);assert.equal(calls,0);
}));

test('incomplete transport reserves the full pointer allowance and lifetime quota cannot be reset',async()=>withRoot(async root=>{
  const failing=(async()=>{throw new Error('synthetic transport failure');}) as typeof fetch;
  for(let i=0;i<FINE_POINTER_LIMITS.networkBytes/FINE_POINTER_LIMITS.pointerBytes;i++) await assert.rejects(acquireFinePointer(request(),opts(root,failing)),/failure evidence:/);
  let calls=0;await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>{calls++;return response(pointer);}) as typeof fetch)),/lifetime network reservation exhausted/);assert.equal(calls,0);
  const records=(await readFile(path.join(root,'.cache/world-build/fine-pointer-audit/attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
  assert.equal(records.filter(r=>r.event==='started').length,FINE_POINTER_LIMITS.networkBytes/FINE_POINTER_LIMITS.pointerBytes);assert.ok(records.filter(r=>r.event==='finished').every(r=>r.networkBytesMeasured===null&&r.networkReservationUpperBoundBytes===FINE_POINTER_LIMITS.pointerBytes));
}));

test('verified pointer remains readable after lifetime network allowance is consumed',async()=>withRoot(async root=>{
  await acquireFinePointer(request(),opts(root,(async()=>response(pointer,200,request().pointerUrl,{'content-length':String(pointer.length)})) as typeof fetch));
  for(let i=0;i<15;i++){
    const next=request();next.country.name=`Ghana fixture ${i}`;
    await assert.rejects(acquireFinePointer(next,opts(root,(async()=>{throw new Error('synthetic interrupted transfer');}) as typeof fetch)),/failure evidence:/);
  }
  let calls=0;const cached=await acquireFinePointer(request(),opts(root,(async()=>{calls++;throw new Error('valid cache must survive exhausted quota');}) as typeof fetch));
  assert.equal(cached.cacheHit,true);assert.equal(cached.networkBytes,0);assert.equal(calls,0);
  const exhausted=request();exhausted.country.name='one more request';
  await assert.rejects(acquireFinePointer(exhausted,opts(root,(async()=>{calls++;return response(pointer,200,exhausted.pointerUrl,{'content-length':String(pointer.length)});}) as typeof fetch)),/lifetime network reservation exhausted/);assert.equal(calls,0);
}));

test('pre-aborted request does not contact fetcher; malformed audit and unsafe cache entries fail closed',async()=>withRoot(async root=>{
  const ctrl=new AbortController();ctrl.abort(new Error('cancelled'));let calls=0;
  await assert.rejects(acquireFinePointer(request(),{repositoryRoot:root,signal:ctrl.signal,fetcher:(async()=>{calls++;return response(pointer);}) as typeof fetch}));assert.equal(calls,0);
  const auditDir=path.join(root,'.cache/world-build/fine-pointer-audit');await mkdir(auditDir,{recursive:true});await writeFile(path.join(auditDir,'attempts.jsonl'),'{broken}\n');
  await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>response(pointer)) as typeof fetch)),/audit/);
}));

test('symlink cache namespace is rejected before network',async()=>withRoot(async root=>{
  const external=await mkdtemp(path.join(await realpath(os.tmpdir()),'fine-pointer-external-'));try{
    const parent=path.join(root,'.cache/world-build');await mkdir(parent,{recursive:true});await symlink(external,path.join(parent,'fine-pointer-cache'));
    let calls=0;await assert.rejects(acquireFinePointer(request(),opts(root,(async()=>{calls++;return response(pointer);}) as typeof fetch)),/symlink|unsafe/);assert.equal(calls,0);
  }finally{await rm(external,{recursive:true,force:true});}
}));

test('concurrent callers share the build lock and only one source request',async()=>withRoot(async root=>{
  let calls=0;let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
  const fetcher=(async()=>{calls++;await wait;return response(pointer,200,request().pointerUrl,{'content-length':String(pointer.length)});}) as typeof fetch;
  const one=acquireFinePointer(request(),opts(root,fetcher));await new Promise(resolve=>setTimeout(resolve,30));const two=acquireFinePointer(request(),opts(root,fetcher));release();
  const [a,b]=await Promise.all([one,two]);assert.equal(calls,1);assert.notEqual(a.cacheHit,b.cacheHit);assert.equal(a.networkBytes+b.networkBytes,pointer.length);
}));
