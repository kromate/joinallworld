import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { createKit } from '../../../../src/scene/kit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const tempBundle = path.join(here, 'native-prepared-factory.bundle.mjs');
const sourceStats = { files: 0, fetches: 0, imageDecodes: 0 };
const assetPins = Object.freeze([
  ['evidence/graphics-loop/authored-complete-body-v1/authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb', 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552'],
  ['src/scene/body/assets/clip-pack.glb', '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/out/male_casualsuit01.glb', '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/out/body-hide-map.json', 'dbe0c82a3e31da4e6ce37f4f1d9dc8611143c7c9e6dbef72ffea8d281aebe099'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/out/office-female.glb', 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/out/office-female-body-hide-map.json', '47c3999dd2facb11511965925d2adfa160519a72f4cbb4834ccfd636be7cfa66'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-footwear/out/shoes01-mobile.glb', '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-hair/out/short02-mobile.glb', 'a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-hair/out/afro01-mobile.glb', '3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474'],
  ['evidence/graphics-loop/authored-complete-body-v1/skin-assets/mobile/1024/middleage_african_male_q90.jpg', 'c8d69c3d8eb5232833599c5d8bfe12b03a85cf430d6b76cbf63a1fa026c3ea65'],
  ['evidence/graphics-loop/authored-complete-body-v1/skin-assets/mobile/1024/middleage_african_female_q90.jpg', 'd2f3d02e63a705173e888578ea91ecfb56ffdc207f59b6407687f1fe66cbd3c1'],
]);
const originalFetch = globalThis.fetch;
const originalBitmap = globalThis.createImageBitmap;
const originalProgressEvent = globalThis.ProgressEvent;
const originalSelf = globalThis.self;
const originalTextureLoad = THREE.TextureLoader.prototype.load;

function savedLook(body, outfit, hair, expression = 'neutral', skin = 'skin4') {
  return {
    body, hair, outfit, fabric: 'plain', skin, hairColor: 'darkbrown',
    outfitColor: 'navy', bottomsColor: 'cream', accessories: [], face: 'oval', expression,
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
  };
}

function close(a, b, tolerance = 1e-6) { return Math.abs(a - b) <= tolerance; }
function assertContactsStable(before, after, label) {
  assert.equal(after.length, before.length, `${label}: contact count is stable`);
  for (let index = 0; index < before.length; index++) {
    const a = before[index], b = after[index];
    assert.equal(b.side, a.side, `${label}: contact side is stable`);
    for (const key of ['x', 'y', 'z']) assert.ok(close(b[key], a[key]), `${label}: ${a.side} ${key} is stable`);
    assert.equal(b.points?.length, a.points?.length, `${label}: ${a.side} sampled shoe points are stable`);
    for (let point = 0; point < (a.points?.length ?? 0); point++) {
      for (const key of ['x', 'y', 'z']) assert.ok(close(b.points[point][key], a.points[point][key]), `${label}: ${a.side} sole point ${point} ${key} is stable`);
    }
  }
}

function captureBones(root) {
  const values = [];
  root.traverse((node) => {
    if (!node.isBone) return;
    values.push([node.name, ...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]);
  });
  return JSON.stringify(values);
}

async function installFileFetch() {
  if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
  if (typeof globalThis.ProgressEvent === 'undefined') {
    globalThis.ProgressEvent = class extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } };
  }
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!raw.startsWith('file:')) return originalFetch(input, init);
    sourceStats.fetches++;
    const bytes = await readFile(fileURLToPath(raw));
    sourceStats.files += bytes.byteLength;
    return new Response(bytes, { status: 200, headers: { 'content-type': raw.endsWith('.json') ? 'application/json' : 'model/gltf-binary' } });
  };
  globalThis.createImageBitmap = async () => {
    sourceStats.imageDecodes++;
    return { width: 1, height: 1, close() {} };
  };
  THREE.TextureLoader.prototype.load = function (_url, onLoad, _progress, onError) {
    const texture = new THREE.Texture({ width: 1, height: 1, data: new Uint8Array(4) });
    texture.needsUpdate = true;
    queueMicrotask(() => { try { onLoad?.(texture); } catch (error) { onError?.(error); } });
    return texture;
  };
}

const actors = [];
const kits = [];
let outcome;
try {
  await installFileFetch();
  for (const [relative, expected] of assetPins) {
    const bytes = await readFile(path.join(repo, relative));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `pinned asset changed: ${relative}`);
  }
  const { prepareNativeSkinnedBody } = await import(pathToFileURL(tempBundle).href);
  const sharedKit = createKit();
  kits.push(sharedKit);
  const player = await prepareNativeSkinnedBody({ kit: sharedKit, seed: 'player-seed', look: savedLook('man', 'casual', 'lowcut'), sceneScale: 1 });
  actors.push(player);
  const npc = await prepareNativeSkinnedBody({ kit: sharedKit, seed: 'npc-seed', look: savedLook('woman', 'office', 'afro', 'smile'), sceneScale: 1 });
  actors.push(npc);

  assert.notEqual(player.object, npc.object, 'player and NPC roots are actor-private');
  for (let left = 0; left < actors.length; left++) for (let right = left + 1; right < actors.length; right++) {
    assert.notEqual(actors[left].object.getObjectByName('Body').skeleton.bones[0], actors[right].object.getObjectByName('Body').skeleton.bones[0], 'each actor owns its skeleton bones');
    assert.notEqual(actors[left].object.getObjectByName('Body').geometry, actors[right].object.getObjectByName('Body').geometry, 'body masks use actor-private geometry wrappers');
    assert.notEqual(actors[left].object.getObjectByName('Body').material, actors[right].object.getObjectByName('Body').material, 'skin materials are actor-private');
  }
  assert.equal(player.preparedMetrics.sourceClipCount, 60, 'the exact authored clip pack is loaded');
  assert.equal(npc.preparedMetrics.sourceClipCount, 60);
  assert.equal(player.preparedMetrics.bodyKey, 'male');
  assert.equal(npc.preparedMetrics.bodyKey, 'female');
  assert.ok(player.preparedMetrics.authoredBodyTriangles > 20_000);
  assert.ok(player.preparedMetrics.shoeTriangles > 0);
  assert.ok(player.preparedMetrics.hairTriangles > 0);
  assert.equal(player.wardrobe.addedDrawCalls, 1);

  for (const actor of actors) {
    assert.ok(actor.preparedMetrics.standingHeightMetres > 1.2 && actor.preparedMetrics.standingHeightMetres < 2.6);
    const contacts = actor.sampleFootContacts();
    assert.deepEqual(contacts.map(({ side }) => side).sort(), ['left', 'right']);
    assert.ok(contacts.every((contact) => [contact.x, contact.y, contact.z].every(Number.isFinite) && contact.points?.length));
    actor.show('idle', false);
    const idleSoles = actor.sampleFootContacts();
    const reachablePlane = Math.max(...idleSoles.map(({ y }) => y)) + 0.04;
    const reachable = actor.solveFeet(() => reachablePlane);
    const raisedSoles = actor.sampleFootContacts();
    assert.equal(reachable.limited, false, `${actor.preparedMetrics.bodyKey}: four-centimeter raised support is reachable (${JSON.stringify({ reachable, before: idleSoles.map(({ side, y }) => ({ side, y })), after: raisedSoles.map(({ side, y }) => ({ side, y })) })})`);
    assert.ok(reachable.maxError < 0.004, `${actor.preparedMetrics.bodyKey}: both soles converge within 4 mm`);
    assert.equal(raisedSoles.length, 2);
    assert.ok(raisedSoles.every(({ y }) => Math.abs(y - reachablePlane) < 0.004), `${actor.preparedMetrics.bodyKey}: left and right soles reach the raised plane`);

    const unreachablePlane = reachablePlane + 4;
    const upperLeg = actor.object.getObjectByName('mixamorigLeftUpLeg');
    const lowerLeg = actor.object.getObjectByName('mixamorigLeftLeg');
    const ankle = actor.object.getObjectByName('mixamorigLeftFoot');
    const hipPoint = upperLeg.getWorldPosition(new THREE.Vector3());
    const kneePoint = lowerLeg.getWorldPosition(new THREE.Vector3());
    const anklePoint = ankle.getWorldPosition(new THREE.Vector3());
    const legReach = hipPoint.distanceTo(kneePoint) + kneePoint.distanceTo(anklePoint);
    assert.ok(unreachablePlane > hipPoint.y + legReach + 1, 'negative floor is above measured complete leg reach');
    const unreachable = actor.solveFeet(() => unreachablePlane);
    assert.equal(unreachable.limited, true, `${actor.preparedMetrics.bodyKey}: unreachable support is reported as limited`);
    assert.ok(unreachable.maxError > 0.004, `${actor.preparedMetrics.bodyKey}: limited support reports its residual`);
    assert.ok(actor.sampleFootContacts().every(({ y }) => y < unreachablePlane - 0.004), `${actor.preparedMetrics.bodyKey}: unreachable target is not falsely reported as attained`);
    actor.show('idle', false);
    actor.show('walk', true);
    actor.step(0.08);
    assert.ok(actor.sampleFootContacts().every(({ y }) => y >= -0.004), `${actor.preparedMetrics.bodyKey}: crossfade correction leaves no sole below the floor`);
    actor.settle();
    actor.stride(0.22, false);
    actor.stride(0.34, true);
    const body = actor.object.getObjectByName('Body');
    const position = body.geometry.getAttribute('position');
    const sample = new THREE.Vector3();
    for (const vertex of [0, Math.floor(position.count / 3), position.count - 1]) {
      body.getVertexPosition(vertex, sample);
      assert.ok(sample.toArray().every(Number.isFinite), 'deformed body samples remain finite');
    }
    assert.equal(actor.setPresentation('sleeping'), false, 'unsupported transient presentation is rejected');
  }

  const before = captureBones(player.object);
  assert.equal(player.wear(savedLook('man', 'casual', 'lowcut', 'grin', 'skin1'), 'player-seed'), true, 'same structure accepts a face/expression update');
  assert.equal(captureBones(player.object), before, 'look update preserves corrected native bone rest/pose state');
  const beforeReject = captureBones(player.object);
  assert.equal(player.wear(savedLook('man', 'kaftan', 'lowcut'), 'player-seed'), false, 'unsupported outfit is rejected');
  assert.equal(captureBones(player.object), beforeReject, 'rejection does not mutate the skeleton');
  assert.equal(player.wear(savedLook('woman', 'casual', 'afro'), 'player-seed'), false, 'family change requires a new prepared actor');
  assert.equal(captureBones(player.object), beforeReject, 'family rejection is mutation-free');

  // Moving/posing the player must preserve the other actor sharing its Kit.
  // The player's own pose is intentionally changed by show('idle') below.
  const sourceBones = npc.object.getObjectByName('Body').skeleton.bones;
  const restSignature = sourceBones.map((bone) => [bone.name, ...bone.position.toArray(), ...bone.quaternion.toArray()]);
  const parent = new THREE.Group();
  parent.position.set(2.4, 0.3, -1.8);
  parent.rotation.y = 0.47;
  parent.scale.setScalar(1.1);
  parent.add(player.object);
  player.place(0.8, 0.3, -0.6, 0.47);
  player.show('idle', false);
  parent.updateWorldMatrix(true, false);
  parent.updateMatrixWorld(true);
  const transformedContacts = player.sampleFootContacts();
  assert.equal(transformedContacts.length, 2, 'sole contacts remain available under transformed parent placement');
  assert.ok(transformedContacts.every((contact) => [contact.x, contact.y, contact.z].every(Number.isFinite)));
  assert.ok(Math.abs(Math.min(...transformedContacts.map(({ y }) => y)) - 0.3) < 0.004, 'pose sampling applies the current parent-local placement before solving contacts');
  assert.deepEqual(sourceBones.map((bone) => [bone.name, ...bone.position.toArray(), ...bone.quaternion.toArray()]), restSignature, 'placing and reposing the player leaves the NPC skeleton unchanged');
  parent.remove(player.object);

  const landmarkBaseline = { bodyKeys: actors.map((actor) => actor.preparedMetrics.bodyKey),
    modes: actors.map((actor) => actor.preparedMetrics.retargetMode), actorCount: actors.length,
    sourceClips: player.preparedMetrics.sourceClipCount,
    sampleContacts: actors.map((actor) => actor.sampleFootContacts().map((contact) => contact.side)),
    authoredMetrics: actors.map((actor) => ({
      heightMetres: actor.preparedMetrics.standingHeightMetres,
      bodyTriangles: actor.preparedMetrics.authoredBodyTriangles,
      clothingTriangles: actor.preparedMetrics.clothingTriangles,
      hairTriangles: actor.preparedMetrics.hairTriangles,
      shoeTriangles: actor.preparedMetrics.shoeTriangles,
      wardrobeDraws: actor.wardrobe.addedDrawCalls,
      warnings: actor.preparedMetrics.wardrobeWarnings,
    })) };
  assert.deepEqual(landmarkBaseline.modes, ['landmarks', 'landmarks'], 'omitted mode keeps both existing actors on landmark retargeting');
  // Release the landmark pair before loading candidate actors so this bounded CPU check does not
  // hold four fully dressed skeletons at once. The shared Kit retains only its intended templates.
  for (const actor of actors.splice(0)) actor.dispose();
  const directionCoverage = [];
  for (const [family, look, seed] of [
    ['male', savedLook('man', 'casual', 'lowcut'), 'direction-male'],
    ['female', savedLook('woman', 'office', 'afro'), 'direction-female'],
  ]) {
    const directionActor = await prepareNativeSkinnedBody({ kit: sharedKit, seed, look, sceneScale: 1, retargetMode: 'directions' });
    actors.push(directionActor);
    try {
      assert.equal(directionActor.preparedMetrics.bodyKey, family);
      assert.equal(directionActor.preparedMetrics.retargetMode, 'directions');
      directionActor.place(0, 0, 0, 0);
      directionActor.show('idle', false);
      let contacts = directionActor.sampleFootContacts();
      assert.deepEqual(contacts.map(({ side }) => side).sort(), ['left', 'right']);
      assert.ok(contacts.every(({ y }) => Number.isFinite(y) && y >= -0.004), `${family}: direction idle has no sole below floor`);
      directionActor.object.updateWorldMatrix(true, true);
      const leftHip = directionActor.object.getObjectByName('mixamorigLeftUpLeg');
      const leftKnee = directionActor.object.getObjectByName('mixamorigLeftLeg');
      const leftAnkle = directionActor.object.getObjectByName('mixamorigLeftFoot');
      assert.ok(leftHip && leftKnee && leftAnkle, `${family}: negative control has actual leg-chain bones`);
      const hipWorld = leftHip.getWorldPosition(new THREE.Vector3());
      const kneeWorld = leftKnee.getWorldPosition(new THREE.Vector3());
      const ankleWorld = leftAnkle.getWorldPosition(new THREE.Vector3());
      const maximumReach = hipWorld.distanceTo(kneeWorld) + kneeWorld.distanceTo(ankleWorld);
      const unreachableTarget = 4;
      assert.ok(unreachableTarget - Math.min(...contacts.map(({ y }) => y)) > maximumReach + 1,
        `${family}: negative-control floor exceeds measured leg-chain reach`);
      const unreachableFloor = directionActor.solveFeet(() => unreachableTarget);
      assert.equal(unreachableFloor.limited, true, `${family}: direction mode retains the above-reach shoe-floor negative control`);
      assert.ok(unreachableFloor.maxError > 0.004, `${family}: above-reach negative control reports a nonzero shoe residual`);
      directionActor.show('idle', false);
      directionActor.show('walk', true);
      directionActor.step(0.08);
      contacts = directionActor.sampleFootContacts();
      assert.ok(contacts.every(({ y }) => Number.isFinite(y) && y >= -0.004), `${family}: crossfade is followed by actual-shoe floor solving`);
      directionActor.settle();
      const phases = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
      const contactSolves = [];
      for (const phase of phases) {
        directionActor.stride(phase, false, 0);
        contacts = directionActor.sampleFootContacts();
        assert.ok(contacts.every(({ y }) => Number.isFinite(y) && y >= -0.004), `${family}: direction walk phase ${phase} has no sole below floor`);
        // stride() already runs the strict actual-shoe solve inside the pose port.
        // The host also solves each sampled pose; repeated calls must be idempotent
        // and retain the same real-shoe contact result.
        const planted = directionActor.lastDirectionContactSolve;
        assert.ok(planted, `${family}: direction walk phase ${phase} recorded its internal actual-shoe solve`);
        assert.equal(planted.limited, false, `${family}: actual shoe contacts reach the flat floor at phase ${phase}`);
        assert.ok(planted.maxError <= 0.004, `${family}: planted shoe residual at phase ${phase} is <=4 mm`);
        const repeated = directionActor.solveFeet(() => 0);
        const repeatedContacts = directionActor.sampleFootContacts();
        assert.equal(repeated.limited, false, `${family}: repeated host solve remains supported at phase ${phase}`);
        assert.ok(repeated.maxError <= 0.004, `${family}: repeated host solve residual at phase ${phase} is <=4 mm`);
        assert.ok(Math.abs(repeated.maxError - planted.maxError) <= 1e-6 && repeated.corrected === planted.corrected,
          `${family}: repeated host solve result is stable at phase ${phase}`);
        assert.ok(repeatedContacts.every(({ y }) => Number.isFinite(y) && y >= -0.004), `${family}: repeated host solve leaves no shoe below floor at phase ${phase}`);
        assertContactsStable(contacts, repeatedContacts, `${family}: phase ${phase} repeated host solve`);
        contactSolves.push({ phase, initial: { ...planted }, repeated: { ...repeated } });
      }
      parent.position.set(0.31, 0.12, -0.21); parent.rotation.set(0, 0.42, 0); parent.scale.setScalar(1.04);
      parent.add(directionActor.object);
      directionActor.place(0.2, 0.04, -0.3, 0.37);
      directionActor.show('idle', false);
      const raised = directionActor.sampleFootContacts();
      assert.ok(Math.abs(Math.min(...raised.map(({ y }) => y)) - 0.04) <= 0.004,
        `${family}: direction floor is host-derived under translated/scaled/yaw parent`);
      // Contact samples and solveFeet(heightAt) use parent-local coordinates;
      // place() receives the same local floor even under a transformed parent.
      const parentFloor = 0.04;
      const raisedFirst = directionActor.solveFeet(() => parentFloor);
      const afterRaisedFirst = directionActor.sampleFootContacts();
      const raisedSecond = directionActor.solveFeet(() => parentFloor);
      const afterRaisedSecond = directionActor.sampleFootContacts();
      assert.equal(raisedFirst.limited, false, `${family}: transformed-parent first host solve is supported`);
      assert.equal(raisedSecond.limited, false, `${family}: transformed-parent repeated host solve is supported`);
      assert.ok(raisedSecond.maxError <= 0.004 && Math.abs(raisedSecond.maxError - raisedFirst.maxError) <= 1e-6,
        `${family}: transformed-parent repeated solve is stable within 4 mm`);
      assert.ok(Math.abs(Math.min(...afterRaisedSecond.map(({ y }) => y)) - parentFloor) <= 0.004,
        `${family}: transformed-parent repeated solve reaches parent-local floor`);
      assertContactsStable(afterRaisedFirst, afterRaisedSecond, `${family}: transformed-parent repeated host solve`);
      parent.remove(directionActor.object);
      directionActor.place(0, 0, 0, 0); directionActor.show('idle', false);
      directionActor.show('interact', false);
      directionActor.workOn(0, 0, 0, 0);
      for (const pose of ['cook', 'eat', 'drink']) directionActor.show(pose, false);
      const workContacts = directionActor.sampleFootContacts();
      assert.ok(workContacts.length === 2 && workContacts.every(({ y }) => Number.isFinite(y) && y >= -0.004),
        `${family}: floor-supported interact/work poses retain finite supported shoes`);
      assert.throws(() => directionActor.stride(0.4, false, 0.2), /actual host stair-surface|stair.*contact|does not support diagnostic/,
        `${family}: stairs refuse without an actual host surface query`);
      assert.throws(() => directionActor.show('sit', false), /actual seat support/,
        `${family}: sit refuses without an actual host seat callback`);
      directionCoverage.push({ family, mode: directionActor.preparedMetrics.retargetMode, walkPhases: phases, contactSolves,
        floorPoseCoverage: ['idle', 'walk', 'interact', 'cook', 'eat', 'drink'], unsupportedWithoutContactCallbacks: ['stairs', 'sit'], unsupportedPoses: ['lie', 'soak', 'wash'] });
    } finally {
      directionActor.dispose();
      const index = actors.indexOf(directionActor);
      if (index >= 0) actors.splice(index, 1);
    }
  }

  outcome = {
    status: 'pass',
    actors: landmarkBaseline.actorCount,
    kits: kits.length,
    sharedKitPlayerNpc: true,
    bodyKeys: landmarkBaseline.bodyKeys,
    defaultRetargetModes: landmarkBaseline.modes,
    directionCoverage,
    sourceClips: landmarkBaseline.sourceClips,
    sampleContacts: landmarkBaseline.sampleContacts,
    raisedSupport: { targetMetres: 0.04, toleranceMetres: 0.004, families: landmarkBaseline.bodyKeys },
    authoredMetrics: landmarkBaseline.authoredMetrics,
    inputSkinAliases: ['skin4', 'skin1'],
    sourceAssetPinsVerified: assetPins.length,
    source: sourceStats,
    limitations: ['CPU contracts only; no pixel, timing, mobile, seat, prone, or gameplay acceptance.'],
  };
} catch (error) {
  outcome = { status: 'fail', error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error), source: sourceStats };
} finally {
  for (const actor of actors.reverse()) try { actor.dispose(); } catch {}
  for (const kit of kits.reverse()) try { kit.dispose(); } catch {}
  if (originalFetch) globalThis.fetch = originalFetch;
  if (originalBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalBitmap;
  if (originalProgressEvent === undefined) delete globalThis.ProgressEvent; else globalThis.ProgressEvent = originalProgressEvent;
  if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
  THREE.TextureLoader.prototype.load = originalTextureLoad;
  // The separate bundling command owns the generated test module; keep it available for replay.
}
console.log(JSON.stringify(outcome, null, 2));
if (outcome?.status !== 'pass') process.exitCode = 1;
