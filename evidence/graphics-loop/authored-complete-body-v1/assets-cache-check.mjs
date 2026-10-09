import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(directory, 'assets.ts');
const temporaryPath = path.join(directory, 'assets-runtime-check.ts');
let source = readFileSync(sourcePath, 'utf8');
const replacements = [
  ["import authoredUrl from './parametric-base-facial.glb?url';", "const authoredUrl = 'https://test.invalid/body.glb';"],
  ["import { BODY_FILES } from '../../../src/scene/body/files.ts';", "const BODY_FILES = { clips: 'https://test.invalid/motion.glb' } as const;"],
];
for (const [before, after] of replacements) {
  assert.equal(source.split(before).length - 1, 1, `exact loader URL import exists: ${before}`);
  source = source.replace(before, after);
}
writeFileSync(temporaryPath, source);

const sourceJointNames = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
const originalLoadAsync = GLTFLoader.prototype.loadAsync;
const requestCounts = new Map();
const failuresRemaining = new Map();
const pending = new Map();
let mode = 'immediate';
let disposed = { geometries: 0, materials: 0, boneTextures: 0 };

function trackDispose(object, field) {
  object.addEventListener('dispose', () => { disposed[field]++; });
  return object;
}

function sourceScene(kind) {
  const scene = new THREE.Group();
  if (kind === 'body') {
    const bone = new THREE.Bone(); bone.name = 'body-source'; scene.add(bone);
    const skeleton = new THREE.Skeleton([bone]);
    skeleton.computeBoneTexture();
    trackDispose(skeleton.boneTexture, 'boneTextures');
    const geometry = trackDispose(new THREE.BufferGeometry(), 'geometries');
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const material = trackDispose(new THREE.MeshStandardMaterial(), 'materials');
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = 'Body'; mesh.bind(skeleton);
    scene.add(mesh);
  } else {
    let parent = scene;
    for (const name of sourceJointNames) {
      const bone = new THREE.Bone(); bone.name = name; parent.add(bone); parent = bone;
    }
    const bones = sourceJointNames.map((name) => scene.getObjectByName(name));
    const skeleton = new THREE.Skeleton(bones);
    skeleton.computeBoneTexture();
    trackDispose(skeleton.boneTexture, 'boneTextures');
    const geometry = trackDispose(new THREE.BufferGeometry(), 'geometries');
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const material = trackDispose(new THREE.MeshStandardMaterial(), 'materials');
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = 'MotionRig'; mesh.bind(skeleton);
    scene.add(mesh);
  }
  return scene;
}

GLTFLoader.prototype.loadAsync = function (url) {
  const key = String(url), attempt = (requestCounts.get(key) ?? 0) + 1;
  requestCounts.set(key, attempt);
  const remaining = failuresRemaining.get(key) ?? 0;
  if (remaining > 0) {
    failuresRemaining.set(key, remaining - 1);
    return Promise.reject(new Error(`controlled failure ${key} #${attempt}`));
  }
  if (mode === 'pending') return new Promise((resolve) => pending.set(key, () => resolve({ scene: sourceScene(key.endsWith('body.glb') ? 'body' : 'motion'), animations: [] })));
  return Promise.resolve({ scene: sourceScene(key.endsWith('body.glb') ? 'body' : 'motion'), animations: [] });
};

class TestKit {
  disposed = false;
  callbacks = new Set();
  registrations = 0;
  unregisters = 0;
  onDispose(callback) {
    this.registrations++;
    if (this.disposed) { callback(); return () => false; }
    this.callbacks.add(callback);
    return () => { this.unregisters++; return this.callbacks.delete(callback); };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const callback of [...this.callbacks]) { this.callbacks.delete(callback); callback(); }
  }
}

const apiHandles = [];
try {
  const { completeCharacterKit } = await import(`${pathToFileURL(temporaryPath).href}?check=${Date.now()}`);

  // Same Kit returns one wrapper and shares both inflight and resolved template/motion loads.
  const kitA = new TestKit();
  const ownerA = completeCharacterKit(kitA);
  assert.equal(completeCharacterKit(kitA), ownerA, 'same Kit returns the same cache wrapper');
  const [bodyA1, bodyA2, motionA1, motionA2] = await Promise.all([
    ownerA.authoredCharacterAssets.loadTemplate(), ownerA.authoredCharacterAssets.loadTemplate(),
    ownerA.authoredCharacterAssets.loadMotionRig(), ownerA.authoredCharacterAssets.loadMotionRig(),
  ]);
  assert.equal(bodyA1, bodyA2, 'concurrent template requests share one parsed scene');
  assert.equal(motionA1, motionA2, 'concurrent motion requests share one rig result');
  assert.equal(requestCounts.get('https://test.invalid/body.glb'), 1, 'template fetched once per Kit');
  assert.equal(requestCounts.get('https://test.invalid/motion.glb'), 1, 'motion fetched once per Kit');

  // A different Kit gets an isolated wrapper and its own resource loads.
  const kitB = new TestKit(), ownerB = completeCharacterKit(kitB);
  assert.notEqual(ownerB, ownerA, 'distinct Kits do not share a wrapper');
  assert.notEqual(completeCharacterKit(kitB), ownerA);
  await Promise.all([ownerB.authoredCharacterAssets.loadTemplate(), ownerB.authoredCharacterAssets.loadMotionRig()]);
  assert.equal(requestCounts.get('https://test.invalid/body.glb'), 2);
  assert.equal(requestCounts.get('https://test.invalid/motion.glb'), 2);
  kitA.dispose(); kitA.dispose(); kitB.dispose();
  assert.equal(kitA.callbacks.size, 0); assert.equal(kitB.callbacks.size, 0);
  assert.equal(kitA.registrations, 1); assert.equal(kitB.registrations, 1);

  // Both independent request paths evict rejected promises and can retry.
  const retryKit = new TestKit(), retryOwner = completeCharacterKit(retryKit);
  failuresRemaining.set('https://test.invalid/body.glb', 1);
  await assert.rejects(retryOwner.authoredCharacterAssets.loadTemplate(), /controlled failure/);
  await retryOwner.authoredCharacterAssets.loadTemplate();
  assert.equal(requestCounts.get('https://test.invalid/body.glb'), 4, 'failed body promise is retried');
  failuresRemaining.set('https://test.invalid/motion.glb', 1);
  await assert.rejects(retryOwner.authoredCharacterAssets.loadMotionRig(), /controlled failure/);
  const retriedMotion = await retryOwner.authoredCharacterAssets.loadMotionRig();
  assert.equal(requestCounts.get('https://test.invalid/motion.glb'), 4, 'failed motion promise is retried');
  retriedMotion.root.skeleton.computeBoneTexture();
  trackDispose(retriedMotion.root.skeleton.boneTexture, 'boneTextures');
  retryKit.dispose();

  // Closing the Kit while either load is pending rejects it and releases late resources.
  for (const key of ['https://test.invalid/body.glb', 'https://test.invalid/motion.glb']) {
    const lateKit = new TestKit(), lateOwner = completeCharacterKit(lateKit);
    mode = 'pending';
    const load = key.endsWith('body.glb') ? lateOwner.authoredCharacterAssets.loadTemplate() : lateOwner.authoredCharacterAssets.loadMotionRig();
    await Promise.resolve();
    const resolve = pending.get(key);
    assert.equal(typeof resolve, 'function', `pending ${key} request started`);
    lateKit.dispose();
    resolve();
    await assert.rejects(load, /disposed while loading/);
    assert.equal(lateKit.callbacks.size, 0, 'closed Kit has no retained cleanup callbacks');
  }
  mode = 'immediate';

  // A Kit that is already closed rejects without issuing a request.
  const closedKit = new TestKit(); closedKit.dispose();
  const closedOwner = completeCharacterKit(closedKit);
  await assert.rejects(closedOwner.authoredCharacterAssets.loadTemplate(), /disposed/);
  await assert.rejects(closedOwner.authoredCharacterAssets.loadMotionRig(), /disposed/);

  assert(disposed.geometries >= 8, 'body, motion, and late-load geometries were released');
  assert(disposed.materials >= 8, 'body, motion, and late-load materials were released');
  assert(disposed.boneTextures >= 8, 'body, motion, and synthesized skeleton textures were released');
  assert.equal(closedKit.registrations, 1, 'already-closed Kit receives one inert cache callback');

  console.log(JSON.stringify({ status: 'pass', checks: {
    sameKitWrapperDeduplication: true, concurrentTemplateAndMotionSharePromises: true,
    distinctKitIsolation: true, bodyAndMotionFailureRetry: true, lateClosedTemplateCleanup: true,
    lateClosedMotionCleanup: true, sourceAndSynthesizedSkeletonCleanup: true,
    alreadyClosedKitRejectsWithoutFetch: true, disposalCallbacksReleased: true,
  }, requests: Object.fromEntries(requestCounts), disposals: disposed,
  metrics: 'Controlled loader resources only; no network, image, GPU, or visual claim.' }, null, 2));
} finally {
  for (const handle of apiHandles) handle.dispose?.();
  mode = 'immediate';
  GLTFLoader.prototype.loadAsync = originalLoadAsync;
  await unlink(temporaryPath).catch(() => {});
}
