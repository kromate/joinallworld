import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type TestFeature={type:'Feature';properties:Record<string,unknown>;geometry:{type:'Polygon';coordinates:number[][][]}};
const sha=(b:Uint8Array|string):string=>createHash('sha256').update(b).digest('hex');
const blob=(b:Uint8Array):string=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const canon=(v:unknown):string=>v===null||typeof v==='string'||typeof v==='boolean'?JSON.stringify(v):typeof v==='number'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canon).join(',')}]`:`{${Object.keys(v as object).sort().map(k=>`${JSON.stringify(k)}:${canon((v as Record<string,unknown>)[k])}`).join(',')}}`;
const bytes=(v:unknown,newline=false):Buffer=>Buffer.from(canon(v)+(newline?'\n':''));
const mkdirp=async(root:string,rel:string)=>mkdir(path.join(root,rel),{recursive:true});
const write=async(root:string,rel:string,data:Uint8Array)=>{await mkdirp(root,path.dirname(rel));await writeFile(path.join(root,rel),data);};
const ref=async(root:string,folder:string,value:unknown,newline:boolean)=>{const body=bytes(value,newline),hash=sha(body),relative=`${folder}/${hash}.json`;await write(root,relative,body);return{path:relative,sha256:hash,bytes:body.length};};
const srcRecord=(id:string,url:string,release:string,raw:Buffer,license='Public-domain',attribution='test source')=>({id,url,release,license,attribution,sha256:sha(raw),bytes:raw.length});
export async function createAdmin1TopologyFixture(topologyInvalid=false){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'admin1-independent-'))); const commit='a'.repeat(40),artifact='geojson/ne_10m_admin_1_states_provinces.geojson';
 const feature:TestFeature={type:'Feature',properties:{ne_id:10,adm0_a3:'AAA',name:'Alpha Province',type:'Province',type_en:'Province',gadm_level:1,custom:'preserved'},geometry:{type:'Polygon',coordinates:topologyInvalid?[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[3,3],[4,3],[4,4],[3,4],[3,3]]]:[[[0,0,5],[2,0,5],[2,2,5],[0,2,5],[0,0,5]],[[0.5,0.5,7],[1,0.5,7],[1,1,7],[0.5,1,7],[0.5,0.5,7]]]}};
 const protectedFeature:TestFeature={type:'Feature',properties:{ne_id:11,adm0_a3:'NGA',name:'Nigeria source row',type:null,type_en:'unit',gadm_level:1},geometry:{type:'Polygon',coordinates:[[[2,0],[3,0],[3,1],[2,1],[2,0]]]}};
 const adminFeatures=[feature,protectedFeature]; const adminRaw=bytes({type:'FeatureCollection',features:adminFeatures}); const adminId=`natural-earth-admin1-10m-${commit}`; const adminUrl=`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${commit}/${artifact}`;
 const adminSrc=srcRecord(adminId,adminUrl,commit,adminRaw); const git=blob(adminRaw); const capture={schemaVersion:1,provider:'natural-earth',release:commit,resolution:'10m',metadataPath:'.cache/world-build/evidence/admin1-resolution-research/source-api.json',metadataSha256:'e'.repeat(64),metadataBytes:64,expectedBytes:adminRaw.length,expectedGitBlobSha1:git,license:'Public-domain',attribution:'test source'};
 await write(root,'world/admin1-capture.json',bytes(capture,true));
 const requestHash=sha(canon({release:commit,path:artifact,blob:git,expectedBytes:adminRaw.length}));const input=`.cache/world-build/admin1-source-cache/${requestHash}.geojson`;await write(root,input,adminRaw);
 await write(root,'world/admin1-sources.json',bytes({schemaVersion:1,source:adminSrc,input,gitBlobSha1:git},true));
 const parentCommit=commit,parentId=`natural-earth-admin0-10m-${parentCommit}`; const parentFeatures=[
  {type:'Feature',properties:{NE_ID:1,ADM0_A3:'AAA',ADMIN:'Alpha'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}},
  {type:'Feature',properties:{NE_ID:2,ADM0_A3:'NGA',ADMIN:'Nigeria'},geometry:{type:'Polygon',coordinates:[[[2,0],[3,0],[3,1],[2,1],[2,0]]]}}
 ];const parentRaw=bytes({type:'FeatureCollection',features:parentFeatures}); const parentSrc=srcRecord(parentId,`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${parentCommit}/geojson/ne_10m_admin_0_countries.geojson`,parentCommit,parentRaw);
 const countryId='country:natural-earth:NE_ID%3A1'; const world={id:'world:earth',parentId:null,name:'Earth',kind:'world',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]};
 const continent={id:'continent:africa',parentId:'world:earth',name:'Africa',kind:'continent',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]};
 const alpha={id:countryId,parentId:'continent:africa',name:'Alpha',kind:'country',countryCode:'AA',bounds:null,sourceFeatureIds:[`${parentId}:NE_ID:1`],provider:'world',outline:'missing',exceptions:[]};
 const nigeria={id:'legacy-ng',parentId:'continent:africa',name:'Nigeria',kind:'country',countryCode:'NG',bounds:null,sourceFeatureIds:[`${parentId}:NE_ID:2`],provider:'legacy-ng',outline:'missing',exceptions:['protected']};
 const identity={schemaVersion:1,baselineSourceId:'baseline',candidateSourceId:parentId,baselineUnits:1,candidateUnits:2,retained:[{featureKey:'NE_ID:1',countryId,baselineName:'Alpha',candidateName:'Alpha',metadataChanged:false}],added:[{featureKey:'NE_ID:2',countryId:'legacy-ng',name:'Nigeria'}],missing:[],protectedCountryId:'legacy-ng',exceptions:[]};
 const parentRoot=path.join(root,'.cache/world-build/output/country-inventory'),outputRoot=path.join(root,'.cache/world-build/output/admin1-foundation');
 const identityBytes=bytes(identity),identityHash=sha(identityBytes),identityPath=`identity/${identityHash}.json`;
 const ni=async(node:Record<string,unknown>,children:Array<{id:string,name:string,path:string}>)=>({schemaVersion:1,node,outlineIndexPath:null,children});
 const aNode=await ref(parentRoot,'nodes',await ni(alpha,[]),false); const nNode=await ref(parentRoot,'nodes',await ni(nigeria,[]),false);
 const cNode=await ref(parentRoot,'nodes',await ni(continent,[{id:alpha.id as string,name:alpha.name as string,path:aNode.path},{id:nigeria.id as string,name:nigeria.name as string,path:nNode.path}]),false);
 const wNode=await ref(parentRoot,'nodes',await ni(world,[{id:continent.id,name:continent.name,path:cNode.path}]),false);
 await write(parentRoot,identityPath,identityBytes);
 const baseline={id:'baseline',url:'https://example.test/base',release:'baseline',license:'test',attribution:'test',sha256:'c'.repeat(64),bytes:1};
 const parentManifest={schemaVersion:1,compiler:'country-directory-compiler-v1',source:parentSrc,baselineSource:baseline,baselineInventoryHash:'d'.repeat(64),sourceUnitCount:2,nodeCount:4,outlineCount:0,partCount:0,rootNodePath:wNode.path,identityPath,rollups:[{id:'continent:africa',name:'Africa',countryCount:2,sourceUnitCount:2,exceptionCount:1}],representation:'whole-polygon-groups',limits:{partBytes:512000,countryBytes:2097152,positions:100000},exceptions:[]};
 const pmBytes=bytes(parentManifest),pmHash=sha(pmBytes);await write(parentRoot,`manifests/${pmHash}.json`,pmBytes);
 const parentInput=`.cache/world-build/country-source-cache/${sha(parentRaw)}.geojson`;await write(root,parentInput,parentRaw);
 await write(root,'world/admin1-parent.json',bytes({manifestHash:pmHash,directoryRoot:'.cache/world-build/output/country-inventory',source:parentSrc,input:parentInput},true));
 const mkAudit=(f:TestFeature,ordinal:number,code:string|null,joinStatus:string,country:string|null)=>{const metricPositions=f.geometry.coordinates.reduce((sum,ring)=>sum+ring.length,0);return{sourceOrdinal:ordinal,sourceKey:`NE_ID:${f.properties.ne_id}`,id:`admin1:natural-earth:NE_ID%3A${f.properties.ne_id}`,featureSha256:sha(canon(f)),adm0Code:code,countryId:country,joinStatus,positions:metricPositions,polygons:1,featureBytes:Buffer.byteLength(canon(f)),propertiesBytes:Buffer.byteLength(canon(f.properties)),geometryIssue:null};};
 const row=mkAudit(feature,0,'AAA','linked',countryId),protectedRow=mkAudit(protectedFeature,1,'NGA','protected',null);
 const report={schemaVersion:1,inspector:'natural-earth-admin1-structural-v1',source:adminSrc,parent:{manifestHash:pmHash,source:parentSrc},sourceUnits:2,sourcePositions:15,sourcePolygons:2,linked:1,protected:1,unlinked:0,ambiguous:0,geometryExceptions:0,largestFeatureBytes:Math.max(row.featureBytes,protectedRow.featureBytes),largestFeaturePositions:10,countries:[{countryId,units:1}],missingCountries:[],rows:[row,protectedRow],limitations:['Structural WGS84 coordinate checks only.','Not a legal boundary or sovereignty determination.','This is not playable content.']};
 const reportRef=await ref(outputRoot,'reports',report,true);
 const entry={sourceOrdinal:0,sourceKey:row.sourceKey,id:row.id,featureSha256:row.featureSha256,countryId,joinStatus:'linked',partitionPath:'',exception:null};
 const partitionFeature=feature;
 const partitionValue={schemaVersion:1,product:'natural-earth-admin1-partitions-v1',parentCountryId:countryId,joinStatus:'linked',features:[partitionFeature]};
 const partitionRef=await ref(outputRoot,'partitions',partitionValue,false);entry.partitionPath=partitionRef.path;
 const protectedEntry={sourceOrdinal:1,sourceKey:protectedRow.sourceKey,id:protectedRow.id,featureSha256:protectedRow.featureSha256,countryId:null,joinStatus:'protected',partitionPath:null,exception:'protected-nigeria-no-geometry'};const globalRef=await ref(outputRoot,'indexes',[entry,protectedEntry],false);
 const countryRow={...entry,name:'Alpha Province',sourceType:'Province',sourceTypeEn:'Province',gadmLevel:1,positions:10,polygons:1};
 const countryIx={schemaVersion:1,product:'natural-earth-admin1-partitions-v1',countryId,sourceSha256:adminSrc.sha256,parentManifestHash:pmHash,inspectionSha256:reportRef.sha256,sourceUnits:1,emittedUnits:1,rows:[countryRow]};const countryRef=await ref(outputRoot,'countries',countryIx,true);
 const manifest={schemaVersion:1,product:'natural-earth-admin1-partitions-v1',source:adminSrc,parent:{manifestHash:pmHash,source:parentSrc},validation:{structural:'passed-with-explicit-exceptions',topology:'unverified'},sourceUnits:2,sourcePositions:15,sourcePolygons:2,linked:1,protected:1,unlinked:0,ambiguous:0,emittedUnits:1,exceptionUnits:1,inspection:reportRef,globalIndex:globalRef,partitions:[partitionRef],countries:[{countryId,status:'available',sourceUnits:1,emittedUnits:1,index:countryRef},{countryId:'legacy-ng',status:'protected',sourceUnits:1,emittedUnits:0,index:null}],limitations:['Topology has not been independently verified.','This administrative foundation is not playable content.']};
 const manifestBytes=bytes(manifest,true),manifestHash=sha(manifestBytes);await write(outputRoot,`manifests/${manifestHash}.json`,manifestBytes);
 return{root,manifestHash,countryId,adminRaw,partitionFile:path.join(outputRoot,partitionRef.path),cleanup:()=>rm(root,{recursive:true,force:true})};
}

export async function installFixtureSpatialExtension(repositoryRoot:string):Promise<void>{
 const target=path.join(repositoryRoot,'.cache/world-build/tooling/extensions/v1.5.6/osx_arm64');
 await mkdir(target,{recursive:true});
 const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.cache/world-build/tooling/extensions/v1.5.6/osx_arm64/spatial.duckdb_extension');
 await copyFile(source,path.join(target,'spatial.duckdb_extension'));
}
