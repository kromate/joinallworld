import { readFile, lstat, rename, statfs, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildInventory, ensureInventoryDirectory, publishInventory } from './inventory.ts';
import { createOutputStore } from './storage.ts';
import { fetchPinnedSource } from './sources.ts';
import { sha256 } from './pack.ts';
import type { SourceRecord } from './types.ts';

export interface InventoryPin {
  schemaVersion:1; source:SourceRecord; input:string; sourceFeatureCount:number; resolutionLimitations:string[];
}
export function validateInventoryPin(value:unknown):InventoryPin{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('inventory pin must be an object');
  const v=value as Record<string,unknown>,s=v.source as SourceRecord|undefined;
  if(v.schemaVersion!==1||!s||typeof s.url!=='string'||!s.url.startsWith('https://')||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.bytes)||s.bytes<1||s.bytes>20_000_000||typeof v.input!=='string'||!v.input||!Number.isSafeInteger(v.sourceFeatureCount)||(v.sourceFeatureCount as number)<1||(v.sourceFeatureCount as number)>10_000||!Array.isArray(v.resolutionLimitations)||v.resolutionLimitations.some(x=>typeof x!=='string'||x.length>2048))throw new TypeError('inventory pin lacks bounded exact source identity');
  for(const field of ['id','release','license','attribution'] as const)if(typeof s[field]!=='string'||!s[field]||s[field].length>2048)throw new TypeError(`inventory source ${field} invalid`);
  return value as InventoryPin;
}

/** Recreate the pinned coarse inventory without moving-release discovery or model calls. */
export async function bootstrapInventory(value:unknown,repositoryRoot:string,allowedRoot:string,fetcher:typeof fetch=fetch):Promise<{
  manifestPath:string;manifestHash:string;bytes:number;sourceUnits:number;networkBytes:number;exceptions:string[];
}>{
  const pin=validateInventoryPin(value),root=path.resolve(allowedRoot),input=path.resolve(repositoryRoot,pin.input),relative=path.relative(root,input);
  if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('inventory source cache must remain within builder root');
  await ensureInventoryDirectory(path.dirname(input));
  const disk=await statfs(root);if(disk.bavail*disk.bsize<pin.source.bytes+100_000_000)throw new RangeError('inventory download lacks free disk reserve');
  let bytes:Uint8Array|null=null,networkBytes=0;
  try{
    const info=await lstat(input);
    if(info.isSymbolicLink()||!info.isFile())throw new Error('inventory source cache must be a regular file without symlinks');
    if(info.size<=20_000_000)bytes=await readFile(input);
    if(bytes===null||bytes.byteLength!==pin.source.bytes||sha256(bytes)!==pin.source.sha256){
      // Retain the exact damaged cache file for diagnosis rather than hiding a checksum failure.
      await ensureInventoryDirectory(path.join(root,'source-quarantine'));
      const previous=await readdir(path.join(root,'source-quarantine'));
      if(previous.filter(name=>name.startsWith(pin.source.sha256+'-')).length>=3||info.size>20_000_000)throw new Error('inventory source repair limit reached; preserve and inspect quarantine');
      await rename(input,path.join(root,'source-quarantine',`${pin.source.sha256}-${randomUUID()}.geojson`));bytes=null;
    }
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(bytes===null){
    bytes=await fetchPinnedSource(pin.source.url,pin.source.bytes,pin.source.sha256,fetcher);
    if(bytes.byteLength!==pin.source.bytes)throw new Error('pinned source byte count mismatch');
    networkBytes=bytes.byteLength;
    const store=await createOutputStore(path.dirname(input),root);
    await store.writeImmutable(path.basename(input),bytes);
  }
  const inventory=buildInventory(pin.source,JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown);
  if(inventory.sourceUnitCount!==pin.sourceFeatureCount)throw new Error('inventory source denominator differs from frozen pin');
  inventory.exceptions.push(...pin.resolutionLimitations);
  const result=await publishInventory(inventory,path.join(root,'output','inventory'),root);
  return {...result,sourceUnits:inventory.sourceUnitCount,networkBytes,exceptions:inventory.exceptions};
}
