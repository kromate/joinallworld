// "What you can do now" and the ride debt in the wallet: rendered to a string against the real store connected to a fake server.
// What is asserted is what the player reads and can press; the rules are in src/game/relief.test.ts.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LifeState } from '../../../types/life.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import { askFriendText, createDismissals } from './reliefModel.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const render = async (path: string): Promise<string> => { const component = (await load(path)).default; return renderToString(createSSRApp({ render: () => h(component) })) }
/** The life as a visitor in Port Harcourt with `cash`, home in Lagos, for the length of `body`. */
async function visitor(cash: number, body: () => Promise<void>, debt = 0): Promise<void> {
  const before = app.game.state.value, cityBefore = app.game.cityId.value
  const state = structuredCloneState(before)
  state.goals.wishes = []
  Object.assign(state.estate, { city: 'port-harcourt', lga: null, home: 'lagos', plot: null })
  state.cash = cash
  state.needs.hunger = 80
  state.needs.energy = 80
  state.location = 'pleasure-park'
  if (debt) state.travel.rideDebt = debt
  app.game.state.value = state
  app.game.cityId.value = 'port-harcourt'
  try { await body() } finally { app.game.state.value = before; app.game.cityId.value = cityBefore }
}
const structuredCloneState = (state: LifeState): LifeState => JSON.parse(JSON.stringify(state)) as LifeState

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cities = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await Promise.all(['lagos', 'port-harcourt'].map(cities.loadCityContent))
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the card: calm, specific, with the first step first, and nothing for someone who is fine', async () => {
  // Fine, at home: nothing on screen.
  assert.equal(text(await render('/src/app/features/relief/ReliefCard.vue')), '')
  await visitor(2800, async () => {
    const html = await render('/src/app/features/relief/ReliefCard.vue')
    const words = text(html)
    assert.match(html, /<section class="relief-card" aria-label="What you can do now">/)
    assert.ok(words.includes('You have ₦2,800 in Port Harcourt and the cheapest way home to Lagos is ₦12,000'))
    // The odd job first, then the ride on credit, then a friend.
    const order = [...html.matchAll(/data-relief="([a-z-]+)"/g)].map((match) => match[1])
    assert.deepEqual(order, ['odd-job', 'credit-ride', 'friend'])
    assert.ok(words.includes('Paid work, any hour: ₦350 a job.'))
    assert.ok(words.includes('Ride home on credit to Lagos'))
    assert.match(html, /aria-label="Dismiss"/)
    assert.equal((html.match(/class="relief-go"/g) ?? []).length, 3)
  })
  // With the fare in hand and fed, nothing.
  await visitor(20000, async () => { assert.equal(text(await render('/src/app/features/relief/ReliefCard.vue')), '') })
})

test('the wallet: what is owed in plain words, a way to pay, and the card opened in place while money is short', async () => {
  await visitor(500, async () => {
    const html = await render('/src/app/features/relief/ReliefLink.vue')
    const words = text(html)
    assert.ok(words.includes('Money is short. There is a way through.'))
    assert.match(html, /aria-expanded="false"[^>]*>What you can do now</)
    assert.ok(!words.includes('You owe'))
  })
  await visitor(500, async () => {
    const words = text(await render('/src/app/features/relief/ReliefLink.vue'))
    assert.ok(words.includes('You owe ₦12,000 for your ride home.'))
    assert.ok(words.includes('Pay what I can'))
  }, 12000)
  // Nothing owed and nothing short: the wallet shows nothing extra.
  await visitor(30000, async () => { assert.equal(text(await render('/src/app/features/relief/ReliefLink.vue')), '') })
})

test('the visitor sheet offers the ride on credit, labelled, below the way home', async () => {
  await visitor(2800, async () => {
    const html = await render('/src/app/features/travel/VisitorHome.vue')
    assert.match(html, /data-visitor="credit".*?<span[^>]*>Ride home on credit · ₦12,000 owed<\/span>/)
    assert.ok(html.indexOf('data-visitor="home"') < html.indexOf('data-visitor="credit"'), 'below the way home')
    assert.ok(text(html).includes('It is advanced and you repay it from your earnings'))
  })
  await visitor(30000, async () => { assert.ok(!text(await render('/src/app/features/travel/VisitorHome.vue')).includes('on credit')) })
})

test('the memory of the card: a dismissed situation stays dismissed on this device, a different one is new', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  const first = createDismissals(storage)
  assert.equal(first.has('home@port-harcourt'), false)
  first.add('home@port-harcourt')
  assert.equal(createDismissals(storage).has('home@port-harcourt'), true, 'remembered by a new page')
  assert.equal(createDismissals(storage).has('home+hunger@port-harcourt'), false, 'another situation is shown')
  first.clear('home@port-harcourt')
  assert.equal(createDismissals(storage).has('home@port-harcourt'), false)
  // A storage that holds rubbish, or none at all, shows the card.
  assert.equal(createDismissals({ getItem: () => '{not json', setItem: () => {} }).has('x'), false)
  assert.equal(createDismissals(null).has('x'), false)
  for (let i = 0; i < 40; i++) first.add(`k${i}`)
  assert.ok(JSON.parse(store.get('jaw-relief-dismissed') ?? '[]').length <= 20, 'a short list')
})

test('ask a friend: a plain sentence with the place, the money and the way home, ready in the message box', () => {
  assert.equal(askFriendText('Port Harcourt', 2800, 'Lagos'), 'Hi! I am stuck in Port Harcourt with ₦2,800. Could you send me a little so I can get home to Lagos? Thank you!')
  assert.ok(!askFriendText('Ibadan', 0, null).includes('get home'))
})
