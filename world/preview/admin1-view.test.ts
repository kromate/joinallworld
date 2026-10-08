import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fetchAdmin1Json, fetchAdmin1Manifest, loadSelectedAdmin1Country, selectAdmin1Feature, validateAdmin1CountryIndex, validateAdmin1Manifest, validateAdmin1Partition } from './admin1-view.ts';
import { ADMIN1_PRODUCT, ADMIN1_PRODUCT_LIMITS, type Admin1AssetRef, type Admin1ProductManifest } from '../admin1-product-types.ts';

const release='ca96624a56bd078437bca8184e78163e5039ad19', parentHash='a'.repeat(64), sourceHash='b'.repeat(64), inspectionHash='c'.repeat(64);
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(value:unknown):string=>value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value as object).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
const jsonBytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const ref=(folder:'manifests'|'countries'|'indexes'|'reports'|'partitions',bytes:Uint8Array):Admin1AssetRef=>{const digest=sha(bytes);return{path:`${folder}/${digest}.json`,sha256:digest,bytes:bytes.byteLength};};
const source={id:`natural-earth-admin1-10m-${release}`,url:`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_1_states_provinces.geojson`,release,license:'Public-domain',attribution:'Natural Earth',sha256:sourceHash,bytes:1234};
const parentSource={id:`natural-earth-admin0-10m-${release}`,url:`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_0_countries.geojson`,release,license:'Public-domain',attribution:'Natural Earth',sha256:'d'.repeat(64),bytes:2345};
const ghId='country:natural-earth:NE_ID%3A2';
const shellFeature={type:'Feature',properties:{ne_id:101,name:'District A',type:'County',extra:true},geometry:{type:'Polygon',coordinates:[
  [[179,0,7],[ -179,0,8],[-179,2,9],[179,2,10],[179,0,7]],
  [[179.2,.2,1],[179.8,.2,2],[179.8,.8,3],[179.2,.8,4],[179.2,.2,1]],
]}};
interface TestManifestFixture {manifest:Record<string,unknown>;index:Record<string,unknown>;indexBytes:Uint8Array;partition:Record<string,unknown>;partitionRef:Admin1AssetRef}
function countryIndex(partitionPath:string,rowFeature:Record<string,unknown>=shellFeature){
  const row={sourceOrdinal:0,sourceKey:'NE_ID:101',id:'admin1:natural-earth:NE_ID%3A101',featureSha256:sha(canonical(rowFeature)),countryId:ghId,joinStatus:'linked',partitionPath,exception:null,name:'District A',sourceType:'County',sourceTypeEn:null,gadmLevel:-1,positions:10,polygons:1};
  return{schemaVersion:1,product:ADMIN1_PRODUCT,countryId:ghId,sourceSha256:sourceHash,parentManifestHash:parentHash,inspectionSha256:inspectionHash,sourceUnits:1,emittedUnits:1,rows:[row]};
}
function manifestValue(indexValue?:unknown,countriesOverride?:unknown){
  const partition={schemaVersion:1,product:ADMIN1_PRODUCT,parentCountryId:ghId,joinStatus:'linked',features:[shellFeature]},partitionBytes=jsonBytes(partition),partitionRef=ref('partitions',partitionBytes);
  const actualIndex=(indexValue??countryIndex(partitionRef.path)) as Record<string,unknown>,indexBytes=jsonBytes(actualIndex),indexRef=ref('countries',indexBytes);
  const countries=countriesOverride??[
    {countryId:ghId,status:'available',sourceUnits:1,emittedUnits:1,index:indexRef},
    {countryId:'legacy-ng',status:'protected',sourceUnits:1,emittedUnits:0,index:null},
  ];
  return{manifest:{schemaVersion:1,product:ADMIN1_PRODUCT,source,parent:{manifestHash:parentHash,source:parentSource},validation:{structural:'passed-with-explicit-exceptions',topology:'unverified'},sourceUnits:2,sourcePositions:10,sourcePolygons:1,linked:1,protected:1,unlinked:0,ambiguous:0,emittedUnits:1,exceptionUnits:1,inspection:{path:`reports/${inspectionHash}.json`,sha256:inspectionHash,bytes:200},globalIndex:{path:`indexes/${'f'.repeat(64)}.json`,sha256:'f'.repeat(64),bytes:300},partitions:[partitionRef],countries,limitations:['This is not playable content.','Topology is unverified.']},index:actualIndex,indexBytes,partition,partitionRef} as TestManifestFixture;
}
function fakeResponse(bytes:Uint8Array,status=200):Response{return new Response(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,{status,headers:{'content-length':String(bytes.byteLength)}});}

test('validates strict manifest source, parent, reference, and denominator bindings',()=>{
  const f=manifestValue();const valid=validateAdmin1Manifest(f.manifest,parentHash);assert.equal(valid.source.release,release);
  assert.throws(()=>validateAdmin1Manifest({...f.manifest,extra:true},parentHash),/missing or unknown/);
  assert.throws(()=>validateAdmin1Manifest(f.manifest,'9'.repeat(64)),/different Admin0 parent/);
  assert.throws(()=>validateAdmin1Manifest({...f.manifest,partitions:[{...f.partitionRef,path:'../partitions/a.json'}]},parentHash),/content hash/);
  assert.throws(()=>validateAdmin1Manifest({...f.manifest,emittedUnits:2},parentHash),/does not conserve/);
  for(const invalid of ['country:natural-earth:NE_ID%3A0','country:natural-earth:NE_ID%3A01','country:natural-earth:NE_ID%3A9007199254740992','country:natural-earth:bad','country:natural-earth:NE_ID:2'])assert.throws(()=>validateAdmin1Manifest({...f.manifest,countries:[{...(f.manifest.countries as Array<Record<string,unknown>>)[0],countryId:invalid},(f.manifest.countries as unknown[])[1]]},parentHash),/country|stable Natural Earth/);
  assert.throws(()=>validateAdmin1Manifest({...f.manifest,countries:(f.manifest.countries as unknown[]).slice(1)},parentHash),/protected|conserve/);
  const allException={...f.manifest,sourceUnits:3,unlinked:1,emittedUnits:1,exceptionUnits:2,linked:1,partitions:[{...f.partitionRef}],countries:[
    {countryId:ghId,status:'available',sourceUnits:1,emittedUnits:0,index:{path:`countries/${'1'.repeat(64)}.json`,sha256:'1'.repeat(64),bytes:100}},
    {countryId:'legacy-ng',status:'protected',sourceUnits:1,emittedUnits:0,index:null},
  ]};
  assert.doesNotThrow(()=>validateAdmin1Manifest(allException,parentHash));
  const nullableIndex=countryIndex(f.partitionRef.path);(nullableIndex.rows as Array<Record<string,unknown>>)[0]!.partitionPath=null;(nullableIndex.rows as Array<Record<string,unknown>>)[0]!.exception='explicit source exception';
  const zeroPartition={...f.manifest,partitions:[],emittedUnits:0,exceptionUnits:2,countries:[{countryId:ghId,status:'available',sourceUnits:1,emittedUnits:0,index:{path:`countries/${'2'.repeat(64)}.json`,sha256:'2'.repeat(64),bytes:100}},(f.manifest.countries as unknown[])[1]]};
  assert.doesNotThrow(()=>validateAdmin1Manifest(zeroPartition,parentHash));
  const cap=ADMIN1_PRODUCT_LIMITS.logicalBytes,index=(f.manifest.countries as Array<Record<string,unknown>>)[0]!.index as Record<string,unknown>;
  const exactRefs={...f.manifest,inspection:{...(f.manifest.inspection as Record<string,unknown>),bytes:2*1024*1024},globalIndex:{...(f.manifest.globalIndex as Record<string,unknown>),bytes:2*1024*1024},countries:[{...(f.manifest.countries as Array<Record<string,unknown>>)[0],index:{...index,bytes:256*1024}},(f.manifest.countries as unknown[])[1]],partitions:Array.from({length:92},(_,i)=>({path:`partitions/${String(i+1).padStart(64,'0')}.json`,sha256:String(i+1).padStart(64,'0'),bytes:i===0?786432:1024*1024}))};
  assert.ok((exactRefs.partitions as Array<{bytes:number}>).reduce((sum,item)=>sum+item.bytes,4*1024*1024+256*1024)===cap);
  assert.throws(()=>validateAdmin1Manifest(exactRefs,parentHash),/manifest exceed/);
});

test('validates selected country index row order, provenance, source counts and hash membership',()=>{
  const f=manifestValue(),manifest=validateAdmin1Manifest(f.manifest,parentHash);
  const index=validateAdmin1CountryIndex(f.index,manifest,ghId);assert.equal(index.rows[0]?.gadmLevel,-1);assert.equal(index.rows[0]?.sourceTypeEn,null);
  const metadataIndex={...f.index,rows:[{...(f.index.rows as Array<Record<string,unknown>>)[0],name:'',sourceType:'County\u0001',sourceTypeEn:'',gadmLevel:100}]};
  const preserved=validateAdmin1CountryIndex(metadataIndex,manifest,ghId).rows[0]!;assert.equal(preserved.name,'');assert.equal(preserved.sourceType,'County\u0001');assert.equal(preserved.sourceTypeEn,'');assert.equal(preserved.gadmLevel,100);
  assert.throws(()=>validateAdmin1CountryIndex({...f.index,sourceSha256:'0'.repeat(64)},manifest,ghId),/binding/);
  assert.throws(()=>validateAdmin1CountryIndex({...f.index,emittedUnits:0},manifest,ghId),/denominators/);
  const bad={...f.index,rows:[{...(f.index.rows as Array<Record<string,unknown>>)[0],partitionPath:'partitions/'+ '0'.repeat(64)+'.json'}]};
  assert.throws(()=>validateAdmin1CountryIndex(bad,manifest,ghId),/absent from manifest/);
});

test('validates complete partition membership and preserves holes, extra ordinates, and dateline rings',async()=>{
  const f=manifestValue(),manifest=validateAdmin1Manifest(f.manifest,parentHash),index=validateAdmin1CountryIndex(f.index,manifest,ghId),path=index.rows[0]!.partitionPath!;
  const partition=await validateAdmin1Partition(f.partition,manifest,index,path),selected=await selectAdmin1Feature(partition,index,'NE_ID:101');
  const geometry=selected.geometry as {coordinates:number[][][]};assert.equal(geometry.coordinates.length,2);assert.equal(geometry.coordinates[0]![0]!.length,3);assert.equal(geometry.coordinates[0]![1]![0],-179);
  await assert.rejects(validateAdmin1Partition({...f.partition,parentCountryId:'country:natural-earth:NE_ID%3A3'},manifest,index,path),/parent country/);
  await assert.rejects(validateAdmin1Partition({...f.partition,features:[]},manifest,index,path),/feature count/);
  await assert.rejects(validateAdmin1Partition({...f.partition,features:[shellFeature,shellFeature]},manifest,index,path),/feature count|membership/);
  await assert.rejects(selectAdmin1Feature(partition,index,'NE_ID:999'),/no published/);
  const corrupted={...partition,features:[{...shellFeature,properties:{...shellFeature.properties,name:'forged'}}]};
  await assert.rejects(selectAdmin1Feature(corrupted,index,'NE_ID:101'),/hash failed/);
  await assert.rejects(selectAdmin1Feature({...partition,features:[]},index,'NE_ID:101'),/membership is incomplete/);
  await assert.rejects(selectAdmin1Feature({...partition,features:[...partition.features,...partition.features]},index,'NE_ID:101'),/membership is incomplete/);
  const copiedRow={...index.rows[0]!,sourceOrdinal:1,sourceKey:'NE_ID:102',id:'admin1:natural-earth:NE_ID%3A102'};
  const malformedIndex={...index,rows:[index.rows[0]!,copiedRow]};
  await assert.rejects(selectAdmin1Feature({...partition,features:[...partition.features,...partition.features]},malformedIndex,'NE_ID:101'),/membership/);
});

test('loads only manifest and selected country index; Nigeria loads no index',async()=>{
  const f=manifestValue(),manifestBytes=jsonBytes(f.manifest),manifestHash=sha(manifestBytes),base='https://local.test/world-output/admin1-foundation';
  const countryIndexPath=((f.manifest.countries as Array<{index:{path:string}}>)[0]!).index.path;
  const calls:string[]=[];const fetcher:typeof fetch=async(input)=>{const url=String(input);calls.push(url);if(url.endsWith(`/manifests/${manifestHash}.json`))return fakeResponse(manifestBytes);if(url.endsWith(countryIndexPath))return fakeResponse(f.indexBytes);throw new Error(`unexpected eager request: ${url}`);};
  const loaded=await loadSelectedAdmin1Country(`${base}/manifests/${manifestHash}.json`,manifestHash,parentHash,ghId,undefined,fetcher);
  assert.equal(loaded.index?.countryId,ghId);assert.equal(calls.length,2);assert.equal(loaded.bytes,manifestBytes.byteLength+f.indexBytes.byteLength);
  calls.length=0;const nigeria=await loadSelectedAdmin1Country(`${base}/manifests/${manifestHash}.json`,manifestHash,parentHash,'legacy-ng',undefined,fetcher);
  assert.equal(nigeria.index,null);assert.equal(calls.length,1);
});

test('verifies measured hashes and bounds both stream-reader and response-body cancellation',async()=>{
  const body=jsonBytes({ok:true}),assetRef=ref('countries',body),url=`https://local.test/world-output/admin1-foundation/${assetRef.path}`;
  const loaded=await fetchAdmin1Json(url,assetRef,1024,undefined,async()=>fakeResponse(body));assert.equal(loaded.bytes,body.byteLength);
  await assert.rejects(fetchAdmin1Json(url,{...assetRef,sha256:'0'.repeat(64)},1024,undefined,async()=>fakeResponse(body)),/SHA-256 mismatch/);
  const invalid=new Uint8Array([0xff]),invalidRef=ref('countries',invalid);
  await assert.rejects(fetchAdmin1Json(`https://local.test/world-output/admin1-foundation/${invalidRef.path}`,invalidRef,10,undefined,async()=>fakeResponse(invalid)),/fatal-UTF-8/);
  const oversizeRef={...assetRef,bytes:4};let oversizeCancelled=false;
  const oversize=new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(5));},cancel(){oversizeCancelled=true;return new Promise<void>(()=>{});}}));
  await assert.rejects(fetchAdmin1Json(url,oversizeRef,4,undefined,async()=>oversize),/byte cap/);assert.equal(oversizeCancelled,true);
  const oversizedHeader=new Response(new ReadableStream<Uint8Array>({cancel(){oversizeCancelled=true;return new Promise<void>(()=>{});}}),{headers:{'content-length':'5000'}});
  await assert.rejects(fetchAdmin1Json(url,{...assetRef,bytes:4},4,undefined,async()=>oversizedHeader),/byte cap/);assert.equal(oversizeCancelled,true);
  let cancelled=false;const streamResponse=new Response(new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;return new Promise<void>(()=>{});}}));
  const controller=new AbortController(),waiting=fetchAdmin1Json(url,{...assetRef,bytes:body.byteLength},1024,controller.signal,async()=>streamResponse);
  setTimeout(()=>controller.abort(new Error('test abort')),5);await assert.rejects(waiting,/test abort/);assert.equal(cancelled,true);
});

test('fetches a pinned manifest without inventing an expected byte count',async()=>{
  const body=jsonBytes({schemaVersion:1}),digest=sha(body),url=`https://local.test/world-output/admin1-foundation/manifests/${digest}.json`;
  const fetched=await fetchAdmin1Manifest(url,digest,undefined,async()=>fakeResponse(body));assert.equal(fetched.bytes,body.byteLength);assert.deepEqual(fetched.value,{schemaVersion:1});
});

test('caller cancellation rejects blocked fetch and blocked body reads without becoming timeout',async()=>{
  const body=jsonBytes({waiting:true}),assetRef=ref('countries',body),url=`https://local.test/world-output/admin1-foundation/${assetRef.path}`;
  const fetchController=new AbortController();let fetchAborted=false;
  const hungFetch:typeof fetch=(_input,init)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>{fetchAborted=true;reject(new Error('underlying fetch aborted'));},{once:true}));
  const fetchRequest=fetchAdmin1Json(url,assetRef,1024,fetchController.signal,hungFetch);await Promise.resolve();await Promise.resolve();fetchController.abort(new Error('caller stopped fetch'));
  await assert.rejects(fetchRequest,/caller stopped fetch/);assert.equal(fetchAborted,true);
});

test('aborts a hung asset request at the 25-second deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const body=jsonBytes({waiting:true}),assetRef=ref('countries',body),url=`https://local.test/world-output/admin1-foundation/${assetRef.path}`;
  const fetcher:typeof fetch=(_input,init)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true}));
  const request=fetchAdmin1Json(url,assetRef,1024,undefined,fetcher);
  t.mock.timers.tick(25_001);
  await assert.rejects(request,/25 seconds/);
  t.mock.timers.reset();
});
