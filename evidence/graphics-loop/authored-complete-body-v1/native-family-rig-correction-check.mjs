import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyNativeFamilyRigCorrection } from './native-family-rig-correction.ts';
import anchorData from './native-family-rig-audit/family-anchor-coefficients.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const assetPath = path.join(repo, 'evidence/graphics-loop/authored-character-spike-v1/parametric-base-expressive.glb');
const outputPath = path.join(here, 'native-family-rig-correction-check-result.json');
const expectedSha = '0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const bytes = readFileSync(assetPath);
assert.equal(hash(bytes), expectedSha, 'pinned expressive authored GLB');
await MeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '/');
const template = gltf.scene;
const originalMeshes = [];
template.traverse(node => { if (node.isSkinnedMesh) originalMeshes.push(node); });
assert.deepEqual(originalMeshes.map(mesh => mesh.name).sort(), ['Body','Eyes','Teeth','Tongue']);

function setFamily(root, feminine, masculine) {
  const meshes = [];
  root.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  for (const mesh of meshes) {
    const dict=mesh.morphTargetDictionary, values=mesh.morphTargetInfluences;
    assert(dict && values, `${mesh.name} morph targets`);
    const f=dict.bodyFeminine, m=dict.bodyMasculine;
    assert(Number.isInteger(f) && Number.isInteger(m), `${mesh.name} family target names`);
    values[f]=feminine; values[m]=masculine;
  }
}
function skinned(root) {
  const meshes=[]; root.traverse(node=>{if(node.isSkinnedMesh)meshes.push(node);}); return meshes;
}
function snapshotBoneState(root) {
  const bones=skinned(root)[0].skeleton.bones;
  const skeletons=[...new Set(skinned(root).map(mesh=>mesh.skeleton))];
  return {
    bones:bones.map(b=>({name:b.name,p:b.position.toArray(),q:b.quaternion.toArray(),s:b.scale.toArray()})),
    inverses:skeletons.map(s=>s.boneInverses.map(m=>m.toArray())),
  };
}
function vertexSnapshot(root) {
  root.updateMatrixWorld(true);
  const values=[];
  for(const mesh of skinned(root)) {
    const p=mesh.geometry.getAttribute('position'), v=new THREE.Vector3(), rows=[];
    for(let i=0;i<p.count;i++) rows.push(mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld).toArray());
    values.push({name:mesh.name,rows});
  }
  return values;
}
function maxVertexError(a,b) {
  assert.equal(a.length,b.length);
  let max=0,count=0;
  for(let m=0;m<a.length;m++) {
    assert.equal(a[m].name,b[m].name);
    assert.equal(a[m].rows.length,b[m].rows.length);
    for(let i=0;i<a[m].rows.length;i++) {
      const x=a[m].rows[i],y=b[m].rows[i];
      max=Math.max(max,Math.hypot(x[0]-y[0],x[1]-y[1],x[2]-y[2])); count++;
    }
  }
  return {maxMeters:max,vertices:count};
}
function attributeHashes(root) {
  return skinned(root).map(mesh=>({name:mesh.name,attributes:Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key,a])=>[key,hash(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength))])),index:mesh.geometry.index?hash(Buffer.from(mesh.geometry.index.array.buffer,mesh.geometry.index.array.byteOffset,mesh.geometry.index.array.byteLength)):null}));
}
function anchorErrors(root, femaleWeight, maleWeight) {
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert();
  const bones=skinned(root)[0].skeleton.bones;
  let max=0; const byBone={};
  for(const bone of bones) {
    const a=anchorData.anchors[bone.name]; assert(a,`coefficient for ${bone.name}`);
    const expected=a.female.map((v,i)=>v*femaleWeight+a.male[i]*maleWeight);
    const actual=bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).toArray();
    const err=Math.hypot(actual[0]-expected[0],actual[1]-expected[1],actual[2]-expected[2]);
    byBone[bone.name]=err; max=Math.max(max,err);
  }
  return {maxMeters:max,byBone};
}
function inverseBindErrors(root) {
  root.updateMatrixWorld(true);
  const inverseRoot=root.matrixWorld.clone().invert(); let max=0;
  const values=[];
  for(const mesh of skinned(root)) for(let i=0;i<mesh.skeleton.bones.length;i++) {
    const bone=mesh.skeleton.bones[i];
    const expected=inverseRoot.clone().multiply(bone.matrixWorld).invert();
    const actual=mesh.skeleton.boneInverses[i];
    for(let j=0;j<16;j++) max=Math.max(max,Math.abs(expected.elements[j]-actual.elements[j]));
    values.push(hash(Buffer.from(new Float32Array(actual.elements).buffer)));
  }
  return {maxElementError:max,entries:values.length};
}
function rootTransform(root) { return {p:root.position.toArray(),q:root.quaternion.toArray(),s:root.scale.toArray()}; }

const templateHashes=attributeHashes(template);
const templateBones=snapshotBoneState(template);
const actors=[];
for(const descriptor of [
  {label:'female-root-transformed',feminine:1,masculine:0,transform:{p:[1.25,.37,-.82],q:new THREE.Quaternion().setFromEuler(new THREE.Euler(.12,.63,-.04)).toArray(),s:[1.1,.93,1.04]}},
  {label:'male',feminine:0,masculine:1,transform:null},
  {label:'mixed-family',feminine:.7,masculine:.3,transform:null},
]) {
  const root=cloneSkinnedHierarchy(template);
  setFamily(root,descriptor.feminine,descriptor.masculine);
  const meshes=skinned(root); const skeleton=meshes[0].skeleton;
  skeleton.pose(); root.updateMatrixWorld(true);
  if(descriptor.transform) {
    root.position.fromArray(descriptor.transform.p); root.quaternion.fromArray(descriptor.transform.q); root.scale.fromArray(descriptor.transform.s); root.updateMatrixWorld(true);
  }
  const beforeRoot=rootTransform(root), beforeAttributes=attributeHashes(root);
  const beforeVertices=vertexSnapshot(root), beforeState=snapshotBoneState(root);
  const actor={label:descriptor.label,root,feminine:descriptor.feminine,masculine:descriptor.masculine,beforeRoot,beforeAttributes,beforeVertices,beforeState};
  actors.push(actor);
}

// Updating one actor must not affect the shared immutable template or either other clone.
const templateBoneBefore=snapshotBoneState(template);
const maleBoneBefore=actors[1].root.getObjectByName('mixamorigHips').position.toArray();
const mixedBoneBefore=actors[2].root.getObjectByName('mixamorigHips').position.toArray();
const femaleCorrection=applyNativeFamilyRigCorrection(actors[0].root);
assert.deepEqual(rootTransform(actors[0].root),actors[0].beforeRoot,'root transform unchanged');
assert.deepEqual(actors[1].root.getObjectByName('mixamorigHips').position.toArray(),maleBoneBefore,'other actor unaffected');
assert.deepEqual(actors[2].root.getObjectByName('mixamorigHips').position.toArray(),mixedBoneBefore,'mixed actor unaffected');
assert.deepEqual(snapshotBoneState(template),templateBoneBefore,'shared template bones and inverse binds unchanged');
assert.deepEqual(attributeHashes(actors[0].root),actors[0].beforeAttributes,'female geometry attributes remain byte-identical');
const femaleVertexError=maxVertexError(actors[0].beforeVertices,vertexSnapshot(actors[0].root));
assert(femaleVertexError.maxMeters<2e-5,`female post-correction skinned rest vertices changed ${femaleVertexError.maxMeters}m`);
const femaleAnchor=anchorErrors(actors[0].root,1,0);
assert(femaleAnchor.maxMeters<2e-5,`female source anchors ${femaleAnchor.maxMeters}m`);
const femaleBind=inverseBindErrors(actors[0].root);
assert(femaleBind.maxElementError<2e-6,`female inverse binds mismatch ${femaleBind.maxElementError}`);
assert.equal(femaleCorrection.metrics.skeletonWrapperCount,4,'each GLTF mesh skin wrapper receives corrected binds');

const maleCorrection=applyNativeFamilyRigCorrection(actors[1].root);
const maleVertexError=maxVertexError(actors[1].beforeVertices,vertexSnapshot(actors[1].root));
assert(maleVertexError.maxMeters<2e-5,`male post-correction skinned rest vertices changed ${maleVertexError.maxMeters}m`);
const maleAnchor=anchorErrors(actors[1].root,0,1);
assert(maleAnchor.maxMeters<2e-5,`male source anchors ${maleAnchor.maxMeters}m`);
const maleBind=inverseBindErrors(actors[1].root);
assert(maleBind.maxElementError<2e-6,`male inverse binds mismatch ${maleBind.maxElementError}`);
const maleCorrectedState=snapshotBoneState(actors[1].root);

const mixedCorrection=applyNativeFamilyRigCorrection(actors[2].root);
const mixedVertexError=maxVertexError(actors[2].beforeVertices,vertexSnapshot(actors[2].root));
assert(mixedVertexError.maxMeters<2e-5,`mixed post-correction skinned rest vertices changed ${mixedVertexError.maxMeters}m`);
const mixedAnchor=anchorErrors(actors[2].root,.7,.3);
assert(mixedAnchor.maxMeters<2e-5,`mixed source anchors ${mixedAnchor.maxMeters}m`);
const mixedCorrectedState=snapshotBoneState(actors[2].root);

// Restoration is exact and only touches the actor whose correction controller is disposed.
const femaleCorrectedState=snapshotBoneState(actors[0].root);
femaleCorrection.dispose();
assert.deepEqual(snapshotBoneState(actors[0].root),actors[0].beforeState,'dispose restores original female bone/inverse-bind state');
assert.deepEqual(snapshotBoneState(template),templateBones,'dispose does not mutate the shared source template');
assert.deepEqual(snapshotBoneState(actors[1].root),maleCorrectedState,'other corrected actor remains independent');
assert.deepEqual(snapshotBoneState(actors[2].root),mixedCorrectedState,'mixed corrected actor remains independent');
assert.notDeepEqual(femaleCorrectedState,actors[0].beforeState,'correction actually changed family rest transforms');

// A zero-family look is rejected before mutating its actor.
const invalid=cloneSkinnedHierarchy(template); setFamily(invalid,0,0); invalid.skeleton?.pose?.();
const invalidBefore=snapshotBoneState(invalid);
assert.throws(()=>applyNativeFamilyRigCorrection(invalid),/family morph weights are both zero/);
assert.deepEqual(snapshotBoneState(invalid),invalidBefore,'rejected invalid actor remains unchanged');

assert.deepEqual(attributeHashes(template),templateHashes,'template source geometry remains byte-identical');
assert.deepEqual(snapshotBoneState(template),templateBones,'template source skeleton remains unchanged');
for(const actor of actors) for(const mesh of skinned(actor.root)) mesh.skeleton.dispose();
for(const mesh of originalMeshes) mesh.skeleton.dispose();
const output={
  status:'PASS',
  source:{path:'evidence/graphics-loop/authored-character-spike-v1/parametric-base-expressive.glb',bytes:bytes.length,sha256:expectedSha},
  coefficients:{path:'native-family-rig-audit/family-anchor-coefficients.json',schema:anchorData.schema,sha256:hash(readFileSync(path.join(here,'native-family-rig-audit/family-anchor-coefficients.json')))},
  method:'three real GLTFLoader clones; exact 52 source-indexed anchors; per-actor family influences read from Body; root-relative rest bone positions and inverse binds; world-space getVertexPosition checks include a translated, rotated, nonuniformly scaled actor root; no geometry or morph edits',
  actors:[
    {label:actors[0].label,familyWeights:femaleCorrection.metrics.familyWeights,metrics:femaleCorrection.metrics,vertexPreservation:femaleVertexError,anchorVerification:femaleAnchor.maxMeters,inverseBindMaxElementError:femaleBind.maxElementError},
    {label:actors[1].label,familyWeights:maleCorrection.metrics.familyWeights,metrics:maleCorrection.metrics,vertexPreservation:maleVertexError,anchorVerification:maleAnchor.maxMeters,inverseBindMaxElementError:maleBind.maxElementError},
    {label:actors[2].label,familyWeights:mixedCorrection.metrics.familyWeights,metrics:mixedCorrection.metrics,vertexPreservation:mixedVertexError,anchorVerification:mixedAnchor.maxMeters,inverseBindMaxElementError:inverseBindErrors(actors[2].root).maxElementError},
  ],
  claims:{actualSkinnedVerticesPreserved:true,exactAll52AnchorFit:true,allFourSkinWrappersUpdated:true,sourceTemplateImmutable:true,otherActorIsolation:true,nonidentityRootPreserved:true,restoreOnDispose:true,invalidFamilyRefusedWithoutMutation:true},
  limitations:['CPU bind-pose proof only; no GPU render or outfit/footwear/pose acceptance.','Only bodyFeminine/bodyMasculine anchor deltas are corrected; other static identity morphs can also move anchor vertices and remain outside this family-only correction.','Call after family influences are applied and before constructing native pose/action/presentation controllers.'],
};
writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n');
maleCorrection.dispose(); mixedCorrection.dispose();
for(const mesh of skinned(invalid)) mesh.skeleton.dispose();
console.log(JSON.stringify({status:output.status,source:output.source,actors:output.actors.map(({label,familyWeights,vertexPreservation,anchorVerification,inverseBindMaxElementError})=>({label,familyWeights,maxRestVertexError:vertexPreservation.maxMeters,maxAnchorError:anchorVerification,maxInverseBindError:inverseBindMaxElementError})),outputPath},null,2));
