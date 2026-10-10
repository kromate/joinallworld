// The temporary rest-pose routing (rest-fallback.ts): lie, soak and wash use the previous body; the rest keep the native rig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYER_BODY_POSES } from './body-lifecycle.ts';
import { bodySwap, usesPreviousBody } from './rest-fallback.ts';

test('only lie, soak and wash route to the previous body', () => {
  const previous = PLAYER_BODY_POSES.filter(usesPreviousBody);
  assert.deepEqual([...previous].sort(), ['lie', 'soak', 'wash']);
  for (const pose of ['idle', 'walk', 'jog', 'sit', 'interact', 'dance', 'bucket', 'cook', 'cookLow', 'eat', 'drink', 'homeDoor'] as const) {
    assert.equal(usesPreviousBody(pose), false, pose);
  }
});

test('the body swap keeps the right kind, hides the native rig for a rest pose, and lets a get-up finish', () => {
  assert.equal(bodySwap(false, false, true), 'keep');
  assert.equal(bodySwap(true, true, false), 'keep');
  assert.equal(bodySwap(false, true, true), 'hide-then-load');
  assert.equal(bodySwap(false, true, false), 'hide-then-load');
  assert.equal(bodySwap(true, false, false), 'keep', 'the previous body finishes getting up first');
  assert.equal(bodySwap(true, false, true), 'load');
});

test('the home room loads the previous body with the saved look, and the native rig for every other pose', () => {
  const source = readFileSync(new URL('../home-scene.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(previous\) return module\.loadBody\(kit, look, seed, tile \* AVATAR_SCALE\)/);
  assert.match(source, /const look = who\.look \?\? lastState\?\.onboarding\?\.look \?\? null, seed = who\.seed;\n    setTimeout/);
  assert.match(source, /return module\.loadGameBody\(kit, look, seed/);
  assert.match(source, /if \(body\) \{ body\.object\.removeFromParent\(\); body\.dispose\(\); \}/, 'the body that is replaced is disposed');
  assert.match(source, /if \(wantsPreviousBody && !bodyIsPrevious\) \{ body\.object\.visible = false; avatar\.visible = true;/, 'no native rig in a rest pose');
});
