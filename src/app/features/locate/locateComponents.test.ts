// Component tests for the location-confirmed badge, in the approach of src/app/components.test.ts: each component is compiled by the
// project's Vite configuration and rendered to a string against the real store connected to a fake server. What is asserted is what
// the player reads and can press, in each state of the card and each kind of badge.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import type { CheckOutcome, LocateUi } from './locateModel.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
let ui: LocateUi
let cache: Record<string, { lga: string | null; name: string | null } | null>

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}
const CARD = '/src/app/features/locate/ResidenceCard.vue', BADGE = '/src/app/features/locate/ResidentBadge.vue'
function home(confirmed: boolean): void {
  const state = app.game.state.value
  app.game.state.value = { ...state, estate: { ...state.estate, lga: 'ikeja', lgaConfirmed: true, home: 'lagos', ...(confirmed ? { confirmed: { lga: 'ikeja', at: state.t } } : { confirmed: undefined }) } }
}

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  ui = (await load<typeof import('./locateModel.ts')>('/src/app/features/locate/locateModel.ts')).locateUi
  cache = (await load<typeof import('./badgeFeed.ts')>('/src/app/features/locate/badgeFeed.ts')).badgeCache
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('not confirmed: the optional offer, the honest note, and one button that names what it does', async () => {
  home(false); ui.step = 'rest'; ui.outcome = null
  const html = await render(CARD), words = text(html)
  assert.match(html, /data-residence-card/)
  assert.ok(words.includes('Optional. You can live anywhere in Allworld wherever you are in the real world.'))
  assert.ok(words.includes('Confirm where I live with my device\'s location'))
  assert.ok(words.includes('says you live in Ikeja, confirmed by your device'))
  assert.ok(words.includes('It is not an identity check') && words.includes('nothing about where you are goes to the game'))
  assert.ok(!html.includes('data-residence-explain'), 'the browser is not asked, and not even the explanation is up, before the press')
  assert.ok(!/verified/i.test(words))
})

test('after the first press: two short lines say what happens, and only "Check now" starts it', async () => {
  home(false); ui.step = 'explain'; ui.outcome = null
  const html = await render(CARD), words = text(html)
  assert.match(html, /data-residence-explain/)
  assert.ok(words.includes('Your device checks, on your device, whether you are in Ikeja.'))
  assert.ok(words.includes('Your position is never sent or stored — only whether it matched.'))
  assert.match(html, /data-residence-check[^>]*>(?:<!--.*?-->)*Check now/)
  assert.ok(words.includes('Not now'))
  ui.step = 'checking'
  const busy = await render(CARD)
  assert.match(busy, /disabled[^>]*data-residence-check/)
  assert.ok(text(busy).includes('Checking…'))
})

test('each way a check can end is said kindly, and a refusal explains how to allow location', async () => {
  home(false); ui.step = 'rest'
  const expected: [CheckOutcome, string][] = [
    ['outside', 'Your device places you outside Ikeja right now. You can try again when you are home.'],
    ['inaccurate', 'could only tell roughly where it is'],
    ['denied', 'Location is switched off for this site, so nothing was checked.'],
    ['unavailable', 'could not work out where it is just now'],
    ['timeout', 'took too long'],
    ['insecure', 'secure (https) pages'],
    ['unsupported', 'cannot share a location'],
    ['no_boundary', 'boundaries for this city are not available'],
  ]
  for (const [outcome, words] of expected) {
    ui.outcome = outcome
    const html = await render(CARD)
    assert.ok(text(html).includes(words), outcome)
    assert.equal(html.includes('data-residence-help'), outcome === 'denied', `${outcome}: help only for a refusal`)
    assert.match(html, /data-residence-start/, `${outcome}: the player can try again`)
  }
  ui.outcome = null
})

test('confirmed: the badge, until when, the switch that turns it off, and a way to check again', async () => {
  home(true); ui.step = 'rest'; ui.outcome = null
  const html = await render(CARD), words = text(html)
  assert.match(html, /checked[^>]*data-residence-switch/)
  assert.ok(words.includes('Show my location-confirmed badge'))
  assert.ok(words.includes('Lives in Ikeja · confirmed by your device'))
  assert.ok(words.includes('Nobody sees where you are'))
  assert.match(words, /lasts until \d+ \w+ 2026 \(90 days\)/i)
  assert.match(html, /data-residence-again/)
  assert.ok(!html.includes('data-residence-start'))
  home(false)
})

test('a card for a life with no home anywhere draws nothing', async () => {
  const state = app.game.state.value
  app.game.state.value = { ...state, estate: { ...state.estate, home: null, lga: null } }
  try { assert.equal(text(await render(CARD)), '') } finally { home(false) }
})

test('the tag: the local government with the honest wording, nothing without one; wording in the tooltip', async () => {
  cache['pub-ada'] = { lga: 'ikeja', name: 'Ikeja' }
  cache['pub-none'] = null
  const named = await render(BADGE, { id: 'pub-ada' })
  assert.match(named, /data-resident-badge/)
  assert.match(named, /aria-label="Lives in Ikeja · confirmed by their device"/)
  assert.match(named, /title="Lives in Ikeja · confirmed by their device"/)
  assert.equal(text(named), 'Ikeja')
  assert.equal(text(await render(BADGE, { id: 'pub-none' })), '')
  assert.equal(text(await render(BADGE, { id: 'pub-unasked' })), '')
  assert.equal(text(await render(BADGE, { id: 'pub-ada', long: true })), 'Lives in Ikeja · confirmed by their device')
  for (const html of [named]) assert.ok(!/verified|nearby|distance|last seen/i.test(html))
})

test('the own tag follows the life at once: on while a confirmation stands, gone the moment it is off', async () => {
  const id = app.game.session.value?.id ?? ''
  assert.ok(id)
  home(true)
  assert.equal(text(await render(BADGE, { id })), 'Ikeja')
  assert.match(await render(BADGE, { id }), /aria-label="Lives in Ikeja · confirmed by your device"/)
  home(false)
  assert.equal(text(await render(BADGE, { id })), '')
})
