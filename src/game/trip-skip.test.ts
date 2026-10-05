import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: world — paying game money to skip the rest of a trip ('travel.skip').
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts';
import { makeContext } from './util.ts';
import { TRIP_SKIP, tripSkipFee } from './content/travel.ts';
import type { ActionBody } from '../types/actions.ts';
import type { ActionOutcome, LifeContext, LifeContextInit, LifeState } from '../types/life.ts';

const MONDAY_9AM = Date.UTC(2026, 0, 5, 8);
const at = (now = MONDAY_9AM, seed = 'skip', extra: LifeContextInit = {}): LifeContext => makeContext({ now, cityId: 'lagos', seed, ...extra });
const found = <T>(value: T | null | undefined, what: string): T => { assert.ok(value !== null && value !== undefined, `${what} exists`); return value; };
// Payloads here include deliberately wrong ones, so the typed action body is crossed once, here.
const act = (state: LifeState, type: string, payload: object, ctx: LifeContext = at()): ActionOutcome => dispatch(state, { type, payload } as unknown as ActionBody, ctx);
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
/** A settled life with a house of its own in Ikeja. */
function settled(outcome = 'street-smart'): LifeState {
  const state = createLife(null, at(MONDAY_9AM, 'new', { isNew: true, requireOnboarding: true }));
  act(state, 'onboarding.look', { look: LOOK }); act(state, 'onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }); act(state, 'onboarding.dream', { dream: 'yaba-unicorn' });
  for (let i = 0; i < 500 && state.onboarding.lottery?.id !== outcome; i++) { state.onboarding.lottery = null; act(state, 'onboarding.lottery', {}, at(MONDAY_9AM, `roll-${i}`)); }
  assert.equal(act(state, 'onboarding.home', { lga: 'ikeja' }).ok, true);
  return state;
}
/** Settle to `to` (server ms), as a poll would. */
const settle = (state: LifeState, to: number) => advanceLife(state, (to - state.t) / 1000, makeContext({ now: to, cityId: state.estate.city, seed: `settle-${to}` }));
const skip = (state: LifeState, payload: object = {}, seed = 'skip-1') => act(state, 'travel.skip', payload, makeContext({ now: state.t, cityId: state.estate.city, seed }));
/** cash = what the life was seeded with + every ledger line: no naira from nowhere. */
const conserved = (state: LifeState, seed = 5000) => assert.equal(state.cash, seed + state.ledger.reduce((sum, line) => sum + line.amount, 0));
/** On the bus to Ibadan with `left` seconds to go. */
function onTheBus(state: LifeState, left: number, mode = 'road'): LifeState {
  assert.equal(act(state, 'estate.relocate', { to: state.estate.city === 'lagos' ? 'ibadan' : 'lagos', mode }, makeContext({ now: state.t, cityId: state.estate.city, seed: 'go' })).code, 'departed');
  const trip = found(state.activeAction, 'the trip');
  if (left < trip.duration) settle(state, state.t + (trip.duration - left) * 1000);
  return state;
}

test('the price: base plus a rate for each second left, in steps of ₦50, capped by the fare, never below one step', () => {
  // Lagos–Ibadan by bus (₦3,500, 120 s), by train (₦9,000, 90 s) and a ₦65,000 flight of 90 s.
  assert.deepEqual([120, 90, 60, 30, 10, 3, 0].map((left) => tripSkipFee('intercity', left, 3500)), [1300, 1000, 700, 400, 200, 150, 100]);
  assert.deepEqual([90, 45, 10].map((left) => tripSkipFee('intercity', left, 9000)), [1000, 550, 200]);
  assert.equal(tripSkipFee('intercity', 90, 65000), 1000);
  // A long cheap ride is capped at half its fare; a long dear one is not.
  assert.equal(tripSkipFee('intercity', 420, 3500), 1750);
  assert.equal(tripSkipFee('intercity', 420, 14000), 4300);
  // It only ever falls as the trip goes on, it is always a whole number of steps, and it is never free or negative.
  for (const fare of [0, 100, 1500, 3500, 65000]) {
    let before = Infinity;
    for (let left = 600; left >= 0; left -= 0.5) {
      const fee = tripSkipFee('intercity', left, fare);
      assert.ok(fee <= before && fee >= TRIP_SKIP.roundTo && fee % TRIP_SKIP.roundTo === 0 && fee <= Math.max(TRIP_SKIP.roundTo, fare * TRIP_SKIP.intercity.capShare), `fare ${fare}, ${left}s left: ${fee}`);
      before = fee;
    }
  }
  for (const hostile of [Number.NaN, -5, Infinity]) assert.equal(tripSkipFee('intercity', hostile, 3500), 100);
  // Inside a city: small, and flat once the trip is long.
  assert.deepEqual([60, 40, 21].map((left) => tripSkipFee('local', left)), [300, 250, 200]);
});

test('between cities: the first skip is free, the next is charged exactly the price shown, and the arrival is the one of a trip waited out', () => {
  const waited = onTheBus(settled(), 80), skipped = structuredClone(waited);
  const cash = skipped.cash;
  // The first skip of a character costs nothing, and says so.
  const offer = found(viewLife(skipped, makeContext({ now: skipped.t, cityId: 'lagos', seed: 'view' })).travel.skip, 'the offer');
  assert.deepEqual(offer, { kind: 'intercity', fee: 0, free: true, confirm: false, blocked: null });
  assert.equal(skipped.travel.skipped, false);
  const done = skip(skipped, { quote: 0 });
  assert.deepEqual([done.ok, done.code], [true, 'skipped']);
  assert.deepEqual([skipped.cash, skipped.travel.skipped, skipped.activeAction, skipped.estate.city, skipped.location], [cash, true, null, 'ibadan', 'agodi-gardens']);
  assert.match(skipped.message, /^Welcome to Ibadan\..*The first skip between cities is free\.$/);
  // The same trip waited out, then both brought to the same moment: everything a player owns or is, is the same.
  const end = waited.t + 81000;
  settle(waited, end); settle(skipped, end);
  for (const key of ['estate', 'location', 'spot', 'activeAction', 'skills', 'inventory', 'job', 'career', 'goals', 'missions', 'property', 'home', 'onboarding', 'health', 'economy', 'social', 'cash', 'ledger'] as const) {
    assert.deepEqual(skipped[key], waited[key], `${key} after a skip is what it is after waiting`);
  }
  assert.deepEqual({ ...skipped.travel, skipped: false }, waited.travel);
  for (const need of Object.keys(waited.needs) as (keyof LifeState['needs'])[]) assert.ok(Math.abs(skipped.needs[need] - waited.needs[need]) < 0.01, `${need}: the clock was not moved by the skip`);
  // The flag survives a load; hostile values of it do not.
  assert.equal(createLife(skipped, makeContext({ now: skipped.t, cityId: 'ibadan', seed: 'load' })).travel.skipped, true);
  assert.equal(createLife({ ...skipped, travel: { ...skipped.travel, skipped: 'yes' } }, makeContext({ now: skipped.t, cityId: 'ibadan', seed: 'load' })).travel.skipped, false);

  // The way back by train (₦9,000, 90 s) with 45 s left: ₦550, charged once, written in the ledger.
  onTheBus(skipped, 45, 'rail');
  const before = skipped.cash, shown = found(viewLife(skipped, makeContext({ now: skipped.t, cityId: 'ibadan', seed: 'view' })).travel.skip, 'the offer');
  assert.deepEqual(shown, { kind: 'intercity', fee: 550, free: false, confirm: false, blocked: null });
  assert.equal(skip(skipped, { quote: shown.fee }, 'skip-2').code, 'skipped');
  assert.deepEqual([skipped.cash, skipped.estate.city, skipped.location, skipped.activeAction], [before - 550, 'lagos', 'home', null]);
  assert.deepEqual([skipped.ledger.at(-1)?.amount, skipped.ledger.at(-1)?.reason], [-550, 'Trip skipped (Ibadan → Lagos)']);
  assert.match(skipped.message, /You skipped the rest of the trip for ₦550\.$/);
  // A second press (another device, a moment later) finds no trip: refused, nothing charged.
  const again = skip(skipped, { quote: 550 }, 'skip-3');
  assert.deepEqual([again.ok, again.code, skipped.cash], [false, 'not_travelling', before - 550]);
  assert.equal(viewLife(skipped, makeContext({ now: skipped.t, cityId: 'lagos', seed: 'view' })).travel.skip, null);
  conserved(skipped);
  assert.deepEqual(createLife(skipped, makeContext({ now: skipped.t, cityId: 'lagos', seed: 'load' })), skipped, 'nothing a skip writes is lost at a load');
});

test('refused, with the reason and with nothing charged: no trip, about to arrive, not enough cash, a price above the one shown', () => {
  const idle = settled();
  const untouched = (state: LifeState, run: () => ActionOutcome, code: string, reason: RegExp) => {
    const copy = structuredClone(state), result = run();
    assert.deepEqual([result.ok, result.code], [false, code]);
    assert.match(found(result.ok ? undefined : result.reason, 'a reason'), reason);
    assert.deepEqual({ ...state, message: '' }, { ...copy, message: '' }, `${code} changes nothing`);
  };
  untouched(idle, () => skip(idle), 'not_travelling', /not on a trip/);
  // The free skip is used up first, so the rest of this test is about money.
  const state = onTheBus(idle, 100);
  assert.equal(skip(state).code, 'skipped');
  onTheBus(state, 100);
  // ₦1,100 with 100 s left. A price shown that the server's is above is refused; hostile quotes are ignored, not obeyed.
  untouched(state, () => skip(state, { quote: 1050 }), 'price_changed', /now costs ₦1,100\. Nothing was charged/);
  untouched(state, () => skip(state, { quote: 0 }), 'price_changed', /₦1,100/);
  // Not enough cash: the button says how much is missing, the refusal too, and the balance never goes below zero.
  state.cash = 400; state.ledger = []; state.ledgerDays = [];
  assert.deepEqual(viewLife(state, makeContext({ now: state.t, cityId: 'ibadan', seed: 'view' })).travel.skip?.blocked, { code: 'insufficient_funds', reason: 'You need ₦700 more' });
  untouched(state, () => skip(state), 'insufficient_funds', /costs ₦1,100; you have ₦400\. You need ₦700 more/);
  for (const quote of [-1, 1.5, '1100', null, 1e30, Number.NaN]) untouched(state, () => skip(state, { quote }), 'insufficient_funds', /₦1,100/);
  // The price falls: with 20 s left it is ₦300, which ₦400 covers.
  settle(state, state.t + 80000);
  assert.equal(viewLife(state, makeContext({ now: state.t, cityId: 'ibadan', seed: 'view' })).travel.skip?.fee, 300);
  // About to arrive: not sold.
  const late = structuredClone(state);
  settle(late, late.t + 18000);
  assert.deepEqual(viewLife(late, makeContext({ now: late.t, cityId: 'ibadan', seed: 'view' })).travel.skip?.blocked?.code, 'almost_there');
  untouched(late, () => skip(late), 'almost_there', /Waiting is free/);
  assert.equal(skip(state, { quote: 300 }).code, 'skipped');
  assert.deepEqual([state.cash, state.estate.city], [100, 'lagos']);
});

test('the price that was shown is the price charged for a few seconds, never less than the server\'s own and never an old one', () => {
  const base = onTheBus(settled(), 100);
  assert.equal(skip(base).code, 'skipped');
  onTheBus(base, 100); // ₦1,100 at 100 s, ₦1,050 at 95 s, ₦900 at 80 s
  const run = (later: number, quote: number | undefined): number => {
    const state = structuredClone(base), cash = state.cash;
    settle(state, state.t + later * 1000);
    assert.equal(skip(state, quote === undefined ? {} : { quote }).code, 'skipped');
    return cash - state.cash;
  };
  assert.equal(run(0, 1100), 1100);
  assert.equal(run(4, 1100), 1100, 'four seconds on, the button still showed ₦1,100: that is what is charged');
  assert.equal(run(4, undefined), 1100, 'without a quote the server charges its own price');
  assert.equal(run(20, 1100), 900, 'a quote from long ago is not charged: the price now is');
  assert.equal(run(20, 999999), 900, 'a quote cannot make the server charge more than a recent price');
});

test('inside a city: only a trip with more than twenty seconds left can be skipped, and it arrives as a trip does', () => {
  const state = settled();
  assert.equal(act(state, 'travel', { id: 'park', mode: 'trek' }, at(state.t, 'trek')).code, 'started');
  const trip = found(state.activeAction, 'the trek');
  assert.ok(trip.duration <= TRIP_SKIP.localMinRemainingSeconds, 'an ordinary hop is short');
  assert.equal(viewLife(state, at(state.t, 'view')).travel.skip, null);
  const cash = state.cash;
  assert.deepEqual([skip(state).code, state.cash, state.activeAction?.kind], ['too_short', cash, 'travel']);
  // A long local trip (the longest the rules allow): ₦250 with 40 s left.
  Object.assign(trip, { duration: 60, remaining: 40 });
  const waited = structuredClone(state);
  assert.deepEqual(viewLife(state, at(state.t, 'view')).travel.skip, { kind: 'travel', fee: 250, free: false, confirm: false, blocked: null });
  assert.equal(skip(state, { quote: 250 }).code, 'skipped');
  settle(waited, waited.t + 40000);
  assert.deepEqual([state.cash, state.location, state.activeAction, state.travel.skipped], [cash - 250, 'park', null, false]);
  assert.deepEqual([state.location, state.spot, state.travel.trips, state.travel.visited, state.travel.lastTrip, state.skills], [waited.location, waited.spot, waited.travel.trips, waited.travel.visited, waited.travel.lastTrip, waited.skills]);
  assert.equal(state.ledger.at(-1)?.reason, `Trip skipped to ${found(viewLife(state, at(state.t, 'view')).travel.destinations.find((item) => item.id === 'park'), 'the park').label}`);
  assert.match(state.message, /^Arrived at .*You skipped the rest of the trip for ₦250\.$/);
  // The trek's own cost was paid on arrival all the same.
  assert.ok(state.needs.energy < waited.needs.energy + 0.5 && Math.abs(state.needs.hygiene - waited.needs.hygiene) < 0.5);
  conserved(state);
});

test('what is not a trip cannot be skipped: an activity, and a life still held for its look', () => {
  const state = settled();
  const activity = found(viewLife(state, at(state.t, 'view')).activities.cards.find((card) => !card.blocked), 'something to do');
  assert.equal(act(state, 'activity', { id: activity.id }, at(state.t, 'do')).code, 'started');
  const cash = state.cash;
  assert.deepEqual([skip(state).code, state.cash, state.activeAction?.kind], ['not_travelling', cash, 'activity']);
  const held = createLife(null, at(MONDAY_9AM, 'held', { isNew: true, quickStart: true }));
  assert.equal(skip(held).code, 'onboarding_required');
});
