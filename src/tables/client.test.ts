import test from 'node:test'
import assert from 'node:assert/strict'
import type { PanelApi } from '../app/types/panel.ts'

class Socket {
  static instances: Socket[] = []
  readyState = 0
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(_url: string) { Socket.instances.push(this) }
  send(text: string) { this.sent.push(JSON.parse(text)) }
  open() { this.readyState = 1; this.onopen?.() }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
  close() { this.readyState = 3; this.onclose?.() }
}

test('tables ignores callbacks from a socket closed by an identity change', async t => {
  const oldWindow = Reflect.get(globalThis, 'window'), oldLocation = Reflect.get(globalThis, 'location'), oldSocket = Reflect.get(globalThis, 'WebSocket')
  const listeners = new Map<string, (() => void)[]>()
  Reflect.set(globalThis, 'window', { addEventListener(type: string, listener: () => void) { const list = listeners.get(type) ?? []; list.push(listener); listeners.set(type, list) },
    dispatchEvent(event: { type: string }) { for (const listener of listeners.get(event.type) ?? []) listener() } })
  Reflect.set(globalThis, 'location', { protocol: 'https:', host: 'example.test' }); Reflect.set(globalThis, 'WebSocket', Socket)
  t.after(() => { if (oldWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else Reflect.set(globalThis, 'window', oldWindow); if (oldLocation === undefined) Reflect.deleteProperty(globalThis, 'location'); else Reflect.set(globalThis, 'location', oldLocation); if (oldSocket === undefined) Reflect.deleteProperty(globalThis, 'WebSocket'); else Reflect.set(globalThis, 'WebSocket', oldSocket) })
  const tables = await import(`./client.ts?stale=${Date.now()}`) as typeof import('./client.ts')
  const api = { view: () => ({ connected: true, onboarding: { required: false }, cityId: 'lagos' }), refresh() {}, state: () => ({ message: '' }), toast() {},
    fetchJson: async () => ({ ok: true, results: [], ratings: {} }), command: async () => ({ ok: true, code: 'ok' }) } as unknown as PanelApi
  tables.start(api); const first = Socket.instances.at(-1)!; first.open(); first.receive({ type: 'tables', tables: [{ id: 'old' }] })
  const staleMessage = first.onmessage, staleClose = first.onclose
  for (const listener of listeners.get('jaw:session') ?? []) listener()
  tables.start(api); const current = Socket.instances.at(-1)!; assert.notEqual(current, first); current.open(); current.receive({ type: 'tables', tables: [{ id: 'new' }] })
  staleMessage?.({ data: JSON.stringify({ type: 'tables', tables: [{ id: 'stale' }] }) }); staleClose?.()
  assert.deepEqual(tables.T.list?.map(item => item.id), ['new']); assert.equal(tables.T.socket, 'open')
})
