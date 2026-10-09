import { readFileSync, writeFileSync } from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const root='evidence/graphics-loop/authored-head-spike-v1/generated/';
const input=readFileSync(root+'expressive-head.glb');
const jsonLength=input.readUInt32LE(12),gltf=JSON.parse(input.subarray(20,20+jsonLength));
const bin=input.subarray(28+jsonLength),chunks=[];
let compressedLength=0,fallbackLength=0,verified=0;
function append(bytes){const at=compressedLength,padding=(4-bytes.length%4)%4;chunks.push(Buffer.from(bytes),Buffer.alloc(padding));compressedLength+=bytes.length+padding;return at}
const dimensions={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const widths={5121:1,5122:2,5123:2,5125:4,5126:4};
for(let i=0;i<gltf.bufferViews.length;i++){
 const view=gltf.bufferViews[i],source=bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
 const accessors=gltf.accessors.filter(a=>a.bufferView===i);
 if(!accessors.length){view.buffer=0;view.byteOffset=append(source);continue}
 if(accessors.some(a=>a.sparse))throw new Error('Unexpected sparse authored-head data');
 const a=accessors[0],stride=view.byteStride??dimensions[a.type]*widths[a.componentType];
 if(!stride||source.length%stride!==0)throw new Error('Unsupported attribute stride');
 const count=source.length/stride,mode=a.type==='SCALAR'?'INDICES':'ATTRIBUTES';
 const encoded=MeshoptEncoder.encodeGltfBuffer(source,count,stride,mode);
 const decoded=new Uint8Array(source.length);MeshoptDecoder.decodeGltfBuffer(decoded,count,stride,encoded,mode);
 if(!Buffer.from(decoded).equals(source))throw new Error('Compression altered authored geometry or morph');verified++;
 const at=append(encoded);view.buffer=1;view.byteOffset=fallbackLength;fallbackLength+=source.length+(4-source.length%4)%4;
 view.extensions={EXT_meshopt_compression:{buffer:0,byteOffset:at,byteLength:encoded.length,byteStride:stride,count,mode}};
}
gltf.buffers=[{byteLength:compressedLength},{byteLength:fallbackLength,extensions:{EXT_meshopt_compression:{fallback:true}}}];
gltf.extensionsUsed=[...(gltf.extensionsUsed??[]),'EXT_meshopt_compression'];gltf.extensionsRequired=[...(gltf.extensionsRequired??[]),'EXT_meshopt_compression'];
const body=Buffer.concat(chunks),text=Buffer.from(JSON.stringify(gltf)),padding=Buffer.alloc((4-text.length%4)%4,32);
const json=Buffer.concat([text,padding]),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+body.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binaryHeader=Buffer.alloc(8);binaryHeader.writeUInt32LE(body.length,0);binaryHeader.writeUInt32LE(0x004e4942,4);
const output=Buffer.concat([header,json,binaryHeader,body]);writeFileSync(root+'expressive-head-compressed.glb',output);
writeFileSync(root+'compression-report.json',JSON.stringify({retainedBytes:input.length,compressedBytes:output.length,verifiedByteIdenticalViews:verified,geometryAndMorphBytesUnchanged:true,note:'Lossless delivery compression. Triangle count and decoded runtime cost are unchanged.'},null,2));
console.log(readFileSync(root+'compression-report.json','utf8'));
