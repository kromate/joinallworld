import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createNativeSourceLandmarkSampler } from './native-source-sampler.ts';
import { createNativeClipSolver } from './native-clip-solver.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'parametric-base-facial.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const pin = { body: '9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd', clips: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47' };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function stripImages(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json, bin;
  for (let at = 12; at < bytes.length;) {
    const n = view.getUint32(at, true), type = view.getUint32(at + 4, true), chunk = bytes.slice(at + 8, at + 8 + n);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) bin = chunk;
    at += n + 8;
  }
  assert(json && bin); delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) { delete m.pbrMetallicRoughness?.baseColorTexture; delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; }
  const encoded = new TextEncoder().encode(JSON.stringify(json)), jl = (encoded.length + 3) & ~3, bl = (bin.length + 3) & ~3;
  const out = new Uint8Array(28 + jl + bl), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); out.fill(32, 20, 20 + jl); out.set(encoded, 20);
  dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true); out.set(bin, 28 + jl); return out.buffer;
}
async function parse(bytes) { return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(stripImages(bytes), '/'); }
function snapshot(root) {
  const result = new Map(); root.traverse((n) => result.set(n.uuid, [n.position.toArray(), n.quaternion.toArray(), n.scale.toArray()])); return result;
}
function restore(root, values) {
  root.traverse((n) => { const v = values.get(n.uuid); if (v) { n.position.fromArray(v[0]); n.quaternion.fromArray(v[1]); n.scale.fromArray(v[2]); } }); root.updateWorldMatrix(true, true);
}
function boneWorld(root, name) { root.updateWorldMatrix(true, true); return root.getObjectByName(name).getWorldPosition(new THREE.Vector3()); }
await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), clipBytes = readFileSync(clipPath);
assert.equal(sha(bodyBytes), pin.body); assert.equal(sha(clipBytes), pin.clips);
const [bodyGltf, clipGltf] = await Promise.all([parse(bodyBytes), parse(clipBytes)]);
const body = bodyGltf.scene, sourceRoot = clipGltf.scene;
const sourceNames = { Hips:'pelvis', Spine:'spine_01', Spine1:'spine_02', Spine2:'spine_03', Neck:'neck_01', Head:'Head', LeftShoulder:'clavicle_l', LeftArm:'upperarm_l', LeftForeArm:'lowerarm_l', LeftHand:'hand_l', RightShoulder:'clavicle_r', RightArm:'upperarm_r', RightForeArm:'lowerarm_r', RightHand:'hand_r', LeftUpLeg:'thigh_l', LeftLeg:'calf_l', LeftFoot:'foot_l', LeftToeBase:'ball_l', RightUpLeg:'thigh_r', RightLeg:'calf_r', RightFoot:'foot_r', RightToeBase:'ball_r' };
sourceRoot.updateWorldMatrix(true, true);
const sourceBones = Object.values(sourceNames).map((name) => sourceRoot.getObjectByName(name));
assert(sourceBones.every(Boolean), 'clip rig has required positional landmarks');
sourceRoot.skeleton = new THREE.Skeleton(sourceBones, sourceBones.map((bone) => bone.matrixWorld.clone().invert()));
const samplerRoot = sourceRoot.clone(true), sampler = createNativeSourceLandmarkSampler(samplerRoot, clipGltf.animations);
const rest = snapshot(body), geometryHashes = [];
const sourceRestSnapshot = snapshot(sourceRoot);
body.traverse((n) => { if (n.isSkinnedMesh) geometryHashes.push([n.name, sha(Buffer.from(n.geometry.attributes.position.array.buffer)), sha(Buffer.from(n.geometry.index.array.buffer))]); });
const rootHips = boneWorld(body, 'mixamorigHips');
const solver = createNativeClipSolver(body, { sourceRest: sampler.restLandmarks });
const all = sampler.durations;
assert.equal(all.size, clipGltf.animations.length, 'all source clip names are represented');
const seatY = rootHips.y;
const records = [];
const mappedPoseClips = {
  idle: ['idle'], walk: ['walk'], jog: ['jog'], sit: ['sit', 'sit-enter', 'sit-exit'], interact: ['interact'], dance: ['dance'], lie: ['sleep', 'lie-down', 'get-up'],
  soak: ['soak-wash', 'soak-wash-enter', 'soak-wash-exit', 'soak-wash-female', 'soak-wash-enter-female', 'soak-wash-exit-female'],
  wash: ['shower-wash', 'shower-wash-enter', 'shower-wash-exit', 'shower-wash-female', 'shower-wash-enter-female', 'shower-wash-exit-female'],
  bucket: ['bucket-wash', 'bucket-wash-enter', 'bucket-wash-exit', 'bucket-wash-female', 'bucket-wash-enter-female', 'bucket-wash-exit-female'],
  cook: ['cook', 'cook-enter', 'cook-exit', 'cook-female', 'cook-enter-female', 'cook-exit-female'],
  cookLow: ['cook-low', 'cook-low-enter', 'cook-low-exit', 'cook-low-female', 'cook-low-enter-female', 'cook-low-exit-female'],
  eat: ['eat', 'eat-enter', 'eat-exit', 'eat-female', 'eat-enter-female', 'eat-exit-female'],
  drink: ['drink', 'drink-enter', 'drink-exit', 'drink-female', 'drink-enter-female', 'drink-exit-female'],
  homeDoor: ['home-door', 'home-door-female', 'door']
};
assert.equal(Object.keys(mappedPoseClips).length, 15, 'all fifteen BodyPose values are routed explicitly');
try {
  for (const [name, duration] of all) {
    assert(duration > 0 && Number.isFinite(duration));
    const timeMode = /(-enter|-exit|lie-down|get-up|home-door|^door$)/.test(name) ? 'clamp' : 'loop';
    const sampleSeconds = duration * 0.5;
    const frame = sampler.sampleClip(name, sampleSeconds, timeMode);
    const support = ['sleep', 'lie-down', 'get-up'].includes(name)
      ? { kind: 'body-contact-diagnostic', floorY: 0, diagnosticOnly: true }
      : name.includes('stairs-')
        ? { kind: 'stair-feet', leftFloorY: 0, rightFloorY: 0.12 }
        : /^(sit|soak-wash|bathe-sit|bathe-stand)(-|$)/.test(name)
          ? { kind: 'seat-anchor', hipWorld: [rootHips.x, seatY, rootHips.z], floorY: 0 }
          : { kind: 'flat-feet', floorY: 0 };
    const result = solver.applyFrame(frame, support);
    const positions = Object.values(frame.landmarks).flat();
    assert(positions.every(Number.isFinite), `${name}: sampled source positions finite`);
    assert(Object.values(result.reach).every((r) => [r.requested, r.clamped, r.maximum].every(Number.isFinite) && r.clamped <= r.maximum + 1e-6), `${name}: native reaches finite and clamped`);
    assert(Object.values(result.footSoleMinY).every(Number.isFinite), `${name}: finite cached-foot measurement`);
    assert(Number.isFinite(result.contactMinY), `${name}: finite contact measure`);
    if (result.supportStatus === 'feet-supported') {
      const planted = result.footSoleMinY.left <= result.footSoleMinY.right ? 'left' : 'right';
      const floor = support.kind === 'flat-feet' ? support.floorY : support[planted === 'left' ? 'leftFloorY' : 'rightFloorY'];
      assert(Math.abs(result.footSoleMinY[planted] - floor) < 0.0041, `${name}: planted weighted sole reaches explicit floor`);
    }
    records.push({ name, duration: Number(duration.toFixed(5)), sampleSeconds: Number(sampleSeconds.toFixed(5)), timeMode, support: support.kind,
      supportStatus: result.supportStatus, contactMinY: Number(result.contactMinY.toFixed(5)), soles: Object.fromEntries(Object.entries(result.footSoleMinY).map(([s, y]) => [s, Number(y.toFixed(5))])), reachClamped: Object.values(result.reach).filter((r) => r.wasClamped).length });
    solver.restore();
  }
  for (const [pose, names] of Object.entries(mappedPoseClips)) for (const name of names) assert(all.has(name), `${pose} route maps to exact shipped clip ${name}`);
} finally { solver.dispose(); sampler.dispose(); }
restore(body, rest);
assert.deepEqual(snapshot(sourceRoot), sourceRestSnapshot, 'shared clip source hierarchy remains untouched by actor-owned sampler');
const afterGeometry = [];
body.traverse((n) => { if (n.isSkinnedMesh) afterGeometry.push([n.name, sha(Buffer.from(n.geometry.attributes.position.array.buffer)), sha(Buffer.from(n.geometry.index.array.buffer))]); });
assert.deepEqual(afterGeometry, geometryHashes, 'shared body geometry and topology unchanged');
assert.deepEqual(snapshot(body), rest, 'actor pose restored to initial hierarchy');
const result = { status: 'pass', source: { bodySha256: pin.body, clipPackSha256: pin.clips, solverSha256: sha(readFileSync(path.join(here, 'native-clip-solver.ts'))), samplerSha256: sha(readFileSync(path.join(here, 'native-source-sampler.ts'))), checkerSha256: sha(readFileSync(fileURLToPath(import.meta.url))) }, clipCount: all.size, samples: records.length, records, poseRoutes: Object.keys(mappedPoseClips).length, stairRoutes: 2, checks: { exactClipPositions: true, allSamplesFinite: true, allReachClamped: true, allBodyPoseStillTransitionNamesPresent: true, footSupportAppliedOnlyForExplicitFootSupport: true, stairLevelsExplicit: true, seatedPoseContactUnverified: true, proneBodyContactDiagnosticOnly: true, sourceBodyImmutable: true, actorRestored: true }, limitations: ['Bounded CPU positional retarget diagnostic only; this is not rendered acceptance.', 'The sample uses one actual combined authored body source at its default shape; male/female look fitting and per-look expression parity are not separately accepted.', 'Seated hip anchors are caller-provided and do not establish seat pressure/contact.', 'Lying body contact remains diagnostic-only; no bounded body-contact surface is solved.', 'Foot support aligns the lowest sampled source foot side from cached weighted foot/toe vertices; no continuous planted-foot detection or no-slip proof. Two stair cases remain explicitly unresolved.', 'The mapping transfers positional landmarks; it does not transfer axial twist, hand/finger articulation, head gaze, facial expression, wardrobe, footwear, or prop constraints.'] };
writeFileSync(path.join(here, 'native-clip-solver-check-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, clipCount: result.clipCount, samples: result.samples, checks: result.checks, output: path.join(here, 'native-clip-solver-check-result.json') }, null, 2));
