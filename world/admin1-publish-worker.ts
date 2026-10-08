import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { canonicalJson } from './pack.ts';
import { planAdmin1Partitions } from './admin1-partition.ts';
import { ADMIN1_PRODUCT, ADMIN1_PRODUCT_LIMITS, type Admin1CountryIndex, type Admin1CountryIndexRow } from './admin1-product-types.ts';
import type { Admin1BuildInput, Admin1InspectionReport, Admin1PartitionEntry } from './admin1-types.ts';
import type { InventoryNode } from './production-types.ts';
import type { SourceRecord } from './types.ts';

interface Input { source: SourceRecord; raw: ArrayBuffer; parent: { manifestHash: string; source: SourceRecord; raw: ArrayBuffer; nodes: InventoryNode[] }; inspection: ArrayBuffer; inspectionHash: string }
interface Asset { path: string; sha256: string; bytes: ArrayBuffer }
interface Output { report: Asset; globalIndex: Asset; partitions: Asset[]; countries: Array<{ countryId:string; asset:Asset; sourceUnits:number; emittedUnits:number }>; entries: Admin1PartitionEntry[]; inspection: Admin1InspectionReport; sourceUnits:number; emittedUnits:number; protected:number; unlinked:number; ambiguous:number; exceptionUnits:number; logicalBytes:number }
const sha=(bytes:Uint8Array|string):string=>createHash('sha256').update(bytes).digest('hex');
function asBytes(buffer:ArrayBuffer,source:SourceRecord,label:string):Uint8Array{const bytes=new Uint8Array(buffer);if(bytes.length!==source.bytes||sha(bytes)!==source.sha256)throw new Error(`${label} bytes differ from pinned source`);return bytes;}
function ownedBuffer(bytes:Uint8Array):ArrayBuffer{if(bytes.buffer instanceof ArrayBuffer&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength)return bytes.buffer;const copy=new ArrayBuffer(bytes.byteLength);new Uint8Array(copy).set(bytes);return copy;}
function asset(path:string,bytes:Uint8Array):Asset{return{path,sha256:sha(bytes),bytes:ownedBuffer(bytes)};}
function jsonLine(value:unknown):Uint8Array{return new TextEncoder().encode(`${canonicalJson(value)}\n`);}
function sourceText(value:unknown,key:string):string|null{if(value===null||value===undefined)return null;if(typeof value!=='string'||value.length<1||value.length>2048||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError(`Admin1 source label ${key} is not bounded source text`);return value;}
function sourceLevel(value:unknown):number|null{if(value===null||value===undefined)return null;if(!Number.isSafeInteger(value)||Number(value)<-1||Number(value)>100)throw new TypeError('Admin1 source gadm_level is not a bounded integer');return Number(value);}
function transferables(value:Output):ArrayBuffer[]{return[value.report.bytes,value.globalIndex.bytes,...value.partitions.map(x=>x.bytes),...value.countries.map(x=>x.asset.bytes)];}
try{
 if(!parentPort)throw new Error('Admin1 publisher requires its supervised worker');
 const input=workerData as Input,raw=asBytes(input.raw,input.source,'Admin1 source'),parentRaw=asBytes(input.parent.raw,input.parent.source,'Admin0 source'),inspectionBytes=new Uint8Array(input.inspection);
 if(sha(inspectionBytes)!==input.inspectionHash)throw new Error('Admin1 inspection bytes differ from their report hash');
 const expected=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inspectionBytes)) as Admin1InspectionReport;
 const labels=new Map<number,{name:string|null;sourceType:string|null;sourceTypeEn:string|null;gadmLevel:number|null}>();
 const plan=planAdmin1Partitions({source:input.source,raw,parent:{manifestHash:input.parent.manifestHash,source:input.parent.source,raw:parentRaw,nodes:input.parent.nodes}},(sourceOrdinal,properties)=>{labels.set(sourceOrdinal,{name:sourceText(properties.name,'name'),sourceType:sourceText(properties.type,'type'),sourceTypeEn:sourceText(properties.type_en,'type_en'),gadmLevel:sourceLevel(properties.gadm_level)});});
 const regenerated=new TextEncoder().encode(`${canonicalJson(plan.inspection)}\n`);
 if(sha(regenerated)!==input.inspectionHash||regenerated.length!==inspectionBytes.length||!regenerated.every((byte,index)=>byte===inspectionBytes[index]))throw new Error('regenerated Admin1 inspection report differs from the pinned report');
 if(canonicalJson(expected)!==canonicalJson(plan.inspection))throw new Error('pinned Admin1 inspection semantic content differs from regenerated report');
 if(labels.size!==plan.entries.length)throw new Error('Admin1 source label observer did not conserve source ordinals');
 const report:Asset={path:`reports/${input.inspectionHash}.json`,sha256:input.inspectionHash,bytes:input.inspection};
 const globalIndex=asset(`indexes/${sha(plan.indexBytes)}.json`,plan.indexBytes);
 const partitions=plan.assets.map(item=>({path:item.path,sha256:item.sha256,bytes:ownedBuffer(item.bytes)}));
 const byCountry=new Map<string,Admin1CountryIndexRow[]>();
 for(const entry of plan.entries){if(entry.joinStatus!=='linked'||!entry.countryId)continue;const label=labels.get(entry.sourceOrdinal);if(!label)throw new Error('Admin1 source ordinal does not resolve to captured country labels');const row:Admin1CountryIndexRow={sourceOrdinal:entry.sourceOrdinal,sourceKey:entry.sourceKey,id:entry.id,featureSha256:entry.featureSha256,countryId:entry.countryId,joinStatus:entry.joinStatus,partitionPath:entry.partitionPath,exception:entry.exception,name:label.name,sourceType:label.sourceType,sourceTypeEn:label.sourceTypeEn,gadmLevel:label.gadmLevel,positions:entry.positions,polygons:entry.polygons};const rows=byCountry.get(entry.countryId)??[];rows.push(row);byCountry.set(entry.countryId,rows);}
 const countries=[...byCountry.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([countryId,rows])=>{rows.sort((a,b)=>a.sourceKey<b.sourceKey?-1:a.sourceKey>b.sourceKey?1:0);const emittedUnits=rows.filter(row=>row.partitionPath!==null).length;const index:Admin1CountryIndex={schemaVersion:1,product:ADMIN1_PRODUCT,countryId,sourceSha256:input.source.sha256,parentManifestHash:input.parent.manifestHash,inspectionSha256:input.inspectionHash,sourceUnits:rows.length,emittedUnits,rows};const bytes=jsonLine(index);if(bytes.length>ADMIN1_PRODUCT_LIMITS.countryIndexBytes)throw new RangeError(`Admin1 country index exceeds its byte cap: ${countryId}`);return{countryId,asset:asset(`countries/${sha(bytes)}.json`,bytes),sourceUnits:rows.length,emittedUnits};});
 const emittedUnits=plan.entries.filter(entry=>entry.partitionPath!==null).length,exceptionUnits=plan.entries.length-emittedUnits;
 const logicalBytes=plan.assets.reduce((n,item)=>n+item.bytes.byteLength,0)+plan.indexBytes.byteLength+inspectionBytes.byteLength+countries.reduce((n,c)=>n+(c.asset.bytes as ArrayBuffer).byteLength,0);
 if(logicalBytes>ADMIN1_PRODUCT_LIMITS.logicalBytes)throw new RangeError('Admin1 actual product bytes exceed the 96 MiB logical cap');
 const output:Output={report,globalIndex,partitions,countries,entries:plan.entries,inspection:plan.inspection,sourceUnits:plan.entries.length,emittedUnits,protected:plan.entries.filter(entry=>entry.joinStatus==='protected').length,unlinked:plan.entries.filter(entry=>entry.joinStatus==='unlinked').length,ambiguous:plan.entries.filter(entry=>entry.joinStatus==='ambiguous').length,exceptionUnits,logicalBytes};
 parentPort.postMessage({ok:true,output},transferables(output));
}catch(error){parentPort?.postMessage({ok:false,error:(error instanceof Error?error.message:String(error)).slice(0,2000)});process.exitCode=1;}finally{parentPort?.close();}
