// The update notice: what the banner says in each state (pure), and what the store does with a frame, a dropped socket
// and the host's build.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AFTER_MS, CALL_LINE, UPDATED_SHOWN_MS, UPDATED_TEXT, minutesLeft, noticeOf, noticeView, running, shown, updatingText, wasUpdated } from './noticeModel.ts'
import type { NoticeState } from './noticeModel.ts'
import { checkBuild, cutCall, dismissNotice, markUpdated, noticeUi, takeNotice } from './noticeStore.ts'
import type { NoticeFrame } from '../../../types/notice.ts'

const frame = (over: Partial<NoticeFrame> = {}): NoticeFrame => ({ type: 'notice', kind: 'update', id: 'n-1', minutes: 3, until: 1_000_000 + 180_000, serverTime: 1_000_000, build: 'one', ...over })
const state = (over: Partial<NoticeState> = {}): NoticeState => ({ notice: noticeOf(frame(), 50_000), dismissedId: '', updated: null, ...over })
const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada' }
const reset = (): void => { noticeUi.notice = null; noticeUi.dismissedId = ''; noticeUi.updated = null }

test('plain: the fixed wording with whole minutes counting down, never below one', () => {
  const s = state()
  assert.equal(s.notice?.endsAt, 230_000, 'placed on this page\'s clock, whatever the server\'s clock says')
  assert.deepEqual(noticeView(s, 50_000, false), { kind: 'updating', minutes: 3, text: 'Allworld is updating in about 3 minutes. You will stay signed in and reconnect on your own.', callLine: null, id: 'n-1' })
  assert.equal(minutesLeft(230_000, 50_000 + 59_000), 3)
  assert.equal(minutesLeft(230_000, 50_000 + 61_000), 2)
  assert.equal(minutesLeft(230_000, 229_000), 1)
  assert.equal(updatingText(1), 'Allworld is updating in about 1 minute. You will stay signed in and reconnect on your own.')
})

test('in a call or with a ping waiting: one more line', () => {
  const view = noticeView(state(), 60_000, true)
  assert.equal(view.kind === 'updating' && view.callLine, CALL_LINE)
  assert.equal(CALL_LINE, 'Calls end when it updates — you can call again right after.')
})

test('dismissed: gone for that announcement, back for another', () => {
  const s = state({ dismissedId: 'n-1' })
  assert.equal(noticeView(s, 60_000, false).kind, 'none')
  assert.equal(shown(s, 60_000), false)
  assert.equal(noticeView({ ...s, notice: noticeOf(frame({ id: 'n-2' }), 60_000) }, 60_000, false).kind, 'updating')
})

test('expired: the window passed and the banner is simply gone', () => {
  const s = state()
  assert.equal(running(s, 229_999), true)
  assert.equal(running(s, 230_000), false)
  assert.equal(noticeView(s, 300_000, true).kind, 'none')
})

test('updated: said once, with the call to offer again, and it fades', () => {
  const s = state({ notice: null, updated: { at: 1000, cut: ADA } })
  assert.deepEqual(noticeView(s, 2000, false), { kind: 'updated', text: UPDATED_TEXT, callAgain: ADA })
  assert.equal(UPDATED_TEXT, 'Allworld has been updated.')
  assert.equal(noticeView(s, 1000 + UPDATED_SHOWN_MS, false).kind, 'none')
  assert.equal(noticeView(state({ notice: null, updated: { at: 1000, cut: null } }), 2000, false).kind === 'updated', true)
})

test('a different build after the drop is the update; the same build, or no answer, is not', () => {
  const notice = noticeOf(frame(), 0)
  assert.equal(wasUpdated(notice, 'two', 100_000), true)
  assert.equal(wasUpdated(notice, 'one', 100_000), false)
  assert.equal(wasUpdated(notice, undefined, 100_000), false)
  assert.equal(wasUpdated(notice, 'two', notice.endsAt + AFTER_MS + 1), false, 'long after the window it is not this update')
  assert.equal(wasUpdated(null, 'two', 0), false)
})

test('the store keeps a frame, keeps a dismissal for the same announcement, and shows "updated" once the host runs another build', async () => {
  reset()
  takeNotice(frame(), 10_000)
  assert.equal(noticeUi.notice?.endsAt, 10_000 + 180_000)
  dismissNotice()
  takeNotice(frame(), 20_000)
  assert.equal(noticeUi.dismissedId, 'n-1')
  assert.equal(noticeUi.notice?.build, 'one')
  const health = (build: string): typeof fetch => (async () => Response.json({ ok: true, build })) as typeof fetch
  await checkBuild(health('one'), () => 30_000)
  assert.equal(noticeUi.updated, null, 'the same build: nothing happened')
  await checkBuild(health('two'), () => 40_000, async () => {})
  assert.deepEqual(noticeUi.updated, { at: 40_000, cut: null })
  assert.equal(noticeUi.notice, null)
  dismissNotice()
  assert.equal(noticeUi.updated, null)
})

test('an unreadable answer is asked once more; a window long past is not asked at all', async () => {
  reset()
  takeNotice(frame(), 10_000)
  let calls = 0
  const flaky = (async () => { calls += 1; if (calls === 1) throw new TypeError('network'); return Response.json({ build: 'two' }) }) as typeof fetch
  await checkBuild(flaky, () => 20_000, async () => {})
  assert.equal(calls, 2); assert.equal(noticeUi.updated?.at, 20_000)
  reset(); takeNotice(frame(), 10_000); calls = 0
  await checkBuild(flaky, () => 10_000 + 180_000 + AFTER_MS + 1, async () => {})
  assert.equal(calls, 0)
  markUpdated(ADA, 5)
  assert.deepEqual(noticeUi.updated, { at: 5, cut: ADA })
  assert.equal(cutCall(0), null, 'no call was seen by this test')
})
