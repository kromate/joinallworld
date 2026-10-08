import { createHash } from 'node:crypto';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ClimateMonth, ClimateProfile } from './types.ts';
import type { EnvironmentManifest, EnvironmentRequest, PowerResponseReceipt } from './environment-types.ts';
import { constants } from 'node:fs';
import { createOutputStore } from './storage.ts';

export const POWER_ENDPOINT='https://power.larc.nasa.gov/api/temporal/monthly/point';
export const ENVIRONMENT_LIMITS=Object.freeze({responseBytes:1_000_000,timeoutMs:30_000,retries:2,maxPilots:6,totalResponseBytes:6_000_000});
const PARAMETERS=['T2M','RH2M','PRECTOTCORR','WS10M'] as const;
type Parameter=typeof PARAMETERS[number];
const UNIT_MAP={T2M:'C',RH2M:'%',PRECTOTCORR:'mm/day',WS10M:'m/s'} as const;
const SUMMARIES={
 temperature:'Arithmetic mean of the 30 provider monthly mean temperatures for the same calendar month, degrees Celsius.',
 humidity:'Arithmetic mean of the 30 direct provider RH2M monthly mean relative-humidity values; no derivation from temperature/dewpoint.',
 precipitation:'For each year and month, PRECTOTCORR monthly mean rate (mm/day) multiplied by the actual calendar days in that month; then arithmetic mean of the 30 resulting monthly totals (mm).',
 wind:'Arithmetic mean of the provider scalar WS10M monthly mean wind speeds at 10 m; not a vector-component-derived speed.',
};
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value as object).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(value);
function object(value:unknown,label:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);return value as Record<string,unknown>;}
function strictKeys(value:object,keys:string[],label:string){for(const key of Object.keys(value))if(!keys.includes(key))throw new TypeError(`unknown ${label} field: ${key}`);}
export function validateEnvironmentRequest(value:unknown):EnvironmentRequest{
 const v=object(value,'request');strictKeys(v,['schemaVersion','id','regionId','name','longitude','latitude','baseline'],'request');const b=object(v.baseline,'baseline');strictKeys(b,['startYear','endYear'],'baseline');
 if(v.schemaVersion!==1||[v.id,v.regionId,v.name].some(x=>typeof x!=='string'||!x.trim())||!Number.isFinite(v.longitude)||Number(v.longitude)<-180||Number(v.longitude)>180||!Number.isFinite(v.latitude)||Number(v.latitude)<-90||Number(v.latitude)>90||b.startYear!==1991||b.endYear!==2020)throw new TypeError('request must provide a point and the pinned 1991–2020 baseline');
 return value as EnvironmentRequest;
}
export function powerMonthlyUrl(requestValue:EnvironmentRequest):string{
 const request=validateEnvironmentRequest(requestValue),url=new URL(POWER_ENDPOINT);
 url.search=new URLSearchParams({parameters:PARAMETERS.join(','),community:'SB',longitude:String(request.longitude),latitude:String(request.latitude),start:'1991',end:'2020',format:'JSON'}).toString();return url.href;
}
function checkAllowed(target:string,allowedRoot:string){const root=path.resolve(allowedRoot),absolute=path.resolve(target),relative=path.relative(root,absolute);if(relative===''||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('environment output path must be a dedicated directory inside .cache/world-build');return {root,absolute,relative};}
async function ensureCanonicalDirectory(directory:string):Promise<string>{
 const absolute=path.resolve(directory),filesystemRoot=path.parse(absolute).root,parts=absolute.slice(filesystemRoot.length).split(path.sep).filter(Boolean);let cursor=filesystemRoot,missing=false;
 for(const part of parts){cursor=path.join(cursor,part);if(missing)continue;try{const info=await lstat(cursor);if(info.isSymbolicLink()||!info.isDirectory()||await realpath(cursor)!==cursor)throw new Error(`environment path contains a symlink or non-directory: ${cursor}`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;missing=true;}}
 cursor=filesystemRoot;for(const part of parts){cursor=path.join(cursor,part);try{await mkdir(cursor);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}const info=await lstat(cursor);if(info.isSymbolicLink()||!info.isDirectory()||await realpath(cursor)!==cursor)throw new Error(`environment path changed or is not canonical: ${cursor}`);}
 return absolute;
}
async function verifyCanonicalParent(target:string,allowedRoot:string):Promise<{root:string;absolute:string}>{
 const root=path.resolve(allowedRoot),absolute=path.resolve(target),relative=path.relative(root,absolute);if(!path.isAbsolute(target)||relative===''||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('cached environment source must be inside the allowed build root');
 const rootInfo=await lstat(root);if(rootInfo.isSymbolicLink()||!rootInfo.isDirectory()||await realpath(root)!==root)throw new Error('environment allowed root must be a canonical directory');
 let cursor=root;for(const part of path.dirname(relative).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const info=await lstat(cursor);if(info.isSymbolicLink()||!info.isDirectory()||await realpath(cursor)!==cursor)throw new Error('cached environment source has a non-canonical ancestor');}
 return {root,absolute};
}

export interface PowerFetchOptions {allowedRoot:string;signal?:AbortSignal;fetcher?:typeof fetch;sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;now?:()=>Date;}
async function defaultSleep(ms:number,signal?:AbortSignal){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,ms);if(signal){if(signal.aborted){clearTimeout(timer);reject(signal.reason);return;}signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});}});}
interface ResponseByteBudget {used:number;limit:number;}
async function readResponseBounded(response:Response,limit:number,signal:AbortSignal,budget?:ResponseByteBudget):Promise<Uint8Array>{
 const declaredHeader=response.headers.get('content-length'),declared=declaredHeader===null?NaN:Number(declaredHeader);
 if(Number.isFinite(declared)&&declared>limit){try{await response.body?.cancel();}catch{}throw new RangeError('NASA POWER response exceeds the 1 MB cap');}
 if(Number.isFinite(declared)&&budget&&declared>budget.limit-budget.used){try{await response.body?.cancel();}catch{}throw new RangeError('pilot batch exceeds the 6 MB cumulative response budget');}
 if(!response.body)throw new Error('NASA POWER response body is unavailable');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if(signal.aborted)throw new Error('NASA POWER request aborted');total+=value.byteLength;if(total>limit){budget&&(budget.used+=value.byteLength);await reader.cancel();throw new RangeError('NASA POWER response exceeds the 1 MB cap');}if(budget&&budget.used+value.byteLength>budget.limit){budget.used+=value.byteLength;await reader.cancel();throw new RangeError('pilot batch exceeds the 6 MB cumulative response budget');}if(budget)budget.used+=value.byteLength;chunks.push(value);}}
 finally{reader.releaseLock();}const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}

/** One serial, bounded point request. Raw response bytes are cached before parsing. */
async function fetchPowerMonthlyInner(requestValue:EnvironmentRequest,options:PowerFetchOptions,budget?:ResponseByteBudget):Promise<{manifest:EnvironmentManifest;rawBytes:Uint8Array;receipt:PowerResponseReceipt}>{
 const request=validateEnvironmentRequest(requestValue),url=powerMonthlyUrl(request),fetcher=options.fetcher??fetch,sleep=options.sleep??defaultSleep;
 let lastError:unknown;
 for(let attempt=0;attempt<=ENVIRONMENT_LIMITS.retries;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('NASA POWER request exceeded 30 seconds')),ENVIRONMENT_LIMITS.timeoutMs),signals=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
  try{
   if(options.signal?.aborted)throw new Error('NASA POWER request cancelled');
   const response=await fetcher(url,{method:'GET',redirect:'error',signal:signals,headers:{accept:'application/json'}}),rawBytes=await readResponseBounded(response,ENVIRONMENT_LIMITS.responseBytes,signals,budget);
   if(!response.ok){const retryable=response.status===429||response.status>=500;if(retryable&&attempt<ENVIRONMENT_LIMITS.retries){await sleep(250*(attempt+1),options.signal);continue;}throw new Error(`NASA POWER returned HTTP ${response.status}`);}
   const digest=sha(rawBytes),sourceCache=await ensureCanonicalDirectory(path.join(options.allowedRoot,'environment-source-cache')),sourceStore=await createOutputStore(sourceCache,await ensureCanonicalDirectory(options.allowedRoot)),sourceCachePath=await sourceStore.writeImmutable(`${digest}.json`,rawBytes);
   const fetchedAt=(options.now?.()??new Date()).toISOString(),manifest=buildEnvironmentManifest(request,rawBytes,url);
   const receipt:PowerResponseReceipt={request,url,sha256:digest,bytes:rawBytes.byteLength,sourceCachePath,fetchedAt};
   return {manifest,rawBytes,receipt};
  }catch(error){lastError=error;if(options.signal?.aborted)throw error;if(attempt>=ENVIRONMENT_LIMITS.retries||error instanceof RangeError)throw error;await sleep(250*(attempt+1),options.signal);}
  finally{clearTimeout(timer);}
 }
 throw lastError instanceof Error?lastError:new Error(String(lastError));
}
let requestQueue:Promise<void>=Promise.resolve();
export async function fetchPowerMonthly(requestValue:EnvironmentRequest,options:PowerFetchOptions):Promise<{manifest:EnvironmentManifest;rawBytes:Uint8Array;receipt:PowerResponseReceipt}>{
 return fetchPowerMonthlyBudgeted(requestValue,options);
}
async function fetchPowerMonthlyBudgeted(requestValue:EnvironmentRequest,options:PowerFetchOptions,budget?:ResponseByteBudget):Promise<{manifest:EnvironmentManifest;rawBytes:Uint8Array;receipt:PowerResponseReceipt}>{
 const previous=requestQueue;let release!:()=>void;requestQueue=new Promise<void>(resolve=>{release=resolve;});await previous;try{return await fetchPowerMonthlyInner(requestValue,options,budget);}finally{release();}
}

function expectedKeys():Set<string>{const keys=new Set<string>();for(let year=1991;year<=2020;year++)for(let month=1;month<=13;month++)keys.add(`${year}${String(month).padStart(2,'0')}`);return keys;}
function monthlyValues(raw:Record<string,unknown>,param:Parameter,fillValue:number):Map<string,number>{
 const properties=object(raw.properties,'properties'),parameterMap=object(properties.parameter,'parameter collection'),values=object(parameterMap[param],`${param} values`),keys=Object.keys(values),expected=expectedKeys();
 if(keys.length!==390||keys.some(k=>!expected.has(k))||[...expected].some(k=>!(k in values)))throw new Error(`${param} must contain all 360 month records and 30 annual records for 1991–2020`);
 const months=new Map<string,number>();for(const [key,value] of Object.entries(values)){if(typeof value!=='number'||!Number.isFinite(value)||value===fillValue)throw new Error(`${param} contains an incomplete, fill, or non-finite value at ${key}`);const month=Number(key.slice(4));if(month<=12)months.set(key,value);}
 if(months.size!==360)throw new Error(`${param} monthly record coverage is incomplete`);return months;
}
function mean(values:number[]):number{if(!values.length||values.some(x=>!Number.isFinite(x)))throw new Error('cannot average incomplete values');return values.reduce((sum,value)=>sum+value,0)/values.length;}
function daysInMonth(year:number,month:number){return new Date(Date.UTC(year,month,0)).getUTCDate();}
function makeProfile(request:EnvironmentRequest,raw:Record<string,unknown>,sourceId:string):ClimateProfile{
 const header=object(raw.header,'POWER header'),metadata=object(raw.parameters,'parameter metadata');
 if(!Array.isArray(header.sources)||!header.sources.includes('MERRA2')||!object(header.api,'API metadata').name||!String(object(header.api,'API metadata').name).includes('Monthly')||header.start!=='19910101'||header.end!=='20201231'||header.time_standard!=='LST'||typeof header.fill_value!=='number'||!Number.isFinite(header.fill_value))throw new Error('NASA POWER response metadata does not match the requested MERRA-2 monthly baseline');
 if(header.sources.some(source=>typeof source!=='string'))throw new Error('NASA POWER source list is invalid');
 const geometry=object(raw.geometry,'POWER response geometry'),coordinates=geometry.coordinates;if(geometry.type!=='Point'||!Array.isArray(coordinates)||coordinates.length<2||!Number.isFinite(coordinates[0])||!Number.isFinite(coordinates[1])||Number(coordinates[0]) < -180||Number(coordinates[0])>180||Number(coordinates[1]) < -90||Number(coordinates[1])>90||Number(coordinates[0])!==Number(request.longitude.toFixed(3))||Number(coordinates[1])!==Number(request.latitude.toFixed(3)))throw new Error('NASA POWER response point metadata does not match the requested point rounded to provider precision');
 for(const parameter of PARAMETERS){const meta=object(metadata[parameter],`${parameter} metadata`);if(meta.units!==UNIT_MAP[parameter])throw new Error(`${parameter} unit changed (expected ${UNIT_MAP[parameter]})`);}
 const all=Object.fromEntries(PARAMETERS.map(parameter=>[parameter,monthlyValues(raw,parameter,header.fill_value as number)])) as Record<Parameter,Map<string,number>>;
 const months:ClimateMonth[]=[];
 for(let month=1;month<=12;month++){
  const temp:number[]=[],humidity:number[]=[],precipitation:number[]=[],wind:number[]=[];
  for(let year=1991;year<=2020;year++){const key=`${year}${String(month).padStart(2,'0')}`,days=daysInMonth(year,month);temp.push(all.T2M.get(key)!);humidity.push(all.RH2M.get(key)!);precipitation.push(all.PRECTOTCORR.get(key)!*days);wind.push(all.WS10M.get(key)!);}
  const values={temperatureC:mean(temp),relativeHumidityPct:mean(humidity),precipitationMm:mean(precipitation),windMps:mean(wind)};
  if(values.relativeHumidityPct<0||values.relativeHumidityPct>100||values.precipitationMm<0||values.windMps<0)throw new Error(`derived monthly climate values are outside valid ranges for month ${month}`);
  months.push(values);
 }
 return {sourceId,period:'1991–2020 monthly normals',months};
}
export function buildEnvironmentManifest(requestValue:EnvironmentRequest,rawBytes:Uint8Array,url=powerMonthlyUrl(requestValue)):EnvironmentManifest{
 if(!(rawBytes instanceof Uint8Array)||rawBytes.byteLength<1||rawBytes.byteLength>ENVIRONMENT_LIMITS.responseBytes)throw new RangeError('raw POWER response must be between one byte and the 1 MB response cap');
 const request=validateEnvironmentRequest(requestValue),parsed=object(JSON.parse(new TextDecoder().decode(rawBytes)),'POWER response'),rawHash=sha(rawBytes),header=object(parsed.header,'POWER header'),api=object(header.api,'API metadata'),parameters=object(parsed.parameters,'parameter metadata');
 const source:EnvironmentManifest['source']={id:`nasa-power-merra2-${rawHash.slice(0,16)}`,url,release:`POWER ${String(api.version)} · MERRA-2 · 1991–2020`,license:'NASA Earthdata data-use policy; API response supplies no separate product license',attribution:'NASA Langley Research Center POWER; meteorology from NASA GMAO MERRA-2',sha256:rawHash,bytes:rawBytes.byteLength,provider:'NASA POWER',apiVersion:String(api.version),product:'monthly point',sourceDatasets:[...(header.sources as string[])],timeStandard:String(header.time_standard),fillValue:Number(header.fill_value),units:{T2M:UNIT_MAP.T2M,RH2M:UNIT_MAP.RH2M,PRECTOTCORR:UNIT_MAP.PRECTOTCORR,WS10M:UNIT_MAP.WS10M},spatialResolution:{latitudeDegrees:0.5,longitudeDegrees:0.625},requestedParameters:[...PARAMETERS],monthlyRecordCount:360,annualRecordCount:30};
 for(const parameter of PARAMETERS){const meta=object(parameters[parameter],`${parameter} metadata`);if(meta.units!==UNIT_MAP[parameter])throw new Error(`${parameter} unit changed (expected ${UNIT_MAP[parameter]})`);}
 const profile=makeProfile(request,parsed,source.id);
 const responseGeometry=object(parsed.geometry,'POWER response geometry'),responseCoordinates=responseGeometry.coordinates;if(!Array.isArray(responseCoordinates)||typeof responseCoordinates[0]!=='number'||typeof responseCoordinates[1]!=='number')throw new Error('NASA POWER response point metadata is invalid');
 const manifest:EnvironmentManifest={schemaVersion:1,id:`environment:${request.regionId}:${rawHash.slice(0,16)}`,region:{id:request.regionId,name:request.name},point:{longitude:responseCoordinates[0],latitude:responseCoordinates[1],requestedLongitude:request.longitude,requestedLatitude:request.latitude,semantics:'representative-point-selected-on-native-source-grid'},baseline:{startYear:1991,endYear:2020,years:30},profile,source,derivation:{algorithmVersion:'power-monthly-normal-v1',...SUMMARIES},exceptions:['The requested coordinate is rounded to three decimal places by the NASA POWER service. The returned point is one native-grid sample, not a region-wide spatial average.']};
 return validateEnvironmentManifest(manifest);
}
export function validateEnvironmentManifest(value:unknown):EnvironmentManifest{
 const m=object(value,'environment manifest');strictKeys(m,['schemaVersion','id','region','point','baseline','profile','source','derivation','exceptions'],'manifest');
 if(m.schemaVersion!==1||typeof m.id!=='string'||!m.id)throw new TypeError('environment manifest identity is invalid');
 const region=object(m.region,'region');strictKeys(region,['id','name'],'region');if(typeof region.id!=='string'||!region.id||typeof region.name!=='string'||!region.name)throw new TypeError('environment region is invalid');
 const point=object(m.point,'point');strictKeys(point,['longitude','latitude','requestedLongitude','requestedLatitude','semantics'],'point');if(!Number.isFinite(point.longitude)||Number(point.longitude)<-180||Number(point.longitude)>180||!Number.isFinite(point.latitude)||Number(point.latitude)<-90||Number(point.latitude)>90||!Number.isFinite(point.requestedLongitude)||Number(point.requestedLongitude)<-180||Number(point.requestedLongitude)>180||!Number.isFinite(point.requestedLatitude)||Number(point.requestedLatitude)<-90||Number(point.requestedLatitude)>90||Number(point.longitude)!==Number(Number(point.requestedLongitude).toFixed(3))||Number(point.latitude)!==Number(Number(point.requestedLatitude).toFixed(3))||point.semantics!=='representative-point-selected-on-native-source-grid')throw new TypeError('environment point is invalid');
 const baseline=object(m.baseline,'baseline');strictKeys(baseline,['startYear','endYear','years'],'baseline');if(baseline.startYear!==1991||baseline.endYear!==2020||baseline.years!==30)throw new TypeError('environment baseline is invalid');
 const profile=object(m.profile,'profile');strictKeys(profile,['sourceId','period','months'],'profile');if(typeof profile.sourceId!=='string'||typeof profile.period!=='string'||profile.period!=='1991–2020 monthly normals'||!Array.isArray(profile.months)||profile.months.length!==12)throw new TypeError('climate profile must have exactly 12 months');for(const month of profile.months){const x=object(month,'climate month');strictKeys(x,['temperatureC','relativeHumidityPct','precipitationMm','windMps'],'climate month');if(!Object.values(x).every(n=>typeof n==='number'&&Number.isFinite(n)))throw new TypeError('climate month has non-finite values');if(Number(x.temperatureC)<-100||Number(x.temperatureC)>100||Number(x.relativeHumidityPct)<0||Number(x.relativeHumidityPct)>100||Number(x.precipitationMm)<0||Number(x.windMps)<0)throw new RangeError('climate month has invalid physical ranges');}
 const s=object(m.source,'source');const sourceKeys=['id','url','release','license','attribution','sha256','bytes','provider','apiVersion','product','sourceDatasets','timeStandard','fillValue','units','spatialResolution','requestedParameters','monthlyRecordCount','annualRecordCount'];strictKeys(s,sourceKeys,'source');
 const sourceDatasets=s.sourceDatasets,requestedParameters=s.requestedParameters;
 if([s.id,s.url,s.release,s.license,s.attribution,s.apiVersion,s.timeStandard].some(x=>typeof x!=='string'||!x)||s.provider!=='NASA POWER'||s.product!=='monthly point'||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.bytes)||Number(s.bytes)<1||s.fillValue!==-999||s.monthlyRecordCount!==360||s.annualRecordCount!==30||!Array.isArray(sourceDatasets)||sourceDatasets.length!==2||!sourceDatasets.every(x=>typeof x==='string')||!sourceDatasets.includes('MERRA2')||!sourceDatasets.includes('POWER')||!Array.isArray(requestedParameters)||requestedParameters.length!==PARAMETERS.length||!requestedParameters.every(x=>typeof x==='string')||!PARAMETERS.every(x=>requestedParameters.includes(x))||s.timeStandard!=='LST')throw new TypeError('environment source provenance is invalid');
 const units=object(s.units,'source units');strictKeys(units,[...PARAMETERS],'source units');for(const parameter of PARAMETERS)if(units[parameter]!==UNIT_MAP[parameter])throw new TypeError(`source unit for ${parameter} is invalid`);
 const resolution=object(s.spatialResolution,'source resolution');strictKeys(resolution,['latitudeDegrees','longitudeDegrees'],'source resolution');if(resolution.latitudeDegrees!==0.5||resolution.longitudeDegrees!==0.625)throw new TypeError('MERRA-2 source resolution is invalid');
 if(profile.sourceId!==s.id)throw new TypeError('climate profile sourceId does not resolve to its source record');
 const d=object(m.derivation,'derivation');strictKeys(d,['algorithmVersion','temperature','humidity','precipitation','wind'],'derivation');if(d.algorithmVersion!=='power-monthly-normal-v1'||[d.temperature,d.humidity,d.precipitation,d.wind].some(x=>typeof x!=='string'||!x))throw new TypeError('environment derivation provenance is invalid');
 if(!Array.isArray(m.exceptions)||m.exceptions.some(x=>typeof x!=='string'))throw new TypeError('environment exceptions must be strings');return value as EnvironmentManifest;
}

/** Publish an immutable raw source and its environment sidecar manifest, writing the manifest last. */
export async function publishEnvironment(manifestValue:EnvironmentManifest,rawBytes:Uint8Array,outputRoot:string,allowedRoot:string):Promise<{manifestPath:string;manifestHash:string;sourcePath:string;bytes:number}>{
 const manifest=validateEnvironmentManifest(manifestValue);if(!(rawBytes instanceof Uint8Array)||rawBytes.byteLength<1||rawBytes.byteLength>ENVIRONMENT_LIMITS.responseBytes||rawBytes.byteLength!==manifest.source.bytes||sha(rawBytes)!==manifest.source.sha256)throw new Error('raw POWER source bytes do not match environment provenance or exceed the 1 MB cap');
 await ensureCanonicalDirectory(allowedRoot);const out=checkAllowed(outputRoot,allowedRoot).absolute,store=await createOutputStore(out,path.resolve(allowedRoot));const sourcePath=`sources/${manifest.source.sha256}.json`;await store.writeImmutable(sourcePath,rawBytes);
 const body=canonical(manifest),manifestBytes=new TextEncoder().encode(body),manifestHash=sha(manifestBytes),manifestPath=`manifests/${manifestHash}.json`;await store.writeImmutable(manifestPath,manifestBytes);
 return {manifestPath,manifestHash,sourcePath,bytes:manifestBytes.byteLength+rawBytes.byteLength};
}

/** Produce and publish up to six pilot requests sequentially under one cumulative byte ceiling. */
export async function fetchPilotBatch(requests:EnvironmentRequest[],options:PowerFetchOptions & {outputRoot:string}):Promise<Array<PowerResponseReceipt & {manifestPath:string;manifestHash:string;publishedBytes:number}>>{
 if(!Array.isArray(requests)||requests.length<1||requests.length>ENVIRONMENT_LIMITS.maxPilots)throw new RangeError('pilot batches support one to six requests');
 const ids=new Set<string>(),results:Array<PowerResponseReceipt & {manifestPath:string;manifestHash:string;publishedBytes:number}>=[],budget:ResponseByteBudget={used:0,limit:ENVIRONMENT_LIMITS.totalResponseBytes};
 for(const request of requests){validateEnvironmentRequest(request);if(ids.has(request.id))throw new Error(`duplicate environment request ${request.id}`);ids.add(request.id);const result=await fetchPowerMonthlyBudgeted(request,options,budget);const published=await publishEnvironment(result.manifest,result.rawBytes,options.outputRoot,options.allowedRoot);results.push({...result.receipt,...published,bytes:result.receipt.bytes,publishedBytes:published.bytes});}
 return results;
}

export async function loadCachedRaw(pathValue:string,expectedHash:string,expectedBytes:number,allowedRoot:string):Promise<Uint8Array>{
 if(!/^[a-f0-9]{64}$/.test(expectedHash)||!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>ENVIRONMENT_LIMITS.responseBytes)throw new RangeError('cached raw environment pin must fit the 1 MB response cap');
 const {absolute}=await verifyCanonicalParent(pathValue,allowedRoot),info=await lstat(absolute);if(info.isSymbolicLink()||!info.isFile()||info.size!==expectedBytes)throw new Error('cached raw environment source is missing, not a regular pinned-size file, or corrupt');
 const handle=await open(absolute,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const opened=await handle.stat();if(!opened.isFile()||opened.size!==expectedBytes)throw new Error('cached raw environment source changed before read');const bytes=await handle.readFile();if(bytes.byteLength!==expectedBytes||sha(bytes)!==expectedHash)throw new Error('cached raw environment source is missing, changed, or corrupt');return new Uint8Array(bytes);}finally{await handle.close();}
}
