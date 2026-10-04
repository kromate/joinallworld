// The Messages draft: it is cleared when a message is sent and when another conversation is opened,
// so what was typed for one person is never sent to another (coverage of the old panel's draft tests).
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { showConversation, takeDraft, ui } from './messagesState.ts'

afterEach(() => { showConversation(null) })

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
