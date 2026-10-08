import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from './pack.ts';
import { compileRegion } from './ingest.ts';
import { compileRegionalFanout, validateRegionalFanoutRequest } from './regional-fanout.ts';
import type { Region, SourceRecord } from './types.ts';

const countryId='country:natural-earth:NE_ID%3A1159320793';
const sourceBase:SourceRecord={id:'fixture-overture',url:'https://example.test/fixture.geojson',release:'test-release',license:'ODbL-1.0',attribution:'Synthetic fan-out fixture',sha256:'',bytes:0};
const parentRegion:Region={id:'gh-dakar-parent-extract',parentId:countryId,name:'Synthetic bounded parent extract',kind:'cell',countryCode:'GH',timezone:null,bounds:[0,0,2,2]};
const cellA:Region={id:'a-cell',parentId:countryId,name:'West cell',kind:'cell',countryCode:'GH',timezone:null,bounds:[0,0,1,1]};
const cellB:Region={id:'b-cell',parentId:countryId,name:'East cell',kind:'cell',countryCode:'GH',timezone:null,bounds:[1,0,2,1]};
const ring=(w:number,s:number,e:number,n:number):number[][]=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
const multiFeature={type:'Feature',id:'multi',properties:{building:'yes',height:'12 m'},geometry:{type:'MultiPolygon',coordinates:[[[...ring(.8,.2,1.4,.8)],[...ring(.9,.3,1,.4)]],[[...ring(1.6,.2,1.8,.4)]]]}};
const boundaryRoad={type:'Feature',id:'boundary',properties:{highway:'residential'},geometry:{type:'LineString',coordinates:[[1,.2],[1,.8]]}};
const cornerRoad={type:'Feature',id:'corner',properties:{highway:'service'},geometry:{type:'LineString',coordinates:[[1,1],[1.1,.9]]}};
const outsideRoad={type:'Feature',id:'outside',properties:{highway:'track'},geometry:{type:'LineString',coordinates:[[-.2,.4],[.2,.4]]}};
const unsupported={type:'Feature',id:'point',properties:{name:'unsupported point'},geometry:{type:'Point',coordinates:[1.2,.4]}};
const features=[multiFeature,structuredClone(multiFeature),boundaryRoad,cornerRoad,outsideRoad,unsupported];

function bytesOf(rows:unknown[]=features,requestHash='c'.repeat(64)):Uint8Array{return new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',metadata:{fixture:'synthetic',edition:1,requestHash},features:rows}));}
function makeRequest(input:Uint8Array,children:Region[]=[cellB,cellA],overrides:Record<string,unknown>={}):Record<string,unknown>{
  const source={...sourceBase,sha256:sha256(input),bytes:input.byteLength};
  const request={schemaVersion:1,id:'fanout-test',inventoryHash:'a'.repeat(64),inventoryUnitId:countryId,parentPlan:{region:parentRegion,source,input:{path:'/tmp/pinned-parent.geojson',sha256:source.sha256,bytes:input.byteLength},rawExtraction:{url:'https://example.test/parent.parquet',fetched:'2026-10-08T00:00:00.000Z',sha256:'b'.repeat(64),bytes:1234}},parentAcquisition:{requestHash:'c'.repeat(64),receipt:{path:'/tmp/pinned-receipt.json',sha256:'d'.repeat(64),bytes:123}},children,limits:{inputBytes:20_000_000,features:5_000,coordinates:200_000,children:64,outputBytes:30_000_000},...overrides};
  return request;
}
function run(rows:unknown[]=features,children:Region[]=[cellB,cellA]){const input=bytesOf(rows);return {input,request:makeRequest(input,children),product:compileRegionalFanout(makeRequest(input,children),input)};}
const parse=(bytes:Uint8Array):Record<string,unknown>=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Record<string,unknown>;

test('owns complete source features by lexicographic actual vertex with closed-edge/corner ties and exact conservation',()=>{
  const {product}=run();const index=product.index,featuresIndex=index.features;
  assert.deepEqual(index.cells.map(c=>c.region.id),['a-cell','b-cell']);
  assert.deepEqual(index.counts,{sourceRows:6,uniqueFeatures:5,duplicateRows:1,owned:3,outsideDenominator:1,unsupported:1,emittedParts:4,coordinates:37});
  const multi=featuresIndex.find(f=>f.featureId==='multi')!,boundary=featuresIndex.find(f=>f.featureId==='boundary')!,corner=featuresIndex.find(f=>f.featureId==='corner')!,outside=featuresIndex.find(f=>f.featureId==='outside')!,point=featuresIndex.find(f=>f.featureId==='point')!;
  assert.deepEqual(multi.sourceOrdinals,[0,1]);assert.equal(multi.status,'owned');assert.equal(multi.ownerCellId,'a-cell');assert.deepEqual(multi.partIds,['fixture-overture:multi/building/0','fixture-overture:multi/building/1']);assert.deepEqual(multi.touchingCellIds,['a-cell','b-cell']);
  assert.deepEqual(boundary.ownerPoint,[1,.2]);assert.equal(boundary.ownerCellId,'a-cell','closed shared edge resolves by smallest child id');
  assert.deepEqual(corner.ownerPoint,[1,1]);assert.equal(corner.ownerCellId,'a-cell','closed shared corner resolves by smallest child id');
  assert.equal(outside.status,'outside-denominator');assert.equal(outside.ownerCellId,null);assert.deepEqual(outside.touchingCellIds,['a-cell']);
  assert.equal(point.kind,'unsupported');assert.equal(point.status,'unsupported');assert.equal(point.partIds.length,0);
  const a=index.cells[0]!,b=index.cells[1]!;assert.equal(a.status,'owned-features');assert.equal(b.status,'empty-owned');
  assert.ok(a.plan.region.bounds[2]!>1.7,`compilation bounds expand to preserve the full owned multipolygon: ${JSON.stringify(a.plan.region.bounds)}`);
  assert.ok(b.touchingFeatureKeys.includes(multi.key));assert.deepEqual(b.ownerDependencies,['a-cell']);assert.ok(b.touchingFeatureKeys.includes(point.key));assert.ok(b.unresolvedFeatureKeys.includes(point.key));
  assert.ok(a.unresolvedFeatureKeys.includes(outside.key));
  assert.deepEqual(a.plan.rawExtraction,{url:'https://example.test/parent.parquet',fetched:'2026-10-08T00:00:00.000Z',sha256:'b'.repeat(64),bytes:1234});
  assert.deepEqual(parse(product.inputs[0]!.bytes).metadata,{fixture:'synthetic',edition:1,requestHash:'c'.repeat(64),regionalFanout:{requestHash:index.requestHash,parentInputSha256:index.request.parentPlan.input.sha256,logicalCellId:'a-cell',ownership:'lexicographic-source-vertex-closed-cell-id-tie-v1'}});
  assert.equal(product.logicalBytes,product.inputs.reduce((n,item)=>n+item.bytes.byteLength,0)+product.indexBytes.byteLength);
  assert.equal(product.indexBytes.at(-1),10);assert.equal(product.indexHash,sha256(product.indexBytes));
});

test('child inputs compile downstream with exact part identities, holes, multipart order, and road coordinates',()=>{
  const {product}=run();const cell=product.index.cells.find(c=>c.region.id==='a-cell')!;const childBytes=product.inputs.find(i=>i.ref.sha256===cell.input.sha256)!.bytes;
  const compiled=compileRegion(cell.plan.region,cell.plan.source,parse(childBytes));
  const actual=[...compiled.tiles.flatMap(t=>t.buildings.map(b=>({id:b.id,rings:b.rings}))),...compiled.tiles.flatMap(t=>t.roads.map(r=>({id:r.id,points:r.points})))].sort((a,b)=>a.id<b.id?-1:1);
  const expected=product.index.features.filter(f=>f.status==='owned'&&f.ownerCellId==='a-cell').flatMap(f=>f.partIds).sort();
  assert.deepEqual(actual.map(v=>v.id),expected);
  const building=actual.find(v=>v.id.endsWith('/building/0')) as {id:string;rings:unknown[][]};assert.equal(building.rings.length,2);assert.deepEqual(building.rings[0],ring(.8,.2,1.4,.8));
  const road=actual.find(v=>v.id.endsWith('/road/0')) as {id:string;points:unknown[]};assert.deepEqual(road.points,[[1,.2],[1,.8]]);
  assert.equal(compiled.manifest.region.id,'a-cell');assert.equal(compiled.manifest.sources[0]!.id,sourceBase.id);assert.equal(compiled.manifest.sources[0]!.sha256,cell.input.sha256);
});

test('in-range child bounds retain exact decimal edges for downstream boundary roads',()=>{
  const boundaryCell:Region={id:'decimal-edge',parentId:countryId,name:'Decimal edge',kind:'cell',countryCode:'GH',timezone:null,bounds:[.1,0,.5,1]};
  const verticalRoad={type:'Feature',id:'decimal-boundary-road',properties:{highway:'residential'},geometry:{type:'LineString',coordinates:[[.1,.2],[.1,.8]]}};
  const input=bytesOf([verticalRoad]),product=compileRegionalFanout(makeRequest(input,[boundaryCell]),input),cell=product.index.cells[0]!;
  assert.equal(cell.plan.region.bounds[0],.1);
  const derived=product.inputs.find(item=>item.ref.sha256===cell.input.sha256)!.bytes;
  const compiled=compileRegion(cell.plan.region,cell.plan.source,parse(derived));
  assert.deepEqual(compiled.tiles.flatMap(tile=>tile.roads.map(road=>road.points)),[[[.1,.2],[.1,.8]]]);
});

test('canonical request order is stable and exact duplicate rows retain all original ordinals',()=>{
  const a=run(features,[cellA,cellB]),b=run(features,[cellB,cellA]);
  assert.equal(a.product.indexHash,b.product.indexHash);
  assert.deepEqual(a.product.inputs.map(x=>x.ref.sha256),b.product.inputs.map(x=>x.ref.sha256));
  assert.deepEqual(a.product.index.features.find(f=>f.featureId==='multi')!.sourceOrdinals,[0,1]);
  const shuffled=run([unsupported,outsideRoad,cornerRoad,boundaryRoad,multiFeature,structuredClone(multiFeature)]);
  const byFeature=(p:typeof a.product)=>p.index.features.map(f=>({key:f.key,kind:f.kind,owner:f.ownerCellId,parts:f.partIds}));
  assert.deepEqual(byFeature(a.product),byFeature(shuffled.product));
});

test('dateline ownership maps +180 to -180 while preserving the original coordinates',()=>{
  const sourcePoint={type:'Feature',id:'seam',properties:{highway:'primary'},geometry:{type:'LineString',coordinates:[[180,0],[-179.5,.1]]}};
  const west:Region={id:'z-west',parentId:countryId,name:'West seam',kind:'cell',countryCode:'GH',timezone:null,bounds:[-180,-1,-179,1]},east:Region={id:'a-east',parentId:countryId,name:'East seam',kind:'cell',countryCode:'GH',timezone:null,bounds:[179,-1,180,1]};
  const parent:Region={...parentRegion,bounds:[170,-10,-170,10]};const input=bytesOf([sourcePoint]);const basePlan=makeRequest(input).parentPlan as Record<string,unknown>;const request=makeRequest(input,[west,east],{parentPlan:{...basePlan,region:parent}});
  const product=compileRegionalFanout(request,input),row=product.index.features[0]!;
  assert.deepEqual(row.ownerPoint,[-180,0]);assert.equal(row.ownerCellId,'a-east','both closed cells include the seam after +180 normalizes to -180, so code-unit tie selects a-east');assert.deepEqual(parse(product.inputs.find(x=>product.index.cells.find(c=>c.region.id==='a-east')!.input.sha256===x.ref.sha256)!.bytes).features,[sourcePoint]);
});

test('concave polygons use source vertices rather than an exterior bounding-box center; polar cells remain valid',()=>{
  const concave={type:'Feature',id:'concave',properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[[[.2,.2],[1.8,.2],[1.8,.6],[.6,.6],[.6,1.8],[.2,1.8],[.2,.2]]]}};
  const left:Region={id:'left',parentId:countryId,name:'Left',kind:'cell',countryCode:'GH',timezone:null,bounds:[0,0,1,2]},right:Region={id:'right',parentId:countryId,name:'Right',kind:'cell',countryCode:'GH',timezone:null,bounds:[1,0,2,2]};
  const concaveBytes=bytesOf([concave]),concaveProduct=compileRegionalFanout(makeRequest(concaveBytes,[left,right]),concaveBytes),row=concaveProduct.index.features[0]!;
  const center=[1,1],vertices=concave.geometry.coordinates[0]!;
  const inside=(point:number[])=>{let result=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){const xi=vertices[i]![0]!,yi=vertices[i]![1]!,xj=vertices[j]![0]!,yj=vertices[j]![1]!;if((yi>point[1]!)!==(yj>point[1]!)&&point[0]!<(xj-xi)*(point[1]!-yi)/(yj-yi)+xi)result=!result;}return result;};
  assert.equal(inside(center),false);assert.deepEqual(row.ownerPoint,[.2,.2]);assert.equal(row.ownerCellId,'left');

  const polar:Region={id:'aq-parent',parentId:countryId,name:'Polar parent',kind:'cell',countryCode:'GH',timezone:null,bounds:[-20,80,20,90]};
  const north:Region={id:'north-cell',parentId:countryId,name:'North polar cell',kind:'cell',countryCode:'GH',timezone:null,bounds:[-2,89,2,90]};
  const polarFeature={type:'Feature',id:'polar',properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[[[0,89.2],[.2,89.2],[.2,89.4],[0,89.4],[0,89.2]]]}};
  const polarInput=bytesOf([polarFeature]),base=makeRequest(polarInput,[north]);
  const polarRequest={...base,parentPlan:{...(base.parentPlan as Record<string,unknown>),region:polar}};
  const polarProduct=compileRegionalFanout(polarRequest,polarInput);assert.equal(polarProduct.index.features[0]!.ownerCellId,'north-cell');
});

test('rejects non-finite, malformed, degenerate, self-intersecting and oversized supported geometry',()=>{
  const invalids:unknown[][]=[
    [{type:'Feature',id:'bad',properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[]}}],
    [{type:'Feature',id:'bad',properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,1],[0,1],[1,0],[0,0]]]}}],
    [{type:'Feature',id:'bad',properties:{highway:'road'},geometry:{type:'LineString',coordinates:[[0,0],[0,0]]}}],
  ];
  for(const rows of invalids){const input=bytesOf(rows);assert.throws(()=>compileRegionalFanout(makeRequest(input),input));}
  const wide={type:'Feature',id:'wide',properties:{highway:'road'},geometry:{type:'LineString',coordinates:[[-100,0],[100,0]]}};const input=bytesOf([wide]);assert.throws(()=>compileRegionalFanout(makeRequest(input),input),/180 degrees/);
  const invalidPosition={type:'Feature',id:'coord',properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}};const badBytes=new TextEncoder().encode('{"type":"FeatureCollection","metadata":{"requestHash":"'+ 'c'.repeat(64) +'"},"features":['+JSON.stringify(invalidPosition).replace('[1,1]','[999,1]')+']}');const badRequest=makeRequest(badBytes);assert.throws(()=>compileRegionalFanout(badRequest,badBytes),/WGS84/);
});

test('rejects source identity conflicts, request mismatches, and all hard-limit overages',()=>{
  const conflicting=[multiFeature,{...multiFeature,properties:{building:'yes',height:'different'}}],input=bytesOf(conflicting);assert.throws(()=>compileRegionalFanout(makeRequest(input),input),/reused with different/);
  const good=bytesOf([boundaryRoad]),req=makeRequest(good);
  const wrongReceiptMetadata=bytesOf([boundaryRoad],'e'.repeat(64));assert.throws(()=>compileRegionalFanout(makeRequest(wrongReceiptMetadata),wrongReceiptMetadata),/acquisition requestHash/);
  const tampered=new Uint8Array(good);tampered[0]=tampered[0]!^1;assert.throws(()=>compileRegionalFanout(req,tampered),/exact pinned/);
  assert.throws(()=>compileRegionalFanout({...req,limits:{...(req.limits as Record<string,unknown>),inputBytes:1}},good),/input bytes do not match|exceeds/);
  const twoRows=bytesOf([boundaryRoad,boundaryRoad]);assert.throws(()=>compileRegionalFanout(makeRequest(twoRows,[cellA],{limits:{inputBytes:20_000_000,features:1,coordinates:200_000,children:64,outputBytes:30_000_000}}),twoRows),/feature count/);
  assert.throws(()=>compileRegionalFanout({...req,limits:{...(req.limits as Record<string,unknown>),coordinates:1}},good),/coordinate count/);
  assert.throws(()=>compileRegionalFanout({...req,limits:{...(req.limits as Record<string,unknown>),outputBytes:1}},good),/output-byte/);
  const malformed=Uint8Array.from([0xff]);const parentPlan=req.parentPlan as Record<string,unknown>,bad={...req,parentPlan:{...parentPlan,source:{...(parentPlan.source as Record<string,unknown>),sha256:sha256(malformed),bytes:malformed.length},input:{path:'/tmp/pinned-parent.geojson',sha256:sha256(malformed),bytes:malformed.length}}};assert.throws(()=>compileRegionalFanout(bad,malformed),/encoded data|UTF-8/);
});

test('rejects numeric and string feature IDs that collide after stable ID normalization',()=>{
  const numeric={type:'Feature',id:7,properties:{highway:'road'},geometry:{type:'LineString',coordinates:[[.2,.2],[.4,.4]]}};
  const stringId={...numeric,id:'7'};const input=bytesOf([numeric,stringId]);
  assert.throws(()=>compileRegionalFanout(makeRequest(input),input),/reused with different canonical bytes/);
});

test('rejects Nigeria, foreign child identities, overlapping interiors, and children outside the parent',()=>{
  const input=bytesOf([boundaryRoad]),req=makeRequest(input);
  assert.throws(()=>validateRegionalFanoutRequest({...req,id:'bad/../id'}),/safe lowercase/);
  assert.throws(()=>validateRegionalFanoutRequest({...req,inventoryUnitId:'legacy-ng'}),/Nigeria/);
  const ngParent={...(req.parentPlan as Record<string,unknown>),region:{...parentRegion,countryCode:'NG'}};assert.throws(()=>validateRegionalFanoutRequest({...req,parentPlan:ngParent}),/non-Nigeria/);
  assert.throws(()=>validateRegionalFanoutRequest({...req,children:[{...cellA,countryCode:'KE'},cellB]}),/same-country/);
  const overlapping={...cellB,bounds:[.9,0,2,1] as const};assert.throws(()=>validateRegionalFanoutRequest({...req,children:[cellA,overlapping]}),/interiors overlap/);
  const outside={...cellB,bounds:[1,1,2,2] as const};const narrowParent={...(req.parentPlan as Record<string,unknown>),region:{...parentRegion,bounds:[0,0,2,1]}};assert.throws(()=>validateRegionalFanoutRequest({...req,parentPlan:narrowParent,children:[cellA,outside]}),/outside the parent/);
  assert.throws(()=>validateRegionalFanoutRequest({...req,inventoryUnitId:'country:other'}),/country identity/);
});

test('geometry nesting and coordinate caps are enforced before unbounded point retention',()=>{
  let nested:unknown=[1,1];for(let i=0;i<140;i++)nested=[nested];
  const tooDeep=[{type:'Feature',id:'deep',properties:{name:'unsupported'},geometry:{type:'Unknown',coordinates:nested}}];const deepBytes=bytesOf(tooDeep);assert.throws(()=>compileRegionalFanout(makeRequest(deepBytes),deepBytes),/nesting exceeds depth/);
  const many:number[][]=[];for(let i=0;i<20;i++)many.push([i/100,.1]);
  const line={type:'Feature',id:'many',properties:{highway:'road'},geometry:{type:'LineString',coordinates:many}};const coordsBytes=bytesOf([line]);assert.throws(()=>compileRegionalFanout(makeRequest(coordsBytes,[cellA],{limits:{inputBytes:20_000_000,features:5_000,coordinates:10,children:64,outputBytes:30_000_000}}),coordsBytes),/coordinate count/);
});
