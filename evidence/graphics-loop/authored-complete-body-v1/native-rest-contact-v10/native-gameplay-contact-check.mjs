import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { createKit } from '../../../../src/scene/kit.ts';

// Run after bundle-prepared-factory.mjs. The furniture and stair surfaces below are actual
// collision geometry; this exercises the public host callbacks, not a hidden runtime support flag.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const factoryUrl = pathToFileURL(path.join(here, 'native-full-runtime-v10/native-prepared-factory.bundle.mjs')).href;
const base3af = '3af17a01b8bd406bfb830ca0d2ee66d2d0093d28';
const pins = [
  ['src/scene/body/poses.ts', '7f328e67ec33d1c94516d76746635e45d8f90a01416176534fa0448d4e797d5e'],
  ['src/scene/body/foot-contact.ts', '6f98bb61fde23e51016148d06136fcb0b46b0b9d5c03cefc73c7ad47745df8c6'],
  ['src/scene/body/skinned.ts', '971a080a5d52bbe351f6b59e5377116d605a8a5c73d8c5e63e146db73a445aab'],
  ['src/scene/props.ts', 'd1a379c92b72d994bdb45e740ded30408a90d786c3074c4a42edc1a79aa4c907'],
  ['src/scene/home-scene.ts', '31a744babf552bc4bcfdac00e23b59f23ed363ed7f2f94dbd06da5e8b4bcb47d'],
  ['src/game/home-plan.ts', '7c40c33cd986101eb2ebcdf45de753d3933dbeca80376e4bbd8c412cf152dffa'],
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
const actors = [];
const kits = [];
const close = (a, b, epsilon = 0.004) => Math.abs(a - b) <= epsilon;

function savedLook(body, outfit) {
  return { body, hair: body === 'woman' ? 'afro' : 'lowcut', outfit, fabric: 'plain', skin: 'skin4',
    hairColor: 'darkbrown', outfitColor: 'navy', bottomsColor: 'cream', accessories: [], face: 'oval', expression: 'neutral',
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } };
}
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
    const texture = new THREE.Texture({ width: 1, height: 1, data: new Uint8Array(4) });
    texture.needsUpdate = true; queueMicrotask(() => { try { onLoad?.(texture); } catch (error) { onError?.(error); } }); return texture;
  };
}
function meshBox(parent, name, size, center) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
  mesh.name = name; mesh.position.set(...center); parent.add(mesh); mesh.updateMatrixWorld(true); return mesh;
}
function makeSourceHomeStairs(parent) {
  // Mirrors `stairsOf` in 3af17a0 home-scene.ts: ROOM=10, WALL_HEIGHT=3.4,
  // AVATAR_SCALE=.72, actual owned duplex grid12 flight {x:7,y:14,w:6,h:2,dir:1}, tile=10/12.
  const flight = { x: 7, y: 14, w: 6, h: 2, dir: 1 };
  const room = 10, wallHeight = 3.4, tile = room / 12, avatarScale = 0.72;
  const edge = (index) => -room / 2 + index * tile;
  const count = Math.max(flight.w * 2, Math.ceil(wallHeight / (0.18 * tile * avatarScale * 2.45 / 1.81)));
  const run = flight.w * tile / count, rise = wallHeight / count;
  const z0 = edge(flight.y), z1 = edge(flight.y + flight.h), z = (z0 + z1) / 2;
  const meshes = [];
  for (let index = 0; index < count; index++) {
    const x = edge(flight.x) + (index + 0.5) * run;
    const height = (index + 1) * rise;
    meshes.push(meshBox(parent, `source-stair-tread-${index}`, [run, height, z1 - z0 - 0.1], [x, height / 2, z]));
  }
  return { meshes, count, run, rise, xStart: edge(flight.x), z };
}
function rayHeight(meshes, worldPoint) {
  for (const mesh of meshes) { mesh.updateWorldMatrix(true, false); mesh.updateMatrixWorld(true); }
  const ray = new THREE.Raycaster(new THREE.Vector3(worldPoint.x, worldPoint.y + 8, worldPoint.z), new THREE.Vector3(0, -1, 0), 0, 16);
  const hits = ray.intersectObjects(meshes, false);
  return hits[0]?.point.y ?? null;
}
function parentYAt(parent, meshes, x, z, probeY = 3) {
  parent.updateWorldMatrix(true, false);
  const world = new THREE.Vector3(x, probeY, z).applyMatrix4(parent.matrixWorld);
  const hitY = rayHeight(meshes, world);
  if (hitY === null) return null;
  return new THREE.Vector3(world.x, hitY, world.z).applyMatrix4(parent.matrixWorld.clone().invert()).y;
}
function tickTransition(body, limitSeconds = 8) {
  let elapsed = 0;
  while (body.easing && elapsed < limitSeconds) { body.step(0.04); elapsed += 0.04; }
  assert.equal(body.easing, false, `transition finishes within ${limitSeconds}s`);
}
function assertSolesOnFloor(body, floorAt, label, requireBoth = false) {
  const contacts = body.sampleFootContacts();
  assert.deepEqual(contacts.map(({ side }) => side).sort(), ['left', 'right'], `${label}: both shoes are sampled`);
  let grounded = false;
  for (const contact of contacts) for (const point of contact.points ?? [contact]) {
    const floor = floorAt(point);
    assert.ok(Number.isFinite(floor), `${label}: host surface exists below ${point.side} shoe`);
    assert.ok(point.y >= floor - 0.004, `${label}: shoe does not penetrate host surface (${point.y - floor}m)`);
    if (Math.abs(point.y - floor) <= 0.004) grounded = true;
  }
  if (requireBoth) for (const contact of contacts) {
    assert.ok(Math.abs(contact.y - floorAt(contact)) <= 0.004, `${label}: ${contact.side} sole minimum is within 4mm of the actual floor`);
  }
  assert.ok(grounded, `${label}: at least one sole point is supported (swing foot need not be planted)`);
  return contacts;
}

let result;
try {
  installFileFetch();
  for (const [relative, expected] of pins) {
    const source = execFileSync('git', ['show', `${base3af}:${relative}`], { cwd: repo });
    const actual = createHash('sha256').update(source).digest('hex');
    assert.equal(actual, expected, `pinned exact production source changed: ${relative}`);
  }
  for (const [relative, expected] of assets) {
    const actual = createHash('sha256').update(await readFile(path.join(repo, relative))).digest('hex');
    assert.equal(actual, expected, `pinned asset changed: ${relative}`);
  }
  const { prepareNativeSkinnedBody, NATIVE_PREPARED_POSE_COVERAGE, NATIVE_PREPARED_CONDITIONAL_CONTACT_COVERAGE } = await import(factoryUrl);
  assert.deepEqual(NATIVE_PREPARED_POSE_COVERAGE, ['idle', 'walk', 'interact', 'cook', 'eat', 'drink']);
  assert.deepEqual(NATIVE_PREPARED_CONDITIONAL_CONTACT_COVERAGE, {
    poses: ['sit', 'lie', 'soak', 'wash'], transitions: ['sit-enter', 'sit-exit', 'lie-down', 'get-up', 'soak-wash-enter', 'soak-wash-exit', 'shower-wash-enter', 'shower-wash-exit', 'stairs-up', 'stairs-down'],
  });
  const familyResults = [];
  for (const family of ['man', 'woman']) {
    const kit = createKit(); kits.push(kit);
    const chairParent = new THREE.Group();
    chairParent.position.set(1.1, 0.35, -0.8); chairParent.rotation.y = 0.41; chairParent.scale.setScalar(0.9);
    const floor = meshBox(chairParent, 'actual-floor', [10, 0.1, 10], [0, -0.05, 0]);
    const officeChair = meshBox(chairParent, 'venue-office-chair-seat', [0.62, 0.1, 0.6], [0, 0.55, -0.08]); // top .60
    const homeChair = meshBox(chairParent, 'home-molded-chair-seat', [0.5, 0.06, 0.5], [0, 0.38, -0.08]); // top .41
    const impossibleChair = meshBox(chairParent, 'unreachable-test-seat', [0.7, 0.1, 0.7], [0, 4.95, -0.08]); // top 5.0
    const floorMeshes = [floor];
    const furniture = { office: { mesh: officeChair, top: 0.6 }, home: { mesh: homeChair, top: 0.41 } };
    function chairSupport(seat, actor) {
      chairParent.updateWorldMatrix(true, false);
      const local = new THREE.Vector3(seat.x, seat.top, seat.z).applyMatrix4(chairParent.matrixWorld);
      const selected = seat.top > 2 ? impossibleChair : seat.top > 0.5 ? officeChair : homeChair;
      const topWorldY = rayHeight([selected], local);
      const floorWorldY = rayHeight(floorMeshes, local);
      if (topWorldY === null || floorWorldY === null) return { kind: 'diagnostic', floorY: floorWorldY ?? NaN };
      const hip = actor.getObjectByName('mixamorigHips');
      actor.updateWorldMatrix(true, false); actor.updateMatrixWorld(true);
      const hipWorld = hip.getWorldPosition(new THREE.Vector3());
      return { kind: 'seat-anchor', hipWorld: [local.x, hipWorld.y, local.z], seatTopY: topWorldY, floorY: floorWorldY };
    }
    const stairs = makeSourceHomeStairs(chairParent);
    // Exact duplex ground footprint: plot.w18, plot.d16, tileROOM/grid12.
    const stairFloor = meshBox(chairParent, 'duplex-floor', [18 * (10 / 12), 0.1, 16 * (10 / 12)], [-5 + 9 * (10 / 12), -0.034, -5 + 8 * (10 / 12)]);
    const stairSurfaceMeshes = [...stairs.meshes, stairFloor];
    const missingStairSamples = [];
    const actor = await prepareNativeSkinnedBody({
      kit, seed: `contact-${family}`, look: savedLook(family, family === 'woman' ? 'office' : 'casual'), sceneScale: 1,
      seatSupport: chairSupport,
      stairContactHeightAt: (contact) => {
        const height = parentYAt(chairParent, stairSurfaceMeshes, contact.x, contact.z, contact.y + 3);
        if (height === null) missingStairSamples.push({ ...contact });
        return height;
      },
    });
    actors.push(actor); chairParent.add(actor.object); actor.place(0, 0, 0, 0);
    for (const unsupported of ['lie', 'soak', 'wash']) assert.throws(() => actor.show(unsupported, false), /unsupported|unavailable|requires an actual matching/i);
    assert.equal(actor.pose, 'idle');
    assert.throws(() => actor.show('sit', false), /seat support|actual seat/i, `${family}: sit refuses before a chair is attached`);
    assert.equal(actor.pose, 'idle', `${family}: refused sit does not mutate pose state`);
    for (const [kind, fixture] of Object.entries(furniture)) {
      actor.sitOn(0, fixture.top, -0.08, 0);
      actor.show('sit', true);
      tickTransition(actor);
      assert.equal(actor.pose, 'sit'); assert.equal(actor.seated, true);
      assertSolesOnFloor(actor, (point) => parentYAt(chairParent, floorMeshes, point.x, point.z, point.y + 3), `${family}/${kind} seated`, true);
      actor.show('idle', true);
      tickTransition(actor);
      assert.equal(actor.pose, 'idle'); assert.equal(actor.seated, false);
      assertSolesOnFloor(actor, (point) => parentYAt(chairParent, floorMeshes, point.x, point.z, point.y + 3), `${family}/${kind} get-up`, true);
    }
    actor.sitOn(0, 5, -0.08, 0);
    assert.throws(() => actor.show('sit', false), /seat|support|feet|unreachable/i, `${family}: unreachable real seat surface is rejected`);
    assert.equal(actor.pose, 'idle', `${family}: failed seat contact rolls back the public pose`);
    assert.equal(actor.seated, false, `${family}: failed seat contact never reports seated`);
    const stairPhases = [0.18, 0.42, 0.68, 0.91];
    actor.fit((10 / 12) * 0.72); // Exact duplex tile * AVATAR_SCALE; stairs travel along the flight's X axis.
    for (const climb of [1, -1]) for (let index = 0; index < stairPhases.length; index++) {
      const step = climb > 0 ? index * 4 : (stairPhases.length - 1 - index) * 4;
      const x = stairs.xStart + (step + 0.5) * stairs.run;
      actor.place(x, (step + 1) * stairs.rise, stairs.z, climb * Math.PI / 2);
      const phase = stairPhases[index];
      try { actor.stride(phase * 2 * Math.PI, false, climb * 0.18); } catch (error) {
        throw new Error(`${family}/stairs direction=${climb} step=${step} phase=${phase}: ${error.message}; missing=${JSON.stringify(missingStairSamples)}`, { cause: error });
      }
      const contacts = assertSolesOnFloor(actor, (point) => parentYAt(chairParent, stairSurfaceMeshes, point.x, point.z, point.y + 3), `${family}/stairs ${climb > 0 ? 'up' : 'down'}@${phase}`);
      assert.equal(contacts.length, 2);
    }
    for (const unsupported of ['lie', 'soak', 'wash']) assert.throws(() => actor.show(unsupported, false), /unsupported|unavailable|requires an actual matching/i, `${family}: ${unsupported} remains refused`);
    familyResults.push({ family, furniture: Object.keys(furniture), stairPhases,
      stairFixture: { sceneScale: (10 / 12) * 0.72, plan: 'owned duplex grid12, flight x7/y14/w6/h2/dir1', travelAxis: 'X', yaw: 'direction * pi/2', family: '3af17a0 home-scene stairsOf', treads: stairs.count, runPerTread: stairs.run, risePerTread: stairs.rise },
      sourceClips: actor.preparedMetrics.sourceClipCount,
      bodyTriangles: actor.preparedMetrics.authoredBodyTriangles, clothingTriangles: actor.preparedMetrics.clothingTriangles,
      shoeTriangles: actor.preparedMetrics.shoeTriangles, seatSurfaceContract: 'posterior body+visible clothing converged <=1mm; both shoes supported',
      stairSurfaceContract: 'raycasted host tread heights per deformed sole point; no penetration >4mm; at least one supported sole point' });
    actor.dispose(); actors.pop();
    const noContactActor = await prepareNativeSkinnedBody({ kit, seed: `no-contact-${family}`, look: savedLook(family, family === 'woman' ? 'office' : 'casual'), sceneScale: 1 });
    actors.push(noContactActor);
    assert.throws(() => noContactActor.show('sit', false), /seat support/i, `${family}: sit without a host surface is refused`);
    assert.equal(noContactActor.pose, 'idle');
    assert.throws(() => noContactActor.stride(0.3, false, 0.18), /stair.*contact/i, `${family}: stairs without a host query are refused`);
    assert.equal(noContactActor.pose, 'idle');
    noContactActor.dispose(); actors.pop();
    for (const object of [officeChair, homeChair, impossibleChair, ...stairs.meshes, stairFloor, floor]) {
      chairParent.remove(object); object.geometry.dispose(); object.material.dispose();
    }
    kit.dispose(); kits.pop();
  }
  result = { status: 'pass', base3af, sourcePins: pins.length, assetPins: assets.length,
    families: familyResults, source: sourceStats,
    limitations: ['Bounded CPU contract only; root must review remote pixels and real venue integration.',
      'Chair fixtures reproduce the source scene seat dimensions, but the callback must be wired to actual host chair geometry.',
      'Lie, soak, and wash remain unsupported; stairs reject any missing or unreachable terrain samples.'] };
} catch (error) {
  result = { status: 'fail', error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error), source: sourceStats };
} finally {
  for (const actor of actors.reverse()) try { actor.dispose(); } catch {}
  for (const kit of kits.reverse()) try { kit.dispose(); } catch {}
  if (original.fetch) globalThis.fetch = original.fetch;
  if (original.bitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = original.bitmap;
  if (original.progress === undefined) delete globalThis.ProgressEvent; else globalThis.ProgressEvent = original.progress;
  if (original.self === undefined) delete globalThis.self; else globalThis.self = original.self;
  THREE.TextureLoader.prototype.load = original.textureLoad;
}
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'pass') process.exitCode = 1;
