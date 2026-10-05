// The online pill: the pure model, the poller (with a fake clock and fetch), and the component rendered to a string.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createFakeServer } from '../../testing/fakeServer.ts'
import type { App } from '../../state/app.ts'
import { compactCount, easeSteps, exactCount, POLL_MS, pulseAria, pulseTitle, pulseTone, STALE_MS } from './onlinePillModel.ts'
import { createPulse, readPulse } from './usePulse.ts'

test('compactCount shortens without ever rounding up', () => {
  assert.deepEqual([0, 7, 999, 1000, 1234, 4200, 9999, 10000, 12500, 999999, 1250000].map(compactCount), ['0', '7', '999', '1k', '1.2k', '4.2k', '9.9k', '10k', '12k', '999k', '1.2M'])
  assert.equal(compactCount(-3), '0'); assert.equal(compactCount(Number.NaN), '0')
})
test('the exact value and the aria text', () => {
  assert.equal(exactCount(4210), '4,210')
  const numbers = { online: 128, visits: 4210, cities: {} }
  assert.equal(pulseTitle(numbers), '128 online now · 4,210 visits in total')
  assert.equal(pulseAria(numbers), '128 people online. 4,210 visits in total. Open People.')
  assert.equal(pulseAria({ online: 1, visits: 1, cities: {} }), '1 person online. 1 visit in total. Open People.')
  assert.match(pulseAria(numbers, 'stale'), /may be out of date/)
  assert.match(pulseTitle(numbers, 'stale'), /not up to date/)
})
test('tone: green while recent, amber when failing, never answered or old', () => {
  assert.equal(pulseTone({ failing: false, at: 1000, now: 2000 }), 'live')
  assert.equal(pulseTone({ failing: true, at: 1000, now: 2000 }), 'stale')
  assert.equal(pulseTone({ failing: false, at: null, now: 2000 }), 'stale')
  assert.equal(pulseTone({ failing: false, at: 0, now: STALE_MS + 1 }), 'stale')
})
test('easeSteps: a few steps that end on the target; a first value has none', () => {
  assert.deepEqual(easeSteps(null, 50), [50])
  assert.deepEqual(easeSteps(5, 5), [5])
  const up = easeSteps(10, 20)
  assert.ok(up.length <= 6 && up.at(-1) === 20 && up.every((v, i) => i === 0 || v >= (up[i - 1] ?? 0)))
  assert.deepEqual(easeSteps(10, 11, 6), [11])
  assert.deepEqual(easeSteps(10, 20, 0), [20])
})
test('readPulse takes the documented shape only', () => {
  assert.deepEqual(readPulse({ online: 3, visits: 9, cities: { lagos: 2 }, serverTime: 1 }), { online: 3, visits: 9, cities: { lagos: 2 } })
  assert.equal(readPulse({ online: '3' }), null)
  assert.equal(readPulse(null), null)
})

function harness(visible = true) {
  let now = 1000, asked = 0, fail = false, hidden = !visible
  const timers = new Map<number, { run: () => void; ms: number }>()
  let id = 0
  const pulse = createPulse({
    fetchJson: async () => { asked += 1; if (fail) throw new Error('down'); return { online: asked, visits: 100 + asked, cities: {} } },
    now: () => now,
    visible: () => !hidden,
    setTimer: (run, ms) => { id += 1; const mine = id; timers.set(mine, { run: () => { timers.delete(mine); run() }, ms }); return mine },
    clearTimer: (handle) => { timers.delete(handle as number) },
  })
  const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve)) }
  return { pulse, timers, flush, asked: () => asked, setFail: (value: boolean) => { fail = value }, hide: (value: boolean) => { hidden = value; pulse.visibility() }, advance: (ms: number) => { now += ms } }
}
test('poller: nothing before the first answer, then one poll every 30 s, paused while hidden', async () => {
  const h = harness()
  assert.equal(h.pulse.state.numbers === null, true)
  h.pulse.start(); await h.flush()
  assert.equal(h.asked(), 1); assert.equal(h.pulse.state.numbers?.online, 1)
  assert.deepEqual([...h.timers.values()].map((timer) => timer.ms), [POLL_MS], 'exactly one timer pending, 30 s')
  h.hide(true); assert.equal(h.timers.size, 0, 'hidden: no timer')
  h.advance(60000); h.hide(false); await h.flush()
  assert.equal(h.asked(), 2, 'back after a while: asks at once')
  h.hide(true); h.hide(false); await h.flush()
  assert.equal(h.asked(), 2, 'back at once: no extra request')
  const [timer] = [...h.timers.values()]; timer?.run(); await h.flush()
  assert.equal(h.asked(), 3)
})
test('poller: a failure marks the numbers failing and keeps the last ones; the next success clears it', async () => {
  const h = harness()
  h.pulse.start(); await h.flush()
  h.setFail(true); [...h.timers.values()][0]?.run(); await h.flush()
  assert.equal(h.pulse.state.failing, true); assert.equal(h.pulse.state.numbers?.online, 1)
  h.setFail(false); [...h.timers.values()][0]?.run(); await h.flush()
  assert.equal(h.pulse.state.failing, false); assert.equal(h.pulse.state.numbers?.online, 3)
  h.pulse.stop(); assert.equal(h.timers.size, 0)
})

// ---- the component ----
const root = fileURLToPath(new URL('../../../..', import.meta.url))
const fake = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
let pill: Component
const html = (): Promise<string> => renderToString(createSSRApp({ render: () => h(pill) }))

before(async () => {
  globalThis.fetch = fake.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
  pill = (await load('/src/app/features/hud/OnlinePill.vue')).default
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the pill renders nothing until the first number arrives, then the compact numbers with the exact ones in title and label', async () => {
  const shared = (await load<{ usePulse: (f: (path: string) => Promise<unknown>) => ReturnType<typeof createPulse> }>('/src/app/features/hud/usePulse.ts')).usePulse(async () => ({}))
  shared.reset()
  const empty = await html()
  assert.ok(!empty.includes('pulse-pill'), 'no zero flash')
  shared.state.numbers = { online: 128, visits: 4210, cities: { lagos: 100 } }; shared.state.at = Date.now(); shared.state.failing = false
  const out = await html()
  assert.match(out, /<button[^>]*class="pulse-pill"/)
  assert.match(out, /title="128 online now · 4,210 visits in total"/)
  assert.match(out, /aria-label="128 people online\. 4,210 visits in total\. Open People\."/)
  assert.match(out, /class="is-live pulse-dot"/)
  const text = out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  assert.equal(text, '128 online · 4.2k visits')
  shared.state.failing = true
  assert.match(await html(), /class="is-stale pulse-dot"/)
  shared.reset()
})
