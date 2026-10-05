// Component tests of the Business app, the way the civic screens are tested (civicComponents.test.ts): the single-file
// component is compiled by the project's own Vite configuration and rendered to a string against the real store and a
// fake server, with the cache of server answers filled first. What a press does is the server's (server/business.test.ts).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { MyBusinessResponse, MyShop, ShopCard, VenueShopsResponse } from '../../../types/business.ts'
import type { App } from '../../state/app.ts'
import type { Civic } from '../civic/civicCore.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let cache: Civic
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
async function render(props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load('/src/app/features/business/BusinessApp.vue')).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}
const buttonTag = (html: string, label: string): string => {
  const hit = [...html.matchAll(/<button\b[^>]*>.*?<\/button>/gs)].map((match) => match[0]).find((tag) => text(tag).includes(label))
  assert.ok(hit, `no button "${label}"`)
  return hit
}

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  cache = (await load<{ useCivic: () => Civic }>('/src/app/features/civic/useCivic.ts')).useCivic()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

const limits = { perShop: 5000, itemsPerShop: 6, perDay: 8000, countPerDay: 8, qtyMax: 3, bag: 24, bandMin: 0.7, bandMax: 1.4, name: { min: 3, max: 24 } }
const jollof = { id: 'jollof', label: 'Jollof rice & chicken', icon: '🍛', base: 600, cost: 360, local: false, min: 420, max: 840, does: '+45 hunger · +6 fun', trade: false }
const card = (patch: Partial<ShopCard> = {}): ShopCard => ({ id: 'owner-1', name: 'Mama <b>Put</b>', type: 'food', typeLabel: 'Food stall', colour: 'gold', icon: '🍲', owner: { id: 'owner-1', name: 'Ada' }, status: 'open', stars: 4.2, ratings: 3,
  items: [{ id: 'jollof', label: 'Jollof rice & chicken', icon: '🍛', price: 650, stock: 4, does: '+45 hunger · +6 fun' }, { id: 'puff-puff', label: 'Puff-puff', icon: '🍩', price: 200, stock: 0, does: '+15 hunger' }], mine: false, blocked: false, canRate: true, ...patch })
const mine = (patch: Partial<MyShop> = {}): MyShop => ({ ...card({ mine: true, canRate: false, name: 'Mama Put' }), city: 'lagos', cityName: 'Lagos', venue: 'market', venueName: 'Market', here: false, till: 4200, tillCap: 50000, sold: 9, capacity: 30, units: 12,
  rent: 7000, paidUntil: server.now() + 5 * 86400000, owed: 0, closesAt: null, customers: 34, today: { takings: 4200, sold: 9, came: 11 }, total: { sold: 9, takings: 4200, rent: 0 },
  upgrades: [{ id: 'display', label: 'Better display', cost: 15000, effect: 'Draws 10% more customers.', owned: false }], products: [{ ...jollof, price: 650, stock: 12 }], closeRefund: 11700, alert: '', ...patch })
const market = (patch: Partial<VenueShopsResponse> = {}): VenueShopsResponse => ({ city: 'lagos', venue: 'home', hosts: true, venueName: 'Market', stalls: { total: 16, taken: 1 }, known: ['fabric'], hours: { open: 6, close: 20 },
  types: [{ id: 'food', label: 'Food stall', icon: '🍲', icons: ['🍲', '🍛'], setup: 15000, rent: 7000, customers: 35, capacity: 30, known: false, products: [jollof] }],
  shops: [card()], mine: null, bag: [], wholesale: [], limits, openWhy: '', colours: [{ id: 'gold', label: 'Gold', bg: '#e8a643', ink: '#20232c' }], ...patch })
const keys = () => { const city = app.game.view.value.cityId; return { mine: `business:mine:${city}`, venue: `business:venue:${city}:${app.game.state.value.location}` } }

test('my business: a skeleton until the answer is here; with no shop, what a business is and where to rent one', async () => {
  assert.match(await render(), /role="status" aria-label="Loading"/)
  cache.put<MyBusinessResponse>(keys().mine, { city: 'lagos', mine: null, bag: [], limits })
  const none = text(await render())
  assert.ok(none.includes('You do not run a business yet') && none.includes('Rent a stall at any market') && none.includes('Find a market on the Map'), none.slice(0, 200))
})

test('my business: the cash box, stock with its price range, rent, upgrades and closing — and away from the stall, why restocking is off', async () => {
  cache.put<MyBusinessResponse>(keys().mine, { city: 'lagos', mine: mine({ alert: 'The cash box is full, so passers-by cannot buy. Collect your takings.' }), bag: [{ id: 'adire', label: 'Adire cloth', icon: '👗', n: 6 }], limits })
  const html = await render(), words = text(html)
  for (const part of ['Food stall · Market, Lagos', 'Mama Put', '4.2 · about 34 customers a day', 'Cash box ₦4,200', 'Today ₦4,200 · 9 sold · 11 came', '12 of 30 on the shelves', 'You are away from your stall',
    'Jollof rice & chicken 12 in stock · costs ₦360', 'Goods you carry', 'Adire cloth 6', '₦7,000 a week Paid for 4 days', 'Better display Draws 10% more customers.', '₦11,700 back', 'How businesses work']) assert.ok(words.includes(part), `${part} — in: ${words.slice(0, 900)}`)
  assert.match(html, /role="alert"[^>]*>The cash box is full/)
  assert.match(html, /aria-label="4\.2 stars · 3 ratings"/)
  assert.match(html, /<input[^>]*type="number"[^>]*min="420"[^>]*max="840"[^>]*disabled/)
  assert.match(buttonTag(html, 'Buy stock'), /disabled/)
  assert.ok(words.includes('Go to Market in Lagos to restock.'))
  assert.doesNotMatch(buttonTag(html, 'Collect'), /disabled/)
  // Overdue rent: the box is kept for it, and the screen says when the market would close the stall.
  cache.put<MyBusinessResponse>(keys().mine, { city: 'lagos', mine: mine({ owed: 7000, closesAt: server.now() + 50 * 3600000 }), bag: [], limits })
  const late = text(await render())
  assert.ok(late.includes('₦7,000 overdue') && late.includes('The market closes the stall in 2 days') && late.includes('Takings go to the overdue rent (₦7,000) first.'), late.slice(0, 600))
})

test('this market: other players’ stalls with Buy, Rate and Chat, a sold-out item says so, a name is text, and the form to open one', async () => {
  cache.put<VenueShopsResponse>(keys().venue, market())
  const html = await render({ params: { venue: 'market' } }), words = text(html)
  for (const part of ['Market · 1 of 16 stalls taken · trading 6:00–20:00', 'Shops here', 'Food stall · Ada', 'Jollof rice & chicken +45 hunger · +6 fun · 4 left', 'Buy · ₦650', 'Puff-puff +15 hunger · sold out', 'Sold out.', 'Rate your purchase',
    'Chat', 'Report this stall', 'Open a stall here', '₦15,000 to open, with the first week’s rent paid. Then ₦7,000 a week.', 'costs ₦360 sells ₦420–₦840', 'Open a stall here · ₦15,000']) assert.ok(words.includes(part), `${part} — in: ${words.slice(0, 1200)}`)
  assert.ok(html.includes('Mama &lt;b&gt;Put&lt;/b&gt;') && !html.includes('<b>Put</b>'), 'a stall’s name is never markup')
  assert.equal([...html.matchAll(/aria-label="[1-5] stars?"/g)].length, 5)
  assert.match(buttonTag(html, 'Open a stall here · ₦15,000'), /disabled/)
  assert.ok(words.includes('Name your stall (at least 3 characters).'))
  // A block either way: no Buy and no Chat. A place that rents no stalls says so.
  cache.put<VenueShopsResponse>(keys().venue, market({ shops: [card({ blocked: true, canRate: false })] }))
  const blocked = await render({ params: { venue: 'market' } })
  assert.ok(text(blocked).includes('You cannot buy from this stall.') && !/<button\b[^>]*>\s*Chat\s*<\/button>/.test(blocked))
  cache.put<VenueShopsResponse>(keys().venue, market({ hosts: false, shops: [], types: [], venueName: 'Home' }))
  assert.ok(text(await render({ params: { venue: 'home' } })).includes('No stalls here Home rents no stalls. Every city has a market that does.'))
})
