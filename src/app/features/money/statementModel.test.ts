import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sameStatement } from './statementModel.ts'
import type { WalletStatement } from '../../../types/view.ts'

const serverStatement: Pick<WalletStatement, 'reconciled' | 'closing' | 'opening' | 'totals'> = {
  reconciled: true,
  closing: 105,
  opening: { balance: 100, day: 12 },
  totals: { in: 20, out: 15, changes: 4, net: 5 },
}
const localStatement: Pick<WalletStatement, 'opening' | 'totals'> = {
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
})
