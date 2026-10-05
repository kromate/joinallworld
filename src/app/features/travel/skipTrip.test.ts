// The Skip button ('travel.skip'): what it says in each state (the model), and what the player reads and can press where a
// trip's progress is shown (the component, rendered against the real store connected to a fake server).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LifeState } from '../../../types/life.ts'
import type { TripSkipOffer } from '../../../types/view.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import { skipButton, SKIP_EXPLAINED } from './skipModel.ts'
import { regionInfo } from '../../../map3d/geo/info.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}
/** Run `body` with the life changed, then put it back. */
async function withState(change: (state: LifeState) => LifeState, body: () => Promise<void>): Promise<void> {
  const before = app.game.state.value
  app.game.state.value = change(before)
  try { await body() } finally { app.game.state.value = before }
}
/** On the bus to Ibadan (₦3,500, 30 s) with `remaining` seconds to go. */
const onTheBus = (state: LifeState, remaining: number, more: Partial<LifeState> = {}): LifeState => ({ ...state, ...more, activeAction: { kind: 'intercity', id: 'ibadan', from: 'lagos', mode: 'road', fare: 3500, duration: 30, remaining } })
const buttons = (html: string): string[] => (html.match(/<button[^>]*>[^<]*<\/button>/g) ?? []).map((button) => text(button))

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await Promise.all(['lagos', 'ibadan'].map((city) => cityLoader.loadCityContent(city)))
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the model: the label carries the price, a disabled button says why, and the explanation is said until the first skip', () => {
  const offer = (over: Partial<TripSkipOffer> = {}): TripSkipOffer => ({ kind: 'intercity', fee: 1300, free: false, confirm: false, blocked: null, ...over })
  const idle = { known: false, pending: false, connected: true }
  assert.equal(skipButton(null, idle), null)
  assert.deepEqual(skipButton(offer(), idle), { label: 'Skip the trip · ₦1,300', aria: 'Skip the trip and arrive now for ₦1,300', disabled: false, note: SKIP_EXPLAINED, confirm: false, fee: 1300 })
  assert.equal(skipButton(offer(), { ...idle, known: true })?.note, '', 'a character that has skipped before is not told again')
  assert.deepEqual(skipButton(offer({ fee: 0, free: true }), idle), { label: 'Skip the trip · Free', aria: 'Skip the trip and arrive now. This one is free.', disabled: false, note: 'Arrive now. The rest of the journey is skipped. Your first skip between cities is free.', confirm: false, fee: 0 })
  const short = skipButton(offer({ blocked: { code: 'insufficient_funds', reason: 'You need ₦300 more' } }), idle)
  assert.deepEqual([short?.disabled, short?.label, short?.note, short?.aria], [true, 'Skip the trip · ₦1,300', 'You need ₦300 more. The price falls as you get closer.', 'Skip the trip for ₦1,300. You need ₦300 more.'])
  const late = skipButton(offer({ fee: 150, blocked: { code: 'almost_there', reason: 'You arrive in a moment. Waiting is free.' } }), idle)
  assert.deepEqual([late?.disabled, late?.label], [true, 'Arriving in a moment'])
  assert.deepEqual([skipButton(offer(), { ...idle, pending: true })?.label, skipButton(offer(), { ...idle, pending: true })?.disabled], ['Arriving…', true])
  assert.deepEqual([skipButton(offer(), { ...idle, connected: false })?.disabled, skipButton(offer(), { ...idle, connected: false })?.note], [true, 'Reconnect to skip the trip.'])
  // A large price asks first; a free one never does.
  assert.equal(skipButton(offer({ fee: 4300, confirm: true }), idle)?.confirm, true)
  assert.equal(skipButton(offer({ fee: 0, free: true, confirm: true }), idle)?.confirm, false)
})

test('where the trip is chosen: each route of the atlas card carries what arriving at once would add to its fare', () => {
  const card = (routes: { to: string; mode: string; blocked: null; skipFree?: boolean }[] | null) => regionInfo({ kind: 'state', id: 'oyo' }, { cityId: 'ibadan', feature: { name: 'Oyo State' }, current: 'lagos', routes })
    .routes.map((route) => [route.mode, route.fare, route.skip])
  const mine = (skipFree?: boolean) => ['road', 'rail'].map((mode) => ({ to: 'ibadan', mode, blocked: null, ...(skipFree === undefined ? {} : { skipFree }) }))
  assert.deepEqual(card(mine(false)), [['road', 3500, 1300], ['rail', 9000, 950]])
  assert.deepEqual(card(mine(true)), [['road', 3500, 0], ['rail', 9000, 0]], 'a character that has never skipped is told its first one is free')
  // Routes that are not the player's own (nobody is playing, or an older caller) say nothing about skipping.
  assert.deepEqual(card(mine()), [['road', 3500, undefined], ['rail', 9000, undefined]])
  assert.deepEqual(card(null), [['road', 3500, undefined], ['rail', 9000, undefined]])
})

test('on a trip between cities the progress chip offers the skip: free the first time, then at the price as the trip stands', async () => {
  await withState((state) => onTheBus(state, 20), async () => {
    const html = await render('/src/app/features/venue/ActionProgress.vue')
    assert.deepEqual(buttons(html), ['Skip the trip · Free'])
    assert.match(html, /<button type="button" class="ui-button is-primary trip-skip-go" aria-label="Skip the trip and arrive now\. This one is free\.">/)
    assert.match(html, /<p class="trip-skip-note" role="status">Arrive now\. The rest of the journey is skipped\. Your first skip between cities is free\.<\/p>/)
  })
  const skipped = (state: LifeState): LifeState => ({ ...state, cash: 20000, travel: { ...state.travel, skipped: true } })
  await withState((state) => onTheBus(skipped(state), 20), async () => {
    const html = await render('/src/app/features/venue/ActionProgress.vue')
    assert.deepEqual(buttons(html), ['Skip the trip · ₦900'])
    assert.match(html, /aria-label="Skip the trip and arrive now for ₦900"/)
    assert.doesNotMatch(html, /trip-skip-note/, 'nothing more to explain to a character that has skipped before')
    assert.doesNotMatch(html, /disabled/)
  })
  // The price follows the trip.
  await withState((state) => onTheBus(skipped(state), 5), async () => {
    assert.deepEqual(buttons(await render('/src/app/features/venue/ActionProgress.vue')), ['Skip the trip · ₦300'])
  })
})

test('a skip that cannot be bought is a disabled button with the reason beside it', async () => {
  await withState((state) => onTheBus({ ...state, cash: 600, travel: { ...state.travel, skipped: true } }, 25), async () => {
    const html = await render('/src/app/features/venue/ActionProgress.vue')
    assert.match(html, /<button type="button" class="ui-button is-primary trip-skip-go" disabled aria-label="Skip the trip for ₦1,100\. You need ₦500 more\.">Skip the trip · ₦1,100<\/button>/)
    assert.match(text(html), /You need ₦500 more\. The price falls as you get closer\./)
  })
  await withState((state) => onTheBus(state, 2), async () => {
    const html = await render('/src/app/features/venue/ActionProgress.vue')
    assert.match(html, /<button[^>]*trip-skip-go" disabled[^>]*>Arriving in a moment<\/button>/)
  })
})

test('inside the city: an ordinary hop has no skip; a long one offers it on the trip bar and on the progress chip', async () => {
  const target = app.game.view.value.travel.destinations.find((item) => !item.here && item.open && !item.blocked)
  assert.ok(target)
  const hop = (remaining: number, duration: number) => (state: LifeState): LifeState => ({ ...state, activeAction: { kind: 'travel', id: target.id, mode: 'trek', duration, remaining, fare: 0 } })
  await withState(hop(8, 12), async () => {
    const bar = await render('/src/app/features/travel/TripBar.vue', { trip: (await load<typeof import('./travelModel.ts')>('/src/app/features/travel/travelModel.ts')).tripInfo(app.game.state.value, app.game.view.value) })
    assert.deepEqual(buttons(bar), ['Cancel'])
    assert.deepEqual(buttons(await render('/src/app/features/venue/ActionProgress.vue')), ['Cancel'])
  })
  await withState(hop(40, 60), async () => {
    const bar = await render('/src/app/features/travel/TripBar.vue', { trip: (await load<typeof import('./travelModel.ts')>('/src/app/features/travel/travelModel.ts')).tripInfo(app.game.state.value, app.game.view.value) })
    assert.deepEqual(buttons(bar), ['Cancel', 'Skip the trip · ₦250'])
    assert.match(text(bar), /Arrive now\. The rest of the journey is skipped\./)
    assert.deepEqual(buttons(await render('/src/app/features/venue/ActionProgress.vue')), ['Cancel', 'Skip the trip · ₦250'])
  })
})

test('nothing is offered when there is no trip', async () => {
  assert.equal(await render('/src/app/features/travel/SkipTrip.vue'), '<!---->')
})
