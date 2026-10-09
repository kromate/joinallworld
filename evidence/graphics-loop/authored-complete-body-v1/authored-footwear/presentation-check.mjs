import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadCompleteCharacter } from '../rig.ts';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../..');
const bodyPath=path.join(repo,'evidence/graphics-loop/authored-complete-body-v1/parametric-base-facial.glb');
const clipPath=path.join(repo,'src/scene/body/assets/clip-pack.glb');
const shoePath=path.join(here,'out/shoes01-mobile.glb');
const hashes={body:'9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd',clip:'89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',shoes:'8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557'};
const digest=b=>createHash('sha256').update(b).digest('hex');
const inputs={body:readFileSync(bodyPath),clip:readFileSync(clipPath),shoes:readFileSync(shoePath)};
for(const [name,buf] of Object.entries(inputs)) assert.equal(digest(buf),hashes[name],`${name} source pin`);
function glbJson(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);assert.equal(v.getUint32(0,true),0x46546c67);const n=v.getUint32(12,true);return JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+n)));}
const shoeJson=glbJson(inputs.shoes);assert.deepEqual(shoeJson.images.map(x=>x.mimeType),['image/jpeg','image/jpeg']);
const material=shoeJson.materials[0];assert.equal(material.pbrMetallicRoughness.baseColorTexture.index,0);assert.equal(material.normalTexture.index,1);assert.equal(shoeJson.textures[0].source,0);assert.equal(shoeJson.textures[1].source,1);assert.equal(shoeJson.images[0].name,'shoes01_diffuse.png');assert.equal(shoeJson.images[1].name,'shoes01_normal.png');
const binOffset=20+new DataView(inputs.shoes.buffer,inputs.shoes.byteOffset,inputs.shoes.byteLength).getUint32(12,true)+8;
for(const image of shoeJson.images){const view=shoeJson.bufferViews[image.bufferView],payload=inputs.shoes.subarray(binOffset+view.byteOffset,binOffset+view.byteOffset+view.byteLength);assert.equal(payload[0],0xff);assert.equal(payload[1],0xd8);}
function imageFreeGlb(input){
 const b=input instanceof Uint8Array?input:new Uint8Array(input),v=new DataView(b.buffer,b.byteOffset,b.byteLength); let j,bin;
 assert.equal(v.getUint32(0,true),0x46546c67); assert.equal(v.getUint32(4,true),2); let o=12;
 while(o<b.length){const n=v.getUint32(o,true),t=v.getUint32(o+4,true),chunk=b.slice(o+8,o+8+n); if(t===0x4e4f534a)j=JSON.parse(new TextDecoder().decode(chunk));else if(t===0x004e4942)bin=chunk;o+=n+8;}
 assert(j&&bin); delete j.images;delete j.textures;delete j.samplers;
 for(const m of j.materials??[]){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture;}
 const enc=new TextEncoder().encode(JSON.stringify(j)),jl=(enc.length+3)&~3,bl=(bin.length+3)&~3,out=new Uint8Array(28+jl+bl),d=new DataView(out.buffer);
 d.setUint32(0,0x46546c67,true);d.setUint32(4,2,true);d.setUint32(8,out.length,true);d.setUint32(12,jl,true);d.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jl);out.set(enc,20);d.setUint32(20+jl,bl,true);d.setUint32(24+jl,0x004e4942,true);out.set(bin,28+jl);return out.buffer;
}
const nativeFetch=globalThis.fetch;
const fileFetchCounts=new Map(),failOnceUrls=new Set(),deferredFetches=new Map(),lateResponses=new Map();
let lateStartedResolve;const lateStarted=new Promise(resolve=>lateStartedResolve=resolve);
globalThis.fetch=async(input,init)=>{const raw=input instanceof Request?input.url:String(input),url=new URL(raw);if(url.protocol==='file:'){
 fileFetchCounts.set(url.href,(fileFetchCounts.get(url.href)??0)+1);
 if(failOnceUrls.delete(url.href))return new Response('controlled failure',{status:503});
 if(deferredFetches.has(url.href)){const item=deferredFetches.get(url.href);deferredFetches.delete(url.href);lateResponses.set(url.href,item);if(!deferredFetches.size)lateStartedResolve();return item.promise;}
 return new Response(readFileSync(fileURLToPath(url)),{status:200});}return nativeFetch(input,init);};
const nativeParse=GLTFLoader.prototype.parseAsync;
const diffuse=new THREE.DataTexture(new Uint8Array([180,140,110,255]),1,1,THREE.RGBAFormat);diffuse.colorSpace=THREE.SRGBColorSpace;diffuse.needsUpdate=true;
const normal=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1,THREE.RGBAFormat);normal.colorSpace=THREE.NoColorSpace;normal.needsUpdate=true;
const templateResourceEvents=[];let templateParseCount=0;let parseInflight=0;
GLTFLoader.prototype.parseAsync=async function(data,prefix){
 parseInflight++;const parsed=await nativeParse.call(this,imageFreeGlb(data),prefix);parseInflight--;templateParseCount++;
 const events={geometry:0,material:0,textures:0,imageClose:0,meshes:0};const watched=new Set();
 parsed.scene.traverse(node=>{if(!node.isMesh)return;events.meshes++;node.geometry.addEventListener('dispose',()=>events.geometry++);const mats=Array.isArray(node.material)?node.material:[node.material];for(const mat of mats){mat.addEventListener('dispose',()=>events.material++);if(!(mat instanceof THREE.MeshStandardMaterial))continue;mat.map??=new THREE.DataTexture(new Uint8Array([180,140,110,255]),1,1,THREE.RGBAFormat);mat.map.colorSpace=THREE.SRGBColorSpace;mat.normalMap??=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1,THREE.RGBAFormat);mat.normalMap.colorSpace=THREE.NoColorSpace;for(const tex of [mat.map,mat.normalMap]){if(!tex)continue;tex.addEventListener('dispose',()=>events.textures++);const image=tex.source?.data??tex.image;if(image&&typeof image==='object'&&Object.isExtensible(image)&&!watched.has(image)){watched.add(image);Object.defineProperty(image,'close',{configurable:true,value:()=>events.imageClose++});}}}});
 templateResourceEvents.push(events);return parsed;
};
await MeshoptDecoder.ready;
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const [bodyGltf,clipGltf,shoeGltf]=await Promise.all([inputs.body,inputs.clip,inputs.shoes].map(b=>nativeParse.call(loader,imageFreeGlb(b),'/')));
let sourceBones, shoeSourceMesh;shoeGltf.scene.traverse(node=>{if(node.isMesh)shoeSourceMesh=node;});assert(shoeSourceMesh,'shoe source mesh decoded');clipGltf.scene.updateMatrixWorld(true);
const boneNames=['pelvis','spine_01','spine_02','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l','clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r'];
sourceBones=boneNames.map(n=>clipGltf.scene.getObjectByName(n));assert(sourceBones.every(Boolean));
const sourceRig=Object.assign(clipGltf.scene,{skeleton:new THREE.Skeleton(sourceBones,sourceBones.map(b=>b.matrixWorld.clone().invert()))});
let disposedKit=false;const callbacks=new Set();
const kit={authoredCharacterAssets:{loadTemplate:async()=>bodyGltf.scene,loadMotionRig:async()=>({root:sourceRig,clips:clipGltf.animations})},onDispose(fn){callbacks.add(fn);return()=>callbacks.delete(fn);}};
const temp=path.join(here,'presentation-runtime-check.ts');
let src=readFileSync(path.join(here,'presentation.ts'),'utf8');
const before="import shoesUrl from './out/shoes01-mobile.glb?url';";assert.equal(src.split(before).length-1,1);src=src.replace(before,"const shoesUrl = new URL('./out/shoes01-mobile.glb', import.meta.url).href;");writeFileSync(temp,src);
let module;
try{module=await import(`${pathToFileURL(temp).href}?cpu=${Date.now()}`);}finally{await unlink(temp).catch(()=>{});}
const actors=[],feet=[];let geomDisposeEvents=0,matDisposeEvents=0;
const looks=[
 {body:'man',skin:'#81563d',face:'oval',expression:'neutral',outfit:'casual',outfitColor:'#3f72c4',bottomsColor:'#243a66',fabric:'plain',hair:'lowcut',appearance:{height:'average',build:'average',ageAppearance:'adult'}},
 {body:'woman',skin:'#c98e62',face:'round',expression:'smile',outfit:'casual',outfitColor:'#c9423a',bottomsColor:'#3f9a5a',fabric:'plain',hair:'afro',appearance:{height:'average',build:'average',ageAppearance:'adult'}},
];
function finiteSkinnedVertices(mesh){mesh.updateMatrixWorld(true);let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];const p=new THREE.Vector3();for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){mesh.getVertexPosition(i,p);assert(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z),`${mesh.name} finite vertex ${i}`);lo=[Math.min(lo[0],p.x),Math.min(lo[1],p.y),Math.min(lo[2],p.z)];hi=[Math.max(hi[0],p.x),Math.max(hi[1],p.y),Math.max(hi[2],p.z)];}return {min:lo,max:hi};}
try{
 for(let i=0;i<looks.length;i++) actors.push(await loadCompleteCharacter(kit,looks[i],`footwear-${i}`));
 function makeOwner(){const callbacks=new Set();let closed=false;return{onDispose(fn){if(closed){fn();return()=>false;}callbacks.add(fn);return()=>callbacks.delete(fn);},dispose(){if(closed)return;closed=true;for(const fn of [...callbacks]){callbacks.delete(fn);fn();}}};}
 const shoesUrl=new URL(shoesUrlForTest(),import.meta.url).href;
 function shoesUrlForTest(){return './out/shoes01-mobile.glb';}
 const retryOwner=makeOwner();failOnceUrls.add(shoesUrl);
 await assert.rejects(module.applyAuthoredFootwear(actors[0].object,{kitOwner:retryOwner}),/mobile shoe fetch failed \(503\)/,'failed shoe fetch rejects');
 const retried=await module.applyAuthoredFootwear(actors[0].object,{kitOwner:retryOwner});retried.dispose();retryOwner.dispose();
 assert.equal(fileFetchCounts.get(shoesUrl),2,'failed owner template fetch is cleared and retried once');
 const lateOwner=makeOwner();let resolveLate;const lateRequest={promise:new Promise(resolve=>resolveLate=resolve),resolve:resolveLate};deferredFetches.set(shoesUrl,lateRequest);
 const lateLoad=module.applyAuthoredFootwear(actors[1].object,{kitOwner:lateOwner});await lateStarted;lateOwner.dispose();
 for(const [url,item] of lateResponses){item.resolve(new Response(readFileSync(fileURLToPath(url)),{status:200}));lateResponses.delete(url);}
 let lateError;try{await lateLoad;}catch(e){lateError=e;}assert.match(String(lateError),/Kit was disposed while mobile shoes were loading/,'late load rejects after owner close');
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(parseInflight,0,'late GLB parsing settles');
 const parseCountBeforeMain=templateParseCount;
 for(let i=0;i<looks.length;i++){
   const actor=actors[i];
   const footwear=await module.applyAuthoredFootwear(actor.object,{kitOwner:kit});feet.push(footwear);
   const body=actor.object.getObjectByName('Body');assert(body?.isSkinnedMesh);const shoes=footwear.object;
   assert.equal(shoes.skeleton.bones.length,52);assert(shoes.skeleton.bones.every((b,j)=>b===body.skeleton.bones[j]));
   assert.equal(shoes.skeleton,body.skeleton,'footwear reuses the actor skeleton; no duplicate skeleton is created');
   assert.notEqual(shoes.geometry,feet[1-i]?.object.geometry,'actor footwear geometry is private');
   assert.notEqual(shoes.material,feet[1-i]?.object.material,'actor footwear material is private');
   const index=shoes.geometry.getAttribute('skinIndex'),weight=shoes.geometry.getAttribute('skinWeight'),sourceIndex=shoeSourceMesh.geometry.getAttribute('skinIndex');let minW=Infinity,maxW=-Infinity;
   const jointNames=shoeSourceMesh.userData.jointNames;assert(Array.isArray(jointNames)&&jointNames.length===52,'pinned source carries all 52 exact joint names');
   const canonical=name=>name.toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^mixamorig/,'');
   const bodyByName=new Map(body.skeleton.bones.map((bone,j)=>[canonical(bone.name),j]));
   const expectedMap=jointNames.map(name=>bodyByName.get(canonical(name)));assert(expectedMap.every(Number.isInteger)&&new Set(expectedMap).size===52,'source joint names map bijectively to actor bones');
   for(let v=0;v<index.count;v++){let sum=0;for(let lane=0;lane<4;lane++){const j=weight.getComponent(v,lane);assert(index.getComponent(v,lane)===expectedMap[Math.round(sourceIndex.getComponent(v,lane))],'each shoe influence remaps to the exact named actor joint');assert(Number.isFinite(j)&&j>=0);sum+=j;}assert(Math.abs(sum-1)<2e-4);minW=Math.min(minW,sum);maxW=Math.max(maxW,sum);}
   const bodyMorph=body.morphTargetInfluences,shoeMorph=shoes.morphTargetInfluences;const bd=body.morphTargetDictionary,sd=shoes.morphTargetDictionary;
   for(const name of ['bodyFeminine','bodyMasculine'])bodyMorph[bd[name]]=name===(i?'bodyFeminine':'bodyMasculine')?0.73:0.27;
   shoes.onBeforeRender(null,null,null,shoes.geometry,shoes.material,null);for(const name of ['bodyFeminine','bodyMasculine'])assert.equal(shoeMorph[sd[name]],bodyMorph[bd[name]],`morph sync ${name}`);
   const poseBounds={};
   actor.sample(0,'idle');poseBounds.rest=finiteSkinnedVertices(shoes);
   actor.sample(.47,'walk');poseBounds.walk=finiteSkinnedVertices(shoes);
   actor.sample(0,'idle');
   const pelvis=body.skeleton.bones.find(b=>/Hips$/i.test(b.name));const thighL=body.skeleton.bones.find(b=>/LeftUpLeg$/i.test(b.name)),thighR=body.skeleton.bones.find(b=>/RightUpLeg$/i.test(b.name));assert(pelvis&&thighL&&thighR,'native hips and upper-leg bones exist');
   pelvis.rotation.z=.12;thighL.rotation.x=-.85;thighR.rotation.x=-.85;actor.object.updateMatrixWorld(true);body.skeleton.update();poseBounds.seatedManual=finiteSkinnedVertices(shoes);
   pelvis.rotation.z=0;thighL.rotation.x=0;thighR.rotation.x=0;actor.object.updateMatrixWorld(true);body.skeleton.update();
   const result={body:looks[i].body,vertices:footwear.metrics.vertices,triangles:footwear.metrics.triangles,sourceHash:footwear.metrics.sourceSha256,jointCount:footwear.metrics.jointCount,weightsRange:[minW,maxW],poseBounds,morphSync:true,textureColorSpaces:{diffuse:'sRGB (verified separately from original GLB; CPU parser uses map placeholder)',normal:'linear (verified separately from original GLB; CPU parser uses normal placeholder)'}};
   feet[i]._checkResult=result;
 }
 assert.equal(templateParseCount-parseCountBeforeMain,1,'the main Kit loads one shared footwear template for both actors');assert.equal(fileFetchCounts.get(shoesUrl),4,'one failed plus successful retry, one late-close load, and one main Kit load');
 const bodyA=actors[0].object.getObjectByName('Body'),bodyB=actors[1].object.getObjectByName('Body');assert(bodyA.skeleton.bones.some((bone,i)=>bone!==bodyB.skeleton.bones[i]),'actors have private bone hierarchies');assert.notEqual(feet[0].object.skeleton,feet[1].object.skeleton,'each shoe binds to its own actor skeleton');
 const m1=feet[0].object.material,m2=feet[1].object.material,g1=feet[0].object.geometry,g2=feet[1].object.geometry;
 g1.addEventListener('dispose',()=>geomDisposeEvents++);g2.addEventListener('dispose',()=>geomDisposeEvents++);m1.addEventListener('dispose',()=>matDisposeEvents++);m2.addEventListener('dispose',()=>matDisposeEvents++);
 feet[0].dispose();feet[0].dispose();feet[1].dispose();feet[1].dispose();
 assert.equal(geomDisposeEvents,2,'both private shoe geometries disposed exactly once');assert.equal(matDisposeEvents,2,'both private shoe materials disposed exactly once');
 assert(!feet[0].object.parent&&!feet[1].object.parent,'shoes removed on disposal');
 for(const fn of [...callbacks])fn();callbacks.clear();
 assert(templateResourceEvents.every(e=>e.geometry===1&&e.material===1&&e.textures===2&&e.imageClose===2),'each owner closes template geometry/material/textures/image sources once');
 const output={schema:'joinallworld.authored-footwear-presentation-check.v1',passed:true,templateLifecycle:{parseCount:templateParseCount,resources:templateResourceEvents,failedFetchRetried:true,lateLoadRejectedAndCleaned:true,sharedWithinKit:true},elapsedLimitSeconds:45,bodySha256:hashes.body,clipSha256:hashes.clip,shoeSha256:hashes.shoes,actors:feet.map(f=>f._checkResult),checks:['exact pinned GLB hash; every source skin lane remaps through the bijective 52-joint name map','private material/geometry/bones per actor; footwear reuses that actor skeleton without adding a duplicate','family morphs copied and synchronized during onBeforeRender','source four-lane weights nonnegative and normalized','all shoe vertices finite at idle, walk, and a manual seated leg pose','actor-specific disposal removes siblings and disposes private resources once'],limitations:['Image pixels are not rendered in this CPU check; full GLB hash is checked and map color-space interpretation is verified against source metadata separately.','The manual seated pose only proves finite skinning, not aesthetic shoe fit.','The feminine shape has the source-reported 4.73 cm maximum fit discrepancy; rendered review remains necessary.']};
 const out=path.join(here,'presentation-check-result.json');writeFileSync(out,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({result:out,passed:true,actors:output.actors.map(a=>({body:a.body,vertices:a.vertices,triangles:a.triangles})),disposals:[geomDisposeEvents,matDisposeEvents]},null,2));
}catch(e){for(const x of feet)x.dispose();throw e;}finally{for(const a of actors)a.dispose();for(const fn of callbacks)fn();diffuse.dispose();normal.dispose();}
