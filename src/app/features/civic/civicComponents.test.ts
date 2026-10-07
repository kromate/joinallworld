// Component tests of the civic screens, the way the pilots are tested (src/app/components.test.ts):
// each single-file component is compiled by the project's own Vite configuration and rendered to a
// string against the real store and a fake server. The cache is filled (or left empty) before a
// screen is rendered, so what is asserted is the markup of a known state: loading, offline, an
// error with its retry, the data, a disabled control and its reason, a pending press. What a click
// does is tested where the logic lives (civicCore.test.ts, civicModel.test.ts).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { AdsResponse, GovResponse, NeighboursResponse, PulseResponse, RadioView, RichListResponse } from '../../../types/civic.ts'
import type { App } from '../../state/app.ts'
import type { Civic } from './civicClient.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let civic: Civic
let pending: Set<string>
const realFetch = globalThis.fetch

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
async function render(name: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(`/src/app/features/civic/${name}.vue`)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}
const buttons = (html: string): string[] => [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)].map((match) => text(match[0]))
/** The whole <button …> tag that has this label. */
const buttonTag = (html: string, label: RegExp | string): string => {
  const hit = [...html.matchAll(/<button\b[^>]*>.*?<\/button>/gs)].map((match) => match[0]).find((tag) => (typeof label === 'string' ? text(tag).includes(label) : label.test(text(tag))))
  assert.ok(hit, `no button "${String(label)}" in ${buttons(html).join(' | ')}`)
  return hit
}

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  const core = await load<{ sharedStore: { pending: Set<string> } }>('/src/app/features/civic/civicCore.ts')
  pending = core.sharedStore.pending
  civic = (await load<{ useCivic: () => Civic }>('/src/app/features/civic/useCivic.ts')).useCivic()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

const governor = (patch: Partial<GovResponse> = {}): GovResponse => ({
  city: 'lagos', phase: 'voting', phaseEndsAt: server.now() + 3 * 3600000,
  election: { week: 1, nominationsAt: 0, votingAt: 0, closesAt: 0, totalVotes: 5, yourVote: null, candidates: [
    { id: 'c1', name: 'Ada <b>Obi</b>', slogan: 'Roads for all', votes: 3, you: false },
    { id: 'c2', name: 'Tolu', slogan: 'Light for all', votes: 2, you: false },
  ] },
  governor: null, lastResult: null, announcements: [],
  rules: { beta: true, minDaysToRun: 2, minDaysToVote: 1, minWorkDays: 2, votesPerAddress: 0, filingFee: 2000, sloganMin: 3, sloganMax: 60, maxCandidates: 30, announcementMax: 140, announcementsPerDay: 3, pollingVenue: null },
  you: { days: 3, isGovernor: false, isCandidate: false, votedFor: null,
    run: { ok: false, code: 'insufficient_funds', reason: 'Filing costs ₦2,000; you have less.', checks: [{ id: 'fee', met: false, label: 'Filing fee', detail: 'You have ₦100 of ₦2,000.', code: 'insufficient_funds' }, { id: 'work', met: false, label: 'Paid work', detail: '0 of 2 days.', code: 'work_days' }] },
    vote: { ok: false, code: 'work_days', reason: 'Work two days first.', checks: [{ id: 'work', met: false, label: 'Paid work', detail: '0 of 2 days.', code: 'work_days' }] },
    announce: { ok: false, code: 'not_governor', reason: 'Only the Governor can post.' } },
  ...patch,
})

test('Governor: until the data is here, a skeleton; offline, the connection\'s own words and its way out; an error, a retry', async () => {
  const cityKey = `gov:${app.game.view.value.cityId}`
  const loading = await render('GovernorApp')
  assert.match(loading, /role="status" aria-label="Loading"/)
  assert.ok(!text(loading).includes('Candidates'))

  civic.entry(cityKey).error = 'The server could not be reached. Try again.'
  const failed = await render('GovernorApp')
  assert.match(failed, /role="alert"/)
  assert.ok(text(failed).includes('This did not load The server could not be reached. Try again.'))
  assert.ok(buttons(failed).includes('Try again'), 'a retry')
  civic.entry(cityKey).error = null

  server.fault.offline = true
  await app.game.refresh()
  try {
    const off = text(await render('GovernorApp'))
    assert.ok(off.includes('This screen is loaded from the server, so it cannot be shown right now.'), off.slice(0, 200))
    assert.ok(/No internet|Server unreachable/.test(off))
  } finally { server.fault.offline = false; assert.equal(await app.game.connect(), true); app.game.stop() }
})

test('Governor: the week, the ballot with a reason on every disabled vote, what is needed, and a text that is only text', async () => {
  civic.put(`gov:${app.game.view.value.cityId}`, governor({ announcements: [{ id: 'a1', by: { id: 'g', name: 'Gov' }, text: '<img src=x onerror=alert(1)>', at: server.now() }] }))
  const html = await render('GovernorApp')
  const words = text(html)
  assert.ok(words.includes('The seat is empty'))
  assert.ok(words.includes('Polls are open polls close in 3h 0m'), words.slice(0, 600))
  assert.match(html, /<li[^>]*class="is-now"[^>]*aria-current="step"[^>]*><b[^>]*>Voting<\/b>/)
  assert.ok(words.includes('Ada <b>Obi'), 'a name is shown as typed')
  assert.ok(!html.includes('<b>Obi</b>') && !html.includes('<img'), 'never markup')
  assert.ok(words.includes('3 votes') && words.includes('2 votes'))
  assert.ok(words.includes('5 votes cast so far. One vote per player; it cannot be changed.'))
  const vote = buttonTag(html, 'Vote for Tolu')
  assert.match(vote, /disabled/)
  assert.match(vote, /title="Work two days first\."/)
  assert.ok(words.includes('Work two days first.'), 'the reason is printed under the button, not only in a tooltip')
  assert.match(html, /<i role="img" aria-label="Not met"[^>]*>/)
  assert.ok(buttons(html).includes('Open Jobs to find paid work'))
  assert.match(buttonTag(html, /Run for Chairman · ₦2,000/), /disabled/)
  assert.ok(words.includes('Filing costs ₦2,000; you have less.'))
  assert.match(html, /<input[^>]*maxlength="60"[^>]*autocomplete="off"/)
  assert.ok(!words.includes('Chairman’s desk'), 'only the Chairman has a desk')
  assert.ok(words.includes('How elections work') && words.includes('Chairman’s announcements'))
  assert.match(html, /<details[^>]*class="how is-page"(?![^>]*\sopen)/)
})

test('Governor: a vote on its way says "Working…" and cannot be pressed again; the refused vote stays on screen', async () => {
  const cityId = app.game.view.value.cityId
  const open = governor({ you: { ...governor().you!, vote: { ok: true, checks: [] } } })
  civic.put(`gov:${cityId}`, open)
  pending.add('vote:c1')
  try {
    const html = await render('GovernorApp')
    const pressed = buttonTag(html, 'Working…')
    assert.match(pressed, /disabled/)
    assert.match(pressed, /aria-busy="true"/)
    assert.match(buttonTag(html, 'Vote for Tolu'), /^<button(?![^>]*disabled)/, 'another candidate can still be chosen')
  } finally { pending.delete('vote:c1') }
  const { govRefusal } = await load<{ govRefusal: { value: { key: string; code: string; reason: string } | null } }>('/src/app/features/civic/civicDrafts.ts')
  govRefusal.value = { key: `gov:${cityId}`, code: 'address_vote_limit', reason: 'Too many votes from this network.' }
  try {
    const html = await render('GovernorApp')
    assert.match(html, /<div[^>]*class="civic-refusal"[^>]*role="alert"[^>]*><strong[^>]*>This network connection has reached its vote limit<\/strong><p[^>]*>Too many votes from this network\.<\/p>/)
  } finally { govRefusal.value = null }
  civic.put(`gov:${cityId}`, governor({ election: { ...open.election, yourVote: 'c1' } }))
  const voted = await render('GovernorApp')
  assert.ok(text(voted).includes('Your vote'))
  assert.ok(!buttons(voted).some((label) => label.startsWith('Vote for')), 'one vote per player')
})

test('Governor: the sitting Governor sees the desk, with the server\'s reason when posting is off', async () => {
  const cityId = app.game.view.value.cityId
  const me = app.game.view.value.session?.id ?? 'me'
  civic.put(`gov:${cityId}`, governor({
    phase: 'results', governor: { id: me, name: 'Kunle', slogan: 'Mine', votes: 4, week: 1, termStartedAt: 0, termEndsAt: server.now() + 86400000 },
    you: { ...governor().you!, isGovernor: true, announce: { ok: false, code: 'announcement_cooldown', reason: 'Wait an hour between announcements.' } },
    lastResult: { week: 1, closedAt: 0, termEndsAt: 0, candidates: 2, totalVotes: 5, winner: { id: me, name: 'Kunle', slogan: 'Mine', votes: 4 } },
  }))
  const html = await render('GovernorApp')
  const words = text(html)
  assert.ok(words.includes('Chairman Kunle (you)'))
  assert.ok(words.includes('Kunle won with 4 of 5 votes.'))
  assert.ok(words.includes('Chairman’s desk'))
  assert.match(html, /<textarea[^>]*maxlength="140"/)
  assert.match(buttonTag(html, 'Post announcement'), /disabled/)
  assert.ok(words.includes('Wait an hour between announcements.'))
})

test('State House: the seat, the news and a button into the Governor app', async () => {
  const cityId = app.game.view.value.cityId
  civic.put(`gov:${cityId}`, governor())
  const html = await render('StateHouseSheet')
  assert.ok(text(html).includes('Lagos State House') || text(html).includes('State House'))
  assert.ok(text(html).includes('No announcements yet'))
  assert.ok(text(html).includes('Polls are open: polls close in'))
  assert.ok(buttons(html).includes('Vote for Chairman'))
})

test('Neighbours: counts from the server, presence, a way to say hi, and the hide button', async () => {
  const cityId = app.game.view.value.cityId
  const data: NeighboursResponse = { city: 'lagos', demonym: 'Lagosians', hidden: false, total: 1234, online: 56, listed: 3, districts: [
    { id: 'yaba', label: 'Yaba', count: 12, online: 3, homes: [{ id: 'p1', name: 'Bisi', online: true, you: false }, { id: 'p2', name: 'Kunle', online: false, you: true }] },
    { id: 'ikoyi', label: 'Ikoyi', count: 0, online: 0, homes: [] },
  ] }
  civic.put(`hood:${cityId}`, data)
  const html = await render('NeighboursApp')
  const words = text(html)
  assert.ok(words.includes('1,234 homes') && words.includes('56 online now'))
  assert.ok(words.includes('Yaba 12 homes · 3 online'))
  assert.ok(!words.includes('Ikoyi'), 'an empty district is not listed')
  assert.ok(words.includes('10 more not listed (hidden or beyond the list limit).'))
  assert.match(html, /<i class="is-on social-dot"/)
  assert.ok(words.includes('Kunle (you)') && words.includes('Online now') && words.includes('Not online'))
  assert.equal(buttons(html).filter((label) => label === 'Say hi').length, 1, 'no "Say hi" to yourself')
  assert.ok(buttons(html).includes('Hide my home from the directory'))
  civic.put(`hood:${cityId}`, { ...data, hidden: true })
  assert.ok(buttons(await render('NeighboursApp')).includes('List my home in the directory'))
  pending.add('prefs')
  try { assert.ok(buttons(await render('NeighboursApp')).includes('Working…')) } finally { pending.delete('prefs') }
})

test('Rich List: the podium, the rank and the toggle', async () => {
  const cityId = app.game.view.value.cityId
  const row = (rank: number, name: string, amount: number, you = false) => ({ rank, id: `p${rank}`, name, amount, you })
  const data: RichListResponse = { city: 'lagos', week: 1, size: 10, balances: [row(1, 'Ada', 9000), row(2, 'Bisi', 5000, true), row(3, 'Chi', 4000), row(4, 'Dayo', 3000)], earners: [],
    you: { listed: true, cash: 5000, earned: 1200, balanceRank: 2, earnerRank: null }, counters: { players: 40, online: 5, visits: 90 } }
  civic.put(`rich:${cityId}`, data)
  const html = await render('RichListApp')
  const words = text(html)
  assert.ok(words.includes('You · rank 2 ₦5,000 Earned ₦1,200 this week'))
  assert.ok(words.includes('40 players in') && words.includes('5 online now') && words.includes('90 daily visits'))
  assert.match(html, /<ol class="richlist-podium"[^>]*>/)
  assert.ok(words.includes('Bisi (you)'))
  assert.match(html, /<ol[^>]*class="ui-rows"[^>]*start="4"/)
  assert.ok(words.includes('Nobody has earned anything this week yet.'))
  assert.ok(buttons(html).includes('Hide me from the Rich List'))
  civic.put(`rich:${cityId}`, { ...data, you: { ...data.you!, listed: false } })
  const hidden = text(await render('RichListApp'))
  assert.ok(hidden.includes('You are hidden Not on the list Your balance is not shown to anyone.'))
})

test('Billboards: one form, rent buttons that say why they are off, and the sea grid', async () => {
  const cityId = app.game.view.value.cityId
  const ad = { text: '<script>x</script> Jollof', colour: 'gold', icon: 'food', by: { id: 'p1', name: 'Mama' }, at: 0, expiresAt: server.now() + 86400000, mine: false, price: 1500 }
  const data: AdsResponse = { city: 'lagos',
    palette: { colours: [], icons: [] },
    billboards: { price: 1500, days: 7, maxPerPlayer: 2, slots: [
      { slot: 'bb-01', near: 'market', road: 'Ikorodu Road', price: 1500, ad: null },
      { slot: 'bb-02', near: 'park', road: 'Marina', price: 1500, ad },
    ] },
    sea: { rows: 16, cols: 16, price: 100, shoreRows: 2, shorePrice: 250, days: 30, maxPerPlayer: 12, plots: [{ ...ad, slot: 'sea-4-4', row: 4, col: 4 }] } }
  civic.put(`ads:${cityId}`, data)
  const html = await render('AdsApp')
  const words = text(html)
  assert.match(html, /<div[^>]*class="ui-seg"[^>]*role="group" aria-label="Ad type"[^>]*><button[^>]*aria-pressed="true"[^>]*>Billboards/)
  assert.match(html, /role="group" aria-label="Ad colour"/)
  assert.equal([...html.matchAll(/aria-label="(?:Green|Gold|Red|Blue|Purple|Teal|Night|White)"/g)].length, 8)
  assert.ok(words.includes('Ad text') && words.includes('(2–40 characters, no links)'))
  assert.ok(words.includes('Ikorodu Road Near'), words.slice(0, 900))
  assert.ok(words.includes('Rented by Mama until'))
  assert.ok(!html.includes('<script>x'), 'ad text is text')
  assert.ok(words.includes('<script>x</script> Jollof'))
  const rent = buttonTag(html, /^Rent · ₦1,500/)
  const cash = app.game.state.value.cash
  assert.equal(/disabled/.test(rent), cash < 1500, 'off exactly when the balance cannot cover it')
  if (cash < 1500) assert.ok(words.includes(`Costs ₦1,500; you have ₦${cash.toLocaleString('en-NG')}.`))
  const { adsUi } = await load<{ adsUi: { tab: string } }>('/src/app/features/civic/civicDrafts.ts')
  adsUi.tab = 'sea'
  try {
    const sea = await render('AdsApp')
    assert.equal([...sea.matchAll(/<button[^>]*aria-label="Plot row/g)].length, 256)
    assert.match(sea, /aria-label="Plot row 5, column 5, rented by Mama"/)
    assert.match(sea, /aria-label="Plot row 1, column 1, free"/)
    assert.ok(text(sea).includes('1 of 256 plots are rented; you hold 0 of 12.'))
    assert.ok(text(sea).includes('Plot 5·5'))
    assert.ok(buttons(sea).some((label) => label.startsWith('Rent')), 'the taken plot offers a disabled Rent')
    assert.ok(text(sea).includes('This plot is taken. Pick a free one.'))
  } finally { adsUi.tab = 'billboard' }
})

test('Gem hunt: the sheet with its reasons, the chip, and the counters only once they are here', async () => {
  assert.equal((await app.command('civic.refresh')).ok, true)
  const hunt = app.game.view.value.civic?.hunt
  assert.ok(hunt, 'the life rolled today\'s hunt')
  const cityId = app.game.view.value.cityId
  const sheet = await render('HuntSheet')
  const words = text(sheet)
  assert.ok(words.includes(`Daily gem hunt ${hunt.found} of ${hunt.total} found`), words.slice(0, 200))
  assert.ok(words.includes('Loading the city counter…'), 'no number before the counters arrive')
  assert.ok(words.includes('Resets at midnight, Nigerian time — an unclaimed prize does not carry over.'))
  assert.match(buttonTag(sheet, /^Claim ₦/), /disabled/)
  assert.ok(words.includes(`Find all ${hunt.total} gems first (${hunt.found} so far).`))
  assert.equal([...sheet.matchAll(/<li class="ui-row/g)].length, hunt.total)

  const chip = await render('HuntChip')
  assert.match(chip, /<button class="life-job civic-chip"[^>]*aria-label="Daily gem hunt, \d of \d found today"/)
  assert.ok(!text(chip).includes(' found · '), 'no count until the pulse has loaded')
  const pulse: PulseResponse = { city: 'lagos', checkedIn: true, counters: { players: 9, online: 7, visits: 2 }, hunt: { found: 1234, today: 5, claims: 3, prize: 3000, gemsPerDay: 3 }, gov: { phase: 'voting', phaseEndsAt: 0, governor: null }, notices: [], radio: null }
  civic.put(`pulse:${cityId}`, pulse)
  assert.ok(text(await render('HuntChip')).includes('1,234 found · next prize ₦3,000') && text(await render('HuntChip')).includes('7 online'))
  assert.ok(text(await render('HuntSheet')).includes('1,234 gems found in'))
})

test('Radio: off air outside a club, with a way into each club; inside, the queue, the form and why buying is off', async () => {
  const cityId = app.game.view.value.cityId
  const off = await render('RadioApp')
  assert.ok(text(off).includes('Off air here'))
  assert.ok(text(off).includes('A shout-out costs ₦500 · 3 a day each.'))
  assert.ok(buttons(off).some((label) => label.startsWith('Go to ')), 'a way into a club')

  const before = app.game.state.value
  app.game.state.value = { ...before, location: 'quilox', activeAction: null, cash: 100 }
  try {
    const radio: RadioView = { venue: 'quilox', club: true, price: 500, slotSeconds: 60, perDay: 3, queueMax: 20, usedToday: 1,
      playing: { id: 'r1', by: { id: 'p1', name: 'Tolu' }, title: 'Calm Down', artist: 'Rema', startsAt: app.game.view.value.now - 10000, endsAt: app.game.view.value.now + 50000, mine: false },
      queue: [{ id: 'r2', by: { id: 'p2', name: 'Me' }, title: 'Essence', artist: 'Wizkid', startsAt: app.game.view.value.now + 50000, endsAt: app.game.view.value.now + 110000, mine: true }] }
    civic.put(`radio:${cityId}:quilox`, radio)
    const html = await render('RadioApp')
    const words = text(html)
    assert.match(html, /<section class="is-on radio-now"/)
    assert.ok(words.includes('Calm Down — Rema') && words.includes('Shout-out from @Tolu · about 1m left'))
    assert.ok(words.includes('Up next 1 in the queue') && words.includes('Essence — Wizkid') && words.includes('@Me (you) · in about 1m'))
    assert.match(html, /<input[^>]*maxlength="40"[^>]*autocomplete="off"/)
    assert.match(buttonTag(html, /^Buy shout-out · ₦500/), /disabled/)
    assert.ok(words.includes('Costs ₦500; you have ₦100.'))
    assert.ok(words.includes('Balance ₦100 · 1 of 3 shout-outs used today.'))
    const banner = await render('RadioBanner')
    assert.match(banner, /aria-label="Club radio"/)
    assert.ok(text(banner).includes('THE DJ — shout-out from @Tolu') && text(banner).includes('Calm Down — Rema'))
  } finally { app.game.state.value = before }
  assert.equal(text(await render('RadioBanner')), '', 'no banner outside a club')
})

test('registration: each civic Vue panel carries the static metadata the Phone, the Sim and the HUD list it by', async () => {
  const { CIVIC_PANELS } = await load<{ CIVIC_PANELS: readonly Record<string, unknown>[] }>('/src/app/features/civic/register.ts')
  assert.deepEqual(CIVIC_PANELS.map((panel) => panel.id), ['governor', 'state-house', 'neighbours', 'ads', 'hunt-sheet', 'radio', 'richlist', 'hunt', 'radio-banner'])
  const expected: Record<string, [string, string, number | undefined, string | undefined]> = {
    governor: ['Chairman', 'phone', 40, 'city'], 'state-house': ['State House', 'modal', undefined, undefined], neighbours: ['Neighbours', 'phone', 42, 'city'], ads: ['Billboards', 'phone', 44, 'city'],
    'hunt-sheet': ['Gem hunt', 'phone', 45, 'city'], radio: ['Radio', 'phone', 46, 'city'], richlist: ['Rich List', 'phone', 48, 'money'],
  }
  for (const panel of CIVIC_PANELS) {
    const want = expected[String(panel.id)]
    if (want) assert.deepEqual([panel.title, panel.placement, panel.order, panel.group], want, String(panel.id))
    else assert.equal(panel.placement, 'hud', `${String(panel.id)} is a HUD chip`)
  }
})


test('city-owned civic title and fictional-role explanation reach the rendered office and announcements', async () => {
  const registry = await load<typeof import('../../../game/cities/registry.ts')>('/src/game/cities/registry.ts')
  const fixture = await load<typeof import('../../../game/cities/testing/fictionalCity.test-fixture.ts')>('/src/game/cities/testing/fictionalCity.test-fixture.ts')
  const module = { ...fixture.fictionalCity, rules: { ...fixture.fictionalCity.rules, civicTitle: 'Community Chair' }, loadContent: async () => ({ ...fixture.fictionalContent, civicExplanation: 'A fictional community role, not a real public office.' }) }
  const registered = registry.registerCityForTest(module)
  try {
    await registry.loadCityContent(module.id)
    const data = governor({ city: module.id })
    const seat = text(await render('GovernorSeat', { data }))
    assert.ok(seat.includes('Fictional Community Chair’s office'))
    assert.ok(seat.includes('Fictional has no Community Chair yet.'))
    assert.ok(seat.includes('A fictional community role, not a real public office.'))
    assert.ok(!seat.includes('Governor'))
    const news = text(await render('GovernorNews', { data, notices: [] }))
    assert.ok(news.includes('Community Chair’s announcements'))
    assert.ok(news.includes('There is no Community Chair to post one.'))
    assert.ok(!news.includes('Governor'))
  } finally { registered.dispose() }
})
