/**
 * OWNER: career
 * Weekly rent, the birth-lottery loan, and a small fixed-deposit savings product.
 *
 * Every naira moves through api.credit/api.debit with a reason, so the Bank ledger explains it.
 * Nothing here creates money except deposit interest, which is capped (see DEPOSIT_*).
 *
 * BILLING (rules marked "original" were not observed in the reference game)
 *   - Bills fall due every Saturday at 00:00 Lagos time (weekly rent "paid every Saturday" and
 *     the rent amounts were observed; how the reference game collects is unknown, so the rest is
 *     original). The billing week index is the idempotency key: `billedWeek` is the last
 *     Saturday already settled, so a Saturday is never billed twice however often we settle.
 *   - Settled inside advance(), so bills are collected even while the player is offline. A long
 *     absence is caught up for at most MAX_CATCHUP_WEEKS Saturdays; older ones are written off.
 *   - Rent is never taken in part. If the full rent cannot be paid it is MISSED: the amount
 *     becomes visible arrears, an "Owing rent" feeling appears, and the player has until the
 *     next Saturday (the grace period) to pay with "Pay rent now". Each later Saturday still in
 *     arrears adds a late fee of LATE_FEE_PERCENT of one week's rent. Arrears are collected
 *     automatically on a Saturday when the balance covers them, and are capped at
 *     MAX_ARREARS_WEEKS of rent plus fees. Nobody is evicted by this system (original).
 *   - Loan: ₦60,000 principal, ₦72,000 to repay, ₦12,000 a week (observed). The principal is
 *     part of the starting cash set by onboarding, so this system records the debt and never
 *     credits it. Collected each Saturday after rent. "Pay ₦12,000 now" is an early instalment
 *     that covers the next Saturday's collection; "Pay it all off" clears the balance. A missed
 *     instalment stays owed and adds LOAN_LATE_FEE, at most MAX_LOAN_FEES times (original).
 *
 * SAVINGS (original beta product, not from the reference game)
 *   Fixed deposits: lock cash for 1, 3 or 7 days; principal plus simple interest is paid back
 *   automatically at maturity on server time. Closing early returns the principal only. At most
 *   DEPOSIT_MAX_OPEN deposits and DEPOSIT_TOTAL_CAP locked at once, so interest is bounded.
 *
 * ACTIONS
 *   'economy.pay-loan'       { mode: 'week' | 'all' }
 *   'economy.pay-rent'       {}                      pay rent arrears now
 *   'economy.open-deposit'   { amount, term }        term: a DEPOSIT_TERMS id
 *   'economy.close-deposit'  { id }                  early withdrawal, principal only
 *
 * STATE  state.economy = {
 *   billedWeek   index of the last Saturday settled | null (nothing to bill yet)
 *   started      true once 'life.started' has been handled (it sets up the loan once)
 *   rent         { house: id | null, arrears, missed }      missed = Saturdays missed in a row
 *   loan         null | { left, prepaid, fees }             prepaid = Saturdays already covered
 *   deposits     [{ id, amount, term, openedAt }]
 *   seq          counter for deposit ids
 * }
 *
 * LISTENS  'life.started' { house, lottery }   sets the rent house and, for the loan outcome, the loan
 *          'house.moved'  { id }               changes the rent from the next Saturday
 * EMITS    'rent.due' { amount, house } · 'rent.paid' { amount, house, arrears } ·
 *          'rent.missed' { amount, house, arrears, missed } · 'loan.paid' { amount, left } ·
 *          'loan.missed' { amount, left } · 'deposit.opened' { id, amount, term } ·
 *          'deposit.closed' { id, amount, interest }
 */
import { emit } from '../registry.js';
import { fail, isId, isRecord, naira, ok, safeCount } from '../util.js';
import { lagosTime, lagosDayStart, LAGOS_OFFSET_MS, WEEKDAYS } from '../clock.js';
import { addMoodlet, canAfford, canCredit, credit, debit, removeMoodlet } from '../api.js';

const DAY_MS = 86400000;

/** Weekly rent by house id (observed in the reference game). Names are original labels. */
export const RENTS = Object.freeze({
  mushin: { id: 'mushin', label: 'Mushin room', rent: 2400 },
  yaba: { id: 'yaba', label: 'Yaba self-contain', rent: 6000 },
  lekki: { id: 'lekki', label: 'Lekki mini-flat', rent: 17000 },
  ikoyi: { id: 'ikoyi', label: 'Ikoyi duplex', rent: 250000 },
  banana: { id: 'banana', label: 'Banana Island mansion', rent: 1500000 },
});

/** Loan figures observed in the reference game. */
export const LOAN = Object.freeze({ principal: 60000, total: 72000, weekly: 12000 });
/** Original beta values. */
export const LOAN_LATE_FEE = 500;
export const MAX_LOAN_FEES = 4;
export const LATE_FEE_PERCENT = 10;
export const MAX_ARREARS_WEEKS = 4;
export const MAX_CATCHUP_WEEKS = 4;

/** Fixed-deposit terms and limits (original beta values). `bps` is simple interest in basis points. */
export const DEPOSIT_TERMS = Object.freeze({
  d1: { id: 'd1', label: '1 day', days: 1, bps: 50 },
  d3: { id: 'd3', label: '3 days', days: 3, bps: 200 },
  d7: { id: 'd7', label: '7 days', days: 7, bps: 500 },
});
export const DEPOSIT_MIN = 1000;
export const DEPOSIT_MAX = 50000;
export const DEPOSIT_MAX_OPEN = 3;
export const DEPOSIT_TOTAL_CAP = 100000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nowOf = (state, ctx) => (Number.isFinite(ctx?.now) ? ctx.now : state.t);

/** Number of the billing week: increases by one at every Saturday 00:00 Lagos time. */
export const billingWeek = (ms) => Math.floor((lagosTime(ms).day - 2) / 7);
/** Server ms of the Saturday that starts billing week `week`. */
export const dueAt = (week) => lagosDayStart(week * 7 + 2);
/** "Sat 10 Oct" in Lagos time. */
export function dateLabel(ms) {
  const local = new Date(ms + LAGOS_OFFSET_MS);
  return `${WEEKDAYS[local.getUTCDay()].slice(0, 3)} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

const houseOf = (id) => (typeof id === 'string' && Object.hasOwn(RENTS, id) ? RENTS[id] : null);
const idOf = (value) => (isRecord(value) ? value.id : value);
const interestOf = (deposit) => Math.floor((deposit.amount * DEPOSIT_TERMS[deposit.term].bps) / 10000);
const maturesAt = (deposit) => deposit.openedAt + DEPOSIT_TERMS[deposit.term].days * DAY_MS;
const lockedTotal = (economy) => economy.deposits.reduce((sum, deposit) => sum + deposit.amount, 0);
const arrearsCap = (house) => Math.round(house.rent * MAX_ARREARS_WEEKS * (1 + LATE_FEE_PERCENT / 100));
const lateFee = (house) => Math.round((house.rent * LATE_FEE_PERCENT) / 100);

function startBilling(state, ctx) {
  if (state.economy.billedWeek === null) state.economy.billedWeek = billingWeek(nowOf(state, ctx));
}

function setArrearsFeeling(state, ctx) {
  if (state.economy.rent.arrears > 0) addMoodlet(state, { id: 'rent-arrears', label: 'Owing rent', value: -8 }, ctx); // original beta value
  else removeMoodlet(state, 'rent-arrears');
}

/** Settle one Saturday: arrears, then this week's rent, then the loan instalment. */
function bill(state, week, ctx) {
  const economy = state.economy, rent = economy.rent, house = houseOf(rent.house);
  const due = dateLabel(dueAt(week));
  if (house) {
    if (rent.arrears > 0) {
      if (debit(state, rent.arrears, `Rent arrears: ${house.label}`, ctx)) {
        emit(state, 'rent.paid', { amount: rent.arrears, house: house.id, arrears: 0 }, ctx);
        rent.arrears = 0;
        rent.missed = 0;
      } else rent.arrears = Math.min(arrearsCap(house), rent.arrears + lateFee(house));
    }
    emit(state, 'rent.due', { amount: house.rent, house: house.id }, ctx);
    if (debit(state, house.rent, `Rent: ${house.label} (due ${due})`, ctx)) {
      emit(state, 'rent.paid', { amount: house.rent, house: house.id, arrears: rent.arrears }, ctx);
    } else {
      rent.arrears = Math.min(arrearsCap(house), rent.arrears + house.rent);
      rent.missed += 1;
      state.message = `Rent missed: ${naira(house.rent)} for ${house.label} was due ${due} and you had ${naira(state.cash)}. You now owe ${naira(rent.arrears)}. Pay it in Phone → Bank before next Saturday to avoid a late fee.`;
      emit(state, 'rent.missed', { amount: house.rent, house: house.id, arrears: rent.arrears, missed: rent.missed }, ctx);
    }
    setArrearsFeeling(state, ctx);
  }
  const loan = economy.loan;
  if (loan && loan.left > 0) {
    if (loan.prepaid > 0) loan.prepaid -= 1;
    else {
      const amount = Math.min(LOAN.weekly, loan.left);
      if (debit(state, amount, `Loan repayment (due ${due})`, ctx)) {
        loan.left -= amount;
        emit(state, 'loan.paid', { amount, left: loan.left }, ctx);
      } else {
        if (loan.fees < MAX_LOAN_FEES) { loan.fees += 1; loan.left += LOAN_LATE_FEE; }
        emit(state, 'loan.missed', { amount, left: loan.left }, ctx);
      }
    }
  }
}

const actions = {
  'economy.pay-loan'(state, payload, ctx) {
    const loan = state.economy.loan;
    if (!loan || loan.left <= 0) return fail(state, 'no_loan', 'You have no loan balance to pay.');
    if (payload.mode !== 'week' && payload.mode !== 'all') return fail(state, 'invalid_payment', 'Choose one instalment or the full balance.');
    const amount = payload.mode === 'all' ? loan.left : Math.min(LOAN.weekly, loan.left);
    if (!debit(state, amount, payload.mode === 'all' ? 'Loan paid off in full' : 'Loan repayment (paid early)', ctx)) {
      return fail(state, 'insufficient_funds', `This payment is ${naira(amount)} and you have ${naira(state.cash)}. Earn ${naira(amount - state.cash)} more first.`);
    }
    loan.left -= amount;
    if (loan.left <= 0) loan.prepaid = 0;
    else if (payload.mode === 'week') loan.prepaid = Math.min(loan.prepaid + 1, Math.ceil(loan.left / LOAN.weekly));
    state.message = loan.left > 0 ? `Paid ${naira(amount)} towards your loan. ${naira(loan.left)} left; this covers the next Saturday collection.` : 'Loan paid off in full. No more weekly collections.';
    emit(state, 'loan.paid', { amount, left: loan.left }, ctx);
    return ok(state, loan.left > 0 ? 'loan_paid' : 'loan_cleared');
  },
  'economy.pay-rent'(state, payload, ctx) {
    const rent = state.economy.rent, house = houseOf(rent.house);
    if (!house || rent.arrears <= 0) return fail(state, 'nothing_due', 'No rent is overdue. Rent is collected automatically every Saturday.');
    const amount = rent.arrears;
    if (!debit(state, amount, `Rent arrears: ${house.label}`, ctx)) {
      return fail(state, 'insufficient_funds', `You owe ${naira(amount)} in rent and have ${naira(state.cash)}. Earn ${naira(amount - state.cash)} more first.`);
    }
    rent.arrears = 0;
    rent.missed = 0;
    setArrearsFeeling(state, ctx);
    state.message = `Rent arrears of ${naira(amount)} paid. You are up to date.`;
    emit(state, 'rent.paid', { amount, house: house.id, arrears: 0 }, ctx);
    return ok(state, 'rent_paid');
  },
  'economy.open-deposit'(state, payload, ctx) {
    const economy = state.economy;
    const term = typeof payload.term === 'string' && Object.hasOwn(DEPOSIT_TERMS, payload.term) ? DEPOSIT_TERMS[payload.term] : null;
    if (!term) return fail(state, 'invalid_term', 'Choose a 1, 3 or 7 day term.');
    const amount = payload.amount;
    if (!Number.isSafeInteger(amount) || amount < DEPOSIT_MIN || amount > DEPOSIT_MAX) {
      return fail(state, 'invalid_amount', `A deposit must be a whole amount from ${naira(DEPOSIT_MIN)} to ${naira(DEPOSIT_MAX)}.`);
    }
    if (economy.rent.arrears > 0) return fail(state, 'rent_arrears', `Pay your ${naira(economy.rent.arrears)} rent arrears in Phone → Bank before opening a deposit.`);
    if (economy.deposits.length >= DEPOSIT_MAX_OPEN) return fail(state, 'deposit_limit', `You can hold ${DEPOSIT_MAX_OPEN} deposits at a time. Wait for one to mature or close one early.`);
    const room = DEPOSIT_TOTAL_CAP - lockedTotal(economy);
    if (amount > room) return fail(state, 'deposit_cap', `At most ${naira(DEPOSIT_TOTAL_CAP)} can be locked in deposits at once. You can add up to ${naira(Math.max(0, room))} more.`);
    if (!Number.isSafeInteger(economy.seq + 1)) return fail(state, 'deposit_limit', 'This life has reached its deposit limit.');
    if (!debit(state, amount, `Fixed deposit opened (${term.label})`, ctx)) {
      return fail(state, 'insufficient_funds', `This deposit is ${naira(amount)} and you have ${naira(state.cash)}.`);
    }
    economy.seq += 1;
    const deposit = { id: `fd-${economy.seq}`, amount, term: term.id, openedAt: nowOf(state, ctx) };
    economy.deposits.push(deposit);
    state.message = `${naira(amount)} locked for ${term.label}. ${naira(amount + interestOf(deposit))} returns to your balance on ${dateLabel(maturesAt(deposit))}.`;
    emit(state, 'deposit.opened', { id: deposit.id, amount, term: term.id }, ctx);
    return ok(state, 'deposit_opened');
  },
  'economy.close-deposit'(state, payload, ctx) {
    const economy = state.economy;
    const index = economy.deposits.findIndex((deposit) => deposit.id === payload.id);
    if (index < 0) return fail(state, 'no_deposit', 'That deposit is not open. It may already have been paid out.');
    const deposit = economy.deposits[index];
    const matured = nowOf(state, ctx) >= maturesAt(deposit);
    const interest = matured ? interestOf(deposit) : 0;
    if (!canCredit(state, deposit.amount + interest)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
    economy.deposits.splice(index, 1);
    credit(state, deposit.amount + interest, matured ? `Fixed deposit matured: ${naira(deposit.amount)} + ${naira(interest)} interest` : 'Fixed deposit closed early (no interest)', ctx);
    state.message = matured ? `Deposit paid out: ${naira(deposit.amount)} plus ${naira(interest)} interest.` : `Deposit closed early: ${naira(deposit.amount)} returned, no interest.`;
    emit(state, 'deposit.closed', { id: deposit.id, amount: deposit.amount, interest }, ctx);
    return ok(state, 'deposit_closed');
  },
};

function sanitizeDeposits(saved, now) {
  const deposits = [], seen = new Set();
  let total = 0;
  for (const item of Array.isArray(saved) ? saved.slice(0, 50) : []) {
    if (deposits.length >= DEPOSIT_MAX_OPEN) break;
    if (!isRecord(item) || !isId(item.id) || seen.has(item.id) || typeof item.term !== 'string' || !Object.hasOwn(DEPOSIT_TERMS, item.term)) continue;
    if (!Number.isSafeInteger(item.amount) || item.amount < DEPOSIT_MIN || item.amount > DEPOSIT_MAX || total + item.amount > DEPOSIT_TOTAL_CAP) continue;
    if (!Number.isFinite(item.openedAt) || item.openedAt < 0 || item.openedAt > now) continue;
    seen.add(item.id);
    total += item.amount;
    deposits.push({ id: item.id, amount: item.amount, term: item.term, openedAt: item.openedAt });
  }
  return deposits;
}

export default {
  id: 'economy',
  stateKeys: ['economy'],
  sanitize(input, state, ctx) {
    const saved = isRecord(input.economy) ? input.economy : {};
    const rent = isRecord(saved.rent) ? saved.rent : {};
    const house = houseOf(rent.house);
    const loan = isRecord(saved.loan) ? saved.loan : null;
    const maxLeft = LOAN.total + LOAN_LATE_FEE * MAX_LOAN_FEES;
    const validLoan = loan && safeCount(loan.left) && loan.left <= maxLeft;
    const fees = validLoan && Number.isInteger(loan.fees) && loan.fees >= 0 && loan.fees <= MAX_LOAN_FEES ? loan.fees : 0;
    // Saved times are checked against the later of the server clock and the save's own clock.
    const now = Math.max(Number.isFinite(ctx?.now) ? ctx.now : 0, state.t);
    state.economy = {
      billedWeek: Number.isSafeInteger(saved.billedWeek) ? Math.min(saved.billedWeek, billingWeek(now)) : null,
      started: saved.started === true,
      rent: {
        house: house?.id ?? null,
        arrears: house && safeCount(rent.arrears) ? Math.min(rent.arrears, arrearsCap(house)) : 0,
        missed: house && safeCount(rent.missed) ? Math.min(rent.missed, 1000) : 0,
      },
      loan: validLoan ? {
        left: Math.min(loan.left, LOAN.total + LOAN_LATE_FEE * fees),
        prepaid: safeCount(loan.prepaid) ? Math.min(loan.prepaid, Math.ceil(loan.left / LOAN.weekly)) : 0,
        fees,
      } : null,
      deposits: sanitizeDeposits(saved.deposits, now),
      seq: safeCount(saved.seq) ? saved.seq : 0,
    };
  },
  actions,
  on: {
    'life.started'(state, data, ctx) {
      const economy = state.economy;
      const house = houseOf(idOf(data?.house));
      if (house) economy.rent.house = house.id;
      if (!economy.started) {
        economy.started = true;
        const lottery = data?.lottery, id = idOf(lottery);
        const hasLoan = (typeof id === 'string' && id.toLowerCase().includes('lapo')) || (isRecord(lottery) && Boolean(lottery.loan));
        if (hasLoan && !economy.loan) economy.loan = { left: LOAN.total, prepaid: 0, fees: 0 };
      }
      if (economy.rent.house || economy.loan) startBilling(state, ctx);
    },
    'house.moved'(state, data, ctx) {
      const house = houseOf(idOf(data?.id ?? data?.house));
      if (!house) return;
      state.economy.rent.house = house.id;
      startBilling(state, ctx);
    },
  },
  advance(state, dt, ctx) {
    const economy = state.economy, now = nowOf(state, ctx);
    for (let index = economy.deposits.length - 1; index >= 0; index--) {
      const deposit = economy.deposits[index];
      if (now < maturesAt(deposit)) continue;
      const interest = interestOf(deposit);
      if (!credit(state, deposit.amount + interest, `Fixed deposit matured: ${naira(deposit.amount)} + ${naira(interest)} interest`, ctx)) continue;
      economy.deposits.splice(index, 1);
      emit(state, 'deposit.closed', { id: deposit.id, amount: deposit.amount, interest }, ctx);
    }
    if (economy.billedWeek === null) return;
    const current = billingWeek(now);
    if (current <= economy.billedWeek) return;
    const first = Math.max(economy.billedWeek + 1, current - MAX_CATCHUP_WEEKS + 1);
    economy.billedWeek = current;
    for (let week = first; week <= current; week++) bill(state, week, ctx);
  },
  view(state, ctx) {
    const economy = state.economy, now = nowOf(state, ctx);
    const house = houseOf(economy.rent.house);
    const nextDue = dueAt(billingWeek(now) + 1);
    const nextDueLabel = dateLabel(nextDue);
    const loan = economy.loan;
    const instalment = loan ? Math.min(LOAN.weekly, loan.left) : 0;
    const short = (amount) => `You have ${naira(state.cash)}; this needs ${naira(amount)}.`;
    const locked = lockedTotal(economy);
    const room = Math.max(0, DEPOSIT_TOTAL_CAP - locked);
    const depositBlock = economy.rent.arrears > 0 ? `Pay your ${naira(economy.rent.arrears)} rent arrears first.`
      : economy.deposits.length >= DEPOSIT_MAX_OPEN ? `You already hold ${DEPOSIT_MAX_OPEN} deposits, the most allowed at once.`
      : room < DEPOSIT_MIN ? `You already have ${naira(locked)} locked, the most allowed at once.` : null;
    return {
      nextDue, nextDueLabel,
      weeklyBills: (house ? house.rent : 0) + (loan && loan.left > 0 ? instalment : 0),
      rent: house ? {
        house: house.id, label: house.label, amount: house.rent, nextDue, nextDueLabel,
        arrears: economy.rent.arrears, missed: economy.rent.missed,
        lateFee: lateFee(house),
        canPayArrears: economy.rent.arrears > 0 && canAfford(state, economy.rent.arrears),
        payBlocked: economy.rent.arrears <= 0 ? 'Nothing is overdue.' : canAfford(state, economy.rent.arrears) ? null : short(economy.rent.arrears),
        warning: economy.rent.arrears > 0
          ? `You owe ${naira(economy.rent.arrears)} in missed rent. Pay it before ${nextDueLabel} or a ${naira(lateFee(house))} late fee is added. It is collected automatically on a Saturday when your balance covers it. You keep your home in this beta.`
          : !canAfford(state, house.rent) ? `Your balance does not cover the ${naira(house.rent)} rent due ${nextDueLabel}. If it is missed it becomes arrears, with one week to pay before a late fee.` : null,
        rule: `Rent is collected automatically every Saturday (Lagos time), even while you are away — at most ${MAX_CATCHUP_WEEKS} missed weeks are caught up. It is never taken in part.`,
      } : null,
      loan: loan ? {
        principal: LOAN.principal, total: LOAN.total + LOAN_LATE_FEE * loan.fees, weekly: LOAN.weekly, left: loan.left, fees: loan.fees,
        paid: Math.max(0, LOAN.total + LOAN_LATE_FEE * loan.fees - loan.left),
        progress: Math.max(0, Math.min(1, 1 - loan.left / (LOAN.total + LOAN_LATE_FEE * loan.fees))),
        cleared: loan.left <= 0, prepaid: loan.prepaid, instalment,
        weeksLeft: Math.ceil(loan.left / LOAN.weekly),
        nextDue, nextDueLabel,
        nextCollection: loan.left <= 0 ? 'Paid off. Nothing more is collected.'
          : loan.prepaid > 0 ? `The collection on ${nextDueLabel} is already covered by your early payment.`
          : `${naira(instalment)} is collected automatically on ${nextDueLabel}.`,
        weekBlocked: loan.left <= 0 ? 'The loan is paid off.' : canAfford(state, instalment) ? null : short(instalment),
        allBlocked: loan.left <= 0 ? 'The loan is paid off.' : canAfford(state, loan.left) ? null : short(loan.left),
        rule: `${naira(LOAN.weekly)} is collected every Saturday after rent. A missed week stays owed and adds a ${naira(LOAN_LATE_FEE)} fee (at most ${MAX_LOAN_FEES} times).`,
      } : null,
      deposits: economy.deposits.map((deposit) => ({
        id: deposit.id, amount: deposit.amount, term: deposit.term, termLabel: DEPOSIT_TERMS[deposit.term].label,
        interest: interestOf(deposit), payout: deposit.amount + interestOf(deposit),
        maturesAt: maturesAt(deposit), maturesLabel: dateLabel(maturesAt(deposit)),
      })),
      savings: {
        beta: true, locked, room, min: DEPOSIT_MIN, max: Math.min(DEPOSIT_MAX, room), maxOpen: DEPOSIT_MAX_OPEN, cap: DEPOSIT_TOTAL_CAP, blocked: depositBlock,
        terms: Object.values(DEPOSIT_TERMS).map((term) => ({ id: term.id, label: term.label, days: term.days, percent: term.bps / 100 })),
        amounts: [1000, 5000, 10000, 25000, 50000].map((amount) => ({
          amount,
          payouts: Object.fromEntries(Object.values(DEPOSIT_TERMS).map((term) => [term.id, amount + interestOf({ amount, term: term.id })])),
          blocked: depositBlock ?? (amount > room ? `Only ${naira(room)} more can be locked.` : !canAfford(state, amount) ? `You have ${naira(state.cash)}.` : null),
        })),
      },
    };
  },
};
