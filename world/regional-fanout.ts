import { canonicalJson, sha256 } from './pack.ts';
import { validateTile } from './validate.ts';
import type { Bounds, Position, Region, SourceRecord } from './types.ts';
import type { WorldPlan } from './pipeline.ts';
import type { RegionalCellRow, RegionalFanoutIndex, RegionalFanoutProduct, RegionalFanoutRequest, RegionalFeatureRow } from './regional-fanout-types.ts';

const VERSION='regional-whole-feature-fanout-v1';
const OWNERSHIP='lexicographic-source-vertex-closed-cell-id-tie-v1' as const;
const HARD=Object.freeze({inputBytes:20_000_000,features:5_000,coordinates:200_000,children:64,outputBytes:30_000_000,requestBytes:256_000});
const object=(value:unknown,label:string):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);return value as Record<string,unknown>};
const exact=(value:Record<string,unknown>,allowed:readonly string[],label:string):void=>{for(const key of Object.keys(value))if(!allowed.includes(key))throw new TypeError(`unknown ${label} field: ${key}`);};
const text=(value:unknown,label:string,max=2048):string=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError(`${label} must be bounded non-empty text`);return value;};
const integer=(value:unknown,label:string,min=1,max=Number.MAX_SAFE_INTEGER):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError(`${label} must be an integer in ${min}..${max}`);return value;};
const cmp=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const finite=(value:unknown,label:string):number=>{if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${label} must be finite`);return value;};
function bounds(value:unknown,label:string):Bounds{
  if(!Array.isArray(value)||value.length!==4)throw new TypeError(`${label} must have four bounds`);
  const [w,s,e,n]=value.map((v,i)=>finite(v,`${label}[${i}]`));
  if(w!<-180||w!>180||e!<-180||e!>180||s!< -90||n!>90||s!>=n!||w===e)throw new TypeError(`${label} is invalid`);
  return [w!,s!,e!,n!];
}
function region(value:unknown,label:string):Region{
  const o=object(value,label);exact(o,['id','parentId','name','kind','countryCode','timezone','bounds'],label);
  const id=text(o.id,`${label}.id`,256),parentId=o.parentId===null?null:text(o.parentId,`${label}.parentId`,256),name=text(o.name,`${label}.name`,512);
  if(!['continent','country','admin','city','cell'].includes(String(o.kind)))throw new TypeError(`${label}.kind is invalid`);
  const countryCode=o.countryCode===null?null:text(o.countryCode,`${label}.countryCode`,2);
  if(countryCode!==null&&!/^[A-Z]{2}$/.test(countryCode))throw new TypeError(`${label}.countryCode must be uppercase ISO alpha-2`);
  const timezone=o.timezone===null?null:text(o.timezone,`${label}.timezone`,128);
  if(timezone!==null){try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw new TypeError(`${label}.timezone must be a valid IANA timezone`);}}
  return {id,parentId,name,kind:o.kind as Region['kind'],countryCode,timezone,bounds:bounds(o.bounds,`${label}.bounds`)};
}
function source(value:unknown):SourceRecord{
  const o=object(value,'parentPlan.source');exact(o,['id','url','release','license','attribution','sha256','bytes'],'source');
  const id=text(o.id,'source.id',256),url=text(o.url,'source.url'),release=text(o.release,'source.release',256),license=text(o.license,'source.license',512),attribution=text(o.attribution,'source.attribution',2048),sha=text(o.sha256,'source.sha256',64),bytes=integer(o.bytes,'source.bytes',1,HARD.inputBytes);
  if(!/^[a-f0-9]{64}$/.test(sha))throw new TypeError('source.sha256 must be lowercase SHA-256');
  return {id,url,release,license,attribution,sha256:sha,bytes};
}
function plan(value:unknown):WorldPlan{
  const o=object(value,'parentPlan');exact(o,['region','source','input','rawExtraction'],'parentPlan');
  const r=region(o.region,'parentPlan.region'),s=source(o.source),i=object(o.input,'parentPlan.input');exact(i,['path','sha256','bytes'],'parentPlan.input');
  const inputPath=text(i.path,'parentPlan.input.path',4096),inputSha=text(i.sha256,'parentPlan.input.sha256',64),inputBytes=integer(i.bytes,'parentPlan.input.bytes',1,HARD.inputBytes);
  if(!/^[a-f0-9]{64}$/.test(inputSha)||inputSha!==s.sha256||inputBytes!==s.bytes)throw new TypeError('parent plan source and input pins must match');
  let rawExtraction:WorldPlan['rawExtraction'];
  if(o.rawExtraction!==undefined){const x=object(o.rawExtraction,'parentPlan.rawExtraction');exact(x,['url','fetched','sha256','bytes'],'parentPlan.rawExtraction');const hash=text(x.sha256,'rawExtraction.sha256',64),n=integer(x.bytes,'rawExtraction.bytes');if(!/^[a-f0-9]{64}$/.test(hash))throw new TypeError('rawExtraction.sha256 must be lowercase SHA-256');rawExtraction={url:text(x.url,'rawExtraction.url'),fetched:text(x.fetched,'rawExtraction.fetched'),sha256:hash,bytes:n};}
  return {region:r,source:s,input:{path:inputPath,sha256:inputSha,bytes:inputBytes},...(rawExtraction?{rawExtraction}:{})};
}
function request(value:unknown):RegionalFanoutRequest{
  const raw=object(value,'regional fanout request');
  // Bound traversal before normalizing and hashing the request.
  exact(raw,['schemaVersion','id','inventoryHash','inventoryUnitId','parentPlan','parentAcquisition','children','limits'],'regional fanout request');
  if(raw.schemaVersion!==1)throw new TypeError('unsupported regional fanout schemaVersion');
  const id=text(raw.id,'request.id',48),inventoryHash=text(raw.inventoryHash,'request.inventoryHash',64),inventoryUnitId=text(raw.inventoryUnitId,'request.inventoryUnitId',256);
  if(!/^[a-z0-9][a-z0-9._-]{0,47}$/.test(id))throw new TypeError('request.id must be a safe lowercase campaign identifier');
  if(!/^[a-f0-9]{64}$/.test(inventoryHash))throw new TypeError('inventoryHash must be lowercase SHA-256');
  if(inventoryUnitId==='legacy-ng')throw new TypeError('Nigeria legacy provider is excluded from regional fan-out');
  const parentPlan=plan(raw.parentPlan);
  const extractionRegion=parentPlan.region;
  const parentIdentityMatches=extractionRegion.kind==='country'?extractionRegion.id===inventoryUnitId:extractionRegion.parentId===inventoryUnitId;
  if(!parentIdentityMatches||extractionRegion.countryCode===null||extractionRegion.countryCode==='NG')throw new TypeError('parent extraction plan must resolve to the same non-Nigeria country identity');
  let parentAcquisition:RegionalFanoutRequest['parentAcquisition']=null;
  if(raw.parentAcquisition!==null){const p=object(raw.parentAcquisition,'parentAcquisition');exact(p,['requestHash','receipt'],'parentAcquisition');const requestHash=text(p.requestHash,'parentAcquisition.requestHash',64);if(!/^[a-f0-9]{64}$/.test(requestHash))throw new TypeError('parent acquisition requestHash must be lowercase SHA-256');const rec=object(p.receipt,'parentAcquisition.receipt');exact(rec,['path','sha256','bytes'],'parentAcquisition.receipt');const pth=text(rec.path,'parent receipt path',4096),hash=text(rec.sha256,'parent receipt sha256',64),n=integer(rec.bytes,'parent receipt bytes',1,1_000_000);if(!/^[a-f0-9]{64}$/.test(hash))throw new TypeError('parent acquisition receipt sha256 must be lowercase SHA-256');parentAcquisition={requestHash,receipt:{path:pth,sha256:hash,bytes:n}};}
  if(!Array.isArray(raw.children)||raw.children.length<1||raw.children.length>HARD.children)throw new RangeError('children must contain 1..64 regions');
  const children=raw.children.map((v,i)=>region(v,`children[${i}]`)).sort((a,b)=>cmp(a.id,b.id));
  const limitsRaw=object(raw.limits,'request.limits');exact(limitsRaw,['inputBytes','features','coordinates','children','outputBytes'],'request.limits');
  const limits={inputBytes:integer(limitsRaw.inputBytes,'limits.inputBytes',1,HARD.inputBytes),features:integer(limitsRaw.features,'limits.features',1,HARD.features),coordinates:integer(limitsRaw.coordinates,'limits.coordinates',1,HARD.coordinates),children:integer(limitsRaw.children,'limits.children',1,HARD.children),outputBytes:integer(limitsRaw.outputBytes,'limits.outputBytes',1,HARD.outputBytes)};
  if(parentPlan.input.bytes>limits.inputBytes)throw new RangeError('pinned parent input exceeds request input-byte limit');
  if(children.length>limits.children)throw new RangeError('child count exceeds request limit');
  if(children.some(c=>c.kind!=='cell'||c.countryCode!==parentPlan.region.countryCode||c.parentId!==inventoryUnitId))throw new TypeError('every child must be a same-country cell with the exact inventory parent identity');
  const ids=new Set<string>();for(const child of children){if(ids.has(child.id))throw new TypeError(`duplicate child region id: ${child.id}`);ids.add(child.id);}
  const parentExtent=extent(parentPlan.region.bounds,0);
  if(parentPlan.region.countryCode==='NG')throw new TypeError('Nigeria is excluded from regional fan-out');
  for(const child of children){const c=extent(child.bounds,(parentExtent.west+parentExtent.east)/2);if(c.west<parentExtent.west||c.east>parentExtent.east||child.bounds[1]<parentPlan.region.bounds[1]||child.bounds[3]>parentPlan.region.bounds[3])throw new TypeError(`child ${child.id} is outside the parent country region`);}
  for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){const a=extent(children[i]!.bounds,(parentExtent.west+parentExtent.east)/2),b=extent(children[j]!.bounds,(parentExtent.west+parentExtent.east)/2);if(Math.min(a.east,b.east)>Math.max(a.west,b.west)&&Math.min(children[i]!.bounds[3],children[j]!.bounds[3])>Math.max(children[i]!.bounds[1],children[j]!.bounds[1]))throw new TypeError(`child interiors overlap: ${children[i]!.id} and ${children[j]!.id}`);}
  const result:RegionalFanoutRequest={schemaVersion:1,id,inventoryHash,inventoryUnitId,parentPlan,parentAcquisition,children,limits};
  if(new TextEncoder().encode(canonicalJson(result)).byteLength>HARD.requestBytes)throw new RangeError('regional fanout request exceeds 256000 bytes');
  return result;
}
export function validateRegionalFanoutRequest(value:unknown):RegionalFanoutRequest{return request(value);}

interface Extent {west:number;south:number;east:number;north:number}
function extent(b:Bounds,around:number):Extent{let west=b[0],east=b[2];if(east<west)east+=360;const center=(west+east)/2,shift=360*Math.round((around-center)/360);west+=shift;east+=shift;return {west,south:b[1],east,north:b[3]};}
function longitudeNear(lon:number,around:number):number{return lon+360*Math.round((around-lon)/360);}
function wrappedLongitude(lon:number):number{return lon>=-180&&lon<=180?lon:((lon+180)%360+360)%360-180;}
function ownerLongitude(lon:number):number{return lon===180?-180:lon;}
function geometryPositions(g:Record<string,unknown>,label:string,limit:number):Position[]{
  const points:Position[]=[],stack:Array<{value:unknown;depth:number}>=[{value:g,depth:0}];
  while(stack.length){const current=stack.pop()!,value=current.value;if(current.depth>128)throw new RangeError(`${label} coordinate nesting exceeds depth 128`);if(value===null)continue;
    if(value&&typeof value==='object'&&!Array.isArray(value)){
      const geometry=value as Record<string,unknown>;
      if(geometry.type==='GeometryCollection'){
        if(!Array.isArray(geometry.geometries))throw new TypeError(`${label} GeometryCollection requires geometries`);
        for(let i=geometry.geometries.length-1;i>=0;i--)stack.push({value:object(geometry.geometries[i],`${label}.geometries[${i}]`),depth:current.depth+1});
      }else if(Object.hasOwn(geometry,'coordinates'))stack.push({value:geometry.coordinates,depth:current.depth+1});
      continue;
    }
    if(!Array.isArray(value))throw new TypeError(`${label} coordinates must be nested arrays`);
    if(value.length>=2&&typeof value[0]==='number'&&typeof value[1]==='number'){
      const lon=finite(value[0],`${label} position[0]`),lat=finite(value[1],`${label} position[1]`);
      for(let i=2;i<value.length;i++)finite(value[i],`${label} position[${i}]`);
      if(lon< -180||lon>180||lat< -90||lat>90)throw new TypeError(`${label} position is outside WGS84`);
      if(points.length>=limit)throw new RangeError('source coordinate count exceeds fan-out limit');points.push([lon,lat]);continue;
    }
    for(let i=value.length-1;i>=0;i--){if(!Array.isArray(value[i])&&value[i]!==null)throw new TypeError(`${label} coordinates contain a malformed position`);stack.push({value:value[i],depth:current.depth+1});}
  }
  return points;
}
function childBoundsContains(bounds:Bounds,point:Position):boolean{
  const [west,south,east,north]=bounds,lon=ownerLongitude(point[0]);
  const longitudeMatch=west<=east?(lon>=west&&lon<=east)||(lon===-180&&east===180):(lon>=west||lon<=east);
  return longitudeMatch&&point[1]>=south&&point[1]<=north;
}
function featureBounds(points:Position[],around:number):Extent|null{
  if(!points.length)return null;let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(const p of points){const lon=longitudeNear(p[0],around);west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,p[1]);north=Math.max(north,p[1]);}
  if(east-west>180)throw new RangeError('feature longitude span exceeds 180 degrees; another representation is required');
  if((east-west)*(north-south)>25)throw new RangeError('feature bounding area exceeds 25 square degrees');
  return {west,south,east,north};
}
function asBounds(value:Extent):Bounds{return [wrappedLongitude(value.west),value.south,wrappedLongitude(value.east),value.north];}
function inBox(a:Extent,b:Extent):boolean{return a.west<=b.east&&a.east>=b.west&&a.south<=b.north&&a.north>=b.south;}
function regionForCompilation(child:Region,owned:RegionalFeatureRow[],boundsByKey:Map<string,Extent>,parentCenter:number):Region{
  const logical=extent(child.bounds,parentCenter);let west=logical.west,east=logical.east,south=logical.south,north=logical.north;
  for(const feature of owned){const box=boundsByKey.get(feature.key);if(box){west=Math.min(west,box.west);east=Math.max(east,box.east);south=Math.min(south,box.south);north=Math.max(north,box.north);}}
  if(east-west>180)throw new RangeError(`expanded compilation bounds for ${child.id} exceed 180 degrees`);
  return {...child,bounds:asBounds({west,south,east,north})};
}
function rawFeatureId(value:unknown,index:number):string{if(typeof value!=='string'&&!(typeof value==='number'&&Number.isFinite(value)))throw new TypeError(`feature ${index} needs a stable string or numeric id`);return text(String(value),`feature ${index}.id`,512);}
function polygonParts(type:string,coords:unknown,label:string):unknown[][][]{
  if(type==='Polygon'){
    if(!Array.isArray(coords)||coords.length===0)throw new TypeError(`${label} Polygon must have non-empty rings`);
    return [coords as unknown[][][]];
  }
  if(type==='MultiPolygon'){
    if(!Array.isArray(coords)||coords.length===0)throw new TypeError(`${label} MultiPolygon must have non-empty polygons`);
    return coords.map((poly,index)=>{if(!Array.isArray(poly)||poly.length===0)throw new TypeError(`${label} MultiPolygon part ${index} is empty`);return poly as unknown[][][];});
  }
  throw new TypeError(`${label} is not polygonal`);
}
function position(value:unknown,label:string):Position{if(!Array.isArray(value)||value.length<2)throw new TypeError(`${label} is not a position`);const lon=finite(value[0],`${label}[0]`),lat=finite(value[1],`${label}[1]`);if(lon< -180||lon>180||lat< -90||lat>90)throw new TypeError(`${label} is outside WGS84`);return [lon,lat];}
function validSupportedGeometry(featureId:string,source:SourceRecord,properties:Record<string,unknown>,geometry:Record<string,unknown>,kind:'building'|'road',parts:number):string[]{
  const base=`${source.id}:${featureId}`;
  const tile={schemaVersion:1 as const,id:'regional-geometry-check',regionId:'regional-geometry-check',bounds:[-180,-90,180,90] as Bounds,anchor:{longitude:0,latitude:0,height:0},buildings:[] as Array<{id:string;sourceId:string;rings:Position[][];heightM:number;heightKind:'estimated'}>,roads:[] as Array<{id:string;sourceId:string;points:Position[];class:string;level:number}>};
  const result:string[]=[];
  if(kind==='building'){
    const polygons=polygonParts(String(geometry.type),geometry.coordinates,base);
    for(let part=0;part<polygons.length;part++){
      const rings=polygons[part]!.map((rawRing,ri)=>{if(!Array.isArray(rawRing))throw new TypeError(`${base} ring ${ri} is malformed`);return rawRing.map((p,pi)=>position(p,`${base} ring ${ri} position ${pi}`));});
      tile.buildings.push({id:`${base}/building/${part}`,sourceId:source.id,rings,heightM:6,heightKind:'estimated'});result.push(`${base}/building/${part}`);
    }
  }else{
    const type=String(geometry.type),lines=type==='LineString'?[geometry.coordinates]:type==='MultiLineString'?geometry.coordinates:null;
    if(!Array.isArray(lines)||lines.length===0)throw new TypeError(`${base} road geometry is empty or malformed`);
    for(let i=0;i<lines.length;i++){
      const rawLine=lines[i];if(!Array.isArray(rawLine)||rawLine.length<2)throw new TypeError(`${base} road line ${i} needs at least two points`);
      const points=rawLine.map((p,j)=>position(p,`${base} line ${i} position ${j}`));
      const distinct=points.some(p=>p[0]!==points[0]![0]||p[1]!==points[0]![1]);if(!distinct)throw new TypeError(`${base} road line ${i} has no distinct points`);
      const levelRaw=Number(properties.layer??0),level=Number.isInteger(levelRaw)?levelRaw:0;
      tile.roads.push({id:`${base}/road/${i}`,sourceId:source.id,points,class:String(properties.highway),level});result.push(`${base}/road/${i}`);
    }
  }
  validateTile(tile);
  if(result.length!==parts)throw new Error('feature part identity calculation diverged');
  return result;
}
interface FeatureInternal { key:string;featureId:string;raw:Record<string,unknown>;canonical:string;hash:string;ordinals:number[];kind:'building'|'road'|'unsupported';partIds:string[];positions:Position[];bounds:Extent|null;ownerPoint:Position|null;ownerCellId:string|null;status:'owned'|'outside-denominator'|'unsupported';touching:string[] }
function isBuilding(v:unknown):boolean{return v!==undefined&&v!==null&&v!==false&&v!=='no';}
function canonicalBounds(box:Extent|null):Bounds|null{return box?asBounds(box):null;}
function addFeatures(requestValue:RegionalFanoutRequest,inputBytes:Uint8Array):RegionalFanoutProduct{
  const plan=requestValue.parentPlan,source=plan.source,parent=plan.region,decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inputBytes)) as unknown,fc=object(decoded,'GeoJSON input');
  if(fc.type!=='FeatureCollection'||!Array.isArray(fc.features))throw new TypeError('parent input must be a GeoJSON FeatureCollection');
  const rowsRaw=fc.features;if(rowsRaw.length>requestValue.limits.features)throw new RangeError('source feature count exceeds fan-out limit');
  const meta=fc.metadata===undefined?{}:object(fc.metadata,'FeatureCollection.metadata');
  if(requestValue.parentAcquisition!==null&&meta.requestHash!==requestValue.parentAcquisition.requestHash)throw new TypeError('parent GeoJSON acquisition requestHash does not match its pinned receipt');
  if(Object.hasOwn(meta,'regionalFanout'))throw new TypeError('parent metadata already contains regionalFanout provenance');
  const featureMap=new Map<string,FeatureInternal>();let coordinateCount=0;
  for(let ordinal=0;ordinal<rowsRaw.length;ordinal++){
    const f=object(rowsRaw[ordinal],`features[${ordinal}]`);if(f.type!=='Feature')throw new TypeError(`features[${ordinal}] must be a Feature`);
    const id=rawFeatureId(f.id,ordinal),key=`${source.id}:${id}`,bytes=canonicalJson(f),hash=sha256(bytes),existing=featureMap.get(key);
    if(existing){if(existing.canonical!==bytes)throw new TypeError(`feature id ${id} is reused with different canonical bytes`);existing.ordinals.push(ordinal);const g=existing.raw.geometry===null?null:object(existing.raw.geometry,`feature ${id}.geometry`);coordinateCount+=g?geometryPositions(g,`feature ${id}`,requestValue.limits.coordinates-coordinateCount).length:0;continue;}
    const properties=f.properties===null?{}:object(f.properties,`feature ${id}.properties`),geometry=f.geometry===null?null:object(f.geometry,`feature ${id}.geometry`),positions=geometry?geometryPositions(geometry,`feature ${id}`,requestValue.limits.coordinates-coordinateCount):[];
    coordinateCount+=positions.length;
    const type=geometry===null?'null':String(geometry.type),building=isBuilding(properties.building),highway=properties.highway;
    let kind:'building'|'road'|'unsupported'='unsupported',partIds:string[]=[];
    if(building&&(type==='Polygon'||type==='MultiPolygon')){kind='building';const parts=type==='Polygon'?1:Array.isArray(geometry!.coordinates)?geometry!.coordinates.length:0;partIds=validSupportedGeometry(id,source,properties,geometry!,kind,parts);}
    else if(highway!==undefined&&highway!==null&&(type==='LineString'||type==='MultiLineString')){kind='road';const parts=type==='LineString'?1:Array.isArray(geometry!.coordinates)?geometry!.coordinates.length:0;partIds=validSupportedGeometry(id,source,properties,geometry!,kind,parts);}
    const boundsBox=featureBounds(positions,(extent(parent.bounds,0).west+extent(parent.bounds,0).east)/2);
    featureMap.set(key,{key,featureId:id,raw:f,canonical:bytes,hash,ordinals:[ordinal],kind,partIds,positions,bounds:boundsBox,ownerPoint:null,ownerCellId:null,status:kind==='unsupported'?'unsupported':'outside-denominator',touching:[]});
  }
  const children=requestValue.children,features=[...featureMap.values()];
  for(const feature of features){
    if(feature.bounds){const center=(extent(parent.bounds,0).west+extent(parent.bounds,0).east)/2;const box=feature.bounds;feature.touching=children.filter(child=>{const cell=extent(child.bounds!,center);return inBox(box,cell);}).map(child=>child.id).sort(cmp);}
    if(feature.kind==='unsupported')continue;
    if(!feature.positions.length)throw new TypeError(`supported feature ${feature.key} has no coordinate positions`);
    feature.ownerPoint=feature.positions.map(p=>[ownerLongitude(p[0]),p[1]] as Position).sort((a,b)=>a[0]-b[0]||a[1]-b[1])[0]!;
    const matching=children.filter(child=>childBoundsContains(child.bounds!,feature.ownerPoint!)).map(child=>child.id).sort(cmp);
    feature.ownerCellId=matching[0]??null;feature.status=feature.ownerCellId?'owned':'outside-denominator';
  }
  const rows:RegionalFeatureRow[]=features.sort((a,b)=>cmp(a.key,b.key)).map(f=>({key:f.key,featureId:f.featureId,featureSha256:f.hash,sourceOrdinals:[...f.ordinals],kind:f.kind,partIds:[...f.partIds],ownerPoint:f.ownerPoint,ownerCellId:f.ownerCellId,status:f.status,bounds:canonicalBounds(f.bounds),touchingCellIds:[...f.touching]}));
  const boundsByKey=new Map(features.map(f=>[f.key,f.bounds]).filter((v):v is [string,Extent]=>v[1]!==null));
  const requestHash=sha256(canonicalJson(requestValue));
  const childRows:RegionalCellRow[]=[],inputs:Array<{ref:{path:string;sha256:string;bytes:number};bytes:Uint8Array}>=[];
  let aggregateBytes=0;
  const parentCenter=(extent(parent.bounds,0).west+extent(parent.bounds,0).east)/2;
  for(const child of children){
    const owned=features.filter(f=>f.status==='owned'&&f.ownerCellId===child.id),touching=features.filter(f=>f.touching.includes(child.id));
    const provenance={requestHash,parentInputSha256:plan.input.sha256,logicalCellId:child.id,ownership:OWNERSHIP};
    const childMetadata={...meta,regionalFanout:provenance};
    const childCollection={type:'FeatureCollection',features:owned.sort((a,b)=>cmp(a.key,b.key)).map(f=>f.raw),metadata:childMetadata};
    const body=new TextEncoder().encode(`${canonicalJson(childCollection)}\n`),digest=sha256(body),ref={path:`inputs/${digest}.geojson`,sha256:digest,bytes:body.byteLength};
    aggregateBytes+=body.byteLength;if(aggregateBytes>requestValue.limits.outputBytes)throw new RangeError('fan-out derived child inputs exceed output-byte limit');
    inputs.push({ref,bytes:body});
    const compilationRegion=regionForCompilation(child,rows.filter(r=>owned.some(f=>f.key===r.key)),boundsByKey,parentCenter);
    const derivedSource:SourceRecord={...source,sha256:digest,bytes:body.byteLength};
    const childPlan:WorldPlan={region:compilationRegion,source:derivedSource,input:{path:ref.path,sha256:digest,bytes:body.byteLength},...(plan.rawExtraction?{rawExtraction:plan.rawExtraction}:{})};
    const touchingKeys=touching.map(f=>f.key).sort(cmp),ownedKeys=owned.map(f=>f.key).sort(cmp),dependencies=[...new Set(touching.filter(f=>f.kind!=='unsupported'&&f.ownerCellId!==null&&f.ownerCellId!==child.id).map(f=>f.ownerCellId!))].sort(cmp),unresolved=touching.filter(f=>f.ownerCellId===null||f.status==='unsupported').map(f=>f.key).sort(cmp);
    childRows.push({region:child,status:owned.length?'owned-features':'empty-owned',ownedFeatureKeys:ownedKeys,touchingFeatureKeys:touchingKeys,ownerDependencies:dependencies,unresolvedFeatureKeys:unresolved,input:ref,plan:childPlan});
  }
  const counts={sourceRows:rowsRaw.length,uniqueFeatures:rows.length,duplicateRows:rowsRaw.length-rows.length,owned:features.filter(f=>f.status==='owned').length,outsideDenominator:features.filter(f=>f.status==='outside-denominator').length,unsupported:features.filter(f=>f.status==='unsupported').length,emittedParts:features.filter(f=>f.status==='owned').reduce((n,f)=>n+f.partIds.length,0),coordinates:coordinateCount};
  const index:RegionalFanoutIndex={schemaVersion:1,compilerVersion:VERSION,requestHash,request:requestValue,coverage:'foundation',ownership:OWNERSHIP,intersection:'conservative-feature-bounds',features:rows,cells:childRows,counts,limitations:['Whole-feature ownership uses the lexicographically least actual source vertex within the declared local child denominator; it is not global or authoritative ownership.','Touching candidates use conservative whole-feature bounding boxes, not exact geometry intersections.','Outside-denominator and unsupported source rows remain explicit and are not successful coverage.','The derived cells are foundation inputs; this fan-out does not assert country completeness or gameplay readiness.']};
  const indexBytes=new TextEncoder().encode(`${canonicalJson(index)}\n`);aggregateBytes+=indexBytes.byteLength;if(aggregateBytes>requestValue.limits.outputBytes)throw new RangeError('fan-out logical output exceeds output-byte limit');
  return {index,indexBytes,indexHash:sha256(indexBytes),inputs,logicalBytes:aggregateBytes};
}
export function compileRegionalFanout(requestValue:unknown,inputBytes:Uint8Array):RegionalFanoutProduct{
  const value=request(requestValue);
  if(!(inputBytes instanceof Uint8Array)||inputBytes.byteLength!==value.parentPlan.input.bytes||inputBytes.byteLength>value.limits.inputBytes||sha256(inputBytes)!==value.parentPlan.input.sha256)throw new TypeError('parent input bytes do not match the exact pinned source/input');
  return addFeatures(value,inputBytes);
}
