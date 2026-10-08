// The venue stand-in (stand-in.ts): never fetches the body without WebGL2 or on a device the gate refuses, and never
// hides the procedural figure until a body is actually in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createKit } from '../kit.ts';
import { bodyImports } from './gate.ts';
import { BODY_POSE, createStandIn } from './stand-in.ts';
import type { SkinnedBody } from './skinned.ts';
import { POSES } from '../characters.ts';

const fakeScene = () => ({ group: new THREE.Group(), avatar: new THREE.Group(), scale: 1 });
const noWebGL2 = { getContext: () => ({}) };
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test('every procedural pose has a body pose', () => {
  for (const pose of POSES) assert.ok(BODY_POSE[pose], pose);
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
