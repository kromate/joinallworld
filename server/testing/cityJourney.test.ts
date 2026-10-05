import assert from 'node:assert/strict'
import test from 'node:test'
import { journeyTimeAfter } from './cityJourney.ts'

test('the fixed journey clock stays eligible and beyond native alarms throughout the test deadline', () => {
  const cases = [
    ['2026-10-05T09:57:59Z', '2026-10-05T10:00:00Z'],
    ['2026-10-05T09:58:00Z', '2026-10-12T10:00:00Z'],
    ['2026-10-05T10:28:00Z', '2026-10-12T10:00:00Z'],
    ['2026-10-08T12:00:00Z', '2026-10-12T10:00:00Z'],
    ['2026-10-10T12:00:00Z', '2026-10-12T10:00:00Z'],
    ['2026-12-31T23:59:00Z', '2027-01-04T10:00:00Z'],
  ]
  for (const [input, expected] of cases) {
    assert.ok(input && expected)
    const now = Date.parse(input), fixed = journeyTimeAfter(now)
    assert.equal(fixed, Date.parse(expected))
    assert.ok(fixed > now + 120_000)
  }
})
