import assert from 'node:assert/strict'
import test from 'node:test'
import { notices } from './elections.ts'
import { openedAtOf } from './data.ts'
import type { CivicCityRecord } from '../types.ts'

const empty = (): CivicCityRecord => ({
  seq: 0, visits: 0, prunedAt: 0, residents: {}, gov: { elections: {}, announcements: [] },
  ads: { billboard: {}, sea: {} }, hunt: { found: 0, claims: 0, byDay: {} }, radio: { queues: {}, daily: {} },
})
const NOW = Date.UTC(2026, 9, 8, 12)

test('news is never dated before the city opened', () => {
  const city = empty()
  const before = notices(city, NOW, 'Ibadan', 0)
  assert.ok(before.length > 0)
  const opened = NOW - 60 * 60 * 1000
  const after = notices(city, NOW, 'Ibadan', opened)
  assert.ok(after.every((item) => item.at >= opened), 'nothing earlier than the opening')
  assert.ok(after.length <= before.length)
  assert.deepEqual(notices(city, NOW, 'Lagos'), notices(city, NOW, 'Lagos', 0), 'without an opening nothing changes (Lagos)')
})

test('a city opens with its first resident; Lagos has no opening', () => {
  const city = empty()
  assert.equal(openedAtOf(city, 'lagos', NOW), 0)
  assert.equal(openedAtOf(city, 'ibadan', NOW), NOW)
  city.residents['a'] = { name: 'A', house: null, since: NOW - 5000, lastSeen: NOW, day: 0, cash: 0, week: 0, earned: 0, gems: 0, claims: 0 }
  assert.equal(openedAtOf(city, 'ibadan', NOW), NOW - 5000)
  city.openedAt = NOW - 99
  assert.equal(openedAtOf(city, 'ibadan', NOW), NOW - 99)
})
