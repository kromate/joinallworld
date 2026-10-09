import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const temporaryModule = path.join(here, 'skin-material-runtime-check.ts');
const sourcePath = path.join(here, 'skin-material.ts');
let source = readFileSync(sourcePath, 'utf8');
for (const [before, after] of [
  ["import maleUrl from './skin-assets/mobile/1024/middleage_african_male_q90.jpg?url';", "const maleUrl = 'https://test.invalid/man.jpg';"],
  ["import femaleUrl from './skin-assets/mobile/1024/middleage_african_female_q90.jpg?url';", "const femaleUrl = 'https://test.invalid/woman.jpg';"],
]) {
  assert.equal(source.split(before).length - 1, 1, `exact skin URL import exists: ${before}`);
  source = source.replace(before, after);
}
writeFileSync(temporaryModule, source);

const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
const loaded = [];
let loaderImpl = async (url) => {
  const texture = new THREE.DataTexture(new Uint8Array([128, 96, 64, 255]), 1, 1, THREE.RGBAFormat);
  loaded.push({ url, texture, disposals: 0 });
  texture.addEventListener('dispose', () => loaded.find((entry) => entry.texture === texture).disposals++);
  return texture;
};
THREE.TextureLoader.prototype.loadAsync = function (url) { return loaderImpl(String(url)); };

class TestOwner {
  closed = false;
  callbacks = new Set();
  registrations = 0;
  unregisters = 0;
  onDispose(callback) {
    this.registrations++;
    if (this.closed) { callback(); return () => false; }
    this.callbacks.add(callback);
    return () => { this.unregisters++; return this.callbacks.delete(callback); };
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const callback of [...this.callbacks]) callback();
    this.callbacks.clear();
  }
}

function actorRoot() {
  const root = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: '#b88868' }));
  mesh.name = 'Body'; root.add(mesh);
  return { root, mesh, original: mesh.material };
}

let moduleApi;
const handles = [];
try {
  moduleApi = await import(`${pathToFileURL(temporaryModule).href}?check=${Date.now()}`);
  const { applySkinMaterial } = moduleApi;

  // Concurrent actors in one Kit share one immutable map per body family.
  const owner = new TestOwner();
  const a = actorRoot(), b = actorRoot(), c = actorRoot();
  const [skinA, skinB, skinC] = await Promise.all([
    applySkinMaterial(a.root, 'man', '#815b41', owner),
    applySkinMaterial(b.root, 'man', '#c4825c', owner),
    applySkinMaterial(c.root, 'woman', '#a56b4d', owner),
  ]);
  handles.push(skinA, skinB, skinC);
  assert.equal(loaded.length, 2, 'one texture request per family within a Kit');
  const manTexture = loaded.find((entry) => entry.url.endsWith('/man.jpg'))?.texture;
  const womanTexture = loaded.find((entry) => entry.url.endsWith('/woman.jpg'))?.texture;
  assert(manTexture && womanTexture, 'each family loaded its correct texture');
  assert.equal(a.mesh.material.map, manTexture);
  assert.equal(b.mesh.material.map, manTexture);
  assert.equal(c.mesh.material.map, womanTexture);
  assert.notEqual(a.mesh.material, b.mesh.material, 'each actor owns a private material');
  assert.notEqual(a.mesh.material.color, b.mesh.material.color, 'each actor owns a private color');
  assert.notDeepEqual(a.mesh.material.color.toArray(), b.mesh.material.color.toArray(), 'saved skin colors differ per actor');
  assert.equal(manTexture.flipY, false);
  assert.equal(manTexture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(manTexture.anisotropy, 1);
  assert.equal(a.mesh.material.roughness, 0.78);
  assert.equal(a.mesh.material.metalness, 0);
  let privateMaterialDisposals = 0, originalMaterialDisposals = 0;
  a.mesh.material.addEventListener('dispose', () => privateMaterialDisposals++);
  a.original.addEventListener('dispose', () => originalMaterialDisposals++);
  const beforeRecolor = a.mesh.material.color.toArray();
  skinA.setColor('#98765b');
  assert.notDeepEqual(a.mesh.material.color.toArray(), beforeRecolor, 'setColor updates this actor');
  assert.deepEqual(b.mesh.material.color.toArray(), new THREE.Color('#c4825c').multiplyScalar(1).toArray().map((value, index) => value / [0.14787665282263032, 0.04880991231432766, 0.021870639694593016][index]),
    'recoloring actor A does not change actor B');

  skinA.dispose(); skinA.dispose();
  assert.equal(a.mesh.material, a.original, 'manual disposal restores original Body material');
  assert.equal(privateMaterialDisposals, 1, 'private material disposal is exactly once');
  assert.equal(originalMaterialDisposals, 0, 'original actor material remains owned by the rig');
  assert.equal(loaded.find((entry) => entry.texture === manTexture).disposals, 0, 'actor disposal does not release Kit-owned map');
  owner.dispose(); owner.dispose();
  assert.equal(b.mesh.material, b.original);
  assert.equal(c.mesh.material, c.original);
  assert.equal(loaded.find((entry) => entry.texture === manTexture).disposals, 1, 'Kit disposes shared family map once');
  assert.equal(loaded.find((entry) => entry.texture === womanTexture).disposals, 1, 'Kit disposes other family map once');
  assert.equal(owner.registrations, 4, 'one cache and three actor cleanup registrations');
  assert.equal(owner.unregisters, 4, 'every Kit callback unregisters exactly once');
  assert.equal(owner.callbacks.size, 0, 'no Kit callbacks remain after disposal');
  await assert.rejects(applySkinMaterial(actorRoot().root, 'man', '#815b41', owner), /already disposed/);
  assert.equal(loaded.length, 2, 'closed Kit performs no new texture requests');

  // A failed request is evicted so a later actor can retry successfully.
  const retryOwner = new TestOwner(), retryActor = actorRoot();
  const failure = new Error('test fetch failure');
  let retryAttempts = 0;
  loaderImpl = async (url) => {
    if (retryAttempts++ === 0) throw failure;
    const texture = new THREE.DataTexture(new Uint8Array([140, 110, 85, 255]), 1, 1, THREE.RGBAFormat);
    loaded.push({ url, texture, disposals: 0 });
    texture.addEventListener('dispose', () => loaded.find((entry) => entry.texture === texture).disposals++);
    return texture;
  };
  await assert.rejects(applySkinMaterial(retryActor.root, 'man', '#815b41', retryOwner), /test fetch failure/);
  assert.equal(retryOwner.registrations, 1, 'cache callback is registered once before a load attempt');
  const retrySkin = await applySkinMaterial(retryActor.root, 'man', '#815b41', retryOwner);
  handles.push(retrySkin);
  assert.equal(loaded.filter((entry) => entry.url.endsWith('/man.jpg')).length, 2, 'failed request is retried, not retained');
  retryOwner.dispose();

  // Pending response after Kit disposal is rejected and immediately released.
  const lateOwner = new TestOwner(), lateActor = actorRoot();
  let resolveLate;
  loaderImpl = (url) => new Promise((resolve) => { resolveLate = () => {
    const texture = new THREE.DataTexture(new Uint8Array([120, 90, 70, 255]), 1, 1, THREE.RGBAFormat);
    const record = { url, texture, disposals: 0 };
    loaded.push(record); texture.addEventListener('dispose', () => record.disposals++); resolve(texture);
  }; });
  const pending = applySkinMaterial(lateActor.root, 'woman', '#a56b4d', lateOwner);
  await Promise.resolve();
  lateOwner.dispose();
  assert.equal(typeof resolveLate, 'function', 'late texture request started');
  resolveLate();
  await assert.rejects(pending, /completed after its Kit was disposed/);
  const lateRecord = loaded.at(-1);
  assert.equal(lateActor.mesh.material, lateActor.original, 'late completion never attaches material');
  assert.equal(lateRecord.disposals, 1, 'late texture is disposed when it resolves');

  // The legacy three-argument path owns a separate texture for every actor.
  const legacyA = actorRoot(), legacyB = actorRoot();
  loaderImpl = async (url) => {
    const texture = new THREE.DataTexture(new Uint8Array([120, 90, 70, 255]), 1, 1, THREE.RGBAFormat);
    const record = { url, texture, disposals: 0 }; loaded.push(record);
    texture.addEventListener('dispose', () => record.disposals++); return texture;
  };
  const ownedA = await applySkinMaterial(legacyA.root, 'woman', '#a56b4d');
  const ownedB = await applySkinMaterial(legacyB.root, 'woman', '#a56b4d');
  handles.push(ownedA, ownedB);
  assert.notEqual(legacyA.mesh.material.map, legacyB.mesh.material.map, 'legacy calls each own a fresh map');
  const legacyTextures = [legacyA.mesh.material.map, legacyB.mesh.material.map];
  ownedA.dispose(); ownedB.dispose();
  for (const texture of legacyTextures) assert.equal(loaded.find((entry) => entry.texture === texture).disposals, 1);

  console.log(JSON.stringify({ status: 'pass', checks: {
    perKitFamilyDeduplication: true, perActorMaterialAndColorIsolation: true, sharedMapSurvivesActorDispose: true,
    kitTextureDisposeOnce: true, manualCleanupUnregistersOnce: true, failedLoadEvictedAndRetried: true,
    disposedKitRejectsNewLoads: true, lateLoadRejectedAndReleased: true, legacyThreeArgumentPathOwnsMaps: true,
    savedColorUpdateAndOriginalMaterialRestore: true, originalMaterialRemainsRigOwned: true,
  }, requests: loaded.map((entry) => entry.url), metrics: 'Fixture maps only; no GPU or FPS estimate.' }, null, 2));
} finally {
  for (const handle of handles) handle.dispose();
  THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
  await unlink(temporaryModule).catch(() => {});
}
