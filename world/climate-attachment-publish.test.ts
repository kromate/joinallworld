import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishClimateAttachment } from './climate-attachment-publish.ts';
import { CLIMATE_ATTACHMENT_COMPILER, CLIMATE_ATTACHMENT_LIMITS as L, CLIMATE_ATTACHMENT_POLICY, CLIMATE_ATTACHMENT_PRODUCT, type ClimateAttachmentBinding } from './climate-attachment-types.ts';
import { canonicalJson } from './pack.ts';

const WORLD=path.dirname(fileURLToPath(import.meta.url));
const REPO=path.resolve(WORLD,'..');
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function bindings():Promise<ClimateAttachmentBinding[]>{const value=JSON.parse(await readFile(path.join(WORLD,'climate-attachment-pins.json'),'utf8')) as {bindings:ClimateAttachmentBinding[]};return value.bindings;}
async function tempRepo(binding:ClimateAttachmentBinding):Promise<string>{const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'climate-attachment-')));const copy=async(rel:string)=>{const from=path.join(REPO,rel),to=path.join(root,rel);await mkdir(path.dirname(to),{recursive:true});await cp(from,to);};await copy(binding.baseManifest.path);await copy(binding.environmentManifest.path);await copy(binding.rawSource.path);const base=JSON.parse(await readFile(path.join(REPO,binding.baseManifest.path),'utf8')) as {tiles:Array<{path:string}>};for(const tile of base.tiles)await copy(`.cache/world-build/campaigns/${binding.campaignId}/output/${tile.path}`);return root;}
async function auditRows(root:string):Promise<Array<Record<string,unknown>>>{const dir=path.join(root,'.cache/world-build/climate-attachment-attempts');const names=await readdir(dir);const rows=[];for(const name of names)rows.push(JSON.parse(await readFile(path.join(dir,name),'utf8')) as Record<string,unknown>);return rows;}

test('climate attachment publishes and deterministically revalidates only in an isolated temporary repository',async()=>{
 const binding=(await bindings()).find(x=>x.id==='cape-town')!;const root=await tempRepo(binding);
 try{const first=await publishClimateAttachment({repositoryRoot:root,binding});assert.equal(first.cacheHit,false);assert.equal(first.networkBytes,0);assert.equal(first.tiles,7);assert.equal(hash(await readFile(first.manifestPath)),first.manifestHash);assert.equal(hash(await readFile(first.provenancePath)),first.provenanceHash);const second=await publishClimateAttachment({repositoryRoot:root,binding});assert.equal(second.cacheHit,true);assert.equal(second.manifestHash,first.manifestHash);assert.equal(second.provenanceHash,first.provenanceHash);assert.deepEqual((await auditRows(root)).map(x=>x.status),['succeeded']);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('a new pinned campaign request coexists with the prior immutable city product',async()=>{
 const original=(await bindings()).find(x=>x.id==='accra')!;const root=await tempRepo(original);
 try{const first=await publishClimateAttachment({repositoryRoot:root,binding:original});const originalManifest=Buffer.from(await readFile(first.manifestPath)),originalProvenance=Buffer.from(await readFile(first.provenancePath));
  const upgraded=structuredClone(original);upgraded.campaignId='representative-real-v2-next';upgraded.baseManifest.path=`.cache/world-build/campaigns/${upgraded.campaignId}/output/manifests/${upgraded.baseManifest.sha256}.json`;
  const baseBytes=await readFile(path.join(root,original.baseManifest.path));const nextBase=path.join(root,upgraded.baseManifest.path);await mkdir(path.dirname(nextBase),{recursive:true});await writeFile(nextBase,baseBytes,{flag:'wx'});
  const sourceBase=JSON.parse(baseBytes.toString('utf8')) as {tiles:Array<{path:string}>};for(const tile of sourceBase.tiles){const from=path.join(root,'.cache/world-build/campaigns',original.campaignId,'output',tile.path),to=path.join(root,'.cache/world-build/campaigns',upgraded.campaignId,'output',tile.path);await mkdir(path.dirname(to),{recursive:true});await cp(from,to);}
  const second=await publishClimateAttachment({repositoryRoot:root,binding:upgraded});assert.equal(second.cacheHit,false);assert.notEqual(second.manifestHash,first.manifestHash);assert.notEqual(second.provenanceHash,first.provenanceHash);assert.deepEqual(await readFile(first.manifestPath),originalManifest);assert.deepEqual(await readFile(first.provenancePath),originalProvenance);
  assert.equal((await publishClimateAttachment({repositoryRoot:root,binding:original})).cacheHit,true);assert.equal((await publishClimateAttachment({repositoryRoot:root,binding:upgraded})).cacheHit,true);const rows=await auditRows(root);assert.equal(rows.length,2);assert.equal(rows.filter(row=>canonicalJson(row.binding)===canonicalJson(original)).length,1);assert.equal(rows.filter(row=>canonicalJson(row.binding)===canonicalJson(upgraded)).length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an interrupted compiler start is durably charged, then cache hits remain readable at four attempts',async()=>{
 const binding=(await bindings()).find(x=>x.id==='cape-town')!;const root=await tempRepo(binding);
 try{const controller=new AbortController();await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding,signal:controller.signal,onWorkerOnline:()=>controller.abort(new Error('test worker interruption'))}));const rows=await auditRows(root);assert.equal(rows.length,1);assert.equal(rows[0]!.status,'aborted');assert.equal(rows[0]!.networkBytes,0);const first=await publishClimateAttachment({repositoryRoot:root,binding});assert.equal(first.cacheHit,false);const firstAudit=await auditRows(root);assert.equal(firstAudit.length,2);const reqHash=firstAudit[0]!.requestHash;assert.equal(typeof reqHash,'string');
  const auditDir=path.join(root,'.cache/world-build/climate-attachment-attempts');for(let i=0;i<2;i++){const attemptId=randomUUID(),record={schemaVersion:1,attemptId,requestHash:reqHash,compiler:CLIMATE_ATTACHMENT_COMPILER,policy:CLIMATE_ATTACHMENT_POLICY,binding,status:'failed',startedAt:new Date().toISOString(),networkBytes:0,finishedAt:new Date(Date.now()+1).toISOString(),error:'isolated quota fixture'};const text=`${canonicalJson(record)}\n`;assert.ok(Buffer.byteLength(text)<=L.auditRecordBytes);await writeFile(path.join(auditDir,`${attemptId}.json`),text,{flag:'wx'});}
  assert.equal((await auditRows(root)).length,L.attemptsPerRequest);const cached=await publishClimateAttachment({repositoryRoot:root,binding});assert.equal(cached.cacheHit,true);assert.equal(cached.manifestHash,first.manifestHash);assert.equal((await auditRows(root)).length,L.attemptsPerRequest);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('pre-manifest interruption after a tile or provenance resumes with a new durable attempt',async()=>{
 const binding=(await bindings()).find(x=>x.id==='cape-town')!;
 for(const phase of ['tiles/','provenance/']){const root=await tempRepo(binding);try{const controller=new AbortController();await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding,signal:controller.signal,onAssetWritten:relative=>{if(relative.startsWith(phase))controller.abort(new Error(`stop after ${phase}`));}}));const afterStop=await auditRows(root);assert.equal(afterStop.length,1);assert.equal(afterStop[0]!.status,'aborted');const resumed=await publishClimateAttachment({repositoryRoot:root,binding});assert.equal(resumed.cacheHit,false);assert.equal(hash(await readFile(resumed.manifestPath)),resumed.manifestHash);const rows=await auditRows(root);assert.deepEqual(rows.map(x=>x.status).sort(),['aborted','succeeded']);}
  finally{await rm(root,{recursive:true,force:true});}}
});

test('four genuine pre-manifest interruptions exhaust writes but preserve the partial immutable tile',async()=>{
 const binding=(await bindings()).find(x=>x.id==='cape-town')!;const root=await tempRepo(binding);
 try{for(let i=0;i<L.attemptsPerRequest;i++){const controller=new AbortController();await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding,signal:controller.signal,onAssetWritten:relative=>{if(relative.startsWith('tiles/'))controller.abort(new Error('interrupt before manifest'));}}));}const rows=await auditRows(root);assert.equal(rows.length,L.attemptsPerRequest);assert.ok(rows.every(x=>x.status==='aborted'));const output=path.join(root,'.cache/world-build/output/climate-packs');await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding}),/exhausted four lifetime attempts/);assert.equal((await auditRows(root)).length,L.attemptsPerRequest);assert.equal(await readdir(path.join(output,'tiles')).then(x=>x.length),1);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('a content-modified climate tile collision is rejected instead of repaired',async()=>{
 const binding=(await bindings()).find(x=>x.id==='cape-town')!;const root=await tempRepo(binding);
 try{const published=await publishClimateAttachment({repositoryRoot:root,binding});const base=JSON.parse(await readFile(path.join(REPO,binding.baseManifest.path),'utf8')) as {tiles:Array<{path:string}>};const target=path.join(root,'.cache/world-build/output/climate-packs',base.tiles[0]!.path);const prior=await readFile(target);const changed=Buffer.from(prior);changed[0]=changed[0]===0x7b?0x5b:0x7b;await writeFile(target,changed);assert.notEqual(hash(changed),hash(prior));await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding}),/collision|differs|mismatch/i);assert.equal(hash(await readFile(published.manifestPath)),published.manifestHash);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('a self-consistent rehashed published product with a changed tile is rejected',async()=>{
 const binding=(await bindings()).find(x=>x.id==='nairobi')!;const root=await tempRepo(binding);
 try{const published=await publishClimateAttachment({repositoryRoot:root,binding});const manifest=JSON.parse(await readFile(published.manifestPath,'utf8')) as {tiles:Array<{path:string;sha256:string;bytes:number}>};const tile=manifest.tiles[0]!;const oldTile=path.join(root,'.cache/world-build/output/climate-packs',tile.path),body=Buffer.from(await readFile(oldTile));body[0]=body[0]===0x7b?0x5b:0x7b;const newSha=hash(body),newTilePath=`tiles/${newSha}.json`;await unlink(oldTile);await writeFile(path.join(path.dirname(oldTile),`${newSha}.json`),body,{flag:'wx'});tile.path=newTilePath;tile.sha256=newSha;const oldManifest=published.manifestPath,newManifestBody=Buffer.from(`${canonicalJson(manifest)}\n`),newManifestHash=hash(newManifestBody);await unlink(oldManifest);await writeFile(path.join(path.dirname(oldManifest),`${newManifestHash}.json`),newManifestBody,{flag:'wx'});assert.notEqual(newManifestHash,published.manifestHash);await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding}),/missing or corrupt|collision|mismatch/i);assert.equal(hash(await readFile(path.join(path.dirname(oldManifest),`${newManifestHash}.json`))),newManifestHash);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('a rehashed provenance binding cannot evade the durable success audit and trigger repair',async()=>{
 const binding=(await bindings()).find(x=>x.id==='nairobi')!;const root=await tempRepo(binding);
 try{const published=await publishClimateAttachment({repositoryRoot:root,binding});const manifest=JSON.parse(await readFile(published.manifestPath,'utf8')) as {exceptions:string[]};const provenance=JSON.parse(await readFile(published.provenancePath,'utf8')) as {binding:ClimateAttachmentBinding};const other=structuredClone(binding);other.campaignId='representative-real-v2-forged';other.baseManifest.path=`.cache/world-build/campaigns/${other.campaignId}/output/manifests/${other.baseManifest.sha256}.json`;provenance.binding=other;
  const output=path.join(root,'.cache/world-build/output/climate-packs'),newProvenance=Buffer.from(`${canonicalJson(provenance)}\n`),newProvenanceHash=hash(newProvenance);manifest.exceptions=manifest.exceptions.map(value=>value===`Climate attachment provenance sha256:${published.provenanceHash}`?`Climate attachment provenance sha256:${newProvenanceHash}`:value);const newManifest=Buffer.from(`${canonicalJson(manifest)}\n`),newManifestHash=hash(newManifest);
  await unlink(published.provenancePath);await unlink(published.manifestPath);await writeFile(path.join(output,'provenance',`${newProvenanceHash}.json`),newProvenance,{flag:'wx'});await writeFile(path.join(output,'manifests',`${newManifestHash}.json`),newManifest,{flag:'wx'});
  await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding}),/previously published climate output is missing or corrupt/);assert.equal((await auditRows(root)).length,1);await assert.rejects(readFile(published.manifestPath),{code:'ENOENT'});await assert.rejects(readFile(published.provenancePath),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a missing tile referenced by an already-published manifest is damaged and never auto-repaired',async()=>{
 const binding=(await bindings()).find(x=>x.id==='accra')!;const root=await tempRepo(binding);
 try{const published=await publishClimateAttachment({repositoryRoot:root,binding});const manifest=JSON.parse(await readFile(published.manifestPath,'utf8')) as {tiles:Array<{path:string}>};const missing=path.join(root,'.cache/world-build/output/climate-packs',manifest.tiles[0]!.path);await unlink(missing);await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding}),/missing or corrupt/);await assert.rejects(readFile(missing),{code:'ENOENT'});assert.equal(hash(await readFile(published.manifestPath)),published.manifestHash);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('binding tampering is rejected before creating publication or audit output',async()=>{
 const binding=(await bindings()).find(x=>x.id==='accra')!;const root=await tempRepo(binding);const forged=structuredClone(binding);forged.expectedSample.longitude+=0.001;
 try{await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding:forged}));await assert.rejects(readFile(path.join(root,'.cache/world-build/output/climate-packs')),{code:'ENOENT'});await assert.rejects(readFile(path.join(root,'.cache/world-build/climate-attachment-attempts')),{code:'ENOENT'});}
 finally{await rm(root,{recursive:true,force:true});}
});

test('symlinked pinned input is refused without creating publication state',async()=>{
 const binding=(await bindings()).find(x=>x.id==='nairobi')!;const root=await tempRepo(binding);const rawPath=path.join(root,binding.rawSource.path);
 try{await unlink(rawPath);await symlink(path.join(REPO,binding.rawSource.path),rawPath);await assert.rejects(publishClimateAttachment({repositoryRoot:root,binding}),/symlink|canonical|pin/i);await assert.rejects(readFile(path.join(root,'.cache/world-build/output/climate-packs')),{code:'ENOENT'});await assert.rejects(readFile(path.join(root,'.cache/world-build/climate-attachment-attempts')),{code:'ENOENT'});}
 finally{await rm(root,{recursive:true,force:true});}
});
