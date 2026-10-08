import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, realpath, mkdir, symlink, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInventory, publishInventory, validateInventory } from './inventory.ts';
import type { SourceRecord } from './types.ts';

const source:SourceRecord={id:'natural-earth-admin0',url:'file:fixture.geojson',release:'pinned-test-release',license:'public-domain',attribution:'Natural Earth',sha256:'a'.repeat(64),bytes:321};
const poly=(coordinates:unknown)=>({type:'Polygon',coordinates});
const geo={type:'FeatureCollection',features:[
 {type:'Feature',id:'FJ',properties:{NE_ID:242,ADMIN:'Fiji',CONTINENT:'Oceania',ISO_A2_EH:'FJ'},geometry:poly([[[179,-18],[-179,-18],[-179,-16],[179,-16],[179,-18]],[[179.2,-17.8],[179.8,-17.8],[179.8,-17.2],[179.2,-17.2],[179.2,-17.8]]])},
 {type:'Feature',id:'GH',properties:{NE_ID:90,ADMIN:'Ghana',CONTINENT:'Africa',ISO_A2_EH:'GH'},geometry:poly([[[-3,4],[1,4],[1,11],[-3,11],[-3,4]]])},
 {type:'Feature',id:'NG',properties:{NE_ID:159,ADMIN:'Nigeria',CONTINENT:'Africa',ISO_A2_EH:'NG'},geometry:poly([[[3,4],[15,4],[15,14],[3,14],[3,4]]])},
]};

test('buildInventory accounts for each source feature once, preserves code ambiguity and dateline/hole geometry',()=>{
 const inventory=buildInventory(source,geo);
 assert.equal(inventory.sourceUnitCount,3);
 assert.equal(inventory.nodes.filter(n=>n.kind==='world').length,1);
 assert.equal(inventory.nodes.filter(n=>n.kind==='continent').length,2);
 assert.equal(inventory.nodes.filter(n=>n.kind==='country').length,3);
 assert.deepEqual(inventory.nodes.filter(n=>n.kind==='country').flatMap(n=>n.sourceFeatureIds).sort(),['natural-earth-admin0:NE_ID:159','natural-earth-admin0:NE_ID:242','natural-earth-admin0:NE_ID:90'].sort());
 assert.equal(inventory.nodes.find(n=>n.id.startsWith('country:')&&n.name==='Fiji')?.bounds?.[0]! > inventory.nodes.find(n=>n.id.startsWith('country:')&&n.name==='Fiji')?.bounds?.[2]!,true);
 assert.equal(inventory.outlines.find(o=>o.nodeId.includes('242'))?.geometry.type,'Polygon');
 assert.equal((inventory.outlines.find(o=>o.nodeId.includes('242'))?.geometry.coordinates as unknown[][]).length,2);
 assert.equal(inventory.nodes.find(n=>n.id==='legacy-ng')?.provider,'legacy-ng');
 assert.equal(inventory.nodes.find(n=>n.id==='legacy-ng')?.outline,'missing');
});

test('build rejects duplicated IDs and validateInventory catches lost source units/outlines',()=>{
 const duplicate=structuredClone(geo); duplicate.features.push(structuredClone(duplicate.features[0]!));
 assert.throws(()=>buildInventory(source,duplicate),/duplicate source feature identity/);
 const inventory=buildInventory(source,geo), missing=structuredClone(inventory);
 missing.sourceUnitCount++;
 assert.throws(()=>validateInventory(missing),/denominator/);
 const broken=structuredClone(inventory); broken.outlines.pop();
 assert.throws(()=>validateInventory(broken),/available outline missing/);
});

test('stable identity falls back from ambiguous NE_ID to ADM0_A3 and records that exception',()=>{
 const fallback={type:'FeatureCollection',features:[{type:'Feature',id:'ZZ',properties:{NE_ID:'-99',ADM0_A3:'ZZZ',ADMIN:'Testland',CONTINENT:'Europe',ISO_A2_EH:'-99'},geometry:poly([[[10,10],[11,10],[11,11],[10,11],[10,10]]])}]};
 const inventory=buildInventory(source,fallback);
 assert.equal(inventory.nodes.find(n=>n.kind==='country')?.sourceFeatureIds[0],'natural-earth-admin0:ADM0_A3:ZZZ');
 assert.match(inventory.nodes.find(n=>n.kind==='country')?.exceptions.join(' ' )??'',/uses ADM0_A3/);
 assert.match(inventory.nodes.find(n=>n.kind==='country')?.exceptions.join(' ' )??'',/ISO_A2_EH/);
});

test('polar country bounds include every longitude at the pole',()=>{
 const antarctica={type:'FeatureCollection',features:[{type:'Feature',id:'AQ',properties:{NE_ID:10,ADMIN:'Antarctica',CONTINENT:'Antarctica',ISO_A2_EH:'AQ'},geometry:poly([[[-180,-80],[-90,-85],[0,-90],[90,-85],[180,-80],[-180,-80]]])}]};
 const inventory=buildInventory(source,antarctica);
 assert.deepEqual(inventory.nodes.find(n=>n.kind==='country')?.bounds,[-180,-90,180,-80]);
});

test('country IDs survive source-release refreshes while source references retain the release',()=>{
 const before=buildInventory(source,geo),after=buildInventory({...source,id:'natural-earth-admin0-next-release',release:'next-pinned-release'},geo);
 assert.deepEqual(before.nodes.map(n=>n.id),after.nodes.map(n=>n.id));
 assert.notDeepEqual(before.nodes.flatMap(n=>n.sourceFeatureIds),after.nodes.flatMap(n=>n.sourceFeatureIds));
});

test('untrusted inventory rejects cycles, invalid sources, open rings and generated Nigeria outlines',()=>{
 const inventory=buildInventory(source,geo),cycle=structuredClone(inventory);
 const continent=cycle.nodes.find(n=>n.kind==='continent')!;continent.parentId=continent.id;
 assert.throws(()=>validateInventory(cycle),/hierarchy/);
 const corrupt=structuredClone(inventory);corrupt.sources[0]!.sha256='unverified';
 assert.throws(()=>validateInventory(corrupt),/source invalid/);
 const unsafe=structuredClone(inventory);unsafe.outlines.push({nodeId:'legacy-ng',geometry:poly([[[3,4],[15,4],[15,14],[3,14],[3,4]]]) as typeof unsafe.outlines[number]['geometry']});
 assert.throws(()=>validateInventory(unsafe),/protected outline/);
 const open=structuredClone(geo);(open.features[0]!.geometry.coordinates as number[][][])[0]!.pop();
 assert.throws(()=>buildInventory(source,open),/closed/);
});

test('inventory publication refuses symlink ancestors without creating data beyond them',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'world-inventory-link-'));
 try{
  const canonicalTemp=await realpath(temp),outside=path.join(canonicalTemp,'outside'),link=path.join(canonicalTemp,'linked');
  await mkdir(outside);await symlink(outside,link);
  await assert.rejects(publishInventory(buildInventory(source,geo),path.join(link,'missing','output'),path.join(link,'missing')),/symlink/);
  await assert.rejects(stat(path.join(outside,'missing')),/ENOENT/);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('publishInventory writes independently addressed outline and node assets with manifest last',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'world-inventory-'));
 try {
  const canonicalTemp=await realpath(temp),root=path.join(canonicalTemp,'build'),out=path.join(root,'output','inventory');
  const result=await publishInventory(buildInventory(source,geo),out,root);
  assert.match(result.manifestHash,/^[a-f0-9]{64}$/);
  const manifest=JSON.parse(await readFile(path.join(out,result.manifestPath),'utf8')) as {sourceUnitCount:number;outlineCount:number;rootNodePath:string};
  assert.equal(manifest.sourceUnitCount,3);
  assert.equal(manifest.outlineCount,2);
  const outlines=await readdir(path.join(out,'outlines'));
  const nodes=await readdir(path.join(out,'nodes'));
  assert.equal(outlines.length,2);
  assert.equal(nodes.length,6);
  assert.ok(manifest.rootNodePath.startsWith('nodes/'));
  await assert.rejects(publishInventory(buildInventory(source,geo),path.join(canonicalTemp,'escape'),root),/inside allowed root/);
 } finally { await rm(temp,{recursive:true,force:true}); }
});
