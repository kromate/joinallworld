// The wallet: what a change may do to the balance, the statement, the view, and how a hostile
// save is cleaned.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as ts from './wallet.ts'
import type { LedgerDay, WalletState } from './wallet.ts'
import { makeContext, makeRng } from '../util.ts'
import { createLife, viewLife } from '../../life.ts'

const DAY = 86400000
const START = Date.UTC(2026, 0, 5, 8)
/** A real new life: every system is registered, so each change also runs the listeners of 'wallet.changed'. */
const fresh = (): WalletState => createLife(null, { now: START, cityId: 'lagos' }) as WalletState
const at = (now: number, seed = 'wallet'): { now: number } => makeContext({ now, cityId: 'lagos', seed })
const REASONS = ['Rent: Yaba (due Sat)', 'Danfo to Lekki', 'Shift: Bank teller', 'Groceries × 3 rice', 'Bought Sofa', 'Sold Sofa', 'Refund: cancelled trip', 'Transfer to Ada', 'Transfer from Bola', 'Loan repayment', 'Goal · first meal', 'Fuel', 'Gem prize', 'Suya', 'A wallet on the ground', 'Clinic visit', 'Boutique: agbada', '']

test('credit and debit refuse what would break the balance', () => {
  const state = fresh()
  assert.equal(ts.credit(state, -1, 'x'), false)
  assert.equal(ts.credit(state, 1.5, 'x'), false)
  assert.equal(ts.credit(state, Number.MAX_SAFE_INTEGER, 'x'), false, 'a credit that would overflow is refused')
  assert.equal(ts.debit(state, 5001, 'x'), false, 'more than the balance is refused')
  assert.deepEqual([state.cash, state.ledger.length], [5000, 0], 'a refusal changes nothing')
  assert.equal(ts.debit(state, 7000, 'Rent arrears', at(START), { partial: true }), 5000, 'a partial debit takes what is there and says how much')
  assert.equal(state.cash, 0)
  assert.equal(ts.credit(state, 0, 'nothing'), true)
  assert.equal(state.ledger.length, 1, 'a change of zero leaves no line')
  assert.deepEqual(ts.statementOf(state).problems, [])
})

test('reason groups: the kind of change, not the detail', () => {
  assert.deepEqual(['Rent: Yaba (due Sat)', 'Danfo to Lekki', 'Transfer from Bola', 'Groceries × 3 rice', '', null].map(ts.reasonGroup), ['Rent', 'Danfo', 'Transfer from', 'Groceries', 'Other', 'Other'])
})

test('4,000 seeded changes keep the statement reconciled and the history trimmed', () => {
  const rng = makeRng('wallet-parity')
  const a = fresh()
  let now = START
  for (let i = 0; i < 4000; i++) {
    now += Math.floor(rng() * DAY / 6)
    const reason = REASONS[Math.floor(rng() * REASONS.length)] ?? ''
    const amount = Math.floor(rng() * 9000)
    const kind = rng()
    const seed = `change-${i}`
    if (kind < 0.45) ts.credit(a, amount, reason, at(now, seed))
    else if (kind < 0.85) ts.debit(a, amount, reason, at(now, seed))
    else ts.debit(a, amount, reason, at(now, seed), { partial: true })
    assert.equal(ts.canAfford(a, amount), a.cash >= amount)
  }
  assert.ok(a.ledger.length === ts.LEDGER_LIMIT && a.ledgerDays.length === ts.LEDGER_DAYS, 'both histories are full, so trimming was exercised')
  assert.ok(a.ledgerDays.some((day: LedgerDay) => Object.hasOwn(day.by, 'Other')), 'folding small groups into Other was exercised')
  assert.equal(ts.statementOf(a).reconciled, true)
  assert.equal(ts.statementOf(a).problems.length, 0)
})

test('sanitize: clean, old-format and hostile saves all rebuild a reconciled wallet', () => {
  const played = fresh()
  for (let i = 0; i < 90; i++) ts.credit(played, 100 + i, REASONS[i % REASONS.length] ?? '', at(START + i * DAY / 3))
  const saves: Record<string, unknown>[] = [
    {},
    { cash: played.cash, ledger: structuredClone(played.ledger), ledgerDays: structuredClone(played.ledgerDays) },
    { cash: played.cash, ledger: structuredClone(played.ledger) },                                  // before daily summaries existed
    { cash: played.cash + 777, ledger: structuredClone(played.ledger), ledgerDays: structuredClone(played.ledgerDays) }, // balance disagrees with history
    { cash: -5, ledger: 'no', ledgerDays: { length: 3 } },
    { cash: 100, ledger: [null, 7, { at: 'x' }, { at: 1, amount: 0, balance: 1, reason: 'zero' }, { at: 2, amount: 50, balance: 100, reason: 'ok\u0000' + 'y'.repeat(200) }] },
    { cash: 100, ledger: [{ at: 2, amount: 50, balance: 100, reason: 'ok' }], ledgerDays: [{ day: 1, open: 50, close: 100, in: 50, out: 0, n: 1, by: { a: [1, 1], b: 'bad' } }] },
    { cash: 100, ledger: [{ at: 2, amount: 50, balance: 100, reason: 'ok' }], ledgerDays: [{ day: 1, open: 50, close: 100, in: 50, out: 0, n: 1, by: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`g${i}`, [1, 1]])) }] },
    { cash: 2 ** 60, ledger: [{ at: 2, amount: 2 ** 60, balance: 2 ** 60, reason: 'huge' }] },
  ]
  for (const [index, save] of saves.entries()) {
    const a = { t: START }
    ts.default.sanitize(structuredClone(save), a)
    assert.deepEqual(ts.statementOf(a as WalletState).problems, [], `save ${index} reconciles`)
  }
})

test('the wallet view equals what the running engine shows for a real life', () => {
  const state = fresh()
  ts.credit(state, 1200, 'Shift: Bank teller', at(START + 3600000))
  ts.debit(state, 300, 'Danfo to Lekki', at(START + 7200000))
  const view: { wallet?: unknown } = viewLife(state, { now: START + 7200000, cityId: 'lagos' })
  assert.deepEqual(ts.default.view(state), view.wallet)
  assert.deepEqual([ts.default.id, ts.default.stateKeys], ['wallet', ['cash', 'ledger', 'ledgerDays']])
})
