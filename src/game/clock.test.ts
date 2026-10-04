// The Lagos clock: weeks, opening hours that wrap past midnight, and what the player is told.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as ts from './clock.ts'
import type { OpeningHours } from './clock.ts'

const START = Date.UTC(2026, 0, 5, 0, 0)

test('lagosTime: Lagos is one hour ahead of UTC and weeks start on Monday', () => {
  const monday = ts.lagosTime(Date.UTC(2026, 0, 5, 9, 30))
  assert.deepEqual({ weekday: monday.weekday, hour: monday.hour, minute: monday.minute, minuteOfDay: monday.minuteOfDay }, { weekday: 1, hour: 10, minute: 30, minuteOfDay: 630 })
  assert.equal(ts.lagosTime(Date.UTC(2026, 0, 4, 22, 59)).week + 1, ts.lagosTime(Date.UTC(2026, 0, 4, 23, 0)).week, 'the week turns at Monday 00:00 Lagos time')
  assert.equal(ts.lagosDayStart(monday.day), Date.UTC(2026, 0, 4, 23, 0))
  assert.equal(ts.lagosTime(Number.NaN).day, 0, 'a time that is not a number reads as the epoch')
})

test('opening hours wrap past midnight and belong to the day the shift began', () => {
  const lateShift: OpeningHours = { open: 22, close: 6, days: [5] }
  assert.equal(ts.isOpen(lateShift, Date.UTC(2026, 0, 9, 22, 0)), true, 'Friday 23:00 Lagos')
  assert.equal(ts.isOpen(lateShift, Date.UTC(2026, 0, 10, 3, 0)), true, 'Saturday 04:00 Lagos is still Friday night')
  assert.equal(ts.isOpen(lateShift, Date.UTC(2026, 0, 10, 22, 0)), false, 'Saturday night is not listed')
  assert.equal(ts.minutesUntilOpen({ open: 10, close: 12, days: [] }, START), Infinity)
  assert.deepEqual(ts.openingInfo(null, START), { open: true, always: true, hours: 'Open 24 hours', status: 'Open 24 hours', minutes: 0, opensAt: null })
})
