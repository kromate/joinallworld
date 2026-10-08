import { parentPort, workerData } from 'node:worker_threads';
import { lstat, opendir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { COUNTRY_DIRECTORY_LIMITS, type CountryDirectoryBuildResult } from './country-directory-types.ts';
import type { SourceRecord } from './types.ts';

interface Input {
  source:SourceRecord;rawBuffer:ArrayBuffer;baselineSource:SourceRecord;baselineBuffer:ArrayBuffer;baselineInventoryHash:string;
  outputRoot:string;buildRoot:string;
}

async function outputUsage(root:string):Promise<{bytes:number;entries:number}>{
  let bytes=0,entries=0;
  const walk=async(dir:string,depth:number):Promise<void>=>{
    if(depth>8)throw new RangeError('country directory output exceeds depth 8');
    let info;try{info=await lstat(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&dir===root)return;throw error;}
    if(info.isSymbolicLink()||!info.isDirectory())throw new Error('country directory output contains an unsafe directory');
    const handle=await opendir(dir);
    for await(const item of handle){
      if(++entries>4_096)throw new RangeError('country directory output exceeds 4,096 entries');
      const filename=path.join(dir,item.name),child=await lstat(filename);
      if(child.isSymbolicLink())throw new Error('country directory output contains a symlink');
      if(child.isDirectory())await walk(filename,depth+1);else if(child.isFile())bytes+=child.size;else throw new Error('country directory output contains a non-regular entry');
      if(bytes>40*1024*1024)throw new RangeError('country directory output exceeds 40 MiB');
    }
  };
  await walk(root,0);return{bytes,entries};
}

async function run():Promise<void>{
  if(!parentPort)throw new Error('country directory worker must be supervised');
  const input=workerData as Input,raw=new Uint8Array(input.rawBuffer),baselineRaw=new Uint8Array(input.baselineBuffer);
  if(path.resolve(input.outputRoot)!==path.join(path.resolve(input.buildRoot),'output','country-inventory'))throw new Error('country directory worker output path is not fixed under its build root');
  const compiled=compileCountryDirectory(input.source,raw,input.baselineSource,baselineRaw,input.baselineInventoryHash);
  if(compiled.manifest.compiler!=='country-directory-compiler-v1'||compiled.manifest.baselineInventoryHash!==input.baselineInventoryHash
      ||compiled.manifest.sourceUnitCount!==compiled.identity.candidateUnits||compiled.manifest.sourceUnitCount!==compiled.inventory.sourceUnitCount
      ||compiled.identity.baselineUnits<1||compiled.identity.retained.length+compiled.identity.added.length!==compiled.identity.candidateUnits
      ||compiled.identity.retained.length+compiled.identity.missing.length!==compiled.identity.baselineUnits)throw new Error('compiled country directory identity or baseline binding is inconsistent');
  if(compiled.bytes<1||compiled.bytes>COUNTRY_DIRECTORY_LIMITS.publishedBytes)throw new RangeError('compiled country directory exceeds its 16 MiB publication cap');
  const disk=await statfs(input.buildRoot);if(disk.bavail*disk.bsize<116*1024*1024)throw new RangeError('country directory requires 100 MiB free reserve plus 16 MiB output allowance');
  const usage=await outputUsage(input.outputRoot);if(usage.bytes+compiled.bytes>40*1024*1024||usage.entries+compiled.assets.length+8>4_096)throw new RangeError('country directory compiled assets exceed cumulative output byte/entry allowance');
  const published=await publishCountryDirectory(compiled,input.outputRoot,input.buildRoot);
  await outputUsage(input.outputRoot);
  if(published.manifestHash!==compiled.manifestHash||published.bytes!==compiled.bytes||path.resolve(published.manifestPath)!==path.join(input.outputRoot,'manifests',`${compiled.manifestHash}.json`))throw new Error('country directory publisher result differs from immutable compiled result');
  const result:CountryDirectoryBuildResult={manifestHash:published.manifestHash,manifestPath:published.manifestPath,bytes:published.bytes,
    sourceUnitCount:compiled.manifest.sourceUnitCount,nodeCount:compiled.manifest.nodeCount,outlineCount:compiled.manifest.outlineCount,partCount:compiled.manifest.partCount,
    retained:compiled.identity.retained.length,added:compiled.identity.added.length,missing:compiled.identity.missing.length,networkBytes:0,elapsedMs:1};
  parentPort.postMessage({ok:true,result});
}
void run().catch(error=>{parentPort?.postMessage({ok:false,error:error instanceof Error?error.message.slice(0,2_000):String(error).slice(0,2_000)});process.exitCode=1;}).finally(()=>parentPort?.close());
