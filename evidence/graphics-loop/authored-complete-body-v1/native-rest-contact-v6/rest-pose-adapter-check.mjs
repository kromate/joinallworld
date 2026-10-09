import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNativeRestPoseAdapter } from './rest-pose-adapter.ts';

function makeActor(initialSurfaceY = 2.75) {
  const parent = new THREE.Group();
  parent.position.set(3, 2, -4);
  parent.rotation.y = Math.PI / 4;
  const root = new THREE.Group();
  root.position.set(1, 0, 2);
  parent.add(root);
  const hipParent = new THREE.Bone();
  hipParent.position.y = 0.5;
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.y = 0.3;
  const head = new THREE.Bone();
  head.name = 'mixamorigHead';
  head.position.y = 1.5;
  root.add(hipParent);
  hipParent.add(hips);
  root.add(head);
  parent.updateWorldMatrix(true, true);
  return { parent, root, hipParent, hips, initialSurfaceY };
}

function fakeMeasure(actor) {
  const probe = {
    metrics: { candidateVertices: { 'pelvis-back': 4, 'torso-back': 4, 'head-back': 4 }, capPerRegion: 16 },
    sample(surface, contacts) {
      const contact = contacts[0];
      assert.ok(contact, 'parent-local foot contacts are converted and forwarded');
      const surfaceY = surface.surfaceYAt(contact.x, contact.z);
      assert.ok(Number.isFinite(surfaceY), 'actual host surface query returns a finite height');
      const hip = actor.hips.getWorldPosition(new THREE.Vector3());
      const gap = hip.y - surfaceY;
      const supportedRegion = (value) => ({ vertices: 4, sampled: 4, contactVertices: value <= 0.018 ? 1 : 0,
        minimumGap: value, maximumGap: value });
      const pose = surface.pose;
      const footGaps = { left: { sampled: 2, minimumGap: 0.005 }, right: { sampled: 2, minimumGap: 0.006 } };
      const headInZone = pose === 'wash' ? surface.headZone.contains(new THREE.Vector3(0, 1, 0)) : null;
      const supported = pose === 'lie'
        ? gap >= -0.004 && gap <= 0.018
        : pose === 'soak'
          ? gap >= -0.004 && gap <= 0.018 && footGaps.left.minimumGap <= 0.018 && footGaps.right.minimumGap <= 0.018
          : headInZone === true && footGaps.left.minimumGap <= 0.018 && footGaps.right.minimumGap <= 0.018;
      return Object.freeze({ propId: surface.id, pose,
        regions: Object.freeze({ 'pelvis-back': supportedRegion(gap), 'torso-back': supportedRegion(gap + 0.002),
          'head-back': { vertices: 4, sampled: 4, contactVertices: 0, minimumGap: 0.1, maximumGap: 0.1 } }),
        footGaps, headInZone, supported, reason: supported ? null : 'fixture surface is outside the contact band' });
    },
  };
  return probe;
}

function makeSurface(actor, pose, prop, options = {}) {
  const sampledWorldPoints = [];
  return {
    id: `${pose}-${prop}`, pose, prop,
    surfaceYAt(worldX, worldZ) {
      sampledWorldPoints.push([worldX, worldZ]);
      return options.surfaceY ?? actor.initialSurfaceY;
    },
    ...(pose === 'wash' ? { headZone: { contains: () => true } } : {}),
    sampledWorldPoints,
  };
}

const actor = makeActor();
const adapter = createNativeRestPoseAdapter(actor.root, actor.hips, fakeMeasure(actor));
const parentLocalContact = { side: 'left', x: 0.25, y: 0.35, z: -0.1,
  points: [{ side: 'left', x: 0.25, y: 0.35, z: -0.1 }] };
const lieSurface = makeSurface(actor, 'lie', 'bed');
const lieSupport = { kind: 'prop-rest', surface: lieSurface };
let mappedFrames = 0;
const sampleContacts = () => [parentLocalContact];
assert.throws(() => adapter.apply('lie', lieSupport, () => { mappedFrames++; }, sampleContacts), /registered before/);
assert.equal(mappedFrames, 0, 'missing prop registration fails before mutating the pose');
const unregisterLie = adapter.register(lieSupport);
const expectedWorldContact = new THREE.Vector3(parentLocalContact.x, parentLocalContact.y, parentLocalContact.z)
  .applyMatrix4(actor.parent.matrixWorld);
const rootBefore = actor.root.position.clone();
const rootWorldBefore = actor.root.getWorldPosition(new THREE.Vector3()).y;
const initialHipY = actor.hips.getWorldPosition(new THREE.Vector3()).y;
const firstLie = adapter.apply('lie', lieSupport, () => { mappedFrames++; }, sampleContacts);
assert.equal(mappedFrames, 1);
assert.equal(firstLie.hipsWorldCorrection, 0, 'the mapped bone pose is not distorted to fake prop contact');
assert.ok(Math.abs(firstLie.rootWorldCorrection) <= 0.35, 'the measured whole-actor support anchor stays bounded');
assert.ok(firstLie.measurement.supported);
assert.ok(Math.abs(firstLie.measurement.regions['pelvis-back'].minimumGap - 0.018) < 0.003);
assert.ok(Math.abs(actor.root.getWorldPosition(new THREE.Vector3()).y - (rootWorldBefore + firstLie.rootWorldCorrection)) < 1e-8);
assert.notDeepEqual(actor.root.position.toArray(), rootBefore.toArray(), 'contact is solved by a whole-actor anchor, not an 8 cm pelvis-only adjustment');
assert.ok(Math.abs(actor.hips.getWorldPosition(new THREE.Vector3()).y - (initialHipY + firstLie.rootWorldCorrection)) < 1e-8);
assert.ok(lieSurface.sampledWorldPoints.some(([x, z]) => Math.hypot(x - expectedWorldContact.x, z - expectedWorldContact.z) < 1e-8),
  'surface query receives contacts transformed from actor-parent coordinates into world space');
let transitionFeetSolves = 0;
const transitionSupport = Object.freeze({ ...lieSupport, transitionFloorY: expectedWorldContact.y });
adapter.register(transitionSupport);
const enteringLie = adapter.apply('lie', transitionSupport, () => { mappedFrames++; }, sampleContacts,
  () => { transitionFeetSolves++; }, 'transition', 0);
assert.equal(transitionFeetSolves, 1, 'upright entry grounds against the actual host floor');
assert.equal(enteringLie.phase, 'transition');
assert.equal(enteringLie.transitionValidated, true);
assert.equal(enteringLie.rootWorldCorrection, 0, 'anchor blending starts at zero for the upright entry frame');
const penetratingSupport = Object.freeze({ ...lieSupport, transitionFloorY: expectedWorldContact.y + 0.01 });
adapter.register(penetratingSupport);
assert.throws(() => adapter.apply('lie', penetratingSupport, () => {}, sampleContacts, undefined, 'transition'), /penetrates the floor/);
const unplantedSupport = Object.freeze({ ...lieSupport, transitionFloorY: expectedWorldContact.y - 0.01 });
adapter.register(unplantedSupport);
assert.throws(() => adapter.apply('lie', unplantedSupport, () => {}, sampleContacts, undefined, 'transition'), /no planted foot/);
adapter.register(lieSupport);
unregisterLie();
unregisterLie();
assert.equal(adapter.activePropId, null, 'registration cleanup is idempotent');

const soakActor = makeActor(2.80);
const soakAdapter = createNativeRestPoseAdapter(soakActor.root, soakActor.hips, fakeMeasure(soakActor));
const soakSurface = makeSurface(soakActor, 'soak', 'tub');
const soakSupport = { kind: 'prop-rest', surface: soakSurface };
soakAdapter.register(soakSupport);
let footSolves = 0;
const soak = soakAdapter.apply('soak', soakSupport, () => {}, sampleContacts, () => { footSolves++; });
assert.equal(footSolves, 1, 'tub pose solves actual host foot contacts before body measurement');
assert.ok(soak.measurement.supported);

const washActor = makeActor(2.75);
const washAdapter = createNativeRestPoseAdapter(washActor.root, washActor.hips, fakeMeasure(washActor));
const washSurface = makeSurface(washActor, 'wash', 'shower');
const washSupport = { kind: 'prop-rest', surface: washSurface };
washAdapter.register(washSupport);
let washFootSolves = 0;
assert.throws(() => washAdapter.apply('wash', washSupport, () => {}, sampleContacts), /actual host foot-surface solver/);
const wash = washAdapter.apply('wash', washSupport, () => {}, sampleContacts, () => { washFootSolves++; });
assert.equal(washFootSolves, 1);
assert.equal(wash.measurement.headInZone, true, 'shower acceptance requires host water-zone evidence');
assert.ok(wash.measurement.supported);
assert.throws(() => washAdapter.apply('lie', washSupport, () => {}, sampleContacts, () => {}), /does not match/);

adapter.dispose(); soakAdapter.dispose(); washAdapter.dispose();
assert.throws(() => adapter.register(lieSupport), /disposed/);
console.log(JSON.stringify({
  status: 'pass',
  parentLocalContactsTransformedToWorld: true,
  explicitRegistrationBeforeMappedFrame: true,
  lieWholeActorAnchorMetres: firstLie.rootWorldCorrection,
  mappedBonePosePreserved: firstLie.hipsWorldCorrection === 0,
  soakHostFootSolverInvoked: footSolves,
  washHostFootSolverInvoked: washFootSolves,
  showerZoneRequired: wash.measurement.headInZone,
  limitation: 'Adapter contract fixture only; actual body/wardrobe contact, host props, source clips, and GPU poses remain unverified.',
}, null, 2));
