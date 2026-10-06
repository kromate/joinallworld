/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * The only place cash changes. Integer naira, never negative, overflow-safe, with a transaction
 * history that can always explain the balance.
 *
 * State keys
 *   cash        integer ≥ 0
 *   ledger      the last LEDGER_LIMIT changes in full, newest last
 *   ledgerDays  one summary per Lagos day on which the balance changed, newest last
 */
import { LEFT_OUT, PLAYS } from '../profile.ts';
import { emit } from '../registry.ts'
import { cleanText, fail, ok } from '../util.ts'
import { lagosTime } from '../clock.ts'
import type { SystemDefinition } from '../../types/registry.ts'
import type { LedgerDay, LedgerLine, LifeContext, LifeState } from '../../types/life.ts'

export const STARTING_CASH = 5000 // original beta value
/** Full lines kept (original beta value; was 30). */
export const LEDGER_LIMIT = 60
/** Daily summaries kept: about five weeks of days with activity (original beta value). */
export const LEDGER_DAYS = 35
/** Reason groups kept per day before the rest fold into "Other" (original beta value). */
export const LEDGER_DAY_GROUPS = 8
export const CORRECTION_REASON = 'Balance correction (no record of this change)'
const OTHER = 'Other'
const GROUP_MAX = 28

export type { LedgerDay, LedgerLine }
/** `[net, count]` for one reason group on one day. */
export type LedgerGroup = LedgerDay['by'][string]
/** A life, of which the wallet reads and writes `t` (the core system's: the time it was last settled to) and its own three keys. */
export type WalletState = LifeState
/** What a wallet function needs from the engine context: the time of the change. */
export interface WalletContext {
  now?: number
}
export interface StatementDay {
  day: number
  open: number
  close: number
  in: number
  out: number
  changes: number
  groups: { group: string; net: number; count: number }[]
}
export interface StatementTotals {
  in: number
  out: number
  changes: number
  net: number
}
export interface Statement {
  closing: number
  /** Where the kept history starts. `day` is null when no daily summary is kept (only lines, or nothing). */
  opening: { balance: number; day: number | null }
  days: StatementDay[]
  lines: LedgerLine[]
  /** The balance before the oldest kept line. */
  linesOpening: number
  totals: StatementTotals
  /** True when opening balance plus every kept change equals the closing balance at both levels. */
  reconciled: boolean
  /** What does not add up. Always empty for a life the engine built. */
  problems: string[]
  kept: { lines: number; days: number }
}
export interface WalletView {
  cash: number
  /** Newest first. */
  ledger: LedgerLine[]
  /** Newest first. */
  days: StatementDay[]
  statement: Pick<Statement, 'opening' | 'closing' | 'totals' | 'reconciled' | 'problems' | 'kept' | 'linesOpening'>
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const safeCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const safeInteger = (value: unknown): value is number => Number.isSafeInteger(value)
const validAmount = (amount: unknown): amount is number => Number.isSafeInteger(amount) && (amount as number) >= 0

/** Lines that say the same kind of thing share a group: "Rent: Yaba (due …)" → "Rent", "Danfo to X" → "Danfo". */
const PREFIXES = ['Refund', 'Bought', 'Sold', 'Groceries', 'Boutique', 'Transfer from', 'Transfer to', 'Fixed deposit', 'Loan repayment', 'Rent arrears', 'Goal', 'Start cash', 'Fuel', 'Ride home on credit', 'Ride home repaid']
export function reasonGroup(reason: unknown): string {
  const text = String(reason ?? '')
  const known = PREFIXES.find((prefix) => text.startsWith(prefix))
  if (known) return known
  const cut = (text.split(/:| · | \(| to | × /)[0] ?? '').trim()
  return (cut || OTHER).slice(0, GROUP_MAX).trim() || OTHER
}

function groupOf(by: Record<string, LedgerGroup>, key: string): LedgerGroup {
  const existing = Object.hasOwn(by, key) ? by[key] : undefined
  if (existing) return existing
  const made: LedgerGroup = [0, 0]
  by[key] = made
  return made
}

function addToDay(state: WalletState, at: number, amount: number, balance: number, reason: string): void {
  const day = lagosTime(at).day, days = state.ledgerDays
  let entry = days.at(-1)
  // A change dated before the newest summary (a clock that stepped back) is counted in the newest one.
  if (!entry || day > entry.day) {
    entry = { day, open: balance - amount, close: balance, in: 0, out: 0, n: 0, by: {} }
    days.push(entry)
    if (days.length > LEDGER_DAYS) days.splice(0, days.length - LEDGER_DAYS)
  }
  entry.close = balance
  if (amount > 0) entry.in += amount; else entry.out -= amount
  entry.n += 1
  const slot = groupOf(entry.by, reasonGroup(reason))
  slot[0] += amount; slot[1] += 1
  // Too many groups for one day: the one that moved the least money folds into "Other", so the
  // big items (rent, wages, a purchase) stay named however busy the day was.
  const by = entry.by
  const named = Object.keys(by).filter((key) => key !== OTHER)
  if (named.length > LEDGER_DAY_GROUPS) {
    const net = (key: string): number => Math.abs(by[key]?.[0] ?? 0)
    const smallest = named.reduce((least, key) => (net(key) < net(least) ? key : least))
    const folded = by[smallest]
    const other = groupOf(by, OTHER)
    if (folded) { other[0] += folded[0]; other[1] += folded[1] }
    delete by[smallest]
  }
}

function record(state: WalletState, amount: number, reason: string, ctx?: WalletContext): void {
  if (!amount) return
  const line: LedgerLine = { at: finite(ctx?.now) ? ctx.now : state.t, amount, reason: cleanText(reason, 80, 'Adjustment'), balance: state.cash }
  state.ledger.push(line)
  if (state.ledger.length > LEDGER_LIMIT) state.ledger.splice(0, state.ledger.length - LEDGER_LIMIT)
  addToDay(state, line.at, amount, line.balance, line.reason)
  // `ctx` is the engine's context at runtime and absent only in unit tests; WalletContext names just the part the wallet reads.
  emit(state, 'wallet.changed', { amount, reason, balance: state.cash }, ctx as LifeContext)
}

export const canAfford = (state: WalletState, amount: number): boolean => validAmount(amount) && state.cash >= amount
export const canCredit = (state: WalletState, amount: number): boolean => validAmount(amount) && Number.isSafeInteger(state.cash + amount)

/** Add cash. Returns false (and changes nothing) if the amount is invalid or would overflow. */
export function credit(state: WalletState, amount: number, reason: string, ctx?: WalletContext): boolean {
  if (!canCredit(state, amount)) return false
  state.cash += amount
  record(state, amount, reason, ctx)
  return true
}

/**
 * Remove cash. Returns false (and changes nothing) if the player cannot afford it.
 * With { partial: true } it takes what is available instead and returns the amount taken.
 */
export function debit(state: WalletState, amount: number, reason: string, ctx: WalletContext | undefined, options: { partial: true }): number | false
export function debit(state: WalletState, amount: number, reason: string, ctx?: WalletContext, options?: { partial?: false }): boolean
export function debit(state: WalletState, amount: number, reason: string, ctx?: WalletContext, { partial = false }: { partial?: boolean } = {}): number | boolean {
  if (!validAmount(amount)) return false
  if (state.cash < amount && !partial) return false
  const taken = Math.min(amount, state.cash)
  state.cash -= taken
  record(state, -taken, reason, ctx)
  return partial ? taken : true
}

/**
 * The statement: where the balance started within the kept history, every kept change, and
 * where it stands — with the arithmetic checked.
 */
export function statementOf(state: WalletState): Statement {
  const lines = state.ledger.map((line) => ({ ...line }))
  const days: StatementDay[] = state.ledgerDays.map((day) => ({ day: day.day, open: day.open, close: day.close, in: day.in, out: day.out, changes: day.n,
    groups: Object.entries(day.by).map(([group, [net, count]]) => ({ group, net, count })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || (a.group < b.group ? -1 : 1)) }))
  const problems: string[] = []
  const first = lines[0], lastLine = lines.at(-1)
  const linesOpening = first ? first.balance - first.amount : state.cash
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i], before = lines[i - 1]
    if (line && before && line.balance - line.amount !== before.balance) problems.push(`Line ${i + 1} does not follow from the line before it.`)
  }
  if (lastLine && lastLine.balance !== state.cash) problems.push('The last recorded change does not end at the current balance.')
  for (let i = 0; i < days.length; i++) {
    const day = days[i], before = days[i - 1]
    if (!day) continue
    if (day.open + day.in - day.out !== day.close) problems.push(`Day ${day.day} does not add up.`)
    if (before && day.open !== before.close) problems.push(`Day ${day.day} does not open where the day before closed.`)
  }
  const firstDay = days[0], lastDay = days.at(-1)
  if (lastDay && lastDay.close !== state.cash) problems.push('The last day does not close at the current balance.')
  const opening = firstDay ? { balance: firstDay.open, day: firstDay.day } : { balance: linesOpening, day: null }
  const sums = firstDay
    ? { in: days.reduce((sum, day) => sum + day.in, 0), out: days.reduce((sum, day) => sum + day.out, 0), changes: days.reduce((sum, day) => sum + day.changes, 0) }
    : { in: lines.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0), out: -lines.filter((line) => line.amount < 0).reduce((sum, line) => sum + line.amount, 0), changes: lines.length }
  const totals: StatementTotals = { ...sums, net: sums.in - sums.out }
  if (opening.balance + totals.net !== state.cash) problems.push('Opening balance plus every change does not equal the closing balance.')
  return { closing: state.cash, opening, days, lines, linesOpening, totals, reconciled: problems.length === 0, problems,
    kept: { lines: LEDGER_LIMIT, days: LEDGER_DAYS } }
}

function sanitizeDays(saved: unknown): LedgerDay[] | null {
  const days: LedgerDay[] = []
  for (const item of Array.isArray(saved) ? saved.slice(-LEDGER_DAYS) as unknown[] : []) {
    if (!isRecord(item)) return null
    const { day, open, close, n, by: savedBy } = item
    const moneyIn = item.in, moneyOut = item.out
    if (!safeInteger(day) || !safeCount(open) || !safeCount(close) || !safeCount(moneyIn) || !safeCount(moneyOut) || !safeCount(n) || !isRecord(savedBy)) return null
    const previous = days.at(-1)
    if (open + moneyIn - moneyOut !== close || (previous && (day <= previous.day || open !== previous.close))) return null
    const by: Record<string, LedgerGroup> = {}
    if (Object.keys(savedBy).length > LEDGER_DAY_GROUPS + 1) return null
    for (const [group, value] of Object.entries(savedBy)) {
      if (!Array.isArray(value)) return null
      const net: unknown = value[0], count: unknown = value[1]
      if (!safeInteger(net) || !safeCount(count)) return null
      by[cleanText(group, GROUP_MAX, OTHER)] = [net, count]
    }
    days.push({ day, open, close, in: moneyIn, out: moneyOut, n, by })
  }
  return days
}

function sanitizeLines(saved: unknown): LedgerLine[] {
  const lines: LedgerLine[] = []
  for (const entry of (Array.isArray(saved) ? saved as unknown[] : []).slice(-LEDGER_LIMIT)) {
    if (!isRecord(entry)) continue
    const { at, amount, balance, reason } = entry
    if (finite(at) && safeInteger(amount) && amount !== 0 && safeCount(balance) && typeof reason === 'string') lines.push({ at, amount, reason: cleanText(reason, 80, 'Adjustment'), balance })
  }
  return lines
}

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: {
    /**
     * SERVER ONLY. The operator's credit or debit (server/admin): a defined faucet and a defined sink, each one ledger line of its own
     * ("Admin credit: <reason>", "Admin debit: <reason>"). It never touches `social.earned`, so money given this way does not unlock gifts or
     * buying from players. A debit takes at most what the balance holds (cash never goes below zero); the caller reads the balance before and after.
     */
    'wallet.admin': { serverOnly: true, refusal: 'Balances are adjusted by the operator. Nothing was changed.',
      run(state, payload, ctx) {
        const amount = payload?.amount, reason = cleanText(payload?.reason, 56, 'Adjustment')
        if (!validAmount(amount) || amount === 0) return fail(state, 'invalid_amount')
        const context = { now: finite(ctx?.now) ? ctx.now : state.t }
        if (payload.op === 'credit') return credit(state, amount, `Admin credit: ${reason}`, context) ? ok(state, 'credited') : fail(state, 'balance_limit', 'That would pass the largest balance a life can hold.')
        if (payload.op === 'debit') { debit(state, amount, `Admin debit: ${reason}`, context, { partial: true }); return ok(state, 'debited') }
        return fail(state, 'invalid_amount')
      } },
    /**
     * SERVER ONLY. The launch bonus (server/bonus): one ledger line whose reason the server words ("Launch bonus: one of the first 10,000 players"),
     * a faucet. It never touches `social.earned`, so it unlocks no gifting and no buying from players, and the ride debt's repayment from
     * earnings does not take a share of it (only the whole-debt rule of relief.ts, which asks what cash can afford, sees it).
     */
    'wallet.bonus': { serverOnly: true, refusal: 'The launch bonus is paid by the server. Nothing was changed.',
      run(state, payload, ctx) {
        const amount = payload?.amount, reason = cleanText(payload?.reason, 80, 'Launch bonus')
        if (!validAmount(amount) || amount === 0) return fail(state, 'invalid_amount')
        return credit(state, amount, reason, { now: finite(ctx?.now) ? ctx.now : state.t }) ? ok(state, 'credited') : fail(state, 'balance_limit', 'That would pass the largest balance a life can hold.')
      } },
  },
  advance(): void {},
} satisfies Pick<SystemDefinition<'wallet'>, 'actions' | 'advance'> : LEFT_OUT;

export default {
  id: 'wallet',
  stateKeys: ['cash', 'ledger', 'ledgerDays'],
  /** `state` already holds the core system's keys (`t`); this fills the wallet's three. */
  sanitize(input: Record<string, unknown>, target: { t: number }): void {
    const state = target as WalletState
    state.cash = safeCount(input.cash) ? input.cash : STARTING_CASH
    state.ledger = sanitizeLines(input.ledger)
    // Daily summaries: kept as saved when they are consistent with themselves and with the
    // balance; otherwise (a save from before they existed, or a damaged one) rebuilt from the lines.
    const saved = sanitizeDays(input.ledgerDays)
    if (saved && saved.at(-1)?.close === state.cash) state.ledgerDays = saved
    else {
      state.ledgerDays = []
      for (const line of state.ledger) addToDay(state, line.at, line.amount, line.balance, line.reason)
    }
    // The history must end at the balance. If it does not, say so in the history itself.
    const last = state.ledger.at(-1)
    if (last && last.balance !== state.cash) {
      const line: LedgerLine = { at: Math.max(state.t, last.at), amount: state.cash - last.balance, reason: CORRECTION_REASON, balance: state.cash }
      state.ledger.push(line)
      if (state.ledger.length > LEDGER_LIMIT) state.ledger.shift()
      state.ledgerDays = []
      for (const entry of state.ledger) addToDay(state, entry.at, entry.amount, entry.balance, entry.reason)
    }
  },
  view(state: WalletState): WalletView {
    const statement = statementOf(state)
    return { cash: state.cash, ledger: state.ledger.slice().reverse(), days: statement.days.slice().reverse(),
      statement: { opening: statement.opening, closing: statement.closing, totals: statement.totals, reconciled: statement.reconciled, problems: statement.problems, kept: statement.kept, linesOpening: statement.linesOpening } }
  },
  ...play,
} satisfies SystemDefinition<'wallet'>;
