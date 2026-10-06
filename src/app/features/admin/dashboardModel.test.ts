import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountsPerDay, fillTone, returning, shortDate, sizeTone, tileChange } from './dashboardModel.ts'
import type { DayRow } from './dashboardModel.ts'

const row = (accounts: number | null, over: Partial<DayRow> = {}): DayRow => ({ day: 1, date: '2026-10-06', new: 0, seen: 0, sessions: 0, funnel: {}, daily: accounts === null ? null : { accounts }, ...over })
test('new accounts a day come from the growth of the count between measured days', () => {
  assert.deepEqual(accountsPerDay([row(10), row(14), row(null), row(20), row(19)]), [null, 4, null, null, null])
})
test('dates, changes, returning players and the colour of a fill', () => {
  assert.equal(shortDate('2026-10-06'), '6 Oct'); assert.equal(shortDate('2026-01-31'), '31 Jan')
  assert.equal(tileChange([3, 5]), '+2 (+67%) vs yesterday'); assert.equal(tileChange([5]), null); assert.equal(tileChange([null, 4]), null)
  assert.equal(returning(40, 12), 28); assert.equal(returning(5, 9), 0)
  assert.deepEqual([fillTone(10, 100), fillTone(70, 100), fillTone(95, 100), fillTone(5, 0)], ['ok', 'warn', 'bad', 'ok'])
  assert.deepEqual([sizeTone(1000), sizeTone(2_500_000), sizeTone(9_000_000)], ['ok', 'warn', 'bad'])
})
