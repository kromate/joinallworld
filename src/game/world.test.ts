import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: world — tests for venues, travel, roadside events, weather and illness.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife, spotsOf } from '../life.ts';
import { registerSystem, systems } from './registry.ts';
import { makeContext, isRecord } from './util.ts';
import { isOpen } from './clock.ts';
import { COMING_SOON, SCENE_KINDS, VENUE_CATEGORIES, GIG_DAILY_LIMIT, venueLabel } from './content/venues.ts';
import { contentFor } from './cities/runtime.ts';
import { VENUES, HOME_SPOTS } from './cities/lagos/venues.ts';

import { TRAVEL_MODES, ALL_MODES, DEFAULT_MODE, TRAVEL_DURATION } from './content/travel.ts';
import { EVENTS, EVENT_TTL_SECONDS, ACTIVITY_OUTCOMES } from './content/events.ts';
import { HEALTH } from './content/health.ts';
import { quote, routeBand, openingInfo, travelBlock, modesFor, isGig } from './systems/travel.ts';
import { weatherAt } from './systems/health.ts';
import type { ActionBody, ActionResult, ActionType } from '../types/actions.ts';
import type { ActivityDefinition } from '../types/content.ts';
import type { HouseId, LifeContextInit, LifeState, TravelModeId, VenueId } from '../types/life.ts';
import type { EngineEventMap, SavedInput, SystemDefinition } from '../types/registry.ts';

/** Narrows a lookup that must have found something. */
function need<T>(value: T | null | undefined, what = 'expected a value'): T { assert.ok(value, what); return value; }
/** The reason of a refused action ('' for a success or a refusal without one). */
const why = (result: { ok: boolean; reason?: string }): string => result.reason ?? '';
/** dispatch() with a payload the typed bodies would not allow: tests of hostile or malformed input. */
const hostile = <T extends ActionType>(state: LifeState, type: T, payload: unknown, ctx: LifeContextInit): ActionResult<T> => dispatch(state, { type, payload } as unknown as ActionBody<T>, ctx);

// A stand-in for other owners' systems: it contributes the modifiers the world systems call
// and records the events they emit. Registered after the built-in systems, as a real owner is.
const heard: [string, Record<string, unknown>][] = [];
/** A life as the test-only probe system sees it: its own slice, which the engine's types do not know. */
type ProbeLife = LifeState & { worldprobe: { car: boolean; halfFare: boolean; slow: boolean; comfy: boolean; junk: boolean } };
// The probe's id, state key and deliberately junk modifier results exist only in this test, so the definition crosses the registry boundary through one cast.
registerSystem({
  id: 'worldprobe', stateKeys: ['worldprobe'],
  sanitize(input: SavedInput, state: ProbeLife) { const p: Record<string, unknown> = isRecord(input.worldprobe) ? input.worldprobe : {}; state.worldprobe = { car: p.car === true, halfFare: p.halfFare === true, slow: p.slow === true, comfy: p.comfy === true, junk: p.junk === true }; },
  modifiers: {
    'travel.modes': (value: TravelModeId[], state: ProbeLife) => (state.worldprobe.junk ? ['car', 'jetpack', 7, 'car'] : state.worldprobe.car ? [...value, 'car'] : value),
    'travel.fare': (value: number, state: ProbeLife) => (state.worldprobe.halfFare ? value / 2 : value),
    'travel.duration': (value: number, state: ProbeLife) => (state.worldprobe.slow ? value * 2 : value),
    'travel.needCost': (value: Record<string, number>, state: ProbeLife) => (state.worldprobe.comfy ? { ...value, energy: 0, bogus: 5 } : value),
  },
  on: Object.fromEntries(['travel.arrived', 'venue.visited', 'illness.started', 'illness.cured', 'roadside.offered', 'roadside.resolved', 'startup.funded', 'weather.soaked']
    .map((name) => [name, (state: LifeState, data: object) => heard.push([name, { ...data }])])),
} as unknown as SystemDefinition);

const HOUR = 3600000;
const MONDAY_3AM = Date.UTC(2026, 0, 5, 2);   // Lagos is UTC+1
const MONDAY_NOON = Date.UTC(2026, 0, 5, 11);
const at = (now: number, seed = 'world') => makeContext({ now, cityId: 'lagos', seed });
/** First 20-minute block at or after `from` with the wanted sky. */
function skyTime(from: number, raining: boolean) { for (let t = from; ; t += 20 * 60000) if (weatherAt(t, 'lagos').raining === raining && weatherAt(t + 60000, 'lagos').raining === raining) return t; }
const DRY_NOON = skyTime(MONDAY_NOON, false);
const WET_NOON = skyTime(MONDAY_NOON, true);
const everyDef = () => Object.values(VENUES).flatMap((venue) => Object.values(venue.spots).flatMap((spot) => spot.activities.map((def) => ({ def, venue: venue.id, spot: spot.id }))));
/** Start a trip and settle it. Returns the state after arrival. */
function go(state: LifeState, id: VenueId, mode: TravelModeId, now: number, seed = 'trip') {
  const started = dispatch(state, { type: 'travel', payload: { id, mode } }, at(now, seed));
  assert.equal(started.ok, true, why(started));
  const seconds = need(state.activeAction).duration;
  advanceLife(state, seconds, at(now + seconds * 1000, seed));
  assert.equal(state.location, id);
  return state;
}
function run(state: LifeState, id: string, now: number, seed = 'act', choice?: string) {
  const started = dispatch(state, { type: 'activity', payload: { id, ...(choice ? { choice } : {}) } }, at(now, seed));
  if (!started.ok) return started;
  const seconds = need(state.activeAction).duration;
  advanceLife(state, seconds, at(now + seconds * 1000, seed));
  return started;
}

test('world systems are registered and survive hostile saves', () => {
  for (const id of ['travel', 'health']) {
    const system = systems().find(item => item.id === id);
    assert.ok(system, id);
    for (const junk of ['text', 7, [], { nested: { deep: true } }]) {
      const state = createLife({ [id]: junk }, at(MONDAY_NOON));
      for (const key of system.stateKeys) assert.notEqual(Reflect.get(state, key), junk, `${id}.${key} must be rebuilt, not copied`);
    }
  }
  const hostile = createLife({
    travel: { home: '__proto__', event: { id: 'constructor', at: 1 }, lastTrip: { mode: 'jetpack', from: 'park', to: 'moon' }, visited: ['park', 'park', 'moon', 5, { id: 'x' }], trips: -4,
      cooldowns: { 'buka-help': MONDAY_NOON + 9e12, chill: MONDAY_NOON + 5000, nope: 1, 'hub-pitch': 'soon' }, funded: 'yes', admin: true,
      gigs: { day: 3, count: -9e9 }, eventDays: { wallet: 'never', agbo: 5, constructor: 1 } },
    health: { sick: 'true', cause: 'curse', since: 'never', strain: 9e9, immuneUntil: 9e15, extra: 1 },
  }, at(MONDAY_NOON));
  assert.deepEqual(hostile.travel, { home: 'yaba', event: null, lastTrip: null, visited: ['park'], trips: 0, cooldowns: { 'buka-help': MONDAY_NOON + 300000 }, funded: false,
    gigs: { day: 0, count: 0 }, eventDays: {} });
  assert.deepEqual(createLife({ travel: { gigs: { day: 7, count: 99 }, eventDays: { wallet: 7 } } }, at(MONDAY_NOON)).travel.gigs, { day: 7, count: GIG_DAILY_LIMIT }, 'a saved count can never exceed the limit');
  assert.deepEqual(hostile.health, { sick: false, cause: null, since: null, strain: HEALTH.illness.neglectSeconds, immuneUntil: MONDAY_NOON + 7200000 });
  const sick = createLife({ health: { sick: true, cause: 'curse', since: MONDAY_NOON + HOUR } }, at(MONDAY_NOON));
  assert.deepEqual([sick.health.cause, sick.health.since], ['neglect', MONDAY_NOON], 'a future start time is pulled back to now');
  const state = createLife(null, at(MONDAY_NOON));
  assert.equal(advanceLife(state, 60, at(MONDAY_NOON + 60000)).ok, true);
  assert.equal(typeof viewLife(state, at(MONDAY_NOON)), 'object');
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(state)), at(MONDAY_NOON + 60000)), state, 'a valid state round-trips unchanged');
});

test('venue catalogue: 25 venues and the UNILAG campus with district, hours, scene kind, map position, spots and activities', () => {
  const ids: VenueId[] = ['home', 'park', 'library', 'amala-shitta', 'cchub', 'shrine', 'viewing-centre', 'market', 'i-fitness', 'office', 'quilox', 'canopy-walk', 'palms', 'beach',
    'hospital', 'salon', 'rooftop', 'police', 'church', 'mosque', 'radio', 'polling-unit', 'state-house', 'airport', 'refinery', 'unilag'];
  assert.deepEqual(Object.keys(VENUES).sort(), [...ids].sort());
  assert.deepEqual(Object.keys(COMING_SOON), [], 'nothing in Lagos is coming soon: the airport and the refinery are venues');
  const seen = new Set();
  for (const venue of Object.values(VENUES)) {
    assert.equal(VENUES[venue.id], venue);
    assert.ok(venue.label && venue.district && venue.icon && venue.description, venue.id);
    assert.ok(SCENE_KINDS.includes(venue.scene.kind), `${venue.id} scene kind`);
    assert.ok(['mainland', 'island', 'east'].includes(venue.zone), venue.id);
    assert.ok(venue.map.x >= 3 && venue.map.x <= 97 && venue.map.y >= 5 && venue.map.y <= 95, `${venue.id} on the map`);
    assert.ok(venue.id === 'home' || Object.hasOwn(VENUE_CATEGORIES, venue.category), `${venue.id} category`);
    assert.ok(venue.ambient.length >= 2, `${venue.id} ambient lines`);
    if (venue.hours) assert.ok(Number.isFinite(venue.hours.open) && Number.isFinite(venue.hours.close) && venue.hours.open !== venue.hours.close, `${venue.id} hours`);
    const own = Object.values(venue.spots).filter((spot) => !['people', 'work'].includes(spot.id));
    // The campus is a venue the size of a district: one spot per landmark (src/campus/unilag/layout.ts).
    assert.ok(own.length >= 3 && own.length <= (venue.id === 'unilag' ? 64 : 5), `${venue.id} has ${own.length} spots`);
    const defs = own.flatMap((spot) => spot.activities);
    assert.ok(venue.id === 'home' || defs.length >= 7, `${venue.id} has ${defs.length} activities`);
    for (const spot of own) { assert.equal(venue.spots[spot.id], spot); assert.ok(spot.label && spot.activities.length >= 1, `${venue.id}/${spot.id}`); }
    for (const def of defs) {
      assert.ok(!seen.has(def.id), `duplicate activity id ${def.id}`); seen.add(def.id);
      assert.ok(def.label && def.icon && def.duration >= 3 && def.duration <= 45, def.id);
      assert.ok(!def.unavailable, `${def.id} is playable`);
      assert.ok(def.beta === true || def.id === 'chill', `${def.id} must be marked beta unless fully specified`);
    }
  }
  // Mainland lies north of the lagoon, the island and Lekki south of it.
  for (const venue of Object.values(VENUES)) assert.equal(venue.zone === 'mainland', venue.map.y < 40, venue.id);
  // The merged catalogue (venues + other systems' activities) builds without clashes.
  assert.ok(spotsOf('park', 'lagos').some((spot) => spot.id === 'work' && spot.activities.some((def) => def.id === 'helper-shift')));
  assert.ok(seen.size >= 180, `${seen.size} activities`);
  // Places that must be reachable at any hour.
  for (const id of ['home', 'park', 'hospital', 'police', 'amala-shitta'] as const) assert.equal(need(VENUES[id], 'registered venue').hours, undefined, id);
  const ibadan = contentFor('ibadan');
  assert.equal(ibadan.venues.length, 25); assert.equal(ibadan.venues.some((venue) => venue.id === 'park' || venue.id === 'unilag'), false);
  assert.equal(venueLabel('agodi-gardens', 'ibadan'), 'Agodi Gardens'); assert.equal(venueLabel('airport', 'lagos'), 'Airport');
  assert.deepEqual(Object.keys(HOME_SPOTS).sort(), ['banana', 'ikoyi', 'lekki', 'mushin', 'yaba']);
});

test('fixed venue values are used exactly', () => {
  const find = (id: string) => need(everyDef().find((entry) => entry.def.id === id)).def;
  const observed: [string, number, number][] = [['stage-play', 14, 400], ['comedy-show', 11, 500], ['spoken-word', 9, 0], ['chill', 11, 0], ['play-ayo', 7, 0],
    ['buka-amala', 8, 300], ['buka-jollof', 8, 550], ['buka-peppersoup', 7, 400], ['buka-efo', 8, 650]];
  for (const [id, duration, cost] of observed) {
    assert.equal(find(id).duration, duration, id); assert.equal(find(id).cost, cost, id);
  }
  assert.deepEqual(find('chill').effects, { energy: 4, fun: 10 });
  assert.deepEqual(find('perform-comedy').requiresSkill, { id: 'comedy', level: 3 }); assert.equal(find('perform-comedy').duration, 11);
  assert.equal(find('buka-jollof').effects?.fun, 10); assert.equal(find('buka-jollof').moodlets?.[0]?.label, 'Party Jollof');
  assert.deepEqual(Object.keys(VENUES['amala-shitta'].spots), ['counter', 'kitchen', 'wash']);
  assert.deepEqual(Object.keys(VENUES.library.spots), ['bookcase', 'lounge', 'bar', 'dance']);
  assert.deepEqual(Object.keys(VENUES.park.spots), ['amphitheatre', 'art', 'trees', 'drinks', 'people', 'work']);
  assert.deepEqual([VENUES.cchub.hours?.open, VENUES.cchub.district, VENUES['amala-shitta'].district, VENUES.library.district], [8, 'Yaba', 'Surulere', 'Victoria Island']);
  assert.deepEqual([HEALTH.feelings.soaked.value, HEALTH.feelings.sick.value, HEALTH.feelings.sick.label, HEALTH.feelings.soaked.label], [-8, -35, 'Very Sick', 'Soaked by Rain']);
  assert.deepEqual([EVENTS.agbo.choices[0]?.cost, EVENTS.agbo.modes, EVENTS.agbo.choices.length], [600, ['trek'], 2]);
});

test('every skill can be trained somewhere and unlocks a gated activity; earning is bounded', () => {
  const defs = everyDef().map((entry) => entry.def);
  for (const skill of ['cooking', 'charisma', 'fitness', 'coding', 'music', 'hustle', 'dance', 'comedy', 'photography'] as const) {
    const training = defs.filter((def) => !def.requiresSkill && !def.reward && (def.xp?.[skill] ?? 0) >= 10);
    assert.ok(training.length >= 2, `${skill}: open training (${training.length})`);
    assert.ok(training.some((def) => !def.cost), `${skill}: free training`);
    assert.ok(defs.some((def) => def.requiresSkill?.id === skill && (def.reward ?? 0) > 0), `${skill}: a paid activity it unlocks`);
  }
  const earning = defs.filter((def) => (def.reward ?? 0) > 0);
  assert.ok(earning.length >= 30);
  for (const def of earning) {
    assert.ok((def.cooldown ?? 0) >= 300, `${def.id} has a cooldown`);
    assert.ok((def.reward ?? 0) <= 2500, `${def.id} pays modestly`);
    assert.ok(Object.values(def.effects || {}).some((amount) => amount < 0) && def.minimumNeeds, `${def.id} costs needs`);
    assert.ok((def.reward ?? 0) / (def.cooldown ?? 1) <= 3, `${def.id} pays at most ₦3 per second of cooldown`);
  }
  for (const rule of Object.values(ACTIVITY_OUTCOMES)) assert.ok(defs.some((def) => (def.cooldown ?? 0) >= 900 && Reflect.get(ACTIVITY_OUTCOMES, def.id) === rule));
  // Free food is rationed too.
  for (const def of defs.filter((def) => !def.cost && !def.reward && (def.effects?.hunger ?? 0) >= 20 && !['garri'].includes(def.id))) assert.ok((def.cooldown ?? 0) >= 900, def.id);
});

test('Freedom Park is fully playable: paid shows, free play, and the skill-gated set', () => {
  const state = createLife({ cash: 1000 }, at(DRY_NOON));
  run(state, 'stage-play', DRY_NOON);
  assert.equal(state.cash, 600); assert.equal(state.needs.fun, 68); assert.equal(state.ledger.at(-1)?.reason, 'Watch a Stage Play');
  const locked = dispatch(state, { type: 'activity', payload: { id: 'perform-comedy' } }, at(DRY_NOON));
  assert.equal(locked.code, 'skill_required'); assert.match(why(locked), /Comedy level 3 \(yours is 0\)/);
  run(state, 'open-mic-jokes', DRY_NOON + 20000);
  assert.equal(state.skills.comedy, 22);
  const comic = createLife({ skills: { comedy: 600 } }, at(DRY_NOON));
  assert.equal(run(comic, 'perform-comedy', DRY_NOON).ok, true);
  assert.equal(comic.cash, 5900); assert.equal(comic.needs.energy, 42);
  const again = dispatch(comic, { type: 'activity', payload: { id: 'perform-comedy' } }, at(DRY_NOON + 60000));
  assert.equal(again.code, 'cooldown'); assert.match(why(again), /available again in 9m 11s/);
  assert.equal(viewLife(comic, at(DRY_NOON + 60000)).travel.cooldowns['perform-comedy'], 551);
  assert.equal(viewLife(comic, at(DRY_NOON + 60000)).activities.cards.find((card) => card.id === 'perform-comedy')?.blocked?.code, 'cooldown');
  advanceLife(comic, 600, at(DRY_NOON + 611000));
  assert.deepEqual(comic.travel.cooldowns, {}, 'expired cooldowns are pruned');
  assert.equal(run(comic, 'perform-comedy', DRY_NOON + 611000).ok, true); assert.equal(comic.cash, 6800);
  const visits: [string, string][] = [['art', 'see-art'], ['trees', 'play-ayo'], ['drinks', 'park-zobo']];
  for (const [spot, id] of visits) {
    const visitor = createLife({ spot }, at(DRY_NOON));
    assert.equal(run(visitor, id, DRY_NOON).ok, true, id); assert.ok(visitor.needs.fun > 50, id);
  }
});

test('fares follow the fare table, are symmetric, and Danfo is the default', () => {
  assert.equal(DEFAULT_MODE, 'danfo');
  assert.deepEqual(Object.keys(TRAVEL_MODES), ['trek', 'keke', 'danfo', 'okada', 'cab']);
  const modeIds = Object.keys(TRAVEL_MODES) as TravelModeId[]; // Object.keys loses the key type; these are the table's own keys
  const fares = (from: VenueId, to: VenueId) => { const state = createLife({ location: from }, at(DRY_NOON)); return modeIds.map((mode) => quote(state, to, mode, at(DRY_NOON)).fare); };
  assert.deepEqual(fares('park', 'library'), [0, 150, 150, 200, 400]);
  assert.deepEqual(fares('home', 'amala-shitta'), [0, 100, 100, 200, 350]);
  assert.deepEqual(fares('amala-shitta', 'home'), [0, 100, 100, 200, 350]);
  assert.deepEqual(fares('amala-shitta', 'cchub'), [0, 150, 150, 200, 400]);
  assert.deepEqual(fares('park', 'home'), [0, 200, 200, 300, 550], 'crossing the lagoon (original beta band)');
  const ids = Object.keys(VENUES) as VenueId[], state = createLife(null, at(DRY_NOON)); // the table's own keys
  for (const a of ids) for (const b of ids) if (a !== b) {
    assert.equal(routeBand(state, a, b), routeBand(state, b, a), `${a} ↔ ${b}`);
    state.location = a;
    const trips = modeIds.map((mode) => quote(state, b, mode, at(DRY_NOON)));
    assert.equal(trips[0]?.fare, 0, 'trek is always free');
    const seconds = trips.map((trip) => trip.seconds);
    assert.equal(Math.max(...seconds), seconds[0], `trek is slowest ${a} → ${b}`); assert.equal(Math.min(...seconds), seconds[3], `okada is fastest ${a} → ${b}`);
    assert.ok(seconds.every((value) => value >= 4 && value <= 20), `${a} → ${b}: ${seconds}`);
  }
  const view = viewLife(createLife(null, at(DRY_NOON)), at(DRY_NOON)).travel;
  assert.equal(view.defaultMode, 'danfo');
  assert.deepEqual(need(view.destinations.find((item) => item.id === 'library')).modes.map((mode) => [mode.id, mode.fare, mode.seconds]), [['trek', 0, 12], ['keke', 150, 9], ['danfo', 150, 8], ['okada', 200, 5], ['cab', 400, 6]]);
});

test('the fare is charged at departure, a cancel keeps it, and arrival applies the need cost', () => {
  heard.length = 0;
  const state = createLife(null, at(DRY_NOON));
  assert.equal(dispatch(state, { type: 'travel', payload: { id: 'library', mode: 'danfo' } }, at(DRY_NOON)).code, 'started');
  assert.equal(state.cash, 4850); assert.equal(state.location, 'park'); assert.deepEqual(state.ledger.at(-1), { at: DRY_NOON, amount: -150, reason: 'Danfo to The Library', balance: 4850 });
  assert.deepEqual(state.activeAction, { kind: 'travel', id: 'library', duration: 8, remaining: 8, mode: 'danfo', fare: 150 });
  // The travel screen's cancel rule comes from the trip itself: where it started and what was paid.
  assert.deepEqual(viewLife(state, at(DRY_NOON)).travel.active, { from: 'park', to: 'library', mode: 'danfo', fare: 150, refundable: false });
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(state)), at(DRY_NOON)).activeAction, state.activeAction, 'the fare survives a save and load');
  const savedTrip = need(createLife({ location: 'park', activeAction: { kind: 'travel', id: 'library', duration: 8, remaining: 8, mode: 'danfo', fare: -5 } }, at(DRY_NOON)).activeAction);
  assert.equal(savedTrip.kind === 'travel' ? savedTrip.fare : 'not a trip', undefined, 'a nonsense saved fare is dropped');
  assert.equal(dispatch(state, { type: 'travel', payload: { id: 'home', mode: 'trek' } }, at(DRY_NOON)).code, 'busy');
  advanceLife(state, 3, at(DRY_NOON + 3000));
  assert.equal(dispatch(state, { type: 'cancel' }, at(DRY_NOON + 3000)).code, 'cancelled');
  assert.deepEqual([state.cash, state.location, state.needs.hygiene, state.travel.trips], [4850, 'park', 50, 0], 'no refund, no move, no need cost');
  assert.equal(viewLife(state, at(DRY_NOON + 3000)).travel.active, null);
  assert.equal(heard.length, 0);
  go(state, 'library', 'danfo', DRY_NOON + 10000, 'no-event-1');
  // A Danfo ride leaves every need as it was.
  assert.deepEqual([state.cash, state.needs.hygiene, state.needs.fun, state.spot], [4700, 50, 50, 'bookcase']);
  assert.deepEqual(heard.filter(([name]) => name === 'travel.arrived'), [['travel.arrived', { venue: 'library', from: 'park', mode: 'danfo' }]]);
  assert.deepEqual(heard.filter(([name]) => name === 'venue.visited'), [['venue.visited', { venue: 'library', first: true }]]);
  assert.deepEqual(state.travel.lastTrip, { mode: 'danfo', from: 'park', to: 'library' });
  // An Okada (original beta value) costs 3 Hygiene on arrival.
  const rider = createLife(null, at(DRY_NOON)); go(rider, 'library', 'okada', DRY_NOON, 'no-event-1');
  assert.deepEqual([rider.cash, rider.needs.hygiene], [4800, 47]);
  // Trek: free, 10 Energy and 7 Hygiene, and it trains Fitness.
  const walker = createLife(null, at(DRY_NOON));
  go(walker, 'library', 'trek', DRY_NOON);
  assert.deepEqual([walker.cash, walker.needs.energy, walker.needs.hygiene, walker.skills.fitness], [5000, 40, 43, 15]);
  assert.match(walker.message, /^Arrived at The Library\. The trek cost you −10 Energy, −7 Hygiene\./);
  go(walker, 'park', 'trek', DRY_NOON + 60000);
  assert.deepEqual(walker.travel.visited, ['library', 'park']); assert.equal(walker.travel.trips, 2);
  assert.equal(viewLife(walker, at(DRY_NOON + 120000)).travel.visited, 2);
});

test('Home is reachable by every mode, from anywhere, at any hour, even with nothing', () => {
  const modeIds = Object.keys(TRAVEL_MODES) as TravelModeId[]; // the table's own keys
  for (const mode of modeIds) {
    const state = createLife(null, at(MONDAY_3AM));
    go(state, 'home', mode, MONDAY_3AM);
    assert.equal(state.spot, 'kitchen'); assert.equal(state.cash, 5000 - ([0, 200, 200, 300, 550][modeIds.indexOf(mode)] ?? NaN), mode);
  }
  const broke = createLife({ cash: 0, location: 'beach', needs: { hunger: 0, energy: 0, fun: 0, social: 0, hygiene: 0, bladder: 0 } }, at(MONDAY_3AM));
  const refused = dispatch(broke, { type: 'travel', payload: { id: 'home', mode: 'danfo' } }, at(MONDAY_3AM));
  assert.equal(refused.code, 'insufficient_funds'); assert.match(why(refused), /costs ₦200; you have ₦0\. Trekking is free\./);
  go(broke, 'home', 'trek', MONDAY_3AM);
  assert.equal(broke.location, 'home');
  for (const house of Object.keys(HOME_SPOTS) as HouseId[]) { // the table's own keys
    const state = createLife({ travel: { home: house } }, at(DRY_NOON));
    assert.equal(viewLife(state, at(DRY_NOON)).travel.destinations.find((item) => item.id === 'home')?.district, need(HOME_SPOTS[house], 'home district').district);
  }
  // The house is learned from the shared events, never from another system's state.
  const mover = createLife(null, at(DRY_NOON));
  const listeners = need(need(systems().find((system) => system.id === 'travel')).on);
  // The listeners are called with the bare fields they read (and, for 'moon', a house that does not exist).
  const partial = <E extends 'life.started' | 'house.moved'>(data: object) => data as unknown as EngineEventMap[E];
  const onStarted = need(listeners['life.started']), onMoved = need(listeners['house.moved']);
  onStarted(mover, partial<'life.started'>({ house: 'mushin' }), at(DRY_NOON)); assert.equal(mover.travel.home, 'mushin');
  onMoved(mover, partial<'house.moved'>({ id: 'lekki' }), at(DRY_NOON)); assert.equal(mover.travel.home, 'lekki');
  onMoved(mover, partial<'house.moved'>({ id: 'moon' }), at(DRY_NOON)); assert.equal(mover.travel.home, 'lekki');
  assert.equal(routeBand(mover, 'home', 'palms'), 'standard'); assert.equal(routeBand(mover, 'home', 'cchub'), 'far');
});

test('a closed venue can be previewed but not travelled to, with one consistent label', () => {
  const state = createLife({ location: 'amala-shitta' }, at(MONDAY_3AM + 41 * 60000));
  const now = MONDAY_3AM + 41 * 60000; // 3:41 AM Lagos
  const card = need(viewLife(state, at(now)).travel.destinations.find((item) => item.id === 'cchub'));
  assert.equal(card.open, false); assert.equal(card.status, 'Closed · opens 8AM (in 4h 19m)'); assert.equal(card.hours, '8AM – 10PM');
  assert.ok(card.description && card.preview.includes('Pitch Your Startup') && card.modes.length === 5, 'the card still previews the venue');
  for (const mode of card.modes) {
    assert.equal(mode.blocked?.code, 'closed');
    const result = dispatch(state, { type: 'travel', payload: { id: 'cchub', mode: mode.id } }, at(now));
    assert.equal(result.ok, false); assert.equal(result.code, 'closed'); assert.equal(result.reason, mode.blocked?.reason);
    assert.match(result.reason, /^CcHub is closed: opens 8AM \(in 4h 19m\)\./);
  }
  assert.deepEqual([state.cash, state.activeAction, state.location], [5000, null, 'amala-shitta']);
  assert.equal(viewLife(state, at(MONDAY_3AM + 5 * HOUR)).travel.destinations.find((item) => item.id === 'cchub')?.status, 'Open now · closes 10PM');
  assert.equal(dispatch(state, { type: 'travel', payload: { id: 'cchub', mode: 'danfo' } }, at(MONDAY_3AM + 5 * HOUR)).code, 'started');
  // Every venue, every hour of a week: the card, the refusal and the clock agree.
  const probe = createLife({ location: 'home' }, at(MONDAY_3AM));
  for (let hour = 0; hour < 168; hour += 1) {
    const time = MONDAY_3AM + hour * HOUR + 17 * 60000;
    for (const item of viewLife(probe, at(time)).travel.destinations.filter((item) => item.kind === 'venue')) {
      const open = isOpen(need(VENUES[item.id], 'registered venue').hours, time), block = travelBlock(probe, item.id, 'trek', at(time)), info = openingInfo(need(VENUES[item.id], 'registered venue').hours, time);
      assert.equal(item.open, open, item.id); assert.equal(item.status, info.status, item.id); assert.equal(block === null, open, item.id);
      if (!open) { assert.ok(need(block).reason.includes(`opens ${info.opensAt} (in `), item.id); assert.ok(item.status.includes(`opens ${info.opensAt} (in `), item.id); assert.ok(isOpen(need(VENUES[item.id], 'registered venue').hours, time + info.minutes * 60000), `${item.id} opens when promised`); }
    }
  }
  assert.equal(openingInfo({ open: 9, close: 17, days: [1] }, MONDAY_3AM + 20 * HOUR).status, 'Closed · opens Mon 9AM (in 154h 0m)');
  assert.deepEqual(openingInfo(undefined, 0), { open: true, always: true, hours: 'Open 24 hours', status: 'Open 24 hours', minutes: 0, opensAt: null });
});

test('coming-soon places and invalid trips are refused with a reason and no charge', () => {
  // No place in Lagos is coming soon any more, so the mechanism is exercised with two made-up ones.
  // (The table's id type is empty in this build, so the made-up entries are added without the typed assignment.)
  Object.assign(COMING_SOON, {
    spaceport: { id: 'spaceport', label: 'Spaceport', district: 'Epe', icon: '✈️', description: 'Not built yet.', zone: 'east', map: { x: 90, y: 60 } },
    monorail: { id: 'monorail', label: 'Monorail', district: 'Marina', icon: '🚌', description: 'Not built yet.', zone: 'island', map: { x: 40, y: 80 } },
  });
  try {
    const state = createLife(null, at(DRY_NOON));
    const refusals: [unknown, string, RegExp][] = [[{ id: 'spaceport', mode: 'cab' }, 'coming_soon', /Spaceport is not open yet/], [{ id: 'monorail', mode: 'trek' }, 'coming_soon', /coming soon/],
      [{ id: 'moon', mode: 'trek' }, 'invalid_travel', /valid destination/], [{ id: 'library', mode: 'jetpack' }, 'invalid_travel', /valid destination/], [{ id: 'library' }, 'invalid_travel', /./],
      [{ id: 'park', mode: 'cab' }, 'already_here', /already here/], [{ id: 'library', mode: 'car' }, 'travel_mode_unavailable', /do not own a car/], [{ id: ['library'], mode: { id: 'cab' } }, 'invalid_travel', /./]];
    for (const [payload, code, reason] of refusals) {
      const result = hostile(state, 'travel', payload, at(DRY_NOON)); // malformed trips: the validation is what is under test
      assert.equal(result.ok, false); assert.equal(result.code, code, JSON.stringify(payload)); assert.match(why(result), reason);
      assert.equal(state.cash, 5000); assert.equal(state.activeAction, null);
    }
    const soon = viewLife(state, at(DRY_NOON)).travel.destinations.filter((item) => item.kind === 'soon');
    assert.deepEqual(soon.map((item) => [item.id, item.status, item.blocked?.code, item.modes.length]), [['spaceport', 'Coming soon', 'coming_soon', 0], ['monorail', 'Coming soon', 'coming_soon', 0]]);
    // A saved trip to a place that is not open is dropped.
    assert.equal(createLife({ location: 'park', activeAction: { kind: 'travel', id: 'spaceport', duration: 8, remaining: 3, mode: 'danfo' } }, at(DRY_NOON)).activeAction, null);
  } finally { delete COMING_SOON.spaceport; delete COMING_SOON.monorail; }
  assert.deepEqual(viewLife(createLife(null, at(DRY_NOON)), at(DRY_NOON)).travel.destinations.filter((item) => item.kind === 'soon'), [], 'and Lagos itself lists none');
});

test('modifiers: own car through travel.modes, and fare, duration and need cost adjustments', () => {
  const plain = createLife(null, at(DRY_NOON));
  assert.deepEqual(modesFor(plain, 'library', at(DRY_NOON)), ['trek', 'keke', 'danfo', 'okada', 'cab']);
  const owner = createLife({ worldprobe: { car: true } }, at(DRY_NOON));
  assert.deepEqual(viewLife(owner, at(DRY_NOON)).travel.destinations.find((item) => item.id === 'library')?.modes.at(-1), { id: 'car', label: 'Own car', icon: '🚗', blurb: ALL_MODES.car.blurb, fuel: true, fare: 120, seconds: 5, needs: {}, xp: {}, blocked: null });
  go(owner, 'home', 'car', DRY_NOON);
  assert.equal(owner.cash, 4820); assert.equal(owner.ledger.at(-1)?.reason, 'Fuel to Home');
  assert.deepEqual(modesFor(createLife({ worldprobe: { junk: true } }, at(DRY_NOON)), 'library', at(DRY_NOON)), ['trek', 'car'], 'unknown ids are dropped and trek is always offered');
  const tuned = createLife({ worldprobe: { halfFare: true, slow: true, comfy: true } }, at(DRY_NOON));
  assert.deepEqual(quote(tuned, 'library', 'cab', at(DRY_NOON)), { mode: 'cab', band: 'standard', fare: 200, seconds: 12, needs: {}, xp: {} });
  assert.deepEqual(quote(tuned, 'library', 'trek', at(DRY_NOON)).needs, { hygiene: -7 }, 'unknown needs and zeroes are dropped');
  go(tuned, 'library', 'trek', DRY_NOON);
  assert.deepEqual([tuned.needs.energy, tuned.needs.hygiene], [50, 43]);
  assert.equal(quote(createLife({ worldprobe: { slow: true } }, at(DRY_NOON)), 'home', 'trek', at(DRY_NOON)).seconds, 36);
});

test('a save from before per-mode travel resumes and arrives; malformed trips are dropped', () => {
  const legacy = createLife({ cash: 4600, location: 'park', activeAction: { kind: 'travel', id: 'library', duration: TRAVEL_DURATION, remaining: 3 } }, at(WET_NOON));
  assert.deepEqual(legacy.activeAction, { kind: 'travel', id: 'library', duration: 5, remaining: 3 });
  advanceLife(legacy, 3, at(WET_NOON + 3000));
  assert.deepEqual([legacy.location, legacy.cash, legacy.message, legacy.needs.energy, legacy.travel.event], ['library', 4600, 'Arrived at The Library.', 50, null]);
  for (const active of [{ kind: 'travel', id: 'library', duration: 12, remaining: 3 }, { kind: 'travel', id: 'library', duration: 12, remaining: 3, mode: 'jetpack' }, { kind: 'travel', id: 'library', duration: 61, remaining: 3, mode: 'trek' },
    { kind: 'travel', id: 'moon', duration: 8, remaining: 3, mode: 'danfo' }, { kind: 'travel', id: 'park', duration: 8, remaining: 3, mode: 'danfo' }, { kind: 'travel', id: 'library', duration: 2, remaining: 1, mode: 'cab' }]) {
    assert.equal(createLife({ location: 'park', activeAction: active }, at(DRY_NOON)).activeAction, null, JSON.stringify(active));
  }
  assert.deepEqual(createLife({ location: 'park', activeAction: { kind: 'travel', id: 'home', duration: 18, remaining: 7.5, mode: 'trek', hacked: true } }, at(DRY_NOON)).activeAction, { kind: 'travel', id: 'home', duration: 18, remaining: 7.5, mode: 'trek' });
});

/** Trek park → library with successive seeds until the wanted roadside event (or none) comes up. */
function trekUntil(wanted: string | null, extra: Record<string, unknown> = {}) {
  for (let i = 0; i < 400; i++) {
    const state = createLife(extra, at(DRY_NOON));
    go(state, 'library', 'trek', DRY_NOON, `roadside-${i}`);
    if ((state.travel.event?.id ?? null) === wanted) return { state, seed: `roadside-${i}` };
  }
  throw new Error(`No seed produced ${wanted}`);
}

test('roadside events: deterministic, pending in state, resolved by an action', () => {
  assert.ok(Object.keys(EVENTS).length >= 7);
  for (const event of Object.values(EVENTS)) {
    assert.ok(event.title && event.text && event.weight > 0 && event.modes.every((mode) => Object.hasOwn(ALL_MODES, mode)), event.id);
    assert.ok(event.choices.length >= 2 && !event.choices.at(-1)?.cost && !event.choices.at(-1)?.check, `${event.id}: the last answer is free and certain`);
    assert.ok(event.id === 'agbo' || event.beta === true, `${event.id} is marked as original`);
    for (const choice of event.choices) {
      for (const block of [choice, choice.check?.success, choice.check?.failure].filter((entry) => entry !== undefined)) {
        assert.ok((block.reward || 0) <= 500 && (block.cost || 0) <= 600 && Object.values(block.effects || {}).every((amount) => Math.abs(amount) <= 15), `${event.id}/${choice.id} is small`);
      }
    }
  }
  for (const mode of Object.keys(ALL_MODES) as TravelModeId[]) {
    if (mode === 'boat') assert.equal(Object.values(EVENTS).some((event) => event.modes.includes(mode)), false, 'boat has no roadside events');
    else assert.ok(Object.values(EVENTS).some((event) => event.modes.includes(mode)), `${mode} has events`);
  }
  const { state, seed } = trekUntil('agbo');
  // Both lives are built the same way (from an empty save), so only the seed can make them differ.
  const replay = createLife({}, at(DRY_NOON)); go(replay, 'library', 'trek', DRY_NOON, seed);
  assert.deepEqual(replay, state, 'the same seed gives the same trip');
  assert.deepEqual(state.travel.event, { id: 'agbo', at: DRY_NOON + 12000 }); assert.match(state.message, /Iya Agbo by the road — choose what to do\.$/);
  const offer = need(viewLife(state, at(DRY_NOON + 20000)).travel.event);
  assert.deepEqual(offer.choices.map((choice) => [choice.id, choice.cost, choice.blocked]), [['buy', 600, null], ['decline', 0, null]]); assert.equal(offer.expiresIn, 592);
  assert.equal(dispatch(state, { type: 'world.roadside', payload: { choice: 'dance' } }, at(DRY_NOON + 20000)).code, 'invalid_choice');
  assert.equal(hostile(state, 'world.roadside', {}, at(DRY_NOON + 20000)).code, 'invalid_choice');
  heard.length = 0;
  const declined = dispatch(state, { type: 'world.roadside', payload: { choice: 'decline' } }, at(DRY_NOON + 20000));
  assert.deepEqual([declined.code, state.cash, state.travel.event, state.message], ['resolved', 5000, null, 'You thanked her and kept walking.']);
  assert.deepEqual(heard, [['roadside.resolved', { event: 'agbo', choice: 'decline', success: null }]]);
  const none = dispatch(state, { type: 'world.roadside', payload: { choice: 'decline' } }, at(DRY_NOON + 20000));
  assert.equal(none.code, 'no_event'); assert.match(why(none), /Nothing is waiting/);
  // Buying costs ₦600 once; too little cash leaves the choice open.
  const poor = trekUntil('agbo', { cash: 599 }).state;
  const refused = dispatch(poor, { type: 'world.roadside', payload: { choice: 'buy' } }, at(DRY_NOON + 20000));
  assert.equal(refused.code, 'insufficient_funds'); assert.match(why(refused), /costs ₦600; you have ₦599/); assert.equal(poor.travel.event?.id, 'agbo'); assert.equal(poor.cash, 599);
  assert.equal(viewLife(poor, at(DRY_NOON + 20000)).travel.event?.choices[0]?.blocked?.code, 'insufficient_funds');
  const buyer = trekUntil('agbo').state;
  assert.equal(dispatch(buyer, { type: 'world.roadside', payload: { choice: 'buy' } }, at(DRY_NOON + 20000)).code, 'resolved');
  assert.deepEqual([buyer.cash, buyer.needs.energy, buyer.ledger.at(-1)?.reason, buyer.health.immuneUntil], [4400, 45, 'Iya Agbo by the road', DRY_NOON + 20000 + 1800000]);
  // An unanswered choice lapses when the next trip starts, or after its time is up.
  const mover = trekUntil('agbo').state;
  dispatch(mover, { type: 'travel', payload: { id: 'park', mode: 'cab' } }, at(DRY_NOON + 30000));
  assert.equal(mover.travel.event, null);
  const idler = trekUntil('agbo').state;
  advanceLife(idler, EVENT_TTL_SECONDS - 13, at(DRY_NOON + EVENT_TTL_SECONDS * 1000 - 1000)); assert.equal(idler.travel.event?.id, 'agbo');
  advanceLife(idler, 13, at(DRY_NOON + 12000 + EVENT_TTL_SECONDS * 1000)); assert.equal(idler.travel.event, null);
  assert.equal(trekUntil(null).state.travel.event, null, 'some treks are uneventful');
});

test('roadside checks roll with ctx.rng: skill raises the odds and outcomes stay small', () => {
  const outcomes = (skills: Record<string, number>) => {
    const seen = { true: 0, false: 0 };
    for (let i = 0; i < 60; i++) {
      const state = createLife({ skills, travel: { event: { id: 'toll', at: DRY_NOON } } }, at(DRY_NOON));
      heard.length = 0;
      const first = dispatch(state, { type: 'world.roadside', payload: { choice: 'talk' } }, at(DRY_NOON, `talk-${i}`));
      assert.equal(first.code, 'resolved');
      const success = need(heard.at(-1))[1].success === true;
      if (success) seen.true += 1; else seen.false += 1;
      assert.equal(state.cash, success ? 5000 : 4700); assert.equal(state.skills.charisma, Math.min(5500, (skills.charisma || 0) + (success ? 14 : 5)));
      const twin = createLife({ skills, travel: { event: { id: 'toll', at: DRY_NOON } } }, at(DRY_NOON));
      dispatch(twin, { type: 'world.roadside', payload: { choice: 'talk' } }, at(DRY_NOON, `talk-${i}`));
      assert.deepEqual(twin, state, 'a replay of the same action gives the same outcome');
    }
    return seen;
  };
  const novice = outcomes({}), expert = outcomes({ charisma: 5500 });
  assert.ok(novice.true > 10 && novice.false > 10, JSON.stringify(novice)); assert.ok(expert.true > novice.true && expert.true >= 50, JSON.stringify(expert));
  assert.equal(viewLife(createLife({ travel: { event: { id: 'toll', at: DRY_NOON } } }, at(DRY_NOON)), at(DRY_NOON)).travel.event?.choices[1]?.chance, 40);
  const skint = createLife({ cash: 100, travel: { event: { id: 'toll', at: DRY_NOON } } }, at(DRY_NOON));
  for (let i = 0; skint.travel.event && i < 1; i++) dispatch(skint, { type: 'world.roadside', payload: { choice: 'talk' } }, at(DRY_NOON, 'talk-fail-probe'));
  assert.ok(skint.cash === 100 || skint.cash === 0, 'a failed check takes what is there and never goes negative');
});

test('rain soaks trekkers and okada riders, and a soaking can make you sick', () => {
  assert.equal(weatherAt(WET_NOON, 'lagos').raining, true); assert.equal(weatherAt(DRY_NOON, 'lagos').raining, false);
  assert.deepEqual(weatherAt(WET_NOON, 'lagos'), weatherAt(WET_NOON + 1000, 'lagos'), 'one sky per block');
  let wet = 0; for (let i = 0; i < 2000; i++) if (weatherAt(MONDAY_NOON + i * 20 * 60000, 'lagos').raining) wet += 1;
  assert.ok(wet > 300 && wet < 500, `rains about a fifth of the time (${wet}/2000)`);
  const soaked = createLife(null, at(WET_NOON)); heard.length = 0;
  go(soaked, 'library', 'trek', WET_NOON, 'soak-a');
  const feeling = need(soaked.moodlets.find((moodlet) => moodlet.id === 'soaked'));
  assert.deepEqual([feeling.label, feeling.value, feeling.expiresAt], ['Soaked by Rain', -8, WET_NOON + 12000 + 600000]);
  assert.match(soaked.message, /The rain soaked you on the way\./); assert.ok(heard.some(([name, data]) => name === 'weather.soaked' && data.mode === 'trek'));
  assert.equal(viewLife(soaked, at(WET_NOON + 12000)).health.soaked, true);
  for (const mode of ['keke', 'danfo', 'cab'] as const) { const dry = createLife(null, at(WET_NOON)); go(dry, 'library', mode, WET_NOON); assert.equal(dry.moodlets.length, 0, mode); }
  const rider = createLife(null, at(WET_NOON)); go(rider, 'library', 'okada', WET_NOON); assert.ok(rider.moodlets.some((moodlet) => moodlet.id === 'soaked'));
  const sunny = createLife(null, at(DRY_NOON)); go(sunny, 'library', 'trek', DRY_NOON); assert.equal(sunny.moodlets.length, 0);
  // Falling sick from a soaking is a small ctx.rng chance.
  let sick = 0, found: LifeState | null = null;
  for (let i = 0; i < 300; i++) { const state = createLife(null, at(WET_NOON)); go(state, 'library', 'trek', WET_NOON, `rain-${i}`); if (state.health.sick) { sick += 1; found ||= state; } }
  assert.ok(sick >= 15 && sick <= 60, `about 12% (${sick}/300)`);
  const example = need(found);
  assert.deepEqual([example.health.cause, example.health.since], ['rain', WET_NOON + 12000]);
  assert.deepEqual(example.moodlets.find((moodlet) => moodlet.id === 'very-sick'), { id: 'very-sick', label: 'Very Sick', value: -35, expiresAt: null });
  assert.match(example.message, /see a doctor at the General Hospital/);
  const protectedState = createLife({ health: { immuneUntil: WET_NOON + HOUR } }, at(WET_NOON));
  for (let i = 0; i < 40; i++) { go(protectedState, i % 2 ? 'park' : 'library', 'trek', WET_NOON + i * 20000, `rain-${i}`); }
  assert.equal(protectedState.health.sick, false, 'immunity holds');
});

test('neglect makes you sick slowly, warns first, and never from simply being away', () => {
  const state = createLife({ needs: { hygiene: 5, hunger: 60 } }, at(DRY_NOON));
  let now = DRY_NOON;
  const tick = (seconds = 60) => { now += seconds * 1000; advanceLife(state, seconds, at(now)); };
  for (let i = 0; i < 9; i++) tick();
  assert.equal(viewLife(state, at(now)).health.warning?.level !== 'rundown', true);
  tick();
  let view = viewLife(state, at(now)).health;
  assert.deepEqual([view.strain, view.rundown, view.status, view.low, view.sick], [0.5, true, 'Run down', ['hygiene'], false]);
  assert.equal(view.warning?.text, 'Run down · wash and eat'); assert.match(need(view.advice[0]), /hygiene is very low/);
  heard.length = 0;
  for (let i = 0; i < 10; i++) tick();
  assert.equal(state.health.sick, true); assert.equal(state.health.cause, 'neglect'); assert.match(state.message, /free clinic costs nothing/);
  assert.deepEqual(heard, [['illness.started', { cause: 'neglect' }]]);
  view = viewLife(state, at(now)).health;
  assert.deepEqual([view.status, view.warning?.text, view.healsInMinutes], ['Very Sick', 'Very sick · see a doctor', 360]);
  assert.equal(viewLife(state, at(now)).needs.feelings.find((feeling) => feeling.id === 'very-sick')?.value, -35);
  // Washing reverses the build-up twice as fast as it grew.
  const careful = createLife({ needs: { hunger: 5 } }, at(DRY_NOON));
  for (let i = 1; i <= 10; i++) advanceLife(careful, 60, at(DRY_NOON + i * 60000));
  assert.equal(careful.health.strain, 600);
  careful.needs.hunger = 80;
  for (let i = 11; i <= 15; i++) advanceLife(careful, 60, at(DRY_NOON + i * 60000));
  assert.equal(careful.health.strain, 0); assert.equal(careful.health.sick, false);
  // A week away counts as one short step.
  const away = createLife({ needs: { hygiene: 0, hunger: 0 } }, at(DRY_NOON));
  advanceLife(away, 7 * 86400, at(DRY_NOON + 7 * 86400000));
  assert.deepEqual([away.health.sick, away.health.strain], [false, 90]);
});

test('illness never traps: free clinic with no cash, paid doctor, agbo, or time', () => {
  const sickSave = { cash: 0, health: { sick: true, cause: 'rain', since: DRY_NOON }, needs: { hunger: 0, energy: 0, fun: 0, social: 0, hygiene: 0, bladder: 0 } };
  const broke = createLife(sickSave, at(DRY_NOON));
  advanceLife(broke, 1, at(DRY_NOON + 1000));
  assert.ok(broke.moodlets.some((moodlet) => moodlet.id === 'very-sick'), 'the feeling is restored if a save lost it');
  assert.equal(viewLife(broke, at(DRY_NOON + 1000)).needs.mood.label, 'Miserable');
  // A sick trek costs 12 Energy and 9 Hygiene, and the agbo seller always turns up.
  const trekker = createLife({ health: { sick: true, cause: 'rain', since: DRY_NOON } }, at(DRY_NOON));
  go(trekker, 'library', 'trek', DRY_NOON, 'sick-trek');
  assert.deepEqual([trekker.needs.energy, trekker.needs.hygiene, trekker.travel.event?.id], [38, 41, 'agbo']);
  heard.length = 0;
  dispatch(trekker, { type: 'world.roadside', payload: { choice: 'buy' } }, at(DRY_NOON + 20000));
  assert.deepEqual([trekker.health.sick, trekker.cash, trekker.moodlets.some((moodlet) => moodlet.id === 'very-sick'), trekker.moodlets.some((moodlet) => moodlet.id === 'recovered')], [false, 4400, false, true]);
  assert.deepEqual(heard.map(([name, data]) => [name, data.by ?? data.choice]), [['illness.cured', 'Iya Agbo by the road'], ['roadside.resolved', 'buy']]);
  // No cash at all: trek to the hospital (always open) and queue at the free clinic.
  go(broke, 'hospital', 'trek', MONDAY_3AM, 'to-hospital');
  assert.equal(dispatch(broke, { type: 'activity', payload: { id: 'hospital-doctor' } }, at(MONDAY_3AM + 30000)).code, 'insufficient_funds');
  assert.equal(dispatch(broke, { type: 'spot', payload: { id: 'ward' } }, at(MONDAY_3AM + 30000)).code, 'selected');
  heard.length = 0;
  assert.equal(run(broke, 'hospital-free', MONDAY_3AM + 30000).ok, true);
  assert.deepEqual([broke.health.sick, broke.cash, broke.message], [false, 0, 'You have been treated and you are well again.']);
  assert.deepEqual(heard.filter(([name]) => name === 'illness.cured'), [['illness.cured', { by: 'hospital-free' }]]);
  const healthy = dispatch(broke, { type: 'activity', payload: { id: 'hospital-free' } }, at(MONDAY_3AM + 90000));
  assert.equal(healthy.code, 'not_sick'); assert.match(why(healthy), /You are not sick/);
  assert.equal(viewLife(broke, at(MONDAY_3AM + 90000)).health.immune, true);
  // The doctor is quick and costs ₦1,500.
  const patient = createLife({ location: 'hospital', spot: 'clinic', health: { sick: true, cause: 'neglect', since: DRY_NOON } }, at(DRY_NOON));
  run(patient, 'hospital-doctor', DRY_NOON);
  assert.deepEqual([patient.health.sick, patient.cash, patient.activeAction], [false, 3500, null]);
  run(patient, 'hospital-checkup', DRY_NOON + 20000); assert.equal(patient.message, 'Check-up done: a clean bill of health.');
  // Left alone it passes after six hours.
  const waiting = createLife({ health: { sick: true, cause: 'rain', since: DRY_NOON } }, at(DRY_NOON));
  advanceLife(waiting, 6 * 3600 - 1, at(DRY_NOON + 6 * HOUR - 1000)); assert.equal(waiting.health.sick, true);
  advanceLife(waiting, 1, at(DRY_NOON + 6 * HOUR)); assert.equal(waiting.health.sick, false); assert.match(waiting.message, /sickness has passed/);
  // Being sick blocks nothing.
  const worker = createLife({ health: { sick: true, cause: 'rain', since: DRY_NOON }, spot: 'trees' }, at(DRY_NOON));
  assert.equal(run(worker, 'chill', DRY_NOON).ok, true);
  assert.deepEqual(HEALTH.cures.map((cure) => cure.id), ['doctor', 'free-clinic', 'agbo', 'rest']);
  for (const cure of HEALTH.cures.filter((item) => item.activity)) assert.ok(need(need(Object.values(VENUES).find((venue) => venue.id === cure.where)).spots[need(cure.spot)]).activities.some((def) => def.id === cure.activity && def.tags?.includes('cure')), cure.id);
});

test('chance activities: the startup pitch pays its grant once; the ATM gamble can get you booked', () => {
  const founder = (i: number) => createLife({ location: 'cchub', spot: 'stage', cash: 5000, skills: { coding: 1000, charisma: 5500 }, needs: { energy: 100 } }, at(DRY_NOON, `pitch-${i}`));
  assert.equal(dispatch(createLife({ location: 'cchub', spot: 'stage' }, at(DRY_NOON)), { type: 'activity', payload: { id: 'hub-pitch' } }, at(DRY_NOON)).code, 'skill_required');
  let wins = 0, funded: LifeState | null = null;
  for (let i = 0; i < 40; i++) {
    const attempt = founder(i); heard.length = 0;
    run(attempt, 'hub-pitch', DRY_NOON, `pitch-${i}`);
    if (attempt.travel.funded) { wins += 1; funded ||= attempt; assert.equal(attempt.cash, 24000); assert.deepEqual(heard.filter(([name]) => name === 'startup.funded'), [['startup.funded', { venue: 'cchub' }]]); }
    else { assert.equal(attempt.cash, 4000); assert.ok(attempt.moodlets.some((moodlet) => moodlet.id === 'pitch-flopped')); }
  }
  assert.ok(wins >= 25 && wins < 40, `85% at Charisma 10 (${wins}/40)`);
  const state = need(funded);
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'hub-pitch' } }, at(DRY_NOON + 60000)).code, 'cooldown');
  // Pitching again after the grant never pays it twice.
  for (let i = 0; i < 12; i++) { const time = DRY_NOON + (i + 1) * 920000; state.needs.energy = 100; advanceLife(state, 920, at(time)); run(state, 'hub-pitch', time, `again-${i}`); }
  assert.equal(state.cash, 24000 - 12 * 1000);
  // Hack an ATM: Coding 6, a small chance of a small payout, otherwise a fine and a record.
  let caught: LifeState | null = null, paid = 0;
  for (let i = 0; i < 60; i++) {
    const hacker = createLife({ location: 'cchub', spot: 'desks', skills: { coding: 2100 } }, at(DRY_NOON));
    run(hacker, 'hub-hack-atm', DRY_NOON, `atm-${i}`);
    if (hacker.cash === 9000) paid += 1; else { assert.equal(hacker.cash, 2000); caught ||= hacker; }
  }
  assert.ok(paid >= 8 && paid <= 35, `about 35% at Coding 6 (${paid}/60)`);
  const booked = need(caught);
  assert.ok(booked.moodlets.some((moodlet) => moodlet.id === 'booked')); assert.match(booked.message, /clear your name at the Police Station/);
  const clean = createLife({ location: 'police', spot: 'desk' }, at(DRY_NOON));
  const noNeed = dispatch(clean, { type: 'activity', payload: { id: 'police-clear' } }, at(DRY_NOON));
  assert.equal(noNeed.code, 'not_needed'); assert.match(why(noNeed), /no record at the station/);
  go(booked, 'police', 'cab', DRY_NOON + 60000);
  assert.equal(run(booked, 'police-service', DRY_NOON + 120000).ok, true);
  assert.equal(booked.moodlets.some((moodlet) => moodlet.id === 'booked'), false);
});

test('a one-time outcome without a repeat outcome throws instead of paying the grant again', () => {
  const success: { repeat?: unknown } = need(ACTIVITY_OUTCOMES['hub-pitch']).success, repeat = success.repeat;
  delete success.repeat;
  try {
    let threw = 0;
    for (let i = 0; i < 40 && !threw; i++) {
      const attempt = createLife({ location: 'cchub', spot: 'stage', cash: 5000, skills: { coding: 1000, charisma: 5500 }, needs: { energy: 100 }, travel: { funded: true } }, at(DRY_NOON, `broken-${i}`));
      try { run(attempt, 'hub-pitch', DRY_NOON, `broken-${i}`); } catch (error) { assert.match(String(error), /hub-pitch.*no repeat outcome/); threw += 1; assert.equal(attempt.cash, 4000, 'nothing was paid before the refusal'); }
    }
    assert.equal(threw, 1, 'a success on an already-paid grant throws');
  } finally { success.repeat = repeat; }
});

test('daily gig limit: paid gigs across the whole city stop at the limit and reopen at Lagos midnight; shifts are untouched', () => {
  const start = MONDAY_NOON;
  let now = start;
  const state = createLife(null, at(now));
  state.needs.energy = 100; state.needs.hunger = 100;
  const act = <T extends ActionType>(type: T, payload: unknown) => dispatch(state, { type, payload, actionId: `gig-${now}-${type}` } as unknown as ActionBody<T>, at(now, `gig-${now}`));
  const wait = (seconds: number) => { now += seconds * 1000; advanceLife(state, seconds, at(now)); };
  const gigs = (Object.keys(VENUES) as VenueId[]).flatMap((venue) => spotsOf(venue, 'lagos').flatMap((spot) => spot.activities.filter((def) => (def.reward ?? 0) > 0 && !def.requiresJob && !def.requiresSkill && !def.hours).map((def) => ({ venue, spot: spot.id, def }))));
  assert.ok(gigs.length > GIG_DAILY_LIMIT, 'there are more unskilled gigs than the daily limit');
  assert.ok(gigs.every(({ def }) => isGig(def)));
  assert.equal(isGig(need(need(VENUES.park.spots.trees).activities[0])), false, 'an unpaid activity is not a gig');
  assert.equal(isGig({ id: 'hub-hack-atm' } as ActivityDefinition), true, 'a repeatable gamble that pays counts');
  assert.equal(isGig({ id: 'hub-pitch' } as ActivityDefinition), false, 'a once-in-a-life grant does not');
  assert.equal(isGig({ id: 'x', reward: 300, requiresJob: 'community-helper' } as ActivityDefinition), false, 'nor does a job shift');
  let done = 0, refused: ActionResult<'activity'> | null = null;
  for (const gig of gigs) {
    if (!isOpen(need(VENUES[gig.venue], 'registered venue').hours, now)) continue;
    state.needs.energy = 100; state.needs.hunger = 100;
    if (state.location !== gig.venue) { assert.equal(act('travel', { id: gig.venue, mode: 'trek' }).ok, true); wait(need(state.activeAction).remaining); }
    assert.equal(act('spot', { id: gig.spot }).ok, true);
    const cash = state.cash;
    const started = act('activity', { id: gig.def.id });
    if (!started.ok) { refused = started; assert.equal(state.cash, cash); break; }
    wait(gig.def.duration);
    assert.equal(state.cash, cash + (gig.def.reward ?? NaN));
    done += 1;
    assert.deepEqual(viewLife(state, at(now)).travel.gigs, { limit: GIG_DAILY_LIMIT, used: done, left: GIG_DAILY_LIMIT - done });
    assert.ok(viewLife(state, at(now)).travel.gigsHere.includes(gig.def.id), 'the view names the gigs at this spot, so the counter can sit beside them');
  }
  assert.equal(done, GIG_DAILY_LIMIT);
  const refusal = need(refused);
  assert.equal(refusal.code, 'gig_limit'); assert.match(why(refusal), /today’s 8 paid gigs\. Gigs open again at midnight, Nigerian time\. Your job’s shift is not affected\./);
  const card = viewLife(state, at(now)).activities.cards.find((item) => item.reward > 0);
  assert.equal(need(need(card).blocked).code, 'gig_limit', 'the card itself says why it is closed');
  // The starter job's shift still pays today.
  if (state.location !== 'park') { act('travel', { id: 'park', mode: 'trek' }); wait(need(state.activeAction).remaining); }
  act('apply-job', { id: 'community-helper' }); act('spot', { id: 'work' });
  assert.deepEqual(viewLife(state, at(now)).travel.gigsHere, [], 'a job shift is not listed as a gig');
  const before = state.cash;
  assert.equal(act('activity', { id: 'helper-shift' }).ok, true); wait(20);
  assert.equal(state.cash, before + 300);
  // After Lagos midnight the count starts again.
  wait(13 * 3600);
  assert.equal(viewLife(state, at(now)).travel.gigs.used, 0);
});

test('a found wallet is offered at most once per day', () => {
  assert.equal(EVENTS.wallet.oncePerDay, true);
  assert.deepEqual(Object.values(EVENTS).filter((event) => event.choices.some((choice) => (choice.reward ?? 0) >= 100 || (choice.check?.success?.reward ?? 0) >= 100)).map((event) => event.id), ['wallet'], 'it is the only event that pays');
  let now = MONDAY_NOON, wallets = 0, trips = 0;
  const state = createLife(null, at(now));
  const firstDay = Math.floor((now + 3600000) / 86400000);
  while (trips < 600) {
    const day = Math.floor((now + 3600000) / 86400000);
    if (day !== firstDay) break;
    state.needs.energy = 100;
    const result = dispatch(state, { type: 'travel', payload: { id: state.location === 'park' ? 'library' : 'park', mode: 'trek' }, actionId: `w-${trips}` }, at(now, `w-${trips}`));
    assert.equal(result.ok, true);
    const seconds = need(state.activeAction).remaining; now += seconds * 1000; advanceLife(state, seconds, at(now, `w-${trips}`)); trips += 1;
    if (state.travel.event?.id === 'wallet') wallets += 1;
  }
  assert.ok(trips > 200, `${trips} treks in one afternoon`);
  assert.equal(wallets, 1, 'one wallet, however far you walk');
  assert.equal(state.travel.eventDays.wallet, firstDay);
});
