// The shop's face as a buyer reads it: the single-file components are compiled by the project's own Vite configuration and rendered
// to a string with a fixed clock. The sign, the open or closed words, the price list, the week with today marked, the cover and
// the captions. What a press does is the server's (server/showcase.test.ts).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ShopFace } from './showcaseModel.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
let vite: ViteDevServer
const load = async (path: string): Promise<Component> => (await vite.ssrLoadModule(path) as { default: Component }).default
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
const render = async (path: string, props: Record<string, unknown>): Promise<string> => renderToString(createSSRApp({ render: () => h(await_(path), props) }))
const parts = new Map<string, Component>()
const await_ = (path: string): Component => { const found = parts.get(path); if (!found) throw new Error(`${path} is not loaded`); return found }

const week = Array.from({ length: 7 }, (_, at) => (at < 5 ? { open: '09:00', close: '18:00' } : null))
const face = (patch: Partial<ShopFace> = {}): ShopFace => ({
  name: 'Ada Braids', sign: 'Braids by Ada', template: 'classic', colours: ['#b4541a', '#fff4e6'], logo: 'scissors', category: 'salon', city: 'lagos', venue: 'market', slot: 4,
  about: 'Neat knotless braids since 2019.\nAsk for the Ada stall.', hours: week, photos: [{ id: 'p1', w: 800, h: 600, caption: 'Knotless braids, done' }, { id: 'p2', w: 800, h: 600 }, { id: 'p3', w: 800, h: 600 }],
  serviceList: [{ label: 'Knotless braids', priceNaira: 25000, note: 'About four hours' }, { label: 'Wash', priceNaira: 0, note: '' }], pay: true,
  badge: { id: 'x', name: 'Ada', tier: 'phone', label: 'Phone checked', complaints: 0, held: false }, payNotice: null, ...patch,
})
// Monday 12 October 2026, 11:00 in Lagos.
const NOW = new Date('2026-10-12T10:00:00Z')

before(async () => {
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  await vite.ssrLoadModule('/src/game/cities/registry.ts').then((registry) => (registry as typeof import('../../../game/cities/registry.ts')).loadCityContent('lagos'))
  for (const name of ['ShopFront', 'StorefrontCard']) parts.set(name, await load(`/src/app/features/showcase/${name}.vue`))
})
after(async () => { await vite?.close() })

test('the shop front: sign, place, open now and the badge on top; the cover large with the seller\'s caption as its alt text', async () => {
  const html = await render('ShopFront', { shop: face(), now: NOW })
  const words = text(html)
  assert.ok(words.includes('Braids by Ada') && words.includes('Ada Braids') && words.includes('Hair and salon') && words.includes('Stall 4'), words.slice(0, 300))
  assert.ok(words.includes('Open now · closes at 18:00') && words.includes('Phone checked'), 'open now and the badge')
  assert.match(html, /alt="Knotless braids, done"/)
  assert.match(html, /alt="Ada Braids, photo 2 of 3"/, 'no caption: the shop and the place in the row')
  assert.match(html, /class="pg-cover"/); assert.match(html, /aria-label="More photos, swipe sideways"/)
})

test('the price list: label, note and price on one row, the price the seller\'s own, and the explanation once', async () => {
  const html = await render('ShopFront', { shop: face(), now: NOW })
  const words = text(html)
  assert.ok(words.includes('Knotless braids About four hours ₦25,000') && words.includes('Wash Ask the seller'), words)
  assert.equal(words.split('Seller’s price, paid outside Allworld').length - 1, 1, 'said once')
  assert.match(html, /<span class="shf-note"[^>]*>About four hours<\/span>/, 'the note is its own line, not run into the label')
})

test('the week: today is marked, closed days say so, and a shop that is shut says when it opens', async () => {
  const open = await render('ShopFront', { shop: face(), now: NOW })
  assert.match(open, /<li class="is-today" aria-current="date"[^>]*><span[^>]*>Mon<\/span>/)
  assert.ok(text(open).includes('Sat Closed') && text(open).includes('Sun Closed'))
  const shut = text(await render('ShopFront', { shop: face(), now: new Date('2026-10-17T10:00:00Z') }))
  assert.ok(shut.includes('Closed · opens Monday at 09:00'), 'Saturday')
  const late = text(await render('ShopFront', { shop: face(), now: new Date('2026-10-12T19:30:00Z') }))
  assert.ok(late.includes('Closed · opens tomorrow at 09:00'), 'Monday evening')
})

test('a directory card is a small shopfront: sign, name, kind and place, open or closed, badge, cover and the from-price with its label', async () => {
  const html = await render('StorefrontCard', { shop: { ...face(), cover: 'p1', from: 25000 }, now: NOW })
  const words = text(html)
  assert.ok(words.includes('Braids by Ada') && words.includes('Hair and salon') && words.includes('Open now') && words.includes('Phone checked') && words.includes('From ₦25,000 Seller’s price, paid outside Allworld'), words)
  assert.match(html, /<img class="sf-cover"[^>]*src="\/api\/showcase\/photo\/p1"/)
  assert.match(html, /<h3 class="sf-name"[^>]*>Ada Braids<\/h3>/, 'a card is a third-level heading, the page header a second-level one')
  const header = await render('StorefrontCard', { shop: face(), size: 'header', now: NOW })
  assert.match(header, /<h2 class="sf-name"/)
})
