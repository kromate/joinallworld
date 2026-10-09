import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { createKit } from '../../../../src/scene/kit.ts';
import { createHomeChairFixture, createHomeRestPropFixture, HOME_SOURCE_TILE } from './home-rest-props.ts';

// Run after bundle-prepared-factory.mjs. This executes the actual prepared GLB/clip path and
// queries mirrored 3af home SHAPES meshes. The 15 pose calls are all probed; unsupported calls
// are recorded as failures rather than hidden by the exported coverage list.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const factoryUrl = pathToFileURL(path.join(here, './native-full-runtime-v13/native-prepared-factory.bundle.mjs')).href;
const base3af = '3af17a01b8bd406bfb830ca0d2ee66d2d0093d28';
const sourcePins = [
  ['src/scene/body/poses.ts', '7f328e67ec33d1c94516d76746635e45d8f90a01416176534fa0448d4e797d5e'],
  ['src/scene/body/foot-contact.ts', '6f98bb61fde23e51016148d06136fcb0b46b0b9d5c03cefc73c7ad47745df8c6'],
  ['src/scene/body/skinned.ts', '971a080a5d52bbe351f6b59e5377116d605a8a5c73d8c5e63e146db73a445aab'],
  ['src/scene/home-scene.ts', '31a744babf552bc4bcfdac00e23b59f23ed363ed7f2f94dbd06da5e8b4bcb47d'],
  ['src/game/content/furniture.ts', 'ca0fd127c340e7d10bc493020b83c87dcf09ee23ecdbfe2a6756109753bd04d5'],
];
const assets = [
  ['evidence/graphics-loop/authored-complete-body-v1/authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb', 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552'],
  ['src/scene/body/assets/clip-pack.glb', '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/out/male_casualsuit01.glb', '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/out/office-female.glb', 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-footwear/out/shoes01-mobile.glb', '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557'],
];
const original = {
  fetch: globalThis.fetch, bitmap: globalThis.createImageBitmap, progress: globalThis.ProgressEvent,
  self: globalThis.self, textureLoad: THREE.TextureLoader.prototype.load,
};
const sourceStats = { fetches: 0, bytes: 0, imageDecodes: 0 };
const actors = [], kits = [], fixtures = [];
const poses = ['idle', 'walk', 'jog', 'sit', 'interact', 'dance', 'lie', 'soak', 'wash', 'bucket', 'cook', 'cookLow', 'eat', 'drink', 'homeDoor'];
const familyResults = [];
const failures = [];
const familyLook = (body, outfit) => ({ body, hair: body === 'woman' ? 'afro' : 'lowcut', outfit, fabric: 'plain', skin: 'skin4',
  hairColor: 'darkbrown', outfitColor: 'navy', bottomsColor: 'cream', accessories: [], face: 'oval', expression: 'neutral',
  appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } });

function installFileFetch() {
  if (!globalThis.self) globalThis.self = globalThis;
  if (!globalThis.ProgressEvent) globalThis.ProgressEvent = class extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } };
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!raw.startsWith('file:')) return original.fetch(input, init);
    const bytes = await readFile(fileURLToPath(raw)); sourceStats.fetches++; sourceStats.bytes += bytes.byteLength;
    return new Response(bytes, { status: 200, headers: { 'content-type': raw.endsWith('.json') ? 'application/json' : 'model/gltf-binary' } });
  };
  globalThis.createImageBitmap = async () => { sourceStats.imageDecodes++; return { width: 1, height: 1, close() {} }; };
  THREE.TextureLoader.prototype.load = function (_url, onLoad, _progress, onError) {
    const texture = new THREE.Texture({ width: 1, height: 1, data: new Uint8Array(4) }); texture.needsUpdate = true;
    queueMicrotask(() => { try { onLoad?.(texture); } catch (error) { onError?.(error); } }); return texture;
  };
}

function querySurface(meshes) {
  return (worldX, worldZ) => {
    for (const mesh of meshes) { mesh.updateWorldMatrix(true, false); mesh.updateMatrixWorld(true); }
    const ray = new THREE.Raycaster(new THREE.Vector3(worldX, 12, worldZ), new THREE.Vector3(0, -1, 0), 0, 24);
    return ray.intersectObjects(meshes, false)[0]?.point.y ?? null;
  };
}

function makeActualChair(parent, floor) {
  const fixture = createHomeChairFixture(); parent.add(fixture.group);
  const rayHeight = querySurface([fixture.seat]);
  return { fixture, support(seatRequest, actor) {
    parent.updateWorldMatrix(true, false);
    const point = new THREE.Vector3(seatRequest.x, seatRequest.top, seatRequest.z).applyMatrix4(parent.matrixWorld);
    const topWorldY = rayHeight(point.x, point.z);
    const floorWorldY = querySurface([floor])(point.x, point.z);
    if (topWorldY === null || floorWorldY === null) return { kind: 'diagnostic', floorY: floorWorldY ?? NaN };
    actor.updateWorldMatrix(true, false); actor.updateMatrixWorld(true);
    const hip = actor.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3());
    return { kind: 'seat-anchor', hipWorld: [point.x, hip.y, point.z], seatTopY: topWorldY, floorY: floorWorldY };
  } };
}

function placementFor(prop) {
  const tile = HOME_SOURCE_TILE;
  switch (prop) {
    case 'bed': return { x: 0, top: 0.015 + 0.56 * tile, z: (0.64 - 2 * 0.38) * tile, ry: 0 };
    case 'mat': return { x: 0, top: 0.015 + 0.08 * tile, z: (0.64 - 2 * 0.36) * tile, ry: 0 };
    case 'tub': return { x: 2 * 0.2 * tile, top: 0.015 + 0.1 * tile, z: 0, ry: -Math.PI / 2 };
    case 'shower': return { x: -0.05 * tile, y: 0.03 + 0.08 * tile, z: -0.05 * tile, ry: 0 };
  }
}

function tick(body, maxSeconds = 12) {
  let seconds = 0;
  while (body.easing && seconds < maxSeconds) { body.step(0.04); seconds += 0.04; }
  assert.equal(body.easing, false, `source transition ends within ${maxSeconds}s`);
}

let report;
try {
  installFileFetch();
  for (const [relative, expected] of sourcePins) {
    const bytes = execFileSync('git', ['show', `${base3af}:${relative}`], { cwd: repo });
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `3af source pin ${relative}`);
  }
  for (const [relative, expected] of assets) {
    const bytes = await readFile(path.join(repo, relative));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `asset pin ${relative}`);
  }
  const { prepareNativeSkinnedBody, NATIVE_PREPARED_POSE_COVERAGE, NATIVE_PREPARED_CONDITIONAL_CONTACT_COVERAGE } = await import(factoryUrl);
  for (const family of ['man', 'woman']) {
    const kit = createKit(); kits.push(kit);
    const host = new THREE.Group();
    host.position.set(1.1, 0.35, -0.8); host.rotation.y = 0.41; host.scale.setScalar(0.9);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), new THREE.MeshStandardMaterial({ color: '#dedbd3' }));
    floor.name = '3af-source-room-floor'; floor.position.y = -0.05; host.add(floor);
    const propFixtures = new Map();
    for (const [prop, pose] of [['bed', 'lie'], ['mat', 'lie'], ['tub', 'soak'], ['shower', 'wash']]) {
      const fixture = createHomeRestPropFixture(prop, pose);
      fixture.group.visible = false; host.add(fixture.group); fixtures.push(fixture); propFixtures.set(prop, fixture);
    }
    const chair = makeActualChair(host, floor);
    let activeProp = null;
    const actor = await prepareNativeSkinnedBody({
      kit, seed: `rest-15-${family}`, look: familyLook(family, family === 'woman' ? 'office' : 'casual'), sceneScale: HOME_SOURCE_TILE * 0.72,
      seatSupport: (seat, object) => chair.support(seat, object),
      restSupport: (pose) => {
        const fixture = activeProp;
        if (!fixture || fixture.supportSurface.pose !== pose) return null;
        return { kind: 'prop-rest', surface: fixture.supportSurface };
      },
    });
    actors.push(actor); host.add(actor.object); actor.place(0, 0, 0, 0);

    const poseResults = [];
    for (const pose of poses) {
      const beforePose = actor.pose;
      if (pose === 'sit') actor.sitOn(0, 0.015 + 0.41 * HOME_SOURCE_TILE, -0.08 * HOME_SOURCE_TILE, 0);
      else if (pose === 'lie' || pose === 'soak' || pose === 'wash') {
        const prop = pose === 'lie' ? 'bed' : pose === 'soak' ? 'tub' : 'shower';
        activeProp = propFixtures.get(prop); activeProp.group.visible = true;
        const at = placementFor(prop);
        if (pose === 'wash') actor.workOn(at.x, at.y, at.z, at.ry);
        else actor.sitOn(at.x, at.top, at.z, at.ry);
      } else if (['bucket', 'cook', 'cookLow', 'eat', 'drink', 'homeDoor'].includes(pose)) actor.workOn(0, 0, 0, 0);
      else actor.place(0, 0, 0, 0);
      try {
        actor.show(pose, false);
        actor.sampleFootContacts();
        poseResults.push({ pose, accepted: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        poseResults.push({ pose, accepted: false, error: message }); failures.push(`${family}/${pose}: ${message}`);
        assert.equal(actor.pose, beforePose, `${family}/${pose}: a rejected pose request rolls back public state`);
      }
      for (const fixture of propFixtures.values()) fixture.group.visible = false;
      activeProp = null;
    }

    // Test all four source-mirrored contact surfaces, including entry, sampled still/loop, exit,
    // and real-prop absence rollback. A failed surface remains a surfaced failure, not a fallback.
    const restResults = [];
    for (const prop of ['bed', 'mat', 'tub', 'shower']) {
      const pose = prop === 'bed' || prop === 'mat' ? 'lie' : prop === 'tub' ? 'soak' : 'wash';
      const fixture = propFixtures.get(prop); activeProp = fixture; fixture.group.visible = true;
      const at = placementFor(prop);
      if (pose === 'wash') actor.workOn(at.x, at.y, at.z, at.ry);
      else actor.sitOn(at.x, at.top, at.z, at.ry);
      try {
        actor.show(pose, true); tick(actor);
        const loopWitnesses = [];
        for (const seconds of [0.12, 0.38, 0.76]) {
          actor.sampleUse(pose, seconds);
          const head = actor.object.getObjectByName('mixamorigHead').getWorldPosition(new THREE.Vector3());
          const hips = actor.object.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3());
          assert.ok([head.x, head.y, head.z, hips.x, hips.y, hips.z].every(Number.isFinite), `${family}/${prop}/${pose}: loop sample has finite head/hip positions`);
          loopWitnesses.push({ seconds, head: head.toArray(), hips: hips.toArray(), feet: actor.sampleFootContacts().length });
        }
        const stillContacts = actor.sampleFootContacts();
        actor.show('idle', true); tick(actor);
        const exitPose = actor.pose;
        restResults.push({ prop, pose, accepted: true, exitPose, contactSamples: stillContacts.length,
          loopWitnesses, sourceSurface: fixture.supportSurface.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        restResults.push({ prop, pose, accepted: false, error: message }); failures.push(`${family}/${prop}-rest: ${message}`);
        try { actor.show('idle', false); } catch {}
      } finally { fixture.group.visible = false; activeProp = null; }
    }
    const noSupportBefore = actor.pose;
    try { actor.show('lie', false); failures.push(`${family}/missing-bed-support: lie unexpectedly succeeded`); }
    catch (error) { assert.match(String(error), /matching.*prop-rest|bed.*surface/i); }
    assert.equal(actor.pose, noSupportBefore, `${family}: missing-prop lie refusal preserves current pose`);
    familyResults.push({ family, sourceHeightMetres: actor.preparedMetrics.standingHeightMetres,
      sourceClips: actor.preparedMetrics.sourceClipCount, poseResults, restResults,
      exportedUnconditionalCoverage: [...NATIVE_PREPARED_POSE_COVERAGE],
      exportedConditionalCoverage: NATIVE_PREPARED_CONDITIONAL_CONTACT_COVERAGE });
    actor.dispose(); actors.pop();
    for (const fixture of propFixtures.values()) { host.remove(fixture.group); fixture.dispose(); fixtures.splice(fixtures.indexOf(fixture), 1); }
    host.remove(chair.fixture.group); chair.fixture.dispose();
    host.remove(floor); floor.geometry.dispose(); floor.material.dispose();
    kit.dispose(); kits.pop();
  }
  if (failures.length) throw new Error(`15-pose/rest contact failures: ${failures.join(' | ')}`);
  report = { status: 'pass', base3af, sourcePins: sourcePins.length, assetPins: assets.length,
    testedPoseUnion: poses, families: familyResults, source: sourceStats,
    note: 'A pass would establish prepared-GLB pose/contact contracts against mirrored home prop geometry only; it is not a full home integration or whole-mesh collision proof.' };
} catch (error) {
  report = { status: 'fail', error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    families: familyResults, failures, source: sourceStats };
} finally {
  for (const actor of actors.reverse()) try { actor.dispose(); } catch {}
  for (const fixture of fixtures.reverse()) try { fixture.dispose(); } catch {}
  for (const kit of kits.reverse()) try { kit.dispose(); } catch {}
  if (original.fetch) globalThis.fetch = original.fetch;
  if (original.bitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = original.bitmap;
  if (original.progress === undefined) delete globalThis.ProgressEvent; else globalThis.ProgressEvent = original.progress;
  if (original.self === undefined) delete globalThis.self; else globalThis.self = original.self;
  THREE.TextureLoader.prototype.load = original.textureLoad;
}
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'pass') process.exitCode = 1;
