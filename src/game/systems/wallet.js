/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * The only place cash changes. Integer naira, never negative, overflow-safe, with a transaction
 * history that can always explain the balance.
 *
 * State keys
 *   cash        integer ≥ 0
 *   ledger      [{ at, amount, reason, balance }], newest last — the last LEDGER_LIMIT changes in full
 *   ledgerDays  [{ day, open, close, in, out, n, by: { [group]: [net, count] } }], newest last — one
 *               summary per Lagos day on which the balance changed, for the last LEDGER_DAYS such
 *               days: opening and closing balance, money in, money out, number of changes, and the
 *               net per reason group (the LEDGER_DAY_GROUPS groups that moved the most money; the
 *               rest fold into "Other").
 * Use through api.js: credit, debit, canAfford, canCredit. Never write state.cash directly.
 *
 * WHY TWO LEVELS
 *   A balance change must never be unexplained. Thirty full lines scroll away within a day of
 *   play; keeping thousands would bloat every save and every poll. So recent changes are kept
 *   line by line and older ones day by day: a player can still see that on Saturday rent took
 *   ₦6,000 and shifts brought ₦7,200 long after the individual lines are gone.
 *
 * THE INVARIANT (checked by statementOf and by the tests)
 *   Every change goes through record(), so line.balance − line.amount is the balance before it,
 *   consecutive lines chain, the last line's balance is `cash`, each day's close is the next
 *   day's open, and open + in − out = close. If a save ever arrives whose cash does not match its
 *   own history (an older format, a damaged file), sanitize adds a visible "Balance correction"
 *   line for the difference instead of letting the balance differ silently.
 *
 * statementOf(state) → the statement shown by Phone → Statement and returned, from the server's
 * own copy of the life, by GET /api/support/statement:
 *   { closing, opening: { balance, day | null }, days: [...ledgerDays], lines: [...ledger],
 *     linesOpening, totals: { in, out, net, changes }, reconciled, problems: [text] }
 */
import { emit } from '../registry.js';
import { cleanText, finite, isRecord, safeCount } from '../util.js';
import { lagosTime } from '../clock.js';

export const STARTING_CASH = 5000; // original beta value
/** Full lines kept (original beta value; was 30). */
export const LEDGER_LIMIT = 60;
/** Daily summaries kept: about five weeks of days with activity (original beta value). */
export const LEDGER_DAYS = 35;
/** Reason groups kept per day before the rest fold into "Other" (original beta value). */
export const LEDGER_DAY_GROUPS = 8;
export const CORRECTION_REASON = 'Balance correction (no record of this change)';
const OTHER = 'Other';
const GROUP_MAX = 28;

const validAmount = (amount) => Number.isSafeInteger(amount) && amount >= 0;

/** Lines that say the same kind of thing share a group: "Rent: Yaba (due …)" → "Rent", "Danfo to X" → "Danfo". */
const PREFIXES = ['Refund', 'Bought', 'Sold', 'Groceries', 'Boutique', 'Transfer from', 'Transfer to', 'Fixed deposit', 'Loan repayment', 'Rent arrears', 'Goal', 'Start cash', 'Fuel'];
export function reasonGroup(reason) {
  const text = String(reason ?? '');
  const known = PREFIXES.find((prefix) => text.startsWith(prefix));
  if (known) return known;
  const cut = text.split(/:| · | \(| to | × /)[0].trim();
  return (cut || OTHER).slice(0, GROUP_MAX);
}

function addToDay(state, at, amount, balance, reason) {
  const day = lagosTime(at).day, days = state.ledgerDays;
  let entry = days.at(-1);
  // A change dated before the newest summary (a clock that stepped back) is counted in the newest one.
  if (!entry || day > entry.day) {
    entry = { day, open: balance - amount, close: balance, in: 0, out: 0, n: 0, by: {} };
    days.push(entry);
    if (days.length > LEDGER_DAYS) days.splice(0, days.length - LEDGER_DAYS);
  }
  entry.close = balance;
  if (amount > 0) entry.in += amount; else entry.out -= amount;
  entry.n += 1;
  const group = reasonGroup(reason);
  const slot = Object.hasOwn(entry.by, group) ? entry.by[group] : (entry.by[group] = [0, 0]);
  slot[0] += amount; slot[1] += 1;
  // Too many groups for one day: the one that moved the least money folds into "Other", so the
  // big items (rent, wages, a purchase) stay named however busy the day was.
  const named = Object.keys(entry.by).filter((key) => key !== OTHER);
  if (named.length > LEDGER_DAY_GROUPS) {
    const smallest = named.reduce((least, key) => (Math.abs(entry.by[key][0]) < Math.abs(entry.by[least][0]) ? key : least));
    const other = Object.hasOwn(entry.by, OTHER) ? entry.by[OTHER] : (entry.by[OTHER] = [0, 0]);
    other[0] += entry.by[smallest][0]; other[1] += entry.by[smallest][1];
    delete entry.by[smallest];
  }
}

function record(state, amount, reason, ctx) {
  if (!amount) return;
  const line = { at: finite(ctx?.now) ? ctx.now : state.t, amount, reason: cleanText(reason, 80, 'Adjustment'), balance: state.cash };
  state.ledger.push(line);
  if (state.ledger.length > LEDGER_LIMIT) state.ledger.splice(0, state.ledger.length - LEDGER_LIMIT);
  addToDay(state, line.at, amount, line.balance, line.reason);
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

/**
 * The statement: where the balance started within the kept history, every kept change, and
 * where it stands — with the arithmetic checked. `reconciled` is true when the opening balance
 * plus every kept change equals the closing balance at both levels; `problems` names anything
 * that does not add up (it should always be empty).
 */
export function statementOf(state) {
  const lines = state.ledger.map((line) => ({ ...line }));
  const days = state.ledgerDays.map((day) => ({ day: day.day, open: day.open, close: day.close, in: day.in, out: day.out, changes: day.n,
    groups: Object.entries(day.by).map(([group, [net, count]]) => ({ group, net, count })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || (a.group < b.group ? -1 : 1)) }));
  const problems = [];
  const linesOpening = lines.length ? lines[0].balance - lines[0].amount : state.cash;
  for (let i = 1; i < lines.length; i++) if (lines[i].balance - lines[i].amount !== lines[i - 1].balance) problems.push(`Line ${i + 1} does not follow from the line before it.`);
  if (lines.length && lines.at(-1).balance !== state.cash) problems.push('The last recorded change does not end at the current balance.');
  for (let i = 0; i < days.length; i++) {
    if (days[i].open + days[i].in - days[i].out !== days[i].close) problems.push(`Day ${days[i].day} does not add up.`);
    if (i > 0 && days[i].open !== days[i - 1].close) problems.push(`Day ${days[i].day} does not open where the day before closed.`);
  }
  if (days.length && days.at(-1).close !== state.cash) problems.push('The last day does not close at the current balance.');
  const opening = days.length ? { balance: days[0].open, day: days[0].day } : { balance: linesOpening, day: null };
  const totals = days.length ? { in: days.reduce((sum, day) => sum + day.in, 0), out: days.reduce((sum, day) => sum + day.out, 0), changes: days.reduce((sum, day) => sum + day.changes, 0) }
    : { in: lines.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0), out: -lines.filter((line) => line.amount < 0).reduce((sum, line) => sum + line.amount, 0), changes: lines.length };
  totals.net = totals.in - totals.out;
  if (opening.balance + totals.net !== state.cash) problems.push('Opening balance plus every change does not equal the closing balance.');
  return { closing: state.cash, opening, days, lines, linesOpening, totals, reconciled: problems.length === 0, problems,
    kept: { lines: LEDGER_LIMIT, days: LEDGER_DAYS } };
}

function sanitizeDays(saved) {
  const days = [];
  for (const item of Array.isArray(saved) ? saved.slice(-LEDGER_DAYS) : []) {
    if (!isRecord(item) || !Number.isSafeInteger(item.day) || !safeCount(item.open) || !safeCount(item.close) || !safeCount(item.in) || !safeCount(item.out) || !safeCount(item.n) || !isRecord(item.by)) return null;
    if (item.open + item.in - item.out !== item.close || (days.length && (item.day <= days.at(-1).day || item.open !== days.at(-1).close))) return null;
    const by = {};
    if (Object.keys(item.by).length > LEDGER_DAY_GROUPS + 1) return null;
    for (const [group, value] of Object.entries(item.by)) {
      if (!Array.isArray(value) || !Number.isSafeInteger(value[0]) || !safeCount(value[1])) return null;
      by[cleanText(group, GROUP_MAX, OTHER)] = [value[0], value[1]];
    }
    days.push({ day: item.day, open: item.open, close: item.close, in: item.in, out: item.out, n: item.n, by });
  }
  return days;
}

export default {
  id: 'wallet',
  stateKeys: ['cash', 'ledger', 'ledgerDays'],
  sanitize(input, state) {
    state.cash = safeCount(input.cash) ? input.cash : STARTING_CASH;
    state.ledger = (Array.isArray(input.ledger) ? input.ledger : []).slice(-LEDGER_LIMIT)
      .filter((entry) => entry && finite(entry.at) && Number.isSafeInteger(entry.amount) && entry.amount !== 0
        && safeCount(entry.balance) && typeof entry.reason === 'string')
      .map((entry) => ({ at: entry.at, amount: entry.amount, reason: cleanText(entry.reason, 80, 'Adjustment'), balance: entry.balance }));
    // Daily summaries: kept as saved when they are consistent with themselves and with the
    // balance; otherwise (a save from before they existed, or a damaged one) rebuilt from the lines.
    const saved = sanitizeDays(input.ledgerDays);
    if (saved && saved.length && saved.at(-1).close === state.cash) state.ledgerDays = saved;
    else {
      state.ledgerDays = [];
      for (const line of state.ledger) addToDay(state, line.at, line.amount, line.balance, line.reason);
    }
    // The history must end at the balance. If it does not, say so in the history itself.
    const last = state.ledger.at(-1);
    if (last && last.balance !== state.cash) {
      const line = { at: Math.max(state.t, last.at), amount: state.cash - last.balance, reason: CORRECTION_REASON, balance: state.cash };
      state.ledger.push(line);
      if (state.ledger.length > LEDGER_LIMIT) state.ledger.shift();
      state.ledgerDays = [];
      for (const entry of state.ledger) addToDay(state, entry.at, entry.amount, entry.balance, entry.reason);
    }
  },
  actions: {},
  advance() {},
  view(state) {
    const statement = statementOf(state);
    return { cash: state.cash, ledger: state.ledger.slice().reverse(), days: statement.days.slice().reverse(),
      statement: { opening: statement.opening, closing: statement.closing, totals: statement.totals, reconciled: statement.reconciled, problems: statement.problems, kept: statement.kept, linesOpening: statement.linesOpening } };
  },
};
