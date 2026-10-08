import { createHash } from 'node:crypto';
import { canonicalJson } from './pack.ts';
import { ADMIN1_LIMITS, type Admin1AuditRow, type Admin1BuildInput, type Admin1InspectionReport, type Admin1PartitionEntry, type Admin1PartitionPlan, type Admin1JoinStatus } from './admin1-types.ts';
import type { InventoryNode } from './production-types.ts';
import type { SourceRecord } from './types.ts';

type JsonObject = Record<string, unknown>;
type Feature = JsonObject & { type: 'Feature'; properties: JsonObject; geometry: unknown };
type Finding = { report: Admin1InspectionReport; rows: Admin1AuditRow[]; features: Feature[]; featureBodies:string[]; parentCountryNodes: InventoryNode[] };
const HASH=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
export const ADMIN1_SOURCE_KEY_PROPERTY='ne_id' as const;
const cmp=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const sha256=(bytes:Uint8Array|string):string=>createHash('sha256').update(bytes).digest('hex');
function object(value:unknown,label:string):JsonObject{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);return value as JsonObject;}
function parse(bytes:Uint8Array,label:string):unknown{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch{throw new TypeError(`${label} must be fatal-UTF-8 GeoJSON`);}}
function sourceRecord(value:SourceRecord,label:string,release:string,artifact:'admin0'|'admin1'):void{
 const row=object(value,label),expectedPath=artifact==='admin0'?'geojson/ne_10m_admin_0_countries.geojson':'geojson/ne_10m_admin_1_states_provinces.geojson';
 if(Object.keys(row).length!==7||!['id','url','release','license','attribution','sha256','bytes'].every(key=>Object.hasOwn(row,key)))throw new TypeError(`${label} source pin must use the exact SourceRecord fields`);
 if(typeof row.id!=='string'||row.id.length<1||row.id.length>200||typeof row.release!=='string'||!COMMIT.test(row.release)||typeof row.sha256!=='string'||!HASH.test(row.sha256)||!Number.isSafeInteger(row.bytes)||Number(row.bytes)<1||typeof row.license!=='string'||row.license.length<1||row.license.length>512||typeof row.attribution!=='string'||row.attribution.length<1||row.attribution.length>2048)throw new TypeError(`${label} source pin is invalid`);if(row.release!==release)throw new Error(`${label} source release differs from the Admin 1 source release`);
 const expectedUrl=`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/${expectedPath}`;
 if(row.url!==expectedUrl)throw new Error(`${label} URL does not pin the exact Natural Earth ${artifact} artifact`);
}
function safeNeId(value:unknown,label:string):number{
 let n:number;
 if(typeof value==='number'){n=value;if(!Number.isSafeInteger(n)||n<=0)throw new TypeError(`${label} NE_ID must be a positive safe integer`);}
 else if(typeof value==='string'&&/^[1-9][0-9]*$/.test(value)){n=Number(value);if(!Number.isSafeInteger(n)||String(n)!==value)throw new TypeError(`${label} NE_ID must be a positive canonical safe integer`);}
 else throw new TypeError(`${label} NE_ID must be a positive canonical safe integer`);
 return n;
}
function geojson(value:unknown,label:string,maxFeatures:number):Feature[]{const fc=object(value,label);if(fc.type!=='FeatureCollection'||!Array.isArray(fc.features)||fc.features.length<1||fc.features.length>maxFeatures)throw new TypeError(`${label} must be a bounded non-empty FeatureCollection`);return fc.features.map((raw,index)=>{const f=object(raw,`${label} feature ${index}`);if(f.type!=='Feature')throw new TypeError(`${label} feature ${index} type is invalid`);const p=object(f.properties,`${label} feature ${index} properties`);return f as Feature;});}

/** Structural WGS84 validation only: does not establish topology, coverage, or legal boundary correctness. */
function inspectGeometry(value:unknown,label:string,remainingPositions:number):{positions:number;polygons:number;issue:string|null}{
 const countRawPositions=(root:unknown):number=>{let count=0;const stack:unknown[]=[root];while(stack.length){const item=stack.pop();if(!Array.isArray(item))continue;if(item.length>=2&&typeof item[0]==='number'&&typeof item[1]==='number'&&item.every(x=>typeof x==='number')){if(++count>remainingPositions)throw new RangeError('Admin 1 total coordinate positions exceed the aggregate cap');}else for(let i=item.length-1;i>=0;i--)stack.push(item[i]);}return count;};
 if(!value||typeof value!=='object'||Array.isArray(value))return{positions:0,polygons:0,issue:'geometry-is-not-an-object'};const geom=value as JsonObject;if(geom.type!=='Polygon'&&geom.type!=='MultiPolygon')return{positions:countRawPositions(geom.coordinates),polygons:0,issue:'unsupported-geometry-type'};
 if(!Array.isArray(geom.coordinates))return{positions:0,polygons:0,issue:'geometry-coordinates-not-array'};
 const polygonRows=geom.type==='Polygon'?[geom.coordinates]:geom.coordinates;let positions=0,issue:string|null=null;
 if(polygonRows.length===0)issue='geometry-has-no-polygons';
 for(const [polygonIndex,rawPolygon]of polygonRows.entries()){
  if(!Array.isArray(rawPolygon)||rawPolygon.length===0){issue??='polygon-has-no-rings';continue;}
  for(const [ringIndex,rawRing]of rawPolygon.entries()){
   if(!Array.isArray(rawRing)){issue??='ring-is-not-array';continue;}
   const points:number[][]=[];
   for(const rawPosition of rawRing){positions++;if(positions>remainingPositions)throw new RangeError('Admin 1 total coordinate positions exceed the aggregate cap');if(!Array.isArray(rawPosition)||rawPosition.length<2||rawPosition.length>4||rawPosition.some((ordinate)=>typeof ordinate!=='number'||!Number.isFinite(ordinate))){issue??='position-is-not-finite-wgs84';continue;}const point=rawPosition as number[];if(point[0]! < -180||point[0]! > 180||point[1]! < -90||point[1]! > 90)issue??='position-outside-wgs84';points.push(point);}
   if(rawRing.length<4)issue??='ring-has-fewer-than-four-positions';
   const first=rawRing[0],last=rawRing[rawRing.length-1];if(!Array.isArray(first)||!Array.isArray(last)||canonicalJson(first)!==canonicalJson(last))issue??='ring-is-not-closed';
   const unique=new Set(points.slice(0,-1).map(p=>`${p[0]},${p[1]}`));let twiceArea=0;const unwrapped:number[][]=[];if(points.length){unwrapped.push([points[0]![0]!,points[0]![1]!]);for(let i=1;i<points.length;i++){const prev=points[i-1]![0]!,raw=points[i]![0]!;let delta=raw-prev;if(delta>180)delta-=360;else if(delta< -180)delta+=360;unwrapped.push([unwrapped[i-1]![0]!+delta,points[i]![1]!]);}for(let i=0;i+1<unwrapped.length;i++)twiceArea+=unwrapped[i]![0]!*unwrapped[i+1]![1]!-unwrapped[i+1]![0]!*unwrapped[i]![1]!;}
   const winding=unwrapped.length?unwrapped.at(-1)![0]!-unwrapped[0]![0]!:0,polarCapLoop=Math.abs(Math.abs(winding)-360)<1e-6&&points.slice(0,-1).every(point=>point[1]!>0)&&points.some(point=>point[1]!<90-1e-9)||Math.abs(Math.abs(winding)-360)<1e-6&&points.slice(0,-1).every(point=>point[1]!<0)&&points.some(point=>point[1]!> -90+1e-9);
   if(unique.size<3||Math.abs(twiceArea)<1e-12&&!polarCapLoop)issue??='ring-is-degenerate';
   // Keep traversal bounded even for malformed geometry; aggregate limits are enforced by the caller.
   void polygonIndex;void ringIndex;
  }
 }
 return{positions,polygons:polygonRows.length,issue};
}
function validateParent(input:Admin1BuildInput,parentFeatures:Feature[]):InventoryNode[]{
 if(!Array.isArray(input.parent.nodes)||input.parent.nodes.length>ADMIN1_LIMITS.features+100)throw new TypeError('parent hierarchy node count is invalid');
 const sourceId=input.parent.source.id,byRef=new Map<string,InventoryNode>(),nodeIds=new Set<string>();
 for(const rawNode of input.parent.nodes){if(!rawNode||typeof rawNode!=='object'||typeof rawNode.id!=='string'||!['world','continent','country'].includes(rawNode.kind)||!Array.isArray(rawNode.sourceFeatureIds))throw new TypeError('parent hierarchy contains an invalid node');}
 const countryNodes=input.parent.nodes.filter(node=>node.kind==='country');
 const protectedNodes=countryNodes.filter(node=>node.id==='legacy-ng'||node.provider==='legacy-ng'||node.countryCode==='NG');
 if(protectedNodes.length!==1||protectedNodes[0]!.id!=='legacy-ng'||protectedNodes[0]!.provider!=='legacy-ng'||protectedNodes[0]!.countryCode!=='NG')throw new Error('parent hierarchy must contain exactly one protected legacy Nigeria node');
 for(const node of input.parent.nodes){if(!node||typeof node.id!=='string'||nodeIds.has(node.id)||!['world','continent','country'].includes(node.kind)||!Array.isArray(node.sourceFeatureIds))throw new TypeError('parent hierarchy contains an invalid or duplicate node');nodeIds.add(node.id);if(node.kind!=='country'&&node.sourceFeatureIds.length!==0)throw new Error('non-country parent node contains source feature references');}
 for(const node of countryNodes){
  if(node===protectedNodes[0]&&node.sourceFeatureIds.length===0)continue;
  if(node.sourceFeatureIds.length!==1)throw new Error('parent country must bind exactly one Admin 0 source identity');
  const ref=node.sourceFeatureIds[0]!;if(!ref.startsWith(`${sourceId}:NE_ID:`))throw new Error('parent country source identity does not use its pinned Admin 0 source');
  const key=ref.slice(sourceId.length+1);const match=/^NE_ID:([1-9][0-9]*)$/.exec(key);if(!match)throw new Error('parent country source identity is not a canonical NE_ID');const n=Number(match[1]);if(!Number.isSafeInteger(n)||String(n)!==match[1])throw new Error('parent country NE_ID is not a safe integer');
  const expected=node===protectedNodes[0]?'legacy-ng':`country:natural-earth:${encodeURIComponent(key)}`;if(node.id!==expected)throw new Error('parent country ID does not match its stable NE_ID identity');if(byRef.has(ref))throw new Error(`duplicate parent country reference ${ref}`);byRef.set(ref,node);
 }
 const seen=new Set<string>();
 for(const [i,feature]of parentFeatures.entries()){
  const id=safeNeId(feature.properties.NE_ID,`Admin 0 feature ${i}`),ref=`${sourceId}:NE_ID:${id}`;if(seen.has(ref))throw new Error(`duplicate Admin 0 NE_ID ${id}`);seen.add(ref);
  const node=byRef.get(ref);if(!node)throw new Error(`Admin 0 source feature ${ref} has no exact parent country node`);
  const code=feature.properties.ADM0_A3;if(code==='NGA'&&node.id!=='legacy-ng')throw new Error('Admin 0 NGA source unit does not resolve to protected legacy Nigeria');if(node.id==='legacy-ng'&&code!=='NGA')throw new Error('protected legacy Nigeria identity is linked to a non-Nigeria Admin 0 feature');
 }
 if(byRef.size!==seen.size||[...byRef.keys()].some(ref=>!seen.has(ref)))throw new Error('parent country hierarchy contains source identities absent from the pinned Admin 0 artifact');
 return countryNodes;
}
function analyze(input:Admin1BuildInput):Finding{
 if(input.raw.byteLength<1||input.raw.byteLength>ADMIN1_LIMITS.sourceBytes||input.raw.byteLength!==input.source.bytes||sha256(input.raw)!==input.source.sha256)throw new Error('Admin 1 raw source does not match its byte and SHA-256 pin');
 if(!HASH.test(input.parent.manifestHash))throw new TypeError('Admin 0 parent manifest hash must be SHA-256');
 const release=input.source.release;if(!COMMIT.test(release))throw new TypeError('Admin 1 source release must be a full Git commit');sourceRecord(input.source,'Admin 1',release,'admin1');sourceRecord(input.parent.source,'Admin 0',release,'admin0');
 if(input.parent.raw.byteLength<1||input.parent.raw.byteLength>ADMIN1_LIMITS.parentSourceBytes||input.parent.raw.byteLength!==input.parent.source.bytes||sha256(input.parent.raw)!==input.parent.source.sha256)throw new Error('Admin 0 raw source does not match its byte and SHA-256 pin');
 const parentFeatures=geojson(parse(input.parent.raw,'Admin 0'), 'Admin 0',ADMIN1_LIMITS.features),features=geojson(parse(input.raw,'Admin 1'),'Admin 1',ADMIN1_LIMITS.features);const countryNodes=validateParent(input,parentFeatures);
 const parentNodeByRef=new Map<string,InventoryNode>();for(const node of input.parent.nodes)for(const ref of node.sourceFeatureIds)parentNodeByRef.set(ref,node);const byCode=new Map<string,InventoryNode[]>();for(const feature of parentFeatures){const code=feature.properties.ADM0_A3;if(typeof code==='string'&&/^[A-Z]{3}$/.test(code)){const ref=`${input.parent.source.id}:NE_ID:${safeNeId(feature.properties.NE_ID,'Admin 0 feature')}`,node=parentNodeByRef.get(ref);if(!node)throw new Error('Admin 0 code maps to no exact parent identity');const list=byCode.get(code)??[];list.push(node);byCode.set(code,list);}}
 const rows:Admin1AuditRow[]=[],featureByKey=new Map<string,Feature>(),featureBodies:string[]=[];let totalPositions=0,totalPolygons=0,largestFeatureBytes=0,largestFeaturePositions=0;
 for(const [sourceOrdinal,feature]of features.entries()){
  const id=safeNeId(feature.properties[ADMIN1_SOURCE_KEY_PROPERTY],`Admin 1 feature ${sourceOrdinal} ${ADMIN1_SOURCE_KEY_PROPERTY}`),sourceKey=`NE_ID:${id}`;if(featureByKey.has(sourceKey))throw new Error(`duplicate Admin 1 source feature key ${sourceKey}`);featureByKey.set(sourceKey,feature);
  const featureBody=canonicalJson(feature),featureBytes=Buffer.byteLength(featureBody),propertiesBody=canonicalJson(feature.properties),propertiesBytes=Buffer.byteLength(propertiesBody),featureSha256=sha256(featureBody);featureBodies.push(featureBody);
  const geometry=inspectGeometry(feature.geometry,`Admin 1 feature ${sourceOrdinal}`,ADMIN1_LIMITS.positions-totalPositions);totalPositions+=geometry.positions;totalPolygons+=geometry.polygons;largestFeatureBytes=Math.max(largestFeatureBytes,featureBytes);largestFeaturePositions=Math.max(largestFeaturePositions,geometry.positions);
  const rawCode=feature.properties.adm0_a3,adm0Code=typeof rawCode==='string'&&rawCode.length<=32?rawCode:null;let joinStatus:Admin1JoinStatus='unlinked',countryId:string|null=null;
  if(adm0Code==='NGA'){joinStatus='protected';}
  else if(adm0Code&&/^[A-Z]{3}$/.test(adm0Code)){
   const matches=byCode.get(adm0Code)??[];if(matches.length>1)joinStatus='ambiguous';else if(matches.length===1){const node=matches[0]!;if(node.id==='legacy-ng'||node.provider==='legacy-ng'||node.countryCode==='NG')joinStatus='protected';else{joinStatus='linked';countryId=node.id;}}
  }
  let geometryIssue=geometry.issue;if(geometry.positions>ADMIN1_LIMITS.featurePositions)geometryIssue??='feature-position-limit';
  rows.push({sourceOrdinal,sourceKey,id:`admin1:natural-earth:${encodeURIComponent(sourceKey)}`,featureSha256,adm0Code,countryId,joinStatus,positions:geometry.positions,polygons:geometry.polygons,featureBytes,propertiesBytes,geometryIssue});
 }
 rows.sort((a,b)=>cmp(a.sourceKey,b.sourceKey));
 const linked=rows.filter(row=>row.joinStatus==='linked').length,protectedCount=rows.filter(row=>row.joinStatus==='protected').length,unlinked=rows.filter(row=>row.joinStatus==='unlinked').length,ambiguous=rows.filter(row=>row.joinStatus==='ambiguous').length;
 const units=new Map<string,number>();for(const row of rows)if(row.joinStatus==='linked'&&row.countryId)units.set(row.countryId,(units.get(row.countryId)??0)+1);
 const countries=[...units.entries()].map(([countryId,count])=>({countryId,units:count})).sort((a,b)=>cmp(a.countryId,b.countryId));
 const missingCountries=countryNodes.filter(node=>node.id!=='legacy-ng'&&node.provider!=='legacy-ng'&&!units.has(node.id)).map(node=>node.id).sort(cmp);
 const report:Admin1InspectionReport={schemaVersion:1,inspector:'natural-earth-admin1-structural-v1',source:input.source,parent:{manifestHash:input.parent.manifestHash,source:input.parent.source},sourceUnits:rows.length,sourcePositions:totalPositions,sourcePolygons:totalPolygons,linked,protected:protectedCount,unlinked,ambiguous,geometryExceptions:rows.filter(row=>row.geometryIssue!==null).length,largestFeatureBytes,largestFeaturePositions,countries,missingCountries,rows,limitations:['Structural WGS84 coordinate checks only; no spherical or planar topology validation.','The source depiction and country joins are not legal boundary or sovereignty determinations.','This administrative reference product is not playable content.','Natural Earth NE_ID changes across releases do not automatically migrate existing identities.','Oversized, malformed-geometry, and protected units remain explicit source-reference exceptions; no geometry is clipped, simplified, or silently dropped.']};if(Buffer.byteLength(canonicalJson(report))>ADMIN1_LIMITS.reportBytes)throw new RangeError('Admin 1 inspection report exceeds its byte cap');
 return{report,rows,features:features,featureBodies,parentCountryNodes:countryNodes};
}

export function inspectAdmin1Document(input:Admin1BuildInput):Admin1InspectionReport{return analyze(input).report;}

export function planAdmin1Partitions(input:Admin1BuildInput):Admin1PartitionPlan{
 const finding=analyze(input),entries:Admin1PartitionEntry[]=finding.rows.map(row=>({...row,partitionPath:null,exception:null})),featureTextByOrdinal=new Map(finding.featureBodies.map((body,index)=>[index,body]));
 const groups=new Map<string,Admin1PartitionEntry[]>();
 for(const entry of entries){
  if(entry.joinStatus==='protected'){entry.exception='protected-nigeria-no-geometry';continue;}
  if(entry.geometryIssue){entry.exception=entry.geometryIssue;continue;}
  if(entry.propertiesBytes>ADMIN1_LIMITS.propertiesBytes){entry.exception='properties-byte-limit';continue;}
  const groupKey=`${entry.joinStatus}\u0000${entry.countryId??''}`,group=groups.get(groupKey)??[];group.push(entry);groups.set(groupKey,group);
 }
 const assets:Admin1PartitionPlan['assets']=[];
 for(const groupKey of [...groups.keys()].sort(cmp)){
  const [joinStatusRaw,countryIdRaw]=groupKey.split('\u0000'),joinStatus=joinStatusRaw as Admin1JoinStatus,countryId=countryIdRaw||null,group=groups.get(groupKey)!;const emptyEnvelope=canonicalJson({schemaVersion:1,product:'natural-earth-admin1-partitions-v1',parentCountryId:countryId,joinStatus,features:[]}),marker=emptyEnvelope.indexOf('[]'),prefix=emptyEnvelope.slice(0,marker+1),suffix=emptyEnvelope.slice(marker+1),prefixBytes=Buffer.byteLength(prefix),suffixBytes=Buffer.byteLength(suffix);
  group.sort((a,b)=>cmp(a.sourceKey,b.sourceKey));let chunk:Admin1PartitionEntry[]=[];
  const makeAsset=(rows:Admin1PartitionEntry[]):boolean=>{
   const bodies=rows.map(entry=>featureTextByOrdinal.get(entry.sourceOrdinal)!),expectedBytes=prefixBytes+suffixBytes+bodies.reduce((sum,body)=>sum+Buffer.byteLength(body),0)+Math.max(0,bodies.length-1),text=prefix+bodies.join(',')+suffix,bytes=new TextEncoder().encode(text);if(bytes.byteLength!==expectedBytes)throw new Error('Admin 1 partition byte accounting differs from its canonical serialized bytes');
   if(bytes.byteLength>ADMIN1_LIMITS.assetBytes||rows.length>ADMIN1_LIMITS.assetFeatures)return false;
   const digest=sha256(bytes),asset={path:`partitions/${digest}.json`,sha256:digest,bytes,featureKeys:rows.map(row=>row.sourceKey)};assets.push(asset);for(const row of rows)row.partitionPath=asset.path;return true;
  };
  let chunkBytes=prefixBytes+suffixBytes;for(const entry of group){const itemBytes=Buffer.byteLength(featureTextByOrdinal.get(entry.sourceOrdinal)!);const candidateBytes=chunkBytes+itemBytes+(chunk.length?1:0);if(chunk.length&&(chunk.length>=ADMIN1_LIMITS.assetFeatures||candidateBytes>ADMIN1_LIMITS.assetBytes)){if(!makeAsset(chunk))throw new Error('bounded partition chunk failed its own asset cap');chunk=[];chunkBytes=prefixBytes+suffixBytes;}
   const singleBytes=prefixBytes+suffixBytes+itemBytes;if(singleBytes>ADMIN1_LIMITS.assetBytes){entry.exception='asset-byte-limit';continue;}chunk.push(entry);chunkBytes+=itemBytes+(chunk.length>1?1:0);
  }
  if(chunk.length&&!makeAsset(chunk))throw new Error('bounded final partition chunk failed its own asset cap');
 }
 if(assets.length>ADMIN1_LIMITS.assets)throw new RangeError('Admin 1 partition count exceeds the asset cap');
 for(const entry of entries){if(entry.partitionPath&&entry.exception)throw new Error('Admin 1 entry cannot both emit and exception');if(!entry.partitionPath&&!entry.exception)throw new Error(`Admin 1 source feature ${entry.sourceKey} has no partition or exception`);}
 const indexEntries=entries.map(({sourceOrdinal,sourceKey,id,featureSha256,countryId,joinStatus,partitionPath,exception})=>({sourceOrdinal,sourceKey,id,featureSha256,countryId,joinStatus,partitionPath,exception}));
 const indexBytes=new TextEncoder().encode(canonicalJson(indexEntries)),reportBytes=Buffer.byteLength(canonicalJson(finding.report));
 if(indexBytes.byteLength>ADMIN1_LIMITS.indexBytes)throw new RangeError('Admin 1 index exceeds its byte cap');if(reportBytes>ADMIN1_LIMITS.reportBytes)throw new RangeError('Admin 1 inspection report exceeds its byte cap');
 const logicalBytes=assets.reduce((n,asset)=>n+asset.bytes.byteLength,0)+indexBytes.byteLength+reportBytes;if(logicalBytes>ADMIN1_LIMITS.outputBytes)throw new RangeError('Admin 1 partition output exceeds its aggregate byte cap');
 const conservation=entries.length===finding.report.sourceUnits&&entries.every(entry=>entry.partitionPath!==null||entry.exception!==null);if(!conservation)throw new Error('Admin 1 partition plan does not conserve source units');
 return{schemaVersion:1,product:'natural-earth-admin1-partitions-v1',source:input.source,parent:{manifestHash:input.parent.manifestHash,source:input.parent.source},inspection:finding.report,entries,indexEntries,indexBytes,assets,logicalBytes,limitations:['Whole source features only; no clipping, dissolve, simplification, or cross-source fallback.','Oversized and protected units are retained as indexed exceptions and are not represented by partition geometry assets.','This plan is not a published manifest and makes no topology, legal-boundary, or playable-coverage claim.']};
}
