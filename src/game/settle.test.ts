import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// The merged first minutes, as rules: one home model for a new player (a local government and the free starter house
// there, chosen when settling in), guests who have no place yet, a first goal that completes on what it asks for,
// missions that wait until the life has settled in, and deliveries from the server that pass the creation hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts';
import { systems } from './registry.ts';
import { hasPlace } from './systems/estate.ts';
import { isGuestLife } from './systems/onboarding.ts';
import { LOTTERY } from './content/traits.ts';
import { HOUSE_TIERS } from './content/world.ts';
import { STARTER_GOALS } from './content/goals.ts';
import type { ActionBody, ActionResult, ActionType } from '../types/actions.ts';
import type { LotteryOutcome } from '../types/content.ts';
import type { EngineEventMap } from '../types/registry.ts';
import type { LifeContextInit, LifeState } from '../types/life.ts';
import type { GoalChip, LifeView } from '../types/view.ts';

const CITY = 'lagos', T0 = Date.UTC(2026, 0, 5, 9);
const LOOK = { body: 'woman', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };

/** The harness around one life: a clock the test moves, and the actions it sends. */
interface Game {
  now: number;
  state: LifeState;
  act<T extends ActionType>(type: T, payload?: unknown, extra?: LifeContextInit): ActionResult<T>;
  pass(seconds: number): void;
  finish(): void;
  run(spot: string, id: string): ActionResult<'activity'>;
  view(): LifeView;
  ready(): LotteryOutcome;
}
/** Narrows a lookup that must have found something. */
function need<T>(value: T | null | undefined, what = 'expected a value'): T { assert.ok(value, what); return value; }

/** The reason of a refused action ('' for a success or a refusal without one). */
const why = (result: { ok: boolean; reason?: string }): string => result.reason ?? '';
/** The goals chip, narrowed to the starter-goal variant (the one that carries an id, a target and an activity). */
const goalChip = (g: Game): Extract<GoalChip, { kind: 'goal' }> => { const chip = g.view().goals.chip; assert.equal(chip.kind, 'goal'); assert.ok(chip.kind === 'goal'); return chip; };

function game({ quickStart = true } = {}): Game {
  let seq = 0;
  const g: Game = {
    now: T0,
    state: createLife(null, { now: T0, cityId: CITY, isNew: true, quickStart }),
    // The payload is deliberately `unknown`: some tests send malformed or foreign input to prove the server-side validation.
    act: <T extends ActionType>(type: T, payload: unknown = {}, extra: LifeContextInit = {}) => { const actionId = `t-${++seq}`; return dispatch(g.state, { type, payload, actionId } as unknown as ActionBody<T>, { now: g.now, cityId: CITY, actionId, ...extra }); },
    pass: (seconds) => { g.now += seconds * 1000; advanceLife(g.state, seconds, { now: g.now, cityId: CITY }); },
    finish: () => { let guard = 0; while (g.state.activeAction && guard++ < 10) g.pass(g.state.activeAction.remaining); },
    run: (spot, id) => { g.finish(); if (g.state.spot !== spot) g.act('spot', { id: spot }); const started = g.act('activity', { id }); if (started.ok) g.finish(); return started; },
    view: () => viewLife(g.state, { now: g.now, cityId: CITY }),
    ready: () => { assert.equal(g.act('onboarding.traits', { traits: ['smooth-talker', 'clean-pikin'] }).ok, true); assert.equal(g.act('onboarding.dream', { dream: 'everybodys-padi' }).ok, true); assert.equal(g.act('onboarding.lottery').ok, true); return need(LOTTERY[need(g.state.onboarding.lottery).id]); },
  };
  return g;
}
const reasons = (state: LifeState) => state.ledger.map((line) => line.reason);

test('settling in: a local government and the free starter house there — no rent, the lottery’s start cash, life.started once', () => {
  const g = game();
  assert.equal(g.act('onboarding.quick-start', { look: LOOK }).code, 'playing');
  const economy = need(systems().find((system) => system.id === 'economy')), listeners = need(economy.on), original = need(listeners['life.started']), seen: EngineEventMap['life.started'][] = [];
  listeners['life.started'] = (state, data, ctx) => { seen.push(structuredClone(data)); return original(state, data, ctx); };
  try {
    const outcome = g.ready();
    assert.deepEqual(g.view().onboarding.own, { startCash: outcome.ownCash, rent: 0 }, 'the Home card is told what the own start pays');
    assert.equal(g.act('onboarding.home', {}).code, 'lga_required');
    assert.equal(g.act('onboarding.home', { lga: 'atlantis' }).code, 'invalid_lga');
    assert.equal(g.act('onboarding.home', { house: 'atlantis' }).code, 'invalid_house');
    assert.deepEqual([g.state.onboarding.done, seen.length, g.state.cash], [false, 0, 5000], 'a refused move-in changes nothing');
    const moved = g.act('onboarding.home', { lga: 'ikeja', via: 'device' });
    assert.equal(moved.code, 'life_started');
    const e = g.state.estate;
    assert.deepEqual([e.lga, e.lgaConfirmed, e.lgaVia, e.lgaAt, e.living, e.tier, e.plot], ['ikeja', true, 'device', T0, 'own', 'starter', null], 'the plot is the server’s to allocate');
    assert.deepEqual([g.state.onboarding.house, g.state.onboarding.stage, g.state.location, g.state.economy.rent.house, g.state.economy.started], [null, 'settled', 'home', null, true]);
    assert.equal(g.state.cash, outcome.ownCash, 'start cash tops the ₦5,000 seed up to the outcome’s own-house start');
    assert.ok(reasons(g.state).some((reason) => reason.startsWith('Start cash · Starter house, Ikeja')));
    const first = need(seen[0]);
    assert.deepEqual([seen.length, first.house, first.rent, first.startCash, first.lga, first.via, first.own, first.lottery], [1, null, 0, outcome.ownCash, 'ikeja', 'device', true, outcome.id]);
    assert.equal(Boolean(g.state.economy.loan), Boolean(outcome.loan), 'the loan outcome still starts its loan');
    const view = g.view();
    assert.deepEqual([view.estate.placed, need(view.estate.lga).id, view.home.grid ?? HOUSE_TIERS.starter.grid], [true, 'ikeja', HOUSE_TIERS.starter.grid]);
    assert.ok(g.state.home.items.length > 0 && g.state.home.stocked, 'the room is furnished and the kitchen stocked');
    assert.equal(hasPlace(g.state), true);
    assert.equal(g.act('onboarding.home', { lga: 'ikeja' }).code, 'already_onboarded');
    assert.equal(seen.length, 1);
    // Three Saturdays later: no rent line was ever written.
    g.pass(21 * 86400);
    assert.ok(!reasons(g.state).some((reason) => reason.startsWith('Rent')), 'no weekly rent on the starter house');
    assert.equal(g.state.estate.ground.arrears, 0, 'and no ground rent');
    // The rented homes are still there, as the alternative in the Houses app: moving to one starts its rent; the plot stays.
    const before = g.state.cash, rent = g.act('property.house-move', { id: 'mushin' });
    assert.deepEqual([rent.ok, g.state.estate.living, g.state.economy.rent.house, g.state.estate.lga], [true, 'rent', 'mushin', 'ikeja']);
    assert.ok(g.state.cash < before, 'the landlord and the agent are paid');
    assert.equal(g.act('estate.move-in').code, 'moved_in', 'and back into the own house, free');
    assert.equal(g.state.economy.rent.house, null);
  } finally { listeners['life.started'] = original; }
});

test('settling in with a rented home still works as it did, and may carry a local government', () => {
  const g = game();
  g.act('onboarding.quick-start', { look: LOOK });
  const outcome = g.ready();
  assert.equal(g.act('onboarding.home', { house: 'mushin', lga: 'surulere' }).code, 'life_started');
  assert.deepEqual([g.state.onboarding.house, g.state.property.house, g.state.economy.rent.house, g.state.estate.living, g.state.estate.lga, g.state.estate.lgaConfirmed], ['mushin', 'mushin', 'mushin', 'rent', 'surulere', true]);
  assert.equal(g.state.cash, outcome.startCash.mushin);
  const old = game();
  old.act('onboarding.quick-start', { look: LOOK }); old.ready();
  assert.equal(old.act('onboarding.home', { house: 'mushin' }).code, 'life_started');
  assert.deepEqual([old.state.estate.lga, old.state.estate.lgaConfirmed, hasPlace(old.state)], ['mushin', false, false], 'without a choice the local government is only a guess: not a resident until it is confirmed');
  assert.equal(old.act('estate.set-lga', { lga: 'mushin' }).code, 'lga_confirmed');
  assert.equal(hasPlace(old.state), true);
});

test('a guest has no local government, no house and no place: none can be taken or assigned before settling in', () => {
  const g = game();
  assert.deepEqual([isGuestLife(g.state), hasPlace(g.state)], [true, false]);
  g.act('onboarding.quick-start', { look: LOOK });
  assert.deepEqual([isGuestLife(g.state), hasPlace(g.state), g.view().estate.placed], [true, false, false]);
  const taken = g.act('estate.set-lga', { lga: 'ikeja' });
  assert.deepEqual([taken.code, g.state.estate.lgaConfirmed], ['settle_required', false]);
  assert.match(why(taken), /Settle in to get your home/);
  assert.equal(g.act('estate.assign', { lga: g.state.estate.lga, estate: 0, plot: 0 }).code, 'server_only');
  assert.deepEqual([g.act('estate.assign', { lga: g.state.estate.lga, estate: 0, plot: 0 }, { internal: true }).code, g.state.estate.plot], ['settle_required', null], 'not even the server gives a guest a plot');
  for (const type of ['estate.upgrade', 'estate.move-in', 'estate.style', 'estate.relocate'] as const) assert.equal(g.act(type, { to: 'bq' }).code, 'settle_required', type);
  assert.equal(g.state.estate.living, 'rent'); assert.equal(g.state.economy.rent.house, null, 'and a guest pays no rent either');
  // A life that was never asked to create a character (a host without the quick start) is not a guest.
  assert.equal(isGuestLife(game({ quickStart: false }).state), false);
});

test('the first goal completes on what it asks for: a round of Ayo — not on a shift or any other finished activity', () => {
  const g = game();
  g.act('onboarding.quick-start', { look: LOOK });
  assert.deepEqual([g.state.location, g.state.spot, goalChip(g).activity], ['park', 'trees', 'play-ayo']);
  assert.equal(g.run('trees', 'chill').ok, true);
  assert.equal(g.state.goals.chain, 0, 'another pastime in the park is not the goal');
  assert.equal(g.act('apply-job', { id: 'community-helper' }).ok, true);
  assert.equal(g.run('work', 'helper-shift').ok, true);
  assert.deepEqual([g.state.goals.chain, reasons(g.state).includes('Goal: Play a round of Ayo')], [0, false], 'a paid shift is not the goal');
  assert.equal(g.view().goals.chip.title, 'Play a round of Ayo', 'the one line of guidance still says what to do');
  assert.equal(g.run('trees', 'play-ayo').ok, true);
  assert.deepEqual([g.state.goals.chain, reasons(g.state).filter((reason) => reason === 'Goal: Play a round of Ayo').length], [1, 1]);
  assert.equal(STARTER_GOALS.length, 10);
});

test('the first goal never traps a guest who went elsewhere: the free thing the chip points at there completes it', () => {
  const g = game();
  g.act('onboarding.quick-start', { look: LOOK });
  assert.equal(g.act('travel', { id: 'library', mode: 'trek' }).ok, true); g.finish();
  if (g.state.travel.event) g.act('world.roadside', { choice: need(need(g.view().travel.event).choices.at(-1)).id });
  assert.equal(g.state.location, 'library');
  const chip = goalChip(g);
  assert.deepEqual([chip.kind, chip.id, chip.title, chip.go?.[0]], ['goal', 'first-fun', 'Do something fun', 'library']);
  assert.equal(g.run(need(chip.go?.[1]), need(chip.activity)).ok, true);
  assert.equal(g.state.goals.chain, 1, 'what the chip asked for completed the goal');
});

test('a new life that moves in straight away ends at home, with the first goal still pointing out to the park', () => {
  const g = game();
  g.act('onboarding.quick-start', { look: LOOK });
  g.ready();
  const moved = g.act('onboarding.home', { lga: 'ikeja' });
  assert.equal(moved.code, 'life_started');
  assert.equal(g.state.location, 'home', 'the player arrives in the new house');
  assert.match(g.state.message, /Open the Map to see the world\.$/);
  const chip = goalChip(g);
  assert.deepEqual([chip.id, chip.go, chip.title], ['first-fun', ['park', 'trees'], 'Play a round of Ayo'], 'the goal that needed the venue still says where to go');
  assert.match(chip.hint, /^Head out to Freedom Park/);
  const cash = g.state.cash;
  assert.equal(g.run('bedroom', 'nap').ok, true);
  assert.deepEqual([g.state.goals.chain, g.state.cash, reasons(g.state).includes('Goal: Play a round of Ayo')], [0, cash, false], 'a home nap does not complete the public activity the chip asks for');
  assert.equal(g.act('travel', { id: 'park', mode: 'trek' }).ok, true); g.finish();
  if (g.state.travel.event) g.act('world.roadside', { choice: need(need(g.view().travel.event).choices.at(-1)).id });
  assert.equal(g.run('trees', 'play-ayo').ok, true);
  assert.equal(g.state.goals.chain >= 1, true, 'and it is reachable: Ayo in the park completes it');
});

test('missions wait until the life has settled in: nothing is dealt, counted, shown or claimable to a guest', () => {
  const g = game();
  g.act('onboarding.quick-start', { look: LOOK });
  g.run('trees', 'play-ayo'); g.run('trees', 'chill');
  let view = g.view().missions;
  assert.match(need(view.locked), /Missions open once you have settled in/);
  assert.deepEqual([view.daily, view.weekly, view.claimable, g.state.missions.daily, g.state.missions.active.days, g.state.missions.stamps.days], [[], [], 0, [], 0, 0]);
  assert.equal(g.act('missions.claim', { id: 'd-fun' }).code, 'missions_locked');
  assert.equal(g.act('missions.reroll', { id: 'd-fun' }).code, 'missions_locked');
  g.pass(60);
  assert.deepEqual(g.state.missions.daily, [], 'time passing deals nothing to a guest');
  g.ready();
  assert.equal(g.act('onboarding.home', { lga: 'ikeja', stay: true }).code, 'life_started');
  view = g.view().missions;
  assert.deepEqual([view.locked, view.daily.length, view.weekly.length, view.daily.every((mission) => mission.n === 0)], [null, 3, 3, true], 'dealt at the moment of settling in, starting from nothing');
  // From here on what the life does counts.
  const fun = view.daily.find((mission) => mission.id === 'd-fun');
  g.run('trees', 'play-ayo');
  assert.equal(g.state.missions.active.days, 1);
  if (fun) assert.equal(g.view().missions.daily.find((mission) => mission.id === 'd-fun')?.n, 1);
  // A life that never was a guest has its missions from the start, as before.
  const plain = game({ quickStart: false });
  plain.pass(1);
  assert.deepEqual([plain.view().missions.locked, plain.view().missions.daily.length], [null, 3]);
});

test('a delivery from the server reaches a life that is still held for its look; everything else stays vetoed', () => {
  const g = game();
  assert.equal(g.state.onboarding.required, true);
  // A player cannot send a server-only action, held or not.
  assert.equal(g.act('growth.referral', { kind: 'reward', name: 'Ada' }).code, 'server_only');
  assert.equal(g.act('growth.table-result', { game: 'whot', label: 'Whot', won: true, human: true, counted: true }).code, 'server_only');
  // With the server's authority the three deliveries are applied (each by its own rules and caps)…
  const reward = g.act('growth.referral', { kind: 'reward', name: 'Ada' }, { internal: true });
  assert.deepEqual([reward.ok, g.state.cash > 5000, reasons(g.state).some((reason) => reason.startsWith('Referral reward'))], [true, true, true]);
  const table = g.act('growth.table-result', { game: 'whot', label: 'Whot', won: true, human: true, counted: true }, { internal: true });
  assert.notEqual(table.code, 'onboarding_required');
  const social = g.act('social.server', { op: 'no-such-op' }, { internal: true });
  assert.notEqual(social.code, 'onboarding_required', 'the social delivery reaches its own handler, which decides');
  // …and nothing else: the player-initiated server-only actions and every ordinary action stay refused.
  for (const type of ['civic.vote', 'civic.run', 'civic.news', 'civic.rent-ad', 'civic.shoutout', 'estate.released'] as const) {
    assert.equal(g.act(type, {}, { internal: true }).code, 'onboarding_required', type);
  }
  assert.equal(g.act('estate.assign', { lga: g.state.estate.lga, estate: 0, plot: 0 }, { internal: true }).code, 'onboarding_required');
  assert.equal(g.act('travel', { id: 'library', mode: 'trek' }).code, 'onboarding_required');
  assert.equal(g.act('travel', { id: 'library', mode: 'trek' }, { internal: true }).code, 'onboarding_required', 'server authority does not unlock a player action');
  assert.equal(g.act('social.server', { op: 'no-such-op' }).code, 'server_only');
});

test('the one line of guidance is always something that can be done: settled in before saying hello, it points the way out', () => {
  const g = game();
  g.act('onboarding.quick-start', { look: LOOK });
  g.run('trees', 'play-ayo');
  assert.deepEqual([goalChip(g).id, goalChip(g).open], ['say-hello', 'people']);
  g.ready();
  assert.equal(g.act('onboarding.home', { lga: 'ikeja' }).code, 'life_started');
  // At home, with "Say hello" still the current goal: Settle in is already met and waits its turn; nothing is lost.
  const chip = goalChip(g);
  assert.deepEqual([g.state.location, chip.id, chip.open, chip.params, g.state.goals.chain], ['home', 'say-hello', 'map', { destination: 'park' }, 1]);
  assert.match(chip.hint, /go out to Freedom Park/);
  assert.equal(g.act('travel', { id: 'park', mode: 'trek' }).ok, true); g.finish();
  if (g.state.travel.event) g.act('world.roadside', { choice: need(need(g.view().travel.event).choices.at(-1)).id });
  assert.equal(g.view().goals.chip.open, 'people', 'out in public, the goal opens the people who are there');
  const regular = need(g.view().social.here[0]);
  assert.equal(g.run('people', `npc-${regular.id}-hello`).ok, true);
  assert.deepEqual([g.state.goals.chain, goalChip(g).id], [3, 'eat'], 'the hello pays, and Settle in — met earlier — pays right behind it');
  assert.deepEqual(reasons(g.state).filter((reason) => reason.startsWith('Goal:')), ['Goal: Play a round of Ayo', 'Goal: Say hello to someone', 'Goal: Settle in']);
});
