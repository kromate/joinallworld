import test from 'node:test'
import assert from 'node:assert/strict'
import type { WalletHistoryResponse } from '../../../types/support.ts'
import { createStatementHistory } from './statementHistory.ts'

const response = (start: number, count = 60): WalletHistoryResponse => ({ ok: true, code: 'ok',
  entries: Array.from({ length: count }, (_, offset) => ({ seq: start + offset, at: start + offset, amount: 1, balanceAfter: 5000 + offset, reason: `Line ${start + offset}`, cityId: 'lagos', operationId: null })),
  next: start + count, coverage: { kind: 'since-recording', complete: false, label: 'Recorded since enabled.' } })

test('statement history ignores a late old-identity page and keeps one bounded page', async () => {
  let resolveOld: (value: WalletHistoryResponse) => void = () => {}
  const old = new Promise<WalletHistoryResponse>(done => { resolveOld = done })
  const model = createStatementHistory(after => after === 0 ? old : Promise.resolve(response(after)))
  model.setIdentity('ada'); const loading = model.load(0)
  model.setIdentity('bola'); resolveOld(response(1)); assert.equal(await loading, false)
  assert.deepEqual([model.state.entries, model.state.loaded, model.state.loading], [[], false, false])
  assert.equal(await model.load(50), true)
  assert.equal(model.state.entries.length, 50)
  assert.deepEqual([model.state.entries[0]?.seq, model.state.entries.at(-1)?.seq], [50, 99])
  model.setIdentity('chi'); assert.deepEqual([model.state.entries.length, model.state.next, model.state.loaded], [0, 0, false])
})
