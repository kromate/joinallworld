import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptEncoder } from 'meshoptimizer';
const here = path.dirname(fileURLToPath(import.meta.url));
const bodyPath = path.resolve(here, '../parametric-base-facial.glb');
const outDir = path.join(here, 'outcompressed');
const outPath = path.join(outDir, 'parametric-base-facial-meshopt.glb');
const expectedSha = '9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd';
const sha = (b) => createHash('sha256').update(b).digest('hex');
function parseGlb(bytes) { const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); assert.equal(v.getUint32(0,true),0x46546c67);assert.equal(v.getUint32(4,true),2);let json,bin;for(let p=12;p<bytes.length;){const len=v.getUint32(p,true),kind=v.getUint32(p+4,true),chunk=bytes.subarray(p+8,p+8+len);if(kind===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(chunk));else if(kind===0x004e4942)bin=chunk;p+=len+8;}assert(json&&bin,'GLB JSON and BIN chunks');return {json,bin}; }
function encodeGlb(json,bin){const j=new TextEncoder().encode(JSON.stringify(json)),jp=(j.length+3)&~3,bp=(bin.length+3)&~3,out=new Uint8Array(28+jp+bp),v=new DataView(out.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);v.setUint32(12,jp,true);v.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jp);out.set(j,20);v.setUint32(20+jp,bp,true);v.setUint32(24+jp,0x004e4942,true);out.set(bin,28+jp);return out;}
const cb=t=>({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4})[t];const tb=t=>({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16})[t];
await MeshoptEncoder.ready;assert(MeshoptEncoder.supported,'meshoptimizer encoder WASM supported');
const src=new Uint8Array(readFileSync(bodyPath));assert.equal(sha(src),expectedSha,'source actor SHA pin');const {json,bin:orig}=parseGlb(src),refs=json.bufferViews.map(()=>[]);
for(const a of json.accessors){if(a.bufferView!==undefined)refs[a.bufferView].push({kind:'accessor',count:a.count,type:a.type,componentType:a.componentType});if(a.sparse?.indices)refs[a.sparse.indices.bufferView].push({kind:'sparseIndices',count:a.sparse.count,componentType:a.sparse.indices.componentType});if(a.sparse?.values)refs[a.sparse.values.bufferView].push({kind:'sparseValues',count:a.sparse.count,type:a.type,componentType:a.componentType});}
const packed=[];let encodedTotal=0;
for(let i=0;i<json.bufferViews.length;i++){const bv=json.bufferViews[i];assert.equal(bv.buffer??0,0);const data=orig.subarray(bv.byteOffset??0,(bv.byteOffset??0)+bv.byteLength);assert.equal(data.length,bv.byteLength,`view ${i} in source bounds`);const r=refs[i];let mode,stride,count;
if(bv.target===34963||r.every(x=>x.kind==='sparseIndices')){mode='INDICES';stride=bv.target===34963?4:cb(r.find(x=>x.kind==='sparseIndices')?.componentType);count=data.length/stride;}
else if(bv.byteStride){mode='ATTRIBUTES';stride=bv.byteStride;count=data.length/stride;}
else if(r.length===1&&r[0].kind==='sparseValues'){mode='ATTRIBUTES';stride=tb(r[0].type)*cb(r[0].componentType);count=r[0].count;}
else if(r.length===1&&r[0].kind==='accessor'){mode='ATTRIBUTES';stride=data.length/r[0].count;count=r[0].count;}
else throw new Error(`view ${i} ambiguous layout: ${JSON.stringify({len:data.length,refs:r})}`);
assert(Number.isInteger(count)&&count>0&&count*stride===data.length,`view ${i} exact count/stride coverage`);if(mode==='ATTRIBUTES'&&(stride%4||stride>256))throw new Error(`view ${i} attr stride ${stride} unsupported`);if(mode==='INDICES'&&![2,4].includes(stride))throw new Error(`view ${i} index stride ${stride} unsupported`);
const encoded=MeshoptEncoder.encodeGltfBuffer(data,count,stride,mode);const offset=encodedTotal;packed.push({i,encoded,offset,mode,stride,count,decodedBytes:data.length,decodedSha:sha(data)});encodedTotal=(encodedTotal+encoded.length+3)&~3;}
const outBin=new Uint8Array(encodedTotal);for(const p of packed)outBin.set(p.encoded,p.offset);
for(const p of packed){const bv=json.bufferViews[p.i];bv.buffer=1;bv.extensions??={};bv.extensions.EXT_meshopt_compression={buffer:0,byteOffset:p.offset,byteLength:p.encoded.length,byteStride:p.stride,count:p.count,mode:p.mode};}
json.extensionsUsed=[...new Set([...(json.extensionsUsed??[]),'EXT_meshopt_compression'])];json.extensionsRequired=[...new Set([...(json.extensionsRequired??[]),'EXT_meshopt_compression'])];json.buffers=[{byteLength:outBin.length},{byteLength:parseGlb(src).json.buffers[0].byteLength,extensions:{EXT_meshopt_compression:{fallback:true}}}];
mkdirSync(outDir,{recursive:true});const output=encodeGlb(json,outBin);writeFileSync(outPath,output);
const report={status:'required-extension-compressed-with-placeholder-fallback-buffer',source:'../parametric-base-facial.glb',sourceSha256:sha(src),sourceBytes:src.length,output:'outcompressed/parametric-base-facial-meshopt.glb',outputSha256:sha(output),outputBytes:output.length,compression:{encoder:'installed meshoptimizer MeshoptEncoder',extension:'EXT_meshopt_compression',views:packed.length,decodedViewBytes:packed.reduce((n,p)=>n+p.decodedBytes,0),encodedViewBytes:encodedTotal,allViews:packed.map(({i,mode,stride,count,decodedBytes,encoded,decodedSha})=>({bufferView:i,mode,stride,count,decodedBytes,encodedBytes:encoded.length,decodedSha256:decodedSha})),perMode:Object.fromEntries(['ATTRIBUTES','INDICES'].map(m=>[m,packed.filter(p=>p.mode===m).reduce((n,p)=>n+p.encoded.length,0)]))},mobileDeltaBytes:output.length-src.length,note:'The Khronos EXT_meshopt_compression spec permits a URI-less placeholder fallback buffer when the extension is required. The placeholder has enough declared length for parent bufferViews but contains no uncompressed bytes; all parent views point to it and all decoder reads use the compressed GLB BIN buffer.'};writeFileSync(path.join(here,'compression-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,compression:{...report.compression,allViews:`${packed.length} rows written to report`}},null,2));
