import test from 'node:test'
import assert from 'node:assert/strict'
import { announceLines, announceUi, dismissAnnounce, receiveAnnounce, resetAnnounce } from './announceStore.ts'
import type { AnnounceItem } from '../../../types/announce.ts'

const item = (id: string, over: Partial<AnnounceItem> = {}): AnnounceItem => ({ id, title: 'Market', body: 'Half price.', action: null, city: null, at: 100, expiresAt: 1000, ...over })

test('an announcement is shown once, kept for Messages, and ignored for another city or after it ended', () => {
  resetAnnounce()
  receiveAnnounce({ type: 'announce', live: true, items: [item('a1'), item('a2', { city: 'kano' }), item('a3', { expiresAt: 50 })] }, 'lagos', 200)
  assert.deepEqual(announceUi.items.map((x) => x.id), ['a1'])
  assert.equal(announceUi.banner?.id, 'a1')
  dismissAnnounce()
  assert.equal(announceUi.banner, null)
  receiveAnnounce({ type: 'announce', live: false, items: [item('a1')] }, 'lagos', 300)
  assert.equal(announceUi.banner, null, 'what was seen is not shown again on the next connect')
  assert.equal(announceUi.items.length, 1)
  const lines = announceLines(announceUi.items, announceUi.seen)
  assert.equal(lines[0]?.fresh, false); assert.equal(lines[0]?.text, 'Market: Half price.')
})
