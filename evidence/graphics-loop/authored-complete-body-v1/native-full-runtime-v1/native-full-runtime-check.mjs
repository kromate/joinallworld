import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DOOR, INTO, OUT, SEATED, STILL, WORK_INTO, WORK_OUT, STAIRS } from '../../../../src/scene/body/poses.ts';
import { createNativeFullRuntime } from './native-full-runtime.ts';

const clipNames = new Set([
  ...Object.values(STILL).map(({ clip }) => clip),
  ...Object.values(INTO), ...Object.values(OUT), ...Object.values(WORK_INTO), ...Object.values(WORK_OUT),
  DOOR, STAIRS.up, STAIRS.down,
]);
const metrics = Object.freeze({ itemTriangles: Object.freeze({ shirt: 4 }), triangles: 4, drawCalls: 1 });
function fixture({ rejectClip, allowPresentation = true, family = 'male', shadowAlias = false } = {}) {
  const object = new THREE.Group();
  const originalLookup = object.getObjectByName;
  const actualBones = {
    mixamorigHead: new THREE.Bone(),
    mixamorigRightHand: new THREE.Bone(),
    mixamorigLeftHand: new THREE.Bone(),
    mixamorigHips: new THREE.Bone(),
  };
  for (const [name, bone] of Object.entries(actualBones)) { bone.name = name; object.add(bone); }
  if (shadowAlias) { const decoy = new THREE.Object3D(); decoy.name = 'Head'; object.add(decoy); }
  const events = [], changes = { presentation: 0, commits: 0, disposed: 0, unregisters: 0, measures: 0 };
  let fixtureDispose;
  let candidate = { family, height: 1, width: 1, depth: 1, supported: true };
  const body = createNativeFullRuntime({
    actor: { object, family, standingHeight: 2,
      boneAliases: { Head: 'mixamorigHead', hand_r: 'mixamorigRightHand', hand_l: 'mixamorigLeftHand', Hips: 'mixamorigHips' },
      dispose() { changes.disposed++; } },
    source: { has(name) { return clipNames.has(name) && name !== rejectClip; }, duration() { return 1; }, sample(clip, seconds) { return { clip, seconds }; } },
    pose: {
      apply(frame, context) { events.push({ name: frame.clip, seconds: frame.seconds, pose: context.pose, support: context.support.kind }); return true; },
      beginTransition(name, _from, crossfade) { events.push({ transition: name, crossfade }); },
      endTransition(name) { events.push({ end: name }); },
      restore() {},
    },
    look: {
      prepare(value) { if (!value || value.invalid) throw new Error('invalid look'); candidate = value; return value; },
      family(value) { return value.family; },
      appearance(value) { return { height: value.height, width: value.width, depth: value.depth }; },
    },
    presentation: {
      canSet() { return allowPresentation; }, set() { changes.presentation++; return true; },
      canWear(value) { return value.supported; }, commit(value) { changes.commits++; return value.commitResult !== false; },
      wardrobe: metrics, wardrobeError: null,
    },
    contacts: { sample() { return []; }, solve() { return { limited: false, maxError: 0 }; } },
    seatContact(seat) { return { kind: 'seat-anchor', hipWorld: [seat.x, seat.top, seat.z], floorY: seat.top }; },
    workContact(placement) { return { kind: 'flat-feet', floorY: placement.y }; },
    initialLook: candidate,
    sceneScale: 1,
    onDispose(callback) { fixtureDispose = callback; return () => { changes.unregisters++; }; },
  });
  return { body, object, actualBones, events, changes, originalLookup, disposeKit() { fixtureDispose?.(); } };
}

const f = fixture();
assert.equal(f.body.key, 'male');
assert.equal(f.object.getObjectByName('Head'), f.actualBones.mixamorigHead, 'alias returns the actual bone');
assert.equal(f.object.getObjectByName('hand_r'), f.actualBones.mixamorigRightHand);
assert.equal(f.actualBones.mixamorigHead.name, 'mixamorigHead', 'aliases do not rename bones or disturb bind identity');
assert.equal(f.body.scale, 1.225);
assert.equal(f.body.scaleX, 1.225);
assert.equal(f.body.scaleZ, 1.225);
assert.equal(f.body.strideScale, 1);

// All 15 public poses map to their exact named still clips; none silently falls back to idle.
for (const [pose, { clip }] of Object.entries(STILL)) {
  f.body.show(pose, false);
  assert.equal(f.events.at(-1).name, clip, `${pose} uses ${clip}`);
}
assert.equal(Object.keys(STILL).length, 15);
f.body.sampleUse('dance', 4.25);
assert.equal(f.events.at(-1).name, 'dance');
assert.equal(f.events.at(-1).seconds, 0.25);
f.body.stride(Math.PI, true, 0.3);
assert.equal(f.events.at(-1).name, STAIRS.up);
f.body.stride(Math.PI, false, -0.3);
assert.equal(f.events.at(-1).name, STAIRS.down);

f.body.place(2, 3, 4, 0.5);
assert.equal(f.object.position.y, 3, 'the native adapter does not reuse the legacy body lift');
f.body.sitOn(10, 2, 20, 0);
f.body.show('sit', true);
assert.equal(f.body.easing, true);
assert.equal(f.events.findLast((entry) => entry.transition)?.transition, INTO.sit);
assert.equal(f.events.findLast((entry) => entry.name)?.support, 'seat-anchor');
assert.equal(f.body.step(0.5), true);
assert.equal(f.body.step(0.5), false);
assert.equal(f.body.easing, false);
assert.equal(f.body.seated, true);
f.body.show('idle', true);
assert.equal(f.events.findLast((entry) => entry.transition)?.transition, OUT.sit);
assert.equal(f.events.findLast((entry) => entry.name)?.support, 'seat-anchor', 'sit exit retains seat support during transition');
f.body.settle();
assert.equal(f.body.seated, false);
f.body.workOn(5, 6, 7, 1.2);
f.body.show('cook', true);
assert.equal(f.events.findLast((entry) => entry.transition)?.transition, WORK_INTO.cook);
assert.equal(f.events.findLast((entry) => entry.name)?.support, 'flat-feet');
f.body.settle();
f.body.show('idle');
assert.equal(f.body.seated, false);
f.body.enter(true);
assert.equal(f.events.findLast((entry) => entry.transition)?.transition, DOOR);
assert.equal(f.body.sampleFootContacts().length, 0);
assert.equal(f.body.solveFeet(() => 0).limited, false);

const commitBefore = f.changes.commits;
assert.equal(f.body.wear({ family: 'female', height: 1, width: 1, depth: 1, supported: true }), false, 'other family requests a reload');
assert.equal(f.body.wear({ family: 'male', height: 1, width: 1, depth: 1, supported: false }), false, 'unsupported look is rejected');
assert.equal(f.body.wear({ invalid: true }), false, 'unparseable look is rejected');
assert.equal(f.changes.commits, commitBefore, 'rejected look does not mutate presentation');
assert.equal(f.body.wear({ family: 'male', height: 1.06, width: 1.13, depth: 1.09, supported: true }), true);
assert.equal(f.body.scaleX, f.body.scale * 1.13);
assert.equal(f.body.setPresentation('sleeping'), true);
assert.equal(f.changes.presentation, 1);

f.disposeKit();
assert.equal(f.changes.disposed, 1);
assert.equal(f.changes.unregisters, 1);
assert.equal(f.object.getObjectByName, f.originalLookup, 'dispose restores the original lookup method');
f.body.dispose();
assert.equal(f.changes.disposed, 1, 'dispose is idempotent after host teardown');

assert.throws(() => fixture({ rejectClip: 'interact' }), /missing required named clip: interact/,
  'missing source clip is rejected at preflight; it cannot degrade to idle');
assert.throws(() => fixture({ shadowAlias: true }), /would shadow a different authored object/,
  'alias preflight rejects a name collision rather than changing lookup identity');
const rejectPresentation = fixture({ allowPresentation: false });
assert.equal(rejectPresentation.body.setPresentation('sleeping'), false);
assert.equal(rejectPresentation.changes.presentation, 0);
rejectPresentation.body.dispose();

console.log(JSON.stringify({ status: 'pass', publicPoses: 15, clips: clipNames.size, transitions: 1,
  aliasTargetsAreBones: true, unsupportedMutationCount: 0, actorDisposals: 2, note: 'host-port contract only; native game/render behavior unverified' }, null, 2));
