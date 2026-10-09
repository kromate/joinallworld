import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {createFacialDetail} from '../../../src/scene/body/facial-detail.ts';
import {normalizeLook} from '../../../src/scene/avatar-look.ts';
function sourceWithoutImages(bytes) {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredLength = source.getUint32(8, true);
  let offset = 12, json = null, binary = null;
  while (offset < declaredLength) {
    const length = source.getUint32(offset, true), type = source.getUint32(offset + 4, true);
    offset += 8;
    const chunk = bytes.subarray(offset, offset + length);
    offset += length;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk).trim());
    else if (type === 0x004e4942) binary = chunk;
  }
  if (!json || !binary) throw new Error('Expected a GLB JSON and binary chunk');
  json.materials = (json.materials ?? []).map(material => ({ name: material.name ?? 'image-stripped' }));
  json.images = []; json.textures = []; json.samplers = [];
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = jsonBytes.length + ((4 - jsonBytes.length % 4) % 4);
  const binaryLength = binary.length + ((4 - binary.length % 4) % 4);
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const output = new Uint8Array(totalLength), view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  output.set(jsonBytes, 20); output.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  const binaryOffset = 20 + jsonLength;
  view.setUint32(binaryOffset, binaryLength, true); view.setUint32(binaryOffset + 4, 0x004e4942, true);
  output.set(binary, binaryOffset + 8);
  return output.buffer;
}

await MeshoptDecoder.ready;
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const results=[];
for(const key of ['male','female']) {
 const bytes=await readFile(`src/scene/body/assets/base-body-${key}.glb`);
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const gltf=await loader.parseAsync(sourceWithoutImages(bytes),'');
 let mesh;gltf.scene.traverse(n=>{if(n.isSkinnedMesh)mesh=n});
 const map=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 const tx=json.materials[0].pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform;
 if(tx){if(tx.offset)map.offset.fromArray(tx.offset);if(tx.scale)map.repeat.fromArray(tx.scale);if(tx.rotation)map.rotation=tx.rotation;}
 mesh.material.map=map;
 const face=createFacialDetail(mesh,key,normalizeLook({body:key==='male'?'man':'woman',expression:'grin'},'preview'));
 const position=face.object.geometry.getAttribute('position');const bounds=new THREE.Box3();
 for(let i=0;i<position.count;i++)bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.matrix));
 if(!Number.isFinite(bounds.min.x)||bounds.min.y<1.4||bounds.max.y>2||bounds.max.x-bounds.min.x>0.4)throw new Error('Face leaves authored head: '+JSON.stringify(bounds));
 console.log('Face points '+key, JSON.stringify(face.object.userData));
 const morphs=face.object.geometry.morphAttributes.position;
 const shifts=morphs.map(a=>{let max=0;for(let i=0;i<a.count;i++)max=Math.max(max,new THREE.Vector3().fromBufferAttribute(a,i).sub(new THREE.Vector3().fromBufferAttribute(position,i)).transformDirection(new THREE.Matrix4()).length());return max});
 results.push({key,triangles:face.triangles,vertices:position.count,boundsMetres:{min:bounds.min.toArray(),max:bounds.max.toArray()},morphCounts:morphs.map(a=>a.count),morphInfluences:face.object.morphTargetInfluences});
 face.dispose();mesh.geometry.dispose();mesh.skeleton.dispose();mesh.material.dispose();map.dispose();
}
console.log(JSON.stringify(results,null,2));
