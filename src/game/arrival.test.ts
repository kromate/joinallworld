// OWNER: world — where a ticket lands a visitor: the airport, the motor park or terminal, or the station of the way they came.
import { loadCityContent, playableCityIds, cityRules, linksFrom } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano'].map(loadCityContent));
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicArrivalVenue, ticketArrivalVenue, venueFor } from './cities/runtime.ts';
import { createLife, dispatch, advanceLife } from '../life.ts';
import { makeContext } from './util.ts';
import type { ActionBody } from '../types/actions.ts';
import type { LifeState } from '../types/life.ts';

test('a ticket lands at the venue of its hub when the city has one, else at the public arrival place', () => {
  let hubbed = 0;
  for (const city of playableCityIds()) {
    const rules = cityRules(city)!, fallback = publicArrivalVenue(city).id;
    for (const mode of ['air', 'road', 'rail'] as const) {
      const hub = rules.hubs.find((item) => item.mode === mode), expected = hub?.venueId && venueFor(city, hub.venueId) ? hub.venueId : fallback;
      assert.equal(ticketArrivalVenue(city, mode).id, expected, `${city} by ${mode}`);
      if (expected !== fallback) hubbed++;
      // Closed to walk-ins at that moment: the public place.
      assert.equal(ticketArrivalVenue(city, mode, () => false).id, fallback, `${city} by ${mode}, closed`);
    }
    for (const other of ['boat', null, undefined, 'okada']) assert.equal(ticketArrivalVenue(city, other).id, fallback, `${city} by ${String(other)}`);
  }
  assert.ok(hubbed >= 15, `${hubbed} hub arrivals`);
  assert.equal(ticketArrivalVenue('ibadan', 'air').id, 'ibadan-airport');
  assert.equal(ticketArrivalVenue('ibadan', 'road').id, 'iwo-road-interchange');
  assert.equal(ticketArrivalVenue('ibadan', 'rail').id, 'moniya-station');
  assert.equal(ticketArrivalVenue('lagos', 'air').id, 'airport');
  assert.equal(ticketArrivalVenue('lagos', 'road').id, 'park', 'Lagos names no venue for its motor park');
});

const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
const MONDAY = Date.UTC(2026, 0, 5, 8);
const ctx = (now: number, city: string, seed = 'arrive') => makeContext({ now, cityId: city, seed });
const act = (state: LifeState, type: string, payload: object, now: number) => dispatch(state, { type, payload } as unknown as ActionBody, ctx(now, state.estate.city));
function settled(): LifeState {
  const state = createLife(null, makeContext({ now: MONDAY, cityId: 'lagos', seed: 'new', isNew: true, requireOnboarding: true }));
  act(state, 'onboarding.look', { look: LOOK }, MONDAY); act(state, 'onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }, MONDAY); act(state, 'onboarding.dream', { dream: 'yaba-unicorn' }, MONDAY);
  act(state, 'onboarding.lottery', {}, MONDAY);
  assert.equal(act(state, 'onboarding.home', { lga: 'ikeja' }, MONDAY).ok, true);
  return state;
}
function ride(state: LifeState, to: string, mode: string): void {
  state.cash = 1_000_000;
  assert.equal(act(state, 'estate.relocate', { to, mode }, state.t).code, 'departed', `${mode} to ${to}`);
  const seconds = state.activeAction!.remaining + 1;
  advanceLife(state, seconds, ctx(state.t + seconds * 1000, state.estate.city, `ride-${mode}`));
}

test('a visitor who rides lands at the airport, the terminal or the station; a resident arriving home lands at Home as before', () => {
  let ran = 0;
  for (const mode of ['road', 'rail', 'air'] as const) {
    if (!linksFrom('lagos').some((link) => link.to === 'ibadan' && link.mode === mode)) continue;
    ran++;
    const state = settled();
    ride(state, 'ibadan', mode);
    assert.equal(state.estate.city, 'ibadan');
    assert.equal(state.location, ticketArrivalVenue('ibadan', mode).id, `by ${mode}`);
    assert.notEqual(state.location, publicArrivalVenue('ibadan').id);
    // Home again: the house here is where a resident lands, whatever the way.
    ride(state, 'lagos', linksFrom('ibadan').find((link) => link.to === 'lagos')!.mode);
    assert.equal(state.location, 'home', `a resident arriving home by ${mode}`);
  }
  assert.ok(ran >= 2, `${ran} ways ridden`);
});
