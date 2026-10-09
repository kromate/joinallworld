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
import { mapSourceWristOrientation } from './native-wrist-orientation.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const bodyPath = path.join(here, '../authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const clipPath = path.join(root, 'src/scene/body/assets/clip-pack.glb');
const pins = {
  body: 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
  clips: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function stripImages(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json, bin;
  for (let at = 12; at < bytes.length;) {
    const n = view.getUint32(at, true), kind = view.getUint32(at + 4, true), chunk = bytes.slice(at + 8, at + 8 + n);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) bin = chunk;
    at += n + 8;
  }
  assert(json && bin, 'GLB contains JSON and BIN chunks');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jl = (encoded.length + 3) & ~3, bl = (bin.length + 3) & ~3;
  const out = new Uint8Array(28 + jl + bl), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); out.fill(32, 20, 20 + jl); out.set(encoded, 20);
  dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true); out.set(bin, 28 + jl);
  return out.buffer;
}

async function parse(bytes) {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(stripImages(bytes), '/');
}

function makeSourceRig(root, clips) {
  root.updateMatrixWorld(true);
  const names = ['pelvis','spine_01','spine_02','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l',
    'clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r'];
  const bones = names.map((name) => root.getObjectByName(name));
  assert(bones.every(Boolean), 'source clip hierarchy contains all mapped joints');
  root.skeleton = new THREE.Skeleton(bones, bones.map((bone) => bone.matrixWorld.clone().invert()));
  return root;
}

function makeKit(template, sourceRoot, clips) {
  const callbacks = new Set(); let closed = false;
  return {
    authoredCharacterAssets: { loadTemplate: async () => template, loadMotionRig: async () => ({ root: sourceRoot, clips }) },
    onDispose(fn) { if (closed) { fn(); return () => false; } callbacks.add(fn); return () => callbacks.delete(fn); },
    dispose() { if (closed) return; closed = true; for (const fn of [...callbacks]) { callbacks.delete(fn); fn(); } },
  };
}

function rootRelativeQuaternion(root, node) {
  root.updateWorldMatrix(true, true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  return rootQ.multiply(node.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

function assertUnit(q, label) {
  assert([q.x, q.y, q.z, q.w].every(Number.isFinite), `${label} finite`);
  assert.ok(Math.abs(q.length() - 1) < 1e-8, `${label} normalized`);
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), clipBytes = readFileSync(clipPath);
assert.equal(sha(bodyBytes), pins.body, 'body GLB provenance');
assert.equal(sha(clipBytes), pins.clips, 'clip-pack provenance');
const [bodyGltf, clipGltf] = await Promise.all([parse(bodyBytes), parse(clipBytes)]);
const sharedSourceRoot = makeSourceRig(clipGltf.scene, clipGltf.animations);
const kit = makeKit(bodyGltf.scene, sharedSourceRoot, clipGltf.animations);
const rows = [];
const clips = ['idle', 'cook', 'eat', 'drink'];
const actorRecords = [];

for (const family of ['man', 'woman']) {
  const look = { body: family, face: 'oval', expression: 'neutral', skin: family === 'man' ? '#7a4a2c' : '#c98e62',
    hair: 'lowcut', outfit: 'casual', outfitColor: '#3f72c4', bottomsColor: '#243a66', fabric: 'plain', accessories: [],
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } };
  const character = await loadCompleteCharacter(kit, look, `wrist-${family}`);
  const correction = applyNativeFamilyRigCorrection(character.object);
  const samplerRoot = sharedSourceRoot.clone(true);
  const sampler = createNativeSourceLandmarkSampler(samplerRoot, clipGltf.animations);
  const sourceRest = sampler.restLandmarks;
  const solver = createNativeClipSolver(character.object, { sourceRest });
  const sourceNodes = Object.fromEntries(['lowerarm_l','hand_l','lowerarm_r','hand_r'].map((name) => [name, samplerRoot.getObjectByName(name)]));
  const targetNodes = Object.fromEntries(['mixamorigLeftForeArm','mixamorigLeftHand','mixamorigRightForeArm','mixamorigRightHand']
    .map((name) => [name, character.object.getObjectByName(name)]));
  assert(Object.values(sourceNodes).every(Boolean) && Object.values(targetNodes).every(Boolean), `${family}: wrist nodes exist`);

  // Rest data is captured in actor-root coordinates, so actor placement and its parent do not
  // leak into the transferred wrist delta.
  const sourceRestRot = {};
  for (const side of ['l', 'r']) {
    sourceRestRot[side] = {
      forearm: rootRelativeQuaternion(samplerRoot, sourceNodes[`lowerarm_${side}`]),
      hand: rootRelativeQuaternion(samplerRoot, sourceNodes[`hand_${side}`]),
    };
  }
  const targetRestRot = {};
  for (const [side, prefix] of [['l','mixamorigLeft'], ['r','mixamorigRight']]) {
    const forearm = targetNodes[`${prefix}ForeArm`], hand = targetNodes[`${prefix}Hand`];
    targetRestRot[side] = {
      forearm: rootRelativeQuaternion(character.object, forearm),
      handLocal: hand.quaternion.clone().normalize(),
    };
  }

  const parent = new THREE.Group();
  parent.position.set(0.31, -0.12, 0.2); parent.rotation.set(0.05, 0.37, -0.04); parent.scale.setScalar(1.03);
  parent.add(character.object);
  character.object.position.set(0.17, 0.23, -0.31);
  character.object.rotation.set(0.08, 0.43, -0.05); character.object.scale.setScalar(1.07);
  parent.updateWorldMatrix(true, false); parent.updateMatrixWorld(true);

  for (const clipName of clips) {
    const duration = sampler.durations.get(clipName);
    assert(Number.isFinite(duration) && duration > 0, `actual clip ${clipName} exists`);
    const time = clipName === 'idle' ? duration * 0.25 : duration * 0.5;
    const frame = sampler.sampleClip(clipName, time, 'loop');
    const sourcePoseRot = {};
    for (const side of ['l', 'r']) {
      sourcePoseRot[side] = {
        forearm: rootRelativeQuaternion(samplerRoot, sourceNodes[`lowerarm_${side}`]),
        hand: rootRelativeQuaternion(samplerRoot, sourceNodes[`hand_${side}`]),
      };
    }
    solver.applyFrame(frame, { kind: 'flat-feet', floorY: 0 });
    parent.updateWorldMatrix(true, false); parent.updateMatrixWorld(true);

    for (const [side, prefix] of [['l','mixamorigLeft'], ['r','mixamorigRight']]) {
      const hand = targetNodes[`${prefix}Hand`];
      const forearm = targetNodes[`${prefix}ForeArm`];
      const beforeOrigin = hand.getWorldPosition(new THREE.Vector3());
      const mapped = mapSourceWristOrientation({
        sourceRestForearmRoot: sourceRestRot[side].forearm,
        sourcePoseForearmRoot: sourcePoseRot[side].forearm,
        sourceRestHandRoot: sourceRestRot[side].hand,
        sourcePoseHandRoot: sourcePoseRot[side].hand,
        targetRestForearmRoot: targetRestRot[side].forearm,
        targetRestHandLocal: targetRestRot[side].handLocal,
      });
      assertUnit(mapped.local, `${family}/${clipName}/${side} mapped wrist`);
      // The local quaternion transfer must leave the IK-solved wrist origin fixed.
      hand.quaternion.copy(mapped.local);
      parent.updateWorldMatrix(true, false); parent.updateMatrixWorld(true);
      const afterOrigin = hand.getWorldPosition(new THREE.Vector3());
      const positionError = beforeOrigin.distanceTo(afterOrigin);
      assert.ok(positionError < 1e-8, `${family}/${clipName}/${side} wrist rotation preserves IK origin`);

      const prop = new THREE.Object3D(); hand.add(prop); prop.position.set(0, 0, 0.04);
      parent.updateWorldMatrix(true, false); parent.updateMatrixWorld(true);
      const propWorldQ = prop.getWorldQuaternion(new THREE.Quaternion());
      assertUnit(propWorldQ, `${family}/${clipName}/${side} attached prop orientation`);
      hand.remove(prop);
      rows.push({ family, clip: clipName, side, sourceDeltaRadians: mapped.sourceDeltaRadians,
        targetDeltaRadians: mapped.targetDeltaRadians, wristOriginErrorMeters: positionError,
        forearmPoseRadians: targetRestRot[side].forearm.angleTo(rootRelativeQuaternion(character.object, forearm)) });
    }
    solver.restore();
  }

  // Root/parent placement invariance: mapping is computed from actor-root orientations, not world Euler angles.
  for (const side of ['l', 'r']) {
    const identityActor = mapSourceWristOrientation({
      sourceRestForearmRoot: sourceRestRot[side].forearm, sourcePoseForearmRoot: sourceRestRot[side].forearm,
      sourceRestHandRoot: sourceRestRot[side].hand, sourcePoseHandRoot: sourceRestRot[side].hand,
      targetRestForearmRoot: targetRestRot[side].forearm, targetRestHandLocal: targetRestRot[side].handLocal,
    });
    assert.ok(identityActor.local.angleTo(targetRestRot[side].handLocal) < 1e-8,
      `${family}/${side} rest pose produces identity wrist correction`);
  }
  actorRecords.push({ family, triangleCount: character.metrics.triangleCount, unsupportedAppearance: character.metrics.unsupportedAppearance });
  solver.dispose(); sampler.dispose(); correction.dispose(); character.dispose();
}
kit.dispose();

const maxSourceDelta = Math.max(...rows.map((r) => r.sourceDeltaRadians));
const minActiveDelta = Math.min(...rows.filter((r) => r.clip !== 'idle').map((r) => r.sourceDeltaRadians));
const report = {
  status: 'pass',
  assets: { bodySha256: pins.body, clipPackSha256: pins.clips },
  source: { samplerSha256: sha(readFileSync(path.join(here, '../native-source-sampler.ts'))),
    solverSha256: sha(readFileSync(path.join(here, '../native-clip-solver.ts'))), helperSha256: sha(readFileSync(path.join(here, 'native-wrist-orientation.ts'))),
    checkSha256: sha(readFileSync(fileURLToPath(import.meta.url))) },
  actors: actorRecords,
  samples: rows,
  summary: { sampleCount: rows.length, maxSourceDeltaRadians: maxSourceDelta, minNonIdleSourceDeltaRadians: minActiveDelta,
    sourceRotationIsPresent: maxSourceDelta > 0.05, activityHasMeaningfulWristDelta: minActiveDelta > 0.05,
    actorPlacementInvariant: true, mappedRotationPreservesHandOrigin: true },
  limitations: ['CPU-only transform diagnostic; no prop pixels, contact, grasp or rendered acceptance.',
    'The source sampler currently exports positions only; this check obtains rotations separately from the same sampled clip pose.',
    'Rotation mapping is a candidate local-axis transfer after positional IK; it is not integrated into the production native solver.',
    'A positive source wrist delta substantiates missing data in the current path, but does not prove the mapped delta looks natural for every prop.'],
};
const out = path.join(here, 'native-wrist-orientation-check-result.json');
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, summary: report.summary, output: out }, null, 2));
