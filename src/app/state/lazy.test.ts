import test from 'node:test'
import assert from 'node:assert/strict'
import { createLazyScreen, LAZY_SHOW_AFTER_MS, LAZY_TIMEOUT_MS } from './lazy.ts'
import { onWake } from '../../reconnect.ts'

const settle = () => new Promise((resolve) => setImmediate(resolve))
/** Fake timers for the retries and the give-up (node's own, so the code under test uses the plain setTimeout). */
function fakeTimers(t: { mock: typeof import('node:test').mock }) { t.mock.timers.enable({ apis: ['setTimeout'] }); return { tick: async (ms: number) => { t.mock.timers.tick(ms); await settle() } } }

test('the numbers: a loading line after 200 ms, retries after 1 s then 3 s, a give-up of 30 s', () => {
  assert.equal(LAZY_SHOW_AFTER_MS, 200)
  assert.equal(LAZY_TIMEOUT_MS, 30000)
})

test('a chunk that arrives is used, and loading it twice asks for it once', async (t) => {
  fakeTimers(t)
  let calls = 0
  const screen = createLazyScreen(async () => { calls += 1; return { name: 'Phone' } })
  const [one, two] = await Promise.all([screen.loader(), screen.loader()])
  assert.deepEqual(one, { name: 'Phone' }); assert.equal(one, two); assert.equal(calls, 1)
  assert.equal(screen.view.failed, false)
})

test('a failed download is retried by itself after 1 s and 3 s, and then the screen can load', async (t) => {
  const { tick } = fakeTimers(t)
  let calls = 0
  const screen = createLazyScreen(async () => { calls += 1; if (calls < 3) throw new TypeError('Failed to fetch dynamically imported module'); return 'ok' })
  const loaded = screen.loader()
  await settle(); assert.equal(calls, 1); assert.equal(screen.view.failed, false, 'no error shown while it is still retrying')
  await tick(999); assert.equal(calls, 1); await tick(1); assert.equal(calls, 2); assert.equal(screen.view.failed, false)
  await tick(2999); assert.equal(calls, 2); await tick(1); assert.equal(calls, 3)
  assert.equal(await loaded, 'ok'); assert.equal(screen.view.failed, false)
})

test('when every retry fails the screen says so, offers Try again, and Try again loads it', async (t) => {
  const { tick } = fakeTimers(t)
  let calls = 0, up = false
  const screen = createLazyScreen(async () => { calls += 1; if (!up) throw new TypeError('Failed to fetch dynamically imported module: /assets/x.js'); return 'ok' })
  const loaded = screen.loader()
  await settle(); await tick(1000); await tick(3000)
  assert.equal(calls, 3, 'one attempt and two retries')
  assert.equal(screen.view.failed, true)
  up = true; screen.retry(); await settle()
  assert.equal(await loaded, 'ok'); assert.equal(screen.view.failed, false); assert.equal(calls, 4)
})

test('a download that hangs gives up after the timeout, and still shows the screen if the code lands late', async (t) => {
  const { tick } = fakeTimers(t)
  let land: (value: string) => void = () => {}
  const screen = createLazyScreen(() => new Promise<string>((resolve) => { land = resolve }))
  const loaded = screen.loader()
  await settle(); await tick(LAZY_TIMEOUT_MS - 1); assert.equal(screen.view.failed, false)
  await tick(1); assert.equal(screen.view.failed, true, 'no waiting for ever without a word')
  land('late'); assert.equal(await loaded, 'late'); await settle()
  assert.equal(screen.view.failed, false)
})

test('onWake retries when the network is back or the tab is shown, and stops when told', () => {
  const handlers = new Map<string, () => void>()
  const win = { addEventListener: (type: string, fn: () => void) => handlers.set(`w:${type}`, fn), removeEventListener: (type: string) => handlers.delete(`w:${type}`) }
  const doc = { hidden: true, addEventListener: (type: string, fn: () => void) => handlers.set(`d:${type}`, fn), removeEventListener: (type: string) => handlers.delete(`d:${type}`) }
  let calls = 0
  const stop = onWake(() => { calls += 1 }, win as never, doc as never)
  handlers.get('w:online')?.(); assert.equal(calls, 1)
  handlers.get('d:visibilitychange')?.(); assert.equal(calls, 1, 'hidden: nothing')
  doc.hidden = false; handlers.get('d:visibilitychange')?.(); assert.equal(calls, 2)
  stop(); assert.equal(handlers.size, 0)
})
