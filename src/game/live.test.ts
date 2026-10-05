// OWNER: social — the browser's model of live location (src/game/live-model.ts): what a spot reads as at a given
// server time, what the lists are written with, and who is drawn on the map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWhereabouts, crowdWords, freshLive, LIVE_GRACE_MS, mapPeople, MAP_FRIENDS, othersAt, takeMove, takeSnapshot, whereabouts } from './live-model.ts';
import { presenceText } from './social-model.ts';
import type { LiveSpot } from '../types/live.ts';
import type { Whereabouts } from '../types/social.ts';

const T = 1_000_000;
const trip = (to: string, startedAt = T, duration = 60, from = 'park') => ({ from, to, mode: 'keke', startedAt, duration });
const look = (person: { id: string; name: string }) => ({ initial: person.name[0] ?? '?', hue: person.id.length });

test('a snapshot replaces the table; a move changes only what it names; junk is ignored', () => {
  const table = freshLive();
  takeSnapshot(table, { at: T, city: { cityId: 'lagos', venues: { park: 2 }, moving: 0 }, friends: [{ id: 'a', status: 'online', cityId: 'lagos', venue: 'park' }, { id: 'b', status: 'offline' }] });
  assert.deepEqual([...table.friends.keys()], ['a', 'b']);
  assert.deepEqual(takeMove(table, { at: T + 1, spots: [{ id: 'a', status: 'online', cityId: 'lagos', trip: trip('library') }, null as unknown as LiveSpot, { status: 'online' } as unknown as LiveSpot] }), ['a']);
  assert.equal(table.friends.get('a')?.trip?.to, 'library');
  assert.equal(table.friends.get('b')?.status, 'offline', 'a friend the move does not name is untouched');
  assert.deepEqual(table.city, { cityId: 'lagos', venues: { park: 2 }, moving: 0 }, 'a move without counts keeps them');
  takeMove(table, { at: T + 2, city: { cityId: 'lagos', venues: {}, moving: 1 } });
  assert.deepEqual([table.city?.moving, table.at], [1, T + 2]);
  takeSnapshot(table, { at: T + 3, city: null, friends: [] });
  assert.deepEqual([table.friends.size, table.city], [0, null]);
});

test('what a spot reads as, by the server clock: on the way, then at the door; reconnecting, then offline', () => {
  const going: LiveSpot = { id: 'a', status: 'online', cityId: 'lagos', trip: trip('library') };
  assert.deepEqual(whereabouts(going, T + 59_999), { status: 'away', cityId: 'lagos', going: 'library' });
  assert.deepEqual(whereabouts(going, T + 60_000), { status: 'online', cityId: 'lagos', venue: 'library' }, 'the trip is over when the server\'s timer is, with no further frame');
  assert.deepEqual(whereabouts({ id: 'a', status: 'online', cityId: 'lagos', journey: { to: 'ibadan', mode: 'road', startedAt: T, duration: 120 } }, T), { status: 'away', cityId: 'lagos', journey: 'ibadan' });
  assert.deepEqual(whereabouts({ id: 'a', status: 'online', cityId: 'lagos', venue: 'home' }, T), { status: 'online', cityId: 'lagos', venue: 'home' });
  assert.deepEqual(whereabouts({ id: 'a', status: 'online', cityId: 'lagos' }, T), { status: 'away', cityId: 'lagos' }, 'connected, between places');
  const gone: LiveSpot = { id: 'a', status: 'reconnecting', seenAt: T };
  assert.deepEqual(whereabouts(gone, T + LIVE_GRACE_MS - 1), { status: 'reconnecting', seenAt: T });
  assert.deepEqual(whereabouts(gone, T + LIVE_GRACE_MS), { status: 'offline', seenAt: T });
  assert.deepEqual(whereabouts({ id: 'a', status: 'offline' }, T), { status: 'offline' });
});

test('writing whereabouts over a friend row removes what is no longer true and keeps everything else', () => {
  const row: Whereabouts & { id: string; name: string; since: number } = { id: 'a', name: 'Ada', since: 5, status: 'online', cityId: 'lagos', venue: 'park', seenAt: 3 };
  assert.equal(applyWhereabouts(row, { status: 'away', cityId: 'lagos', going: 'library' }), true);
  assert.deepEqual(row, { id: 'a', name: 'Ada', since: 5, status: 'away', cityId: 'lagos', going: 'library' });
  assert.equal(applyWhereabouts(row, { status: 'away', cityId: 'lagos', going: 'library' }), false, 'the same again changes nothing');
  applyWhereabouts(row, { status: 'offline', seenAt: 9 });
  assert.deepEqual(row, { id: 'a', name: 'Ada', since: 5, status: 'offline', seenAt: 9 });
});

test('the words: on the way, travelling, and a friend in another city is "in <city>" with no venue of it', () => {
  const venue = (id: string) => ({ library: 'Herbert Macaulay Library', park: 'Freedom Park' })[id] ?? id, place = { cityId: 'lagos', cityName: (id: string) => ({ ibadan: 'Ibadan', lagos: 'Lagos' })[id] ?? id };
  assert.equal(presenceText({ status: 'away', cityId: 'lagos', going: 'library' }, venue, T, place), 'On the way to Herbert Macaulay Library');
  assert.equal(presenceText({ status: 'away', cityId: 'lagos', going: 'home' }, venue, T, place), 'On the way home');
  assert.equal(presenceText({ status: 'away', cityId: 'lagos', journey: 'ibadan' }, venue, T, place), 'Travelling to Ibadan');
  assert.equal(presenceText({ status: 'online', cityId: 'ibadan', venue: 'agodi-gardens' }, venue, T, place), 'Online · in Ibadan');
  assert.equal(presenceText({ status: 'away', cityId: 'ibadan', going: 'bodija' }, venue, T, place), 'On the move in Ibadan');
  assert.equal(presenceText({ status: 'online', cityId: 'lagos', venue: 'park' }, venue, T, place), 'Online · Freedom Park');
  assert.equal(presenceText({ status: 'online', cityId: 'lagos', venue: 'home' }, venue, T, place), 'Online · at home');
  assert.equal(presenceText({ status: 'online', cityId: 'lagos', venue: 'park' }, venue, T), 'Online · Freedom Park', 'without a place nothing changes');
});

test('who is drawn on the map: friends of this city at a venue or on a trip — never at home, in another city, or offline', () => {
  const table = freshLive();
  takeSnapshot(table, { at: T, city: { cityId: 'lagos', venues: { park: 4, library: 1, market: 2 }, moving: 1 }, friends: [
    { id: 'park-1', status: 'online', cityId: 'lagos', venue: 'park' },
    { id: 'park-2', status: 'online', cityId: 'lagos', venue: 'park' },
    { id: 'home', status: 'online', cityId: 'lagos', venue: 'home' },
    { id: 'visit', status: 'online', cityId: 'lagos', venue: 'visit' },
    { id: 'trip', status: 'online', cityId: 'lagos', trip: trip('library') },
    { id: 'done', status: 'online', cityId: 'lagos', trip: trip('market', T - 100_000, 60) },
    { id: 'ibadan', status: 'online', cityId: 'ibadan', venue: 'agodi-gardens' },
    { id: 'leaving', status: 'online', cityId: 'lagos', journey: { to: 'ibadan', mode: 'road', startedAt: T, duration: 120 } },
    { id: 'gone', status: 'reconnecting', seenAt: T },
    { id: 'between', status: 'online', cityId: 'lagos' },
  ] });
  const friends = [...table.friends.keys(), 'unknown'].map((id) => ({ id, name: `N-${id}` }));
  const drawn = mapPeople({ table, friends, cityId: 'lagos', here: 'park', now: T + 1000, look });
  assert.deepEqual(drawn.people.map((person) => [person.id, person.venue ?? `→${person.trip?.to}`]), [['trip', '→library'], ['done', 'market'], ['park-1', 'park'], ['park-2', 'park']], 'travellers first, then by name');
  assert.deepEqual(drawn.people[0], { id: 'trip', name: 'N-trip', initial: 'N', hue: 4, trip: trip('library') });
  // Others: the city's count, less the friends the server counted there and less the player standing there.
  assert.deepEqual(drawn.counts, { park: 1, library: 1, market: 2 }, 'the friend who has only just arrived by the clock is not yet in the server\'s count');
  assert.deepEqual(othersAt(table, 'lagos', null), { park: 4, library: 1, market: 2 });
  assert.deepEqual(othersAt(table, 'ibadan', null), {}, 'counts of another city are not this city\'s');
  assert.deepEqual(crowdWords(drawn, T + 1000), { park: 'N-park-1, N-park-2 +1 here', library: '1 here', market: 'N-done +2 here' });

  // The cap: however many friends there are, the map is handed at most MAP_FRIENDS of them.
  const many = freshLive();
  takeSnapshot(many, { at: T, city: null, friends: Array.from({ length: 80 }, (_, i) => ({ id: `f${i}`, status: 'online' as const, cityId: 'lagos', venue: 'park' })) });
  assert.equal(mapPeople({ table: many, friends: [...many.friends.keys()].map((id) => ({ id, name: id })), cityId: 'lagos', here: null, now: T, look }).people.length, MAP_FRIENDS);
});
