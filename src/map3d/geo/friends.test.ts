// Friends on the country and world map: grouping, the privacy of a place, the founder's case, and where "Show on map" goes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeOf, byCountry, friendsModel, routeToFriend } from './friends.ts';
import { freshLive } from '../../game/live-model.ts';
import type { LiveSpot } from '../../types/live.ts';

const NOW = 1_000_000;
const names = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bola' }, { id: 'c', name: 'Chidi' }, { id: 'd', name: 'Dayo' }, { id: 'e', name: 'Emeka' }, { id: 'auto', name: 'Auto Friend' }];
function table(spots: LiveSpot[]) { const live = freshLive(); for (const spot of spots) live.friends.set(spot.id, spot); return live; }
const online = (id: string, cityId: string, extra: Partial<LiveSpot> = {}): LiveSpot => ({ id, status: 'online', cityId, ...extra });

test('friends are grouped by city, the connected first, and a city is judged against the reader\'s own', () => {
  const live = table([online('a', 'ibadan', { venue: 'agodi-gardens' }), online('b', 'ibadan', { venue: 'home' }), online('c', 'lagos', { venue: 'park' }), { id: 'd', status: 'offline', seenAt: NOW - 90_000 }, { id: 'e', status: 'reconnecting', seenAt: NOW - 3000 }]);
  const model = friendsModel({ friends: names, table: live, now: NOW, viewerCity: 'lagos' });
  assert.deepEqual(model.cities.map((group) => [group.cityId, group.friends.map((item) => item.name), group.online]), [['ibadan', ['Ada', 'Bola'], true], ['lagos', ['Chidi'], true]]);
  // Another city: the city only, never a venue of it; your own city: the venue, and a home reads as a home.
  assert.deepEqual(model.cities[0]!.friends.map((item) => item.venue), [undefined, undefined]);
  assert.deepEqual(model.cities[1]!.friends.map((item) => item.venue), ['park']);
  const inIbadan = friendsModel({ friends: names, table: live, now: NOW, viewerCity: 'ibadan' });
  assert.deepEqual(inIbadan.cities.find((group) => group.cityId === 'ibadan')!.friends.map((item) => [item.name, item.venue]), [['Ada', 'agodi-gardens'], ['Bola', 'home']]);
  // Offline and reconnecting friends have no place at all.
  assert.deepEqual(model.offline.map((item) => [item.name, item.online, item.seenAt]), [['Dayo', false, NOW - 90_000], ['Emeka', false, NOW - 3000]]);
  assert.ok(!JSON.stringify(model.offline).includes('lagos') && !JSON.stringify(model.offline).includes('ibadan'));
});

test('a friend the live frames carry no spot for is not on the map: the founder\'s automatic friends are never in them', () => {
  const live = table([online('a', 'ibadan')]);
  const model = friendsModel({ friends: names, table: live, now: NOW, viewerCity: 'lagos' });
  const everyone = [...model.cities.flatMap((group) => group.friends), ...model.offline].map((item) => item.id);
  assert.deepEqual(everyone, ['a'], 'five friends without a spot, among them the automatic one, are absent');
  assert.deepEqual(friendsModel({ friends: names, table: freshLive(), now: NOW, viewerCity: 'lagos' }), { cities: [], offline: [] });
});

test('a visit to a friend\'s home shows no venue, and a trip between cities is a connected friend in the city they left', () => {
  const live = table([online('a', 'lagos', { venue: 'visit' }), online('b', 'lagos', { journey: { to: 'ibadan', mode: 'road', startedAt: NOW - 1000, duration: 60 } })]);
  const model = friendsModel({ friends: names, table: live, now: NOW, viewerCity: 'lagos' });
  assert.deepEqual(model.cities[0]!.friends.map((item) => [item.name, item.venue, item.journey]), [['Ada', undefined, undefined], ['Bola', undefined, 'ibadan']]);
});

test('the badge: up to three initials, the count of everyone, and a green ring when any is connected', () => {
  const live = table([online('a', 'ibadan'), online('b', 'ibadan'), online('c', 'ibadan'), online('d', 'ibadan')]);
  const group = friendsModel({ friends: names, table: live, now: NOW, viewerCity: 'lagos' }).cities[0]!;
  assert.deepEqual(badgeOf(group.friends), { initials: ['A', 'B', 'C'], count: 4, online: true });
  assert.equal(badgeOf([{ id: 'x', name: 'Xi', initial: 'X', online: false }]).online, false);
});

test('further out the groups gather by country; a city with no known country is left out', () => {
  const live = table([online('a', 'ibadan'), online('b', 'lagos'), online('c', 'nowhere')]);
  const model = friendsModel({ friends: names, table: live, now: NOW, viewerCity: 'lagos' });
  const countries = byCountry(model, (city) => (city === 'nowhere' ? null : 'ng'));
  assert.deepEqual(countries.map((group) => [group.countryId, group.cityIds.sort(), group.friends.map((item) => item.name)]), [['ng', ['ibadan', 'lagos'], ['Ada', 'Bola']]]);
});

test('Show on map: the same city goes to the venue, another city to the country map with the badge open, an offline friend nowhere', () => {
  const live = table([online('a', 'lagos', { venue: 'park' }), online('b', 'lagos', { venue: 'home' }), online('c', 'ibadan', { venue: 'agodi-gardens' }), { id: 'd', status: 'offline' }]);
  const model = friendsModel({ friends: names, table: live, now: NOW, viewerCity: 'lagos' });
  assert.deepEqual(routeToFriend(model, 'a', 'lagos'), { layer: 'city', destination: 'park' });
  assert.deepEqual(routeToFriend(model, 'b', 'lagos'), { layer: 'world', city: 'lagos', friends: true }, 'a home is never a place to centre on');
  assert.deepEqual(routeToFriend(model, 'c', 'lagos'), { layer: 'world', city: 'ibadan', friends: true });
  assert.equal(routeToFriend(model, 'd', 'lagos'), null);
  assert.equal(routeToFriend(model, 'nobody', 'lagos'), null);
});
