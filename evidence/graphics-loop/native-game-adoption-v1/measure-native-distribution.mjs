import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
async function measure(root) {
 const files=[];
 async function visit(dir) { for(const e of await readdir(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) await visit(p); else if(e.isFile()) {const b=await readFile(p); files.push({path:path.relative(root,p),raw:b.length,gzip:gzipSync(b).length,brotli:brotliCompressSync(b,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length});}}}
 await visit(root);
 return {root,files:files.length,all:files.reduce((a,f)=>({raw:a.raw+f.raw,gzip:a.gzip+f.gzip,brotli:a.brotli+f.brotli}),{raw:0,gzip:0,brotli:0}),graphics:files.filter(f=>/\.(glb|gltf|jpg|jpeg|png|ktx2)$/.test(f.path)),largest:files.sort((a,b)=>b.raw-a.raw).slice(0,15)};
}
const baseline=await measure('/tmp/graphics-baseline-dist');
const candidate=await measure('/tmp/graphics-native-dist');
console.log(JSON.stringify({scope:'exact3af baseline versus sharedhostV2 source, beforefullpose/clothing acceptance; notphoneperformance',baseline,candidate,change:Object.fromEntries(['raw','gzip','brotli'].map(k=>[k,candidate.all[k]-baseline.all[k]]))},null,2));
