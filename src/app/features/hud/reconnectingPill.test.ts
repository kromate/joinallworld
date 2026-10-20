import test from 'node:test'
import assert from 'node:assert/strict'
import { hudNotice, savedPill } from './hudModel.ts'

const view = { connected: true, reconnecting: true, link: 'online' as const, net: { text: 'Reconnecting…', error: false }, storage: null }

test('while the connection is only slow the top bar says Reconnecting… quietly and no red notice is shown', () => {
  const pill = savedPill(view, 0)
  assert.deepEqual([pill.kind, pill.text], ['status', 'Reconnecting…'])
  assert.equal(hudNotice(view), null)
})

test('once the server is called unreachable the button and the Try again notice come back', () => {
  const down = { ...view, connected: false, reconnecting: false, link: 'unreachable' as const }
  assert.deepEqual([savedPill(down, 0).kind, savedPill(down, 0).text], ['button', 'Server unreachable'])
  assert.equal(hudNotice(down)?.actions[0]?.label, 'Try again')
})
