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

// ---- Old saves: every look a save has ever held maps onto the body, and nothing in one can break it. ----------------

const finite = (tint: ReturnType<typeof bodyTint>) =>
  [tint.skin, tint.top, tint.bottoms, tint.hair, tint.shoes].every((rgb) => rgb.length === 3 && rgb.every((value) => Number.isFinite(value) && value >= 0));

test('old saves: legacy keys (gender, skinTone) pick the same body and skin as today’s', () => {
  for (const [gender, key] of [['female', 'female'], ['male', 'male'], ['F', 'female'], ['m', 'male'], ['girl', 'female'], ['boy', 'male']] as const) {
    assert.equal(bodyKeyFor({ gender }), key, `gender ${gender}`);
  }
  assert.deepEqual(bodyTint({ gender: 'male', skinTone: '#7a4a2c' }), bodyTint({ body: 'man', skin: '#7a4a2c' }));
  // When both are present, today's key wins.
  assert.equal(bodyKeyFor({ body: 'woman', gender: 'male' }), 'female');
});

test('old saves: named and numbered swatches (skin1…skin7, palette indexes) read as their colours', () => {
  close(bodyTint({ body: 'woman', skin: 'skin5' }).skin, bodyTint({ body: 'woman', skin: '#7a4a2c' }).skin, 'game skin id');
  close(bodyTint({ body: 'woman', skinTone: 'skin1' }).skin, bodyTint({ body: 'woman', skin: '#e0ac7e' }).skin, 'legacy key + id');
  const indexed = bodyTint({ body: 'man', outfitColor: 0 }), named = normalizeLook({ body: 'man', outfitColor: 0 });
  close(indexed.top, linear(named.outfitColor), 'palette index');
  // Upper case and stray spaces in a saved hex are the same colour.
  assert.deepEqual(bodyTint({ body: 'man', hairColor: ' #1B1B1B ' }).hair, bodyTint({ body: 'man', hairColor: '#1b1b1b' }).hair);
});

test('old saves: missing fields take the seed’s, so a half-filled look is stable and complete', () => {
  const partial = bodyTint({ body: 'man' }, 'p-42');
  assert.equal(partial.key, 'male');
  assert.ok(finite(partial));
  assert.deepEqual(bodyTint({ body: 'man' }, 'p-42'), partial, 'same look, same seed, same body');
  // An empty look is "no look": the seeded one.
  assert.deepEqual(bodyTint({}, 'p-42'), bodyTint(null, 'p-42'));
  assert.deepEqual(bodyTint(undefined, 'p-42'), bodyTint(null, 'p-42'));
});

test('old saves: junk never throws and always gives a body to draw', () => {
  const junk: unknown[] = [
    'woman', 42, true, [], ['man'], () => 1,
    { body: 7, skin: { r: 1 }, outfitColor: 'blue-ish', bottomsColor: -3, hairColor: null },
    { body: 'robot', skin: '#12345', outfitColor: 99, bottomsColor: 1.5, hairColor: '#zzzzzz' },
    { body: 'woman', skin: '', accessories: 'hat', unknownField: { deep: [1, 2] } },
    Object.create(null),
  ];
  junk.forEach((look, index) => {
    const tint = bodyTint(look, 'old-save');
    assert.ok(tint.key === 'male' || tint.key === 'female', `key for junk #${index}`);
    assert.ok(finite(tint), `finite colours for junk #${index}`);
  });
  // Unknown fields change nothing.
  assert.deepEqual(bodyTint({ body: 'woman', skin: '#7a4a2c', v: 1, legacy: true }), bodyTint({ body: 'woman', skin: '#7a4a2c' }));
});
