import assert from 'node:assert/strict';
import test from 'node:test';
import { EYE_SOCKETS, FACE_ATLAS, inEyeSocket } from './face-shader.ts';
import { readFileSync } from 'node:fs';

test('the existing sleep-eye atlas coordinates are preserved for each authored face', () => {
  assert.deepEqual(FACE_ATLAS.male.eyes, [141 / 1024, 240 / 1024]);
  assert.deepEqual(FACE_ATLAS.female.eyes, [134 / 1024, 239 / 1024]);
});

test('awake eye calibration stays inside the measured authored socket bounds for both body UVs', () => {
  assert.deepEqual(EYE_SOCKETS.male.left.map((v) => Math.round(v * 1024)), [142, 182]);
  assert.deepEqual(EYE_SOCKETS.male.right.map((v) => Math.round(v * 1024)), [240, 182]);
  assert.deepEqual(EYE_SOCKETS.female.left.map((v) => Math.round(v * 1024)), [136, 182]);
  assert.deepEqual(EYE_SOCKETS.female.right.map((v) => Math.round(v * 1024)), [238, 183]);
  assert.deepEqual(EYE_SOCKETS.male.irisDropPixels, [0.56, 1.06]);
  assert.deepEqual(EYE_SOCKETS.female.irisDropPixels, [1.71, 1.11]);
  for (const key of ['male', 'female'] as const) {
    for (const side of ['left', 'right'] as const) {
      const [u, v] = EYE_SOCKETS[key][side];
      assert.equal(inEyeSocket(key, [u, v], side), true);
      assert.equal(inEyeSocket(key, [u + EYE_SOCKETS[key].radius[0] * 1.01, v], side), false);
    }
  }
});

test('eye colour is injected after regional tint, remains skin-region-only, and is suppressed by sleeping', () => {
  const source = readFileSync(new URL('./skinned.ts', import.meta.url), 'utf8');
  assert.match(source, /replace\('#include <map_fragment>', `\$\{DRESS\}\$\{AWAKE_EYES\}`/);
  assert.match(source, /if \(uSleeping < 0\.5 && vRegion\.r > 0\.5\)/);
  assert.match(source, /uniform vec2 uEyeLeft, uEyeRight, uEyeRadius/);
  assert.match(source, /p\.y -= leftSocket \? uEyeDrop\.x : uEyeDrop\.y/);
  assert.match(source, /uEyeDrop: \{ value: new T\.Vector2\(\.\.\.EYE_SOCKETS\[key\]\.irisDropPixels/);
  assert.match(source, /uSleeping\.value = next === 'sleeping' \? 1 : 0/);
  assert.match(source, /customProgramCacheKey = \(\) => 'allworld-body-sleep-socket-eyes-2'/);
  assert.match(source, /uEyeLeft: \{ value: new T\.Vector2\(\.\.\.EYE_SOCKETS\[key\]\.left\) \}/);
});
