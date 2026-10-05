// Component tests for the world panels, in the approach of src/app/components.test.ts: each
// component is compiled by the project's Vite configuration and rendered to a string against the
// real store connected to a fake server. What is asserted is what the player reads and can press.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h, nextTick } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

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
const settle = async (): Promise<void> => { await new Promise((resolve) => setImmediate(resolve)); await nextTick() }

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the card: a life without a place picks from the list; the control is the kit\'s combobox, every button says what it does', async () => {
  const estate = app.game.view.value.estate
  const html = await render('/src/app/features/world/LgaCard.vue', { heading: 'Live here?' })
  const words = text(html)
  assert.match(html, /<section class="ui-panel" data-lga-card/)
  assert.ok(words.startsWith('Live here?'))
  if (estate.placed) assert.ok(words.includes(estate.lga?.name ?? ''), 'the home is named')
  else {
    assert.match(html, /<button[^>]*role="combobox"[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"[^>]*aria-label="Local government"/)
    assert.ok(words.includes(`Choose from the ${estate.lgas.length} local governments of ${estate.cityName}`))
    assert.match(html, /<button[^>]*class="ui-button is-primary is-block"[^>]*>(?:<!--.*?-->)*This is my local government/)
    assert.ok(words.includes('Find it for me') && words.includes('Your position is never sent or stored'))
  }
})

test('the card: a life with a home shows it, with Change and Find first and the cooldown in words', async () => {
  const before = app.game.state.value
  app.game.state.value = { ...before, estate: { ...before.estate, lga: 'ikeja', lgaConfirmed: true } }
  try {
    const estate = app.game.view.value.estate
    assert.equal(estate.placed, true)
    const html = await render('/src/app/features/world/LgaCard.vue')
    const words = text(html)
    assert.ok(words.startsWith('Where you live'))
    assert.ok(words.includes(estate.lga?.name ?? 'Ikeja') && words.includes('Change') && words.includes('Find my local government'))
    assert.ok(words.includes(`You can change once every ${estate.change.cooldownDays} days. Your house moves with you.`) || Boolean(estate.change.blocked))
    assert.ok(!html.includes('role="combobox"'), 'the list opens only on Change')
  } finally { app.game.state.value = before }
})

test('the page of a local government: counts first as a skeleton, then residents as text, never markup', async () => {
  const requests: string[] = []
  server.route('GET /api/world/lga/ikeja', () => { requests.push('lga'); return { status: 200, body: { ok: true, id: 'ikeja', residents: 1234, houses: 900, online: 7, capacity: 5, rev: 1, yours: false } } })
  server.route('GET /api/world/lga/ikeja/people', () => ({ status: 200, body: { ok: true, items: [{ id: 'p1', name: '<b>Ada</b>', home: 'own', estate: 3, plot: 17, online: true, you: false }, { id: 'p2', name: 'Me', home: 'own', online: false, you: true }], next: 25 } }))
  const path = '/src/app/features/world/WorldLgaPanel.vue'
  const first = await render(path, { params: { lga: 'ikeja' } })
  assert.match(first, /aria-label="Loading the counts"/)
  assert.match(first, /aria-label="Loading residents"/)
  assert.ok(text(first).includes('Lagos · local government') || text(first).includes('local government'))
  await settle(); await settle()
  const html = await render(path, { params: { lga: 'ikeja' } })
  const words = text(html)
  assert.ok(words.includes('1,234 residents') && words.includes('900 houses') && words.includes('7 online now'))
  assert.ok(html.includes('&lt;b&gt;Ada&lt;/b&gt;') && !html.includes('<b>Ada</b>'), 'a name is escaped text')
  assert.ok(words.includes('Plot 4, Street 2, Estate 4, Ikeja'))
  assert.match(html, /aria-label="Say hi to &lt;b&gt;Ada&lt;\/b&gt;"/)
  assert.ok(words.includes('Me (you)') && !words.includes('Say hi to Me'), 'you cannot say hi to yourself')
  assert.match(html, /<button[^>]*class="ui-button is-block"[^>]*>(?:<!--.*?-->)*Show more/)
  assert.match(html, /<input name="q" type="search" maxlength="24"[^>]*aria-label="Search residents by name"/)
  assert.match(html, /aria-pressed="false"[^>]*>(?:<!--.*?-->)*Online now only/)
  assert.ok(words.includes('Players who hide themselves from the directory are not listed here'))
  assert.equal(requests.length, 1, 'the counts are read once')
})

test('the page of a local government: an id the city does not have', async () => {
  assert.equal(text(await render('/src/app/features/world/WorldLgaPanel.vue', { params: { lga: 'atlantis' } })), 'That local government is not on this map.')
  assert.equal(text(await render('/src/app/features/world/WorldLgaPanel.vue')), 'That local government is not on this map.')
})

test('the house card: a neighbour with a name, one without, your own, and a house that is not on the map', async () => {
  const path = '/src/app/features/world/HouseCard.vue'
  const base = { lga: 'ikeja', estate: 3, plot: 17, style: 0, upgrading: false }
  const owner = await render(path, { params: { house: { ...base, id: 'u1', name: 'Tolu', online: true, you: false } } })
  assert.match(owner, /role="img" aria-label="Starter house"/)
  assert.ok(text(owner).includes('Starter house · Plot 4, Street 2, Estate 4, Ikeja') && text(owner).includes('Tolu Online now'))
  assert.match(owner, /<button[^>]*class="ui-button is-primary is-block"[^>]*>(?:<!--.*?-->)*Open their card · chat, add friend, knock/)
  assert.ok(text(owner).includes('About Ikeja'))
  const hidden = text(await render(path, { params: { house: { ...base, id: null, name: null } } }))
  assert.ok(hidden.includes('A neighbour This player is not listed in the directory, so their name is not shown.') && !hidden.includes('Open their card'))
  const mine = text(await render(path, { params: { house: { ...base, you: true, upgrading: true } } }))
  assert.ok(mine.includes('Your house This is where you live.') && mine.includes('· being upgraded') && mine.includes('Style or upgrade it'))
  const upgrading = await render(path, { params: { house: { ...base, upgrading: true } } })
  assert.match(upgrading, /aria-label="Starter house, being upgraded"/)
  assert.equal(text(await render(path, { params: { house: { ...base, lga: 'atlantis' } } })), 'That house is not on this map.')
  assert.equal(text(await render(path, { params: {} })), 'That house is not on this map.')
})
