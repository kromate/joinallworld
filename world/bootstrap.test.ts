import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,realpath,rm,writeFile,readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootstrapInventory } from './bootstrap.ts';
import { sha256 } from './pack.ts';

test('bootstrap fetches pinned bytes once, resumes without network, and quarantines corrupt source',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'world-bootstrap-'));
 try{
  const root=await realpath(temp),input=path.join(root,'sources','pinned.geojson');
  const bytes=Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{NE_ID:1,ADMIN:'Testland',ISO_A2_EH:'ZZ',CONTINENT:'Africa'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}]}));
  const pin={schemaVersion:1,source:{id:'ne-pinned',url:'https://example.org/pinned.geojson',release:'frozen',license:'Public-domain',attribution:'Natural Earth',sha256:sha256(bytes),bytes:bytes.length},input,sourceFeatureCount:1,resolutionLimitations:['Fixture is not global coverage']};
  let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response(bytes);};
  const first=await bootstrapInventory(pin,root,root,fetcher),again=await bootstrapInventory(pin,root,root,fetcher);
  assert.equal(calls,1);assert.equal(first.manifestHash,again.manifestHash);assert.equal(again.networkBytes,0);
  await writeFile(input,'corrupted');
  const repaired=await bootstrapInventory(pin,root,root,fetcher);
  assert.equal(calls,2);assert.equal(repaired.manifestHash,first.manifestHash);assert.equal((await readdir(path.join(root,'source-quarantine'))).length,1);
  await assert.rejects(bootstrapInventory({...pin,input:path.join(root,'..','escape.geojson')},root,root,fetcher),/within builder root/);
  await assert.rejects(bootstrapInventory({...pin,sourceFeatureCount:2},root,root,fetcher),/denominator/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
