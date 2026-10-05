import assert from 'node:assert/strict'
import test from 'node:test'
import { NUDGE_SENTENCE, comebackRows, nudgeControl, pausedWords } from './comebackModel.ts'
import type { NudgeInput } from './comebackModel.ts'

const DAY = 86400000
const base: NudgeInput = { self: false, friend: true, blocked: false, name: 'Ada', status: 'offline', seenAt: 1000, now: 1000 + 3 * DAY, nudgedAt: null, busy: false }

test('the nudge control: only on an away friend, with your own cooldown as the only reason to be disabled', () => {
  assert.deepEqual(nudgeControl(base), { label: 'Nudge to come back', disabled: false, reason: null })
  for (const over of [{ self: true }, { friend: false }, { blocked: true }, { status: 'online' }, { seenAt: 1000 + 2 * DAY }]) assert.equal(nudgeControl({ ...base, ...over }), null, JSON.stringify(over))
  assert.notEqual(nudgeControl({ ...base, seenAt: undefined }), null, 'when the server does not know when they were last here, the server decides')
  const cooling = nudgeControl({ ...base, nudgedAt: base.now - 2 * DAY })
  assert.deepEqual([cooling?.disabled, cooling?.reason], [true, 'You nudged Ada recently. You can again in 5 days.'])
  assert.equal(nudgeControl({ ...base, nudgedAt: base.now - 8 * DAY })?.disabled, false)
  assert.deepEqual(nudgeControl({ ...base, busy: true }), { label: 'Nudging…', disabled: true, reason: null })
  assert.match(NUDGE_SENTENCE, /if they’ve asked for e-mails/)
})

test('the switches: one row per type, and a pause that says how long is left', () => {
  assert.deepEqual(comebackRows().map((row) => row.label), ['Needs', 'Friends', 'Milestones', 'Events', 'When I’ve been away', 'Weekly digest'])
  assert.equal(pausedWords({ pausedUntil: 0 }, 5), null)
  assert.equal(pausedWords({ pausedUntil: 5 + 30 * DAY }, 5), 'Paused for 30 more days.')
  assert.equal(pausedWords({ pausedUntil: 5 + 1000 }, 5), 'Paused for 1 more day.')
})
