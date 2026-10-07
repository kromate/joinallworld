// How a saved look dresses the skinned body (tint.ts): which body file, and the colours the material is given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLook } from '../characters.ts';
import { BODY_MANIFEST } from './manifest.ts';
import { SHOES, bodyKeyFor, bodyTint, linear } from './tint.ts';

const close = (actual: readonly number[], expected: readonly number[], message: string) =>
  assert.ok(actual.every((value, index) => Math.abs(value - expected[index]!) < 1e-9), `${message}: ${actual} ≠ ${expected}`);

test('hex → linear RGB', () => {
  close(linear('#ffffff'), [1, 1, 1], 'white');
  close(linear('#000'), [0, 0, 0], 'black');
  assert.ok(Math.abs(linear('#808080')[0] - 0.2158605) < 1e-6, 'sRGB mid grey');
  close(linear('not a colour'), linear('#808080'), 'unreadable is mid grey');
});

test('woman wears female.glb, man wears male.glb', () => {
  assert.equal(bodyKeyFor({ body: 'woman' }), 'female');
  assert.equal(bodyKeyFor({ body: 'man' }), 'male');
  assert.equal(bodyTint({ body: 'man' }).key, 'male');
  // A look with no body is the seeded one normalizeLook picks.
  assert.equal(bodyKeyFor(null, 'some-seed'), normalizeLook(null, 'some-seed').body === 'man' ? 'male' : 'female');
});

test('skin tone: the texture skin times the multiplier is the look’s own skin colour', () => {
  for (const [body, key] of [['woman', 'female'], ['man', 'male']] as const) {
    for (const skin of ['#e0ac7e', '#7a4a2c', '#3f2416']) {
      const tint = bodyTint({ body, skin });
      close(tint.skin.map((value, index) => value * BODY_MANIFEST.bodies[key].skinRef[index]!), linear(skin), `${body} ${skin}`);
    }
  }
  // Darker saved skin, smaller multiplier, channel by channel.
  const light = bodyTint({ body: 'woman', skin: '#e0ac7e' }).skin, dark = bodyTint({ body: 'woman', skin: '#3f2416' }).skin;
  assert.ok(dark.every((value, index) => value < light[index]!));
});

test('outfit, bottoms and hair colours go to their regions; shoes are fixed', () => {
  const look = { body: 'man', outfitColor: '#2f6fbf', bottomsColor: '#c9372c', hairColor: '#1b1b1b' };
  const read = normalizeLook(look), tint = bodyTint(look);
  close(tint.top, linear(read.outfitColor), 'top');
  close(tint.bottoms, linear(read.bottomsColor), 'bottoms');
  close(tint.hair, linear(read.hairColor), 'hair');
  close(tint.shoes, linear(SHOES), 'shoes');
});

test('a seeded (unsaved) look maps the same way every time', () => {
  assert.deepEqual(bodyTint(undefined, 'player-7'), bodyTint(undefined, 'player-7'));
});
