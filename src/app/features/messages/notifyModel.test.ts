// The service worker's own handlers (public/sw.js), run against a fake worker scope: what a message notification shows, when it stays
// quiet, and what a tap does with an open window and with none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

interface Client { visibilityState: string; focus(): Promise<void>; postMessage(message: unknown): void }
type Handler = (event: Record<string, unknown>) => void
function worker(clients: Client[]) {
  const handlers = new Map<string, Handler>(), shown: { title: string; options: Record<string, unknown> }[] = [], opened: string[] = [], badges: (number | 'clear')[] = []
  const scope = {
    addEventListener: (type: string, handler: Handler) => { handlers.set(type, handler) },
    skipWaiting: () => undefined,
    clients: { matchAll: async () => clients, claim: async () => undefined, openWindow: async (url: string) => { opened.push(url) } },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }) } },
    navigator: { setAppBadge: async (n: number) => { badges.push(n) }, clearAppBadge: async () => { badges.push('clear') } },
  }
  vm.runInNewContext(readFileSync(fileURLToPath(new URL('../../../../public/sw.js', import.meta.url)), 'utf8'), { self: scope })
  const run = async (type: string, event: Record<string, unknown>): Promise<void> => { let work: Promise<unknown> = Promise.resolve(); handlers.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => { work = promise } }); await work }
  return { run, shown, opened, badges }
}
/** Objects made inside the worker scope belong to another realm: compared as plain data. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const push = (data: object) => ({ data: { json: () => data } })
const client = (visibilityState: string, log: unknown[] = []): Client => ({ visibilityState, focus: async () => { log.push('focus') }, postMessage: (message) => { log.push(message) } })

test('a message notification shows the words, one per conversation (the tag), and sets the badge', async () => {
  const w = worker([])
  await w.run('push', push({ kind: 'chat', title: 'Ada', body: '2 new messages · hello', url: '/?chat=g.1', tag: 'cabc', conv: 'g.1', count: 2, badge: 3 }))
  assert.equal(w.shown.length, 1)
  assert.deepEqual([w.shown[0]?.title, w.shown[0]?.options['body'], w.shown[0]?.options['tag'], w.shown[0]?.options['renotify']], ['Ada', '2 new messages · hello', 'cabc', true])
  assert.deepEqual(plain(w.shown[0]?.options['data']), { url: '/?chat=g.1', conv: 'g.1' })
  assert.deepEqual(w.badges, [3])
  assert.equal(w.shown[0]?.options['icon'], '/icons/icon-192.png')
})

test('a message does not buzz while a visible window of the game is open; other notifications still show', async () => {
  const w = worker([client('visible')])
  await w.run('push', push({ kind: 'chat', title: 'Ada', body: 'hi', tag: 'c1' }))
  assert.equal(w.shown.length, 0)
  await w.run('push', push({ title: 'While you were away', body: 'x', url: '/', tag: 'away' }))
  assert.equal(w.shown.length, 1)
  const hidden = worker([client('hidden')])
  await hidden.run('push', push({ kind: 'chat', title: 'Ada', body: 'hi', tag: 'c1' }))
  assert.equal(hidden.shown.length, 1, 'a window that is not in front is not looking')
})

test('a hostile payload cannot make the title long, the link another site, or the body long', async () => {
  const w = worker([])
  await w.run('push', push({ kind: 'chat', title: 'x'.repeat(500), body: 'y'.repeat(500), url: '//evil.example/x', tag: 't'.repeat(100), conv: 'c'.repeat(500) }))
  const shown = w.shown[0]
  assert.equal(shown?.title.length, 80); assert.equal(String(shown?.options['body']).length, 160); assert.equal(String(shown?.options['tag']).length, 32)
  assert.equal((shown?.options['data'] as { url: string }).url, '/'); assert.equal(String((shown?.options['data'] as { conv: string }).conv).length, 120)
})

test('tapping focuses an open window and tells it which conversation to open; with none open the game is opened at the address', async () => {
  const log: unknown[] = []
  const open = worker([client('hidden', log)])
  let closed = false
  await open.run('notificationclick', { notification: { close: () => { closed = true }, data: { url: '/?chat=g.1', conv: 'g.1' } } })
  assert.deepEqual(plain(log), [{ type: 'open-chat', conv: 'g.1' }, 'focus']); assert.equal(closed, true); assert.deepEqual(open.opened, [])
  const none = worker([])
  await none.run('notificationclick', { notification: { close: () => undefined, data: { url: '/?chat=g.1', conv: 'g.1' } } })
  assert.deepEqual(none.opened, ['/?chat=g.1'])
  const bare = worker([])
  await bare.run('notificationclick', { notification: { close: () => undefined, data: undefined } })
  assert.deepEqual(bare.opened, ['/'])
})
