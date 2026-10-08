import { ADMIN1_PRODUCT, ADMIN1_PRODUCT_LIMITS } from '../admin1-product-types.ts';
import type { Admin1AssetRef, Admin1CountryIndex, Admin1CountryIndexRow, Admin1CountryRef, Admin1Partition, Admin1ProductManifest } from '../admin1-product-types.ts';

const HASH=/^[a-f0-9]{64}$/; const COMMIT=/^[a-f0-9]{40}$/;
const PATHS={partitions:/^partitions\/[a-f0-9]{64}\.json$/,indexes:/^indexes\/[a-f0-9]{64}\.json$/,reports:/^reports\/[a-f0-9]{64}\.json$/,countries:/^countries\/[a-f0-9]{64}\.json$/};
const record=(value:unknown,label:string):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);return value as Record<string,unknown>;};
function exact(value:Record<string,unknown>,keys:string[],label:string):void{if(Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError(`${label} has missing or unknown fields`);}
function integer(value:unknown,label:string,min:number,max:number):number{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw new RangeError(`${label} is outside its bounded integer range`);return Number(value);}
function text(value:unknown,label:string,max=2048,allowEmpty=false):string{if(typeof value!=='string'||value.length>max||(!allowEmpty&&!value.trim())||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError(`${label} is invalid`);return value;}
function strings(value:unknown,label:string,maxItems:number,maxText=2048):string[]{if(!Array.isArray(value)||value.length>maxItems)throw new TypeError(`${label} is invalid`);return value.map((item,i)=>text(item,`${label}[${i}]`,maxText));}
function source(value:unknown,label:string,artifact:'admin0'|'admin1') {
  const s=record(value,label);exact(s,['id','url','release','license','attribution','sha256','bytes'],label);
  const release=text(s.release,`${label}.release`,40),id=text(s.id,`${label}.id`,256),url=text(s.url,`${label}.url`,2048),license=text(s.license,`${label}.license`,512),attribution=text(s.attribution,`${label}.attribution`,2048);
  const file=artifact==='admin0'?'ne_10m_admin_0_countries.geojson':'ne_10m_admin_1_states_provinces.geojson';
  if(!COMMIT.test(release)||url!==`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/${file}`||id!==`natural-earth-${artifact}-10m-${release}`||license!=='Public-domain'||!HASH.test(String(s.sha256)))throw new TypeError(`${label} must bind the exact Natural Earth ${artifact} artifact and full release`);
  const bytes=integer(s.bytes,`${label}.bytes`,1,artifact==='admin1'?64*1024*1024:16*1024*1024);
  return {id,url,release,license,attribution,sha256:s.sha256 as string,bytes};
}
function asset(value:unknown,label:string,folder:keyof typeof PATHS,maxBytes:number):Admin1AssetRef{
  const a=record(value,label);exact(a,['path','sha256','bytes'],label);const p=text(a.path,`${label}.path`,256),sha256=text(a.sha256,`${label}.sha256`,64);
  if(!PATHS[folder].test(p)||!HASH.test(sha256)||p!==`${folder}/${sha256}.json`)throw new TypeError(`${label} path must bind its content hash`);
  return {path:p,sha256,bytes:integer(a.bytes,`${label}.bytes`,1,maxBytes)};
}
function countryId(value:unknown,label:string):string{
  const id=text(value,label,512);if(id!=='legacy-ng'&&!/^country:natural-earth:NE_ID%3A[1-9][0-9]*$/.test(id))throw new TypeError(`${label} is not a stable Natural Earth country ID`);
  if(id!=='legacy-ng'){const n=Number(id.slice('country:natural-earth:NE_ID%3A'.length));if(!Number.isSafeInteger(n)||String(n)!==id.slice('country:natural-earth:NE_ID%3A'.length))throw new TypeError(`${label} is not a canonical safe Natural Earth country ID`);}return id;
}
function validateCountryRef(value:unknown,index:number):Admin1CountryRef{
  const c=record(value,`manifest countries[${index}]`);exact(c,['countryId','status','sourceUnits','emittedUnits','index'],`manifest countries[${index}]`);
  const id=countryId(c.countryId,`country ${index} ID`);
  if(!['available','missing','protected'].includes(String(c.status)))throw new TypeError(`country ${index} status is invalid`);
  const sourceUnits=integer(c.sourceUnits,`country ${index} source units`,0,ADMIN1_PRODUCT_LIMITS.sourceUnits),emittedUnits=integer(c.emittedUnits,`country ${index} emitted units`,0,sourceUnits);
  const indexRef=c.index===null?null:asset(c.index,`country ${index} index`,'countries',ADMIN1_PRODUCT_LIMITS.countryIndexBytes);
  if(id==='legacy-ng'){
    if(c.status!=='protected'||sourceUnits<0||emittedUnits!==0||indexRef!==null)throw new Error('Nigeria must remain protected and have no Admin1 geometry index');
  }else if(c.status==='available'){
    if(!indexRef||sourceUnits<1)throw new Error(`available country ${id} must have its selected index`);
  }else if(c.status==='missing'){
    if(indexRef!==null||sourceUnits!==0||emittedUnits!==0)throw new Error(`missing country ${id} cannot have a source index or units`);
  }else throw new Error('only legacy Nigeria may be protected');
  return {countryId:id,status:c.status as Admin1CountryRef['status'],sourceUnits,emittedUnits,index:indexRef};
}
export function validateAdmin1Manifest(value:unknown,parentManifestHash:string):Admin1ProductManifest{
  if(!HASH.test(parentManifestHash))throw new TypeError('expected Admin0 parent manifest hash is invalid');
  const m=record(value,'Admin1 product manifest');exact(m,['schemaVersion','product','source','parent','validation','sourceUnits','sourcePositions','sourcePolygons','linked','protected','unlinked','ambiguous','emittedUnits','exceptionUnits','inspection','globalIndex','partitions','countries','limitations'],'Admin1 product manifest');
  if(m.schemaVersion!==1||m.product!==ADMIN1_PRODUCT)throw new TypeError('Admin1 product manifest schema/product is unsupported');
  const src=source(m.source,'Admin1 source','admin1'),p=record(m.parent,'Admin1 parent');exact(p,['manifestHash','source'],'Admin1 parent');
  if(p.manifestHash!==parentManifestHash)throw new Error('Admin1 manifest is bound to a different Admin0 parent');
  const parentSource=source(p.source,'Admin0 parent source','admin0');if(parentSource.release!==src.release)throw new Error('Admin0 and Admin1 sources must share the exact full commit');
  const validation=record(m.validation,'Admin1 validation');exact(validation,['structural','topology'],'Admin1 validation');
  if(validation.structural!=='passed-with-explicit-exceptions'||validation.topology!=='unverified')throw new Error('Admin1 structural/topology status is unsupported');
  const count=(key:string,max:number=ADMIN1_PRODUCT_LIMITS.sourceUnits)=>integer(m[key],`manifest ${key}`,0,max);
  const sourceUnits=count('sourceUnits'),sourcePositions=count('sourcePositions',3_000_000),sourcePolygons=count('sourcePolygons',1_000_000),linked=count('linked'),protectedCount=count('protected'),unlinked=count('unlinked'),ambiguous=count('ambiguous'),emittedUnits=count('emittedUnits'),exceptionUnits=count('exceptionUnits');
  if(sourceUnits<1||sourceUnits!==linked+protectedCount+unlinked+ambiguous||emittedUnits+exceptionUnits!==sourceUnits)throw new Error('Admin1 source/emitted/exception denominator does not conserve');
  const inspection=asset(m.inspection,'inspection report','reports',ADMIN1_PRODUCT_LIMITS.reportBytes),globalIndex=asset(m.globalIndex,'global index','indexes',ADMIN1_PRODUCT_LIMITS.globalIndexBytes);
  if(!Array.isArray(m.partitions)||m.partitions.length>ADMIN1_PRODUCT_LIMITS.partitions)throw new TypeError('Admin1 partitions list is invalid');
  const partitions=m.partitions.map((item,i)=>asset(item,`partitions[${i}]`,'partitions',ADMIN1_PRODUCT_LIMITS.partitionBytes));
  if(new Set(partitions.map(item=>item.path)).size!==partitions.length)throw new Error('Admin1 partition references are duplicated');
  if(!Array.isArray(m.countries)||m.countries.length<1||m.countries.length>ADMIN1_PRODUCT_LIMITS.countries)throw new TypeError('Admin1 country references are invalid');
  const countries=m.countries.map(validateCountryRef);let countryUnits=0,countryEmitted=0,protectedCountryCount=0,legacyUnits=0,previous='';
  for(const c of countries){if(previous&&previous>=c.countryId)throw new Error('Admin1 countries must have unique sorted IDs');previous=c.countryId;if(c.countryId==='legacy-ng'){protectedCountryCount++;legacyUnits=c.sourceUnits;}countryUnits+=c.sourceUnits;countryEmitted+=c.emittedUnits;}
  if(protectedCountryCount!==1||countryUnits!==linked+protectedCount||legacyUnits!==protectedCount||countryEmitted>emittedUnits||emittedUnits-countryEmitted>unlinked+ambiguous)throw new Error('Admin1 country references do not conserve manifest counters');
  let logicalBytes=inspection.bytes+globalIndex.bytes+partitions.reduce((total,ref)=>total+ref.bytes,0);const countryIndexPaths=new Set<string>();
  for(const c of countries)if(c.index){if(countryIndexPaths.has(c.index.path))throw new Error('Admin1 country index references are duplicated');countryIndexPaths.add(c.index.path);logicalBytes+=c.index.bytes;}
  logicalBytes+=new TextEncoder().encode(`${canonical(m)}\n`).byteLength;
  if(logicalBytes>ADMIN1_PRODUCT_LIMITS.logicalBytes)throw new RangeError('Admin1 referenced assets and manifest exceed the 96 MiB logical cap');
  if(!Array.isArray(m.limitations)||m.limitations.length<1)throw new TypeError('Admin1 limitations are required');
  const limitations=strings(m.limitations,'Admin1 limitations',100);
  if(!limitations.some(x=>x.toLowerCase().includes('not playable'))||!limitations.some(x=>x.toLowerCase().includes('topology')))throw new Error('Admin1 limitations must disclose playability and topology status');
  return {schemaVersion:1,product:ADMIN1_PRODUCT,source:src,parent:{manifestHash:parentManifestHash,source:parentSource},validation:{structural:'passed-with-explicit-exceptions',topology:'unverified'},sourceUnits,sourcePositions,sourcePolygons,linked,protected:protectedCount,unlinked,ambiguous,emittedUnits,exceptionUnits,inspection,globalIndex,partitions,countries,limitations};
}
function indexRow(value:unknown,index:number,manifest:Admin1ProductManifest,country:string):Admin1CountryIndexRow{
  const row=record(value,`country index row ${index}`);exact(row,['sourceOrdinal','sourceKey','id','featureSha256','countryId','joinStatus','partitionPath','exception','name','sourceType','sourceTypeEn','gadmLevel','positions','polygons'],`country index row ${index}`);
  const ordinal=integer(row.sourceOrdinal,`row ${index} source ordinal`,0,manifest.sourceUnits-1),key=text(row.sourceKey,`row ${index} source key`,128);
  const id=`admin1:natural-earth:${encodeURIComponent(key)}`;
  const match=/^NE_ID:([1-9][0-9]*)$/.exec(key);if(!match||!Number.isSafeInteger(Number(match[1]))||String(Number(match[1]))!==match[1]||row.id!==id||!HASH.test(String(row.featureSha256)))throw new Error(`country index row ${index} has an invalid source identity`);
  if(row.countryId!==country||row.joinStatus!=='linked')throw new Error(`country index row ${index} is not linked to the selected country`);
  const partitionPath=row.partitionPath===null?null:text(row.partitionPath,`row ${index} partition path`,256);
  if(partitionPath!==null&&!PATHS.partitions.test(partitionPath))throw new Error(`country index row ${index} partition path is invalid`);
  const exception=row.exception===null?null:text(row.exception,`row ${index} exception`,512);
  if((partitionPath===null)===(exception===null))throw new Error(`country index row ${index} must have exactly one partition or exception`);
  const sourceMetadata=(field:string):string|null=>{const raw=row[field];if(raw===null)return null;if(typeof raw!=='string'||raw.length>2048)throw new TypeError(`row ${index} ${field} is invalid`);return raw;};
  const gadmLevel=row.gadmLevel===null?null:integer(row.gadmLevel,`row ${index} GADM level`,-1,100);
  return {sourceOrdinal:ordinal,sourceKey:key,id,featureSha256:row.featureSha256 as string,countryId:country,joinStatus:'linked',partitionPath,exception,
    name:sourceMetadata('name'),sourceType:sourceMetadata('sourceType'),sourceTypeEn:sourceMetadata('sourceTypeEn'),gadmLevel,
    positions:integer(row.positions,`row ${index} positions`,0,manifest.sourcePositions),polygons:integer(row.polygons,`row ${index} polygons`,0,manifest.sourcePolygons)};
}
export function validateAdmin1CountryIndex(value:unknown,manifest:Admin1ProductManifest,country:string):Admin1CountryIndex{
  const ref=manifest.countries.find(item=>item.countryId===country);
  if(!ref||ref.status!=='available'||!ref.index)throw new Error('selected country has no available Admin1 index');
  const i=record(value,'Admin1 country index');exact(i,['schemaVersion','product','countryId','sourceSha256','parentManifestHash','inspectionSha256','sourceUnits','emittedUnits','rows'],'Admin1 country index');
  if(i.schemaVersion!==1||i.product!==ADMIN1_PRODUCT||i.countryId!==country||i.sourceSha256!==manifest.source.sha256||i.parentManifestHash!==manifest.parent.manifestHash||i.inspectionSha256!==manifest.inspection.sha256)throw new Error('Admin1 country index source or parent binding is invalid');
  const sourceUnits=integer(i.sourceUnits,'country index source units',1,manifest.sourceUnits),emittedUnits=integer(i.emittedUnits,'country index emitted units',0,sourceUnits);
  if(sourceUnits!==ref.sourceUnits||emittedUnits!==ref.emittedUnits||!Array.isArray(i.rows)||i.rows.length!==sourceUnits)throw new Error('Admin1 country index denominators do not match manifest');
  const rows=i.rows.map((row,index)=>indexRow(row,index,manifest,country)),keys=new Set<string>(),ids=new Set<string>(),ordinals=new Set<number>();let prior='',emitted=0;
  for(const row of rows){if(prior&&prior>=row.sourceKey)throw new Error('Admin1 country index keys must be sorted and unique');prior=row.sourceKey;if(keys.has(row.sourceKey)||ids.has(row.id)||ordinals.has(row.sourceOrdinal))throw new Error('Admin1 country index repeats a key, ID, or source ordinal');keys.add(row.sourceKey);ids.add(row.id);ordinals.add(row.sourceOrdinal);if(row.partitionPath){emitted++;if(!manifest.partitions.some(ref=>ref.path===row.partitionPath))throw new Error('country index references a partition absent from manifest');}}
  if(emitted!==emittedUnits)throw new Error('Admin1 country index emitted count does not match its rows');
  return {schemaVersion:1,product:ADMIN1_PRODUCT,countryId:country,sourceSha256:manifest.source.sha256,parentManifestHash:manifest.parent.manifestHash,inspectionSha256:manifest.inspection.sha256,sourceUnits,emittedUnits,rows};
}
function canonical(value:unknown):string{
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('partition contains a non-finite number');return JSON.stringify(value);}
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object'){const obj=value as Record<string,unknown>;return `{${Object.keys(obj).sort().map(key=>`${JSON.stringify(key)}:${canonical(obj[key])}`).join(',')}}`;}
  throw new TypeError('partition contains a non-JSON value');
}
async function digest(bytes:Uint8Array):Promise<string>{const hash=await crypto.subtle.digest('SHA-256',bytes.slice().buffer as ArrayBuffer);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function validateGeometry(value:unknown,state:{positions:number}):{positions:number;polygons:number}{
  const before=state.positions;
  const geometry=record(value,'Admin1 feature geometry');if(geometry.type!=='Polygon'&&geometry.type!=='MultiPolygon')throw new TypeError('published Admin1 partition has unsupported geometry');
  let polygons=0;
  const checkRing=(ring:unknown):void=>{
    if(!Array.isArray(ring)||ring.length<4)throw new TypeError('Admin1 ring requires at least four positions');
    let first:number[]|undefined,last:number[]|undefined;const unique=new Set<string>();
    for(const raw of ring){if(!Array.isArray(raw)||raw.length<2||raw.length>4||raw.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw new TypeError('Admin1 position must preserve two to four finite ordinates');const point=raw as number[];if(point[0]! < -180||point[0]! > 180||point[1]! < -90||point[1]! > 90)throw new RangeError('Admin1 position is outside WGS84');state.positions++;if(state.positions>ADMIN1_PRODUCT_LIMITS.partitionPositions)throw new RangeError('Admin1 partition exceeds 150,000 positions');if(!first)first=point;if(last)unique.add(`${last[0]},${last[1]}`);last=point;}
    const close=ring[0] as number[],end=ring[ring.length-1] as number[];if(close.length!==end.length||close.some((v,i)=>v!==end[i]))throw new TypeError('Admin1 ring is not closed');
    const distinct=new Set((ring as number[][]).slice(0,-1).map(point=>`${point[0]},${point[1]}`));if(distinct.size<3)throw new TypeError('Admin1 ring has fewer than three distinct vertices');
  };
  const polygon=(value:unknown):void=>{if(!Array.isArray(value)||value.length<1)throw new TypeError('Admin1 polygon must retain an exterior ring');polygons++;for(const ring of value)checkRing(ring);};
  if(geometry.type==='Polygon')polygon(geometry.coordinates);else{if(!Array.isArray(geometry.coordinates)||geometry.coordinates.length<1)throw new TypeError('Admin1 multipolygon is empty');for(const item of geometry.coordinates)polygon(item);}
  const count=state.positions-before;if(count>ADMIN1_PRODUCT_LIMITS.featurePositions)throw new RangeError('Admin1 feature exceeds 100,000 positions');return {positions:count,polygons};
}
export async function validateAdmin1Partition(value:unknown,manifest:Admin1ProductManifest,index:Admin1CountryIndex,partitionPath:string):Promise<Admin1Partition>{
  const ref=manifest.partitions.find(item=>item.path===partitionPath);if(!ref)throw new Error('partition is not listed in the pinned manifest');
  const p=record(value,'Admin1 partition');exact(p,['schemaVersion','product','parentCountryId','joinStatus','features'],'Admin1 partition');
  if(p.schemaVersion!==1||p.product!==ADMIN1_PRODUCT||!['linked','unlinked','ambiguous'].includes(String(p.joinStatus))||!Array.isArray(p.features)||p.features.length<1||p.features.length>ADMIN1_PRODUCT_LIMITS.partitionFeatures)throw new TypeError('Admin1 partition schema or feature count is invalid');
  if(p.joinStatus==='linked'&&p.parentCountryId!==index.countryId||p.joinStatus!=='linked'&&p.parentCountryId!==null)throw new Error('Admin1 partition parent country does not match its join status');
  const rows=index.rows.filter(row=>row.partitionPath===partitionPath);
  if(p.joinStatus!=='linked'||rows.length!==p.features.length)throw new Error('partition has no complete selected-country index membership');
  const state={positions:0},seen=new Set<string>();
  for(const featureValue of p.features){const feature=record(featureValue,'Admin1 original feature');const props=record(feature.properties,'Admin1 feature properties');const rawId=props.ne_id;if(typeof rawId!=='number'&&typeof rawId!=='string')throw new TypeError('Admin1 original feature lacks lowercase ne_id');const n=typeof rawId==='string'&&/^[1-9][0-9]*$/.test(rawId)?Number(rawId):rawId;if(!Number.isSafeInteger(n)||Number(n)<1||String(n)!==String(rawId))throw new TypeError('Admin1 lowercase ne_id must be a canonical positive safe integer');const key=`NE_ID:${n}`,row=rows.find(candidate=>candidate.sourceKey===key);if(!row||seen.has(key)||row.countryId!==index.countryId)throw new Error('partition feature is missing, duplicated, or bound to another country index');seen.add(key);if(feature.type!=='Feature'||!('geometry'in feature))throw new TypeError('partition feature is not a full original GeoJSON feature');const metrics=validateGeometry(feature.geometry,state);if(metrics.positions!==row.positions||metrics.polygons!==row.polygons)throw new Error(`Admin1 geometry metrics differ from the verified country index for ${key}`);if(await digest(new TextEncoder().encode(canonical(feature)))!==row.featureSha256)throw new Error(`Admin1 original feature hash mismatch for ${key}`);}
  if(seen.size!==rows.length||rows.some(row=>!seen.has(row.sourceKey)))throw new Error('partition omits an indexed source feature');
  return {schemaVersion:1,product:ADMIN1_PRODUCT,parentCountryId:p.parentCountryId as string|null,joinStatus:p.joinStatus as Admin1Partition['joinStatus'],features:p.features as Array<Record<string,unknown>>};
}
export async function selectAdmin1Feature(partition:Admin1Partition,index:Admin1CountryIndex,sourceKey:string):Promise<Record<string,unknown>>{
  const row=index.rows.find(item=>item.sourceKey===sourceKey);if(!row||!row.partitionPath)throw new Error('selected Admin1 source key has no published feature partition');
  if(partition.schemaVersion!==1||partition.product!==ADMIN1_PRODUCT||!Array.isArray(partition.features))throw new Error('partition schema is invalid');
  if(partition.parentCountryId!==index.countryId||partition.joinStatus!=='linked')throw new Error('partition does not belong to selected country');
  const expectedRows=index.rows.filter(item=>item.partitionPath===row.partitionPath);if(partition.features.length!==expectedRows.length)throw new Error('partition feature membership is incomplete');
  const seen=new Set<string>(),state={positions:0};let selected:Record<string,unknown>|undefined;
  for(const feature of partition.features){if(feature.type!=='Feature')throw new Error('partition contains a non-Feature value');const props=record(feature.properties,'Admin1 feature properties'),n=props.ne_id;if(typeof n!=='number'&&typeof n!=='string')throw new Error('partition feature has no lowercase ne_id');const numeric=typeof n==='string'&&/^[1-9][0-9]*$/.test(n)?Number(n):n;if(!Number.isSafeInteger(numeric)||Number(numeric)<1||String(numeric)!==String(n))throw new Error('partition feature ne_id is not canonical');const key=`NE_ID:${numeric}`,expected=expectedRows.find(item=>item.sourceKey===key);if(!expected||seen.has(key)||expected.countryId!==index.countryId)throw new Error('partition membership does not match country index');seen.add(key);const metrics=validateGeometry(feature.geometry,state);if(metrics.positions!==expected.positions||metrics.polygons!==expected.polygons||await digest(new TextEncoder().encode(canonical(feature)))!==expected.featureSha256)throw new Error('partition geometry metrics or original feature hash failed verification');if(key===sourceKey)selected=feature;}
  if(seen.size!==expectedRows.length||expectedRows.some(item=>!seen.has(item.sourceKey))||!selected)throw new Error('partition omits or duplicates indexed features');return selected;
}
function sameOrigin(url:URL):void{
  if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname.toLowerCase())))throw new TypeError('Admin1 asset URL must be safe same-origin HTTPS');
  const current=(globalThis as typeof globalThis&{location?:Location}).location;if(current&&url.origin!==current.origin)throw new TypeError('Admin1 assets must remain same-origin');
}
async function fetchVerifiedJson(url:string,expectedHash:string,expectedBytes:number|null,maxBytes:number,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<{value:unknown;bytes:number}>{
  const parsed=new URL(url);sameOrigin(parsed);if(!HASH.test(expectedHash)||expectedBytes!==null&&(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>maxBytes))throw new TypeError('Admin1 fetch URL/reference binding is invalid');
  if(!parsed.pathname.includes('/manifests/')&&!/\/(?:countries|partitions|indexes|reports)\/[a-f0-9]{64}\.json$/.test(parsed.pathname))throw new TypeError('Admin1 asset URL must use a content-addressed output route');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>ADMIN1_PRODUCT_LIMITS.partitionBytes)throw new RangeError('Admin1 response cap exceeds the 1 MiB browser limit');
  if(signal?.aborted)throw signal.reason??new DOMException('Admin1 request aborted','AbortError');
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,cancelPromise:Promise<void>|undefined,bodyComplete=false,timedOut=false;
  let rejectAbort!:(reason:unknown)=>void;const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const boundedWaitCancel=(operation:Promise<unknown>):Promise<void>=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const bounded=Promise.race([operation.then(()=>undefined,()=>undefined),new Promise<void>(resolve=>{timer=setTimeout(resolve,100);})]);
    return bounded.finally(()=>{if(timer!==undefined)clearTimeout(timer);});
  };
  const boundedCancel=():Promise<void>=>{
    if(!reader)return Promise.resolve();
    if(!cancelPromise)cancelPromise=boundedWaitCancel(Promise.resolve().then(()=>reader!.cancel(controller.signal.reason)));
    return cancelPromise;
  };
  const boundedCancelBody=(body:ReadableStream<Uint8Array>,reason:unknown):Promise<void>=>boundedWaitCancel(Promise.resolve().then(()=>body.cancel(reason)));
  const abort=(reason?:unknown,isTimeout=false):void=>{if(isTimeout)timedOut=true;if(!controller.signal.aborted)controller.abort(reason);rejectAbort(reason??new DOMException('Admin1 request aborted','AbortError'));void boundedCancel();};
  const onAbort=()=>abort(signal?.reason??new DOMException('Admin1 request aborted','AbortError'));signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted)onAbort();
  const timeout=setTimeout(()=>abort(new DOMException('Admin1 asset request exceeded 25 seconds','TimeoutError'),true),25_000);
  const timeCheck=()=>{if(signal?.aborted)throw signal.reason??new DOMException('Admin1 request aborted','AbortError');if(timedOut)throw new DOMException('Admin1 asset request exceeded 25 seconds','TimeoutError');};
  const wait=<T>(promise:Promise<T>):Promise<T>=>Promise.race([promise,aborted]);
  try{
    const response=await wait(Promise.resolve().then(()=>fetcher(parsed.href,{signal:controller.signal,redirect:'error'})));timeCheck();if(!response.ok)throw new Error(`Admin1 asset request failed (${response.status})`);if(!response.body)throw new Error('Admin1 response has no body');
    const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>maxBytes){const error=new RangeError('Admin1 response exceeds its byte cap');await boundedCancelBody(response.body,error);throw error;}
    reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){timeCheck();const part=await wait(reader.read());timeCheck();if(part.done){bodyComplete=true;break;}size+=part.value.byteLength;if(size>maxBytes){const error=new RangeError('Admin1 response exceeds its byte cap');abort(error);throw error;}chunks.push(part.value);}}
    finally{if(!bodyComplete)await boundedCancel();try{reader.releaseLock();}catch{/* An uncooperative pending read retains its lock until it settles. */}}
    if(expectedBytes!==null&&size!==expectedBytes)throw new Error('Admin1 response byte count differs from its reference');
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    if(await digest(bytes)!==expectedHash)throw new Error('Admin1 response SHA-256 mismatch');
    let parsedJson:unknown;try{parsedJson=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch{throw new TypeError('Admin1 response is not fatal-UTF-8 JSON');}
    timeCheck();return{value:parsedJson,bytes:size};
  }catch(error){if(timedOut)throw new DOMException('Admin1 asset request exceeded 25 seconds','TimeoutError');throw error;}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);if(reader&&!bodyComplete){await boundedCancel();try{reader.releaseLock();}catch{/* Cancellation has been requested; do not wait forever for a broken stream. */}}}
}
export function fetchAdmin1Json(url:string,ref:Admin1AssetRef,maxBytes:number,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<{value:unknown;bytes:number}>{
  if(!HASH.test(ref.sha256)||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>maxBytes)throw new TypeError('Admin1 asset reference byte/hash is invalid');
  const parsed=new URL(url);if(parsed.pathname!==`/${ref.path}`&&!parsed.pathname.endsWith(`/${ref.path}`))throw new TypeError('Admin1 fetch URL does not match its content-hash path');
  return fetchVerifiedJson(url,ref.sha256,ref.bytes,maxBytes,signal,fetcher);
}
export function fetchAdmin1Manifest(url:string,hash:string,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<{value:unknown;bytes:number}>{
  const parsed=new URL(url);if(!HASH.test(hash)||!parsed.pathname.endsWith(`/manifests/${hash}.json`))throw new TypeError('Admin1 manifest URL/hash mismatch');
  return fetchVerifiedJson(url,hash,null,ADMIN1_PRODUCT_LIMITS.manifestBytes,signal,fetcher);
}
function assetUrl(manifestUrl:string,assetPath:string):string{
  const base=new URL(manifestUrl),slash=base.pathname.lastIndexOf('/manifests/');if(slash<0)throw new TypeError('Admin1 manifest URL must use the immutable manifests route');
  base.pathname=`${base.pathname.slice(0,slash)}/${assetPath}`;base.search='';base.hash='';sameOrigin(base);return base.href;
}
export async function loadSelectedAdmin1Country(manifestUrl:string,manifestHash:string,parentManifestHash:string,country:string,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<{manifest:Admin1ProductManifest;index:Admin1CountryIndex|null;bytes:number}>{
  if(!HASH.test(manifestHash)||!HASH.test(parentManifestHash))throw new TypeError('Admin1 manifest and parent hashes are required');
  const url=new URL(manifestUrl);sameOrigin(url);if(!url.pathname.endsWith(`/manifests/${manifestHash}.json`))throw new TypeError('Admin1 manifest URL does not match its pinned hash');
  const loaded=await fetchAdmin1Manifest(url.href,manifestHash,signal,fetcher);const manifest=validateAdmin1Manifest(loaded.value,parentManifestHash),ref=manifest.countries.find(item=>item.countryId===country);
  if(!ref)throw new Error('selected country is absent from Admin1 manifest');
  if(country==='legacy-ng'){if(ref.status!=='protected'||ref.index!==null)throw new Error('Nigeria Admin1 geometry is prohibited');return{manifest,index:null,bytes:loaded.bytes};}
  if(ref.status==='missing')return{manifest,index:null,bytes:loaded.bytes};if(!ref.index)throw new Error('selected available country has no index reference');
  const countryUrl=assetUrl(url.href,ref.index.path),countryData=await fetchAdmin1Json(countryUrl,ref.index,ADMIN1_PRODUCT_LIMITS.countryIndexBytes,signal,fetcher);
  const index=validateAdmin1CountryIndex(countryData.value,manifest,country);return{manifest,index,bytes:loaded.bytes+countryData.bytes};
}
