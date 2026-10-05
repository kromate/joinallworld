import assert from 'node:assert/strict'
import test from 'node:test'
import { markOlderSeen, olderAskDue, olderNoticeDue, olderSeen } from './olderNoticeModel.ts'

const base = { connected: true, who: 'abc', creating: false, tour: false, busy: false, seen: false }
test('the older-character notice: only with an older character, once, never during the tour or the creator', () => {
  assert.equal(olderNoticeDue(base, 1), true)
  assert.equal(olderNoticeDue(base, 0), false)
  assert.equal(olderNoticeDue({ ...base, tour: true }, 1), false)
  assert.equal(olderAskDue({ ...base, creating: true }), false)
  assert.equal(olderAskDue({ ...base, busy: true }), false)
  assert.equal(olderAskDue({ ...base, connected: false }), false)
  assert.equal(olderAskDue({ ...base, seen: true }), false)
})
test('the older-character notice is remembered per character', () => {
  const data = new Map<string, string>()
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  assert.equal(olderSeen(store, 'abc'), false)
  markOlderSeen(store, 'abc')
  assert.equal(olderSeen(store, 'abc'), true)
  assert.equal(olderSeen(store, 'other'), false)
})
