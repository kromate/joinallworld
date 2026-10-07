// The venue stand-in (stand-in.ts): never fetches the body without WebGL2 or on a device the gate refuses, and never
// hides the procedural figure until a body is actually in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createKit } from '../kit.ts';
import { bodyImports } from './gate.ts';
import { BODY_POSE, createStandIn } from './stand-in.ts';
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
