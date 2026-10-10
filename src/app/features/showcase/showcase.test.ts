// The Services app: what its model says for every state of a shop, the editor's draft and checks, the words for every refusal,
// that the app is registered as a lazy Phone panel and reachable from a market, that nothing of it is in src/game, and that no
// provider is named in what a player reads (the leaving sheet is the one place a destination is named, and it is not here).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { SHOWCASE, SHOWCASE_CATEGORIES, SHOWCASE_ICONS, SHOWCASE_TEMPLATES } from '../../../types/showcase.ts'
import type { ShowcaseMine } from '../../../types/showcase.ts'
import { SHOWCASE_PANELS, showcase } from './register.ts'
import { NATIVE_PANELS } from '../panels.ts'
import { CATEGORY_LABELS, CODE_WORDS, ICON_GLYPHS, TEMPLATES, WEEKDAYS, directoryPath, draftIssues, draftOf, emptyDraft, hoursLines, inkFor, inputOf, photoUrl, sellerPrice, shopPath, statusWords, wordsFor } from './showcaseModel.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const source = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8')

const filled = () => {
  const draft = emptyDraft('market')
  Object.assign(draft, { name: 'Ada Braids', sign: 'Braids by Ada', about: 'Neat braids.', chat: 'https://wa.me/2348012345678' })
  draft.services = [{ label: 'Knotless braids', price: '25000', note: ' about four hours ' }, { label: '', price: '5', note: '' }, { label: 'Wash', price: '', note: '' }]
  return draft
}

test('every list the server validates has a label or a look here, so no choice is blank', () => {
  for (const id of SHOWCASE_CATEGORIES) assert.ok(CATEGORY_LABELS[id], id)
  for (const id of SHOWCASE_ICONS) assert.ok(ICON_GLYPHS[id].glyph && ICON_GLYPHS[id].label, id)
  for (const id of SHOWCASE_TEMPLATES) { assert.ok(TEMPLATES[id].label); assert.match(TEMPLATES[id].colours.join(), /^#[0-9a-f]{6},#[0-9a-f]{6}$/); assert.ok(ICON_GLYPHS[TEMPLATES[id].icon]) }
  assert.equal(WEEKDAYS.length, 7)
})

test('paths, prices, hours and ink', () => {
  assert.equal(directoryPath({}), '/api/showcase/directory')
  assert.equal(directoryPath({ city: 'lagos', venue: 'market', category: '', q: 'knotless braids', after: 'SC-9' }), '/api/showcase/directory?city=lagos&venue=market&q=knotless%20braids&after=SC-9')
  assert.deepEqual([shopPath('SC-12'), photoUrl('a b')], ['/api/showcase/SC-12', '/api/showcase/photo/a%20b'])
  assert.deepEqual([sellerPrice(25000), sellerPrice(0)], ['₦25,000', 'Ask the seller'])
  const lines = hoursLines([{ open: '09:00', close: '18:00' }, null])
  assert.deepEqual([lines[0], lines[1], lines[6]], [{ day: 'Monday', text: '09:00 to 18:00' }, { day: 'Tuesday', text: 'closed' }, { day: 'Sunday', text: 'closed' }])
  assert.deepEqual([inkFor('#000000'), inkFor('#ffffff'), inkFor('#1f3a5f'), inkFor('nonsense')], ['#ffffff', '#14181c', '#ffffff', '#ffffff'])
})

test('the draft becomes the body the server takes: trimmed, whole naira, empty services dropped, closed days null', () => {
  const draft = filled()
  assert.deepEqual(draftIssues(draft), [])
  const body = inputOf(draft, 'lagos')
  assert.deepEqual(body.services, [{ label: 'Knotless braids', priceNaira: 25000, note: 'about four hours' }, { label: 'Wash', priceNaira: 0, note: '' }])
  assert.deepEqual([body.city, body.venue, body.name, body.chat, body.pay, 'slot' in body], ['lagos', 'market', 'Ada Braids', { url: 'https://wa.me/2348012345678' }, null, false])
  assert.deepEqual(body.hours.map((day) => day !== null), [true, true, true, true, true, true, false])
  assert.deepEqual(body.hours[0], { open: '09:00', close: '18:00' })
  draft.slot = '7'; draft.pay = ' https://selar.co/ada '
  assert.deepEqual([inputOf(draft, 'lagos').slot, inputOf(draft, 'lagos').pay], [7, { url: 'https://selar.co/ada' }])
})

test('the editor says what is missing, in the order of the form', () => {
  assert.equal(draftIssues(emptyDraft('')).length, 6)
  const draft = filled()
  draft.name = 'Hi'; assert.match(draftIssues(draft)[0] ?? '', /name of 3 to 40/)
  draft.name = 'Ada Braids'; draft.venue = ''; assert.match(draftIssues(draft)[0] ?? '', /market/)
  draft.venue = 'market'; draft.services[0]!.price = '12.5'; assert.match(draftIssues(draft)[0] ?? '', /whole number of naira/)
  draft.services[0]!.price = '25000'; draft.hours[0]!.to = '08:00'; assert.match(draftIssues(draft)[0] ?? '', /Closing time/)
  draft.hours[0]!.to = '18:00'; draft.chat = ''; assert.match(draftIssues(draft)[0] ?? '', /chat/)
})

test('a saved shop fills the draft again', () => {
  const shop: NonNullable<ShowcaseMine['shop']> = {
    id: 'SC-1', owner: 'o', city: 'lagos', venue: 'market', slot: 4, name: 'Ada Braids', category: 'salon', template: 'bold', colours: ['#111111', '#eeeeee'], sign: 'Sign', logo: 'star', about: 'About', services: [{ label: 'Braids', priceNaira: 9000, note: 'n' }],
    hours: [{ open: '08:00', close: '12:00' }, null, null, null, null, null, null], chat: { kind: 'whatsapp', url: 'https://wa.me/1' }, pay: null, photos: [], status: 'draft', revision: 2, createdAt: 1, updatedAt: 1,
  }
  const draft = draftOf(shop)
  assert.deepEqual([draft.slot, draft.name, draft.template, draft.services, draft.hours[0], draft.hours[1]?.open, draft.chat, draft.pay], ['4', 'Ada Braids', 'bold', [{ label: 'Braids', price: '9000', note: 'n' }], { open: true, from: '08:00', to: '12:00' }, false, 'https://wa.me/1', ''])
  assert.deepEqual(inputOf(draft, 'lagos').services, shop.services)
})

test('every state has words, and every refusal a sentence', () => {
  for (const status of ['draft', 'review', 'live', 'hidden', 'held'] as const) assert.ok(statusWords(status, 3).length > 10, status)
  assert.match(statusWords('draft', 1), /at least 3 photos/); assert.match(statusWords('draft', 3), /review/)
  assert.match(statusWords('held', 3, 'checking a complaint'), /checking a complaint/)
  for (const code of ['account_required', 'adult_self_declaration_required', 'verification_required', 'account_too_new', 'chat_link_not_allowed', 'pay_link_not_allowed', 'contact_not_allowed', 'links_not_allowed', 'slot_taken', 'go_limit', 'upload_limit']) assert.ok(CODE_WORDS[code], code)
  assert.equal(wordsFor('slot_taken', 'x'), CODE_WORDS.slot_taken); assert.equal(wordsFor('mystery', 'The server said so.'), 'The server said so.'); assert.equal(wordsFor(undefined, 'plain'), 'plain')
  assert.deepEqual([SHOWCASE.photosMin, SHOWCASE.photosMax, SHOWCASE.photoBytes], [3, 6, 150000])
})

test('the app is a lazy Phone panel, opened from a market, and none of it is in src/game', () => {
  assert.ok(NATIVE_PANELS.includes(showcase) && SHOWCASE_PANELS.includes(showcase))
  assert.equal(new Set(NATIVE_PANELS.map((panel) => panel.id)).size, NATIVE_PANELS.length)
  assert.deepEqual([showcase.id, showcase.placement, showcase.live], ['showcase', 'phone', false])
  assert.match(source('app', 'state', 'panelBodies.ts'), /'showcase\/ShowcaseApp': \(\) => import\('\.\.\/features\/showcase\/ShowcaseApp\.vue'\)/)
  const venue = source('app', 'features', 'venue', 'VenuePanel.vue')
  assert.match(venue, /v-if="market"[^\n]*shell\.open\('showcase', \{ venue: venue\.id \}\)[^\n]*Services here/)
  assert.match(venue, /Shops here/)
  // The engine chunk (src/game/**) is in the first download: no showcase code is there, and the app never reaches into shop rules.
  for (const file of ['ShowcaseApp.vue', 'ShopPage.vue', 'ShopEditor.vue', 'StorefrontCard.vue', 'showcaseModel.ts']) assert.doesNotMatch(source('app', 'features', 'showcase', file), /game\/(business-model|content\/business)\.ts/, file)
})

test('what a player reads names no provider and no company, shows no link, and labels every price', () => {
  // Comments are for the people who read the code; what is left is what the page can say.
  const words = ['ShowcaseApp.vue', 'ShopPage.vue', 'ShopEditor.vue', 'StorefrontCard.vue', 'showcaseModel.ts'].map((file) => source('app', 'features', 'showcase', file)).join('\n')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(words, /whatsapp|instagram|paystack|flutterwave|selar|facebook|stripe/i, 'no provider is named')
  assert.doesNotMatch(words, /\bwa\.me\b|https?:\/\//, 'no address in the page text')
  assert.match(source('app', 'features', 'showcase', 'ShopPage.vue'), /priceLabel/)
  assert.match(source('app', 'features', 'showcase', 'ShopEditor.vue'), /PRICE_NOTE/)
  assert.equal(source('app', 'features', 'showcase', 'ShopPage.vue').includes('window.open'), false, 'only the leaving sheet opens a link')
  assert.match(source('app', 'features', 'showcase', 'ShopPage.vue'), /LinkInterstitial/)
})
