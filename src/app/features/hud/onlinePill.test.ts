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
import { aloneLine, compactCount, easeSteps, exactCount, onlineView, POLL_MS, pulseAria, pulseTitle, pulseTone, STALE_MS } from './onlinePillModel.ts'
import { createPulse, readPulse } from './usePulse.ts'

test('compactCount shortens without ever rounding up', () => {
  assert.deepEqual([0, 7, 999, 1000, 1234, 4200, 9999, 10000, 12500, 999999, 1250000].map(compactCount), ['0', '7', '999', '1k', '1.2k', '4.2k', '9.9k', '10k', '12k', '999k', '1.2M'])
  assert.equal(compactCount(-3), '0'); assert.equal(compactCount(Number.NaN), '0')
})
test('the exact value and the aria text', () => {
  assert.equal(exactCount(4210), '4,210')
  const numbers = { online: 128, visits: 4210, cities: {} }
  assert.equal(pulseTitle(numbers), '128 in Allworld · 4,210 visits in total across all of Allworld')
  assert.equal(pulseTitle({ ...numbers, cities: { ibadan: 9 } }, 'live', 'ibadan'), '128 in Allworld · 9 here · 4,210 visits in total across all of Allworld')
  assert.equal(pulseAria(numbers), '128 people online in Allworld. 4,210 visits in total. Open People.')
  assert.equal(pulseAria({ online: 2, visits: 1, cities: { lagos: 1 } }, 'live', 'lagos'), '2 people online in Allworld, 1 here. 1 visit in total. Open People.')
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
  assert.deepEqual(readPulse({ online: 3, visits: 9, today: 5, cities: { lagos: 2 }, serverTime: 1 }), { online: 3, visits: 9, today: 5, cities: { lagos: 2 } })
  assert.equal(readPulse({ online: 3, visits: 9, cities: {} })?.today, 0, 'an older server does not say')
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
  assert.deepEqual([...h.timers.values()].map((timer) => timer.ms), [5000], 'exactly one timer pending: the early second look, 5 s after the first answer')
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
  await (await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')).loadCityContent('lagos')
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
  assert.match(out, /title="128 in Allworld · 100 here · 4,210 visits in total across all of Allworld"/)
  assert.match(out, /aria-label="128 people online in Allworld, 100 here\. 4,210 visits in total\. Open People\."/)
  assert.match(out, /class="is-live pulse-dot"/)
  const text = out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  assert.equal(text, '128 in Allworld · 100 here · 4.2k visits')
  shared.state.numbers = { online: 128, visits: 4210, cities: { lagos: 100, ibadan: 7 } }
  app.game.cityId.value = 'ibadan'
  const other = (await html()).replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  assert.equal(other, '128 in Allworld · 7 here · 4.2k visits', 'the city count follows the city; the world count and visits do not')
  app.game.cityId.value = 'lagos'
  // Alone: not a bare "1", and pressing it offers the invite.
  shared.state.numbers = { online: 1, visits: 67, today: 1, cities: { lagos: 1 } }
  const first = await html()
  assert.equal(first.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), "1 in Allworld · 1 here · 67 visits · You&#39;re first here: invite a friend", 'the format stays; the warm line is a secondary element')
  assert.match(first, /class="pulse-pill is-alone"/)
  assert.match(first, /aria-label="You are the only one online right now\. 1 player today\. 67 visits in total\. Invite a friend\."/)
  shared.state.numbers = { online: 1, visits: 67, today: 5, cities: { lagos: 1 } }
  assert.match(await html(), /5 played today/)
  shared.state.failing = true
  assert.match(await html(), /class="is-stale pulse-dot"/)
  shared.reset()
})

test('the reader is always counted: nothing is 0, the world is never below a city, and today never below the world', () => {
  assert.deepEqual(onlineView({ online: 0, visits: 3, cities: { lagos: 0 } }, 'lagos'), { world: 1, here: 1, today: 1, alone: true })
  assert.deepEqual(onlineView({ online: 2, visits: 3, today: 9, cities: { lagos: 1, ibadan: 1 } }, 'lagos'), { world: 2, here: 1, today: 9, alone: false })
  assert.equal(onlineView({ online: 2, visits: 3, cities: { lagos: 7 } }, 'lagos').here, 2, 'a city is never above the world')
  assert.equal(onlineView({ online: 4, visits: 3, cities: {} }, 'lagos').here, null, 'an answer that does not carry the city says only the world')
  assert.equal(onlineView({ online: 4, visits: 3, today: 2, cities: {} }, null).today, 4)
})
test('the line for a reader who is alone is true: a number of players today when there is one, else "first here"', () => {
  assert.deepEqual(aloneLine({ today: 1 }), { long: "You're first here", short: 'First here' })
  assert.deepEqual(aloneLine({ today: 12 }), { long: '12 played today', short: '12 today' })
  assert.deepEqual(aloneLine({ today: 1500 }), { long: '1.5k played today', short: '1.5k today' })
})
test('frames: a pulse frame is taken at once, an answer to an older request does not replace it, anything else is ignored', async () => {
  const h = harness()
  h.pulse.take({ type: 'pulse', online: 4, visits: 70, today: 6, cities: { lagos: 3 } })
  assert.deepEqual(h.pulse.state.numbers, { online: 4, visits: 70, today: 6, cities: { lagos: 3 } }, 'the first number shown is the first frame')
  h.pulse.take({ type: 'pulse', online: 'x' }); h.pulse.take(null)
  assert.equal(h.pulse.state.numbers?.online, 4)
  h.pulse.start(); await h.flush()
  assert.equal(h.pulse.state.numbers?.online, 1, 'a poll that was asked after the frame is newer than it')
  const slow = harness()
  slow.pulse.start()
  slow.pulse.take({ type: 'pulse', online: 9, visits: 1, today: 9, cities: {} })
  await slow.flush()
  assert.equal(slow.pulse.state.numbers?.online, 9, 'a poll started before a frame is older than it and is dropped')
})
