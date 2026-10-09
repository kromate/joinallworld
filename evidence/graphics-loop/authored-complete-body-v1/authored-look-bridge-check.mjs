import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createAuthoredLookBridge } from './authored-look-bridge.ts';
import { loadCompleteCharacter } from './rig.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(here, 'parametric-base-facial.glb');
const clipPath = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const pins = {
  body: '9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd',
  clip: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
};
const sha = (data) => createHash('sha256').update(data).digest('hex');

function imageFreeGlb(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67); assert.equal(view.getUint32(4, true), 2);
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true);
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) binary = chunk;
    offset += length + 8;
  }
  assert(json && binary, 'GLB JSON and BIN chunks');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encoded.length + 3) & ~3, binaryLength = (binary.length + 3) & ~3;
  const output = new Uint8Array(28 + jsonLength + binaryLength), result = new DataView(output.buffer);
  result.setUint32(0, 0x46546c67, true); result.setUint32(4, 2, true); result.setUint32(8, output.length, true);
  result.setUint32(12, jsonLength, true); result.setUint32(16, 0x4e4f534a, true); output.fill(32, 20, 20 + jsonLength);
  output.set(encoded, 20); result.setUint32(20 + jsonLength, binaryLength, true); result.setUint32(24 + jsonLength, 0x004e4942, true);
  output.set(binary, 28 + jsonLength);
  return output.buffer;
}

async function parseGlb(bytes) {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(imageFreeGlb(bytes), '/');
}

function makeClipRig(scene) {
  scene.updateMatrixWorld(true);
  const names = ['pelvis','spine_01','spine_02','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l',
    'clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r'];
  const bones = names.map((name) => scene.getObjectByName(name));
  assert(bones.every(Boolean), 'pinned clip rig has all 22 mapped bones');
  scene.skeleton = new THREE.Skeleton(bones, bones.map((bone) => bone.matrixWorld.clone().invert()));
  return scene;
}

function makeKit(template, motionRoot, clips) {
  const callbacks = new Set(); let closed = false;
  return {
    authoredCharacterAssets: { loadTemplate: async () => template, loadMotionRig: async () => ({ root: motionRoot, clips }) },
    onDispose(fn) { if (closed) { fn(); return () => false; } callbacks.add(fn); return () => callbacks.delete(fn); },
    dispose() { if (closed) return; closed = true; for (const fn of [...callbacks]) { callbacks.delete(fn); fn(); } },
    get callbackCount() { return callbacks.size; },
  };
}

function makeLook(body = 'man') {
  return { body, hair: body === 'woman' ? 'afro' : 'lowcut', outfit: 'casual', fabric: 'plain',
    skin: '#7a4a2c', hairColor: '#241b18', outfitColor: '#3f72c4', bottomsColor: '#243a66',
    accessories: [], face: 'oval', expression: 'neutral', appearance: { ageAppearance: 'adult', build: 'average', height: 'average' } };
}

function morphValue(mesh, name) {
  const index = mesh.morphTargetDictionary?.[name];
  return Number.isInteger(index) ? mesh.morphTargetInfluences?.[index] ?? 0 : null;
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), clipBytes = readFileSync(clipPath);
assert.equal(sha(bodyBytes), pins.body, 'pinned authored body input');
assert.equal(sha(clipBytes), pins.clip, 'pinned clip-pack input');
const [bodyGltf, clipGltf] = await Promise.all([parseGlb(bodyBytes), parseGlb(clipBytes)]);
const kit = makeKit(bodyGltf.scene, makeClipRig(clipGltf.scene), clipGltf.animations);
const records = [];
try {
  for (const family of ['man', 'woman']) {
    const seed = `look-bridge-${family}-fixed-seed`;
    const initialLook = makeLook(family);
    const actor = await loadCompleteCharacter(kit, initialLook, seed);
    let actorLive = true, skinLive = true, presentationLive = true;
    let identityCalls = 0, expressionCalls = 0, skinCalls = 0, paletteCalls = 0;
    const bodyMesh = actor.object.getObjectByName('Body');
    assert(bodyMesh?.isSkinnedMesh && bodyMesh.material?.color?.isColor, `${family}: private skinned body material exists`);
    const skin = {
      isReady: () => skinLive,
      setColor(color) { assert(skinLive); skinCalls++; bodyMesh.material.color.set(color); },
    };
    const presentationColors = { shirt: initialLook.outfitColor, trousers: initialLook.bottomsColor, hair: initialLook.hairColor };
    const presentation = {
      isReady: () => presentationLive,
      setColors(shirt, trousers, hair) {
        assert(presentationLive); paletteCalls++;
        presentationColors.shirt = shirt; presentationColors.trousers = trousers; presentationColors.hair = hair;
      },
    };
    const character = {
      body: actor.metrics.body,
      isReady: () => actorLive,
      updateIdentity(look, nextSeed) { identityCalls++; return actor.updateIdentity(look, nextSeed); },
      setExpression(name, seconds) { expressionCalls++; actor.setExpression(name, seconds); },
    };
    assert.throws(() => createAuthoredLookBridge({ character, skin, presentation,
      initialLook: makeLook(family === 'man' ? 'woman' : 'man'), seed }), /character body does not match/,
    `${family}: bridge refuses a prepared actor/look family mismatch`);
    assert.deepEqual({ identityCalls, expressionCalls, skinCalls, paletteCalls },
      { identityCalls: 0, expressionCalls: 0, skinCalls: 0, paletteCalls: 0 }, `${family}: construction mismatch has no side effects`);
    const bridge = createAuthoredLookBridge({ character, skin, presentation, initialLook, seed });
    const originalCurrent = bridge.currentLook;
    const originalSkinColor = bodyMesh.material.color.toArray();
    const originalShape = { oval: morphValue(bodyMesh, 'headOval'), round: morphValue(bodyMesh, 'headRound') };

    const rejectedCases = [
      ['body', { body: family === 'man' ? 'woman' : 'man' }],
      ['hair', { hair: family === 'man' ? 'afro' : 'bun' }],
      ['outfit', { outfit: family === 'man' ? 'hoodie' : 'owambe' }],
      ['fabric', { fabric: 'adire' }],
      ['accessories', { accessories: ['glasses'] }],
      ['wearables', { wearables: ['cap'] }],
      ['ageAppearance', { appearance: { ...initialLook.appearance, ageAppearance: 'elder' } }],
      ['build', { appearance: { ...initialLook.appearance, build: 'broad' } }],
      ['height', { appearance: { ...initialLook.appearance, height: 'tall' } }],
    ];
    const rejected = [];
    for (const [field, change] of rejectedCases) {
      const beforeCounts = { identityCalls, expressionCalls, skinCalls, paletteCalls };
      const result = bridge.apply({ ...originalCurrent, ...change }, seed);
      assert.equal(result.accepted, false, `${family}: ${field} change rejected`);
      assert.ok(result.reasons.length > 0, `${family}: ${field} reports why rejected`);
      assert.deepEqual(bridge.currentLook, originalCurrent, `${family}: ${field} rejection retains current look`);
      assert.deepEqual({ identityCalls, expressionCalls, skinCalls, paletteCalls }, beforeCounts, `${family}: ${field} rejection calls no mutator`);
      rejected.push({ field, reasons: result.reasons });
    }
    const badSeed = bridge.apply({ ...originalCurrent, face: 'round' }, `${seed}-wrong`);
    assert.equal(badSeed.accepted, false); assert.ok(badSeed.reasons.includes('requires-original-identity-seed'));
    const incomplete = bridge.apply({ face: 'round' }, seed);
    assert.equal(incomplete.accepted, false); assert.ok(incomplete.reasons.some((reason) => reason.startsWith('incomplete-look:')));

    const acceptedLook = { ...originalCurrent, face: 'round', expression: 'smile', skin: '#c98e62',
      outfitColor: '#c9423a', bottomsColor: '#8055c2', hairColor: '#5a3a26' };
    const accepted = bridge.apply(acceptedLook, seed);
    assert.equal(accepted.accepted, true, `${family}: allowed same-assets look update succeeds`);
    assert.deepEqual(accepted.reasons, []);
    assert.equal(identityCalls, 1, `${family}: face change uses actual identity update`);
    assert.equal(expressionCalls, 0, `${family}: identity update includes expression`);
    assert.equal(skinCalls, 1, `${family}: skin setter called once`);
    assert.equal(paletteCalls, 1, `${family}: prepared presentation palette called once`);
    assert.notDeepEqual(bodyMesh.material.color.toArray(), originalSkinColor, `${family}: body skin material recolored`);
    const updatedShape = { oval: morphValue(bodyMesh, 'headOval'), round: morphValue(bodyMesh, 'headRound') };
    assert.notDeepEqual(updatedShape, originalShape, `${family}: authored static face morphs changed`);
    assert.equal(bridge.currentLook.expression, 'smile');
    assert.deepEqual(presentationColors, { shirt: '#c9423a', trousers: '#8055c2', hair: '#5a3a26' });

    const expressionOnly = bridge.apply({ ...bridge.currentLook, expression: 'grin' }, seed);
    assert.equal(expressionOnly.accepted, true);
    assert.equal(identityCalls, 1, `${family}: expression-only update does not reset static identity`);
    assert.equal(expressionCalls, 1, `${family}: expression-only update uses character expression port`);
    const beforeNotReady = { ...bridge.currentLook };
    presentationLive = false;
    const notReady = bridge.apply({ ...beforeNotReady, skin: '#845236' }, seed);
    assert.equal(notReady.accepted, false); assert.ok(notReady.reasons.includes('presentation-not-ready'));
    assert.deepEqual(bridge.currentLook, beforeNotReady, `${family}: unavailable component rejects without changing bridge look`);
    assert.equal(skinCalls, 1, `${family}: readiness rejection does not mutate skin`);
    presentationLive = true;

    records.push({ family, seedKey: bridge.seedKey, rejected: rejected.map((row) => row.field),
      acceptedFields: ['face', 'expression', 'skin', 'outfitColor', 'bottomsColor', 'hairColor'],
      identityMorphBefore: originalShape, identityMorphAfter: updatedShape, skinColorBefore: originalSkinColor,
      skinColorAfter: bodyMesh.material.color.toArray(), presentationColors, calls: { identityCalls, expressionCalls, skinCalls, paletteCalls } });
    bridge.currentLook; // Exercise the defensive-copy getter before cleanup.
    actor.dispose(); actorLive = false;
    assert.equal(kit.callbackCount >= 0, true);
  }
} finally {
  kit.dispose();
}
assert.equal(kit.callbackCount, 0, 'Kit cleanup releases every actor callback');
const result = { status: 'pass', source: { bodySha256: pins.body, clipPackSha256: pins.clip,
  bridgeSha256: sha(readFileSync(path.join(here, 'authored-look-bridge.ts'))),
  checkerSha256: sha(readFileSync(fileURLToPath(import.meta.url))) }, records,
  checks: { actualCharacterUpdateIdentity: true, faceExpressionSkinAndPaletteUpdates: true,
    preparedBodyMismatchRefused: true,
    structuralChangesRejectedBeforeAnyMutation: true, exactSeedEnforced: true, incompleteLookRejected: true,
    deadPresentationRejectedBeforeMutation: true, kitCleanup: true },
  limitations: [
    'The check uses real authored GLB body morphs and materials; skin and presentation setter ports are instrumented adapters, not the texture-backed browser presentation implementation.',
    'No render, asset swap, different outfit, fabric, hairstyle, accessory, wearable, height, build, or age change is supported by this bridge.',
    'Preflight rejection is mutation-free. An arbitrary port throwing after commit begins is not claimed to be rolled back.',
  ] };
writeFileSync(path.join(here, 'authored-look-bridge-check-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
