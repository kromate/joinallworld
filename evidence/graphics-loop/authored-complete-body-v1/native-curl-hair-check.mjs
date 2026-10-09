import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadCompleteCharacter } from './rig.ts';
import {
  NativeCurlHairFactory, NATIVE_CURL_HAIR_INSTANCE_LIMIT,
  NATIVE_CURL_HAIR_SOURCE_SHA256, NATIVE_CURL_HAIR_TRIANGLE_LIMIT,
} from './native-curl-hair.ts';

const here=path.dirname(fileURLToPath(import.meta.url));
const bodyPath=path.join(here,'parametric-base-facial.glb');
const clipPath=path.resolve(here,'../../../src/scene/body/assets/clip-pack.glb');
const hairPath=path.join(here,'authored-hair/out/afro01-mobile.glb');
const pins={body:'9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd',clips:'89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',hair:NATIVE_CURL_HAIR_SOURCE_SHA256};
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const sourceBytes={body:readFileSync(bodyPath),clips:readFileSync(clipPath),hair:readFileSync(hairPath)};
for(const [key,bytes] of Object.entries(sourceBytes)) assert.equal(sha(bytes),pins[key],key+' exact source pin');

function imageFreeGlb(input) {
  const bytes=new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(view.getUint32(4,true),2);
  let json,binary;
  for(let offset=12;offset<bytes.length;) {
    const length=view.getUint32(offset,true),kind=view.getUint32(offset+4,true);
    const chunk=bytes.slice(offset+8,offset+8+length);
    if(kind===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(chunk));
    else if(kind===0x004e4942)binary=chunk;
    offset+=length+8;
  }
  assert(json&&binary,'GLB JSON and binary chunks');
  delete json.images;delete json.textures;delete json.samplers;
  for(const material of json.materials??[]){delete material.pbrMetallicRoughness?.baseColorTexture;delete material.normalTexture;delete material.occlusionTexture;delete material.emissiveTexture;}
  const encoded=new TextEncoder().encode(JSON.stringify(json)),jl=(encoded.length+3)&~3,bl=(binary.length+3)&~3;
  const output=new Uint8Array(28+jl+bl),result=new DataView(output.buffer);
  result.setUint32(0,0x46546c67,true);result.setUint32(4,2,true);result.setUint32(8,output.length,true);
  result.setUint32(12,jl,true);result.setUint32(16,0x4e4f534a,true);output.fill(32,20,20+jl);output.set(encoded,20);
  result.setUint32(20+jl,bl,true);result.setUint32(24+jl,0x004e4942,true);output.set(binary,28+jl);
  return output.buffer;
}
async function parse(bytes,stripImages=true){
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(stripImages?imageFreeGlb(bytes):bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'/');
}
function makeSourceRig(scene){
  scene.updateMatrixWorld(true);
  const names=['pelvis','spine_01','spine_02','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l','clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r'];
  const bones=names.map(name=>scene.getObjectByName(name));
  assert(bones.every(Boolean),'pinned source animation rig has all names');
  scene.skeleton=new THREE.Skeleton(bones,bones.map(bone=>bone.matrixWorld.clone().invert()));
  return scene;
}
function objectMetrics(actor){
  let body;actor.object.traverse(node=>{if(node.isSkinnedMesh&&node.name==='Body')body=node;});
  assert(body&&body.skeleton.bones.length===52);
  const head=actor.object.getObjectByName('mixamorigHead');assert(head?.isBone);
  return {body,head};
}
function familyValue(mesh,name){const i=mesh.morphTargetDictionary?.[name];assert(Number.isInteger(i));return mesh.morphTargetInfluences?.[i]??0;}
function setFamily(mesh,name,value){const i=mesh.morphTargetDictionary?.[name];assert(Number.isInteger(i));mesh.morphTargetInfluences[i]=value;}
function guideCentroidsRoot(guide,actorRoot){
  actorRoot.updateMatrixWorld(true);guide.updateMatrixWorld(true);
  const rootInverse=actorRoot.matrixWorld.clone().invert(),position=guide.geometry.getAttribute('position'),index=guide.geometry.getIndex();
  const pts=Array.from({length:position.count},(_,i)=>guide.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(rootInverse).applyMatrix4(guide.matrixWorld));
  const centers=[];
  for(let o=0;o<index.count;o+=3){const a=pts[index.getX(o)],b=pts[index.getX(o+1)],c=pts[index.getX(o+2)];centers.push(a.clone().add(b).add(c).multiplyScalar(1/3));}
  return {pts,centers};
}
function bounds(points){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p.getComponent(k));max[k]=Math.max(max[k],p.getComponent(k));}
  return {min,max};
}
function readInstanceCenter(mesh,index){const m=new THREE.Matrix4();mesh.getMatrixAt(index,m);return new THREE.Vector3().setFromMatrixPosition(m);}
function errorToCloud(point,cloud){let nearest=Infinity;for(const p of cloud)nearest=Math.min(nearest,point.distanceTo(p));return nearest;}

await MeshoptDecoder.ready;
const [bodyGltf,clipGltf,hairGltf]=await Promise.all([parse(sourceBytes.body),parse(sourceBytes.clips),parse(sourceBytes.hair)]);
const sourceRig=makeSourceRig(clipGltf.scene);
const kitCallbacks=new Set();let kitClosed=false;
const kit={
  authoredCharacterAssets:{loadTemplate:async()=>bodyGltf.scene,loadMotionRig:async()=>({root:sourceRig,clips:clipGltf.animations})},
  onDispose(callback){if(kitClosed){callback();return()=>false;}kitCallbacks.add(callback);return()=>kitCallbacks.delete(callback);},
  dispose(){if(kitClosed)return;kitClosed=true;for(const callback of [...kitCallbacks])callback();kitCallbacks.clear();},
};
let guideTemplate;hairGltf.scene.traverse(node=>{if(node.isMesh)guideTemplate=node;});
assert(guideTemplate&&guideTemplate.geometry.getAttribute('position').count===2276);
assert.equal(guideTemplate.geometry.index.count/3,2192);
assert.deepEqual(guideTemplate.userData.targetNames,['bodyFeminine','bodyMasculine']);
const guideGeometry=guideTemplate.geometry;
const guidePositionArray=guideGeometry.getAttribute('position').array;
const guidePositionHash=sha(Buffer.from(guidePositionArray.buffer,guidePositionArray.byteOffset,guidePositionArray.byteLength));
const guideMorphArrays=Object.values(guideGeometry.morphAttributes).flat().map(attribute=>attribute.array);
const guideMorphHashes=guideMorphArrays.map(array=>sha(Buffer.from(array.buffer,array.byteOffset,array.byteLength)));
const looks=[
 {body:'man',face:'oval',expression:'neutral',skin:'#8e5636',hair:'afro',hairColor:'#241b18',appearance:{height:'average',build:'average',ageAppearance:'adult'}},
 {body:'woman',face:'round',expression:'smile',skin:'#c98e62',hair:'afro',hairColor:'#58351f',appearance:{height:'average',build:'average',ageAppearance:'adult'}},
];
const actors=[];
for(let i=0;i<looks.length;i++)actors.push(await loadCompleteCharacter(kit,looks[i],'native-curl-check-'+i));
const factory=new NativeCurlHairFactory(),leases=[],results=[];
try{
 for(let i=0;i<actors.length;i++){
  const actor=actors[i],{body,head}=objectMetrics(actor),actorRoot=actor.object;
  const guide=guideTemplate.clone();
  guide.material=new THREE.MeshBasicMaterial({visible:false});
  guide.name='Pinned Afro Geometry Guide';guide.visible=false;
  guide.position.copy(body.position);guide.quaternion.copy(body.quaternion);guide.scale.copy(body.scale);
  guide.matrix.copy(body.matrix);guide.matrixAutoUpdate=body.matrixAutoUpdate;actorRoot.add(guide);
  const originalBodyGeometry=body.geometry,familyName=i===0?'bodyMasculine':'bodyFeminine';
  assert.equal(familyValue(body,familyName),1,'actor '+i+' has native same-family morph');
  const lease=factory.create({guide,actorRoot,headBone:head,body,guideSha256:pins.hair,hairColor:looks[i].hairColor,maximumCurls:NATIVE_CURL_HAIR_INSTANCE_LIMIT});
  leases.push(lease);
  assert.equal(lease.object.parent,head,'curl instances are direct children of native Head bone');
  assert.equal(lease.object.count,600);assert.equal(lease.metrics.triangles,12000);assert.equal(lease.metrics.drawCalls,1);
  assert.equal(lease.object.geometry.getAttribute('position').count/3,20);
  assert.deepEqual(lease.metrics.familyMorphs,{bodyFeminine:familyValue(body,'bodyFeminine'),bodyMasculine:familyValue(body,'bodyMasculine')});
  assert.equal(guide.visible,false,'module leaves source alpha guide hidden as caller configured');
  assert.equal(body.geometry,originalBodyGeometry,'module leaves body geometry untouched');
  if(i)assert.notEqual(lease.object.material,leases[0].object.material,'actor material must be private');

  const cloud=guideCentroidsRoot(guide,actorRoot),expectedBounds=bounds(cloud.pts),moduleBounds=lease.metrics.sourceGuideRootBounds;
  assert(expectedBounds.min[0]<-0.08&&expectedBounds.max[0]>0.08,'source guide retains authored width');
  assert(expectedBounds.min[1]>1.4&&expectedBounds.max[1]>1.6,'source guide remains in authored head-height range');
  assert(Math.max(...moduleBounds.min.map((v,k)=>Math.abs(v-expectedBounds.min[k])))<1e-6);
  assert(Math.max(...moduleBounds.max.map((v,k)=>Math.abs(v-expectedBounds.max[k])))<1e-6);
  const headWorldToRoot=actorRoot.matrixWorld.clone().invert().multiply(head.matrixWorld.clone());
  const instanceCenters=[],anchorErrors=[];
  for(let curl=0;curl<lease.object.count;curl++){
   const center=readInstanceCenter(lease.object,curl),rootCenter=center.clone().applyMatrix4(headWorldToRoot);
   instanceCenters.push(center);anchorErrors.push(errorToCloud(rootCenter,cloud.centers));
  }
  const maxAnchorError=Math.max(...anchorErrors);
  assert(maxAnchorError<0.001,'each curl center lands on an authored Afro guide triangle centroid');
  const coverageDistances=cloud.centers.map(point=>{
   let nearest=Infinity;for(const center of instanceCenters)nearest=Math.min(nearest,point.distanceTo(center.clone().applyMatrix4(headWorldToRoot)));
   return nearest;
  }).sort((a,b)=>a-b);
  const p95GuideCoverage=coverageDistances[Math.floor(.95*(coverageDistances.length-1))];
  const inverseHeadRest=headWorldToRoot.clone().invert();
  const inverseInstances=[];
  for(let curl=0;curl<lease.object.count;curl++){const matrix=new THREE.Matrix4();lease.object.getMatrixAt(curl,matrix);inverseInstances.push(matrix.invert());}
  let coveredGuideCenters=0;
  for(const point of cloud.centers){
   const headPoint=point.clone().applyMatrix4(inverseHeadRest);
   if(inverseInstances.some(matrix=>headPoint.clone().applyMatrix4(matrix).length()<=.79465))coveredGuideCenters++;
  }
  const guaranteedSolidCoverage=coveredGuideCenters/cloud.centers.length;
  assert(guaranteedSolidCoverage>=.95,'at least95% guide centroids lie inside actual curl inspheres rather than visible scalp gaps');
  assert(lease.metrics.curlCenterHeadBounds.min[1]<0.2&&lease.metrics.curlCenterHeadBounds.max[1]>0.02,'head-local alignment retains source hair volume');

  const sourceWorld=lease.object.localToWorld(readInstanceCenter(lease.object,0).clone()),headQuaternion=head.quaternion.clone();
  head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.35));actorRoot.updateMatrixWorld(true);
  const movedWorld=lease.object.localToWorld(readInstanceCenter(lease.object,0).clone());
  const expectedWorld=head.localToWorld(readInstanceCenter(lease.object,0).clone());
  assert(movedWorld.distanceTo(expectedWorld)<1e-7,'curl instance uses native Head pose transform');
  assert(movedWorld.distanceTo(sourceWorld)>0.0001,'head rotation moves curls with actor');
  head.quaternion.copy(headQuaternion);actorRoot.updateMatrixWorld(true);

  const originalFemale=familyValue(body,'bodyFeminine'),originalMale=familyValue(body,'bodyMasculine');
  const centerBeforeFamilyChange=readInstanceCenter(lease.object,0);
  setFamily(body,'bodyFeminine',.5);setFamily(body,'bodyMasculine',.5);lease.refresh();
  const centerAfterFamilyChange=readInstanceCenter(lease.object,0);
  const familyMorphMovement=centerBeforeFamilyChange.distanceTo(centerAfterFamilyChange);
  assert(familyMorphMovement>0.001,'source family morph moves generated curl centers');
  assert.equal(lease.metrics.familyMorphs.bodyFeminine,.5);
  assert.equal(guide.morphTargetInfluences[guide.userData.targetNames.indexOf('bodyFeminine')],.5);
  setFamily(body,'bodyFeminine',originalFemale);setFamily(body,'bodyMasculine',originalMale);lease.refresh();
  assert.equal(guide.morphTargetInfluences[guide.userData.targetNames.indexOf('bodyMasculine')],originalMale);
  assert.equal(body.geometry,originalBodyGeometry);
  assert.equal(guidePositionHash,sha(Buffer.from(guidePositionArray.buffer,guidePositionArray.byteOffset,guidePositionArray.byteLength)));
  assert(guideMorphArrays.every((array,index)=>array===Object.values(guideGeometry.morphAttributes).flat()[index].array && guideMorphHashes[index]===sha(Buffer.from(array.buffer,array.byteOffset,array.byteLength))),'guide morph arrays remain immutable');

  lease.setColor('#dd6a32');assert.equal(lease.object.material.color.getHexString(),'dd6a32');
  results.push({
   body:looks[i].body,familyMorphs:lease.metrics.familyMorphs,
   sourceGuideBoundsRoot:lease.metrics.sourceGuideRootBounds,
   sourceTriangleCentroidBoundsRoot:lease.metrics.guideTriangleCenterRootBounds,
   curlCenterBoundsHead:lease.metrics.curlCenterHeadBounds,
   sourceGuideTriangles:lease.metrics.guideTriangles,curls:lease.metrics.curls,
   curlTriangles:lease.metrics.triangles,drawCalls:lease.metrics.drawCalls,
   guaranteedSolidCoverage,maxCurlAnchorErrorMeters:maxAnchorError,p95GuideCentroidCoverageMeters:p95GuideCoverage,familyMorphCenterMovementMeters:familyMorphMovement,
   outputInstanceMatrixBytes:lease.object.instanceMatrix.array.byteLength,
  });
 }
 assert.equal(leases[0].object.geometry,leases[1].object.geometry,'unit curl geometry is shared');
 assert.notEqual(leases[0].object.material,leases[1].object.material,'actor materials are private');
 assert.notEqual(leases[0].object.instanceMatrix.array,leases[1].object.instanceMatrix.array,'actor transforms are private');
 const secondMatrixBefore=leases[1].object.instanceMatrix.array.slice(0,16);
 leases[0].object.setMatrixAt(0,new THREE.Matrix4().makeTranslation(3,4,5));
 assert.deepEqual([...leases[1].object.instanceMatrix.array.slice(0,16)],[...secondMatrixBefore],'changing one actor leaves the other instance transforms unchanged');
 assert.equal(factory.activeReferences,2);
 leases[0].dispose();assert.equal(factory.activeReferences,1);
 assert.equal(leases[1].object.geometry.getAttribute('position').count/3,20,'disposing one actor leaves shared geometry');
 assert.throws(()=>factory.dispose(),/dispose all actor leases/);
 leases[1].dispose();assert.equal(factory.activeReferences,0);factory.dispose();
 assert.throws(()=>factory.create({}),/factory is disposed/);
 kit.dispose();
 console.log(JSON.stringify({
  status:'passed',source:{asset:'afro01-mobile.glb',sha256:pins.hair,vertices:2276,triangles:2192},
  limits:{curlInstanceLimit:NATIVE_CURL_HAIR_INSTANCE_LIMIT,triangleLimit:NATIVE_CURL_HAIR_TRIANGLE_LIMIT},
  guarantees:['farthest-point samples originate from actual source afro triangle centroids','solid 3D curl geometry has no alpha cards','native Head parenting follows pose equivariantly','source family morph deltas are mirrored on refresh','shared unit geometry, actor-private materials and transforms, safe disposal','pinned hair and actor body geometry remain immutable'],
  results,
 },null,2));
}finally{
 for(const lease of leases)lease.dispose();factory.dispose();kit.dispose();
 for(const actor of actors)actor.dispose();
}
