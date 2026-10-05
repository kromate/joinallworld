// OWNER: world — other players on the city map (src/map3d/people.ts): where a pin is at a server time, how
// friends at one venue share a pin, and the bound on how many are drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PINS, pinsOf, tripProgress } from './people.ts';
import type { MapPerson, PinWorld } from './people.ts';
import { buildNetwork } from './roads.ts';
import { tripPose } from './trip.ts';
import { loadCityPack } from './regions.ts';

const T = 2_000_000;
const SPOTS: Record<string, { x: number; z: number }> = { park: { x: 0, z: 0 }, library: { x: 100, z: 0 }, market: { x: 0, z: 50 } };
/** A world with three places and no roads: a trip is a straight line. */
const flat: PinWorld = { place: (id) => SPOTS[id] ?? null, route: () => null, name: (id) => ({ park: 'Freedom Park' })[id] ?? id };
const person = (id: string, extra: Partial<MapPerson>): MapPerson => ({ id, name: id.toUpperCase(), initial: id[0]!.toUpperCase(), hue: 10, ...extra });
const walk = (from: string, to: string, startedAt = T, duration = 100) => ({ from, to, mode: 'trek', startedAt, duration });

test('a trip is placed from the clock alone: at the start, part of the way, and at the door when the time is up', () => {
  assert.deepEqual([tripProgress(walk('a', 'b'), T - 5), tripProgress(walk('a', 'b'), T + 25_000), tripProgress(walk('a', 'b'), T + 500_000)], [0, 0.25, 1]);
  const people = { people: [person('ada', { trip: walk('park', 'library') })], counts: {} };
  const at = (now: number) => pinsOf(people, now, flat);
  const start = at(T), mid = at(T + 25_000), late = at(T + 99_000), done = at(T + 100_000);
  assert.deepEqual([start.pins[0]?.x, start.pins[0]?.z, start.moving], [0, 0, true]);
  assert.deepEqual([mid.pins[0]?.x, mid.pins[0]?.z, mid.pins[0]?.moving, mid.pins[0]?.venue], [25, 0, true, null]);
  assert.ok((late.pins[0]?.x ?? 0) > 98 && (late.pins[0]?.x ?? 0) < 100);
  assert.deepEqual([done.pins[0]?.x, done.pins[0]?.venue, done.pins[0]?.moving, done.moving], [100, 'library', false, false], 'arrived: standing at the venue, and nothing is moving any more');
  assert.equal(mid.pins[0]?.key, done.pins[0]?.key, 'the same pin all the way: it does not blink at the door');
  assert.match(mid.pins[0]?.title ?? '', /ADA, on the way to library/);
  // It never goes backwards as time passes.
  let last = -1;
  for (let ms = 0; ms <= 100_000; ms += 2500) { const x = at(T + ms).pins[0]?.x ?? 0; assert.ok(x >= last); last = x; }
});

test('a friend\'s trip follows the same road route the map draws for the player\'s own trip', async () => {
  const pack = await loadCityPack('lagos');
  assert.ok(pack);
  const network = buildNetwork(pack);
  const route = network.route('park', 'library');
  assert.ok(route && route.points.length > 2, 'the park and the library are joined by roads');
  const world: PinWorld = { place: (id) => { const place = network.places[id]; return place ? { x: place.door.x, z: place.door.z } : null; }, route: (from, to) => network.route(from, to) };
  const people = { people: [person('ada', { trip: { ...walk('park', 'library'), mode: 'keke' } })], counts: {} };
  for (const share of [0.1, 0.4, 0.75]) {
    const pin = pinsOf(people, T + share * 100_000, world).pins[0], own = tripPose(route, share, 'keke');
    assert.deepEqual([pin?.x, pin?.z], [own.x, own.z], `at ${share}`);
  }
});

test('a home is not a place on anyone else\'s map: leaving home shows at the destination, going home stays put and then is gone', () => {
  const out = { people: [person('ada', { trip: walk('home', 'library') })], counts: {} };
  assert.deepEqual(pinsOf(out, T + 10_000, flat).pins.map((pin) => [pin.venue, pin.x, pin.moving]), [['library', 100, false]]);
  const back = { people: [person('ada', { trip: walk('park', 'home') })], counts: {} };
  assert.deepEqual(pinsOf(back, T + 10_000, flat).pins.map((pin) => [pin.venue, pin.x]), [['park', 0]]);
  assert.equal(pinsOf(back, T + 10_000, flat).moving, true, 'still checked until the trip is over');
  assert.deepEqual(pinsOf(back, T + 100_000, flat), { pins: [], moving: false });
  assert.deepEqual(pinsOf({ people: [person('ada', { venue: 'home' }), person('bo', { venue: 'nowhere' })], counts: {} }, T, flat).pins, []);
});

test('friends at one venue share a pin, other players are a number, and the pool is bounded', () => {
  const drawn = pinsOf({ people: [person('ada', { venue: 'park' }), person('bo', { venue: 'park' }), person('cy', { venue: 'library' }), person('di', { venue: 'market' })], counts: { park: 1, library: 2, nowhere: 9 } }, T, flat);
  assert.deepEqual(drawn.pins.map((pin) => [pin.key, pin.kind, pin.text, pin.ids.length]), [['v:park', 'group', '3 here', 2], ['p:cy', 'friend', 'CY +2', 1], ['p:di', 'friend', 'DI', 1]]);
  assert.equal(drawn.pins[0]?.title, 'ADA, BO and 1 other player at Freedom Park');
  assert.equal(drawn.moving, false);
  // Venues with nobody the player knows: a count each, the busiest first.
  assert.deepEqual(pinsOf({ people: [], counts: { park: 1, library: 5, market: 0 } }, T, flat).pins.map((pin) => [pin.kind, pin.venue, pin.text, pin.ids]), [['count', 'library', '5 here', []], ['count', 'park', '1 here', []]]);

  const spots: Record<string, { x: number; z: number }> = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`v${i}`, { x: i, z: 0 }]));
  const crowded: PinWorld = { place: (id) => spots[id] ?? null, route: () => null };
  const many = pinsOf({ people: Array.from({ length: 60 }, (_, i) => person(`f${i}`, i % 2 ? { venue: `v${i}` } : { trip: walk(`v${i}`, `v${(i + 1) % 60}`) })), counts: Object.fromEntries(Object.keys(spots).map((id) => [id, 3])) }, T + 1000, crowded);
  assert.equal(many.pins.length, MAX_PINS);
  assert.ok(many.pins.every((pin) => pin.kind !== 'count'), 'friends come before counts when there is not room for both');
});
