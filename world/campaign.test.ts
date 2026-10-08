import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir, symlink, appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { campaignStatus, runCampaign, validateCampaign } from './campaign.ts';
import { ACCRA_OSM_SOURCE } from './sources.ts';
import { Ledger } from './ledger.ts';
import { REPOSITORY_ROOT } from './pipeline.ts';
import type { AcquisitionOptions, AcquisitionRequest, WorldCampaign } from './production-types.ts';

const hash=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
async function fixtureCampaign(root:string,id='test-campaign'):Promise<WorldCampaign>{
  const bytes=new Uint8Array(await readFile(new URL('./fixtures/basic.geojson',import.meta.url))),input=path.join(root,'source.geojson');await writeFile(input,bytes);
  const source={...ACCRA_OSM_SOURCE,sha256:hash(bytes),bytes:bytes.byteLength};
  return{schemaVersion:1,id,inventoryHash:'a'.repeat(64),units:[{kind:'local',id:'accra-cell',inventoryUnitId:'ghana:accra',priority:1,plan:{region:{id:'accra-campaign-test',parentId:null,name:'Accra test',kind:'city',countryCode:'GH',timezone:'Africa/Accra',bounds:[-0.21,5.54,-0.19,5.56]},source,input:{path:input,sha256:hash(bytes),bytes:bytes.byteLength}}}],limits:{durationMs:60_000,jobDurationMs:30_000,networkBytes:1000,inputBytes:64_000_000,outputBytes:2_000_000,diskBytes:8_000_000,memoryMb:512,maxAttempts:2}};
}
test('validates pinned immutable campaigns, explicit source units and Nigeria protection',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{const campaign=await fixtureCampaign(dir),unit=campaign.units[0]!;if(unit.kind!=='local')throw new Error('fixture must be local');assert.equal(validateCampaign(campaign).units.length,1);assert.throws(()=>validateCampaign({...campaign,units:[]}),/explicit source unit/);assert.throws(()=>validateCampaign({...campaign,units:[{...unit,plan:{...unit.plan,region:{...unit.plan.region,countryCode:'NG'}}}]}),/Nigeria/);}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('runs in isolated campaign state, reports denominator, resumes an interruption and pins config',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const campaign=await fixtureCampaign(dir),root=path.join(dir,'state');
    const paused=await runCampaign(campaign,{allowedRoot:root,maxJobs:0});assert.equal(paused.status,'stopped');assert.equal(paused.counts.unknown,1);
    const done=await runCampaign(campaign,{allowedRoot:root});assert.equal(done.status,'complete',done.failures.join('; '));assert.equal(done.counts.compiled,1,done.failures.join('; '));assert.equal(done.counts.sourceUnits,1);assert.equal(done.jobs[0]?.priority,1);
    const status=await campaignStatus(campaign.id,{allowedRoot:root});assert.equal(status.counts.compiled,1);assert.deepEqual(status.stages,{acquire:0,compile:1,validate:1});
    await appendFile(path.join(root,campaign.id,'stages.jsonl'),'{truncated');await campaignStatus(campaign.id,{allowedRoot:root});
    const journalAudit=await readFile(path.join(root,campaign.id,'stage-journal-repair.jsonl'),'utf8');assert.match(journalAudit,/discard-truncated-final-stage-record/);
    await assert.rejects(runCampaign({...campaign,inventoryHash:'b'.repeat(64)},{allowedRoot:root}),/different immutable configuration/);
    assert.equal(JSON.parse(await readFile(path.join(root,campaign.id,'campaign.json'),'utf8')).inventoryHash,campaign.inventoryHash);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('campaign resume hydrates priorities in a pre-priority ledger with queued and completed jobs',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-priority-migration-'));
  try{
    const base=await fixtureCampaign(dir,'priority-migration-test'),local=base.units[0]!;if(local.kind!=='local')throw new Error('fixture must be local');
    const later={...local,id:'later-cell',inventoryUnitId:'ghana:later-cell',priority:2,plan:{...local.plan,region:{...local.plan.region,id:'later-campaign-test',name:'Later test'}}};
    const campaign={...base,units:[local,later,{kind:'protected' as const,id:'legacy-marker',inventoryUnitId:'nigeria:legacy',priority:0,reason:'preserve legacy provider'}]},root=path.join(dir,'state');
    const partial=await runCampaign(campaign,{allowedRoot:root,maxJobs:2});assert.equal(partial.counts.protected,1);assert.equal(partial.counts.compiled,1);assert.equal(partial.counts.unknown,1);
    const dbPath=path.join(root,campaign.id,'ledger.sqlite');await rm(dbPath,{force:true});await rm(`${dbPath}-wal`,{force:true});await rm(`${dbPath}-shm`,{force:true});
    const legacy=new DatabaseSync(dbPath);
    legacy.exec(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL,
      max_attempts INTEGER NOT NULL CHECK(max_attempts > 0), attempt INTEGER NOT NULL DEFAULT 0,
      token_seq INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('queued','leased','completed','failed')),
      available_at REAL NOT NULL DEFAULT 0, lease_until REAL, lease_token TEXT, result TEXT, error TEXT
    );`);
    const insert=legacy.prepare('INSERT INTO jobs(id,kind,input_hash,payload,max_attempts,attempt,status,available_at,result,error) VALUES(?,?,?,?,?,?,?,?,?,?)');
    for(const job of partial.jobs){insert.run(String(job.id),String(job.kind),String(job.inputHash),JSON.stringify(job.payload),Number(job.maxAttempts),Number(job.attempt),String(job.status),Number(job.availableAt),job.result===null?null:JSON.stringify(job.result),job.error===null?null:String(job.error));}
    legacy.close();
    const resumed=await runCampaign(campaign,{allowedRoot:root});assert.equal(resumed.status,'complete',resumed.failures.join('; '));
    assert.equal(resumed.counts.protected,1);assert.equal(resumed.counts.compiled,2);
    const migrated=new Map(resumed.jobs.map(job=>[String(job.id),job]));
    assert.equal(migrated.get(`${campaign.id}:accra-cell`)?.priority,1);
    assert.equal(migrated.get(`${campaign.id}:legacy-marker`)?.priority,0);
    assert.equal(migrated.get(`${campaign.id}:later-cell`)?.priority,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('acquisition callback is injected, identity-checked, and rejects over-budget request',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const base=await fixtureCampaign(dir,'acquire-test'),unit=base.units[0]!;if(unit.kind!=='local')throw new Error('fixture must be local');
    const request={schemaVersion:1 as const,id:'req',inventoryUnitId:unit.inventoryUnitId,region:unit.plan.region,provider:'overture' as const,release:'2026-10-01',layers:['buildings'] as Array<'buildings'>,limits:{networkBytes:100,outputBytes:1_000_000,diskBytes:100_000,memoryMb:32,durationMs:1000,features:5}};
    const campaign={...base,units:[{kind:'acquire' as const,id:'acquire-accra',inventoryUnitId:unit.inventoryUnitId,priority:0,request}]};
    let calls=0;
    const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(value);
    const acquire=async(r:AcquisitionRequest,o:AcquisitionOptions)=>{calls++;const cachedPath=path.join(o.allowedRoot,'fixture.geojson'),receiptPath=path.join(o.allowedRoot,'receipt.json'),bytes=await readFile(unit.plan.input.path);await writeFile(cachedPath,bytes);await writeFile(receiptPath,'{}');return{plan:{...unit.plan,input:{...unit.plan.input,path:cachedPath}},requestHash:hash(canonical(r)),receiptPath,metrics:{networkBytes:1,outputBytes:bytes.byteLength,features:2,elapsedMs:1},upstream:[],exceptions:[]};};
    const out=await runCampaign(campaign,{allowedRoot:path.join(dir,'state'),acquire});assert.equal(out.status,'complete',out.failures.join('; '));assert.equal(calls,1);
    const bad={...campaign,id:'acquire-bad',limits:{...campaign.limits,networkBytes:100},units:[{...campaign.units[0]!,request:{...request,limits:{...request.limits,networkBytes:200}}}]};
    const bounded=await runCampaign(bad,{allowedRoot:path.join(dir,'state'),acquire});assert.equal(bounded.status,'complete');assert.equal(calls,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('recovers an expired campaign lease and repairs only the verified corrupt file',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const campaign=await fixtureCampaign(dir,'repair-test'),root=path.join(dir,'state');
    await runCampaign(campaign,{allowedRoot:root,maxJobs:0});
    const ledger=new Ledger(path.join(root,campaign.id,'ledger.sqlite'));
    try{ledger.claim('crashed-test-worker',Date.now(),1);}finally{ledger.close();}
    await new Promise(resolve=>setTimeout(resolve,5));
    const completed=await runCampaign(campaign,{allowedRoot:root});assert.equal(completed.counts.compiled,1);
    const result=completed.jobs[0]!.result as {manifestPath:string};
    const manifest=JSON.parse(await readFile(path.join(root,campaign.id,'output',result.manifestPath),'utf8')) as {tiles:Array<{path:string}>};
    const corrupt=manifest.tiles[0]!.path;await writeFile(path.join(root,campaign.id,'output',corrupt),'broken');
    const repaired=await runCampaign(campaign,{allowedRoot:root});assert.equal(repaired.counts.compiled,1);assert.ok(repaired.failures.length===0);
    const quarantined=await readdir(path.join(root,campaign.id,'quarantine'));assert.equal(quarantined.length,1);
    const audit=JSON.parse(await readFile(path.join(root,campaign.id,'repair-audit.json'),'utf8')) as Array<{file:string}>;assert.equal(audit[0]!.file,corrupt);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('refuses primary checkout and symlinked campaign roots, and excludes a second heavy runner',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const campaign=await fixtureCampaign(dir,'lock-test');
    await assert.rejects(runCampaign(campaign,{allowedRoot:REPOSITORY_ROOT}),/campaign state root/);
    const link=path.join(dir,'linked-state');await symlink(path.join(dir,'safe-state'),link);await assert.rejects(runCampaign(campaign,{allowedRoot:link}),/symlink/);
    const root=path.join(dir,'safe-state');await mkdir(root,{recursive:true});
    await writeFile(path.join(root,'.campaign-runner.lock'),String(process.pid));
    await assert.rejects(runCampaign(campaign,{allowedRoot:root}),/another campaign runner is active/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('reserves remaining acquisition budget durably before calling the adapter',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const base=await fixtureCampaign(dir,'budget-test'),unit=base.units[0]!;if(unit.kind!=='local')throw new Error('fixture must be local');
    const request={schemaVersion:1 as const,id:'budget-request',inventoryUnitId:unit.inventoryUnitId,region:unit.plan.region,provider:'overture' as const,release:'2026-09-23.1',layers:['buildings'] as Array<'buildings'>,limits:{networkBytes:100,outputBytes:1_000_000,diskBytes:100_000,memoryMb:128,durationMs:1000,features:10}};
    const campaign={...base,limits:{...base.limits,networkBytes:2},units:[{kind:'acquire' as const,id:'budget-unit',inventoryUnitId:unit.inventoryUnitId,priority:0,request}]};
    const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(value);
    let bounded=0;const acquire=async(r:AcquisitionRequest)=>{bounded=r.limits.networkBytes;throw new Error('simulated interrupted adapter');};
    const report=await runCampaign(campaign,{allowedRoot:path.join(dir,'state'),acquire});assert.equal(bounded,2);assert.equal(report.status,'exception');
    const journal=path.join(dir,'state',campaign.id,'usage.jsonl');await appendFile(journal,'{torn');
    const retry=await campaignStatus(campaign.id,{allowedRoot:path.join(dir,'state')});assert.equal(retry.status,'exception');
    const repair=await readFile(path.join(dir,'state',campaign.id,'usage-journal-repair.jsonl'),'utf8');assert.match(repair,/discard-truncated-final-usage-record/);
    const lines=(await readFile(journal,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {phase:string;networkBytes:number});
    assert.equal(lines.at(-1)?.phase,'settled');assert.equal(lines.at(-1)?.networkBytes,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('shared acquisition disk charges reduce compile allowance in isolated campaign state',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-shared-disk-'));
  try{
    const campaign=await fixtureCampaign(dir,'shared-disk-accounting'),root=path.join(dir,'state');
    await runCampaign(campaign,{allowedRoot:root,maxJobs:0});
    const journal=path.join(root,campaign.id,'usage.jsonl');
    await appendFile(journal,`${JSON.stringify({key:'shared-cache-growth',sequence:1,sourceKey:'real-acquisition-cache',phase:'settled',networkBytes:0,inputBytes:0,outputBytes:0,diskBytes:campaign.limits.diskBytes})}\n`);
    const report=await runCampaign(campaign,{allowedRoot:root});
    assert.equal(report.status,'exception');
    assert.match(report.failures.join(' '),/campaign disk budget exhausted/);
    assert.equal((report.jobs[0]?.result as {manifestPath?:string}|null)?.manifestPath,undefined);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('hard-bounds input pins and acquisition output allowance before invoking the worker',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const base=await fixtureCampaign(dir,'input-budget-test'),unit=base.units[0]!;if(unit.kind!=='local')throw new Error('fixture must be local');
    const request={schemaVersion:1 as const,id:'input-budget-request',inventoryUnitId:unit.inventoryUnitId,region:unit.plan.region,provider:'overture' as const,release:'2026-09-23.1',layers:['buildings'] as Array<'buildings'>,limits:{networkBytes:100,outputBytes:1_000_000,diskBytes:100_000,memoryMb:128,durationMs:1000,features:10}};
    const campaign={...base,id:'input-budget',limits:{...base.limits,inputBytes:2},units:[{kind:'acquire' as const,id:'input-budget-unit',inventoryUnitId:unit.inventoryUnitId,priority:0,request}]};let seen=0;
    const acquire=async(r:AcquisitionRequest)=>{seen=r.limits.outputBytes;throw new Error('stop after observing hard cap');};
    const report=await runCampaign(campaign,{allowedRoot:path.join(dir,'state'),acquire});assert.equal(report.status,'exception');assert.equal(seen,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('binds campaigns to a hashed reachable inventory snapshot and rechecks it in status',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const canon=(v:unknown):string=>Array.isArray(v)?`[${v.map(canon).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon((v as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(v);
    const node=async(value:unknown)=>{const body=canon(value),h=hash(body),relative=`nodes/${h}.json`,target=path.join(dir,'inventory',relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body);return relative;};
    const country=await node({node:{id:'ghana:accra',kind:'country',provider:'world',sourceFeatureIds:[]},children:[]}),continent=await node({node:{id:'continent:africa',kind:'continent',provider:'world',sourceFeatureIds:[]},children:[{id:'ghana:accra',path:country}]}),rootNode=await node({node:{id:'world:earth',kind:'world',provider:'world',sourceFeatureIds:[]},children:[{id:'continent:africa',path:continent}]});
    const manifestBody=canon({schemaVersion:1,sourceUnitCount:0,rootNodePath:rootNode}),manifestHash=hash(manifestBody),manifestPath=path.join(dir,'inventory','manifests',`${manifestHash}.json`);await mkdir(path.dirname(manifestPath),{recursive:true});await writeFile(manifestPath,manifestBody);
    const campaign={...await fixtureCampaign(dir,'inventory-bound-test'),inventoryHash:manifestHash},state=path.join(dir,'state');
    await runCampaign(campaign,{allowedRoot:state,inventoryManifestPath:manifestPath,maxJobs:0});assert.equal((await campaignStatus(campaign.id,{allowedRoot:state})).counts.unknown,1);
    await writeFile(manifestPath,`${manifestBody} `);await assert.rejects(campaignStatus(campaign.id,{allowedRoot:state}),/does not match its pinned SHA/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('retains one acquisition network charge when a cache hit resumes compilation',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const base=await fixtureCampaign(dir,'cache-account-test'),unit=base.units[0]!;if(unit.kind!=='local')throw new Error('fixture must be local');
    const request={schemaVersion:1 as const,id:'cache-request',inventoryUnitId:unit.inventoryUnitId,region:unit.plan.region,provider:'overture' as const,release:'2026-09-23.1',layers:['buildings'] as Array<'buildings'>,limits:{networkBytes:20,outputBytes:1_000_000,diskBytes:100_000,memoryMb:128,durationMs:1000,features:10}};
    const campaign={...base,id:'cache-resume-test',units:[{kind:'acquire' as const,id:'cache-unit',inventoryUnitId:unit.inventoryUnitId,priority:0,request}]};let calls=0;
    const acquire=async(r:AcquisitionRequest,o:AcquisitionOptions)=>{calls++;const inputPath=path.join(o.allowedRoot,'bad-cache.geojson'),receiptPath=path.join(o.allowedRoot,'receipt.json'),bytes=await readFile(unit.plan.input.path);await writeFile(inputPath,bytes);await writeFile(receiptPath,'receipt');const invalid='f'.repeat(64);return{plan:{...unit.plan,source:{...unit.plan.source,sha256:invalid},input:{...unit.plan.input,path:inputPath,sha256:invalid}},requestHash:'c'.repeat(64),receiptPath,metrics:{networkBytes:calls===1?3:0,outputBytes:bytes.byteLength,features:2,elapsedMs:1},upstream:[],exceptions:[]};};
    const report=await runCampaign(campaign,{allowedRoot:path.join(dir,'state'),acquire});assert.equal(report.status,'exception');assert.equal(calls,2);
    const entries=(await readFile(path.join(dir,'state',campaign.id,'usage.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {key:string;phase:string;networkBytes:number}),latest=new Map(entries.map(entry=>[entry.key,entry]));assert.equal([...latest.values()].reduce((total,entry)=>total+entry.networkBytes,0),3);assert.equal([...latest.values()].at(-1)?.networkBytes,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('reports an empty source unit as an exception rather than complete geography',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-campaign-'));
  try{
    const campaign=await fixtureCampaign(dir,'empty-source-test'),unit=campaign.units[0]!;if(unit.kind!=='local')throw new Error('fixture must be local');
    const bytes=Buffer.from(JSON.stringify({type:'FeatureCollection',features:[]})),input=path.join(dir,'empty.geojson');await writeFile(input,bytes);
    const empty={...campaign,limits:{...campaign.limits,maxAttempts:1},units:[{...unit,plan:{...unit.plan,source:{...unit.plan.source,sha256:hash(bytes),bytes:bytes.byteLength},input:{path:input,sha256:hash(bytes),bytes:bytes.byteLength}}}]};
    const report=await runCampaign(empty,{allowedRoot:path.join(dir,'state')});assert.equal(report.status,'exception');assert.equal(report.counts.sourceUnits,1);assert.equal(report.counts.compiled,0);assert.equal(report.counts.exception,1);assert.match(report.failures.join(' '),/empty geography/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
