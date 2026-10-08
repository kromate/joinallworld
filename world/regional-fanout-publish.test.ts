import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishRegionalFanout } from './regional-fanout-publish.ts';
import { canonicalJson } from './pack.ts';
import { validateAcquisitionRequest } from './acquire.ts';
import type { RegionalFanoutRequest } from './regional-fanout-types.ts';

const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
function fixtureGeo():Buffer{
  const feature={type:'Feature',id:'building-1',properties:{building:'yes',height:'7'},geometry:{type:'Polygon',coordinates:[[[0.1,0.1],[0.2,0.1],[0.2,0.2],[0.1,0.2],[0.1,0.1]]]}};
  return Buffer.from(`${canonicalJson({type:'FeatureCollection',features:[feature],metadata:{sourceNote:'synthetic fixture only'}})}\n`);
}
async function setup(){
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'regional-fanout-publish-'));
  const input=path.join(root,'parent.geojson'),bytes=fixtureGeo();await writeFile(input,bytes);
  const digest=sha(bytes),source={id:'synthetic-source',url:'https://example.invalid/fixture.geojson',release:'fixture-1',license:'synthetic-only',attribution:'synthetic test fixture',sha256:digest,bytes:bytes.byteLength};
  const parent={region:{id:'country-gh',parentId:null,name:'Synthetic Ghana',kind:'country' as const,countryCode:'GH',timezone:'Africa/Accra',bounds:[0,0,1,1] as [number,number,number,number]},source,input:{path:input,sha256:digest,bytes:bytes.byteLength}};
  const request:RegionalFanoutRequest={schemaVersion:1,id:'synthetic-fanout',inventoryHash:'a'.repeat(64),inventoryUnitId:'country-gh',parentPlan:parent,parentAcquisition:null,children:[{id:'cell-a',parentId:'country-gh',name:'Synthetic cell A',kind:'cell',countryCode:'GH',timezone:'Africa/Accra',bounds:[0,0,0.5,0.5]}],limits:{inputBytes:1_000_000,features:10,coordinates:100,children:2,outputBytes:1_000_000}};
  return {root,request,bytes,outputRoot:path.join(root,'regional-fanout',request.id)};
}
const options=(root:string,outputRoot:string,extra:Partial<{durationMs:number;memoryMb:number;signal:AbortSignal}>={})=>({allowedRoot:root,outputRoot,durationMs:10_000,memoryMb:128,...extra});

test('publishes derived child input then index and deterministically verifies cache on repeat',async()=>{
  const f=await setup();try{
    const first=await publishRegionalFanout(f.request,options(f.root,f.outputRoot));
    assert.equal(first.networkBytes,0);assert.equal(first.indexHash,sha(await readFile(first.indexPath)));
    assert.equal(first.indexPath,path.join(f.outputRoot,'indices',`${first.indexHash}.json`));
    assert.equal(first.publication.path,path.join(f.outputRoot,'publications',`${first.index.requestHash}.json`));
    assert.equal(first.publication.sha256,sha(await readFile(first.publication.path)));
    assert.equal(first.plans.length,1);assert.equal(first.plans[0]!.input.path,path.join(f.outputRoot,...first.index.cells[0]!.input.path.split('/')));
    const child=await readFile(path.join(f.outputRoot,...first.index.cells[0]!.input.path.split('/')),'utf8');
    const parsed=JSON.parse(child) as {metadata:{regionalFanout:{requestHash:string}}};assert.equal(parsed.metadata.regionalFanout.requestHash,first.index.requestHash);
    const second=await publishRegionalFanout(f.request,options(f.root,f.outputRoot));assert.equal(second.indexHash,first.indexHash);assert.equal(second.logicalBytes,first.logicalBytes);assert.equal(second.networkBytes,0);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('fails closed when a published child input is missing or corrupt',async()=>{
  const f=await setup();try{
    const published=await publishRegionalFanout(f.request,options(f.root,f.outputRoot));const inputPath=path.join(f.outputRoot,...published.index.cells[0]!.input.path.split('/'));
    await writeFile(inputPath,'{}');await assert.rejects(publishRegionalFanout(f.request,options(f.root,f.outputRoot)),/corrupt child input|immutable collision/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('resumes verified content-addressed child assets when index publication was interrupted',async()=>{
  const f=await setup();try{
    const compiled=await import('./regional-fanout.ts').then(m=>m.compileRegionalFanout(f.request,f.bytes));
    await mkdir(path.join(f.outputRoot,'inputs'),{recursive:true});await writeFile(path.join(f.outputRoot,compiled.inputs[0]!.ref.path),compiled.inputs[0]!.bytes);
    const result=await publishRegionalFanout(f.request,options(f.root,f.outputRoot));assert.equal(result.indexHash,compiled.indexHash);assert.equal(sha(await readFile(result.indexPath)),compiled.indexHash);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('finishes a verified index that exists without its completion receipt',async()=>{
  const f=await setup();try{
    const compiled=await import('./regional-fanout.ts').then(m=>m.compileRegionalFanout(f.request,f.bytes));
    for(const item of compiled.inputs){const target=path.join(f.outputRoot,item.ref.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,item.bytes);}
    const indexPath=path.join(f.outputRoot,'indices',`${compiled.indexHash}.json`);await mkdir(path.dirname(indexPath),{recursive:true});await writeFile(indexPath,compiled.indexBytes);
    const result=await publishRegionalFanout(f.request,options(f.root,f.outputRoot));assert.equal(result.indexHash,compiled.indexHash);assert.equal(sha(await readFile(result.publication.path)),result.publication.sha256);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('rejects changed parent pins and hostile output symlinks before publication',async()=>{
  const f=await setup();try{
    const altered={...f.request,parentPlan:{...f.request.parentPlan,input:{...f.request.parentPlan.input,sha256:'b'.repeat(64)}}};
    await assert.rejects(publishRegionalFanout(altered,options(f.root,f.outputRoot)),/source and input pins|SHA-256/);
    await mkdir(path.dirname(f.outputRoot),{recursive:true});const outside=path.join(f.root,'outside');await mkdir(outside);await symlink(outside,f.outputRoot);
    await assert.rejects(publishRegionalFanout(f.request,options(f.root,f.outputRoot)),/symlink/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('rejects missing published children without rewriting the index',async()=>{
  const f=await setup();try{
    const published=await publishRegionalFanout(f.request,options(f.root,f.outputRoot));const inputPath=path.join(f.outputRoot,...published.index.cells[0]!.input.path.split('/'));
    await rm(inputPath);const before=await readFile(published.indexPath);await assert.rejects(publishRegionalFanout(f.request,options(f.root,f.outputRoot)),/missing child input/);assert.deepEqual(await readFile(published.indexPath),before);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('verifies optional acquisition receipt and raw-extraction association',async()=>{
  const f=await setup();try{
    const parentRegion=f.request.parentPlan.region;
    const acquisition=validateAcquisitionRequest({schemaVersion:1,id:'synthetic-parent-acquisition',inventoryUnitId:'country-gh',provider:'overture',release:'2026-09-23.1',region:parentRegion,layers:['buildings','roads'],limits:{networkBytes:1_000_000,outputBytes:1_000_000,features:100, durationMs:60_000,memoryMb:1024,diskBytes:64_000_000}});
    const requestHash='c'.repeat(64),completedAt='2026-10-01T00:00:00.000Z';
    const selection={schemaVersion:acquisition.schemaVersion,id:acquisition.id,inventoryUnitId:acquisition.inventoryUnitId,region:acquisition.region,provider:acquisition.provider,release:acquisition.release,layers:acquisition.layers};
    const sources=acquisition.layers.map(layer=>({id:`overture-${acquisition.release}-${layer}`,url:layer==='buildings'?`https://stac.overturemaps.org/${acquisition.release}/buildings/building/collection.json`:`https://stac.overturemaps.org/${acquisition.release}/transportation/segment/collection.json`,release:acquisition.release,license:'ODbL-1.0',attribution:`Synthetic ${layer} attribution https://docs.overturemaps.org/attribution/`,sha256:layer==='buildings'?'a'.repeat(64):'b'.repeat(64),bytes:1}));
    const bytes=Buffer.from(`${canonicalJson({type:'FeatureCollection',features:[],metadata:{requestHash,fixture:'synthetic only'}})}\n`);await writeFile(f.request.parentPlan.input.path,bytes);const inputHash=sha(bytes);
    const source={...f.request.parentPlan.source,id:`overture-${acquisition.release}-${acquisition.layers.join('-')}`,url:`https://stac.overturemaps.org/${acquisition.release}/catalog.json`,release:acquisition.release,license:[...new Set(sources.map(row=>row.license))].sort().join(' + '),attribution:[...new Set(sources.map(row=>row.attribution))].sort().join('; '),sha256:inputHash,bytes:bytes.byteLength};
    const receipt={schemaVersion:1,requestHash,selection,request:acquisition,completedAt,inputSha256:inputHash,inputBytes:bytes.byteLength,metrics:{networkBytes:0,outputBytes:bytes.byteLength,features:0,elapsedMs:1},upstream:[],sources,exceptions:[]};
    const receiptPath=path.join(f.root,'receipt.json'),receiptBytes=Buffer.from(JSON.stringify(receipt));await writeFile(receiptPath,receiptBytes);
    const bound:RegionalFanoutRequest={...f.request,parentPlan:{...f.request.parentPlan,source,input:{...f.request.parentPlan.input,sha256:inputHash,bytes:bytes.byteLength},rawExtraction:{url:`overture:${acquisition.release}/${requestHash}`,fetched:completedAt,sha256:inputHash,bytes:bytes.byteLength}},parentAcquisition:{requestHash,receipt:{path:receiptPath,sha256:sha(receiptBytes),bytes:receiptBytes.byteLength}}};
    const built=await publishRegionalFanout(bound,options(f.root,f.outputRoot));assert.equal(built.networkBytes,0);
    const mismatch={...bound,parentPlan:{...bound.parentPlan,rawExtraction:{...bound.parentPlan.rawExtraction!,url:'overture:wrong'}}};
    await assert.rejects(publishRegionalFanout(mismatch,options(f.root,path.join(f.root,'regional-fanout','receipt-mismatch'))),/raw-extraction association/);
    const wrongSource={...bound,parentPlan:{...bound.parentPlan,source:{...bound.parentPlan.source,id:'synthetic-source'}}};
    await assert.rejects(publishRegionalFanout(wrongSource,options(f.root,path.join(f.root,'regional-fanout','wrong-source'))),/combined source metadata/);
    const changedBytes=Buffer.from(`${canonicalJson({type:'FeatureCollection',features:[],metadata:{requestHash:'d'.repeat(64),fixture:'synthetic only'}})}\n`),changedHash=sha(changedBytes);await writeFile(bound.parentPlan.input.path,changedBytes);
    const changedReceipt={...receipt,inputSha256:changedHash,inputBytes:changedBytes.byteLength},changedReceiptPath=path.join(f.root,'changed-receipt.json'),changedReceiptBytes=Buffer.from(JSON.stringify(changedReceipt));await writeFile(changedReceiptPath,changedReceiptBytes);
    const wrongMetadata:RegionalFanoutRequest={...bound,parentPlan:{...bound.parentPlan,source:{...bound.parentPlan.source,sha256:changedHash,bytes:changedBytes.byteLength},input:{...bound.parentPlan.input,sha256:changedHash,bytes:changedBytes.byteLength},rawExtraction:{...bound.parentPlan.rawExtraction!,sha256:changedHash,bytes:changedBytes.byteLength}},parentAcquisition:{requestHash,receipt:{path:changedReceiptPath,sha256:sha(changedReceiptBytes),bytes:changedReceiptBytes.byteLength}}};
    await assert.rejects(publishRegionalFanout(wrongMetadata,options(f.root,path.join(f.root,'regional-fanout','wrong-metadata'))),/requestHash does not match its pinned receipt/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('aborts an in-flight bounded derivation before publication and can safely retry',async()=>{
  const f=await setup();try{
    const original=JSON.parse(f.bytes.toString('utf8')) as {features:Array<Record<string,unknown>>};
    const base=original.features[0]!,features=Array.from({length:2_000},(_,i)=>({...base,id:`building-${i}`}));const bytes=Buffer.from(`${canonicalJson({type:'FeatureCollection',features,metadata:{sourceNote:'synthetic fixture only'}})}\n`);await writeFile(f.request.parentPlan.input.path,bytes);
    const digest=sha(bytes),request:RegionalFanoutRequest={...f.request,parentPlan:{...f.request.parentPlan,source:{...f.request.parentPlan.source,sha256:digest,bytes:bytes.byteLength},input:{...f.request.parentPlan.input,sha256:digest,bytes:bytes.byteLength}},limits:{...f.request.limits,features:3_000,coordinates:20_000,inputBytes:10_000_000,outputBytes:10_000_000}};
    const controller=new AbortController();const pending=publishRegionalFanout(request,options(f.root,f.outputRoot,{signal:controller.signal}));setTimeout(()=>controller.abort(new Error('fixture interruption')),10);
    await assert.rejects(pending,/fixture interruption|aborted|deadline/);
    await assert.rejects(lstat(path.join(f.outputRoot,'indices')),/ENOENT/);
    const recovered=await publishRegionalFanout(request,options(f.root,f.outputRoot));assert.equal(recovered.networkBytes,0);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('completion receipt makes a missing published index fail closed',async()=>{
  const f=await setup();try{
    const published=await publishRegionalFanout(f.request,options(f.root,f.outputRoot));
    await rm(published.indexPath);
    await assert.rejects(publishRegionalFanout(f.request,options(f.root,f.outputRoot)),/completion receipt.*missing its index/);
    await assert.rejects(lstat(published.indexPath),/ENOENT/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('rejects a rehashed but altered immutable completion receipt',async()=>{
  const f=await setup();try{
    const published=await publishRegionalFanout(f.request,options(f.root,f.outputRoot));
    const receipt=JSON.parse(await readFile(published.publication.path,'utf8')) as Record<string,unknown>;
    receipt.indexHash='f'.repeat(64);const altered=Buffer.from(`${canonicalJson(receipt)}\n`);assert.equal(altered.byteLength,published.publication.bytes);await writeFile(published.publication.path,altered);
    await assert.rejects(publishRegionalFanout(f.request,options(f.root,f.outputRoot)),/publication receipt collision or corruption/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
