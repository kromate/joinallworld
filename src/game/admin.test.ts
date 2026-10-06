import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await preloadCityContent('lagos');
// The operator's actions on a life (server/admin): server-only, one ledger line each, never counted as earned, never below zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch } from '../life.ts';

const NOW = Date.UTC(2026, 0, 5, 9);
const fresh = () => createLife(null, { now: NOW, cityId: 'lagos', isNew: true });
const internal = { now: NOW + 1000, cityId: 'lagos', internal: true as const };

test('wallet.admin is refused to a player and credits and debits as ledger lines of their own', () => {
  const state = fresh(), start = state.cash, earned = state.social.earned;
  assert.equal(dispatch(state, { type: 'wallet.admin', payload: { op: 'credit', amount: 100, reason: 'x' } }, { now: NOW, cityId: 'lagos' }).code, 'server_only');
  assert.equal(state.cash, start);
  assert.equal(dispatch(state, { type: 'wallet.admin', payload: { op: 'credit', amount: 5000, reason: 'launch bonus' } }, internal).code, 'credited');
  assert.equal(state.cash, start + 5000); assert.equal(state.ledger.at(-1)?.reason, 'Admin credit: launch bonus');
  assert.equal(state.social.earned, earned, 'not earned from work: no gifting is unlocked');
  const before = state.cash;
  assert.equal(dispatch(state, { type: 'wallet.admin', payload: { op: 'debit', amount: before + 99999, reason: 'correction' } }, internal).code, 'debited');
  assert.equal(state.cash, 0, 'a debit takes at most the balance'); assert.equal(state.ledger.at(-1)?.amount, -before);
  assert.equal(state.ledger.at(-1)?.reason, 'Admin debit: correction');
  assert.equal(dispatch(state, { type: 'wallet.admin', payload: { op: 'credit', amount: -5, reason: 'x' } }, internal).code, 'invalid_amount');
  assert.equal(dispatch(state, { type: 'wallet.admin', payload: { op: 'credit', amount: 1.5, reason: 'x' } }, internal).code, 'invalid_amount');
  // The balance is the opening balance plus the ledger.
  const first = state.ledger[0]; assert.ok(first);
  assert.equal(state.cash, first.balance - first.amount + state.ledger.reduce((sum, line) => sum + line.amount, 0));
});

test('wallet.bonus is server-only, one labelled ledger line, a faucet that is not earned from work and is not skimmed by the ride debt', () => {
  const state = fresh(), start = state.cash, earned = state.social.earned, reason = 'Launch bonus: one of the first 10,000 players';
  assert.equal(dispatch(state, { type: 'wallet.bonus', payload: { amount: 1_000_000, reason } }, { now: NOW, cityId: 'lagos' }).code, 'server_only');
  assert.equal(state.cash, start);
  state.travel.rideDebt = 2_000_000;
  assert.equal(dispatch(state, { type: 'wallet.bonus', payload: { amount: 1_000_000, reason } }, internal).code, 'credited');
  assert.equal(state.cash, start + 1_000_000, 'half is not taken for the ride debt: only an earning or a gift is shared with it');
  assert.equal(state.travel.rideDebt, 2_000_000);
  assert.equal(state.ledger.at(-1)?.reason, reason);
  assert.equal(state.social.earned, earned, 'not earned from work: no gifting is unlocked and no buying from players');
  assert.equal(dispatch(state, { type: 'wallet.bonus', payload: { amount: 0, reason } }, internal).code, 'invalid_amount');
  assert.equal(dispatch(state, { type: 'wallet.bonus', payload: { amount: 1.5, reason } }, internal).code, 'invalid_amount');
  const first = state.ledger[0]; assert.ok(first);
  assert.equal(state.cash, first.balance - first.amount + state.ledger.reduce((sum, line) => sum + line.amount, 0), 'cash is the opening balance plus the ledger');
  // Whole-debt rule: a bonus that makes the debt comfortably affordable clears it, as an ordinary sink.
  const rich = fresh(); rich.travel.rideDebt = 12000;
  assert.equal(dispatch(rich, { type: 'wallet.bonus', payload: { amount: 1_000_000, reason } }, internal).code, 'credited');
  assert.equal('rideDebt' in rich.travel, false);
});

test('needs.admin sets one need or lifts the low ones, and refuses an unknown need', () => {
  const state = fresh();
  assert.equal(dispatch(state, { type: 'needs.admin', payload: { op: 'set', need: 'hunger', value: 7.4 } }, internal).code, 'set');
  assert.equal(state.needs.hunger, 7);
  assert.equal(dispatch(state, { type: 'needs.admin', payload: { op: 'heal' } }, internal).code, 'healed');
  assert.ok(Object.values(state.needs).every((value) => value >= 80));
  assert.equal(dispatch(state, { type: 'needs.admin', payload: { op: 'set', need: 'nope', value: 1 } }, internal).code, 'invalid_need');
  assert.equal(dispatch(state, { type: 'needs.admin', payload: { op: 'set', need: 'fun', value: 1 } }, { now: NOW, cityId: 'lagos' }).code, 'server_only');
});
