import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLook } from './avatar-look.ts';
import { normalizeLook as normalizeThroughCharacters } from './characters.ts';

test('the shared look normalizer preserves legacy fields and its characters.ts API', () => {
  const input = {
    gender: 'FEMALE', hairstyle: 'lowcut', skinTone: 'skin-7', outfit: 'smart', fabric: 'Asoke',
    face: 'ROUND', expression: 'GRIN', accessories: ['glasses', 'sunglasses', 'chain', 'watch', 'backpack', 'unknown'],
  };
  const expected = {
    body: 'woman', hair: 'lowcut', outfit: 'office', fabric: 'asooke', skin: '#3f2416', hairColor: '#3d2a1f',
    outfitColor: '#3f9a5a', bottomsColor: '#c9423a', accessories: ['glasses', 'chain', 'watch', 'backpack'],
    face: 'round', expression: 'grin',
  };
  assert.deepEqual(normalizeLook(input, ' legacy id '), expected);
  assert.deepEqual(normalizeThroughCharacters(input, ' legacy id '), expected);
});

test('the shared look normalizer keeps seeded defaults and appearance extensions', () => {
  const look = normalizeLook({ wearables: ['gele-fan', 'sneakers', 'agbada'], appearance: { height: 'tall', build: 'slim', ageAppearance: 'mature' } }, 'wearable-seed');
  assert.deepEqual(look, {
    body: 'woman', hair: 'bun', outfit: 'office', fabric: 'plain', skin: '#b0764d', hairColor: '#2b2320',
    outfitColor: '#3f72c4', bottomsColor: '#e0822f', accessories: [], face: 'oval', expression: 'smile',
    wearables: ['gele-fan', 'sneakers', 'agbada'], appearance: { height: 'tall', build: 'slim', ageAppearance: 'mature' },
  });
});
