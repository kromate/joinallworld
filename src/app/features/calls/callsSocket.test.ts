// The social client's seam for calls: call frames are handed to the listener, other frames are not, a frame can be sent
// on the open socket, and the listener is told when the socket closes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PanelApi, PanelView } from '../../types/panel.ts'
import { createSocialClient } from '../social/socialClient.ts'
import type { SocketLike } from '../social/socialClient.ts'

class FakeSocket implements SocketLike {
  readyState = 1
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  send(data: string): void { this.sent.push(data) }
  close(): void { this.readyState = 3 }
  push(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
}
function setup() {
  const sockets: FakeSocket[] = []
  const api = {
    view: () => ({ connected: true, cityId: 'lagos', now: 1000 }) as unknown as PanelView,
    fetchJson: async () => ({ ok: false, code: 'unknown' }),
    newId: () => '1:x', toast: () => {}, refresh: () => {}, open: () => true, command: async () => ({ ok: true, code: 'synced' }),
  } as unknown as PanelApi
  const client = createSocialClient({
    openSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
    pageAddress: () => ({ pathname: '/', search: '' }), clearAddress: () => {}, onOnline: () => {},
    setTimeout: () => 0, clearTimeout: () => {}, now: () => 5000,
  })
  client.start(api)
  return { client, sockets }
}

test('call frames reach the call listener and nothing else; other frames do not', () => {
  const { client, sockets } = setup()
  const seen: string[] = []
  client.onCallFrame((frame) => { seen.push(frame.type) })
  const socket = sockets[0] as FakeSocket
  socket.push({ type: 'call-incoming', callId: 'c1', from: { id: 'a', name: 'Ada' }, expiresAt: 1 })
  socket.push({ type: 'call-state', callId: 'c1', state: 'ringing' })
  socket.push({ type: 'call-signal', callId: 'c1', kind: 'ice', data: {} })
  socket.push({ type: 'call-settings', calls: 'friends' })
  socket.push({ type: 'people-changed', cityId: 'lagos', venueId: 'park' })
  assert.deepEqual(seen, ['call-incoming', 'call-state', 'call-signal', 'call-settings'])
})

test('a frame is sent on the open socket, and refused when there is none', () => {
  const { client, sockets } = setup()
  const socket = sockets[0] as FakeSocket
  assert.equal(client.sendFrame({ type: 'call-invite', to: 'b', clientId: 'x' }), true)
  assert.deepEqual(socket.sent.map((line) => JSON.parse(line)).filter((frame: { type: string }) => frame.type === 'call-invite'), [{ type: 'call-invite', to: 'b', clientId: 'x' }])
  socket.readyState = 3
  assert.equal(client.sendFrame({ type: 'call-hangup', callId: 'c1' }), false)
})

test('the close listener runs when the socket closes and when the identity is reset', () => {
  const { client, sockets } = setup()
  let closed = 0
  const stop = client.onSocketClose(() => { closed += 1 })
  const socket = sockets[0] as FakeSocket
  socket.readyState = 3; socket.onclose?.()
  assert.equal(closed, 1)
  client.resetSocial()
  assert.equal(closed, 2)
  stop()
  client.resetSocial()
  assert.equal(closed, 2)
})
