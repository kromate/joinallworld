import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// Foundation tests for the rules engine: registry, sanitize, migration and the core systems.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife, migrate, STATE_VERSION, actionTypes, spotsOf } from '../life.ts';
import { VENUES } from './cities/lagos/venues.ts';

import { registerSystem, systems, emit, modify } from './registry.ts';
import { makeContext, makeRng, isRecord } from './util.ts';
import { lagosTime, isOpen, minutesUntilOpen, formatClock } from './clock.ts';
import { rebuildCatalogue } from './systems/activities.ts';
import { NEEDS, DECAY_FLOOR, OFFLINE_DECAY_CAP_SECONDS, NEED_DECAY_PER_HOUR } from './systems/needs.ts';
import { credit, debit, addMoodlet, moodOf, addSkillXp, skillLevel, setSkillLevel, xpForLevel, addItem, removeItems, countItem, SKILLS } from './api.ts';
import { statementOf, reasonGroup, LEDGER_LIMIT, LEDGER_DAYS, LEDGER_DAY_GROUPS } from './systems/wallet.ts';
import type { ActionBody } from '../types/actions.ts';
import type { EngineEvent, ModifierKey, SystemDefinition } from '../types/registry.ts';
import type { ActionOutcome, ActivityAction, LedgerDay, LedgerLine, LifeContext, LifeContextInit, LifeState, NeedId } from '../types/life.ts';

// addSkillXp only passes its context on to modifiers and listeners; the engine tolerates none, so the original calls gave none.
const NO_CTX = undefined as unknown as LifeContext;
const MONDAY_9AM = Date.UTC(2026, 0, 5, 8); // 09:00 in Lagos (UTC+1), a Monday
const at = (now: number, seed = 'test'): LifeContext => makeContext({ now, cityId: 'lagos', seed });

/** A value a test needs to be there: fails the test, with a message, instead of being read as `undefined`/`null`. */
const found = <T>(value: T | null | undefined, what: string): T => { assert.ok(value !== null && value !== undefined, `${what} exists`); return value; };
/** The reason a refused action gave. */
const reasonOf = (result: ActionOutcome): string => { assert.equal(result.ok, false); return found(result.ok ? undefined : result.reason, 'a reason'); };
/** The running timed action, narrowed to an activity (the only kind that carries `paid` and `choice`). */
const activityOf = (state: LifeState): ActivityAction => {
  const active = state.activeAction;
  assert.ok(active && active.kind === 'activity', 'an activity is running');
  return active;
};
/** The newest ledger line. */
const lastLine = (state: LifeState) => found(state.ledger.at(-1), 'a ledger line');

/** A life as the test-only 'probe' system sees it: its own slice, plus keys it never declared (`admin`). */
interface ProbeLife extends LifeState {
  probe: { pings: number; boost: boolean; veto: boolean; seconds?: number };
}
// The probe system and the names below exist only in this file, so they are outside the typed registry maps: each crosses
// the registry boundary through one cast, and the engine's own validation is what the tests then exercise.
const asSystem = (def: object): SystemDefinition => def as unknown as SystemDefinition;
const dispatchTest = (state: LifeState, body: { type: string; payload?: object; actionId?: string; id?: unknown; mode?: unknown }, ctx?: LifeContextInit): ActionOutcome => dispatch(state, body as unknown as ActionBody, ctx);
const emitTest = (state: LifeState, event: string, data: object, ctx: LifeContext): void => emit(state, event as EngineEvent, data as never, ctx);
const modifyTest = (state: LifeState, key: string, base: unknown, data: object, ctx: LifeContext): unknown => modify(state, key as ModifierKey, base as never, data as never, ctx);
/** createLife with nothing saved: the default life. */
const blank = (ctx?: LifeContextInit): ProbeLife => createLife(undefined, ctx) as ProbeLife;

// A test-only system: exercises the contract exactly as a feature owner would use it.
const seen: unknown[][] = [];
registerSystem(asSystem({
  id: 'probe',
  stateKeys: ['probe'],
  // Everything advance() and the actions write is rebuilt here, `seconds` included: a field sanitize does not rebuild is lost at the next load.
  sanitize(input: Record<string, unknown>, state: ProbeLife) {
    const saved = isRecord(input.probe) ? input.probe : {}; // untrusted saved input
    const { pings, seconds } = saved;
    state.probe = { pings: typeof pings === 'number' && Number.isSafeInteger(pings) && pings >= 0 ? pings : 0, boost: saved.boost === true, veto: saved.veto === true,
      ...(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? { seconds } : {}) };
  },
  actions: {
    ping(state: ProbeLife, payload: Record<string, unknown>): ActionOutcome { state.probe.pings += payload.by === 2 ? 2 : 1; return { ok: true, code: 'pinged', state }; },
    roll(state: LifeState, _payload: unknown, ctx: LifeContext): ActionOutcome { state.message = String(ctx.rng()); return { ok: true, code: 'rolled', state }; },
  },
  advance(state: ProbeLife, dt: number) { state.probe.seconds = (state.probe.seconds || 0) + dt; },
  view(state: ProbeLife) { return { pings: state.probe.pings }; },
  on: {
    'activity.completed': (_state: LifeState, data: { id: string; tags: string[]; choice: string | null }) => seen.push(['completed', data.id, data.tags, data.choice]),
    'wallet.changed': (_state: LifeState, data: { amount: number; reason: string }) => seen.push(['wallet', data.amount, data.reason]),
  },
  modifiers: {
    'skills.xpRate': (value: number, state: ProbeLife) => (state.probe.boost ? value * 2 : value),
    'needs.decayRate': (value: number, state: ProbeLife, { need }: { need: NeedId }) => (state.probe.boost && need === 'hunger' ? 0 : value),
    'activity.block': (value: unknown, state: ProbeLife, { def }: { def: { id: string } }) => value || (state.probe.veto && def.id === 'test-meal' ? { code: 'probe_veto', reason: 'The probe says no.' } : null),
  },
  activities: [
    { id: 'test-meal', label: 'Test Meal', duration: 8, cost: 550, effects: { fun: 10 }, tags: ['food'], where: { venue: 'park', spot: 'drinks' } },
    { id: 'test-show', label: 'Test Show', duration: 10, cost: 400, chargeOn: 'start', effects: { fun: 5 }, where: { venue: 'park', spot: 'drinks' } },
    { id: 'test-sunk', label: 'Test Sunk', duration: 10, cost: 100, chargeOn: 'start', refundOnCancel: false, where: { venue: 'park', spot: 'drinks' } },
    { id: 'test-locked', label: 'Test Locked', duration: 5, cancellable: false, where: { venue: 'park', spot: 'drinks' } },
    { id: 'test-gig', label: 'Test Gig', duration: 6, requiresSkill: { id: 'music', level: 2 }, reward: 1000, xp: { music: 40 }, xpPerSecond: { charisma: 10 }, where: { venue: 'park', spot: 'drinks' } },
    { id: 'test-cook', label: 'Test Cook', duration: 4, consumes: { rice: 2, pepper: 1 }, produces: { jollof: 1 }, moodlets: [{ id: 'well-fed', label: 'Well fed', value: 5, duration: 60 }], where: { venue: 'park', spot: 'drinks' } },
    { id: 'test-office', label: 'Test Office', duration: 5, hours: { open: 9, close: 17, days: [1, 2, 3, 4, 5] }, where: { venue: 'park', spot: 'drinks' } },
    { id: 'test-choice', label: 'Test Choice', duration: 9, choices: [{ id: 'poem', label: 'Poem', duration: 3, effects: { fun: 7 } }, { id: 'song', label: 'Song', cost: 50, chargeOn: 'start', effects: { social: 9 } }], where: { venue: 'park', spot: 'stall', spotLabel: 'Test stall' } },
  ],
}));
rebuildCatalogue('lagos');
const atDrinks = (saved: Record<string, unknown> = {}, now = MONDAY_9AM): ProbeLife => createLife({ spot: 'drinks', ...saved }, at(now)) as ProbeLife;

test('registry: every system declares disjoint state keys and sanitize writes only those', () => {
  const keys = systems().flatMap(system => system.stateKeys);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(Object.keys(blank()).sort(), [...keys].sort());
  assert.throws(() => registerSystem(asSystem({ id: 'thief', stateKeys: ['cash'], sanitize() {} })), /owned by wallet/);
  assert.throws(() => registerSystem(asSystem({ id: 'probe', stateKeys: [], sanitize() {} })), /duplicate/i);
  assert.throws(() => registerSystem(asSystem({ id: 'clash', stateKeys: [], sanitize() {}, actions: { travel() {} } })), /already registered/);
  for (const id of ['core', 'wallet', 'inventory', 'needs', 'skills', 'activities', 'travel', 'health', 'career', 'economy', 'home', 'property', 'onboarding', 'goals', 'social', 'civic']) assert.ok(systems().some(system => system.id === id), id);
});

test('registry dispatch: routes by type, folds legacy id/mode into the payload and rejects unknown types', () => {
  const state = blank();
  assert.ok(['activity', 'spot', 'cancel', 'travel', 'apply-job', 'ping'].every(type => (actionTypes() as string[]).includes(type)));
  assert.equal(dispatchTest(state, { type: 'ping' }).code, 'pinged');
  assert.equal(dispatchTest(state, { type: 'ping', payload: { by: 2 } }).code, 'pinged');
  assert.equal(state.probe.pings, 3);
  assert.equal((viewLife(state) as unknown as { probe: { pings: number } }).probe.pings /* a view the probe system adds */, 3);
  assert.equal(dispatch(state, { type: 'travel', id: 'library', mode: 'cab' }).code, 'started');
  const other = blank();
  assert.equal(dispatch(other, { type: 'travel', payload: { id: 'library', mode: 'cab' } }).code, 'started');
  assert.deepEqual(other.activeAction, state.activeAction);
  assert.throws(() => dispatchTest(state, { type: 'nope' }), /Invalid action type/);
  assert.throws(() => dispatchTest(state, { type: 'constructor' }), /Invalid action type/);
});

test('ctx.rng is deterministic per action ID and differs between IDs', () => {
  const roll = (id: string) => dispatchTest(blank(), { type: 'roll', actionId: id }, { now: 5, cityId: 'lagos', actionId: id }).state.message;
  assert.equal(roll('1:a'), roll('1:a'));
  assert.notEqual(roll('1:a'), roll('1:b'));
  const a = makeRng('seed'), b = makeRng('seed');
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.ok([a(), a(), a()].every(value => value >= 0 && value < 1));
});

test('sanitize rejects hostile saves: every field falls back to a safe default', () => {
  const hostile = {
    v: 1, t: -5, cash: 1e30, name: { toString() { return 'x'; } }, message: 'x'.repeat(501), location: '__proto__', spot: 'constructor',
    needs: { hunger: 'full', energy: 1e9, fun: -40, social: NaN, hygiene: null, bladder: [] }, decay: { hunger: 50, energy: -1 },
    moodlets: [{ id: 'ok', label: 'Fine', value: 4, expiresAt: null }, { id: 'BAD ID', value: 1, expiresAt: null }, { id: 'nan', value: NaN, expiresAt: null }, 'junk', null],
    skills: { cooking: -5, coding: Infinity, hustle: 1e12, hacking: 99 }, inventory: { rice: 3, 'Bad Key': 2, pepper: -1, salt: 1.5, gold: 1e9, __proto__: 4 },
    ledger: [{ at: 1, amount: 5, reason: 'ok', balance: 5 }, { at: 'x', amount: 5, reason: 'bad', balance: 5 }, { at: 1, amount: 0.5, reason: 'bad', balance: 5 }, null],
    job: 'president', completedShifts: -3, homeOwned: 'yes', probe: { pings: 1e99 },
    activeAction: { kind: 'activity', id: 'helper-shift', duration: 20, remaining: 0.001 }, admin: true, constructor: { prototype: {} },
  };
  const state = createLife(hostile, at(1000)) as ProbeLife & { admin?: unknown };
  assert.equal(state.cash, 5000); assert.equal(state.name, 'New Lagosian'); assert.equal(state.message, ''); assert.equal(state.t, 1000);
  assert.equal(state.location, 'park'); assert.equal(state.spot, 'amphitheatre');
  assert.deepEqual(state.needs, { hunger: 50, energy: 100, fun: 0, social: 50, hygiene: 50, bladder: 50 });
  assert.deepEqual(state.decay, { hunger: 0, energy: 0, fun: 0, social: 0, hygiene: 0, bladder: 0 });
  assert.deepEqual(state.moodlets, [{ id: 'ok', label: 'Fine', value: 4, expiresAt: null }]);
  assert.deepEqual(Object.keys(state.skills), [...SKILLS]); assert.equal(state.skills.cooking, 0); assert.equal(state.skills.coding, 0); assert.equal(state.skills.hustle, xpForLevel(10));
  assert.deepEqual(state.inventory, { rice: 3, gold: 9999 });
  // The one valid line ends at ₦5, the balance is the ₦5,000 default: the difference is shown, never hidden.
  assert.deepEqual(state.ledger, [{ at: 1, amount: 5, reason: 'ok', balance: 5 }, { at: 1000, amount: 4995, reason: 'Balance correction (no record of this change)', balance: 5000 }]);
  assert.equal(statementOf(state).reconciled, true);
  assert.equal(state.job, null); assert.equal(state.completedShifts, 0); assert.equal(state.homeOwned, false); assert.equal(state.probe.pings, 0);
  assert.equal(state.activeAction, null, 'a shift without the job cannot be resumed');
  assert.equal(state.admin, undefined); assert.equal(Object.hasOwn(state, 'constructor'), false);
  for (const junk of [null, undefined, 7, 'text', [], [1, 2], () => {}]) assert.deepEqual(createLife(junk, at(0)), createLife(undefined, at(0)));
  for (const active of [{ kind: 'warp', id: 'home', duration: 5, remaining: 1 }, { kind: 'travel', id: 'park', duration: 5, remaining: 1 }, { kind: 'travel', id: 'library', duration: 500, remaining: 1 }, { kind: 'activity', id: 'garri', duration: 5, remaining: 2 }, { kind: 'activity', id: 'test-choice', duration: 3, remaining: 1, choice: 'nope' }]) {
    assert.equal(createLife({ activeAction: active }).activeAction, null, JSON.stringify(active));
  }
  assert.equal(activityOf(createLife({ spot: 'trees', activeAction: { kind: 'activity', id: 'chill', duration: 11, remaining: 5, paid: 999, extra: 1 } })).paid, undefined);
});

test('createLife is idempotent and never aliases its input', () => {
  const first = createLife({ cash: 7200, spot: 'trees', job: 'community-helper', inventory: { rice: 2 }, skills: { coding: 120 } }, at(50));
  addMoodlet(first, { id: 'calm', label: 'Calm', value: 3 }, at(50));
  const second = createLife(first, at(999));
  assert.deepEqual(second, first);
  second.needs.fun = 1; second.inventory.rice = 9; second.ledger.push({} as unknown as LedgerLine); // deliberately malformed line
  assert.equal(first.needs.fun, 50); assert.equal(first.inventory.rice, 2); assert.equal(first.ledger.length, 0);
});

test('migration: a current-format (pre-registry) save loads without loss', () => {
  const saved = { cash: 4321, name: 'Ada', homeOwned: true, job: 'community-helper', completedShifts: 7,
    needs: { hunger: 24, energy: 74, fun: 0, social: 87, hygiene: 31, bladder: 12 }, location: 'park', spot: 'work',
    activeAction: { kind: 'activity', id: 'helper-shift', duration: 20, remaining: 12.5 }, message: 'Community helper shift' };
  assert.equal(migrate(saved).v, STATE_VERSION);
  const state = createLife(saved, at(MONDAY_9AM));
  assert.equal(state.v, 1); assert.equal(state.t, MONDAY_9AM);
  for (const key of ['cash', 'name', 'homeOwned', 'job', 'completedShifts', 'needs', 'location', 'spot', 'activeAction', 'message']) assert.deepEqual(state[key as keyof LifeState], saved[key as keyof typeof saved], key);
  // New slices start at their defaults.
  assert.deepEqual(state.ledger, []); assert.deepEqual(state.inventory, {}); assert.deepEqual(state.moodlets, []); assert.equal(state.skills.hustle, 0);
  advanceLife(state, 12.5, at(MONDAY_9AM + 12500));
  assert.equal(state.cash, 4621); assert.equal(state.completedShifts, 8); assert.equal(state.activeAction, null);
  // In-progress travel and the oldest flat-needs layout also survive.
  const travelling = createLife({ cash: 4600, location: 'park', activeAction: { kind: 'travel', id: 'library', duration: 5, remaining: 3 } });
  assert.deepEqual(travelling.activeAction, { kind: 'travel', id: 'library', duration: 5, remaining: 3 });
  const flat = createLife({ cash: 9500, hunger: 23, energy: 71 });
  assert.equal(flat.needs.hunger, 23); assert.equal(flat.needs.energy, 71); assert.equal(flat.needs.fun, 50);
});

test('needs: six needs in fixed order decay slowly in whole points, with a floor and an offline cap', () => {
  assert.deepEqual([...NEEDS], ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder']);
  assert.deepEqual(Object.keys(blank().needs), [...NEEDS]);
  const hour = createLife(null, at(0));
  advanceLife(hour, 3600, at(3600000));
  for (const need of NEEDS) assert.equal(hour.needs[need], 50 - NEED_DECAY_PER_HOUR[need], need);
  // Same total time in small steps gives the same result as one large step.
  const stepped = createLife(null, at(0));
  for (let i = 1; i <= 720; i++) advanceLife(stepped, 5, at(i * 5000));
  assert.deepEqual(stepped.needs, hour.needs);
  // Short play sessions do not disturb exact activity arithmetic.
  const brief = createLife(null, at(0)); advanceLife(brief, 120, at(120000));
  assert.deepEqual(brief.needs, blank().needs);
  // Offline cap: thirty days away costs exactly what the cap allows, no more.
  const away = createLife({ needs: Object.fromEntries(NEEDS.map(need => [need, 100])) }, at(0));
  const capped = createLife(away, at(0));
  advanceLife(away, 30 * 86400, at(30 * 86400000));
  advanceLife(capped, OFFLINE_DECAY_CAP_SECONDS, at(OFFLINE_DECAY_CAP_SECONDS * 1000));
  assert.deepEqual(away.needs, capped.needs);
  assert.equal(away.needs.bladder, 100 - 8 * 4);
  // Floor: decay alone never drops a need below the floor, and never raises one already under it.
  const worn = createLife({ needs: { hunger: 12, energy: 3 } }, at(0));
  for (let i = 1; i <= 20; i++) advanceLife(worn, OFFLINE_DECAY_CAP_SECONDS, at(i * OFFLINE_DECAY_CAP_SECONDS * 1000));
  assert.equal(worn.needs.hunger, DECAY_FLOOR); assert.equal(worn.needs.energy, 3);
  assert.ok(NEEDS.every(need => worn.needs[need] >= (need === 'energy' ? 3 : DECAY_FLOOR)));
  // A modifier can slow or stop decay for one need.
  const boosted = createLife({ probe: { boost: true } }, at(0)); advanceLife(boosted, 3600, at(3600000));
  assert.equal(boosted.needs.hunger, 50); assert.equal(boosted.needs.energy, 46);
});

test('needs never trap a player: home is a free trek away and restores without prerequisites', () => {
  const state = createLife({ cash: 0, needs: Object.fromEntries(NEEDS.map(need => [need, 0])) }, at(MONDAY_9AM));
  assert.equal(dispatch(state, { type: 'travel', payload: { id: 'home', mode: 'trek' } }, at(MONDAY_9AM)).ok, true);
  assert.equal(found(state.activeAction, 'the trek').duration, 18, 'the trek home from Freedom Park crosses the lagoon');
  advanceLife(state, 18, at(MONDAY_9AM + 18000));
  assert.equal(state.location, 'home');
  const free = spotsOf('home', 'lagos').flatMap(spot => spot.activities).filter(def => !def.unavailable && !def.cost && !def.minimumNeeds && !def.requiresJob && !def.requiresSkill && !def.consumes && !def.hours);
  const recovered: NeedId[] = ['hunger', 'energy', 'hygiene'];
  for (const need of recovered) assert.ok(free.some(def => (def.effects?.[need] ?? 0) > 0 || (def.effectsPerSecond?.[need] ?? 0) > 0), `free ${need} recovery at home`);
  assert.equal(VENUES.home.hours, undefined);
});

test('moodlets expire, low needs add feelings, and mood is derived', () => {
  const state = createLife(null, at(0));
  assert.deepEqual(moodOf(state), { score: 50, label: 'Okay', icon: '🙂' });
  addMoodlet(state, { id: 'very-sick', label: 'Very Sick', value: -35, duration: 600 }, at(0));
  addMoodlet(state, { id: 'new-home', label: 'New home', value: 10 }, at(0));
  assert.equal(moodOf(state).score, 25); assert.equal(moodOf(state).label, 'Uneasy');
  addMoodlet(state, { id: 'new-home', label: 'New home', value: 12 }, at(0));
  assert.equal(state.moodlets.length, 2, 'same id replaces');
  advanceLife(state, 599, at(599000)); assert.equal(state.moodlets.length, 2);
  advanceLife(state, 1, at(600000));
  assert.deepEqual(state.moodlets.map(moodlet => moodlet.id), ['new-home']);
  state.needs.energy = 19;
  const view = viewLife(state, at(600000)).needs;
  assert.deepEqual(view.feelings.map(feeling => [feeling.id, feeling.value]), [['tired', -8], ['new-home', 12]]);
  assert.equal(view.mood.score, moodOf(state).score);
  assert.equal(addMoodlet(state, { id: 'Bad Id', value: 1 }, at(0)), false);
});

test('skills: nine skills, XP to level, rate modifier hook and level-up event', () => {
  assert.deepEqual([...SKILLS], ['cooking', 'charisma', 'fitness', 'coding', 'music', 'hustle', 'dance', 'comedy', 'photography']);
  const state = blank();
  assert.equal(skillLevel(state, 'coding'), 0);
  assert.equal(addSkillXp(state, 'coding', 99, NO_CTX), 0); assert.equal(addSkillXp(state, 'coding', 1, NO_CTX), 1);
  assert.equal(addSkillXp(state, 'coding', 1e9, NO_CTX), 10); assert.equal(state.skills.coding, xpForLevel(10));
  assert.equal(addSkillXp(state, 'hacking', 50, NO_CTX), -1); assert.equal(addSkillXp(state, 'music', -5, NO_CTX), -1);
  assert.equal(setSkillLevel(state, 'hustle', 2), true); assert.equal(skillLevel(state, 'hustle'), 2);
  setSkillLevel(state, 'hustle', 1); assert.equal(skillLevel(state, 'hustle'), 2, 'never lowers');
  const boosted = createLife({ probe: { boost: true } });
  addSkillXp(boosted, 'dance', 50, NO_CTX); assert.equal(boosted.skills.dance, 100); assert.equal(skillLevel(boosted, 'dance'), 1);
  const view = viewLife(state).skills;
  assert.deepEqual(view.hustle, { xp: 300, level: 2, next: 600, progress: 0 }); assert.equal(view.coding.next, null);
});

test('wallet ledger: integer naira, overflow-safe, capped log that explains every change', () => {
  const state = createLife(null, at(10));
  assert.equal(credit(state, 250, 'Gift', at(20)), true);
  assert.equal(debit(state, 50, 'Snack', at(30)), true);
  assert.equal(debit(state, 999999, 'Yacht', at(40)), false);
  assert.equal(credit(state, 1.5, 'Fraction', at(40)), false); assert.equal(credit(state, -5, 'Negative', at(40)), false); assert.equal(debit(state, NaN, 'NaN', at(40)), false);
  assert.equal(credit(state, Number.MAX_SAFE_INTEGER, 'Overflow', at(40)), false);
  assert.equal(credit(state, 0, 'Nothing', at(40)), true);
  assert.equal(state.cash, 5200);
  assert.deepEqual(state.ledger, [{ at: 20, amount: 250, reason: 'Gift', balance: 5250 }, { at: 30, amount: -50, reason: 'Snack', balance: 5200 }]);
  assert.equal(debit(state, 6000, 'Bill', at(50), { partial: true }), 5200); assert.equal(state.cash, 0);
  for (let i = 0; i < 70; i++) credit(state, 1, `Tip ${i}`, at(100 + i));
  assert.equal(state.ledger.length, LEDGER_LIMIT); assert.equal(LEDGER_LIMIT, 60); assert.equal(lastLine(state).reason, 'Tip 69'); assert.equal(lastLine(state).balance, 70);
  assert.equal(found(viewLife(state).wallet.ledger[0], 'a ledger line').reason, 'Tip 69', 'view lists newest first');
  // The lines that scrolled away are still accounted for in the day's summary, and the statement adds up.
  const statement = statementOf(state);
  assert.deepEqual(statement.days.map((day) => [day.open, day.in, day.out, day.close, day.changes]), [[5000, 320, 5250, 70, 73]]);
  assert.deepEqual([statement.opening.balance, statement.closing, statement.totals.net, statement.reconciled, statement.problems], [5000, 70, -4930, true, []]);
  assert.equal(statement.linesOpening, 10, 'the kept lines start after the first thirteen changes');
  assert.equal(found(statement.days[0], 'a statement day').groups.reduce((sum, group) => sum + group.net, 0), -4930);
  // Game actions record their reason too.
  const traveller = createLife(null, at(MONDAY_9AM));
  dispatch(traveller, { type: 'travel', payload: { id: 'library', mode: 'cab' } }, at(MONDAY_9AM));
  assert.deepEqual(traveller.ledger, [{ at: MONDAY_9AM, amount: -400, reason: 'Cab to The Library', balance: 4600 }]);
});

test('inventory: counted items with atomic removal', () => {
  const state = blank();
  assert.equal(addItem(state, 'rice', 3), true); assert.equal(addItem(state, 'Bad Id', 1), false); assert.equal(addItem(state, 'rice', 0), false); assert.equal(addItem(state, 'rice', 9999), false);
  assert.equal(removeItems(state, { rice: 2, pepper: 1 }), false); assert.equal(countItem(state, 'rice'), 3);
  assert.equal(removeItems(state, { rice: 3 }), true); assert.deepEqual(state.inventory, {});
});

test('activity chargeOn complete (default): nothing is charged at start or on cancel, the price on completion', () => {
  seen.length = 0;
  const state = atDrinks();
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-meal' } }, at(MONDAY_9AM)).code, 'started');
  assert.equal(state.cash, 5000); assert.equal(activityOf(state).paid, undefined);
  assert.equal(dispatch(state, { type: 'cancel' }, at(MONDAY_9AM)).code, 'cancelled');
  advanceLife(state, 100, at(MONDAY_9AM + 100000));
  assert.equal(state.cash, 5000); assert.equal(state.needs.fun, 50); assert.deepEqual(state.ledger, []);
  dispatch(state, { type: 'activity', payload: { id: 'test-meal' } }, at(MONDAY_9AM));
  advanceLife(state, 7, at(MONDAY_9AM + 7000)); assert.equal(state.cash, 5000);
  advanceLife(state, 1, at(MONDAY_9AM + 8000));
  assert.equal(state.cash, 4450); assert.equal(state.needs.fun, 60); assert.equal(lastLine(state).reason, 'Test Meal'); assert.equal(lastLine(state).amount, -550);
  assert.deepEqual(seen, [['wallet', -550, 'Test Meal'], ['completed', 'test-meal', ['food'], null]]);
  // Re-checked at completion: if the cash is gone by then, no charge and no effects, with a clear message.
  const drained = atDrinks();
  dispatch(drained, { type: 'activity', payload: { id: 'test-meal' } }, at(MONDAY_9AM));
  debit(drained, 4600, 'Rent', at(MONDAY_9AM + 1000));
  advanceLife(drained, 8, at(MONDAY_9AM + 8000));
  assert.equal(drained.cash, 400); assert.equal(drained.needs.fun, 50); assert.equal(drained.activeAction, null);
  assert.match(drained.message, /Test Meal ended without effect: it costs ₦550 and you now have ₦400\. Nothing was charged\./);
  assert.deepEqual(drained.ledger.map(entry => entry.reason), ['Rent']);
  const poor = atDrinks({ cash: 549 });
  const refused = dispatch(poor, { type: 'activity', payload: { id: 'test-meal' } }, at(MONDAY_9AM));
  assert.equal(refused.code, 'insufficient_funds'); assert.match(reasonOf(refused), /₦550.*₦549/); assert.equal(poor.message, reasonOf(refused));
});

test('activity chargeOn start: debited once up front, refunded in full on cancel unless refundOnCancel is false', () => {
  const state = atDrinks();
  dispatch(state, { type: 'activity', payload: { id: 'test-show' } }, at(MONDAY_9AM));
  assert.equal(state.cash, 4600, 'wallet is already debited while the activity runs'); assert.equal(activityOf(state).paid, 400);
  const reloaded = createLife(JSON.parse(JSON.stringify(state)), at(MONDAY_9AM));
  assert.deepEqual(reloaded.activeAction, state.activeAction);
  dispatch(state, { type: 'cancel' }, at(MONDAY_9AM));
  assert.equal(state.cash, 5000, 'cancel leaves the wallet unchanged'); assert.equal(state.needs.fun, 50);
  assert.deepEqual(state.ledger.map(entry => [entry.amount, entry.reason]), [[-400, 'Test Show'], [400, 'Refund: Test Show']]);
  advanceLife(reloaded, 10, at(MONDAY_9AM + 10000)); assert.equal(reloaded.cash, 4600); assert.equal(reloaded.needs.fun, 55);
  advanceLife(reloaded, 100, at(MONDAY_9AM + 110000)); assert.equal(reloaded.cash, 4600, 'charged exactly once');
  const sunk = atDrinks();
  dispatch(sunk, { type: 'activity', payload: { id: 'test-sunk' } }, at(MONDAY_9AM)); assert.equal(sunk.cash, 4900);
  dispatch(sunk, { type: 'cancel' }, at(MONDAY_9AM)); assert.equal(sunk.cash, 4900);
  const locked = atDrinks();
  dispatch(locked, { type: 'activity', payload: { id: 'test-locked' } }, at(MONDAY_9AM));
  const cancel = dispatch(locked, { type: 'cancel' }, at(MONDAY_9AM));
  assert.equal(cancel.code, 'not_cancellable'); assert.ok(reasonOf(cancel)); assert.ok(locked.activeAction);
});

test('per-second accrual: gains accrue while running and an early stop keeps them', () => {
  const state = createLife({ location: 'home', spot: 'bedroom', needs: { energy: 40 } }, at(MONDAY_9AM));
  dispatch(state, { type: 'activity', payload: { id: 'nap' } }, at(MONDAY_9AM));
  advanceLife(state, 4.5, at(MONDAY_9AM + 4500)); assert.equal(state.needs.energy, 49);
  assert.equal(dispatch(state, { type: 'cancel' }, at(MONDAY_9AM + 4500)).code, 'cancelled');
  advanceLife(state, 60, at(MONDAY_9AM + 64500)); assert.equal(state.needs.energy, 49);
  // Skill XP accrues per second too, and completion adds the lump sum, reward and level-up.
  const player = atDrinks(); setSkillLevel(player, 'music', 2);
  dispatch(player, { type: 'activity', payload: { id: 'test-gig' } }, at(MONDAY_9AM));
  advanceLife(player, 3, at(MONDAY_9AM + 3000)); assert.equal(player.skills.charisma, 30); assert.equal(player.cash, 5000);
  advanceLife(player, 30, at(MONDAY_9AM + 33000));
  assert.equal(player.skills.charisma, 60); assert.equal(player.skills.music, 340); assert.equal(player.cash, 6000);
  assert.equal(player.message, 'Test Gig completed. You earned ₦1,000.');
});

test('blocked starts return a machine code and a reason naming the unmet prerequisite', () => {
  const start = (state: LifeState, id: string, now = MONDAY_9AM, payload: object = {}) => dispatch(state, { type: 'activity', payload: { id, ...payload } }, at(now));
  const skill = start(atDrinks(), 'test-gig');
  assert.equal(skill.code, 'skill_required'); assert.match(reasonOf(skill), /Music level 2 \(yours is 0\)/);
  const items = start(atDrinks({ inventory: { rice: 1 } }), 'test-cook');
  assert.equal(items.code, 'missing_items'); assert.match(reasonOf(items), /1 × rice, 1 × pepper/);
  const sunday = MONDAY_9AM - 86400000;
  const closed = start(atDrinks({}, sunday), 'test-office', sunday);
  assert.equal(closed.code, 'closed'); assert.match(reasonOf(closed), /Freedom Park is closed right now\. Opens in 24h 0m\./);
  assert.equal(start(atDrinks({}, MONDAY_9AM + 8 * 3600000), 'test-office', MONDAY_9AM + 8 * 3600000).code, 'closed');
  assert.equal(start(atDrinks(), 'test-office').code, 'started');
  const veto = start(atDrinks({ probe: { veto: true } }), 'test-meal');
  assert.deepEqual([veto.code, reasonOf(veto)], ['probe_veto', 'The probe says no.']);
  const work = createLife({ spot: 'work', needs: { energy: 19, hunger: 5 } }, at(MONDAY_9AM));
  const job = start(work, 'helper-shift'); assert.equal(job.code, 'job_required'); assert.match(reasonOf(job), /Community helper job/);
  dispatch(work, { type: 'apply-job', payload: { id: 'community-helper' } }, at(MONDAY_9AM));
  const needs = start(work, 'helper-shift'); assert.equal(needs.code, 'needs_required'); assert.match(reasonOf(needs), /Energy 20\+ \(you have 19\) and Hunger 20\+ \(you have 5\)/);
  const wrongSpot = start(blank(), 'chill'); assert.equal(wrongSpot.code, 'unavailable'); assert.ok(reasonOf(wrongSpot));
  const busy = atDrinks(); start(busy, 'test-office'); assert.equal(start(busy, 'test-meal').code, 'busy');
  // The view carries the same reason for each card so the UI can show it before a tap.
  const cards = viewLife(atDrinks(), at(sunday)).activities.cards;
  assert.equal(found(found(cards.find(card => card.id === 'test-office'), 'the office card').blocked, 'a block').code, 'closed');
  assert.equal(found(found(cards.find(card => card.id === 'test-gig'), 'the gig card').blocked, 'a block').code, 'skill_required');
  assert.equal(found(cards.find(card => card.id === 'test-meal'), 'the meal card').blocked, null);
});

test('inventory consumption, production and completion moodlets', () => {
  const state = atDrinks({ inventory: { rice: 5, pepper: 1 } });
  dispatch(state, { type: 'activity', payload: { id: 'test-cook' } }, at(MONDAY_9AM));
  assert.deepEqual(state.inventory, { rice: 3 });
  advanceLife(state, 4, at(MONDAY_9AM + 4000));
  assert.deepEqual(state.inventory, { rice: 3, jollof: 1 });
  assert.deepEqual(state.moodlets, [{ id: 'well-fed', label: 'Well fed', value: 5, expiresAt: MONDAY_9AM + 64000 }]);
});

test('choice activities and system-contributed spots', () => {
  assert.ok(spotsOf('park', 'lagos').some(spot => spot.id === 'stall' && spot.label === 'Test stall'));
  const state = createLife(null, at(MONDAY_9AM));
  assert.equal(dispatch(state, { type: 'spot', payload: { id: 'stall' } }).code, 'selected');
  assert.equal(dispatch(state, { type: 'spot', payload: { id: 'nowhere' } }).code, 'invalid_spot');
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-choice' } }, at(MONDAY_9AM)).code, 'choice_required');
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-choice', choice: 'opera' } }, at(MONDAY_9AM)).code, 'choice_required');
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-choice', choice: 'poem' } }, at(MONDAY_9AM)).code, 'started');
  assert.deepEqual(state.activeAction, { kind: 'activity', id: 'test-choice', duration: 3, remaining: 3, choice: 'poem' });
  assert.equal(found(viewLife(state, at(MONDAY_9AM)).activities.active, 'an active card').label, 'Test Choice: Poem');
  const reloaded = createLife(JSON.parse(JSON.stringify(state)), at(MONDAY_9AM));
  advanceLife(reloaded, 3, at(MONDAY_9AM + 3000)); assert.equal(reloaded.needs.fun, 57);
  dispatch(reloaded, { type: 'activity', payload: { id: 'test-choice', choice: 'song' } }, at(MONDAY_9AM + 3000));
  assert.equal(reloaded.cash, 4950); assert.equal(found(reloaded.activeAction, 'the song').duration, 9);
});

test('advance runs every system whether or not an action is active, and tracks state.t', () => {
  const state = createLife(null, at(1000));
  assert.equal(advanceLife(state, 30, at(31000)).code, 'idle');
  assert.equal((state as ProbeLife).probe.seconds, 30); assert.equal(state.t, 31000);
  advanceLife(state, 2); assert.equal(state.t, 33000, 'without ctx the clock follows dt');
  for (const dt of [NaN, -1, 0, Infinity, '5' as unknown as number /* hostile: not a number */]) assert.equal(advanceLife(state, dt).code, 'invalid_time');
  assert.equal(state.t, 33000);
});

test('event bus and modifiers reach every system and tolerate unknown names', () => {
  const state = blank();
  assert.doesNotThrow(() => emitTest(state, 'nobody.listens', { any: 1 }, at(0)));
  assert.equal(modifyTest(state, 'nobody.modifies', 42, {}, at(0)), 42);
  state.probe.boost = true;
  assert.equal(modify(state, 'skills.xpRate', 1, { skill: 'dance' }, at(0)), 2);
});

test('Lagos wall clock: UTC+1 day, hour, weekday and week index', () => {
  assert.deepEqual(lagosTime(MONDAY_9AM), { day: 20458, weekday: 1, week: 2923, hour: 9, minute: 0, minuteOfDay: 540 });
  const sundayLate = Date.UTC(2026, 0, 4, 22, 59); // 23:59 Sunday in Lagos
  assert.equal(lagosTime(sundayLate).weekday, 0); assert.equal(lagosTime(sundayLate).week, 2922);
  assert.equal(lagosTime(sundayLate + 60000).weekday, 1); assert.equal(lagosTime(sundayLate + 60000).week, 2923);
  assert.equal(lagosTime(Date.UTC(2026, 0, 5, 23, 30)).hour, 0, 'half past midnight Tuesday in Lagos');
  assert.equal(formatClock(MONDAY_9AM), 'Mon · 9:00 AM');
  const office = { open: 9, close: 17, days: [1, 2, 3, 4, 5] };
  assert.equal(isOpen(office, MONDAY_9AM), true); assert.equal(isOpen(office, MONDAY_9AM - 60000), false); assert.equal(isOpen(office, MONDAY_9AM + 8 * 3600000), false);
  assert.equal(isOpen(undefined, 0), true);
  const club = { open: 22, close: 4, days: [5, 6] }; // Friday and Saturday nights
  const friday = MONDAY_9AM + 4 * 86400000;
  assert.equal(isOpen(club, friday + 13 * 3600000), true, 'Friday 22:00');
  assert.equal(isOpen(club, friday + 18 * 3600000), true, 'Saturday 03:00 belongs to Friday night');
  assert.equal(isOpen(club, friday - 6 * 3600000), false, 'Friday 03:00 belongs to Thursday night');
  assert.equal(minutesUntilOpen(office, MONDAY_9AM - 30 * 60000), 30); assert.equal(minutesUntilOpen(office, MONDAY_9AM), 0);
});

test('wallet history: full recent lines, a summary per day, bounded, and a statement that always reconciles', () => {
  const DAY = 86400000, start = Date.UTC(2026, 0, 5, 9);
  const state = createLife(null, at(start));
  let expected = state.cash;
  for (let day = 0; day < 50; day++) {
    const now = start + day * DAY;
    for (let i = 0; i < 12; i++) { credit(state, 100 + i, `Reason ${i}: detail ${day}`, at(now + i * 1000)); expected += 100 + i; }
    debit(state, 300, 'Danfo to Freedom Park', at(now + 60000)); expected -= 300;
    debit(state, 50, 'Danfo to The Library', at(now + 61000)); expected -= 50;
  }
  assert.equal(state.cash, expected);
  assert.equal(state.ledger.length, LEDGER_LIMIT); assert.equal(state.ledgerDays.length, LEDGER_DAYS);
  for (const day of state.ledgerDays) {
    assert.ok(Object.keys(day.by).length <= LEDGER_DAY_GROUPS + 1, 'groups per day are capped; the rest fold into Other');
    assert.equal(Object.values(day.by).reduce((sum, [net]) => sum + net, 0), day.in - day.out, 'the groups of a day add up to its net');
    assert.equal(Object.values(day.by).reduce((sum, [, count]) => sum + count, 0), day.n);
    assert.deepEqual(day.by.Danfo, [-350, 2], 'two fares share one group');
    assert.ok(Object.hasOwn(day.by, 'Other'));
  }
  const statement = statementOf(state);
  assert.equal(statement.reconciled, true); assert.deepEqual(statement.problems, []);
  assert.equal(statement.opening.balance + statement.totals.net, state.cash);
  assert.equal(statement.opening.day, found(state.ledgerDays[0], 'a ledger day').day);
  assert.equal(found(statement.lines.at(-1), 'a statement line').balance, state.cash);
  // A reload keeps every summary and line exactly.
  const again = createLife(structuredClone(state), at(start + 51 * DAY));
  assert.deepEqual(again.ledgerDays, state.ledgerDays); assert.deepEqual(again.ledger, state.ledger); assert.equal(statementOf(again).reconciled, true);
  // A save from before the summaries existed gets them rebuilt from its lines.
  const { ledgerDays, ...older } = structuredClone(state);
  const rebuilt = createLife(older, at(start + 51 * DAY));
  assert.equal(statementOf(rebuilt).reconciled, true); assert.equal(found(rebuilt.ledgerDays.at(-1), 'a ledger day').close, state.cash); assert.ok(rebuilt.ledgerDays.length >= 1);
  /** The saved day summaries of a damaged copy. */
  const days = (s: { ledgerDays: unknown }) => s.ledgerDays as LedgerDay[];
  // Summaries that do not add up, or do not end at the balance, are thrown away and rebuilt — never trusted.
  // Each one damages a copy of the saved summaries in a different way (hence the loosely typed `s`).
  const damages: ((s: { ledgerDays: unknown }) => void)[] = [
    (s) => { found(days(s)[3], 'a day').in += 5; }, (s) => { found(days(s).at(-1), 'a day').close += 1; }, (s) => { Object.assign(found(days(s)[2], 'a day'), { by: { x: ['a', 1] } }); },
    (s) => { s.ledgerDays = 'x'; }, (s) => { found(days(s)[5], 'a day').day = found(days(s)[4], 'a day').day; },
  ];
  for (const damage of damages) {
    const copy = structuredClone(state); damage(copy);
    const fixed = createLife(copy, at(start + 51 * DAY));
    assert.equal(statementOf(fixed).reconciled, true); assert.equal(fixed.cash, state.cash);
  }
  // A balance that does not match its own history is corrected IN the history.
  const tampered = structuredClone(state); tampered.cash += 777;
  const shown = createLife(tampered, at(start + 51 * DAY));
  assert.deepEqual([lastLine(shown).amount, lastLine(shown).reason, lastLine(shown).balance], [777, 'Balance correction (no record of this change)', state.cash + 777]);
  assert.equal(statementOf(shown).reconciled, true);
  assert.deepEqual(['Rent: Yaba self-contain (due Sat 10 Jan)', 'Danfo to Freedom Park', 'Goal: Eat something', 'Bought Plastic chair', 'Transfer from Ada', 'Refund: Test Show', 'Tech shift', 'Groceries: 2 × Rice', '', 'Billboard · Marina · 7 days'].map(reasonGroup),
    ['Rent', 'Danfo', 'Goal', 'Bought', 'Transfer from', 'Refund', 'Tech shift', 'Groceries', 'Other', 'Billboard']);
  const view = viewLife(state).wallet;
  assert.equal(found(view.days[0], 'a view day').day, found(state.ledgerDays.at(-1), 'a ledger day').day, 'the view lists the newest day first'); assert.equal(view.statement.reconciled, true);
});
