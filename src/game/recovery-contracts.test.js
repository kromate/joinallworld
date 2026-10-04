import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife } from '../life.js';
import { registerSystem } from './registry.js';
import { rebuildCatalogue } from './systems/activities.js';

const ctx = { now: 100000, cityId: 'lagos' };
const trusted = { ...ctx, trustedSave: true };
const paid = { id: 'recovery-paid', label: 'Recovery paid', duration: 10, cost: 100,
  chargeOn: 'start', where: { venue: 'park', spot: 'drinks' } };
const gradual = { id: 'recovery-gradual', label: 'Recovery gradual', duration: 10, cost: 100,
  chargeOn: 'start', refundOnCancel: false, effectsPerSecond: { energy: 1 },
  where: { venue: 'park', spot: 'drinks' } };
const owner = registerSystem({ id: 'recovery-probe', stateKeys: ['recoveryProbe'],
  sanitize(input, state) { state.recoveryProbe = {}; },
  actions: {
    'recovery-undeclared'(state) { state.undeclaredRecoveryValue = 42; return { ok: true, state }; },
  },
  modifiers: { 'activity.cost': (cost, state, { def }) => def.id === paid.id ? cost * 2 : cost },
  activities: [paid, gradual],
});
rebuildCatalogue();
const fresh = () => createLife({ spot: 'drinks' }, ctx);
const start = (state, id) => dispatch(state, { type: 'activity', id }, ctx);
const copy = (state) => JSON.parse(JSON.stringify(state));

// DESIGN CONFLICT (kept visible, not run). The navigation lane forbids a priced activity with per-second
// gains unless it is charged at the start and never refunded: such a definition makes rebuildCatalogue throw.
// This branch allows those definitions and METERS them instead (src/game/systems/activities.js, METERED
// ACTIVITIES): stopping early costs price × elapsed ÷ duration, so gains that accrued are always paid for
// (src/game/contracts.test.js, 'a metered activity charged on completion…' and '…charged at the start…').
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
      assert.throws(rebuildCatalogue, /paid per-second gains/);
      delete gradual.choices;
    }
  } finally {
    Object.assign(gradual, { chargeOn: 'start', refundOnCancel: false, effectsPerSecond: { energy: 1 } });
    delete gradual.xpPerSecond;
    rebuildCatalogue();
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
  assert.throws(() => dispatch(state, { type: 'recovery-undeclared' }, ctx), /Undeclared state key/);
  assert.equal(Object.hasOwn(state, 'undeclaredRecoveryValue'), false);
  const original = owner.sanitize;
  try {
    owner.sanitize = (input, output) => { output.undeclaredRecoveryValue = 1; };
    assert.throws(fresh, /Undeclared state key/);
  } finally { owner.sanitize = original; }
  assert.deepEqual(createLife(state, ctx), state);
});

test('trusted invalidation refunds actual modified payment exactly once after definition changes', () => {
  const state = fresh();
  assert.equal(start(state, paid.id).ok, true);
  assert.equal(state.cash, 4800);
  assert.equal(state.activeAction.paid, 200);
  try {
    paid.cost = 1;
    const stillValid = createLife(copy(state), trusted);
    assert.equal(stillValid.activeAction.paid, 200);
    dispatch(stillValid, { type: 'cancel' }, ctx);
    assert.equal(stillValid.cash, 5000);
    paid.duration = 20;
    const refunded = createLife(copy(state), trusted);
    assert.equal(refunded.activeAction, null);
    assert.equal(refunded.cash, 5000);
    assert.equal(refunded.ledger.at(-1).amount, 200);
    assert.deepEqual(createLife(copy(refunded), trusted), refunded);
    assert.equal(createLife(copy(state), ctx).cash, 4800, 'untrusted hydrate cannot mint a refund');
  } finally { paid.cost = 100; paid.duration = 10; rebuildCatalogue(); }
});

test('trusted removed and malformed actions refund once; arbitrary client paid values never mint', () => {
  const state = fresh(); start(state, paid.id);
  try {
    owner.activities = [gradual]; rebuildCatalogue();
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
  } finally { owner.activities = [paid, gradual]; rebuildCatalogue(); }
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
