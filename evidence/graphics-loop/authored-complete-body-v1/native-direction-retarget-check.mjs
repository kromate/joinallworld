import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadCompleteCharacter } from './rig.ts';
import { applyNativeFamilyRigCorrection } from './native-family-rig-correction.ts';
import { createNativeSourceLandmarkSampler } from './native-source-sampler.ts';
import { createNativeClipSolver } from './native-clip-solver.ts';
import { createNativeDirectionRetargeter, mapSourceSegmentDirection } from './native-direction-retarget.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const pins = { body: 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
  clipPack: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47' };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeNames = {
  Hips:'mixamorigHips', Spine:'mixamorigSpine', Spine1:'mixamorigSpine1', Spine2:'mixamorigSpine2', Neck:'mixamorigNeck', Head:'mixamorigHead',
  LeftShoulder:'mixamorigLeftShoulder', LeftArm:'mixamorigLeftArm', LeftForeArm:'mixamorigLeftForeArm', LeftHand:'mixamorigLeftHand',
  RightShoulder:'mixamorigRightShoulder', RightArm:'mixamorigRightArm', RightForeArm:'mixamorigRightForeArm', RightHand:'mixamorigRightHand',
  LeftUpLeg:'mixamorigLeftUpLeg', LeftLeg:'mixamorigLeftLeg', LeftFoot:'mixamorigLeftFoot', LeftToeBase:'mixamorigLeftToeBase',
  RightUpLeg:'mixamorigRightUpLeg', RightLeg:'mixamorigRightLeg', RightFoot:'mixamorigRightFoot', RightToeBase:'mixamorigRightToeBase',
};
const pairs = [
  ['Hips','Spine'], ['Spine','Spine1'], ['Spine1','Spine2'], ['Spine2','Neck'], ['Neck','Head'],
  ['LeftShoulder','LeftArm'], ['LeftArm','LeftForeArm'], ['LeftForeArm','LeftHand'],
  ['RightShoulder','RightArm'], ['RightArm','RightForeArm'], ['RightForeArm','RightHand'],
  ['LeftUpLeg','LeftLeg'], ['LeftLeg','LeftFoot'], ['LeftFoot','LeftToeBase'],
  ['RightUpLeg','RightLeg'], ['RightLeg','RightFoot'], ['RightFoot','RightToeBase'],
];

function stripImages(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json, bin;
  for (let at = 12; at < bytes.length;) {
    const size = view.getUint32(at, true), kind = view.getUint32(at + 4, true), chunk = bytes.slice(at + 8, at + 8 + size);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) bin = chunk;
    at += size + 8;
  }
  assert(json && bin, 'GLB JSON and binary chunks');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) { delete material.pbrMetallicRoughness?.baseColorTexture; delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture; }
  const encoded = new TextEncoder().encode(JSON.stringify(json)), jl = (encoded.length + 3) & ~3, bl = (bin.length + 3) & ~3;
  const out = new Uint8Array(28 + jl + bl), dv = new DataView(out.buffer);
  dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,out.length,true);dv.setUint32(12,jl,true);dv.setUint32(16,0x4e4f534a,true);
  out.fill(32,20,20+jl);out.set(encoded,20);dv.setUint32(20+jl,bl,true);dv.setUint32(24+jl,0x004e4942,true);out.set(bin,28+jl);
  return out.buffer;
}
async function parse(bytes) { return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(stripImages(bytes), '/'); }
function makeSourceRig(root, clips) {
  root.updateMatrixWorld(true);
  const names = ['pelvis','spine_01','spine_02','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l','clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r'];
  const bones = names.map((name) => root.getObjectByName(name));
  assert(bones.every(Boolean), 'clip pack has all mapped source bones');
  root.skeleton = new THREE.Skeleton(bones, bones.map((bone) => bone.matrixWorld.clone().invert()));
  return root;
}
function makeKit(template, motionRoot, clips) {
  const callbacks = new Set(); let closed = false;
  return { authoredCharacterAssets: { loadTemplate: async () => template, loadMotionRig: async () => ({ root: motionRoot, clips }) },
    onDispose(fn) { if (closed) { fn(); return () => false; } callbacks.add(fn); return () => callbacks.delete(fn); },
    dispose() { if (closed) return; closed = true; for (const fn of [...callbacks]) { callbacks.delete(fn); fn(); } } };
}
function localPoint(root, bone) { root.updateWorldMatrix(true,false); root.updateMatrixWorld(true); return bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert()); }
function targetRestLandmarks(root) {
  return Object.fromEntries(Object.entries(nativeNames).map(([joint,name]) => [joint, localPoint(root, root.getObjectByName(name)).toArray()]));
}
function bodyState(root) {
  const data=[];
  root.traverse((node)=>{if(node.isSkinnedMesh){const geometry=node.geometry;data.push({name:node.name,position:sha(Buffer.from(geometry.attributes.position.array.buffer)),index:geometry.index?sha(Buffer.from(geometry.index.array.buffer)):null,morph:node.morphTargetInfluences?[...node.morphTargetInfluences]:[]});}});
  return data;
}
function applyPlacement(root) {
  const parent = new THREE.Group(); parent.position.set(.31,-.12,.2); parent.rotation.set(.05,.37,-.04); parent.scale.setScalar(1.03); parent.add(root);
  root.position.set(.17,.23,-.31); root.rotation.set(.08,.43,-.05); root.scale.setScalar(1.07);
  parent.updateWorldMatrix(true,false); parent.updateMatrixWorld(true); return parent;
}
function actualDirection(root, parentJoint, childJoint) {
  const p=localPoint(root,root.getObjectByName(nativeNames[parentJoint]));
  const c=localPoint(root,root.getObjectByName(nativeNames[childJoint])); return c.sub(p).normalize();
}
function makeActorKit(template, sourceRoot, clips) { return makeKit(template,sourceRoot,clips); }

await MeshoptDecoder.ready;
const bodyBytes=readFileSync(bodyPath),clipBytes=readFileSync(clipPath);
assert.equal(sha(bodyBytes),pins.body,'pinned body asset');assert.equal(sha(clipBytes),pins.clipPack,'pinned clip pack');
const [bodyGltf,clipGltf]=await Promise.all([parse(bodyBytes),parse(clipBytes)]);
const sourceRoot=makeSourceRig(clipGltf.scene,clipGltf.animations);
const sampler=createNativeSourceLandmarkSampler(sourceRoot.clone(true),clipGltf.animations);
const kit=makeActorKit(bodyGltf.scene,sourceRoot,clipGltf.animations);
const records=[];
for(const family of ['man','woman']){
  const look={body:family,face:'oval',expression:'neutral',skin:family==='man'?'#7a4a2c':'#c98e62',hair:'lowcut',outfit:'casual',outfitColor:'#3f72c4',bottomsColor:'#243a66',fabric:'plain',accessories:[],appearance:{height:'average',build:'average',ageAppearance:'adult'}};
  const actors=[];
  for(const variant of ['position','direction']){
    const character=await loadCompleteCharacter(kit,look,`direction-${family}-${variant}`);
    const correction=applyNativeFamilyRigCorrection(character.object);
    const parent=applyPlacement(character.object);
    const rest=targetRestLandmarks(character.object);
    const sourceRest=sampler.restLandmarks;
    const controller=variant==='position'
      ? createNativeClipSolver(character.object,{sourceRest})
      : createNativeDirectionRetargeter(character.object,{sourceRest,floorY:0});
    actors.push({variant,character,correction,parent,rest,controller,bodyState:bodyState(character.object)});
  }
  for(const clipName of ['idle','cook','eat','drink']){
    const duration=sampler.durations.get(clipName); assert(Number.isFinite(duration)&&duration>0,`clip ${clipName} exists`);
    const time=clipName==='idle'?duration*.25:duration*.5;
    const frame=sampler.sampleClip(clipName,time,'loop');
    for(const actor of actors){
      const applied=actor.variant==='position'
        ? actor.controller.apply(frame,{kind:'flat-feet',floorY:0})
        : actor.controller.apply(frame);
      actor.parent.updateWorldMatrix(true,false);actor.parent.updateMatrixWorld(true);
      const errors=[];
      for(const [sourceParent,sourceChild] of pairs){
        const expected=mapSourceSegmentDirection(sampler.restLandmarks,actor.rest,sourceParent,sourceChild,frame.landmarks);
        const actual=actualDirection(actor.character.object,sourceParent,sourceChild);
        errors.push({segment:`${sourceParent}->${sourceChild}`,radians:expected.angleTo(actual)});
      }
      const hips=localPoint(actor.character.object,actor.character.object.getObjectByName(nativeNames.Hips));
      const head=localPoint(actor.character.object,actor.character.object.getObjectByName(nativeNames.Head));
      const knee=localPoint(actor.character.object,actor.character.object.getObjectByName(nativeNames.LeftLeg));
      const ankle=localPoint(actor.character.object,actor.character.object.getObjectByName(nativeNames.LeftFoot));
      const stateAfter=bodyState(actor.character.object);
      assert.deepEqual(stateAfter,actor.bodyState,`${family}/${actor.variant}/${clipName}: geometry and morph state unchanged`);
      const row={family,variant:actor.variant,clip:clipName,seconds:Number(time.toFixed(4)),directionErrorsRadians:errors,
        maxDirectionErrorRadians:Math.max(...errors.map((entry)=>entry.radians)),hipHeadDirectionRoot:head.sub(hips).normalize().toArray(),
        leftThighDirectionRoot:ankle.sub(knee).normalize().toArray(),footSoleMinY:applied.footSoleMinY,
        ...(actor.variant==='direction'?{nativeSegmentLengthErrorMeters:applied.segmentLengthMaxErrorMeters,footRootShiftY:applied.footRootShiftY}:{}),
        ...(actor.variant==='position'?{supportStatus:applied.supportStatus}:{})};
      // Record current solver support status and candidate's one-sided lowest-sole shift separately.
      records.push(row);
      actor.controller.restore();
    }
  }
  for(const actor of actors){actor.controller.dispose();actor.correction.dispose();actor.character.dispose();}
}
sampler.dispose();kit.dispose();
const result={status:'pass',assets:{bodySha256:pins.body,clipPackSha256:pins.clipPack},source:{directionRetargetSha256:sha(readFileSync(path.join(here,'native-direction-retarget.ts'))),solverSha256:sha(readFileSync(path.join(here,'native-clip-solver.ts'))),samplerSha256:sha(readFileSync(path.join(here,'native-source-sampler.ts'))),checkerSha256:sha(readFileSync(fileURLToPath(import.meta.url)))},records,
limitations:['Offline CPU direction comparison only; no rendered acceptance or contact/prop proof.','Both methods use the same source clip and corrected native rest rig. Direction mode retains measured native segment lengths and maps source directions through measured root anatomical bases.','Current positional solver remains the reference; lower angular error is not by itself evidence of better whole-body motion.','The candidate aligns only the lowest weighted sole to the requested floor and reports the other sole separately; it does not prove continuous foot planting.']};
const output=path.join(here,'native-direction-retarget-check-result.json');writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,records:records.length,output},null,2));
