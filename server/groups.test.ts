// The room-group rules (server/ws/groups.ts): who is placed with whom, and when a small group is merged away. Pure: no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newVenue, place, planMerge, seat, unseat } from './ws/groups.ts';
import type { MergeFacts, Venue, Wish } from './ws/groups.ts';
import { ROOM_GROUP_DEFAULTS, groupHeader, groupNotice } from '../src/game/roomGroups.ts';

const limits = { target: 4, max: 6, min: 2 };
const names = (count: number, prefix = 'p'): string[] => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
/** A venue with groups of the given sizes: g1 holds a0.., g2 holds b0.. */
function venueOf(...sizes: number[]): Venue {
  const venue = newVenue();
  sizes.forEach((size, index) => { const first = seat(venue, `${String.fromCharCode(97 + index)}0`); for (const id of names(size, String.fromCharCode(97 + index)).slice(1)) seat(venue, id, first.id); });
  return venue;
}
const wish = (patch: Partial<Wish> = {}): Wish => ({ player: 'me', friends: new Set(), follow: null, previous: null, blocked: () => false, ...patch });
const sizeOf = (venue: Venue, id: string | null): number => (id ? venue.groups.get(id)?.players.size ?? 0 : 0);

test('the defaults are about 12 with a hard maximum of 16 and a minimum of 4', () => {
  assert.deepEqual(ROOM_GROUP_DEFAULTS, { target: 12, max: 16, min: 4 });
});

test('a stranger goes to the fullest group that has room, so groups feel alive; a new group when every group is full', () => {
  const venue = venueOf(2, 3, 4);
  const got = place(venue, limits, wish());
  assert.equal(got.why, 'fullest');
  assert.equal(got.group, 'g2', 'the group of three is fuller than the group of two, and the group of four is full for strangers');
  const full = venueOf(4, 5);
  assert.deepEqual(place(full, limits, wish()), { group: null, why: 'new', apart: null }, 'at the target is full for a stranger');
  assert.deepEqual(place(newVenue(), limits, wish()), { group: null, why: 'new', apart: null }, 'an empty venue starts the first group');
});

test('somebody they came to be with comes first, then a mutual friend, then the group they were in a moment ago', () => {
  const venue = venueOf(2, 3, 4);
  assert.deepEqual(place(venue, limits, wish({ follow: 'a1', friends: new Set(['b0']), previous: 'g3' })), { group: 'g1', why: 'follow', apart: null }, 'the pinger beats a friend elsewhere and the old group');
  assert.deepEqual(place(venue, limits, wish({ friends: new Set(['a0']), previous: 'g3' })), { group: 'g1', why: 'friend', apart: null }, 'a friend beats the fullest group');
  assert.deepEqual(place(venue, limits, wish({ previous: 'g1' })), { group: 'g1', why: 'previous', apart: null }, 'a reload goes back where it was');
  assert.equal(place(venue, limits, wish({ previous: 'g9' })).why, 'fullest', 'a group that is gone is not returned to');
  const most = place(venue, limits, wish({ friends: new Set(['a0', 'b0', 'b1']) }));
  assert.equal(most.group, 'g2', 'the group with the most of their friends');
});

test('friends are kept together past the maximum by two, and no further: then the friend is named as apart', () => {
  const venue = venueOf(5, 6, 7);
  assert.deepEqual(place(venue, limits, wish({ friends: new Set(['b0']) })), { group: 'g2', why: 'friend', apart: null }, 'a group at the maximum still takes a friend');
  assert.equal(place(venue, limits, wish({ friends: new Set(['c0']) })).group, 'g3', 'one more past the maximum');
  const past = seat(venue, 'c7', 'g3'); assert.equal(past.players.size, 8, 'two over the maximum');
  const got = place(venue, limits, wish({ friends: new Set(['c0']) }));
  assert.equal(got.apart, 'c0', 'the friend is in another part of the venue');
  assert.notEqual(got.group, 'g3');
  assert.equal(got.why, 'new', 'every other group is at or above the target');
  const follow = place(venue, limits, wish({ follow: 'c0' }));
  assert.equal(follow.apart, 'c0', 'a ping join into a group that cannot take one more says so too');
});

test('a block is never a reason to be placed anywhere, and a group with a blocked person is the last choice', () => {
  const venue = venueOf(3, 2);
  const blocked = (a: string, b: string): boolean => (a === 'me' && b === 'a0') || (a === 'a0' && b === 'me');
  assert.equal(place(venue, limits, wish({ blocked })).group, 'g2', 'the fuller group holds someone blocked: the other one is chosen');
  assert.equal(place(venue, limits, wish({ blocked, friends: new Set(['a0']) })).group, 'g2', 'a blocked "friend" does not draw them in');
  assert.equal(place(venue, limits, wish({ blocked, follow: 'a0' })).group, 'g2', 'nor does a blocked pinger');
  const only = venueOf(3);
  assert.equal(place(only, limits, wish({ blocked })).group, 'g1', 'when every group holds one, the pair may share a group by chance, as before');
});

const facts = (patch: Partial<MergeFacts> = {}): MergeFacts => ({ seated: () => false, voice: () => false, chatting: () => false, together: () => false, blocked: () => false, voiceCap: 8, ...patch });
const group = (venue: Venue, id: string) => { const found = venue.groups.get(id); if (!found) throw new Error(`no group ${id}`); return found; };

test('a group below the minimum is merged into the fullest group it fits in', () => {
  const venue = venueOf(1, 2, 3);
  const plan = planMerge(venue, limits, group(venue, 'g1'), facts());
  assert.deepEqual(plan, { from: 'g1', to: 'g3', movers: ['a0'] });
  const none = venueOf(1, 4);
  assert.equal(planMerge(none, limits, group(none, 'g1'), facts()), null, 'the only other group is at the target: the merge waits for room');
});

test('a merge never splits a unit: a seated player stays, and so does everyone tied to them', () => {
  const venue = venueOf(3, 2);
  const seated = planMerge(venue, { ...limits, min: 4 }, group(venue, 'g1'), facts({ seated: (id) => id === 'a1' }));
  assert.deepEqual(seated?.movers, ['a0', 'a2'], 'only the seated player stays');
  const tied = planMerge(venue, { ...limits, min: 4 }, group(venue, 'g1'), facts({ seated: (id) => id === 'a1', together: (a, b) => [a, b].sort().join() === 'a0,a1' }));
  assert.deepEqual(tied?.movers, ['a2'], 'a friend standing with the seated player does not move without them');
  const circle = planMerge(venue, { ...limits, min: 4 }, group(venue, 'g1'), facts({ seated: (id) => id === 'a2', voice: (id) => id === 'a0' || id === 'a2' }));
  assert.deepEqual(circle?.movers, ['a1'], 'one voice circle moves whole or not at all');
  const allSeated = planMerge(venue, { ...limits, min: 4 }, group(venue, 'g1'), facts({ seated: () => true }));
  assert.equal(allSeated, null);
});

test('a merge keeps the voice circle within its cap and never brings a blocked pair together', () => {
  const venue = venueOf(2, 3);
  const small = group(venue, 'g1'), roomy = { ...limits, target: 5 };
  assert.equal(planMerge(venue, roomy, small, facts({ voice: () => true, voiceCap: 4 }))?.to, undefined, '2 + 3 in voice is over a cap of 4');
  assert.equal(planMerge(venue, roomy, small, facts({ voice: () => true, voiceCap: 5 }))?.to, 'g2');
  assert.equal(planMerge(venue, roomy, small, facts({ blocked: (a, b) => a === 'a0' && b === 'b1' })), null, 'a0 has blocked someone in the only other group');
});

test('seating and unseating keep the venue\'s books: an empty group goes, a woken host\'s groups keep their names', () => {
  const venue = newVenue();
  assert.equal(seat(venue, 'x').id, 'g1');
  assert.equal(seat(venue, 'y', 'g7').id, 'g7', 'a named group that is not there is made (a Worker that woke)');
  assert.equal(seat(venue, 'z').id, 'g8', 'and the next new group does not reuse a number');
  assert.equal(unseat(venue, 'y')?.id, 'g7');
  assert.equal(venue.groups.has('g7'), false);
  assert.equal(unseat(venue, 'nobody'), undefined);
  assert.equal(sizeOf(venue, 'g1'), 1);
});

test('the words: the header says who is here with you and how many are in the place, and a move is said calmly', () => {
  assert.equal(groupHeader({ here: 13, total: 128 }), '12 here with you · 128 in this place');
  assert.equal(groupHeader({ here: 3, total: 3 }), '2 here with you');
  assert.equal(groupHeader({ here: 1, total: 1 }), 'Nobody else here with you');
  assert.equal(groupHeader(null), '');
  assert.equal(groupNotice(10), 'You are now with 9 others.');
  assert.equal(groupNotice(2), 'You are now with 1 other.');
});
