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
import { POSES } from '../characters.ts';

const fakeScene = () => ({ group: new THREE.Group(), avatar: new THREE.Group(), scale: 1 });
const noWebGL2 = { getContext: () => ({}) };
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test('every procedural pose has a body pose', () => {
  for (const pose of POSES) assert.ok(BODY_POSE[pose], pose);
});

test('support preflight resolves the full footprint and reuses targets across a fresh solver sample', () => {
  const left = { side: 'left' as const, x: -0.1, y: -0.016, z: 0, points: [{ side: 'left' as const, x: -0.12, y: -0.016, z: 0 }, { side: 'left' as const, x: -0.08, y: -0.015, z: 0 }] };
  const right = { side: 'right' as const, x: 0.1, y: -0.016, z: 0, points: [{ side: 'right' as const, x: 0.08, y: -0.016, z: 0 }, { side: 'right' as const, x: 0.12, y: -0.015, z: 0 }] };
  const samples = [left, right];
  const targets = new Map(samples.flatMap(contact => contact.points.map(point => [`${point.x}|${point.y}|${point.z}`, 0.016] as const)));
  let solveCalls = 0, preflightCalls = 0;
  let passedTargets: number[] = [];
  const body = {
    easing: false, seated: false,
    sampleFootContacts: () => samples,
    solveFeet: (heightAt: (point: { x: number; y: number; z: number }) => number) => {
      solveCalls++;
      // The real solver samples again, producing distinct point objects at the same coordinates.
      passedTargets = samples.flatMap(contact => contact.points.map(point => heightAt({ ...point })));
      return { corrected: 2, maxError: 0, limited: false };
    },
  };
  const resolver = (x: number, z: number, y: number) => { preflightCalls++; return targets.get(`${x}|${y}|${z}`) ?? null; };
  assert.equal(solveSupportedFeet(body, resolver), true);
  assert.equal(preflightCalls, 4, 'both feet and all sole samples are checked before mutation');
  assert.equal(solveCalls, 1);
  assert.deepEqual(passedTargets, [0.016, 0.016, 0.016, 0.016]);
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
  assert.equal(solveSupportedFeet(body, (x) => x < 0 ? 0.016 : 0.02), false,
    'non-coplanar targets are outside this flat-contact slice');
  assert.equal(solveCalls, 0);
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
    for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]]) {
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
  assert.match(source, /dispose\(\) \{ gone = true; drop\(\); scene = null; \}/);
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
