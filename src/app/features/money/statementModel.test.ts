import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLife } from '../../../life.ts'
import { sameStatement } from './statementModel.ts'
import { statementOf } from '../../../game/wallet-statement.ts'
import type { WalletStatement } from '../../../types/view.ts'

const serverStatement: Pick<WalletStatement, 'reconciled' | 'closing' | 'opening' | 'totals'> = {
  reconciled: true,
  closing: 105,
  opening: { balance: 100, day: 12 },
  totals: { in: 20, out: 15, changes: 4, net: 5 },
}
const localStatement: Pick<WalletStatement, 'reconciled' | 'opening' | 'totals'> = {
  reconciled: true,
  opening: { balance: 100, day: 12 },
  totals: { in: 20, out: 15, changes: 4, net: 5 },
}

test('statement agreement compares its opening day and every movement total', () => {
  assert.equal(sameStatement(serverStatement, localStatement, 105), true)
  assert.equal(sameStatement(serverStatement, {
    ...localStatement,
    totals: { in: 10, out: 5, changes: 2, net: 5 },
  }, 105), false, 'equal net movement with different gross flows and count is not an agreement')
  assert.equal(sameStatement(serverStatement, {
    ...localStatement,
    opening: { balance: 100, day: 11 },
  }, 105), false, 'equal balances from a different opening day are not the same statement')
  assert.equal(sameStatement(serverStatement, { ...localStatement, reconciled: false }, 105), false, 'an unreconciled local statement cannot agree')
})

test('an unreconciled local ledger cannot agree just because its daily totals match', () => {
  const state = createLife({}, { now: 1 })
  state.cash = 105
  state.ledger = [{ at: 1, amount: 5, reason: 'Recorded movement', balance: 104 }]
  state.ledgerDays = [{ day: 12, open: 100, close: 105, in: 20, out: 15, n: 4, by: {} }]
  const local = statementOf(state)
  assert.equal(local.reconciled, false)
  assert.equal(local.totals.net, 5)
  assert.equal(sameStatement(serverStatement, local, 105), false)
})
