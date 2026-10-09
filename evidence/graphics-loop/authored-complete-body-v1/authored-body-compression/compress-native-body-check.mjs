import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const sourcePath=path.resolve(here,'../parametric-base-facial.glb'), outputPath=path.join(here,'outcompressed/parametric-base-facial-meshopt.glb');
const sha=b=>createHash('sha256').update(b).digest('hex');
function imageFree(input){const bytes=new Uint8Array(input),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let json,bin;for(let p=12;p<bytes.length;){const n=v.getUint32(p,true),t=v.getUint32(p+4,true),c=bytes.slice(p+8,p+8+n);if(t===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(c));else if(t===0x004e4942)bin=c;p+=n+8;}assert(json&&bin);delete json.images;delete json.textures;delete json.samplers;for(const m of json.materials??[]){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture;}const j=new TextEncoder().encode(JSON.stringify(json)),jl=(j.length+3)&~3,bl=(bin.length+3)&~3,out=new Uint8Array(28+jl+bl),d=new DataView(out.buffer);d.setUint32(0,0x46546c67,true);d.setUint32(4,2,true);d.setUint32(8,out.length,true);d.setUint32(12,jl,true);d.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jl);out.set(j,20);d.setUint32(20+jl,bl,true);d.setUint32(24+jl,0x004e4942,true);out.set(bin,28+jl);return out.buffer;}
async function parse(b){return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(imageFree(b),'/');}
await MeshoptDecoder.ready;
const sourceBytes=readFileSync(sourcePath),outputBytes=readFileSync(outputPath);
const compressedGlb=new DataView(outputBytes.buffer,outputBytes.byteOffset,outputBytes.byteLength);let compressedJson;for(let p=12;p<outputBytes.length;){const n=compressedGlb.getUint32(p,true),type=compressedGlb.getUint32(p+4,true);if(type===0x4e4f534a)compressedJson=JSON.parse(new TextDecoder().decode(outputBytes.subarray(p+8,p+8+n)));p+=n+8;}
assert(compressedJson.extensionsRequired.includes('EXT_meshopt_compression'),'meshopt is required without payload fallback');
assert.equal(compressedJson.buffers.length,2,'one compressed BIN buffer and one URI-less placeholder');
assert.equal(compressedJson.buffers[0].uri,undefined,'compressed source is embedded in GLB BIN');
assert.equal(compressedJson.buffers[1].uri,undefined,'fallback is URI-less placeholder');
assert.equal(compressedJson.buffers[1].extensions.EXT_meshopt_compression.fallback,true,'placeholder marked fallback');
assert(compressedJson.bufferViews.every(v=>v.buffer===1&&v.extensions?.EXT_meshopt_compression?.buffer===0),'all views use placeholder layout and compressed payload');
const [a,b]=await Promise.all([parse(sourceBytes),parse(outputBytes)]);
function meshes(g){const m=new Map();g.scene.traverse(o=>{if(o.isSkinnedMesh)m.set(o.name,o);});return m;}
function attrBytes(a){return new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength);}
const original=meshes(a),compressed=meshes(b);assert.deepEqual([...compressed.keys()],[...original.keys()]);
const rows=[];let checks=0;
function eqArray(label,x,y){assert(x&&y,`${label} exists in source and compressed result`);assert.equal(x.itemSize,y.itemSize,`${label} itemSize`);assert.equal(x.count,y.count,`${label} count`);assert.deepEqual(attrBytes(x),attrBytes(y),`${label} decoded bytes`);checks++;}
for(const name of original.keys()){
 const x=original.get(name),y=compressed.get(name);assert.equal(x.geometry.morphAttributes.position.length,y.geometry.morphAttributes.position.length,`${name} morph target count`);
 for(const key of ['position','normal','uv','skinIndex','skinWeight'])eqArray(`${name}.${key}`,x.geometry.attributes[key],y.geometry.attributes[key]);
 eqArray(`${name}.index`,x.geometry.index,y.geometry.index);
 for(const kind of ['position','normal'])for(let i=0;i<(x.geometry.morphAttributes[kind]?.length ?? 0);i++)eqArray(`${name}.morph.${kind}.${i}`,x.geometry.morphAttributes[kind][i],y.geometry.morphAttributes[kind][i]);
 assert.deepEqual(x.geometry.morphTargetDictionary,y.geometry.morphTargetDictionary,`${name} morph target names`);checks++;
 assert.deepEqual(x.skeleton.bones.map(b=>b.name),y.skeleton.bones.map(b=>b.name),`${name} skeleton names`);checks++;
 assert.equal(x.skeleton.boneInverses.length,y.skeleton.boneInverses.length,`${name} inverse bind count`);
 for(let i=0;i<x.skeleton.boneInverses.length;i++)assert.deepEqual(x.skeleton.boneInverses[i].elements,y.skeleton.boneInverses[i].elements,`${name} inverse bind ${i}`);checks++;
 rows.push({mesh:name,vertices:x.geometry.attributes.position.count,indices:x.geometry.index.count,positionMorphs:x.geometry.morphAttributes.position.length,skinBones:x.skeleton.bones.length});
}
assert(original.has('Body'),'complete Body skinned mesh');
const report={status:'passed',sourceSha256:sha(sourceBytes),compressedSha256:sha(outputBytes),sourceBytes:sourceBytes.length,compressedBytes:outputBytes.length,losslessGLTFLoaderComparisons:checks,meshes:rows,bodyIndexSha256:sha(attrBytes(original.get('Body').geometry.index)),claims:{requiredExtensionPlaceholder:true,sourceFallbackPayloadOmitted:true,allMeshAttributesExact:true,allPositionAndNormalMorphArraysExact:true,allMorphTargetNamesExact:true,boneOrderAndInverseBindsExact:true,renderedAcceptance:false}};
writeFileSync(path.join(here,'compression-check-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
