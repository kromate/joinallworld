import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadCompleteCharacter } from '../rig.ts';
import { applyNativeFamilyRigCorrection } from '../native-family-rig-correction.ts';
import { createNativeSourceLandmarkSampler } from '../native-source-sampler.ts';
import { createNativeClipSolver } from '../native-clip-solver.ts';
import { createNativeWristOrientationController } from './native-wrist-controller.ts';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../../');
const bodyPath=path.join(here,'../authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const clipPath=path.join(repo,'src/scene/body/assets/clip-pack.glb');
const pins={body:'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',clip:'89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47'};
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
function stripImages(input){
  const bytes=new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let json,bin;
  for(let at=12;at<bytes.length;){const size=view.getUint32(at,true),kind=view.getUint32(at+4,true),chunk=bytes.slice(at+8,at+8+size);if(kind===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(chunk));else if(kind===0x004e4942)bin=chunk;at+=size+8;}
  assert(json&&bin,'GLB JSON/BIN chunks');delete json.images;delete json.textures;delete json.samplers;
  for(const material of json.materials??[]){delete material.pbrMetallicRoughness?.baseColorTexture;delete material.normalTexture;delete material.occlusionTexture;delete material.emissiveTexture;}
  const encoded=new TextEncoder().encode(JSON.stringify(json)),jl=(encoded.length+3)&~3,bl=(bin.length+3)&~3,out=new Uint8Array(28+jl+bl),dv=new DataView(out.buffer);
  dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,out.length,true);dv.setUint32(12,jl,true);dv.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jl);out.set(encoded,20);dv.setUint32(20+jl,bl,true);dv.setUint32(24+jl,0x004e4942,true);out.set(bin,28+jl);return out.buffer;
}
async function parse(bytes){return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(stripImages(bytes),'/');}
function sourceRig(root,clips){
  root.updateMatrixWorld(true);const names=['pelvis','spine_01','spine_02','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l','clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r'];
  const bones=names.map(name=>root.getObjectByName(name));assert(bones.every(Boolean),'all source landmarks exist');root.skeleton=new THREE.Skeleton(bones,bones.map(bone=>bone.matrixWorld.clone().invert()));return root;
}
function makeKit(template,motionRoot,clips){const callbacks=new Set();let closed=false;return{authoredCharacterAssets:{loadTemplate:async()=>template,loadMotionRig:async()=>({root:motionRoot,clips})},onDispose(fn){if(closed){fn();return()=>false;}callbacks.add(fn);return()=>callbacks.delete(fn);},dispose(){if(closed)return;closed=true;for(const fn of [...callbacks]){callbacks.delete(fn);fn();}},get callbackCount(){return callbacks.size;}};}
function makeLook(family){return{body:family,face:'oval',expression:'neutral',skin:family==='man'?'#7a4a2c':'#c98e62',hair:'lowcut',outfit:'casual',outfitColor:'#3f72c4',bottomsColor:'#243a66',fabric:'plain',accessories:[],appearance:{height:'average',build:'average',ageAppearance:'adult'}};}
function setPlaced(parent,actor){parent.position.set(.31,-.12,.2);parent.rotation.set(.05,.37,-.04);parent.scale.setScalar(1.03);actor.position.set(.17,.23,-.31);actor.rotation.set(.08,.43,-.05);actor.scale.setScalar(1.07);parent.updateWorldMatrix(true,false);parent.updateMatrixWorld(true);}
function setIdentity(parent,actor){parent.position.set(0,0,0);parent.rotation.set(0,0,0);parent.scale.setScalar(1);actor.position.set(0,0,0);actor.rotation.set(0,0,0);actor.scale.setScalar(1);parent.updateWorldMatrix(true,false);parent.updateMatrixWorld(true);}
function qSnapshot(bone){return bone.quaternion.toArray();}
function worldPoint(root,bone){root.updateWorldMatrix(true,false);root.updateMatrixWorld(true);return bone.getWorldPosition(new THREE.Vector3());}
function closeArray(a,b,tol,label){assert.equal(a.length,b.length,label);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<=tol,`${label}[${i}] ${v} vs ${b[i]}`));}

await MeshoptDecoder.ready;
const bodyBytes=readFileSync(bodyPath),clipBytes=readFileSync(clipPath);assert.equal(sha(bodyBytes),pins.body,'compressed body pin');assert.equal(sha(clipBytes),pins.clip,'clip-pack pin');
const [bodyGltf,clipGltf]=await Promise.all([parse(bodyBytes),parse(clipBytes)]);const sharedSource=sourceRig(clipGltf.scene,clipGltf.animations);
const kit=makeKit(bodyGltf.scene,sharedSource,clipGltf.animations),sampler=createNativeSourceLandmarkSampler(sharedSource.clone(true),clipGltf.animations);
const clips=['idle','cook','eat','drink'],rows=[];
for(const family of ['man','woman']){
  const character=await loadCompleteCharacter(kit,makeLook(family),`native-wrist-controller-${family}`);
  const correction=applyNativeFamilyRigCorrection(character.object),actor=character.object,parent=new THREE.Group();parent.add(actor);
  const solver=createNativeClipSolver(actor,{sourceRest:sampler.restLandmarks});
  const wrist=createNativeWristOrientationController(actor,sampler.restWristRotations);
  const hands={left:actor.getObjectByName('mixamorigLeftHand'),right:actor.getObjectByName('mixamorigRightHand')};
  assert(hands.left?.isBone&&hands.right?.isBone,'both actual native hands found');
  const nativeRest={left:qSnapshot(hands.left),right:qSnapshot(hands.right)};
  for(const clip of clips){
    const duration=sampler.durations.get(clip);assert(Number.isFinite(duration)&&duration>0,`actual clip ${clip} exists`);
    const seconds=clip==='idle'?duration*.25:duration*.5;
    const frame=sampler.sampleClip(clip,seconds,'loop');
    for(const side of ['left','right']){
      for(const q of [frame.wristRotations.forearm[side],frame.wristRotations.hand[side],sampler.restWristRotations.forearm[side],sampler.restWristRotations.hand[side]]){
        assert([q.x,q.y,q.z,q.w].every(Number.isFinite)&&Math.abs(q.length()-1)<1e-5,`${family}/${clip}/${side} source quaternion finite and unit`);
      }
    }
    setPlaced(parent,actor);
    solver.applyFrame(frame,{kind:'flat-feet',floorY:0});
    const before={left:worldPoint(actor,hands.left),right:worldPoint(actor,hands.right)};
    const placementResult=wrist.apply(frame);
    const after={left:worldPoint(actor,hands.left),right:worldPoint(actor,hands.right)};
    const leftError=before.left.distanceTo(after.left),rightError=before.right.distanceTo(after.right);
    assert.ok(Math.max(leftError,rightError)<1e-7,`${family}/${clip}: local wrist rotations keep both IK hand origins fixed`);
    const placedLocal={left:qSnapshot(hands.left),right:qSnapshot(hands.right)};
    // Applying the same ephemeral frame twice is idempotent; the wrist delta is never accumulated.
    const second=wrist.apply(frame);
    closeArray(qSnapshot(hands.left),placedLocal.left,1e-8,`${family}/${clip} left idempotent`);
    closeArray(qSnapshot(hands.right),placedLocal.right,1e-8,`${family}/${clip} right idempotent`);
    const movedAngles={left:placementResult.leftSourceDeltaRadians,right:placementResult.rightSourceDeltaRadians};
    assert.deepEqual(second,placementResult,`${family}/${clip}: repeat apply yields same measurements`);
    // Under a parent/actor transform, the same frame must produce the same hand-local rotations.
    wrist.restore();solver.restore();setIdentity(parent,actor);
    solver.applyFrame(frame,{kind:'flat-feet',floorY:0});wrist.apply(frame);
    closeArray(qSnapshot(hands.left),placedLocal.left,1e-7,`${family}/${clip} left placement invariant`);
    closeArray(qSnapshot(hands.right),placedLocal.right,1e-7,`${family}/${clip} right placement invariant`);
    const prop=new THREE.Object3D();hands.right.add(prop);parent.updateWorldMatrix(true,false);parent.updateMatrixWorld(true);
    const propQ=prop.getWorldQuaternion(new THREE.Quaternion());assert.ok(Math.abs(propQ.length()-1)<1e-8,'hand-attached prop receives finite world orientation');hands.right.remove(prop);
    wrist.restore();
    closeArray(qSnapshot(hands.left),nativeRest.left,1e-8,`${family} left restore`);closeArray(qSnapshot(hands.right),nativeRest.right,1e-8,`${family} right restore`);
    rows.push({family,clip,seconds:Number(seconds.toFixed(5)),...movedAngles,maxHandOriginErrorMeters:Math.max(leftError,rightError)});
  }
  wrist.dispose();solver.dispose();correction.dispose();character.dispose();
}
sampler.dispose();kit.dispose();assert.equal(kit.callbackCount,0,'Kit disposes without leaked callbacks');
const result={status:'pass',assets:{bodySha256:pins.body,clipPackSha256:pins.clip},source:{samplerSha256:sha(readFileSync(path.join(here,'../native-source-sampler.ts'))),controllerSha256:sha(readFileSync(path.join(here,'native-wrist-controller.ts'))),mappingSha256:sha(readFileSync(path.join(here,'native-wrist-orientation.ts'))),checkSha256:sha(readFileSync(fileURLToPath(import.meta.url)))},samples:rows,
  limitations:['Bounded actual-asset CPU transform/resource check; no WebGL pixels or prop-contact acceptance.','This check exercises the controller directly; the production factory integration and runtime ordering require separate verification.','Source wrist quaternions are root-relative orientations measured on the same private sampled clip hierarchy.','The test proves hand-origin preservation and placement invariance, not that every prop uses a suitable attachment offset or grip.']};
const output=path.join(here,'native-wrist-controller-check-result.json');writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,samples:rows.length,output},null,2));
