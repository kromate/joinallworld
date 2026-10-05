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
  onclose: ((event?: { code?: number }) => void) | null = null
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

// ---- one character on several devices (docs/DEVICES.md) ----
test('the life hint reaches the game, read state from another device clears here without a request, and an own change elsewhere reads the overview again', async () => {
  const sockets: FakeSocket[] = []
  const requests: string[] = []
  const overview = () => ({ ok: true, me: { id: 'me', name: 'Ada' }, friends: [], requests: [], updates: [{ id: 'u1', text: 'Hello', read: false }, { id: 'u2', text: 'Again', read: false }],
    conversations: [{ id: 'c1', kind: 'dm', name: 'Bola', unread: 2 }, { id: 'c2', kind: 'dm', name: 'Cleo', unread: 1 }] })
  const api = {
    view: () => ({ connected: true, cityId: 'lagos', now: 1000 }) as unknown as PanelView,
    fetchJson: async (path: string) => { requests.push(path); return path === '/api/social/me' ? overview() : { ok: false, code: 'unknown' } },
    newId: () => '1:x', toast: () => {}, refresh: () => {}, open: () => true, command: async () => ({ ok: true, code: 'synced' }),
  } as unknown as PanelApi
  const client = createSocialClient({
    openSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
    pageAddress: () => ({ pathname: '/', search: '' }), clearAddress: () => {}, onOnline: () => {},
    setTimeout: () => 0, clearTimeout: () => {}, now: () => 5000,
  })
  const hints: { rev: number; by?: readonly string[] }[] = [], opens: boolean[] = [], closes: (number | undefined)[] = []
  client.onLifeFrame((hint) => { hints.push(hint) })
  client.onSocketOpen((again) => { opens.push(again) })
  client.onSocketClose((code) => { closes.push(code) })
  client.start(api)
  const socket = sockets[0] as FakeSocket
  socket.onopen?.()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.deepEqual(opens, [false], 'the first socket of this identity is not a reconnection')
  socket.push({ type: 'life-changed', rev: 7, by: ['5:a'] })
  socket.push({ type: 'life-changed', rev: 'x' })
  assert.deepEqual(hints, [{ rev: 7, by: ['5:a'] }], 'a malformed hint is ignored')
  const before = requests.length
  socket.push({ type: 'social-read', conv: { id: 'c2', kind: 'dm', name: 'Cleo', unread: 0 } })
  assert.deepEqual(client.state.me?.conversations.map((conv) => [conv.id, conv.unread]), [['c1', 2], ['c2', 0]], 'the badge clears in place: the list keeps its order')
  socket.push({ type: 'social-read', updates: true })
  assert.deepEqual(client.state.me?.updates.map((update) => update.read), [true, true])
  assert.equal(requests.length, before, 'neither cost a request')
  socket.push({ type: 'social-changed' })
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.deepEqual(requests.slice(before), ['/api/social/me'])
  // The server closes the socket because the session changed: the listener is told why.
  socket.readyState = 3; socket.onclose?.({ code: 4401 })
  assert.deepEqual(closes, [4401])
  // Back in front with no socket: it is opened at once, and that one is a reconnection.
  client.wakeSocket()
  assert.equal(sockets.length, 2)
  sockets[1]?.onopen?.()
  assert.deepEqual(opens, [false, true])
  client.wakeSocket()
  assert.equal(sockets.length, 2, 'an open socket is left alone')
})
