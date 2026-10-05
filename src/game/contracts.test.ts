import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// Contract tests for the rules engine: the things a system could get wrong without anything
// failing until much later — unpaid metered gains, state that vanishes at the next load, a charge
// kept for an action that can no longer run, a random outcome a client can work out, and a timed
// action that moves the player without saying so. Each one uses test-only content registered
// through the same seams a feature owner uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, isDeparting, occupiesVenue, activeMoves } from '../life.ts';
import { registerSystem, systems, activeHandler, undeclaredKeys, emit } from './registry.ts';
import { makeContext, makeRng, keyedSeed, sha256Hex, isRecord } from './util.ts';
import { rebuildCatalogue, usedShare, isMetered, MAX_LOCKED_SECONDS } from './systems/activities.ts';
import { statementOf } from './systems/wallet.ts';
import { VENUES } from './cities/lagos/venues.ts';

import type { ActionBody } from '../types/actions.ts';
import type { ActivityPlacement } from '../types/content.ts';
import type { AttachedActivity, EngineEvent, SystemDefinition } from '../types/registry.ts';
import type { ActionOutcome, ActivityAction, LifeContext, LifeContextInit, LifeState } from '../types/life.ts';

const NOW = Date.UTC(2026, 0, 5, 9); // Monday 10:00 in Lagos
const CITY = 'lagos';
const where: ActivityPlacement = { venue: 'park', spot: 'contract', spotLabel: 'Contract stall' };
const startPaid: AttachedActivity = { id: 'contract-booth', label: 'Contract Booth', duration: 10, cost: 100, chargeOn: 'start', effects: { fun: 5 }, where };
const meteredLater: AttachedActivity = { id: 'contract-massage', label: 'Contract Massage', duration: 10, cost: 100, effectsPerSecond: { energy: 1 }, where };
const meteredFirst: AttachedActivity = { id: 'contract-sauna', label: 'Contract Sauna', duration: 10, cost: 200, chargeOn: 'start', effectsPerSecond: { hygiene: 2 }, where };
const meteredSunk: AttachedActivity = { id: 'contract-ride', label: 'Contract Ride', duration: 10, cost: 60, chargeOn: 'start', refundOnCancel: false, xpPerSecond: { charisma: 1 }, where };
const freeRest: AttachedActivity = { id: 'contract-rest', label: 'Contract Rest', duration: 10, effectsPerSecond: { energy: 2 }, where };
const lumpLater: AttachedActivity = { id: 'contract-meal', label: 'Contract Meal', duration: 10, cost: 300, effects: { hunger: 20 }, where };

/** A life as the test-only 'contract' system sees it: its own slice, plus the keys it writes without declaring them. */
interface ContractLife extends LifeState {
  contract: { kept: number; surcharge: boolean; leakOnAdvance?: boolean };
  strayFromSanitize?: number;
  strayFromAction?: number;
  strayFromAdvance?: boolean;
}
/** An action or event name that only this test registers, so it is not in the engine's typed maps. */
type TestOutcome = ActionOutcome;

// The test systems below are deliberately outside the typed maps (their ids, actions, events and timed-action kinds exist
// only here), so each definition crosses the registry boundary through one cast.
const asSystem = (def: object): SystemDefinition => def as unknown as SystemDefinition;
/** emit() for an event name only this test knows. */
const emitTest = (state: LifeState, event: string, data: object, ctx: LifeContextInit): void => emit(state, event as EngineEvent, data as never, makeContext({ ...ctx, cityId: state.estate.city }));
/** dispatch() for an action type only this test knows (or a malformed body): the engine's own validation is what is under test. */
const dispatchTest = (state: LifeState, body: { type: string; payload?: object; actionId?: string }, ctx: LifeContextInit): ActionOutcome => dispatch(state, body as unknown as ActionBody, ctx);

registerSystem(asSystem({
  id: 'contract',
  stateKeys: ['contract'],
  sanitize(input: Record<string, unknown>, state: ContractLife) {
    const saved = isRecord(input.contract) ? input.contract : {};
    state.contract = { kept: typeof saved.kept === 'number' && Number.isSafeInteger(saved.kept) ? saved.kept : 0, surcharge: saved.surcharge === true };
    if (input.contractLeak === 'sanitize') state.strayFromSanitize = 1; // a sanitize that writes a key it never declared
  },
  actions: {
    'contract.keep'(state: ContractLife): TestOutcome { state.contract.kept += 1; return { ok: true, code: 'kept', state }; },
    'contract.leak'(state: ContractLife): TestOutcome { state.strayFromAction = 42; return { ok: true, code: 'leaked', state }; },
    'contract.arm'(state: ContractLife): TestOutcome { state.contract.leakOnAdvance = true; return { ok: true, code: 'armed', state }; },
    'contract.roll'(state: ContractLife, _payload: unknown, ctx: LifeContext): TestOutcome { state.message = JSON.stringify([ctx.rng(), ctx.rng(), Object.keys(ctx).sort()]); return { ok: true, code: 'rolled', state }; },
    'contract.teleport'(state: LifeState): TestOutcome { Object.assign(state, { activeAction: { kind: 'contract-sneak', id: 'library', duration: 5, remaining: 5 } }); // a kind outside ActiveKind
      return { ok: true, code: 'started', state }; },
    'contract.stroll'(state: LifeState): TestOutcome { Object.assign(state, { activeAction: { kind: 'contract-stroll', id: 'library', duration: 5, remaining: 5 } }); // a kind outside ActiveKind
      return { ok: true, code: 'started', state }; },
  },
  advance(state: ContractLife) { if (state.contract.leakOnAdvance) state.strayFromAdvance = true; },
  on: { 'contract.echo': (state: ContractLife, data: object, ctx: LifeContext) => emitTest(state, 'contract.echo', data, ctx) }, // a listener that re-emits what it hears: a loop
  modifiers: { 'activity.cost': (value: number, state: ContractLife, { def }: { def: { id: string } }) => (state.contract?.surcharge && def.id === 'contract-booth' ? value + 50 : value) },
  activities: [startPaid, meteredLater, meteredFirst, meteredSunk, freeRest, lumpLater],
  active: {
    // Declared honestly: a timed action that takes the player somewhere else.
    'contract-stroll': { moves: true, sanitize: (value: { id: string }) => (Object.hasOwn(VENUES, value.id) ? {} : null), complete(state: { location: string; spot: string | null }, active: { id: string }) { state.location = active.id; state.spot = null; } },
    // Declared wrongly: it moves the player but says it does not. The engine must refuse to complete it.
    'contract-sneak': { moves: false, sanitize: () => ({}), complete(state: { location: string; spot: string | null }, active: { id: string }) { state.location = active.id; state.spot = null; } },
  },
}));
rebuildCatalogue('lagos');

const at = (now = NOW): LifeContextInit => ({ now, cityId: CITY });
/** The context of the server loading its OWN save (life-service.js settleCity): the only one allowed to settle money at load. */
const stored = (now = NOW): LifeContextInit => ({ ...at(now), trustedSave: true });
const fresh = (saved: Record<string, unknown> = {}): ContractLife => createLife({ spot: 'contract', needs: { hunger: 50, energy: 50, fun: 50, social: 50, hygiene: 50, bladder: 50 }, ...saved }, at()) as ContractLife;
const start = (state: LifeState, id: string) => dispatch(state, { type: 'activity', payload: { id } }, at());
const run = (state: LifeState, seconds: number) => advanceLife(state, seconds, at(NOW + seconds * 1000));
const cancel = (state: LifeState, seconds: number) => dispatch(state, { type: 'cancel' }, at(NOW + seconds * 1000));
const lines = (state: LifeState) => state.ledger.map((line) => [line.amount, line.reason]);

/** The running timed action, narrowed to an activity (the only kind that carries `paid`). */
const activityOf = (state: LifeState): ActivityAction => {
  const active = state.activeAction;
  assert.ok(active && active.kind === 'activity', 'an activity is running');
  return active;
};

// ---- paid per-second gains are always paid for -------------------------------------------------

test('a metered activity charged on completion costs the time used when it is stopped early', () => {
  const state = fresh();
  assert.equal(start(state, 'contract-massage').code, 'started');
  assert.equal(state.cash, 5000, 'nothing is taken at the start');
  run(state, 9);
  const energy = state.needs.energy;
  assert.ok(energy > 58, 'nine seconds of Energy accrued');
  const result = cancel(state, 9);
  assert.deepEqual([result.ok, result.code], [true, 'cancelled']);
  assert.equal(state.cash, 4910, '₦100 × 9 ÷ 10 = ₦90');
  assert.equal(state.needs.energy, energy, 'the gain is kept');
  assert.deepEqual(lines(state), [[-90, 'Contract Massage (stopped early)']]);
  assert.equal(state.message, 'Contract Massage stopped early. You paid ₦90 for the time used.');
  assert.equal(statementOf(state).reconciled, true);
  // Stopped before anything accrued: nothing is owed. Run to the end: the whole price, once.
  const instant = fresh(); start(instant, 'contract-massage'); cancel(instant, 0);
  assert.deepEqual([instant.cash, instant.ledger.length, instant.message], [5000, 0, 'Action cancelled.']);
  const whole = fresh(); start(whole, 'contract-massage'); run(whole, 10);
  assert.deepEqual([whole.cash, whole.activeAction], [4900, null]);
  assert.deepEqual(lines(whole), [[-100, 'Contract Massage']]);
  // A fraction of a second is rounded up to a whole naira, never down to free.
  const brief = fresh(); start(brief, 'contract-massage'); run(brief, 0.01); cancel(brief, 0.01);
  assert.equal(brief.cash, 4999);
});

test('a metered activity charged at the start refunds only the unused part; a sunk cost refunds nothing', () => {
  const state = fresh();
  start(state, 'contract-sauna');
  assert.deepEqual([state.cash, activityOf(state).paid], [4800, 200]);
  run(state, 3);
  cancel(state, 3);
  assert.equal(state.cash, 4940, '₦200 × 3 ÷ 10 = ₦60 used, ₦140 back');
  assert.deepEqual(lines(state), [[-200, 'Contract Sauna'], [140, 'Refund: Contract Sauna']]);
  assert.equal(state.message, 'Contract Sauna stopped early. ₦140 was refunded for the unused time.');
  assert.ok(state.needs.hygiene > 55);
  const sunk = fresh(); start(sunk, 'contract-ride'); run(sunk, 2); cancel(sunk, 2);
  assert.deepEqual([sunk.cash, sunk.ledger.length], [4940, 1], 'refundOnCancel: false stays a sunk cost');
});

test('activities that give nothing until they finish keep their rule: cancelling is free, and free rest keeps its gain', () => {
  const meal = fresh(); start(meal, 'contract-meal'); run(meal, 9); cancel(meal, 9);
  assert.deepEqual([meal.cash, meal.ledger.length, meal.needs.hunger <= 50], [5000, 0, true], 'charged on completion, nothing delivered, nothing owed');
  const booth = fresh(); start(booth, 'contract-booth'); run(booth, 9); cancel(booth, 9);
  assert.equal(booth.cash, 5000, 'charged at the start, nothing delivered: refunded in full');
  assert.deepEqual(lines(booth), [[-100, 'Contract Booth'], [100, 'Refund: Contract Booth']]);
  // Free metered rest — the shape of sleep and the nap — keeps what accrued and costs nothing.
  const rest = fresh(); start(rest, 'contract-rest'); run(rest, 4); cancel(rest, 4);
  assert.deepEqual([rest.cash, rest.ledger.length], [5000, 0]);
  assert.ok(rest.needs.energy > 57, 'early wake keeps the gain');
  // The real nap, at home.
  const home = createLife({ location: 'home', spot: 'bedroom', needs: { energy: 40 } }, at());
  assert.equal(dispatch(home, { type: 'activity', payload: { id: 'nap' } }, at()).code, 'started');
  advanceLife(home, 8, at(NOW + 8000));
  const gained = home.needs.energy;
  assert.equal(dispatch(home, { type: 'cancel' }, at(NOW + 8000)).code, 'cancelled');
  assert.deepEqual([home.cash, home.ledger.length, home.needs.energy], [5000, 0, gained]);
  assert.ok(gained > 40);
});

test('metered pricing helpers: the share is price × elapsed ÷ duration, rounded up and never above the price', () => {
  assert.equal(usedShare(100, { duration: 10, remaining: 1 }), 90);
  assert.equal(usedShare(100, { duration: 10, remaining: 10 }), 0);
  assert.equal(usedShare(100, { duration: 10, remaining: 0 }), 100);
  assert.equal(usedShare(100, { duration: 10, remaining: -5 }), 100);
  assert.equal(usedShare(7, { duration: 3, remaining: 2 }), 3, '7 ÷ 3 = 2.33 → 3');
  assert.equal(usedShare(0, { duration: 3, remaining: 1 }), 0);
  assert.deepEqual([isMetered(meteredLater), isMetered(meteredSunk), isMetered(startPaid), isMetered({ effectsPerSecond: {} })], [true, true, false, false]);
});

test('a metered activity that can no longer be paid in full at the end takes what the wallet holds', () => {
  const state = fresh({ cash: 100 });
  start(state, 'contract-massage');
  state.cash = 30; state.ledger = []; state.ledgerDays = []; // a bill fell due meanwhile (test shortcut)
  run(state, 10);
  assert.equal(state.cash, 0, 'the gains were delivered, so the ₦30 that is there is taken');
  assert.match(state.message, /only had ₦30/);
  const lump = fresh({ cash: 300 }); start(lump, 'contract-meal'); lump.cash = 30; run(lump, 10);
  assert.equal(lump.cash, 30, 'an activity that delivered nothing still charges nothing');
});

// ---- state outside stateKeys cannot be written silently -----------------------------------------

test('a key nobody declared is refused the moment it is written: in an action, in a settlement and in sanitize', () => {
  const state = fresh();
  assert.throws(() => dispatchTest(state, { type: 'contract.leak' }, at()), /Undeclared state key "strayFromAction" after action "contract.leak"/);
  const settling = fresh();
  assert.equal(dispatchTest(settling, { type: 'contract.arm' }, at()).code, 'armed');
  assert.throws(() => advanceLife(settling, 1, at(NOW + 1000)), /Undeclared state key "strayFromAdvance" after advanceLife/);
  assert.throws(() => createLife({ contractLeak: 'sanitize' }, at()), /System "contract" wrote state key "strayFromSanitize" in sanitize\(\) without declaring it/);
  // A declared slice written by an action survives the reload it would otherwise be lost at.
  const kept = fresh();
  dispatchTest(kept, { type: 'contract.keep' }, at());
  assert.equal((createLife(structuredClone(kept), at()) as ContractLife).contract.kept, 1);
  assert.deepEqual(undeclaredKeys(kept), []);
  assert.deepEqual(undeclaredKeys({ ...kept, extra: 1 }), ['extra']);
});

test('every shipped system only ever leaves declared keys on a life, and each key has exactly one owner', () => {
  const declared = systems().flatMap((system) => system.stateKeys);
  assert.equal(new Set(declared).size, declared.length);
  const state = createLife(null, { ...at(), isNew: true });
  assert.deepEqual(Object.keys(state).sort(), [...declared].sort(), 'a new life has every declared key and nothing else');
  assert.deepEqual(createLife(structuredClone(state), at()), state, 'and reloading it changes nothing');
});

// ---- an action invalidated at load gives back what was paid --------------------------------------

test('a start-charged activity whose definition changed is refunded through the ledger, exactly once', (t) => {
  t.after(() => { startPaid.duration = 10; startPaid.cost = 100; rebuildCatalogue('lagos'); });
  const state = fresh();
  start(state, 'contract-booth');
  assert.deepEqual([state.cash, activityOf(state).paid], [4900, 100]);
  const saved = structuredClone(state);
  startPaid.duration = 20; startPaid.cost = 40; rebuildCatalogue('lagos'); // a deploy changed the activity: longer and cheaper
  // Anything that is not the server's own save is only cleaned up: no money moves, so no input can mint a refund.
  const untrusted = createLife(structuredClone(saved), at(NOW + 1000));
  assert.deepEqual([untrusted.activeAction, untrusted.cash, untrusted.ledger.length], [null, 4900, 1]);
  const loaded = createLife(saved, stored(NOW + 1000));
  assert.equal(loaded.activeAction, null, 'the saved action no longer matches and is dropped');
  assert.equal(loaded.cash, 5000, 'the ₦100 actually charged comes back, not the new ₦40 price');
  assert.deepEqual(lines(loaded), [[-100, 'Contract Booth'], [100, 'Refund: Contract Booth (no longer available)']]);
  assert.equal(loaded.message, 'Contract Booth is no longer available here, so it was stopped and ₦100 was refunded.');
  assert.equal(statementOf(loaded).reconciled, true);
  // Loading again — the server does on every request — refunds nothing more.
  const again = createLife(structuredClone(loaded), stored(NOW + 2000));
  assert.deepEqual([again.cash, again.ledger.length], [5000, 2]);
  assert.deepEqual(createLife(structuredClone(again), stored(NOW + 3000)), again);
});

test('a start-charged activity whose venue or definition is gone is refunded from the server’s own save, and from nothing else', (t) => {
  t.after(() => { rebuildCatalogue('lagos'); });
  const state = fresh();
  start(state, 'contract-booth');
  // The player's saved location is no longer the activity's venue.
  const moved = createLife({ ...structuredClone(state), location: 'library' }, stored(NOW + 1000));
  assert.deepEqual([moved.activeAction, moved.cash], [null, 5000]);
  // The activity id is not in the catalogue at all: the label is unknown; the amount is the one the server stored at the start.
  const gone = structuredClone(state);
  activityOf(gone).id = 'contract-removed';
  const loaded = createLife(structuredClone(gone), stored(NOW + 1000));
  assert.equal(createLife(structuredClone(gone), at(NOW + 1000)).cash, 4900, 'the same save from anywhere else refunds nothing');
  assert.deepEqual([loaded.activeAction, loaded.cash], [null, 5000]);
  assert.equal(loaded.ledger.at(-1)?.reason, 'Refund: an activity (no longer available)');
  // Input that only CLAIMS a payment gets nothing — it is not the server's save, whatever it says it paid.
  const forged = createLife({ spot: 'contract', activeAction: { kind: 'activity', id: 'contract-removed', duration: 10, remaining: 5, paid: 4000 } }, at());
  assert.deepEqual([forged.activeAction, forged.cash, forged.ledger.length], [null, 5000, 0]);
  const inflated = createLife({ spot: 'contract', location: 'library', activeAction: { kind: 'activity', id: 'contract-booth', duration: 10, remaining: 5, paid: 4000 } }, at());
  assert.deepEqual([inflated.activeAction, inflated.cash, inflated.ledger.length], [null, 5000, 0], 'also for a known activity');
  // And while such an action is still valid, a claimed amount above the price is cut down to it.
  const running = createLife({ spot: 'contract', activeAction: { kind: 'activity', id: 'contract-booth', duration: 10, remaining: 5, paid: 4000 } }, at());
  assert.equal(activityOf(running).paid, 100);
});

test('the amount charged at the start is kept through a reload even when a modifier raised it above the listed price', () => {
  const state = fresh({ contract: { surcharge: true } });
  start(state, 'contract-booth');
  assert.deepEqual([state.cash, activityOf(state).paid], [4850, 150], 'the adjusted price was charged');
  const loaded = createLife(structuredClone(state), at(NOW + 1000));
  assert.equal(activityOf(loaded).paid, 150, 'not dropped for being above the listed ₦100');
  cancel(loaded, 1);
  assert.equal(loaded.cash, 5000, 'and the whole ₦150 is refunded');
});

test('invalidation settles a metered activity like an early stop: unused part refunded, or time used charged', (t) => {
  t.after(() => { meteredFirst.duration = 10; meteredLater.duration = 10; rebuildCatalogue('lagos'); });
  const sauna = fresh(); start(sauna, 'contract-sauna'); run(sauna, 4);
  const massage = fresh(); start(massage, 'contract-massage'); run(massage, 4);
  meteredFirst.duration = 30; meteredLater.duration = 30; rebuildCatalogue('lagos');
  const a = createLife(structuredClone(sauna), stored(NOW + 4000));
  assert.deepEqual([a.activeAction, a.cash], [null, 4920], '₦200 paid, 4 of 10 seconds used: ₦120 back');
  const b = createLife(structuredClone(massage), stored(NOW + 4000));
  assert.deepEqual([b.activeAction, b.cash], [null, 4960], '4 of 10 seconds at ₦100: ₦40');
  assert.equal(b.ledger.at(-1)?.reason, 'Contract Massage (stopped early)');
});

// ---- randomness cannot be worked out from what a client knows -------------------------------------

test('a salted context keys the generator with a secret that is not in the context', () => {
  const roll = (salt: string | null, actionId = '1:a') => JSON.parse(dispatchTest(fresh(), { type: 'contract.roll', actionId }, { ...at(), actionId, ...(salt ? { salt } : {}) }).state.message);
  const [first, second, keys] = roll('secret-salt-0000-0001');
  assert.deepEqual(keys, ['actionId', 'cityId', 'now', 'rng'], 'the salt is consumed: no system can read it');
  assert.deepEqual(roll('secret-salt-0000-0001').slice(0, 2), [first, second], 'the same action on the same life rolls the same dice');
  assert.notDeepEqual(roll('secret-salt-0000-0002').slice(0, 2), [first, second], 'another life rolls differently');
  assert.notDeepEqual(roll('secret-salt-0000-0001', '1:b').slice(0, 2), [first, second]);
  // What a client can compute — the unsalted generator for its own action ID — is not what the server rolls.
  const guess = makeRng(`${CITY}|action|1:a`);
  assert.notEqual(guess(), first);
  assert.deepEqual(roll(null).slice(0, 1), [makeRng(`${CITY}|action|1:a`)()], 'without a salt (tests, the browser preview) the engine is unchanged');
  // Settlements and creation are keyed the same way.
  const settled = (salt: string | undefined) => { const ctx = makeContext({ now: NOW, cityId: CITY, seed: 'settle|1|2', salt }); return ctx.rng(); };
  assert.notEqual(settled('secret-salt-0000-0001'), settled('secret-salt-0000-0002'));
  assert.notEqual(settled('secret-salt-0000-0001'), settled(undefined));
});

test('the keyed seed is a SHA-256 digest: outcomes say nothing about the salt', () => {
  // Known answers (FIPS 180-4 examples).
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.match(keyedSeed('salt', 'lagos|action|1:a'), /^k\|[0-9a-f]{64}$/);
  // Length-prefixed, so a salt cannot be traded for seed text: ("ab", "c|x") and ("ab|c", "x") differ.
  assert.notEqual(keyedSeed('ab', 'c|x'), keyedSeed('ab|c', 'x'));
  // Across many action IDs the keyed rolls stay uniform enough to play with.
  const rolls = Array.from({ length: 2000 }, (_, i) => makeRng(keyedSeed('secret-salt-0000-0001', `lagos|action|${i}`))());
  const mean = rolls.reduce((sum, value) => sum + value, 0) / rolls.length;
  assert.ok(mean > 0.46 && mean < 0.54, `mean ${mean}`);
  assert.ok(rolls.every((value) => value >= 0 && value < 1));
});

// ---- every timed action says whether it moves the player -------------------------------------------

test('every registered timed action declares whether it moves the player, and the declaration is enforced', () => {
  for (const system of systems()) for (const [kind, handler] of Object.entries(system.active || {})) {
    assert.equal(typeof handler.moves, 'boolean', `${system.id} · ${kind}`);
  }
  assert.deepEqual(['travel', 'commute', 'activity', 'call'].map((kind) => [kind, activeHandler(kind)?.moves]), [['travel', true], ['commute', true], ['activity', false], ['call', false]]);
  assert.throws(() => registerSystem(asSystem({ id: 'silent', stateKeys: [], sanitize() {}, active: { glide: { sanitize: () => ({}), complete() {} } } })), /Active kind "glide" must declare moves: true or false/);
  assert.equal(activeHandler('glide'), undefined, 'a refused kind is not registered');
  // A kind that says it does not move the player cannot move them.
  const sneaky = fresh();
  dispatchTest(sneaky, { type: 'contract.teleport' }, at());
  assert.equal(isDeparting(sneaky), false);
  assert.throws(() => advanceLife(sneaky, 5, at(NOW + 5000)), /Active kind "contract-sneak" changed the location but is not declared moves: true/);
});

test('isDeparting is true for every moving kind — a trip, the commute, a new kind — and for nothing else', () => {
  const idle = fresh();
  assert.deepEqual([isDeparting(idle), occupiesVenue(idle, 'park'), occupiesVenue(idle, 'library')], [false, true, false]);
  const trip = fresh(); dispatch(trip, { type: 'travel', payload: { id: 'library', mode: 'trek' } }, at());
  assert.deepEqual([trip.activeAction?.kind, trip.location, isDeparting(trip), occupiesVenue(trip, 'park')], ['travel', 'park', true, false]);
  const commuter = createLife({ location: 'home', spot: 'bedroom' }, at());
  assert.equal(dispatch(commuter, { type: 'apply-job', payload: { id: 'tech' } }, at()).ok, true);
  assert.deepEqual([commuter.activeAction?.kind, commuter.location, isDeparting(commuter), occupiesVenue(commuter, 'home')], ['commute', 'home', true, false]);
  // A kind added later is covered by its declaration alone: nothing else has to learn its name.
  const stroller = fresh(); dispatchTest(stroller, { type: 'contract.stroll' }, at());
  assert.deepEqual([isDeparting(stroller), occupiesVenue(stroller, 'park')], [true, false]);
  advanceLife(stroller, 5, at(NOW + 5000));
  assert.deepEqual([stroller.location, isDeparting(stroller), occupiesVenue(stroller, 'library')], ['library', false, true]);
  const busy = fresh(); start(busy, 'contract-rest');
  assert.deepEqual([isDeparting(busy), occupiesVenue(busy, 'park')], [false, true], 'an activity keeps the player in the venue');
  // A kind nobody registered is treated as moving: unknown is never "provably here".
  assert.equal(activeMoves('warp'), true);
  assert.equal(isDeparting({ location: 'park', activeAction: { kind: 'warp' } } as unknown as LifeState) /* a kind nobody registered */, true);
  assert.deepEqual([isDeparting(null), isDeparting({} as unknown as LifeState), occupiesVenue(null, 'park'), occupiesVenue(idle, undefined)], [false, false, false, false]);
  // Cancelling a departure puts the player back in the venue they never left.
  cancel(trip, 1); cancel(commuter, 1);
  assert.deepEqual([occupiesVenue(trip, 'park'), occupiesVenue(commuter, 'home')], [true, true]);
});

// ---- nothing is dropped quietly ---------------------------------------------------------------------

test('an event loop between systems is an error, not a silently dropped event', () => {
  const state = fresh();
  assert.throws(() => emitTest(state, 'contract.echo', {}, at()), /Event "contract.echo" was emitted 8 listeners deep/);
  // The depth counter is restored afterwards: ordinary events still work.
  assert.doesNotThrow(() => emitTest(state, 'contract.unheard', {}, at()));
  assert.equal(dispatchTest(state, { type: 'contract.keep' }, at()).code, 'kept');
});

test('the catalogue refuses an activity without a real duration and a long activity that cannot be cancelled', (t) => {
  const extra: object[] = [];
  registerSystem(asSystem({ id: 'contract-bad-content', stateKeys: [], sanitize() {}, get activities() { return extra; } }));
  t.after(() => { extra.length = 0; rebuildCatalogue('lagos'); });
  const where2 = { venue: 'park', spot: 'contract' };
  // Deliberately malformed content (no duration, zero, infinite, negative choice): typed loosely on purpose.
  const bad: [{ id: string; [field: string]: unknown }, RegExp][] = [
    [{ id: 'bad-endless', label: 'Endless', where: where2 }, /Activity bad-endless needs a duration/],
    [{ id: 'bad-zero', label: 'Zero', duration: 0, where: where2 }, /needs a duration/],
    [{ id: 'bad-infinite', label: 'Infinite', duration: Infinity, where: where2 }, /needs a duration/],
    [{ id: 'bad-choice', label: 'Choice', duration: 5, choices: [{ id: 'a', label: 'A', duration: -1 }], where: where2 }, /needs a duration/],
    [{ id: 'bad-locked', label: 'Locked', duration: MAX_LOCKED_SECONDS + 1, cancellable: false, where: where2 }, /cannot be cancelled, so it may last at most 300 seconds/],
  ];
  for (const [def, pattern] of bad) {
    extra.length = 0; extra.push(def);
    assert.throws(() => rebuildCatalogue('lagos'), pattern, def.id);
  }
  extra.length = 0; extra.push({ id: 'ok-locked', label: 'Locked', duration: MAX_LOCKED_SECONDS, cancellable: false, where: where2 });
  assert.doesNotThrow(() => rebuildCatalogue('lagos'));
});
