import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TEMPLATES, timeline } from './announceModel.ts'

test('the timeline puts what is coming first, then what is showing, then what is over', () => {
  const rows = [
    { id: 'old', title: 'Old', at: 100, sentAt: 100, expiresAt: 500, status: 'ended' },
    { id: 'now', title: 'Now', at: 900, sentAt: 900, expiresAt: 5000, status: 'running' },
    { id: 'later', title: 'Later', at: 3000, sentAt: 0, expiresAt: 9000, status: 'scheduled' },
    { id: 'sooner', title: 'Sooner', at: 2000, sentAt: 0, expiresAt: 9000, status: 'scheduled' },
    { id: 'cut', title: 'Cut short', at: 950, sentAt: 950, expiresAt: 9000, status: 'cancelled' },
  ]
  assert.deepEqual(timeline(rows, 1000).map((slot) => `${slot.phase}:${slot.id}`), ['upcoming:sooner', 'upcoming:later', 'showing:now', 'past:cut', 'past:old'])
})
test('the templates fit the banner: a short title, a short text, a button from the fixed list', () => {
  for (const t of TEMPLATES) { assert.ok(t.title.length <= 60 && t.body.length <= 240, t.id); assert.ok(['', 'map', 'missions', 'business', 'invite'].includes(t.action)); assert.ok(t.hours >= 1 && t.hours <= 720) }
})
