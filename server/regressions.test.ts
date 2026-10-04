// OWNER: server — behaviour the TypeScript conversion must keep from the JavaScript: each test pins one
// place where typed code once threw, or answered differently, for stored or client data of the wrong shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCreative } from './civic/ads.ts';
import { shoutBlock } from './civic/radio.ts';
import { sweep, LIMITS } from './growth/data.ts';
import { blockedCategory } from './moderation/text.ts';
import { AD_COLOURS, AD_ICONS, RADIO } from '../src/game/content/civic.ts';
import type { CivicCityRecord, GrowthCollection } from './types.ts';

test('validateCreative: a bad colour and a bad icon have their own codes', () => {
  const colour = AD_COLOURS[0]?.id, icon = AD_ICONS[0]?.id;
  assert.ok(colour && icon);
  assert.deepEqual(validateCreative({ text: 'Fresh bread today', colour, icon }), { ok: true, creative: { text: 'Fresh bread today', colour, icon } });
  assert.equal((validateCreative({ text: 'Fresh bread today', colour: 'plaid', icon }) as { code: string }).code, 'invalid_colour');
  assert.equal((validateCreative({ text: 'Fresh bread today', icon }) as { code: string }).code, 'invalid_colour');
  assert.equal((validateCreative({ text: 'Fresh bread today', colour, icon: 'skull' }) as { code: string }).code, 'invalid_icon');
  assert.equal((validateCreative({ text: 'Fresh bread today', colour }) as { code: string }).code, 'invalid_icon', 'a missing icon is an icon problem');
  assert.equal((validateCreative({ text: 'Fresh bread today', colour, icon: 7 }) as { code: string }).code, 'invalid_icon', 'a non-string icon is an icon problem');
});

test('sweep: a null share or player in stored data is swept, not thrown on', () => {
  const now = 10 * 86400000 * 100;
  const fresh = { at: now }, current = { seen: now };
  const g = { sweptAt: 0, shares: { gone: null, kept: fresh }, players: { gone: null, kept: current } } as unknown as GrowthCollection;
  sweep(g, now);
  assert.deepEqual(Object.keys(g.shares), ['kept']);
  assert.deepEqual(Object.keys(g.players), ['kept']);
  assert.ok(LIMITS.sweepMs > 0);
});

test('radio: a corrupt (non-array) queue counts as empty', () => {
  const venue = RADIO.venues[0];
  assert.ok(venue);
  const city = { radio: { queues: { [venue]: { length: 99 } }, daily: {} } } as unknown as CivicCityRecord;
  assert.equal(shoutBlock(city, Date.now(), 'p1', venue), null);
});

test('moderation: a blocked word keeps blocking by presence, and the first word of the list still answers its category', () => {
  assert.equal(blockedCategory('you nigger'), 'hate');
  assert.equal(blockedCategory('niggers'), 'hate', 'plurals still match');
  assert.equal(blockedCategory('a fine day'), null);
});
