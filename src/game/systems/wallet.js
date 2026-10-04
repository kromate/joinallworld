/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * The only place cash changes. Integer naira, never negative, overflow-safe, with a short
 * transaction log so the UI can always explain a balance change.
 *
 * State keys: cash (integer ≥ 0), ledger ([{ at, amount, reason, balance }], newest last, max 30).
 * Use through api.js: credit, debit, canAfford, canCredit. Never write state.cash directly.
 */
import { emit } from '../registry.js';
import { cleanText, finite, safeCount } from '../util.js';

export const STARTING_CASH = 5000; // original beta value
export const LEDGER_LIMIT = 30;

const validAmount = (amount) => Number.isSafeInteger(amount) && amount >= 0;

function record(state, amount, reason, ctx) {
  if (!amount) return;
  state.ledger.push({ at: finite(ctx?.now) ? ctx.now : state.t, amount, reason: cleanText(reason, 80, 'Adjustment'), balance: state.cash });
  if (state.ledger.length > LEDGER_LIMIT) state.ledger.splice(0, state.ledger.length - LEDGER_LIMIT);
  emit(state, 'wallet.changed', { amount, reason, balance: state.cash }, ctx);
}

export const canAfford = (state, amount) => validAmount(amount) && state.cash >= amount;
export const canCredit = (state, amount) => validAmount(amount) && Number.isSafeInteger(state.cash + amount);

/** Add cash. Returns false (and changes nothing) if the amount is invalid or would overflow. */
export function credit(state, amount, reason, ctx) {
  if (!canCredit(state, amount)) return false;
  state.cash += amount;
  record(state, amount, reason, ctx);
  return true;
}

/**
 * Remove cash. Returns false (and changes nothing) if the player cannot afford it.
 * With { partial: true } it takes what is available instead and returns the amount taken.
 */
export function debit(state, amount, reason, ctx, { partial = false } = {}) {
  if (!validAmount(amount)) return false;
  if (state.cash < amount && !partial) return false;
  const taken = Math.min(amount, state.cash);
  state.cash -= taken;
  record(state, -taken, reason, ctx);
  return partial ? taken : true;
}

export default {
  id: 'wallet',
  stateKeys: ['cash', 'ledger'],
  sanitize(input, state) {
    state.cash = safeCount(input.cash) ? input.cash : STARTING_CASH;
    state.ledger = (Array.isArray(input.ledger) ? input.ledger : []).slice(-LEDGER_LIMIT)
      .filter((entry) => entry && finite(entry.at) && Number.isSafeInteger(entry.amount) && entry.amount !== 0
        && safeCount(entry.balance) && typeof entry.reason === 'string')
      .map((entry) => ({ at: entry.at, amount: entry.amount, reason: cleanText(entry.reason, 80, 'Adjustment'), balance: entry.balance }));
  },
  actions: {},
  advance() {},
  view(state) { return { cash: state.cash, ledger: state.ledger.slice().reverse() }; },
};
