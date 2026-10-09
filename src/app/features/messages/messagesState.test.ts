// The Messages draft: it is cleared when a message is sent and when another conversation is opened,
// so what was typed for one person is never sent to another (coverage of the old panel's draft tests).
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { resetMessageUi, showConversation, takeDraft, ui } from './messagesState.ts'

afterEach(() => { showConversation(null); ui.prefill = '' })

test('sending takes the draft and clears the field; an empty or unopened draft sends nothing', () => {
  showConversation('dm.ada.me')
  ui.draft = '   '
  assert.equal(takeDraft(), null, 'blank is not a message')
  ui.draft = '  Please meet me by the library '
  assert.equal(takeDraft(), 'Please meet me by the library', 'trimmed')
  assert.equal(ui.draft, '', 'the field is empty after a send')
  showConversation(null)
  ui.draft = 'typed on the list'
  assert.equal(takeDraft(), null, 'with no conversation open there is nowhere to send it')
  assert.equal(ui.draft, 'typed on the list', 'and it is not thrown away')
})

test('switching conversation, or going back to the list, drops the old draft and closes the member list', () => {
  showConversation('dm.ada.me')
  ui.draft = 'Unsent old chat draft'; ui.manage = true
  showConversation('dm.bola.me')
  assert.deepEqual([ui.open, ui.draft, ui.manage], ['dm.bola.me', '', false])
  ui.draft = 'another unsent line'
  showConversation(null)
  assert.deepEqual([ui.open, ui.draft], [null, ''])
})

test('a sentence another screen has ready (asking a friend) fills the box of the next conversation opened, once', () => {
  ui.prefill = 'Hi! I am stuck.'
  showConversation(null)
  assert.equal(ui.draft, '', 'the list has no box to fill')
  assert.equal(ui.prefill, 'Hi! I am stuck.', 'it waits for a conversation to be opened')
  showConversation('to:friend')
  assert.equal(ui.draft, 'Hi! I am stuck.')
  assert.equal(ui.prefill, '')
  showConversation('to:other')
  assert.equal(ui.draft, '', 'the next conversation starts empty')
})

test('the badge counts the unread chats that are not loaded yet, so a page of chats never hides the rest', async () => {
  const { unreadChats } = await import('./messagesModel.ts')
  const chat = (unread: number, extra: object = {}) => ({ unread, ...extra }) as never
  assert.equal(unreadChats({ conversations: [chat(2), chat(1, { muted: true, mentions: 1 })] }), 3)
  assert.equal(unreadChats({ conversations: [chat(2)], conversationsMore: { total: 90, next: 'x', unreadOlder: 5 } }), 7)
  assert.equal(unreadChats(null), 0)
})

test('replacing the actor clears held thread, prefill and member management state', () => {
  Object.assign(ui, { tab: 'groups', open: 'g.ada', openName: 'Ada group', draft: 'Private draft', prefill: 'Private prefill', manage: true })
  resetMessageUi()
  assert.deepEqual({ ...ui }, { tab: 'chats', open: null, openName: null, draft: '', prefill: '', manage: false })
})
