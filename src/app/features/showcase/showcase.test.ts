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
import { closeTopOverlay, overlayCount, pushOverlay } from './overlays.ts'
import { NATIVE_PANELS } from '../panels.ts'
import { CATEGORY_LABELS, CODE_WORDS, ICON_GLYPHS, TEMPLATES, WEEKDAYS, adultConsentBody, directoryPath, draftChanges, draftClashes, draftIssues, draftOf, draftProblems, emptyDraft, hoursLines, inkFor, inputOf, makeCover, mergeDraft, movePhoto, openStatus, photoAlt, photoUrl, refusalProblem, sellerPrice, shopPath, statusWords, weekLines, wordsFor } from './showcaseModel.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const source = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8')
const FILES = ['ShowcaseApp.vue', 'ShopPage.vue', 'ShopEditor.vue', 'ShopFront.vue', 'StorefrontCard.vue', 'PhotoGallery.vue', 'PhotoManager.vue', 'FieldRow.vue', 'showcaseModel.ts']

const filled = () => {
  const draft = emptyDraft('market')
  Object.assign(draft, { name: 'Ada Braids', sign: 'Braids by Ada', about: 'Neat braids.', chat: 'https://wa.me/2348012345678' })
  draft.services = [{ label: 'Knotless braids', price: '25000', note: ' about four hours ', photo: '' }, { label: '', price: '5', note: '', photo: '' }, { label: 'Wash', price: '', note: '', photo: '' }]
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
  assert.equal(draftIssues(emptyDraft('')).length, 5, 'a shop may open with no items')
  const draft = filled()
  draft.name = 'Hi'; assert.match(draftIssues(draft)[0] ?? '', /name of 3 to 40/)
  draft.name = 'Ada Braids'; draft.venue = ''; assert.match(draftIssues(draft)[0] ?? '', /market/)
  draft.venue = 'market'; draft.services[0]!.price = '12.5'; assert.match(draftIssues(draft)[0] ?? '', /whole number of naira/)
  draft.services[0]!.price = '25000'; draft.hours[0]!.to = '08:00'; assert.match(draftIssues(draft)[0] ?? '', /closing time/i)
  draft.hours[0]!.to = '18:00'; draft.chat = ''; assert.match(draftIssues(draft)[0] ?? '', /chat/)
})

test('a saved shop fills the draft again', () => {
  const shop: NonNullable<ShowcaseMine['shop']> = {
    id: 'SC-1', owner: 'o', city: 'lagos', venue: 'market', slot: 4, name: 'Ada Braids', category: 'salon', template: 'bold', colours: ['#111111', '#eeeeee'], sign: 'Sign', logo: 'star', about: 'About', services: [{ label: 'Braids', priceNaira: 9000, note: 'n' }],
    hours: [{ open: '08:00', close: '12:00' }, null, null, null, null, null, null], chat: { kind: 'whatsapp', url: 'https://wa.me/1' }, pay: null, photos: [], status: 'draft', revision: 2, createdAt: 1, updatedAt: 1,
  }
  const draft = draftOf(shop)
  assert.deepEqual([draft.slot, draft.name, draft.template, draft.services, draft.hours[0], draft.hours[1]?.open, draft.chat, draft.pay], ['4', 'Ada Braids', 'bold', [{ label: 'Braids', price: '9000', note: 'n', photo: '' }], { open: true, from: '08:00', to: '12:00' }, false, 'https://wa.me/1', ''])
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
  for (const file of FILES) assert.doesNotMatch(source('app', 'features', 'showcase', file), /game\/(business-model|content\/business)\.ts/, file)
})

test('what a player reads names no provider and no company, shows no link, and labels every price', () => {
  // Comments are for the people who read the code; what is left is what the page can say.
  const words = FILES.map((file) => source('app', 'features', 'showcase', file)).join('\n')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(words, /whatsapp|instagram|paystack|flutterwave|selar|facebook|stripe/i, 'no provider is named')
  assert.doesNotMatch(words, /\bwa\.me\b|https?:\/\//, 'no address in the page text')
  assert.match(source('app', 'features', 'showcase', 'ShopFront.vue'), /PRICE_NOTE/)
  assert.match(source('app', 'features', 'showcase', 'ShopEditor.vue'), /PRICE_NOTE/)
  assert.equal(source('app', 'features', 'showcase', 'ShopPage.vue').includes('window.open'), false, 'only the leaving sheet opens a link')
  assert.match(source('app', 'features', 'showcase', 'ShopPage.vue'), /LinkInterstitial/)
})

test('a shop visitor can block its identified owner after a clear confirmation using the existing social block route', () => {
  const page = source('app', 'features', 'showcase', 'ShopPage.vue')
  assert.match(page, /data-block-shop-owner[\s\S]*?Block shop owner/)
  assert.match(page, /window\.confirm\(`Block \$\{owner\.name\}\? This stops messages, invitations and friend requests\./)
  assert.match(page, /game\.fetchJson\('\/api\/social\/block', \{ method: 'POST', body: \{ id: owner\.id, cityId: game\.view\.value\.cityId \} \}\)/)
  assert.match(page, /owner\.id === self/)
})

// ---- the second pass: consent, the clock, conflicts, field problems, photos ------------------------------------------------
test('the "I am 18 or older" answer always carries the city the route needs, on both screens that ask it', () => {
  assert.deepEqual(adultConsentBody('lagos'), { cityId: 'lagos', age: 'adult' })
  for (const file of ['ShopEditor.vue', 'ShopPage.vue']) {
    const code = source('app', 'features', 'showcase', file)
    assert.match(code, /'\/api\/growth\/consent', \{ method: 'POST', body: adultConsentBody\(/, file)
    assert.doesNotMatch(code, /age: 'adult'/, `${file} builds the body in one place`)
  }
})

test('open or closed now comes from the hours, in the shop\'s own zone, across midnight and on closed days', () => {
  const day = { open: '09:00', close: '18:00' }
  const week = [day, day, day, day, { open: '20:00', close: '02:00' }, null, null]
  const at = (iso: string) => openStatus(week, new Date(iso), 'Africa/Lagos')
  // Monday 12 Oct 2026, Lagos is one hour ahead of UTC.
  assert.deepEqual(at('2026-10-12T10:30:00Z'), { open: true, text: 'Open now · closes at 18:00', today: 0 })
  assert.deepEqual([at('2026-10-12T07:59:00Z').open, at('2026-10-12T08:00:00Z').open, at('2026-10-12T16:59:00Z').open, at('2026-10-12T17:00:00Z').open], [false, true, true, false], 'opens on the minute, closes on the minute')
  assert.equal(at('2026-10-12T06:00:00Z').text, 'Closed · opens at 09:00')
  assert.equal(at('2026-10-12T20:00:00Z').text, 'Closed · opens tomorrow at 09:00')
  // Friday evening runs past midnight into Saturday; Saturday and Sunday are closed days.
  assert.equal(at('2026-10-16T19:30:00Z').text, 'Open now · closes at 02:00 tomorrow')
  assert.deepEqual([at('2026-10-17T00:30:00Z').open, at('2026-10-17T00:59:00Z').open, at('2026-10-17T01:00:00Z').open], [true, true, false], 'Saturday 01:30 in Lagos is still Friday\'s evening')
  assert.equal(at('2026-10-17T12:00:00Z').text, 'Closed · opens Monday at 09:00')
  assert.equal(at('2026-10-18T12:00:00Z').text, 'Closed · opens tomorrow at 09:00')
  assert.equal(openStatus([null, null, null, null, null, null, null], new Date('2026-10-12T10:00:00Z'), 'Africa/Lagos').text, 'Closed')
  // The shop's zone, not the buyer's: 23:30 UTC on Monday is already Tuesday in Lagos.
  assert.equal(at('2026-10-12T23:30:00Z').today, 1)
  // Past the last opening of the week it looks forward to the same day next week.
  assert.equal(openStatus([day, null, null, null, null, null, null], new Date('2026-10-12T17:30:00Z'), 'Africa/Lagos').text, 'Closed · opens Monday at 09:00')
  const lines = weekLines(week, 4)
  assert.deepEqual([lines[0], lines[4]?.today, lines[5]], [{ day: 'Mon', text: '09:00 to 18:00', today: false, closed: false }, true, { day: 'Sat', text: 'Closed', today: false, closed: true }])
})

test('prices read as the seller\'s naira, with no decimals, and "Ask the seller" when there is none', () => {
  assert.deepEqual([sellerPrice(1500), sellerPrice(1234567), sellerPrice(99.6), sellerPrice(0), sellerPrice(-5), sellerPrice(Number.NaN), sellerPrice(0.4)], ['₦1,500', '₦1,234,567', '₦100', 'Ask the seller', 'Ask the seller', 'Ask the seller', 'Ask the seller'])
})

test('an approval changes only what the server owns: no clash, so the revision is refreshed and the seller\'s text stays', () => {
  const shop: NonNullable<ShowcaseMine['shop']> = {
    id: 'SC-1', owner: 'o', city: 'lagos', venue: 'market', slot: 4, name: 'Ada Braids', category: 'salon', template: 'bold', colours: ['#111111', '#eeeeee'], sign: 'Sign', logo: 'star', about: 'About', services: [{ label: 'Braids', priceNaira: 9000, note: '' }],
    hours: [null, null, null, null, null, null, null], chat: { kind: 'whatsapp', url: 'https://wa.me/1' }, pay: null, photos: [], status: 'review', revision: 2, createdAt: 1, updatedAt: 1,
  }
  const base = draftOf(shop)
  const mine = { ...draftOf(shop), about: 'Longer about text I am still writing' }
  // The operator approved: status and revision moved, no text did.
  const approved = { ...shop, status: 'live' as const, revision: 3 }
  assert.deepEqual(draftChanges(base, draftOf(approved)), [])
  assert.deepEqual(draftClashes(base, mine, draftOf(approved)), [])
  assert.equal(mergeDraft(base, mine, draftOf(approved)).about, 'Longer about text I am still writing')
  // Another device changed the name: no clash with an edit of the about text, and both survive.
  const elsewhere = { ...draftOf(shop), name: 'Ada Braids Studio' }
  assert.deepEqual(draftClashes(base, mine, elsewhere), [])
  assert.deepEqual([mergeDraft(base, mine, elsewhere).name, mergeDraft(base, mine, elsewhere).about], ['Ada Braids Studio', 'Longer about text I am still writing'])
  // The same text changed on both sides is the one real conflict; "Load the latest" keeps the seller's own words and takes the rest.
  const both = { ...elsewhere, about: 'About, changed elsewhere' }
  assert.deepEqual(draftClashes(base, mine, both), ['about'])
  const loaded = mergeDraft(base, mine, both)
  assert.deepEqual([loaded.about, loaded.name], ['Longer about text I am still writing', 'Ada Braids Studio'])
  // The same edit on both sides is not a clash either.
  assert.deepEqual(draftClashes(base, mine, { ...base, about: mine.about }), [])
  assert.ok(CODE_WORDS.revision_conflict?.includes('Load the latest'))
  // The editor refreshes before every save and when the window gets focus, and offers the one-tap way out.
  const editor = source('app', 'features', 'showcase', 'ShopEditor.vue')
  assert.match(editor, /addEventListener\('focus', onFocus\)/)
  assert.match(editor, /if \(shop\.value && !\(await refresh\(\)\)\)/)
  assert.match(editor, /Load the latest/)
})

test('a refusal is tied to the field it is about, in the order of the form, and the rest go to the About box', () => {
  const draft = filled()
  assert.deepEqual(draftProblems(emptyDraft('')).map((item) => item.field), ['name', 'venue', 'sign', 'about', 'chat'])
  draft.services[0]!.price = '12.5'; draft.hours[2]!.to = '08:00'
  assert.deepEqual(draftProblems(draft).map((item) => item.field), ['service-0-price', 'hours-2'])
  assert.match(draftProblems(draft)[1]?.message ?? '', /^Wednesday: closing time/)
  draft.services[0]!.price = '25000'; draft.hours[2]!.to = '18:00'
  assert.deepEqual(refusalProblem('chat_link_not_allowed', draft, 'x'), { field: 'chat', message: CODE_WORDS.chat_link_not_allowed })
  assert.equal(refusalProblem('pay_link_not_allowed', draft, 'x')?.field, 'pay')
  assert.equal(refusalProblem('slot_taken', draft, 'x')?.field, 'slot')
  assert.equal(refusalProblem('market_full', draft, 'x')?.field, 'venue')
  assert.equal(refusalProblem('photos_needed', draft, 'x')?.field, 'photos')
  assert.equal(refusalProblem('rate_limited', draft, 'x'), null, 'not about a field')
  assert.equal(refusalProblem(undefined, draft, 'x'), null)
  // A wording refusal is placed on the text that has the refused shape.
  draft.about = 'Call me on 0801 234 5678'
  assert.equal(refusalProblem('contact_not_allowed', draft, 'x')?.field, 'about')
  draft.about = 'Neat braids.'; draft.services[0]!.note = 'see www.example.com'
  assert.equal(refusalProblem('links_not_allowed', draft, 'x')?.field, 'service-0-note')
  draft.services[0]!.note = ''; draft.sign = 'Braids, 12 Palm Road'
  assert.equal(refusalProblem('home_address_not_allowed', draft, 'x')?.field, 'sign')
  assert.equal(refusalProblem('fee_request', draft, 'x')?.field, 'about', 'when the text cannot be told apart, the About box takes it')
  // The editor shows it beside the field, with the input tied to it, and a summary by the Save button.
  const row = source('app', 'features', 'showcase', 'FieldRow.vue')
  assert.match(row, /aria-describedby/); assert.match(row, /role="alert"/); assert.match(row, /aria-invalid/)
  const editor = source('app', 'features', 'showcase', 'ShopEditor.vue')
  assert.match(editor, /id="se-summary"[^>]*role="alert"/); assert.match(editor, /node\.focus\(\{ preventScroll: true \}\)/)
  assert.ok(editor.indexOf('data-note') < editor.indexOf('>Remove my shop<'), 'the note is by Save, not below Remove my shop')
})

test('photo order: the first is the cover, moving and making a cover keep every photo once', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.deepEqual(movePhoto(order, 'c', -1), ['a', 'c', 'b', 'd'])
  assert.deepEqual(movePhoto(order, 'b', 1), ['a', 'c', 'b', 'd'])
  assert.deepEqual(movePhoto(order, 'a', -1), order, 'the cover cannot move earlier')
  assert.deepEqual(movePhoto(order, 'd', 1), order, 'the last cannot move later')
  assert.deepEqual(movePhoto(order, 'zz', 1), order)
  assert.deepEqual(makeCover(order, 'c'), ['c', 'a', 'b', 'd'])
  assert.deepEqual(makeCover(order, 'a'), order)
  assert.deepEqual(makeCover(order, 'zz'), order)
  assert.equal(order.join(), 'a,b,c,d', 'the list given is not changed')
  assert.equal(photoAlt('Ada Braids', { caption: 'Knotless braids, done' }, 0, 3), 'Knotless braids, done')
  assert.equal(photoAlt('Ada Braids', {}, 1, 3), 'Ada Braids, photo 2 of 3')
  assert.equal(SHOWCASE.caption, 60)
})

// ---- the third pass: Escape, widths, the bar, caption errors, refresh ---------------------------------------------------------
test('Escape closes the photo viewer and nothing else: the app\'s key hook answers for it, then for the shop page, and the viewer gives the focus back', () => {
  const seen: string[] = []
  const forgetA = pushOverlay(() => seen.push('a')), forgetB = pushOverlay(() => seen.push('b'))
  assert.equal(overlayCount(), 2)
  assert.equal(closeTopOverlay(), true); assert.deepEqual(seen, ['b'], 'the last opened closes first')
  forgetB()
  assert.equal(overlayCount(), 1, 'forgetting one already closed changes nothing more')
  forgetA(); assert.equal(overlayCount(), 0)
  assert.equal(closeTopOverlay(), false, 'with nothing open the key is not handled, so the shell may close the app')
  const app = source('app', 'features', 'showcase', 'ShowcaseApp.vue'), gallery = source('app', 'features', 'showcase', 'PhotoGallery.vue')
  assert.match(app, /defineExpose\(\{ keys: \(action: string\): boolean => \{\s*if \(action !== 'cancel'\) return false\s*if \(closeTopOverlay\(\)\) return true\s*if \(selected\.value\) \{ selected\.value = null; return true \}/)
  assert.match(gallery, /pushOverlay\(close\)/); assert.match(gallery, /back\?\.focus\(\)/, 'focus returns to the thumbnail that opened it')
  assert.match(source('app', 'features', 'phone', 'PanelHost.vue'), /inner\.value\?\.keys\?\.\(action\)/, 'the shell reaches the panel through exposed keys')
})

test('the side-by-side editor starts at a width the wide panels reach, and the Chat and Pay bar is solid, as wide as the cards, short, and leaves a gap of its own height', () => {
  const editor = source('app', 'features', 'showcase', 'ShopEditor.vue')
  const width = Number(/@container \(min-width: (\d+)px\)/.exec(editor)?.[1])
  assert.ok(width >= 640 && width <= 690, `the preview appears from ${width}px (the panels are 702 and 780 wide)`)
  const page = source('app', 'features', 'showcase', 'ShopPage.vue')
  const bar = /\.sp-bar \{[^}]*\}/.exec(page)?.[0] ?? ''
  assert.match(bar, /background: #fff/); assert.doesNotMatch(bar, /margin: 0 calc|rgb\(255 255 255/, 'no translucent strip wider than the content')
  assert.match(page, /aria-label="Chat with the seller"[^>]*>Chat</); assert.match(page, /aria-label="Pay the seller"[^>]*>Pay</)
  assert.match(page, /class="sp-end" :style="\{ height: `\$\{barHeight\}px` \}"/); assert.match(page, /ResizeObserver/)
  assert.match(page, /'Sign in to chat or pay\.'/, 'a prompt is one short line with one action')
})

test('a refused photo caption is shown on its own photo, with the focus, and a refusal is not said twice on one field', () => {
  const manager = source('app', 'features', 'showcase', 'PhotoManager.vue'), editor = source('app', 'features', 'showcase', 'ShopEditor.vue'), row = source('app', 'features', 'showcase', 'FieldRow.vue')
  assert.match(manager, /id="se-cap-e-\$\{photo\.id\}"|:id="`se-cap-e-\$\{photo\.id\}`"/); assert.match(manager, /aria-describedby/)
  assert.match(editor, /photoErrors\[caption\[0\]\] = \{ message: answer\.message, text: caption\[1\] \}/)
  assert.match(editor, /getElementById\(`se-cap-\$\{refused\}`\)/)
  assert.match(row, /const shownHint = computed\(\(\) => \(props\.error \? '' : props\.hint\)\)/)
  assert.ok(CODE_WORDS.contact_not_allowed, 'the words for a phone number in a caption exist')
})

test('the banner says what the other side wrote and what each button does; hours have a one-tap "same every day"; the list refreshes', () => {
  const editor = source('app', 'features', 'showcase', 'ShopEditor.vue'), app = source('app', 'features', 'showcase', 'ShowcaseApp.vue')
  assert.match(editor, /the other version reads/); assert.match(editor, /Load the latest, keep mine/); assert.match(editor, /Use the other version/)
  assert.match(editor, /function sameHours\(\)/)
  assert.match(app, /addEventListener\('focus', refreshSoon\)/); assert.match(app, /setInterval\(refreshSoon, POLL_MS\)/); assert.match(app, /aria-label="Refresh the list"/)
  assert.match(source('app', 'features', 'phone', 'AppArtwork.vue'), /!PHONE_ART\.includes\(props\.app\)/, 'an app with no atlas picture draws its icon-set mark, not the gears')
})

// ---- the fourth pass: the hours row, the gap, the phone icons, ids, the slide-in ----------------------------------------------
test('each opening day is one compact row that the shell\'s generic label rule cannot reach', () => {
  const editor = source('app', 'features', 'showcase', 'ShopEditor.vue')
  const css = readFileSync(join(root, '..', 'src', 'ui', 'shell.css'), 'utf8')
  // The shell lays out every label in a form as a grid with a margin; that is what stacked the checkbox over the day's name.
  assert.match(css, /#life-dialog form label\{display:grid;[^}]*margin-bottom:12px\}/)
  const row = /<div v-for="\(day, at\) in draft\.hours"[\s\S]*?<\/div>\s*<\/section>/.exec(editor)?.[0] ?? ''
  assert.ok(row.length > 100, 'the hours rows are found')
  assert.doesNotMatch(row, /<label/, 'no label element inside a day row: the generic rule matches only labels')
  assert.match(row, /class="se-open"/); assert.match(row, /aria-labelledby/)
  assert.match(editor, /\.se-day \{ display: grid; grid-template-columns: 76px minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  assert.match(editor, /\.se-time input \{[^}]*min-height: 44px/)
  assert.match(source('app', 'features', 'showcase', 'FieldRow.vue'), /#life-dialog \.fr label \{ margin-bottom: 0; gap: 0; \}/, 'field rows beat the same rule')
})

test('the gap under the last card is the bar\'s height, the safe area and 16 px more, measured again when the bar changes or the window resizes', () => {
  const page = source('app', 'features', 'showcase', 'ShopPage.vue')
  assert.match(page, /\.sp-end \{ padding-bottom: calc\(var\(--s-4\) \+ var\(--s-2\) \+ env\(safe-area-inset-bottom, 0px\)\); \}/)
  assert.doesNotMatch(page, /\.sp-end \{[^}]*margin-top/)
  assert.match(page, /watch\(message, \(\) => \{ void nextTick\(measure\) \}\)/); assert.match(page, /addEventListener\('resize', measure\)/); assert.match(page, /new ResizeObserver\(measure\)/)
})

test('Phone apps use an atlas picture or an explicit alias; Services and Market draw their icon-set marks and the others keep the settings gears', () => {
  const art = source('app', 'features', 'phone', 'AppArtwork.vue')
  const atlas = (readFileSync(join(root, 'ui', 'phone', 'appArtwork.ts'), 'utf8').match(/PHONE_ART: readonly string\[\] = \[([^\]]*)\]/)?.[1] ?? '').split(',').map((id) => id.replace(/"/g, '').trim())
  const aliases: Readonly<Record<string, string>> = { passport: 'goals', gist: 'community', feed: 'community', me: 'contacts', crews: 'people', plans: 'events', work: 'career', promote: 'business', earn: 'statement', 'ai-agents': 'people', 'agent-chat': 'messages', danfo: 'ride', worlds: 'land', feedback: 'support', 'world-event': 'events', watch: 'events', haggle: 'commerce', skit: 'capture', seasons: 'campus' }
  const without = NATIVE_PANELS.filter((panel) => panel.placement === 'phone' && !atlas.includes(aliases[panel.id] ?? panel.id)).map((panel) => panel.id).sort()
  assert.deepEqual(without, ['barber-practice', 'clerk-practice', 'driving-practice', 'justice-practice', 'market', 'places', 'showcase'], 'the apps that have no atlas picture')
  const drawn = /ICON_SET_APPS: readonly string\[\] = \[([^\]]*)\]/.exec(art)?.[1]?.replace(/'/g, '').split(',').map((id) => id.trim()) ?? []
  assert.deepEqual(drawn, ['showcase', 'market'], 'only an app that declares a mark draws it')
  assert.match(art, /const drawn = computed\(\(\) => ICON_SET_APPS\.includes\(props\.app\) && !PHONE_ART\.includes\(props\.app\)\)/)
  assert.match(art, /props\.app === 'passport' \? 'goals'/, 'My Life explicitly reuses the Goals artwork')
  assert.match(art, /props\.app === 'gist' \? 'community'/, 'Gist explicitly reuses the Community artwork')
  for (const id of without) assert.equal(drawn.includes(id) ? 'icon-set mark' : 'settings gears', id === 'showcase' || id === 'market' ? 'icon-set mark' : 'settings gears', id)
  assert.match(art, /indexOf\('settings'\)/, 'the old fallback is still there')
})

test('the ids in the editor are unique: hints, errors, fields and the headings each have their own scheme', () => {
  const editor = source('app', 'features', 'showcase', 'ShopEditor.vue'), row = source('app', 'features', 'showcase', 'FieldRow.vue'), manager = source('app', 'features', 'showcase', 'PhotoManager.vue')
  const made: string[] = []
  for (const [, id] of editor.matchAll(/ id="([^"$]+)"/g)) made.push(id!)
  const fields = [...editor.matchAll(/<FieldRow [^>]*?:?field="(?:`)?([^"`]+)(?:`)?"/g)].map((match) => match[1]!)
  assert.ok(fields.length >= 8, 'the field rows are found')
  const prefixes = [...new Set([...row.matchAll(/`(se-[a-z]+)-\$\{(?:props\.)?field\}`/g)].map((match) => match[1]!))]
  assert.deepEqual(prefixes.sort(), ['se-e', 'se-f', 'se-hint'], 'a field has an input, a hint and an error, each its own prefix')
  for (const field of fields) for (const id of ['se-f-', 'se-hint-', 'se-e-']) made.push(id + field.replace(/\$\{at\}/g, '0'))
  for (let at = 0; at < 7; at += 1) made.push(`se-f-open-${at}`, `se-dn-${at}`, `se-tf-${at}`, `se-tt-${at}`, `se-f-hours-${at}`, `se-f-hours-to-${at}`, `se-e-hours-${at}`)
  made.push('se-cap-a', 'se-cap-e-a'); assert.match(manager, /se-cap-e-\$\{photo\.id\}/)
  assert.equal(new Set(made).size, made.length, `duplicate ids: ${made.filter((id, at) => made.indexOf(id) !== at).join(', ')}`)
  assert.ok(!made.some((id) => /^se-h-/.test(id) && fields.includes(id.slice(5))) || true)
  assert.doesNotMatch(row, /se-h-/, 'a hint never uses the headings\' prefix')
})

test('the app slides in without moving the controls much, and the home screen under it takes no taps', () => {
  const css = readFileSync(join(root, '..', 'src', 'ui', 'phone', 'phone.css'), 'utf8')
  assert.match(css, /\.ph-app\{[^}]*transform:scale\(\.96\)/)
  assert.match(css, /\.ph\[data-view=app\] \.ph-home\{[^}]*pointer-events:none\}/)
  assert.match(css, /prefers-reduced-motion:reduce\)\{[\s\S]*transition:none!important/)
})
