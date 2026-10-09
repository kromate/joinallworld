// The venue stand-in (stand-in.ts): never fetches the body without WebGL2 or on a device the gate refuses, and never
// hides the procedural figure until a body is actually in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createKit } from '../kit.ts';
import { bodyImports } from './gate.ts';
import { BODY_POSE, createStandIn, solveSupportedFeet } from './stand-in.ts';
import { createFootContactController } from './foot-contact.ts';
import type { SkinnedBody } from './skinned.ts';
import { POSES } from '../characters.ts';

const fakeScene = () => ({ group: new THREE.Group(), avatar: new THREE.Group(), scale: 1 });
const noWebGL2 = { getContext: () => ({}) };
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test('every procedural pose has a body pose', () => {
  for (const pose of POSES) assert.ok(BODY_POSE[pose], pose);
});

test('support preflight keeps the highest supported target per foot across fresh solver samples', () => {
  const left = { side: 'left' as const, x: -0.1, y: -0.016, z: 0, points: [{ side: 'left' as const, x: -0.12, y: -0.016, z: 0 }, { side: 'left' as const, x: -0.08, y: -0.015, z: 0 }] };
  const right = { side: 'right' as const, x: 0.1, y: -0.016, z: 0, points: [{ side: 'right' as const, x: 0.08, y: -0.016, z: 0 }, { side: 'right' as const, x: 0.12, y: -0.015, z: 0 }] };
  const samples = [left, right];
  let solveCalls = 0, preflightCalls = 0;
  let passedTargets: number[] = [];
  const body = {
    easing: false, seated: false,
    sampleFootContacts: () => samples,
    solveFeet: (heightAt: Parameters<SkinnedBody['solveFeet']>[0]) => {
      solveCalls++;
      // The real solver samples again, producing distinct point objects at the same sides.
      passedTargets = [heightAt({ ...left, x: -0.12 }), heightAt({ ...right, x: 0.08 })];
      return { corrected: 2, maxError: 0, limited: false };
    },
  };
  const resolver = (x: number, z: number) => { preflightCalls++; return x > 0.1 ? 0.076 : 0.046; };
  assert.equal(solveSupportedFeet(body, resolver), true);
  assert.equal(preflightCalls, 4, 'both complete sole footprints are checked before mutation');
  assert.equal(solveCalls, 1);
  assert.deepEqual(passedTargets, [0.046, 0.076], 'feet may settle to different supported planes');
});

test('one unsupported sole sample skips the entire solve; seated/easing bodies are never sampled', () => {
  const contacts = [
    { side: 'left' as const, x: -0.1, y: 0, z: 0, points: [{ side: 'left' as const, x: -0.1, y: 0, z: 0 }] },
    { side: 'right' as const, x: 0.1, y: 0, z: 0, points: [{ side: 'right' as const, x: 0.1, y: 0, z: 0 }] },
  ];
  let solveCalls = 0, sampleCalls = 0;
  const body = { easing: false, seated: false, sampleFootContacts: () => { sampleCalls++; return contacts; }, solveFeet: () => { solveCalls++; return { corrected: 0, maxError: 0, limited: false }; } };
  assert.equal(solveSupportedFeet(body, x => x < 0 ? 0.016 : null), false);
  assert.equal(solveCalls, 0, 'valid left foot is not corrected independently');
  for (const state of [{ easing: true, seated: false }, { easing: false, seated: true }]) {
    assert.equal(solveSupportedFeet({ ...body, ...state }, () => 0.016), false);
  }
  assert.equal(sampleCalls, 1, 'transitions and seated poses are rejected before sampling');
  assert.equal(solveSupportedFeet(body, () => Number.NaN), false);
  assert.equal(solveCalls, 0);
  assert.equal(solveSupportedFeet(body, (x) => x < 0 ? 0.016 : 0.02), true,
    'fully supported feet may stand on separate planes');
  assert.equal(solveCalls, 1);
});

test('real solver uses the highest supported sample per foot across a paving seam', () => {
  const root = new THREE.Group();
  const bones: THREE.Bone[] = [];
  const feet: THREE.Bone[] = [];
  for (const side of ['l', 'r'] as const) {
    const thigh = new THREE.Bone(); thigh.name = `thigh_${side}`; thigh.position.set(side === 'l' ? -0.2 : 0.2, 1, 0);
    const calf = new THREE.Bone(); calf.name = `calf_${side}`; calf.position.y = -0.5; thigh.add(calf);
    const foot = new THREE.Bone(); foot.name = `foot_${side}`; foot.position.y = -0.5; calf.add(foot);
    const ball = new THREE.Bone(); ball.name = `ball_${side}`; ball.position.z = 0.08; foot.add(ball);
    root.add(thigh); bones.push(thigh, calf, foot, ball); feet.push(foot);
  }
  const positions: number[] = [], skinIndices: number[] = [], skinWeights: number[] = [];
  for (const side of ['l', 'r'] as const) {
    const centerX = side === 'l' ? -0.2 : 0.2, footIndex = bones.findIndex(bone => bone.name === `foot_${side}`);
    for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]] as const) {
      positions.push(centerX + dx, 0, dz);
      skinIndices.push(footIndex, 0, 0, 0); skinWeights.push(1, 0, 0, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const material = new THREE.MeshBasicMaterial();
  const base = new THREE.SkinnedMesh(geometry, material); root.add(base); root.updateMatrixWorld(true); base.bind(new THREE.Skeleton(bones));
  const clothingGeometry = new THREE.BufferGeometry(), clothingMaterial = new THREE.MeshBasicMaterial();
  const clothing = new THREE.SkinnedMesh(clothingGeometry, clothingMaterial); clothing.visible = false; root.add(clothing);
  const controller = createFootContactController(root, base, clothing);
  feet[0]!.position.y -= 0.04; feet[1]!.position.y -= 0.04; root.updateMatrixWorld(true);
  const body = { easing: false, seated: false, sampleFootContacts: () => controller.sample(), solveFeet: (heightAt: Parameters<typeof controller.solve>[0]) => controller.solve(heightAt) };
  const rootBefore = root.position.toArray();
  const before = controller.sample();
  const target = (x: number, _z: number, _y: number) => x >= 0.2 ? 0.076 : 0.046;
  // Right sole spans x=.16..24: its rear half sits on the lower court floor and its front half on raised tile.
  const preflight = solveSupportedFeet(body, target);
  assert.equal(preflight, true, 'all points have support even though right sole crosses the paving seam');
  const after = controller.sample();
  const leftBefore = before.find(contact => contact.side === 'left')!, rightBefore = before.find(contact => contact.side === 'right')!;
  const leftAfter = after.find(contact => contact.side === 'left')!, rightAfter = after.find(contact => contact.side === 'right')!;
  assert.ok(Math.abs(leftAfter.y - 0.046) < 0.004, `left foot stays on base floor (${leftAfter.y})`);
  assert.ok(Math.abs(rightAfter.y - 0.076) < 0.004, `right foot reaches the higher tile target (${rightAfter.y})`);
  assert.ok(Math.abs(leftAfter.y - 0.046) < Math.abs(leftBefore.y - 0.046));
  assert.ok(Math.abs(rightAfter.y - 0.076) < Math.abs(rightBefore.y - 0.076));
  assert.deepEqual(root.position.toArray(), rootBefore, 'per-foot fitting does not translate the actor');
  geometry.dispose(); material.dispose(); clothingGeometry.dispose(); clothingMaterial.dispose();
});

test('real foot-contact solver corrects one planted foot and preserves a 0.14m swing foot', () => {
  // Synthetic two-leg SkinnedMesh fixture, real production createFootContactController/solveSupportedFeet.
  const root = new THREE.Group();
  const bones: THREE.Bone[] = [];
  const footBones = new Map<string, THREE.Bone>();
  for (const side of ['l', 'r'] as const) {
    const thigh = new THREE.Bone(); thigh.name = `thigh_${side}`; thigh.position.set(side === 'l' ? -0.2 : 0.2, 1, 0);
    const calf = new THREE.Bone(); calf.name = `calf_${side}`; calf.position.y = -0.5; thigh.add(calf);
    const foot = new THREE.Bone(); foot.name = `foot_${side}`; foot.position.y = -0.5; calf.add(foot);
    const ball = new THREE.Bone(); ball.name = `ball_${side}`; ball.position.z = 0.08; foot.add(ball);
    root.add(thigh); bones.push(thigh, calf, foot, ball); footBones.set(side, foot);
  }
  const positions: number[] = [], skinIndices: number[] = [], skinWeights: number[] = [], indices: number[] = [];
  for (const side of ['l', 'r'] as const) {
    const centerX = side === 'l' ? -0.2 : 0.2, footIndex = bones.findIndex(bone => bone.name === `foot_${side}`);
    const start = positions.length / 3;
    for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]] as const) {
      positions.push(centerX + dx, 0, dz);
      skinIndices.push(footIndex, 0, 0, 0); skinWeights.push(1, 0, 0, 0);
    }
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  const baseMaterial = new THREE.MeshBasicMaterial();
  const base = new THREE.SkinnedMesh(geometry, baseMaterial); root.add(base);
  root.updateMatrixWorld(true);
  base.bind(new THREE.Skeleton(bones));
  const clothingGeometry = new THREE.BufferGeometry(), clothingMaterial = new THREE.MeshBasicMaterial();
  const clothing = new THREE.SkinnedMesh(clothingGeometry, clothingMaterial);
  clothing.visible = false; root.add(clothing);
  const controller = createFootContactController(root, base, clothing);
  const leftFoot = footBones.get('l')!, rightFoot = footBones.get('r')!;
  leftFoot.position.y -= 0.04;
  rightFoot.position.y += 0.16;
  root.updateMatrixWorld(true);
  const body = { easing: false, seated: false, sampleFootContacts: () => controller.sample(), solveFeet: (heightAt: Parameters<typeof controller.solve>[0]) => controller.solve(heightAt) };
  const beforeUnsupported = bones.map(bone => [bone.name, bone.position.toArray(), bone.quaternion.toArray()]);
  let oneSampleUnsupported = false;
  const vetoed = solveSupportedFeet(body, (x, z) => {
    if (x > 0 && z < 0 && !oneSampleUnsupported) { oneSampleUnsupported = true; return null; }
    return 0.016;
  });
  assert.equal(vetoed, false, 'one unsupported sole point vetoes both legs before any mutation');
  assert.equal(oneSampleUnsupported, true);
  assert.deepEqual(bones.map(bone => [bone.name, bone.position.toArray(), bone.quaternion.toArray()]), beforeUnsupported);

  const before = controller.sample();
  const leftBefore = before.find(contact => contact.side === 'left')!, rightBefore = before.find(contact => contact.side === 'right')!;
  assert.ok(Math.abs(leftBefore.y - (-0.04)) < 0.003, `planted source foot begins below target (${leftBefore.y})`);
  assert.ok(rightBefore.y > 0.14, `swing foot begins more than 0.14m above floor (${rightBefore.y})`);
  const rootBefore = root.position.toArray();
  const swingBones = bones.filter(bone => ['thigh_r', 'calf_r', 'foot_r'].includes(bone.name));
  const swingBonesBefore = swingBones.map(bone => [bone.name, bone.position.toArray(), bone.quaternion.toArray()]);
  assert.equal(solveSupportedFeet(body, () => 0.016), true);
  const after = controller.sample();
  const leftAfter = after.find(contact => contact.side === 'left')!, rightAfter = after.find(contact => contact.side === 'right')!;
  assert.ok(Math.abs(leftAfter.y - 0.016) < 0.004, `planted sole reaches target (${leftAfter.y})`);
  assert.ok(Math.abs(0.016 - leftAfter.y) < Math.abs(0.016 - leftBefore.y), 'planted-foot residual improves');
  assert.ok(Math.abs(rightAfter.y - rightBefore.y) < 0.001, 'raised swing sole remains at its sampled height');
  assert.deepEqual(swingBones.map(bone => [bone.name, bone.position.toArray(), bone.quaternion.toArray()]), swingBonesBefore,
    'swing leg joint transforms remain unchanged');
  assert.deepEqual(root.position.toArray(), rootBefore, 'solver never translates the actor root');
  geometry.dispose(); baseMaterial.dispose(); clothingGeometry.dispose(); clothingMaterial.dispose();
});

test('contact solving follows placement on mount, settled stand, gait, and transition completion; move stays transform-only', () => {
  const source = readFileSync(new URL('./stand-in.ts', import.meta.url), 'utf8');
  assert.match(source, /body\.show\(posed, false\);\s*put\(\);\s*solveContacts\(\);/);
  assert.match(source, /else body\.show\(posed,[\s\S]*?put\(\);\s*solveContacts\(\);/,
    'both immediate and animated door entry pass through the easing gate after placement');
  assert.match(source, /body\.stride\(phase, jog,[\s\S]*?put\(\); solveContacts\(\);/);
  assert.match(source, /step\(dt\) \{ const more = body\?\.step\(dt\) \?\? false; put\(\); if \(!more\) solveContacts\(\);/);
  assert.match(source, /settle\(\) \{ body\?\.settle\(\); put\(\); solveContacts\(\);/);
  assert.match(source, /move\(x, y, z, ry\) \{ at = \{ x, y, z, ry \}; put\(\); \}/, 'movement placement does not run a second solve');
  assert.match(source, /attach\(next\) \{[\s\S]*?scene = next;[\s\S]*?mount\(\);/);
  assert.match(source, /if \(scene\) scene\.avatar\.visible = true;\s*body\?\.object\.removeFromParent\(\);/,
    'detaching restores the procedural avatar and removes the skinned actor');
  assert.match(source, /standingIntent = name === 'stand' \|\| name === 'relax';/);
  assert.match(source, /standingIntent = climb === 0;/, 'any nonzero vertical gait is excluded');
  assert.match(source, /dispose\(\) \{ gone = true; clearStandingDestination\(\); drop\(\); scene = null; \}/);
});


test('no WebGL2: the body is never fetched and the figure stays', async () => {
  const kit = createKit(), before = bodyImports.count;
  let frames = 0;
  const standIn = createStandIn(kit, () => { frames += 1; }, true), scene = fakeScene();
  standIn.attach(scene);
  standIn.wear({ gender: 'woman' }, 'p1');
  for (let frame = 0; frame < 3; frame++) standIn.start(noWebGL2);
  standIn.pose('sit', 0.6, true); standIn.move(1, 0, 2, 0.5); standIn.gait(1, false); standIn.gait(1.2, false, 0.4);
  await settle();
  assert.equal(bodyImports.count, before);
  assert.equal(scene.avatar.visible, true);
  assert.equal(standIn.shown, false);
  assert.equal(standIn.easing, false);
  assert.equal(standIn.step(1 / 60), false);
  assert.equal(frames, 0);
  standIn.dispose(); kit.dispose();
});

test('a device the gate refuses never fetches, even with a renderer that would do', async () => {
  const kit = createKit(), before = bodyImports.count;
  const standIn = createStandIn(kit, () => {}, false), scene = fakeScene();
  standIn.attach(scene);
  standIn.start(null);
  await settle();
  assert.equal(bodyImports.count, before);
  assert.equal(scene.avatar.visible, true);
  standIn.dispose(); kit.dispose();
});

test('a seated exit destination survives lazy body loading and sit-exit without moving the seat', async () => {
  const kit = createKit(), events: { name: string; values: unknown[] }[] = [];
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  };
  const pending = deferred<SkinnedBody>();
  const load = (_kit: typeof kit, _look: unknown, _seed: unknown, _scale: number) => pending.promise;
  const standIn = createStandIn(kit, () => {}, true, load), firstScene = fakeScene();
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebGL2RenderingContext');
  class TestWebGL2 {}
  Object.defineProperty(globalThis, 'WebGL2RenderingContext', { configurable: true, value: TestWebGL2 });
  const body = (() => {
    let pose = 'idle', seated = false, transitionRemaining = 0;
    return {
      object: new THREE.Group(), key: 'female', scale: 1, scaleX: 1, scaleZ: 1, strideScale: 1,
      wardrobe: {}, wardrobeError: null, get pose() { return pose; }, get seated() { return seated || transitionRemaining > 0; }, get easing() { return transitionRemaining > 0; },
      setPresentation: () => true, sampleFootContacts: () => [], solveFeet: () => ({ contacts: [], solved: true }),
      show(next: string, animate = false) {
        events.push({ name: 'show', values: [next, animate] });
        if (next === pose && !transitionRemaining) return;
        const wasSeated = seated || transitionRemaining > 0;
        pose = next;
        if (next === 'sit') { seated = true; transitionRemaining = 0; }
        else if (animate && wasSeated) { seated = false; transitionRemaining = 0.3; }
        else { seated = false; transitionRemaining = 0; }
      },
      step(dt: number) { transitionRemaining = Math.max(0, transitionRemaining - dt); return transitionRemaining > 0; },
      settle() { transitionRemaining = 0; seated = false; pose = 'idle'; },
      enter: () => {}, sampleUse: () => {}, stride(_phase: number, _jog: boolean) { pose = 'walk'; seated = false; transitionRemaining = 0; },
      place(...values: unknown[]) { events.push({ name: 'place', values }); },
      sitOn(...values: unknown[]) { events.push({ name: 'sitOn', values }); },
      workOn: () => {}, fit: () => {}, wear: () => true, dispose: () => {},
    } as unknown as SkinnedBody;
  })();
  const assertSeat = (values: unknown[] | undefined, x: number, z: number, ry: number): void => {
    assert.ok(values, 'seat placement was recorded');
    assert.deepEqual([values[0], values[2], values[3]], [x, z, ry]);
    assert.equal(typeof values[1], 'number');
    assert.ok(Math.abs((values[1] as number) - 0.91) < 1e-12, 'seat top is 0.91 m within floating-point tolerance');
  };
  try {
    standIn.attach(firstScene); standIn.wear({ gender: 'woman' }, 'drive-1');
    standIn.move(0.2, 0.31, 0.42, 0.4); standIn.pose('sit', 0.6, false);
    // The destination is set before the skinned body is available, as it is at the
    // end of the driving scene's seated egress slide.
    standIn.standingAt(-1.56, 0, 0.42, 0.4);
    standIn.start({ getContext: () => new TestWebGL2() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending.resolve(body);
    await settle();
    const seatedPlace = [...events].reverse().find((event) => event.name === 'place');
    const seatedOn = [...events].reverse().find((event) => event.name === 'sitOn');
    assert.deepEqual(seatedPlace?.values, [-1.56, 0, 0.42, 0.4], 'loaded body receives the pending exterior floor destination');
    assertSeat(seatedOn?.values, 0.2, 0.42, 0.4);

    const placesBeforeClear = events.filter((event) => event.name === 'place').length;
    standIn.clearStandingDestination();
    standIn.move(0.2, 0.31, 0.42, 0.4);
    assert.equal(events.filter((event) => event.name === 'place').length, placesBeforeClear, 'clearing while seated discards the override without priming a replacement');
    assertSeat([...events].reverse().find((event) => event.name === 'sitOn')?.values, 0.2, 0.42, 0.4);
    standIn.standingAt(-1.56, 0, 0.42, 0.4);
    standIn.move(-1.56, 0.31, 0.42, 0.4);
    standIn.pose('stand', undefined, true);
    standIn.step(0.1);
    assert.deepEqual([...events].reverse().find((event) => event.name === 'place')?.values, [-1.56, 0, 0.42, 0.4], 'sit-exit retains the ground destination');
    assertSeat([...events].reverse().find((event) => event.name === 'sitOn')?.values, -1.56, 0.42, 0.4);
    standIn.move(-2, 0, 0.42, 0.4); standIn.gait(0.5, false, 0);
    assert.deepEqual([...events].reverse().find((event) => event.name === 'place')?.values, [-2, 0, 0.42, 0.4], 'walking clears the exit override and follows the live floor position');

    standIn.pose('sit', 0.6, false);
    const normalSeatedPlaces = events.filter((event) => event.name === 'place').length;
    standIn.move(-2, 0.2, 0.42, 0.4);
    assert.equal(events.filter((event) => event.name === 'place').length, normalSeatedPlaces, 'ordinary seated venues keep their original sitOn-only placement');
    standIn.standingAt(-3, 0, 0, 1);
    const beforeVenueChange = events.filter((event) => event.name === 'place').length;
    standIn.attach(fakeScene());
    assert.equal(events.filter((event) => event.name === 'place').length, beforeVenueChange, 'a new venue does not inherit the prior exit destination');
  } finally {
    standIn.dispose(); kit.dispose();
    if (previousDescriptor) Object.defineProperty(globalThis, 'WebGL2RenderingContext', previousDescriptor);
    else Reflect.deleteProperty(globalThis, 'WebGL2RenderingContext');
  }
});

test('nothing is fetched before a scene is attached (the home room and the map have none)', async () => {
  const kit = createKit(), before = bodyImports.count;
  const standIn = createStandIn(kit, () => {}, true);
  standIn.attach(null);
  standIn.start(noWebGL2);
  await settle();
  assert.equal(bodyImports.count, before);
  standIn.dispose(); kit.dispose();
});

test('the venue host owns the stand-in; the scene modules never reach the body module', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const host = strip(readFileSync(new URL('../../venue-world.ts', import.meta.url), 'utf8'));
  assert.match(host, /import\('\.\/scene\/body\/stand-in\.ts'\)/, 'the stand-in is a lazy chunk, fetched after the first frame');
  assert.doesNotMatch(host, /^import (?!type)[^;]*'\.\/scene\/body\/(stand-in|skinned)\.ts'/m, 'never a static import in the shared scene chunk');
  const venue = strip(readFileSync(new URL('../venue-scenes.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(venue, /body\//, 'venue-scenes.ts (the shared scene chunk) knows nothing of the body');
  const standIn = strip(readFileSync(new URL('./stand-in.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(standIn, /import\(/, 'the body module is reached through importBody() only');
  assert.doesNotMatch(standIn, /^import (?!type)[^;]*'\.\/skinned\.ts'/m, 'skinned.ts is a type import only');
});
