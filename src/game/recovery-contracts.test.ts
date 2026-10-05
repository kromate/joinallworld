import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife } from '../life.ts';
import { registerSystem } from './registry.ts';
import { rebuildCatalogue } from './systems/activities.ts';
import type { ActionBody } from '../types/actions.ts';
import type { ActivityAction, LifeContextInit, LifeState } from '../types/life.ts';
import type { AttachedActivity, SavedInput, SystemDefinition } from '../types/registry.ts';

const ctx: LifeContextInit = { now: 100000, cityId: 'lagos' };
const trusted: LifeContextInit = { ...ctx, trustedSave: true };
const paid: AttachedActivity = { id: 'recovery-paid', label: 'Recovery paid', duration: 10, cost: 100,
  chargeOn: 'start', where: { venue: 'park', spot: 'drinks' } };
const gradual: AttachedActivity = { id: 'recovery-gradual', label: 'Recovery gradual', duration: 10, cost: 100,
  chargeOn: 'start', refundOnCancel: false, effectsPerSecond: { energy: 1 },
  where: { venue: 'park', spot: 'drinks' } };
/** A life as the test-only probe system writes to it: keys the engine does not know. */
type ProbeLife = LifeState & { recoveryProbe?: object; undeclaredRecoveryValue?: number };
/** The probe system's sanitizer, kept loose: its id, state keys and action type exist only in this test. */
type ProbeSanitize = (input: SavedInput, state: ProbeLife) => void;
/** The probe system is deliberately outside the typed maps (its id, state keys and action exist only here), so the definition crosses the registry boundary through one cast. */
const owner = registerSystem({ id: 'recovery-probe', stateKeys: ['recoveryProbe'],
  sanitize(input: SavedInput, state: ProbeLife) { state.recoveryProbe = {}; },
  actions: {
    'recovery-undeclared'(state: ProbeLife) { state.undeclaredRecoveryValue = 42; return { ok: true, state }; },
  },
  modifiers: { 'activity.cost': (cost: number, state: LifeState, { def }: { def: { id: string } }) => def.id === paid.id ? cost * 2 : cost },
  activities: [paid, gradual],
} as unknown as SystemDefinition);
rebuildCatalogue('lagos');
const fresh = (): LifeState => createLife({ spot: 'drinks' }, ctx);
const start = (state: LifeState, id: string) => dispatch(state, { type: 'activity', id }, ctx);
const copy = (state: unknown) => JSON.parse(JSON.stringify(state));
/** The running timed action, narrowed to an activity (the only kind that carries `paid`). */
const activityOf = (state: LifeState): ActivityAction => {
  const active = state.activeAction;
  assert.ok(active && active.kind === 'activity', 'an activity is running');
  return active;
};

// DESIGN CONFLICT (kept visible, not run). The navigation lane forbids a priced activity with per-second
// gains unless it is charged at the start and never refunded: such a definition makes rebuildCatalogue throw.
// This branch allows those definitions and METERS them instead (src/game/systems/activities.ts, METERED
// ACTIVITIES): stopping early costs price × elapsed ÷ duration, so gains that accrued are always paid for
// (src/game/contracts.test.ts, 'a metered activity charged on completion…' and '…charged at the start…').
// Both close the same hole (paid gains kept for free on cancel); they differ on whether the definition is legal.
test('paid gradual gains require a nonrefundable start charge, including choices and XP', { skip: 'design conflict: this branch meters priced per-second activities instead of forbidding them' }, () => {
  try {
    for (const change of [
      { chargeOn: 'complete', refundOnCancel: false },
      { chargeOn: 'start', refundOnCancel: true },
      { chargeOn: 'start', refundOnCancel: false, choices: [{ id: 'free-cancel', refundOnCancel: true }] },
      { chargeOn: 'complete', effectsPerSecond: {}, xpPerSecond: { coding: 1 } },
    ]) {
      Object.assign(gradual, change);
      assert.throws(() => rebuildCatalogue('lagos'), /paid per-second gains/);
      delete gradual.choices;
    }
  } finally {
    Object.assign(gradual, { chargeOn: 'start', refundOnCancel: false, effectsPerSecond: { energy: 1 } });
    delete gradual.xpPerSecond;
    rebuildCatalogue('lagos');
  }
});

test('a nonrefundable start charge keeps its per-second gains and its price when cancelled (the part of the test above both designs share)', () => {
  const state = fresh();
  assert.equal(start(state, gradual.id).ok, true);
  advanceLife(state, 5, { ...ctx, now: 105000 });
  assert.equal(dispatch(state, { type: 'cancel' }, ctx).ok, true);
  assert.equal(state.cash, 4900);
  assert.equal(state.needs.energy, 55);
});

test('undeclared runtime and sanitizer writes fail before disappearing on hydration', () => {
  const state = fresh();
  assert.throws(() => dispatch(state, { type: 'recovery-undeclared' } as unknown as ActionBody, ctx), /Undeclared state key/);
  assert.equal(Object.hasOwn(state, 'undeclaredRecoveryValue'), false);
  const original = owner.sanitize;
  try {
    const leaking: ProbeSanitize = (input, output) => { output.undeclaredRecoveryValue = 1; };
    owner.sanitize = leaking as SystemDefinition['sanitize']; // the probe writes a key nobody declared
    assert.throws(fresh, /Undeclared state key/);
  } finally { owner.sanitize = original; }
  assert.deepEqual(createLife(state, ctx), state);
});

test('trusted invalidation refunds actual modified payment exactly once after definition changes', () => {
  const state = fresh();
  assert.equal(start(state, paid.id).ok, true);
  assert.equal(state.cash, 4800);
  assert.equal(activityOf(state).paid, 200);
  try {
    paid.cost = 1;
    const stillValid = createLife(copy(state), trusted);
    assert.equal(activityOf(stillValid).paid, 200);
    dispatch(stillValid, { type: 'cancel' }, ctx);
    assert.equal(stillValid.cash, 5000);
    paid.duration = 20;
    const refunded = createLife(copy(state), trusted);
    assert.equal(refunded.activeAction, null);
    assert.equal(refunded.cash, 5000);
    assert.equal(refunded.ledger.at(-1)?.amount, 200);
    assert.deepEqual(createLife(copy(refunded), trusted), refunded);
    assert.equal(createLife(copy(state), ctx).cash, 4800, 'untrusted hydrate cannot mint a refund');
  } finally { paid.cost = 100; paid.duration = 10; rebuildCatalogue('lagos'); }
});

test('trusted removed and malformed actions refund once; arbitrary client paid values never mint', () => {
  const state = fresh(); start(state, paid.id);
  try {
    owner.activities = [gradual]; rebuildCatalogue('lagos');
    for (const value of [state.activeAction, { ...state.activeAction, remaining: -1 }, { ...state.activeAction, duration: 'broken' }]) {
      const input = { ...copy(state), activeAction: value };
      const refunded = createLife(input, trusted);
      assert.equal(refunded.cash, 5000);
      assert.equal(refunded.activeAction, null);
      assert.equal(createLife(copy(refunded), trusted).cash, 5000);
      assert.equal(createLife(input, ctx).cash, 4800);
    }
    for (const amount of [200, Number.MAX_SAFE_INTEGER, -200, Infinity, '200']) {
      const forged = createLife({ cash: 5000, activeAction: { kind: 'activity', id: 'removed', duration: 10, remaining: 5, paid: amount } }, ctx);
      assert.equal(forged.cash, 5000);
    }
  } finally { owner.activities = [paid, gradual]; rebuildCatalogue('lagos'); }
});


test('an overflowing invalid-action refund does not prevent loading or retry after a later reload', () => {
  const input = {
    cash: Number.MAX_SAFE_INTEGER,
    activeAction: { kind: 'activity', id: 'removed-activity', duration: 10, remaining: 5, paid: 200 },
  };
  const loaded = createLife(input, trusted);
  assert.equal(loaded.cash, Number.MAX_SAFE_INTEGER);
  assert.equal(loaded.activeAction, null);
  assert.match(loaded.message, /could not be refunded.*supported limit.*unchanged/);
  assert.equal(loaded.ledger.some((entry) => entry.reason === 'Refund: unavailable activity'), false);
  assert.deepEqual(createLife(copy(loaded), trusted), loaded);
  // Even if balance space becomes available later, the cleared action cannot mint a delayed refund.
  loaded.cash -= 1000;
  const later = createLife(copy(loaded), trusted);
  assert.equal(later.cash, Number.MAX_SAFE_INTEGER - 1000);
  assert.equal(later.activeAction, null);
  assert.equal(later.ledger.some((entry) => entry.reason === 'Refund: unavailable activity'), false);
});
