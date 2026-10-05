// Property-style test: seeded random action sequences against the rules engine. Whatever a player
// sends, in whatever order, with whatever payload:
//   cash == what the life started with + the sum of every ledger line (nothing appears or vanishes),
//   cash is never negative, counted items are never negative, needs stay in range,
//   the statement reconciles, a reload changes nothing, and the same inputs replay to the same life.
// The server half (the same request sent twice is applied once) is in server/replay.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, actionTypes, spotsOf } from '../life.ts';
import { makeRng } from './util.ts';
import { serverOnlyReason } from './registry.ts';
import type { ActionBody } from '../types/actions.ts';
import type { LifeContextInit, LifeState, StartHomeId } from '../types/life.ts';
import { statementOf } from './systems/wallet.ts';
import { MAX_STACK } from './systems/inventory.ts';
import { VENUES } from './content/venues.ts';
import { ALL_MODES } from './content/travel.ts';
import { JOBS } from './content/jobs.ts';
import { HOUSES } from './content/housing.ts';
import { CARS } from './content/cars.ts';
import { FURNITURE } from './content/furniture.ts';
import { INGREDIENTS } from './content/food.ts';
import { EVENTS } from './content/events.ts';
import { LOTTERY, START_HOMES, TRAITS, DREAMS } from './content/traits.ts';
import { DEPOSIT_TERMS, DEPOSIT_TOTAL_CAP } from './systems/economy.ts';
import { GIG_DAILY_LIMIT } from './content/venues.ts';

const CITY = 'lagos';
const START = Date.UTC(2026, 0, 5, 9);
const LOOK = { body: 'woman', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
type Rng = () => number;
/** A random element. Every list passed is non-empty, so the index is always in range. */
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
/** An action as the walk sends it: the payload is often deliberately not an object. */
type Body = { type: string; payload?: unknown; actionId?: string };
/** One random step: seconds to pass, or an action body. */
type Step = { wait: number; type?: undefined; payload?: undefined } | { wait?: undefined; type: string; payload?: unknown };
type TraceEntry = { wait: number; body?: undefined; ok?: undefined; code?: undefined } | { wait?: undefined; body: Body; ok: boolean; code: string };
/** Send a body that may be malformed on purpose: dispatch validates every field itself. */
const sendBody = (state: LifeState, body: Body, context: LifeContextInit) => dispatch(state, body as ActionBody, context);
const HOSTILE: unknown[] = [undefined, null, '', '__proto__', 'constructor', -1, 1e99, NaN, {}, [], { id: { toString: 1 } }, 'x'.repeat(200)];

/** One random step: an action body, or a number of seconds to let pass. */
function step(rng: Rng, state: LifeState): Step {
  const roll = rng();
  const venues = Object.keys(VENUES);
  if (roll < 0.16) return { wait: pick(rng, [1, 5, 9, 20, 45, 300, 3600, 4 * 3600, 26 * 3600, 8 * 86400]) };
  if (roll < 0.32) return { type: 'travel', payload: { id: pick(rng, venues), mode: pick(rng, Object.keys(ALL_MODES)) } };
  if (roll < 0.40) return { type: 'spot', payload: { id: pick(rng, spotsOf(state.location, 'lagos')).id } };
  if (roll < 0.62) {
    const here = spotsOf(state.location, 'lagos').find((spot) => spot.id === state.spot)?.activities ?? [];
    const def = pick<{ id: string; choices?: readonly { id: string }[] }>(rng, here.length ? here : [{ id: 'nap' }]);
    return { type: 'activity', payload: { id: def.id, ...(def.choices ? { choice: pick(rng, def.choices).id } : {}) } };
  }
  if (roll < 0.66) return { type: 'cancel' };
  if (roll < 0.70) return { type: pick(rng, ['apply-job', 'career.switch']), payload: { id: pick(rng, Object.keys(JOBS)) } };
  if (roll < 0.72) return { type: pick(rng, ['career.quit', 'civic.hunt-search', 'civic.hunt-claim', 'civic.refresh', 'economy.pay-rent', 'home.kitchen-unpack']) };
  if (roll < 0.76) return { type: 'economy.open-deposit', payload: { amount: pick(rng, [1000, 5000, 25000, 50000, 999, 1e12, -5, 2500.5]), term: pick(rng, [...Object.keys(DEPOSIT_TERMS), 'd9']) } };
  if (roll < 0.78) return { type: 'economy.close-deposit', payload: { id: pick(rng, [...state.economy.deposits.map((deposit) => deposit.id), 'fd-0']) } };
  if (roll < 0.80) return { type: 'economy.pay-loan', payload: { mode: pick(rng, ['week', 'all', 'none']) } };
  if (roll < 0.84) return { type: 'home.furniture-buy', payload: { item: pick(rng, Object.keys(FURNITURE)), x: Math.floor(rng() * 9), y: Math.floor(rng() * 9), rot: pick(rng, [0, 1, 2, 3]) } };
  if (roll < 0.87) return { type: 'home.furniture-sell', payload: rng() < 0.5 ? { id: pick(rng, [...(state.home.items ?? []).map((item) => item.id), 'nope']) } : { item: pick(rng, Object.keys(FURNITURE)) } };
  if (roll < 0.90) return { type: 'home.grocery-buy', payload: { id: pick(rng, Object.keys(INGREDIENTS)), packs: pick(rng, [1, 2, 20, 21, 0, -3, 1.5]) } };
  if (roll < 0.92) return { type: 'property.house-move', payload: { id: pick(rng, Object.keys(HOUSES)) } };
  if (roll < 0.95) return { type: pick(rng, ['property.car-buy', 'property.car-sell', 'property.car-use']), payload: { id: pick(rng, Object.keys(CARS)) } };
  if (roll < 0.97) return { type: 'world.roadside', payload: { choice: pick(rng, Object.values(EVENTS).flatMap((event) => event.choices.map((choice) => choice.id))) } };
  // Anything at all: every registered action type with a hostile payload.
  return { type: pick(rng, actionTypes()), payload: rng() < 0.5 ? { id: pick(rng, HOSTILE), amount: pick(rng, HOSTILE), mode: pick(rng, HOSTILE), item: pick(rng, HOSTILE) } : pick(rng, HOSTILE) };
}

function newLife(rng: Rng, seedName: string) {
  let now = START;
  // Most lives start as guests of the quick start; of those, a third stay guests for the whole run (playing in public, never settling in).
  const state = createLife(null, { now, cityId: CITY, isNew: true, quickStart: rng() < 0.8 });
  const send = (type: string, payload: Record<string, unknown>, id: string) => sendBody(state, { type, payload, actionId: id }, { now, cityId: CITY, actionId: id });
  if (state.onboarding.required) {
    assert.equal(send('onboarding.quick-start', { look: LOOK }, `${seedName}-play`).code, 'playing');
    if (rng() < 0.34) return { state, now };
    const traits = Object.keys(TRAITS); const first = pick(rng, traits); const second = pick(rng, traits.filter((id) => id !== first));
    send('onboarding.traits', { traits: [first, second] }, `${seedName}-traits`);
    send('onboarding.dream', { dream: pick(rng, Object.keys(DREAMS)) }, `${seedName}-dream`);
    send('onboarding.lottery', {}, `${seedName}-lottery`);
    const rolled = state.onboarding.lottery;
    assert.ok(rolled, 'the lottery was rolled');
    // The keys of START_HOMES are StartHomeIds.
    const homes = (Object.keys(START_HOMES) as StartHomeId[]).filter((house) => !LOTTERY[rolled.id].locked?.[house]);
    assert.equal(send('onboarding.home', { house: pick(rng, homes) }, `${seedName}-home`).ok, true);
  }
  return { state, now };
}

/** Play `steps` random steps. Returns the trace, the final state and the running totals. */
function play(seedName: string, steps: number, check?: (state: LifeState, expectedCash: number, index: number, next: Step, now: number) => void) {
  const rng = makeRng(seedName);
  const life = newLife(rng, seedName);
  const { state } = life;
  let now = life.now, sum = 0, lastLine = state.ledger.at(-1) ?? null;
  // The life began with the seed and whatever creation paid: everything from here on must be in the ledger.
  const opening = state.cash - state.ledger.reduce((total, line) => total + line.amount, 0);
  sum = state.ledger.reduce((total, line) => total + line.amount, 0);
  const trace: TraceEntry[] = [];
  const collect = () => {
    let fresh = 0;
    for (let i = state.ledger.length - 1; i >= 0 && state.ledger[i] !== lastLine; i--) fresh += 1;
    for (const line of state.ledger.slice(state.ledger.length - fresh)) sum += line.amount;
    lastLine = state.ledger.at(-1) ?? lastLine;
  };
  for (let i = 0; i < steps; i++) {
    const next = step(rng, state);
    if (next.type === undefined) {
      now += next.wait * 1000;
      advanceLife(state, next.wait, { now, cityId: CITY });
      trace.push({ wait: next.wait });
    } else {
      const actionId = `${seedName}-${i}`;
      const body = { type: next.type, payload: next.payload, actionId };
      const ctx = { now, cityId: CITY, actionId };
      const result = sendBody(state, body, ctx);
      trace.push({ body: structuredClone(body), ok: result.ok, code: result.code });
      assert.equal(typeof result.ok, 'boolean'); assert.equal(typeof result.code, 'string', `${next.type} returned a code`);
      if (!result.ok && serverOnlyReason(next.type)) assert.equal(result.code, 'server_only');
    }
    collect();
    check?.(state, opening + sum, i, next, now);
  }
  return { state, trace, opening, sum, now };
}

function invariants(state: LifeState, expectedCash: number, index: number, next: Step, now: number) {
  const where = `step ${index} ${JSON.stringify(next).slice(0, 120)}`;
  // A reload (what the server does before every settlement) changes nothing — after EVERY step, so
  // a field some system wrote without declaring or rebuilding it is caught where it was written.
  assert.deepEqual(createLife(structuredClone(state), { now, cityId: CITY }), state, `sanitize is a fixed point at ${where}`);
  assert.equal(state.cash, expectedCash, `cash equals start + Σ ledger at ${where}`);
  assert.ok(Number.isSafeInteger(state.cash) && state.cash >= 0, `cash ${state.cash} at ${where}`);
  for (const [item, count] of Object.entries(state.inventory)) assert.ok(Number.isSafeInteger(count) && count > 0 && count <= MAX_STACK, `inventory ${item}=${count} at ${where}`);
  for (const [need, value] of Object.entries(state.needs)) assert.ok(value >= 0 && value <= 100, `${need}=${value} at ${where}`);
  const locked = state.economy.deposits.reduce((total, deposit) => total + deposit.amount, 0);
  assert.ok(locked <= DEPOSIT_TOTAL_CAP && state.economy.deposits.length <= 3, `deposits at ${where}`);
  assert.ok(state.economy.rent.arrears >= 0 && (state.economy.loan?.left ?? 0) >= 0, `debts at ${where}`);
  assert.ok(state.travel.gigs.count <= GIG_DAILY_LIMIT, `gig count at ${where}`);
  const line = state.ledger.at(-1);
  if (line) assert.equal(line.balance, state.cash, `the last ledger line ends at the balance at ${where}`);
  // A guest of the quick start never reaches a state the economy takes as settled, whatever is thrown at it.
  if (state.onboarding.stage === 'guest') {
    assert.deepEqual([state.economy.rent.house, state.economy.loan, state.economy.billedWeek, state.economy.started, state.home.stocked, state.onboarding.done],
      [null, null, null, false, false, false], `a guest has no rent house, loan, bills or kitchen at ${where}`);
    assert.ok(state.location !== 'home' && !(state.activeAction && state.activeAction.id === 'home'), `a guest is never at home or on the way there at ${where}`);
    // The economy's own lines are 'Rent: <house> (due …)' and 'Rent arrears: …'. ('Rent a Cabana' at the beach is an activity a guest may buy.)
    const settledLine = state.ledger.find((entry) => /^(Rent:|Rent arrears|Loan repayment|Start cash|Moved)/.test(entry.reason));
    assert.equal(settledLine, undefined, `no rent, loan, start cash or move in a guest's ledger at ${where}`);
  }
}

test('random play: cash is always start + Σ ledger, nothing goes negative, and the statement reconciles', () => {
  let actions = 0, accepted = 0, moved = 0;
  const stages = { guest: 0, settled: 0, plain: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const run = play(`conservation-${seed}`, 400, invariants);
    actions += run.trace.filter((entry) => entry.body).length;
    accepted += run.trace.filter((entry) => entry.ok).length;
    moved += run.sum !== 0 ? 1 : 0;
    const statement = statementOf(run.state);
    assert.equal(statement.reconciled, true, `seed ${seed}: ${statement.problems.join(' ')}`);
    assert.equal(statement.closing, run.opening + run.sum);
    // A reload (what the server does before every settlement) changes nothing.
    const reloaded = createLife(structuredClone(run.state), { now: run.now, cityId: CITY });
    assert.deepEqual(reloaded, run.state, `seed ${seed}: sanitize is a fixed point of a played life`);
    stages[run.state.onboarding.stage === 'guest' ? 'guest' : run.state.onboarding.done ? 'settled' : 'plain'] += 1;
  }
  assert.ok(stages.guest >= 8 && stages.settled >= 20, `the walk covers lives that stayed guests (${stages.guest}) and lives that settled in (${stages.settled})`);
  // The walk must actually exercise the game, not bounce off refusals.
  assert.ok(actions > 15000 && accepted > 4000 && moved >= 55, `${actions} actions, ${accepted} accepted, ${moved} of 60 lives moved money`);
});

test('random play replays exactly: the same inputs give the same life, step for step', () => {
  for (const seed of [3, 17, 42]) {
    const first = play(`replay-${seed}`, 500);
    const second = play(`replay-${seed}`, 500);
    assert.deepEqual(second.trace, first.trace, `seed ${seed}: every result code is the same`);
    assert.deepEqual(second.state, first.state, `seed ${seed}: and so is the final life`);
    // Feeding the recorded trace back through the engine — not the generator — gives the same life too.
    const rng = makeRng(`replay-${seed}`);
    const life = newLife(rng, `replay-${seed}`);
    let now = life.now;
    for (const entry of first.trace) {
      if (entry.wait) { now += entry.wait * 1000; advanceLife(life.state, entry.wait, { now, cityId: CITY }); continue; }
      assert.ok(entry.body, 'a trace entry that did not wait holds its body');
      const result = sendBody(life.state, structuredClone(entry.body), { now, cityId: CITY, actionId: entry.body.actionId });
      assert.deepEqual([result.ok, result.code], [entry.ok, entry.code]);
    }
    assert.deepEqual(life.state, first.state);
  }
});
