// The TypeScript clock against the JavaScript one the game still runs: same answers for the same
// inputs. This is also the first .ts test file, so it proves that `npm test` runs TypeScript.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as ts from './clock.ts'
import type { OpeningHours } from './clock.ts'
// At run time this is the JavaScript module. The type checker reads clock.ts for it (a sibling
// .ts wins over .js), which is what gives every JavaScript importer of clock.js its types.
import * as js from './clock.js'

const START = Date.UTC(2026, 0, 5, 0, 0)
const SCHEDULES: (OpeningHours | null)[] = [
  null,
  { open: 8, close: 22 },
  { open: 9, close: 17.5 },
  { open: 20, close: 4 },
  { open: 9, close: 17, days: [1, 2, 3, 4, 5] },
  { open: 22, close: 6, days: [5, 6] },
  { open: 10, close: 12, days: [] },
]

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

test('the TypeScript clock and the JavaScript clock agree on every minute of two weeks', () => {
  assert.deepEqual(Object.keys(ts).sort(), Object.keys(js).sort(), 'both modules export the same names')
  assert.deepEqual([...ts.WEEKDAYS], [...js.WEEKDAYS])
  assert.equal(ts.LAGOS_OFFSET_MS, js.LAGOS_OFFSET_MS)
  for (let minute = 0; minute < 14 * 1440; minute += 7) {
    const at = START + minute * 60000 + 1234
    assert.deepEqual(ts.lagosTime(at), js.lagosTime(at))
    assert.equal(ts.formatClock(at), js.formatClock(at))
    for (const hours of SCHEDULES) assert.equal(ts.isOpen(hours, at), js.isOpen(hours, at))
  }
  for (let minute = 0; minute < 8 * 1440; minute += 131) {
    const at = START + minute * 60000
    for (const hours of SCHEDULES) {
      assert.equal(ts.minutesUntilOpen(hours, at), js.minutesUntilOpen(hours, at))
      assert.deepEqual(ts.openingInfo(hours, at), js.openingInfo(hours, at))
    }
  }
  for (let hour = 0; hour < 48; hour += 0.25) assert.equal(ts.formatHour(hour), js.formatHour(hour))
  assert.equal(ts.lagosDayStart(20000), js.lagosDayStart(20000))
})
