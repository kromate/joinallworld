// OWNER: foundation — tests for the seams between the career, character, home and world systems.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife, spotsOf, actionTypes } from '../life.ts';
import { registerSystem, systems, serverOnlyReason, emit } from './registry.ts';
import { makeContext } from './util.ts';
import { isOpen, lagosDayStart, lagosTime, openingInfo } from './clock.ts';
import { arrive, addSkillXp, xpForLevel } from './api.ts';
import { VENUES } from './content/venues.ts';
import { JOBS, TRACKS } from './content/jobs.ts';
import { INGREDIENTS } from './content/food.ts';
import { CARS } from './content/cars.ts';
import { HOUSES } from './content/housing.ts';
import { STARTER_GOALS } from './content/goals.ts';
import { NPCS } from './content/npcs.ts';
import { workplaceHoursText, scheduleText } from './systems/career.ts';

const MONDAY_9AM = Date.UTC(2026, 0, 5, 8); // 09:00 in Lagos
const at = (now = MONDAY_9AM, seed = 'seam', extra = {}) => makeContext({ now, cityId: 'lagos', seed, ...extra });
const act = (state, type, payload, ctx = at()) => dispatch(state, { type, payload }, ctx);
/** The starting homes a life's rolled outcome allows, { [houseId]: startCash }. */
const LOTTERY_HOMES = (state) => Object.fromEntries(viewLife(state, at()).onboarding.homes.filter((home) => !home.locked).map((home) => [home.id, home.startCash]));

// A stand-in for a later owner's system: registered last, it records events and can veto actions.
const heard = [];
registerSystem({
  id: 'seamprobe', stateKeys: ['seamprobe'],
  sanitize(input, state) { state.seamprobe = { frozen: input.seamprobe?.frozen === true }; },
  on: { 'travel.arrived': (state, data) => heard.push({ ...data }) },
  modifiers: { 'action.block': (value, state, data) => value || (state.seamprobe.frozen && data.type !== 'cancel' ? { code: 'frozen', reason: `Frozen: ${data.type} is not possible right now.` } : null) },
});

function onboard(state, { house = 'yaba', traits = ['musical', 'tech-bro-or-sis'], dream = 'yaba-unicorn', outcome = 'lapo-baby' } = {}) {
  const look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
  assert.equal(act(state, 'onboarding.look', { look }).code, 'look_saved');
  assert.equal(act(state, 'onboarding.traits', { traits }).code, 'traits_saved');
  assert.equal(act(state, 'onboarding.dream', { dream }).code, 'dream_saved');
  for (let i = 0; i < 500 && state.onboarding.lottery?.id !== outcome; i++) {
    state.onboarding.lottery = null;
    act(state, 'onboarding.lottery', {}, at(MONDAY_9AM, `roll-${i}`));
  }
  assert.equal(state.onboarding.lottery.id, outcome);
  const moved = act(state, 'onboarding.home', { house });
  assert.equal(moved.code, 'life_started', moved.reason);
  return state;
}

test('travel.arrived carries { venue, from, mode } for every listener, and arrive accepts a target spot', () => {
  assert.equal(systems().find((system) => system.id === 'travel').on['travel.arrived'], undefined, 'travel no longer patches the payload from its own listener');
  heard.length = 0;
  const state = createLife({}, at());
  act(state, 'travel', { id: 'library', mode: 'okada' });
  advanceLife(state, 5, at(MONDAY_9AM + 5000));
  assert.deepEqual(heard, [{ venue: 'library', from: 'park', mode: 'okada' }]);
  // Systems registered before travel receive the very same payload object, so they see the mode too.
  const first = [];
  const career = systems().find((system) => system.id === 'career');
  const original = career.on['travel.arrived'];
  career.on['travel.arrived'] = (s, data) => first.push({ ...data });
  try {
    act(state, 'travel', { id: 'park', mode: 'trek' }, at(MONDAY_9AM + 5000));
    advanceLife(state, 12, at(MONDAY_9AM + 17000));
  } finally { if (original) career.on['travel.arrived'] = original; else delete career.on['travel.arrived']; }
  assert.deepEqual(first, [{ venue: 'park', from: 'library', mode: 'trek' }]);

  heard.length = 0;
  assert.equal(arrive(state, 'park', at(), { spot: 'trees', mode: null, reason: 'test' }), true);
  assert.equal(state.spot, 'trees');
  assert.deepEqual(heard, [{ reason: 'test', venue: 'park', from: 'park', mode: null }]);
  arrive(state, 'park', at(), { spot: 'no-such-spot' });
  assert.equal(state.spot, 'amphitheatre', 'an unknown spot falls back to the first one');
  assert.equal(arrive(state, 'atlantis', at()), false);
});

test('the automatic commute lands on the work spot and only starts while the workplace is open', () => {
  const state = createLife({ location: 'home', needs: { hunger: 90, energy: 90, fun: 50, social: 50, hygiene: 50, bladder: 50 } }, at(Date.UTC(2026, 0, 5, 2))); // Monday 3 AM
  assert.equal(act(state, 'apply-job', { id: 'tech' }, at(Date.UTC(2026, 0, 5, 2))).code, 'applied');
  assert.equal(state.activeAction, null, 'CcHub is closed at 3 AM, so nobody is sent there');
  assert.match(viewLife(state, at(Date.UTC(2026, 0, 5, 2))).career.step.text, /CcHub is closed right now: it opens 8AM/);
  advanceLife(state, 60, at(Date.UTC(2026, 0, 5, 7, 1))); // 8:01 AM
  assert.deepEqual([state.activeAction?.kind, state.activeAction?.id], ['commute', 'cchub']);
  advanceLife(state, 5, at(Date.UTC(2026, 0, 5, 7, 1, 5)));
  assert.deepEqual([state.location, state.spot], ['cchub', 'work']);
  assert.ok(viewLife(state, at(Date.UTC(2026, 0, 5, 7, 2))).activities.cards.some((card) => card.id === 'tech-shift' && !card.blocked));
});

test('action.block lets any system veto any action with a code and a reason', () => {
  const state = createLife({ seamprobe: { frozen: true } }, at());
  for (const type of actionTypes().filter((name) => name !== 'cancel')) {
    // A server-only action is refused before any veto when a player sends it, so it is vetoed on the server's path.
    const result = dispatch(state, { type, payload: {} }, serverOnlyReason(type) ? { ...at(), internal: true } : at());
    assert.deepEqual([result.ok, result.code, result.reason], [false, 'frozen', `Frozen: ${type} is not possible right now.`], type);
  }
  for (const type of actionTypes().filter((name) => serverOnlyReason(name))) assert.equal(dispatch(createLife(null, at()), { type, payload: {} }, at()).code, 'server_only', type);
  assert.ok(actionTypes().filter((type) => serverOnlyReason(type)).length >= 5, 'social and civic declare their server-only actions through the registry');
  assert.equal(state.message, `Frozen: ${actionTypes().filter((name) => name !== 'cancel').at(-1)} is not possible right now.`);
  assert.equal(act(state, 'cancel').code, 'idle', 'an action the veto lets through reaches its handler');
  assert.throws(() => dispatch(state, { type: 'no-such-action' }, at()), /Invalid action type/);
});

test('quick start: a guest life is held only until its look is confirmed, then plays in public and never reaches a home state', () => {
  const state = createLife(null, at(MONDAY_9AM, 'new', { isNew: true, quickStart: true }));
  assert.deepEqual([state.onboarding.stage, state.onboarding.required, state.onboarding.done, state.onboarding.bornAt], ['guest', true, false, MONDAY_9AM]);
  assert.equal(createLife(null, at(MONDAY_9AM, 'old-name', { isNew: true, requireOnboarding: true })).onboarding.stage, 'guest', 'the older context name still makes a guest');
  assert.equal(viewLife(state, at()).onboarding.required, true);
  for (const [type, payload] of [['spot', { id: 'trees' }], ['activity', { id: 'chill' }], ['travel', { id: 'home', mode: 'trek' }], ['apply-job', { id: 'tech' }],
    ['home.grocery-buy', { id: 'rice' }], ['goals.reroll-wish', { slot: 0 }], ['economy.pay-rent', {}], ['cancel', {}]]) {
    const result = act(state, type, payload);
    assert.deepEqual([result.ok, result.code], [false, 'onboarding_required'], type);
    assert.match(result.reason, /Choose your look and tap Play first/);
  }
  assert.deepEqual([state.location, state.cash, state.job, state.activeAction], ['park', 5000, null, null], 'nothing changed');
  // A reload keeps the rule; the client cannot drop it by saving and restoring.
  const restored = createLife(JSON.parse(JSON.stringify(state)), at());
  assert.deepEqual([restored.onboarding.required, restored.onboarding.stage], [true, 'guest']);
  assert.equal(act(restored, 'spot', { id: 'trees' }).code, 'onboarding_required');
  // The quick start: a look, strictly validated. Then the guest plays.
  const look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
  for (const bad of [undefined, {}, { look: { ...look, hair: 'gele' } }, { look: { ...look, outfit: 'agbada' } }, { look: { ...look, skin: '#fff' } }]) assert.equal(act(restored, 'onboarding.quick-start', bad).code, 'invalid_look');
  assert.equal(restored.onboarding.required, true);
  const played = act(restored, 'onboarding.quick-start', { look });
  assert.deepEqual([played.code, restored.onboarding.required, restored.onboarding.stage, restored.onboarding.step, restored.spot], ['playing', false, 'guest', 1, 'trees']);
  assert.deepEqual(restored.needs, { hunger: 80, energy: 85, fun: 70, social: 60, hygiene: 75, bladder: 70 }, 'the starting needs are handed out at the quick start');
  let chip = viewLife(restored, at()).goals.chip;
  assert.deepEqual([chip.kind, chip.id, chip.step, chip.go, chip.activity], ['goal', 'first-fun', 1, ['park', 'trees'], 'play-ayo'], 'the first goal is the public first activity');
  assert.equal(act(restored, 'activity', { id: 'play-ayo' }).code, 'started');
  advanceLife(restored, 7, at(MONDAY_9AM + 7000));
  assert.deepEqual([restored.cash, restored.goals.stars, restored.goals.chain, restored.onboarding.firstAt, restored.onboarding.activities], [5500, 1, 1, MONDAY_9AM + 7000, 1]);
  // Nothing that needs a home is reachable, and nothing the economy takes as settled exists.
  for (const [type, payload] of [['travel', { id: 'home', mode: 'trek' }], ['home.grocery-buy', { id: 'rice' }], ['home.furniture-buy', { item: 'plastic-chair', x: 0, y: 0, rot: 0 }],
    ['home.kitchen-unpack', {}], ['property.house-move', { id: 'mushin' }]]) {
    const result = act(restored, type, payload);
    assert.deepEqual([result.ok, result.code], [false, 'settle_required'], type);
    assert.match(result.reason, /Settle in to get your home/);
  }
  assert.equal(act(restored, 'economy.pay-rent', {}).ok, false);
  assert.deepEqual([restored.economy.rent.house, restored.economy.loan, restored.economy.billedWeek, restored.economy.started, restored.location, restored.home.stocked], [null, null, null, false, 'park', false]);
  // A whole week as a guest: no rent, no loan, no bill.
  const week = structuredClone(restored);
  advanceLife(week, 8 * 86400, at(MONDAY_9AM + 8 * 86400000));
  assert.deepEqual([week.cash, week.economy.billedWeek, week.ledger.filter((entry) => /Rent|Loan/.test(entry.reason)).length], [5500, null, 0]);
  // Public play is open: a trip, a job.
  assert.equal(act(restored, 'travel', { id: 'library', mode: 'trek' }, at(MONDAY_9AM + 8000)).code, 'started');
  assert.equal(act(restored, 'cancel', {}, at(MONDAY_9AM + 8000)).ok, true);
  // Settling in keeps what was earned: the start cash is topped up from the seed, not from the wallet.
  const before = restored.cash;
  onboard(restored);
  assert.deepEqual([restored.location, restored.onboarding.done, restored.onboarding.stage, viewLife(restored, at()).onboarding.required], ['home', true, 'settled', false]);
  assert.equal(restored.cash, 96000 + (before - 5000), 'the old flow’s start cash plus what the guest earned: nothing lost, nothing counted twice');
  assert.deepEqual(restored.goals.seen, ['settle-in'], 'Settle in is paid when the chain reaches it');
  chip = viewLife(restored, at()).goals.chip;
  assert.deepEqual([chip.kind, chip.id], ['goal', 'say-hello'], 'the chain carries on where the guest was');
  assert.equal(act(restored, 'spot', { id: 'bathroom' }).code, 'selected');
});

test('a life the old enforced flow left half-way resumes as a guest with every choice it had made', () => {
  const look = { body: 'man', hair: 'afro', outfit: 'hoodie', fabric: 'ankara', skin: 'skin-6', hairColor: 'auburn', outfitColor: 'teal', bottomsColor: 'cream' };
  const old = (onboarding) => createLife({ v: 1, cash: 5000, location: 'park', onboarding: { done: false, legacy: false, required: true, seed: 5000, bonusAt: 0, completedAt: null, wardrobe: null, house: null, lottery: null, dream: null, traits: [], look, ...onboarding } }, at());
  // Still on the Look step: held until the look is confirmed, as before — by the quick start or the old look action.
  const fresh = old({ step: 0 });
  assert.deepEqual([fresh.onboarding.stage, fresh.onboarding.required, fresh.goals.started], ['guest', true, true]);
  assert.equal(act(fresh, 'spot', { id: 'trees' }).code, 'onboarding_required');
  assert.equal(act(fresh, 'onboarding.look', { look }).code, 'look_saved');
  assert.equal(act(fresh, 'spot', { id: 'trees' }).code, 'selected');
  // Three steps in: nothing is asked again, play is open at once, and the remaining steps finish the same way.
  const mid = old({ step: 3, traits: ['hustler', 'foodie'], dream: 'lekki-landlord' });
  assert.deepEqual([mid.onboarding.stage, mid.onboarding.required, mid.onboarding.step, mid.onboarding.traits, mid.onboarding.dream], ['guest', false, 3, ['hustler', 'foodie'], 'lekki-landlord']);
  act(mid, 'spot', { id: 'trees' });
  assert.equal(act(mid, 'activity', { id: 'chill' }).code, 'started');
  advanceLife(mid, 11, at(MONDAY_9AM + 11000));
  assert.equal(act(mid, 'onboarding.lottery', {}).code, 'rolled');
  const house = Object.keys(LOTTERY_HOMES(mid))[0];
  const moved = act(mid, 'onboarding.home', { house, stay: true });
  assert.deepEqual([moved.code, mid.onboarding.stage, mid.location, mid.property.house, mid.economy.rent.house], ['life_started', 'settled', 'park', house, house]);
  assert.deepEqual(mid.needs, { hunger: 80, energy: 85, fun: 70, social: 60, hygiene: 75, bladder: 70 }, 'a life that never had the quick start gets its starting needs at move-in, as before');
  assert.deepEqual(createLife(structuredClone(mid), at()), mid);
});

test('onboarding is never forced on a life that predates it, or on one created without the flag', () => {
  const legacy = createLife({ cash: 4321, location: 'park' }, at());
  assert.deepEqual([legacy.onboarding.legacy, legacy.onboarding.done, legacy.onboarding.required], [true, true, false]);
  assert.equal(act(legacy, 'spot', { id: 'trees' }).code, 'selected');
  // A hostile save cannot turn a legacy life into an un-onboarded one or the reverse.
  assert.equal(createLife({ onboarding: { required: true } }, at()).onboarding.done, true);
  const plain = createLife(null, at(MONDAY_9AM, 'plain', { isNew: true }));
  assert.deepEqual([plain.onboarding.required, plain.onboarding.stage, plain.onboarding.done, viewLife(plain, at()).onboarding.required], [false, 'settled', false, false]);
  assert.equal(act(plain, 'onboarding.quick-start', { look: { body: 'man' } }).code, 'not_a_guest');
  assert.equal(act(plain, 'spot', { id: 'trees' }).code, 'selected', 'offered, not enforced');
  assert.equal(viewLife(plain, at()).goals.chip.kind, 'create');
  assert.equal(act(plain, 'travel', { id: 'home', mode: 'trek' }).code, 'started', 'a life that was never a guest keeps its home');
});

test('all fourteen career tracks can be applied for, show a work spot, and can be reached on every work day', () => {
  assert.equal(TRACKS.length, 14);
  for (const job of TRACKS) {
    assert.ok(Object.hasOwn(VENUES, job.workplace.venue), `${job.id}: ${job.workplace.venue} is on the map`);
    const state = createLife({}, at());
    assert.equal(act(state, 'apply-job', { id: job.id }).code, 'applied', job.id);
    const spot = spotsOf(job.workplace.venue).find((item) => item.id === 'work');
    assert.ok(spot?.label && spot.activities.some((def) => def.id === job.shift.id), `${job.id}: the work spot lists the shift`);
    // On each work day there is a time the venue is open, so travel there is possible that day.
    const hours = VENUES[job.workplace.venue].hours;
    for (const weekday of job.days) {
      const day = lagosTime(MONDAY_9AM).day + ((weekday - 1 + 7) % 7); // the first such weekday on or after that Monday
      assert.equal(lagosTime(lagosDayStart(day)).weekday, weekday);
      const open = Array.from({ length: 48 }, (_, half) => lagosDayStart(day) + half * 1800000).some((time) => isOpen(hours, time));
      assert.ok(open, `${job.id}: ${job.workplace.venue} opens at some time on weekday ${weekday}`);
    }
    // One label for the hours: the Jobs card, the your-job card and the Career tab show the map card's text.
    const view = viewLife(state, at());
    const card = view.career.jobs.find((item) => item.id === job.id);
    const mapHours = view.travel.destinations.find((item) => item.id === job.workplace.venue).hours;
    assert.equal(card.hours, workplaceHoursText(job, at())); assert.equal(view.career.hours, card.hours);
    assert.ok(card.hours.includes(mapHours === 'Open 24 hours' ? 'Open 24 hours' : `Open ${mapHours}`), `${job.id}: ${card.hours} uses the map label ${mapHours}`);
    assert.equal(openingInfo(hours, 0).hours, mapHours);
    assert.equal(card.schedule, scheduleText(job));
  }
  assert.equal(viewLife(createLife({}, at()), at()).career.jobs.filter((item) => item.blocked).length, 0, 'no track is blocked for an idle player');
});

test('a new life starts with the three observed wishes now that their venues exist', () => {
  const state = onboard(createLife(null, at(MONDAY_9AM, 'wishes', { isNew: true })));
  assert.deepEqual(viewLife(state, at()).goals.wishes.map((wish) => wish.label), ['Make ₦15,000 today', 'See art at Freedom Park', 'See a movie at The Palms']);
  // The Palms really has a film to see: the wish can be granted by a real activity.
  assert.ok(spotsOf('palms').some((spot) => spot.activities.some((def) => !def.unavailable && (def.tags || []).some((tag) => ['movie', 'cinema'].includes(tag)))));
  assert.ok(spotsOf('park').some((spot) => spot.id === 'art' && spot.activities.some((def) => (def.tags || []).includes('art'))));
});

test('"Make a new friend" completes when a regular is greeted — the real thing, not any social-tagged activity', () => {
  const state = onboard(createLife(null, at(MONDAY_9AM, 'friend', { isNew: true })));
  state.goals.chain = STARTER_GOALS.findIndex((goal) => goal.id === 'make-a-friend');
  const cash = state.cash;
  const chip = viewLife(state, at()).goals.chip;
  // At home there is nobody to meet: the one line of guidance points the way out…
  assert.deepEqual([chip.title, chip.open, chip.params], ['Make a new friend', 'map', { destination: 'park' }]);
  // …and out in public it opens the people who are there.
  const out = viewLife({ ...state, location: 'amala-shitta', spot: 'counter' }, at()).goals.chip;
  assert.deepEqual([out.title, out.hint, out.open], ['Make a new friend', 'Tap someone at a venue', 'people']);
  // The interim rule is gone: a social-tagged activity, at home or at a venue, is not a friend.
  state.location = 'amala-shitta'; state.spot = 'kitchen';
  assert.equal(act(state, 'activity', { id: 'buka-gist' }).code, 'started');
  advanceLife(state, 8, at(MONDAY_9AM + 8000));
  assert.equal(state.cash, cash, 'gisting with Mama is nice, but it is not the goal');
  // Say Hello to Amaka at the People spot: Social +12, Fun +2 as observed, and the goal pays once.
  const before = { ...state.needs };
  assert.equal(act(state, 'spot', { id: 'people' }).code, 'selected');
  assert.equal(act(state, 'activity', { id: 'npc-amaka-hello' }, at(MONDAY_9AM + 9000)).code, 'started');
  advanceLife(state, 6, at(MONDAY_9AM + 15000));
  assert.deepEqual([state.needs.social - before.social, state.needs.fun - before.fun], [12, 2]);
  assert.equal(state.cash, cash + 1500);
  assert.equal(state.ledger.at(-1).reason, 'Goal: Make a new friend');
  assert.equal(viewLife(state, at()).goals.chip.title, 'Work a shift');
  assert.equal(act(state, 'activity', { id: 'npc-amaka-hello' }, at(MONDAY_9AM + 16000)).code, 'started');
  advanceLife(state, 6, at(MONDAY_9AM + 22000));
  assert.equal(state.cash, cash + 1500, 'greeting again pays nothing more');
});

test('the dream "best friends with 4 people" is driven by the social system’s own events and tiers', () => {
  const state = onboard(createLife(null, at(MONDAY_9AM, 'padi', { isNew: true })));
  state.goals.chain = STARTER_GOALS.length; state.goals.dream = 'everybodys-padi';
  // Nothing is emitted by hand: each step is a real interaction with a regular, starting just below a tier.
  let now = MONDAY_9AM;
  const meet = (id, action, points) => {
    state.location = NPCS[id].venue; state.spot = 'people';
    state.social.rel[id] = { p: points, d: 0, n: 0, npc: true, at: 0 };
    assert.equal(act(state, 'activity', { id: `npc-${id}-${action}` }, at(now, `${id}-${action}-${points}`)).code, 'started');
    now += 12000; advanceLife(state, 12, at(now));
  };
  for (const id of ['kunle', 'mama-ronke', 'amaka', 'baba-sege']) {
    assert.equal(state.goals.dreamDone, false);
    meet(id, 'gist', 18);  // 18 → 21: Friend ('friend.made')
    meet(id, 'hello', 38); // 38 → 40: Paddy Mi ('relationship.changed' with tier 'paddy')
  }
  assert.deepEqual([state.goals.stats.friends, state.goals.stats.best, state.goals.besties.length], [4, 4, 4]);
  assert.equal(state.goals.dreamDone, true);
  assert.equal(viewLife(state, at()).goals.dream.percent, 100);
  meet('kunle', 'hello', 60);
  assert.equal(state.goals.stats.best, 4, 'the same best friend is never counted twice');
});

test('the Groceries price shown is the price charged; the Buy discount covers furniture and groceries but never cars', () => {
  const state = onboard(createLife(null, at(MONDAY_9AM, 'shop', { isNew: true })));
  state.goals.chain = STARTER_GOALS.length;
  state.goals.perks.push('connected');
  const view = viewLife(state, at());
  assert.deepEqual(view.home.groceries.rice, { 1: { price: 540, list: 600 }, 3: { price: 1620, list: 1800 } });
  for (const [id, packs] of [['rice', 1], ['rice', 3], ['spinach', 3], ['chicken', 1]]) {
    const before = state.cash;
    assert.equal(act(state, 'home.grocery-buy', { id, packs }).code, 'delivered');
    assert.equal(before - state.cash, view.home.groceries[id][packs].price, `${packs} × ${id}`);
    assert.ok(view.home.groceries[id][packs].price < INGREDIENTS[id].price * packs);
  }
  assert.equal(view.home.prices['plastic-chair'], 450);
  const car = view.property.cars.find((item) => item.id === 'agama-150');
  assert.deepEqual([car.price, car.listPrice], [CARS['agama-150'].price, CARS['agama-150'].price], 'no discount on a car');
});

test('an owned car is offered as a travel mode and costs fuel only', () => {
  const state = createLife({ cash: 1000, location: 'home', property: { house: 'yaba', cars: ['agama-150'], car: 'agama-150' } }, at());
  const card = viewLife(state, at()).travel.destinations.find((item) => item.id === 'cchub');
  const car = card.modes.find((mode) => mode.id === 'car');
  assert.ok(car, 'the car is offered'); assert.equal(car.fare, CARS['agama-150'].fuel); assert.equal(car.fuel, true);
  assert.equal(act(state, 'travel', { id: 'cchub', mode: 'car' }).code, 'started');
  assert.equal(state.cash, 1000 - CARS['agama-150'].fuel);
  const walker = createLife({ location: 'home' }, at());
  assert.equal(act(walker, 'travel', { id: 'cchub', mode: 'car' }).code, 'travel_mode_unavailable');
});

test('the Home header data: the house name and district come from the housing content', () => {
  const state = onboard(createLife(null, at(MONDAY_9AM, 'house', { isNew: true })), { house: 'mushin' });
  const view = viewLife(state, at());
  assert.deepEqual([view.property.house.label, view.property.house.district], [HOUSES.mushin.label, 'Mushin']);
  assert.equal(view.travel.destinations.find((item) => item.id === 'home').district, 'Mushin');
});

test('the starter helper job cannot outpace a career track', () => {
  const helper = JOBS['community-helper'];
  assert.equal(helper.shift.cooldown, 4 * 3600);
  assert.equal(helper.shift.beta, true);
  const perDay = Math.floor(86400 / helper.shift.cooldown) * helper.shift.reward;
  for (const job of TRACKS) assert.ok(perDay < job.ladder[0].pay, `${job.id}: one entry shift (${job.ladder[0].pay}) beats a whole day of helper shifts (${perDay})`);
});

test('one Updates feed: rent due, paid and missed, loan paid and missed, promotion, illness and Governor news all arrive through notice.posted', () => {
  const DAY = 86400000;
  const state = onboard(createLife(null, at(MONDAY_9AM, 'updates', { isNew: true })));
  // The house system posts its own line once an upgrade is affordable (src/game/systems/estate.js); this test is about the bills.
  const kinds = () => state.social.notices.map((notice) => notice.kind).filter((kind) => kind !== 'house');
  const last = (kind) => state.social.notices.findLast((notice) => notice.kind === kind)?.text;
  assert.deepEqual(kinds(), [], 'moving in posts nothing');
  // Friday: one reminder naming what falls due at midnight — and only one, however often the life settles.
  const friday = MONDAY_9AM + 4 * DAY;
  advanceLife(state, 60, at(friday)); advanceLife(state, 60, at(friday + 60000)); advanceLife(state, 3600, at(friday + 3660000));
  assert.deepEqual(kinds(), ['rent-due']);
  assert.match(last('rent-due'), /^Due tomorrow \(Saturday\): rent ₦6,000 and loan ₦12,000\. You have ₦96,000\.$/);
  // Saturday: rent and the loan instalment are collected, each with its own line.
  const saturday = lagosDayStart(lagosTime(MONDAY_9AM).day + 5) + 60000;
  advanceLife(state, 3600, at(saturday));
  assert.deepEqual(kinds(), ['rent-due', 'rent', 'loan']);
  assert.match(last('rent'), /^Rent paid: ₦6,000 for your Yaba self-contain \(due Sat 10 Jan\)\.$/);
  assert.match(last('loan'), /^Loan instalment paid: ₦12,000 \(due Sat 10 Jan\)\. ₦60,000 left\.$/);
  assert.equal(state.cash, 78000);
  // The next week the wallet is empty: both bills are missed and say what is owed.
  state.cash = 0;
  advanceLife(state, 3600, at(saturday + 6 * DAY)); // Friday
  assert.match(last('rent-due'), /You have ₦0 — ₦18,000 short\.$/);
  advanceLife(state, 3600, at(saturday + 7 * DAY));
  assert.deepEqual(kinds().slice(-3), ['rent-due', 'rent-missed', 'loan-missed']);
  assert.match(last('rent-missed'), /Rent missed: ₦6,000 was due Sat 17 Jan\. You owe ₦6,000/);
  assert.match(last('loan-missed'), /Loan instalment missed: ₦12,000 was due Sat 17 Jan and you had ₦0\. A ₦500 fee was added\. ₦60,500 is now owed\./);
  // An early loan payment by the player is listed too.
  state.cash = 20000;
  assert.equal(act(state, 'economy.pay-loan', { mode: 'week' }, at(saturday + 7 * DAY)).ok, true);
  assert.match(last('loan'), /^You paid ₦12,000 towards your loan\. ₦48,500 left\.$/);
  // Promotion: performance and the track skill are both met.
  state.job = 'tech'; state.career.level = 1; state.career.performance = 100;
  addSkillXp(state, 'coding', xpForLevel(1), at(saturday + 7 * DAY));
  assert.equal(state.career.level, 2);
  assert.match(last('promotion'), /^Promoted to Junior Dev \(Tech\)\. Shifts now pay ₦5,400\.$/);
  // Illness from neglect, then a cure.
  state.needs.hunger = 5; state.needs.hygiene = 5; state.health.strain = 1199;
  advanceLife(state, 30, at(saturday + 7 * DAY + 30000));
  assert.equal(state.health.sick, true);
  assert.match(last('illness'), /^You fell sick from going hungry and unwashed/);
  emit(state, 'health.treat', { by: 'test' }, at(saturday + 7 * DAY + 60000));
  assert.equal(last('recovered'), 'You are well again.');
  // Governor news is posted by the server through a server-only action: once per item, never news older than the life.
  const news = [{ id: 'result-2936', title: 'Ada is the new Governor of Lagos', text: 'Elected with 1 of 1 vote.', at: saturday + 8 * DAY },
    { id: 'announcement-a1', title: 'Governor Ada announced', text: 'Sanitation day is <b>Saturday</b>', at: saturday + 8 * DAY + 1000 },
    { id: 'nominations-2900', title: 'Nominations are open', text: 'Old news', at: MONDAY_9AM - 30 * DAY }, { id: '<script>', title: 'x', at: 1 }, null];
  assert.equal(dispatch(state, { type: 'civic.news', payload: { items: news } }, at(saturday + 9 * DAY)).code, 'server_only');
  const server = { ...at(saturday + 9 * DAY), internal: true };
  assert.equal(dispatch(state, { type: 'civic.news', payload: { items: news } }, server).code, 'posted');
  assert.deepEqual(state.social.notices.slice(-2).map((notice) => [notice.kind, notice.text]), [['gov', 'Ada is the new Governor of Lagos: Elected with 1 of 1 vote.'], ['gov', 'Governor Ada announced: Sanitation day is <b>Saturday</b>']]);
  assert.deepEqual(state.civic.news, ['nominations-2900', 'result-2936', 'announcement-a1'], 'news from before the life is marked seen without being posted');
  assert.equal(dispatch(state, { type: 'civic.news', payload: { items: news } }, server).code, 'nothing_new');
  assert.equal(kinds().filter((kind) => kind === 'gov').length, 2);
  // The feed is bounded and survives a save round trip unchanged.
  assert.ok(state.social.notices.length <= 20);
  assert.deepEqual(createLife(structuredClone(state), at(saturday + 9 * DAY)).social.notices, state.social.notices);
});

test('gift cap in the merged economy: start cash, the loan principal, goal rewards, prizes and refunds are not "earned from work"; shift pay and paid gigs are', () => {
  const FRIEND = '11111111-2222-4333-8444-555555555555';
  const state = onboard(createLife(null, at(MONDAY_9AM, 'gifts', { isNew: true })));
  let now = MONDAY_9AM;
  const server = (seed) => ({ ...at(now, seed), internal: true });
  const gift = (amount, seed = `gift-${amount}-${now}`) => dispatch(state, { type: 'social.server', payload: { op: 'transfer-out', to: FRIEND, name: 'Bola', amount } }, server(seed));
  const run = (id, seconds) => { assert.equal(act(state, 'activity', { id }, at(now, id)).code, 'started', id); now += seconds * 1000; advanceLife(state, seconds, at(now)); };
  // ₦96,000 in hand — ₦60,000 of it borrowed — and none of it may be given away.
  assert.deepEqual([state.cash, state.social.earned, state.economy.loan.left], [96000, 0, 72000]);
  let refused = gift(500);
  assert.equal(refused.code, 'earn_first'); assert.match(refused.reason, /Earn at least ₦1,000 from paid work.*you have earned ₦0/);
  // Starter goals pay ₦500 and ₦1,000 each: rewards, not wages.
  state.spot = 'kitchen'; run('home-soak-garri', 5);
  assert.equal(state.ledger.at(-1).reason, 'Goal: Eat something'); assert.equal(state.social.earned, 0);
  // A gem-hunt prize, a furniture sale and a matured deposit are not wages either.
  for (const gem of state.civic.hunt.gems) gem.found = true;
  assert.equal(act(state, 'civic.hunt-claim', {}, at(now)).code, 'claimed');
  assert.equal(act(state, 'economy.open-deposit', { amount: 10000, term: 'd1' }, at(now)).code, 'deposit_opened');
  assert.equal(act(state, 'economy.close-deposit', { id: 'fd-1' }, at(now)).code, 'deposit_closed');
  assert.equal(state.social.earned, 0);
  assert.equal(gift(500).code, 'earn_first');
  assert.ok(state.cash > 99000, 'plenty of cash, still nothing earned');
  // One Tech shift at CcHub: ₦3,600 of wages.
  assert.equal(act(state, 'cancel', undefined, at(now)).code, 'idle');
  assert.equal(act(state, 'apply-job', { id: 'tech' }, at(now)).code, 'applied');
  if (state.activeAction) { now += 6000; advanceLife(state, 6, at(now)); } // the automatic commute, if it started
  state.location = 'cchub'; state.spot = 'work'; state.activeAction = null;
  run('tech-shift', JOBS.tech.shift.duration);
  assert.equal(state.ledger.findLast((entry) => entry.reason === 'Tech shift').amount, 3600);
  assert.equal(state.social.earned, 3600, 'shift pay is earned from work');
  assert.equal(viewLife(state, at(now)).social.transfer.leftToday, 3600);
  // The cap is what was earned — not the ₦100,000 in the wallet.
  refused = gift(4000);
  assert.equal(refused.code, 'gift_exceeds_earned'); assert.match(refused.reason, /You can still give ₦3,600/);
  assert.equal(gift(3000).code, 'sent');
  refused = gift(700);
  assert.equal(refused.code, 'gift_exceeds_earned'); assert.match(refused.reason, /You can still give ₦600/);
  // A paid gig counts too: Freelance Gig at the hot desks pays through the same activity engine.
  const gig = spotsOf('cchub').flatMap((spot) => spot.activities.map((def) => ({ spot: spot.id, def }))).find((item) => item.def.reward > 0 && !item.def.requiresJob && !item.def.requiresSkill);
  if (gig) {
    state.spot = gig.spot; for (const need of Object.keys(state.needs)) state.needs[need] = 90;
    const before = state.social.earned;
    run(gig.def.id, gig.def.duration);
    assert.equal(state.social.earned, before + gig.def.reward, `${gig.def.label} is paid work`);
  }
  // A returned gift restores the room it used, and repaying the loan changes nothing about what was earned.
  const earned = state.social.earned;
  assert.equal(dispatch(state, { type: 'social.server', payload: { op: 'transfer-in', from: FRIEND, name: 'Bola', amount: 3000, refund: true } }, server('refund')).code, 'received');
  assert.equal(act(state, 'economy.pay-loan', { mode: 'week' }, at(now)).ok, true);
  assert.equal(state.social.earned, earned);
  assert.equal(state.social.transfer.total, 0);
});
