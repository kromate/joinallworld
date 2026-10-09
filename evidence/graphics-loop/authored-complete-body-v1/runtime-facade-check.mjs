import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadCompleteCharacter } from './rig.ts';
import { createNativeActionController } from './native-actions.ts';
import { assessAuthoredLook, createAuthoredRuntimeFacade } from './runtime-facade.ts';

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
  assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
  assert.equal(view.getUint32(4, true), 2, 'GLB v2');
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true);
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) binary = chunk;
    offset += length + 8;
  }
  assert(json && binary, 'GLB JSON/BIN chunks');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encoded.length + 3) & ~3, binaryLength = (binary.length + 3) & ~3;
  const output = new Uint8Array(28 + jsonLength + binaryLength), result = new DataView(output.buffer);
  result.setUint32(0, 0x46546c67, true); result.setUint32(4, 2, true); result.setUint32(8, output.length, true);
  result.setUint32(12, jsonLength, true); result.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + jsonLength); output.set(encoded, 20);
  result.setUint32(20 + jsonLength, binaryLength, true); result.setUint32(24 + jsonLength, 0x004e4942, true);
  output.set(binary, 28 + jsonLength);
  return output.buffer;
}

async function parseGlb(bytes) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(imageFreeGlb(bytes), '/');
}

function makeClipRig(scene) {
  scene.updateMatrixWorld(true);
  const names = [
    'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l',
    'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l',
    'thigh_r', 'calf_r', 'foot_r', 'ball_r',
  ];
  const bones = names.map((name) => scene.getObjectByName(name));
  assert(bones.every(Boolean), `clip source contains all ${names.length} expected named joints`);
  scene.skeleton = new THREE.Skeleton(bones, bones.map((bone) => bone.matrixWorld.clone().invert()));
  return { root: scene, skeleton: scene.skeleton };
}

function makeKit(bodyScene, sourceRig, clips) {
  const callbacks = new Set();
  let closed = false;
  return {
    authoredCharacterAssets: {
      loadTemplate: async () => bodyScene,
      loadMotionRig: async () => ({ root: sourceRig.root, clips }),
    },
    onDispose(callback) {
      if (closed) { callback(); return () => false; }
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    dispose() {
      if (closed) return;
      closed = true;
      for (const callback of [...callbacks]) callbacks.delete(callback), callback();
    },
    get callbackCount() { return callbacks.size; },
    get closed() { return closed; },
  };
}

function boneState(root) {
  root.updateMatrixWorld(true);
  return ['mixamorigHips', 'mixamorigLeftArm', 'mixamorigRightArm', 'mixamorigHead']
    .map((name) => root.getObjectByName(name).quaternion.toArray());
}

function exactLook(body) {
  return {
    body, face: 'oval', expression: 'neutral', skin: body === 'man' ? '#7a4a2c' : '#c98e62',
    hair: 'lowcut', outfit: 'casual', outfitColor: '#3f72c4', bottomsColor: '#243a66', fabric: 'plain',
    accessories: [], appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
  };
}

function unsupportedLookFields(look) {
  const unsupported = [];
  if (look.outfit !== 'casual') unsupported.push(`outfit:${look.outfit}`);
  if (look.hair !== 'lowcut') unsupported.push(`hair:${look.hair}`);
  if (look.fabric !== 'plain') unsupported.push(`fabric:${look.fabric}`);
  if (look.accessories.length) unsupported.push('accessories');
  if (look.wearables?.length) unsupported.push('wearables');
  return unsupported;
}

await MeshoptDecoder.ready;
const bodyBytes = readFileSync(bodyPath), clipBytes = readFileSync(clipPath);
const bodySha = sha(bodyBytes), clipSha = sha(clipBytes);
assert.equal(bodySha, pins.body, 'pinned authored body GLB');
assert.equal(clipSha, pins.clip, 'pinned legacy clip-pack GLB');
const [bodyGltf, clipGltf] = await Promise.all([parseGlb(bodyBytes), parseGlb(clipBytes)]);
const template = bodyGltf.scene, clipRig = makeClipRig(clipGltf.scene);

const kit = makeKit(template, clipRig, clipGltf.animations);
const cases = [];
const facades = [];
const characters = [];
const actions = [];
const lookDescriptors = [exactLook('man'), exactLook('woman')];

for (let i = 0; i < lookDescriptors.length; i++) {
  const look = lookDescriptors[i];
  const admission = assessAuthoredLook(look, `runtime-facade-check-${i}`, {
    bodyKeys: ['male', 'female'], unsupportedFields: unsupportedLookFields,
  });
  assert.equal(admission.ok, true, `${look.body}: shared pre-load selector admits exact look`);
  const unsupportedAdmission = assessAuthoredLook({ ...look, outfit: look.body === 'man' ? 'agbada' : 'owambe' }, i, {
    bodyKeys: ['male', 'female'], unsupportedFields: unsupportedLookFields,
  });
  assert.equal(unsupportedAdmission.ok, false, `${look.body}: selector rejects unsupported outfit instead of dropping it`);
  assert.equal(unsupportedAdmission.code, 'unsupported-initial-look');
  const character = await loadCompleteCharacter(kit, look, `runtime-facade-check-${i}`);
  const action = createNativeActionController(character.object);
  const built = createAuthoredRuntimeFacade(kit, look, `runtime-facade-check-${i}`, {
    character, actions: action, unsupportedLookFields,
  });
  assert.equal(built.ok, true, `${look.body}: facade admits exact pinned look`);
  const facade = built.actor;
  facades.push(facade); characters.push(character); actions.push(action);
  assert.equal(facade.bones.head, character.object.getObjectByName('mixamorigHead'), `${look.body}: actual head Bone exposed`);
  assert.equal(facade.bones.leftHand, character.object.getObjectByName('mixamorigLeftHand'), `${look.body}: actual left hand Bone exposed`);
  assert.equal(facade.bones.rightHand, character.object.getObjectByName('mixamorigRightHand'), `${look.body}: actual right hand Bone exposed`);
  assert.equal(facade.aliases.head.parent, facade.bones.head, `${look.body}: Head name is locator under actual head bone`);
  assert.equal(facade.aliases.leftHand.parent, facade.bones.leftHand, `${look.body}: hand_l name is locator under actual hand bone`);
  assert.equal(facade.aliases.rightHand.parent, facade.bones.rightHand, `${look.body}: hand_r name is locator under actual hand bone`);

  const fitOne = facade.fitToHeight(1.8);
  assert.equal(typeof fitOne, 'number', `${look.body}: first standing fit succeeds`);
  const outer = new THREE.Group();
  outer.scale.set(2.0, 0.5, 1.4); outer.rotation.set(0.2, 0.6, -0.1); outer.add(facade.object);
  facade.object.scale.set(4, 3, 2); facade.object.rotation.set(0.4, 1.1, -0.2);
  const fitTwo = facade.fitToHeight(1.8);
  assert.equal(typeof fitTwo, 'number', `${look.body}: repeated fit succeeds`);
  assert.ok(Math.abs(fitOne - fitTwo) < 1e-12, `${look.body}: repeated fit ignores old wrapper/parent transforms`);
  assert.ok(Math.abs(facade.object.scale.x - facade.object.scale.y) < 1e-12, `${look.body}: fit resets uniform wrapper scale`);
  outer.remove(facade.object);
  facade.place(2, 0.04, -3, 0.7);

  const beforeRejectedSupport = boneState(character.object);
  const idleSeat = facade.sample(0.3, 'idle', { kind: 'seat', top: 0.5, floorY: 0 });
  assert.equal(idleSeat.ok, false, `${look.body}: idle rejects seat support before sampling`);
  assert.equal(idleSeat.code, 'invalid-support');
  assert.deepEqual(boneState(character.object), beforeRejectedSupport, `${look.body}: invalid idle support leaves actual rig untouched`);
  const sitFloor = facade.sample(0.3, 'sit', { kind: 'floor' });
  assert.equal(sitFloor.ok, false, `${look.body}: sit rejects floor support`);
  assert.equal(sitFloor.code, 'invalid-support');
  const unsupportedPose = facade.sample(0.3, 'homeDoor', { kind: 'floor' });
  assert.equal(unsupportedPose.ok, false, `${look.body}: unsupported homeDoor does not become idle`);
  assert.equal(unsupportedPose.code, 'unsupported-pose');

  const currentLook = facade.look;
  assert.ok(Object.isFrozen(currentLook) && Object.isFrozen(currentLook.accessories), `${look.body}: exposed look identity is immutable`);
  const unsupportedLook = facade.setLook({ ...look, outfit: look.body === 'man' ? 'agbada' : 'owambe' });
  assert.equal(unsupportedLook.ok, false, `${look.body}: unsupported outfit update rejects`);
  assert.equal(unsupportedLook.code, 'unsupported-look', `${look.body}: unsupported outfit is rejected before checking update capability`);
  assert.equal(facade.look, currentLook, `${look.body}: rejected look retains same descriptor object`);
  const supportedButImmutable = facade.setLook(look);
  assert.equal(supportedButImmutable.ok, false, `${look.body}: supported look still needs a mutation bridge`);
  assert.equal(supportedButImmutable.code, 'look-updater-unavailable');
  assert.equal(facade.look, currentLook, `${look.body}: unavailable updater leaves look untouched`);
  const familyChange = facade.setLook(exactLook(look.body === 'man' ? 'woman' : 'man'));
  assert.equal(familyChange.ok, false, `${look.body}: family switch requests reload`);
  assert.equal(familyChange.code, 'body-family-change-requires-reload');

  cases.push({ family: look.body, standingHeight: (1.8 / fitOne), repeatedFitDelta: Math.abs(fitOne - fitTwo), rigMeshes: character.metrics.meshNames.length, triangles: character.metrics.triangleCount });
}

const maleBody = characters[0].object.getObjectByName('Body');
const femaleBody = characters[1].object.getObjectByName('Body');
const maleSmileBefore = maleBody.morphTargetInfluences[maleBody.morphTargetDictionary.nativeFacialSmileLeft];
const femaleSmileBefore = femaleBody.morphTargetInfluences[femaleBody.morphTargetDictionary.nativeFacialSmileLeft];
assert.equal(facades[0].setExpression('grin', 0).ok, true, 'male authored expression morph applies');
assert.ok(maleBody.morphTargetInfluences[maleBody.morphTargetDictionary.nativeFacialSmileLeft] > 0.8, 'actual male smile morph changed');
assert.equal(femaleBody.morphTargetInfluences[femaleBody.morphTargetDictionary.nativeFacialSmileLeft], femaleSmileBefore, 'male expression leaves female morph state unchanged');
assert.equal(facades[1].setExpression('neutral', 0).ok, true, 'female neutral expression morph applies');
assert.equal(femaleBody.morphTargetInfluences[femaleBody.morphTargetDictionary.nativeFacialSmileLeft], 0, 'female neutral resets actual smile morph');
assert.ok(maleBody.morphTargetInfluences[maleBody.morphTargetDictionary.nativeFacialSmileLeft] > 0.8, 'female expression leaves male morph state unchanged');
assert.ok(Number.isFinite(maleSmileBefore), 'male initial expression value is finite');

// Independent posed actors must retain separate skeleton state when one actor advances.
const femaleBefore = boneState(characters[1].object);
const maleWalk = facades[0].sample(0.67, 'walk', { kind: 'floor' });
assert.equal(maleWalk.ok, undefined, 'supported walk returns an action snapshot, not a failure envelope');
const femaleAfter = boneState(characters[1].object);
assert.deepEqual(femaleAfter, femaleBefore, 'male walk sample leaves female actor skeleton unchanged');

// A Kit already disposed invokes facade cleanup synchronously; the candidate must be rejected and detached.
const lateCharacter = await loadCompleteCharacter(kit, exactLook('man'), 'runtime-facade-late-kit-check');
const lateActions = createNativeActionController(lateCharacter.object);
const closedKit = { onDispose(callback) { callback(); return () => false; } };
const lateResult = createAuthoredRuntimeFacade(closedKit, exactLook('man'), 'late-kit', {
  character: lateCharacter, actions: lateActions, unsupportedLookFields,
});
assert.equal(lateResult.ok, false, 'already-disposed Kit rejects candidate');
assert.equal(lateResult.code, 'kit-disposed');
assert.equal(lateCharacter.object.parent, null, 'already-disposed Kit cleans actor root');

facades[0].dispose();
facades[0].dispose();
assert.equal(facades[0].sample(0, 'idle', { kind: 'floor' }).code, 'disposed', 'post-dispose sample explicitly rejects');
assert.equal(facades[0].setExpression('neutral', 0).code, 'disposed', 'post-dispose expression explicitly rejects');
assert.equal(facades[0].setLook(exactLook('man')).code, 'disposed', 'post-dispose look explicitly rejects');
assert.equal(facades[0].fitToHeight(2).code, 'disposed', 'post-dispose fit explicitly rejects');
assert.equal(facades[0].place(0, 0, 0, 0).code, 'disposed', 'post-dispose placement explicitly rejects');
assert.equal(facades[0].aliases.head.parent, null, 'disposal removes alias children');
kit.dispose();
assert.equal(kit.callbackCount, 0, 'Kit cleanup unregisters callbacks');
assert.equal(facades[1].object.children.length, 0, 'Kit teardown detaches actor');
assert.equal(facades[1].aliases.head.parent, null, 'Kit teardown removes alias locators');

const result = {
  status: 'pass',
  source: { bodySha256: bodySha, clipPackSha256: clipSha },
  codePins: {
    facadeSha256: sha(readFileSync(path.join(here, 'runtime-facade.ts'))),
    nativeActionsSha256: sha(readFileSync(path.join(here, 'native-actions.ts'))),
    rigSha256: sha(readFileSync(path.join(here, 'rig.ts'))),
    checkerSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  },
  actors: cases,
  checks: {
    actualMaleFemaleGLTF: true,
    actualRigBonesAndLegacyLocatorAliases: true,
    immutableLookDescriptor: true,
    repeatedFitStableUnderParentAndWrapperTransforms: true,
    invalidSupportDoesNotSampleRig: true,
    unsupportedPoseAndLookRejectWithoutFallback: true,
    independentActorSkeletons: true,
    kitDisposedAndRepeatedDispose: true,
    postDisposeMethodsReject: true,
  },
  limitations: [
    'Image-free CPU geometry and pose check only; no rendering or face/hair/clothing visual acceptance.',
    'The look-support callback in this check admits only casual/lowcut/plain/no-accessory looks; it is a test policy, not production coverage.',
    'No general same-actor lookBridge is implemented, so skin/body-shape/outfit updates are correctly unavailable here.',
    'The facade is not a SkinnedBody replacement and is not routed into creator/player/NPC scenes.',
  ],
};
writeFileSync(path.join(here, 'runtime-facade-check-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
