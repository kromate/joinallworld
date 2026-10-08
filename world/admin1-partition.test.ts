import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJson } from './pack.ts';
import { inspectAdmin1Document, planAdmin1Partitions } from './admin1-partition.ts';
import type { Admin1BuildInput } from './admin1-types.ts';
import type { SourceRecord } from './types.ts';
import type { InventoryNode } from './production-types.ts';

const release='ca96624a56bd078437bca8184e78163e5039ad19';
const sha=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const ring:unknown[]=[[0,0],[1,0],[1,1],[0,1],[0,0]];
const feature=(id:number,code:string|null,geometry:unknown={type:'Polygon',coordinates:[ring]},extra:Record<string,unknown>={})=>({type:'Feature',id:`adm1-${id}`,properties:{ne_id:id,adm0_a3:code,admin:`Unit ${id}`,...extra},geometry});
const parentFeature=(id:number,code:string)=>({type:'Feature',id:`admin0-${id}`,properties:{NE_ID:id,ADM0_A3:code,ADMIN:code},geometry:{type:'Polygon',coordinates:[ring]}});
function raw(value:unknown):Buffer{return Buffer.from(JSON.stringify(value));}
function source(id:string,artifact:'admin0'|'admin1',bytes:Buffer):SourceRecord{return{id,url:`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_${artifact==='admin0'?'admin_0_countries':'admin_1_states_provinces'}.geojson`,release,license:'Public Domain',attribution:'Natural Earth',sha256:sha(bytes),bytes:bytes.length};}
function country(id:number,code:string,sourceId='ne-admin0-test'):InventoryNode{return{id:code==='NGA'?'legacy-ng':`country:natural-earth:${encodeURIComponent(`NE_ID:${id}`)}`,parentId:'continent:africa',name:code,kind:'country',countryCode:code==='NGA'?'NG':code==='GHA'?'GH':'RW',bounds:null,sourceFeatureIds:[`${sourceId}:NE_ID:${id}`],provider:code==='NGA'?'legacy-ng':'world',outline:code==='NGA'?'missing':'available',exceptions:[]};}
function buildInput(options:{features?:unknown[];parentFeatures?:unknown[];extraParentNodes?:InventoryNode[];parentRelease?:string;mutateAdminRaw?:(bytes:Buffer)=>Buffer}={}):Admin1BuildInput{
 const parentFeatures=options.parentFeatures??[parentFeature(1,'GHA'),parentFeature(159,'NGA'),parentFeature(3,'RWA')];
 const parentRaw=raw({type:'FeatureCollection',features:parentFeatures}),parentSource=source('ne-admin0-test','admin0',parentRaw);if(options.parentRelease)parentSource.release=options.parentRelease;
 const nodes:InventoryNode[]=[{id:'world:earth',parentId:null,name:'World',kind:'world',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]},{id:'continent:africa',parentId:'world:earth',name:'Africa',kind:'continent',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]},country(1,'GHA'),country(159,'NGA'),country(3,'RWA'),...(options.extraParentNodes??[])];
 const adminRaw0=raw({type:'FeatureCollection',features:options.features??[feature(100,'GHA')]});const adminRaw=options.mutateAdminRaw?.(adminRaw0)??adminRaw0;
 return{source:source('ne-admin1-test','admin1',adminRaw),raw:adminRaw,parent:{manifestHash:'b'.repeat(64),source:parentSource,raw:parentRaw,nodes}};
}
function materializedFeatures(plan:ReturnType<typeof planAdmin1Partitions>):Array<{sourceKey:string;feature:unknown}>{return plan.assets.flatMap(asset=>{const text=new TextDecoder().decode(asset.bytes);const body=JSON.parse(text) as {features:unknown[]};assert.ok(Array.isArray(body.features),`partition body lacks features: ${text.slice(0,300)}`);return body.features.map((feature,index)=>({sourceKey:asset.featureKeys[index]!,feature}));});}

test('partitions preserve source rows and split large country groups without loss',()=>{
 const sourceFeatures=[...Array.from({length:70},(_,i)=>feature(1000+i,'GHA',{type:'Polygon',coordinates:[ring,[[.2,.2],[.2,.4],[.4,.4],[.4,.2],[.2,.2]]]},{ADM1_NAME:`Unit ${i}`})),feature(9000,'ZZZ'),feature(1590,'NGA')];
 const input=buildInput({features:sourceFeatures}),report=inspectAdmin1Document(input),plan=planAdmin1Partitions(input);
 assert.equal(report.sourceUnits,72);assert.equal(report.linked,70);assert.equal(report.unlinked,1);assert.equal(report.protected,1);assert.equal(report.sourcePositions,70*10+5+5);assert.equal(report.sourcePolygons,72);
 assert.equal(plan.entries.length,72);assert.equal(plan.assets.length,3);assert.equal(plan.assets.filter(asset=>asset.featureKeys.length===64).length,1);assert.ok(plan.entries.find(row=>row.sourceKey==='NE_ID:1590')?.exception?.startsWith('protected'));
 assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:9000')?.joinStatus,'unlinked');assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:9000')?.partitionPath!==null,true);
 const emitted=materializedFeatures(plan);assert.equal(emitted.length,71);assert.equal(new Set(emitted.map(item=>item.sourceKey)).size,71);
 const expected=new Map(sourceFeatures.filter((item)=>item.properties.ne_id!==1590).map((item)=>[`NE_ID:${item.properties.ne_id}`,item]));for(const item of emitted)assert.deepEqual(item.feature,expected.get(item.sourceKey));
 const holeEntry=plan.entries.find(row=>row.sourceKey==='NE_ID:1000')!;assert.equal(holeEntry.featureSha256,sha(canonicalJson(sourceFeatures[0])));assert.equal(holeEntry.featureBytes,Buffer.byteLength(canonicalJson(sourceFeatures[0])));assert.equal(holeEntry.id,'admin1:natural-earth:NE_ID%3A1000');
 assert.deepEqual(plan.indexEntries[0],{sourceOrdinal:0,sourceKey:'NE_ID:1000',id:'admin1:natural-earth:NE_ID%3A1000',featureSha256:sha(canonicalJson(sourceFeatures[0])),countryId:'country:natural-earth:NE_ID%3A1',joinStatus:'linked',partitionPath:plan.entries.find(row=>row.sourceKey==='NE_ID:1000')!.partitionPath,exception:null});
 assert.equal(Object.hasOwn(plan.indexEntries[0]!, 'positions'),false);assert.equal(Object.hasOwn(plan.indexEntries[0]!, 'adm0Code'),false);
 assert.equal(plan.inspection.rows[0]!.positions,10);assert.equal(plan.inspection.rows[0]!.adm0Code,'GHA');assert.equal(plan.inspection.rows[0]!.featureBytes,holeEntry.featureBytes);
 const indexText=new TextDecoder().decode(plan.indexBytes);assert.deepEqual(JSON.parse(indexText),plan.indexEntries);
 assert.equal(plan.logicalBytes,plan.assets.reduce((sum,asset)=>sum+asset.bytes.length,0)+plan.indexBytes.byteLength+Buffer.byteLength(canonicalJson(report)));
});

test('ambiguous and unmatched codes remain explicit, and protected Nigeria never emits geometry',()=>{
 const duplicate=parentFeature(4,'GHA');
 const input=buildInput({parentFeatures:[parentFeature(1,'GHA'),duplicate,parentFeature(159,'NGA'),parentFeature(3,'RWA')],extraParentNodes:[country(4,'GHA')],features:[feature(201,'GHA'),feature(202,'NOPE'),feature(203,'NGA',null)]});
 const report=inspectAdmin1Document(input),plan=planAdmin1Partitions(input);assert.deepEqual(report.rows.map(row=>row.joinStatus),['ambiguous','unlinked','protected']);
 assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:201')?.joinStatus,'ambiguous');assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:202')?.joinStatus,'unlinked');const nigeria=plan.entries.find(row=>row.sourceKey==='NE_ID:203')!;assert.equal(nigeria.countryId,null);assert.equal(nigeria.partitionPath,null);assert.equal(nigeria.exception,'protected-nigeria-no-geometry');assert.equal(report.geometryExceptions,1);assert.equal(plan.assets.flatMap(asset=>asset.featureKeys).includes('NE_ID:203'),false);
});

test('oversized full feature is kept as a named source reference exception',()=>{
 const coordinates:number[][]=[];for(let i=0;i<60_000;i++){const angle=2*Math.PI*i/60_000;coordinates.push([Math.cos(angle)*100,Math.sin(angle)*50]);}coordinates.push(coordinates[0]!);
 const input=buildInput({features:[feature(808,'GHA',{type:'Polygon',coordinates:[coordinates]})]});const report=inspectAdmin1Document(input),plan=planAdmin1Partitions(input),row=plan.entries[0]!;assert.ok(report.largestFeatureBytes>1024*1024);assert.ok(row.positions<100_000);assert.equal(row.exception,'asset-byte-limit');assert.equal(row.partitionPath,null);assert.equal(plan.assets.length,0);assert.equal(plan.entries.length,report.sourceUnits);
});

test('malformed geometry and dateline/polar coordinates retain exact source audit',()=>{
 const dateline=feature(501,'GHA',{type:'Polygon',coordinates:[[[179,80,4],[-179,80,4],[-179,81,4],[179,81,4],[179,80,4]]]});const polar=feature(502,'RWA',{type:'Polygon',coordinates:[[[0,89],[90,89],[180,89],[-90,89],[0,89]]]});const malformed=feature(503,'GHA',{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1]]]});const collinear=feature(505,'GHA',{type:'Polygon',coordinates:[[[0,0],[1,0],[2,0],[0,0]]]});
 const input=buildInput({features:[dateline,polar,malformed,feature(504,'GHA',null),collinear]}),report=inspectAdmin1Document(input),plan=planAdmin1Partitions(input);assert.equal(report.sourceUnits,5);assert.equal(report.geometryExceptions,3);assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:501')?.geometryIssue,null);assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:502')?.geometryIssue,null);assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:503')?.geometryIssue,'ring-is-not-closed');assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:504')?.geometryIssue,'geometry-is-not-an-object');assert.equal(plan.entries.find(row=>row.sourceKey==='NE_ID:505')?.geometryIssue,'ring-is-degenerate');const emitted=materializedFeatures(plan);assert.deepEqual(emitted.map(row=>row.sourceKey),['NE_ID:501','NE_ID:502']);assert.deepEqual(emitted[0]!.feature,dateline);assert.deepEqual(emitted[1]!.feature,polar);
});

test('source bytes, parent release, and exact parent identity are mandatory',()=>{
 const input=buildInput();assert.throws(()=>inspectAdmin1Document({...input,raw:Buffer.from(' ') }),/does not match its byte and SHA-256 pin/);assert.throws(()=>inspectAdmin1Document(buildInput({parentRelease:'f'.repeat(40)})),/source release/);
 const missing=structuredClone(input);missing.parent.nodes=missing.parent.nodes.filter(node=>node.id!=='country:natural-earth:NE_ID%3A1');assert.throws(()=>inspectAdmin1Document(missing),/has no exact parent country node/);
 const wrongIdentity=structuredClone(input);wrongIdentity.parent.nodes.find(node=>node.id==='country:natural-earth:NE_ID%3A1')!.id='country:natural-earth:NE_ID%3A88';assert.throws(()=>inspectAdmin1Document(wrongIdentity),/does not match its stable NE_ID identity/);
 const badRef=structuredClone(input);badRef.parent.nodes.find(node=>node.id==='country:natural-earth:NE_ID%3A1')!.sourceFeatureIds=['other:NE_ID:1'];assert.throws(()=>inspectAdmin1Document(badRef),/does not use its pinned Admin 0 source/);
});

test('duplicate and missing Admin 1 source identities fail closed',()=>{
 assert.throws(()=>inspectAdmin1Document(buildInput({features:[feature(12,'GHA'),feature(12,'RWA')]})),/duplicate Admin 1 source feature key/);
 const invalid={...feature(14,'GHA'),properties:{adm0_a3:'GHA',admin:'Unit'}};assert.throws(()=>inspectAdmin1Document(buildInput({features:[invalid]})),/positive canonical safe integer/);
 const wrongCase={type:'Feature',properties:{NE_ID:15,adm0_a3:'GHA',admin:'wrong case'},geometry:{type:'Polygon',coordinates:[ring]}};assert.throws(()=>inspectAdmin1Document(buildInput({features:[wrongCase]})),/ne_id.*positive canonical safe integer/);
});
