// The crowd shown in a scene comes from real data only: server presence and the venue's regulars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crowdList, playersHere, CROWD_LIMIT } from './crowd.js';
import { MAX_CROWD } from './venue-scenes.js';
import { createLife, viewLife } from '../life.js';

const ME = '11111111-2222-4333-8444-555555555555';
const player = (n, more = {}) => ({ id: `0000000${n}-2222-4333-8444-555555555555`, name: `Player ${n}`, friend: false, ...more });

test('real players come first with their public id as seed and their look; regulars stand at their places', () => {
  assert.equal(CROWD_LIMIT, MAX_CROWD);
  const state = createLife({ location: 'amala-shitta' }, { now: Date.UTC(2026, 0, 5, 9), cityId: 'lagos' });
  const here = viewLife(state, { now: state.t, cityId: 'lagos' }).social.here;
  const look = { body: 'woman', hair: 'afro', outfit: 'casual', fabric: 'plain', skin: 'skin-3', hairColor: 'black', outfitColor: 'red', bottomsColor: 'navy' };
  const list = crowdList({ players: [player(1, { look }), player(2), { id: ME, name: 'Me' }, player(1), null, { name: 'no id' }, player(3, { here: false })], npcs: here, selfId: ME });
  assert.deepEqual(list.map((person) => [person.kind, person.name]), [['player', 'Player 1'], ['player', 'Player 2'], ['npc', 'Amaka'], ['npc', 'Baba Sege']]);
  assert.deepEqual([list[0].seed, list[0].look, list[1].look], [player(1).id, look, null], 'the public id seeds the avatar; an unknown look stays null and is derived from the seed');
  assert.deepEqual([list[2].id, list[2].spot, list[3].spot], ['npc:amaka', 'counter', 'table'], 'Amaka serves at the counter');
  assert.ok(!JSON.stringify(list).includes('friend'), 'nothing but id, name, kind, seed, look and place is passed to the scene');
});

test('the list is capped without crowding real players out, and only the current venue’s listing is used', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const list = crowdList({ players: many.slice(0, 11), npcs: [{ id: 'a', name: 'A', at: 'bar' }, { id: 'b', name: 'B' }] });
  assert.equal(list.length, MAX_CROWD); assert.equal(list.filter((person) => person.kind === 'player').length, 11);
  assert.equal(crowdList({ players: many }).length, MAX_CROWD);
  assert.deepEqual(crowdList(), []); assert.deepEqual(crowdList({ players: 'x', npcs: 5 }), []);
  const listing = { ok: true, cityId: 'lagos', venue: 'park', self: 'joined', players: [player(1)] };
  assert.equal(playersHere(listing, { location: 'park' }, 'lagos').length, 1);
  assert.deepEqual(playersHere(listing, { location: 'library' }, 'lagos'), [], 'a stale listing for another venue shows nobody');
  assert.deepEqual(playersHere(listing, { location: 'park' }, 'ibadan'), []);
  assert.deepEqual(playersHere(listing, { location: 'park', activeAction: { kind: 'travel' } }, 'lagos'), [], 'on the road nobody is with you');
  assert.deepEqual(playersHere({ error: 'x' }, { location: 'park' }, 'lagos'), []); assert.deepEqual(playersHere(null, { location: 'park' }, 'lagos'), []);
});
