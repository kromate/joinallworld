// The Business app: what its model says for every state of a shop and a buyer, that the app is registered as a lazy
// Phone panel, and that nothing of the feature's rules or catalogue is reachable from the page (it would be part of the
// first download: vite.config.ts puts src/game/** in the engine chunk).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { MyShop, ShopCard, VenueShopsResponse } from '../../../types/business.ts'
import { business, BUSINESS_PANELS } from './register.ts'
import { sharedStore } from '../civic/civicCore.ts'
import { NATIVE_PANELS } from '../panels.ts'
import { buyWhy, businessBadge, changedPrices, collectWhy, mineKey, minePath, openWhy, orderOf, orderWhy, priceWords, pricesWhy, starMarks, starsLabel, untilWords, venueKey, venuePath } from './businessModel.ts'

const product = (id: string, patch: object = {}) => ({ id, label: id, icon: '🍛', base: 600, cost: 360, local: false, min: 420, max: 840, does: '+45 hunger', trade: false, price: 600, stock: 4, ...patch })
const shop = (patch: Partial<MyShop> = {}): MyShop => ({
  id: 'o', name: 'Mama Put', type: 'food', typeLabel: 'Food stall', colour: 'gold', icon: '🍲', owner: { id: 'o', name: 'Ada' }, status: 'open', stars: 3, ratings: 0, items: [], mine: true, blocked: false, canRate: false,
  city: 'lagos', cityName: 'Lagos', venue: 'market', venueName: 'Market', here: true, till: 0, tillCap: 50000, sold: 0, capacity: 30, units: 8, rent: 7000, paidUntil: 0, owed: 0, closesAt: null, customers: 34,
  today: { takings: 0, sold: 0, came: 0 }, total: { sold: 0, takings: 0, rent: 0 }, upgrades: [], products: [product('jollof'), product('puff-puff', { cost: 120, min: 140, max: 280, price: 200, base: 200 })], closeRefund: 7500, alert: '', ...patch,
})
const card = (patch: Partial<ShopCard> = {}): ShopCard => ({ id: 'o', name: 'Mama Put', type: 'food', typeLabel: 'Food stall', colour: 'gold', icon: '🍲', owner: { id: 'o', name: 'Ada' }, status: 'open', stars: 4.2, ratings: 3, items: [], mine: false, blocked: false, canRate: false, ...patch })
const wallet = { cash: 5000, canSpend: 8000, buyWhy: '', offline: null }

test('keys and paths, stars and time left', () => {
  assert.deepEqual([venueKey('lagos', 'market'), venuePath('lagos', 'bodija market'), mineKey('kano'), minePath('kano')], ['business:venue:lagos:market', '/api/business/venue?city=lagos&venue=bodija%20market', 'business:mine:kano', '/api/business/mine?city=kano'])
  assert.deepEqual([starMarks(1), starMarks(3.4), starMarks(4.5), starMarks(5)], ['★☆☆☆☆', '★★★☆☆', '★★★★★', '★★★★★'])
  assert.deepEqual([starsLabel(3, 0), starsLabel(4.25, 1), starsLabel(5, 12)], ['3.0 stars · no ratings yet', '4.3 stars · 1 rating', '5.0 stars · 12 ratings'])
  const hour = 3600000
  assert.deepEqual([untilWords(0, 5), untilWords(30 * 60000, 0), untilWords(5 * hour, 0), untilWords(47 * hour, 0), untilWords(6 * 24 * hour + 5, 0)], ['now', 'under an hour', '5 h', '47 h', '6 days'])
  // The first week's rent is paid at the moment the stall opens: the line under it must not say a day is gone already.
  assert.equal(untilWords(7 * 24 * hour, 3000), '7 days')
  assert.equal(untilWords(7 * 24 * hour + 60000, 0), '7 days')
  assert.equal(untilWords(6 * 24 * hour + 13 * hour, 0), '7 days'); assert.equal(untilWords(6 * 24 * hour + 5 * hour, 0), '6 days')
})

test('an order from the supplier: its bill, and the one reason it cannot be bought', () => {
  const mine = shop()
  assert.deepEqual(orderOf(mine, { jollof: 5, 'puff-puff': 10, adire: 9, x: -4 }), { units: 15, cost: 5 * 360 + 10 * 120 })
  assert.equal(orderWhy(mine, {}, 9999, null), 'Choose how many of each to buy.')
  assert.equal(orderWhy(mine, { jollof: 5 }, 9999, null), '')
  assert.equal(orderWhy(mine, { jollof: 25 }, 99999, null), 'Your stall has room for 22 more.')
  assert.equal(orderWhy(shop({ units: 30 }), { jollof: 5 }, 9999, null), 'Your stall is full.')
  assert.equal(orderWhy(mine, { jollof: 5 }, 1000, null), 'You need ₦1,800; you have ₦1,000.')
  assert.equal(orderWhy(shop({ here: false }), { jollof: 5 }, 9999, null), 'Go to Market in Lagos to restock.')
  assert.equal(orderWhy(shop({ status: 'closed' }), { jollof: 5 }, 9999, null), 'This stall has closed.')
  assert.equal(orderWhy(mine, { jollof: 5 }, 9999, 'You are offline.'), 'You are offline.')
})

test('prices: only what changed is sent, inside the range, from behind the counter', () => {
  const mine = shop()
  assert.deepEqual(changedPrices(mine, { jollof: 600, 'puff-puff': 220, adire: 5 }), { 'puff-puff': 220 })
  assert.equal(pricesWhy(mine, { jollof: 600 }, null), 'Change a price first.')
  assert.equal(pricesWhy(mine, { jollof: 700 }, null), '')
  assert.equal(pricesWhy(mine, { jollof: 900 }, null), 'jollof: ₦420 to ₦840.')
  assert.equal(pricesWhy(mine, { jollof: 600.5 }, null), 'jollof: ₦420 to ₦840.')
  assert.equal(pricesWhy(shop({ here: false }), { jollof: 700 }, null), 'Go to Market in Lagos to change prices.')
  assert.deepEqual([420, 600, 660, 840].map((price) => priceWords(price, 600)), ['cheap: more will buy', 'fair', 'a little dear', 'dear: few will buy'])
})

test('collecting and buying: each control off for one stated reason', () => {
  assert.equal(collectWhy(shop({ till: 0 }), null), 'The cash box is empty.')
  assert.equal(collectWhy(shop({ till: 900 }), null), '')
  assert.equal(collectWhy(shop({ till: 900, owed: 7000 }), null), 'Takings go to the overdue rent (₦7,000) first.')
  assert.equal(collectWhy(shop({ till: 0, status: 'closed' }), null), '')
  const item = { price: 600, stock: 2 }
  assert.equal(buyWhy(card(), item, wallet), '')
  assert.equal(buyWhy(card({ mine: true }), item, wallet), 'Your own stall.')
  assert.equal(buyWhy(card({ blocked: true }), item, wallet), 'You cannot buy from this stall.')
  assert.equal(buyWhy(card(), { price: 600, stock: 0 }, wallet), 'Sold out.')
  assert.equal(buyWhy(card(), item, { ...wallet, buyWhy: 'Earn at least ₦1,000 from paid work first.' }), 'Earn at least ₦1,000 from paid work first.')
  assert.equal(buyWhy(card(), item, { ...wallet, cash: 100 }), 'You need ₦600.')
  assert.equal(buyWhy(card(), item, { ...wallet, canSpend: 500 }), 'You can spend ₦500 more at players’ stalls today.')
  assert.equal(buyWhy(card(), item, { ...wallet, offline: 'No connection.' }), 'No connection.')
})

test('opening: the market’s own reason first, then the name, then the money', () => {
  const market = { openWhy: '', limits: { name: { min: 3, max: 24 } } } as Pick<VenueShopsResponse, 'openWhy' | 'limits'>
  const food = { setup: 15000 }
  assert.equal(openWhy(market, food, 'Mama Put', 20000, null), '')
  assert.equal(openWhy({ ...market, openWhy: 'Every stall at Market is taken.' }, food, 'Mama Put', 20000, null), 'Every stall at Market is taken.')
  assert.equal(openWhy(market, undefined, 'Mama Put', 20000, null), 'Choose what to sell.')
  assert.equal(openWhy(market, food, '  ab ', 20000, null), 'Name your stall (at least 3 characters).')
  assert.equal(openWhy(market, food, 'x'.repeat(25), 20000, null), 'The name can be 24 characters at most.')
  assert.equal(openWhy(market, food, 'Mama Put', 9000, null), 'Opening costs ₦15,000; you have ₦9,000.')
})

test('the app is a lazy Phone panel in the money group, with a badge only when the stall needs its owner', () => {
  assert.deepEqual(BUSINESS_PANELS.map((panel) => [panel.id, panel.placement, panel.group, panel.title]), [['business', 'phone', 'money', 'Business']])
  assert.ok(NATIVE_PANELS.includes(business))
  assert.equal(new Set(NATIVE_PANELS.map((panel) => panel.id)).size, NATIVE_PANELS.length)
  assert.deepEqual([businessBadge(null), businessBadge(shop()), businessBadge(shop({ alert: 'Nothing in stock.' }))], [0, 0, 1])
  const view = { cityId: 'lagos' } as Parameters<NonNullable<typeof business.badge>>[1], state = {} as Parameters<NonNullable<typeof business.badge>>[0]
  assert.equal(business.badge?.(state, view), 0, 'nothing loaded: no badge and no request')
  sharedStore.cache.set(mineKey('lagos'), { data: { mine: shop({ alert: 'Nothing in stock.' }) }, at: 1, path: '', loading: false, error: null })
  assert.equal(business.badge?.(state, view), 1)
  sharedStore.cache.delete(mineKey('lagos'))
})

test('the page never imports the shop rules or the catalogue: the routes answer with what a screen needs', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const files: string[] = []
  const walk = (dir: string): void => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path) } }
  for (const dir of ['app', 'ui', 'scene', 'map3d']) walk(join(root, dir))
  walk(join(root, 'game', 'systems'))
  assert.ok(files.length > 200)
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /from '[^']*(business-model|content\/business)\.ts'/, `${file} must not import the shop rules or catalogue`)
  // The app itself is reached only through the lazy registration.
  const entry = readFileSync(join(root, 'app', 'features', 'business', 'register.ts'), 'utf8')
  assert.match(entry, /defineAsyncComponent\(\(\) => import\('\.\/BusinessApp\.vue'\)\)/)
  assert.doesNotMatch(entry, /businessModel|BusinessApp\.vue'\n?import/)
})

test('opening a stall says it once: the game\'s own line is the toast, and the request adds none', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const app = readFileSync(join(root, 'app', 'features', 'business', 'BusinessApp.vue'), 'utf8')
  const call = app.match(/paid\('open', 'open'[^\n]*/)?.[0] ?? ''
  assert.ok(call, 'the open request is there')
  assert.match(call, /, ''\)$/, 'no success toast is passed for an opening')
  const rules = readFileSync(join(root, 'game', 'systems', 'business.ts'), 'utf8')
  assert.match(rules, /state\.message = `\$\{name\} is open\./, 'the game names the stall in its own line')
})
