// Component test of the Politics app, the way the civic screens are tested (civic/civicComponents.test.ts): the single-file
// component is compiled by the project's Vite configuration and rendered to a string against the real store and a fake server.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { GovResponse } from '../../../types/civic.ts'
import type { PoliticsResponse, SeatView } from '../../../types/politics.ts'
import type { App } from '../../state/app.ts'
import type { Civic } from '../civic/civicClient.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let civic: Civic
const realFetch = globalThis.fetch

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
const render = async (): Promise<string> => { const component = (await load('/src/app/features/politics/PoliticsApp.vue')).default; return renderToString(createSSRApp({ render: () => h(component, {}) })) }

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  civic = (await load<{ useCivic: () => Civic }>('/src/app/features/civic/useCivic.ts')).useCivic()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

const seat = (tier: SeatView['tier'], patch: Partial<SeatView> = {}): SeatView => ({
  tier, id: `${tier}:x`, name: tier === 'city' ? 'Lagos' : tier === 'state' ? 'Lagos State' : 'Nigeria', title: tier === 'city' ? 'Chairman' : tier === 'state' ? 'Governor' : 'President',
  fee: 2000, quorum: 3, parties: { c1: 'p1' }, officeholderParty: null, decree: null,
  levers: [{ id: 'marketLevy', label: 'Market levy', about: 'Added to the price of everything bought at a stall.', min: 0, max: 10, base: 0, unit: '%', value: 0 }],
  treasury: { balance: 4200, ledger: [{ at: 1, kind: 'levy', amount: 120, note: 'Market levy on 1 × Jollof' }] }, you: { isOfficeholder: false, salary: 0 }, ...patch,
})
const overview = (cityId: string, patch: Partial<SeatView> = {}): PoliticsResponse => ({
  city: cityId, seats: [seat('city', patch), seat('state'), seat('nation')],
  parties: [{ id: 'p1', name: 'Green Hands', motto: 'Plant more', colour: 'green', founder: { id: 'f', name: 'Femi' }, members: 3, mine: false }],
  you: { party: null, canFound: true }, partyRules: { fee: 5000, nameMin: 3, nameMax: 24, mottoMin: 3, mottoMax: 60, colours: ['green', 'gold'] },
})
const ballot = (): GovResponse => ({
  city: 'lagos', phase: 'voting', phaseEndsAt: server.now() + 3 * 3600000,
  election: { week: 1, nominationsAt: 0, votingAt: 0, closesAt: 0, totalVotes: 5, yourVote: null, candidates: [{ id: 'c1', name: 'Ada', slogan: 'Roads for all', votes: 3, you: false }, { id: 'c2', name: 'Tolu', slogan: 'Light for all', votes: 2, you: false }] },
  governor: null, lastResult: null, announcements: [],
  rules: { beta: true, minDaysToRun: 2, minDaysToVote: 1, minWorkDays: 2, votesPerAddress: 0, filingFee: 2000, sloganMin: 3, sloganMax: 60, maxCandidates: 30, announcementMax: 140, announcementsPerDay: 3, pollingVenue: null },
  you: { days: 3, isGovernor: false, isCandidate: false, votedFor: null, run: { ok: true, checks: [] }, vote: { ok: true, checks: [] }, announce: { ok: false, code: 'not_governor', reason: 'Only the Chairman can post.' } },
})

test('Politics: the seat, its quorum, candidates with their party, the treasury and a rule nobody but the officeholder can change', async () => {
  const cityId = app.game.view.value.cityId
  civic.put(`politics:${cityId}`, overview(cityId))
  civic.put(`gov:${cityId}`, ballot())
  const html = await render()
  const words = text(html)
  assert.ok(words.includes('Chairman of Lagos'), words.slice(0, 300))
  assert.ok(words.includes('An election needs at least 3 votes to count'))
  assert.ok(words.includes('Green Hands') && words.includes('Independent'), 'a candidate under a party, one without')
  assert.ok(words.includes('Treasury ₦4,200') && words.includes('Market levy on 1 × Jollof'))
  assert.match(words, /Market levy Added to the price of everything bought at a stall\. 0%/, 'the rule in force')
  assert.ok(!html.includes('type="number"'), 'a resident cannot edit a rule')
  assert.ok(words.includes('You will stand as an independent'))
  assert.ok(words.includes('Run for Chairman · ₦2,000'))
})

test('Politics: the officeholder sees a box for each rule inside its range and the salary button', async () => {
  const cityId = app.game.view.value.cityId
  civic.put(`politics:${cityId}`, overview(cityId, { you: { isOfficeholder: true, salary: 840 } }))
  civic.put(`gov:${cityId}`, ballot())
  const html = await render()
  assert.match(html, /<input[^>]*type="number"[^>]*min="0"[^>]*max="10"/)
  assert.ok(text(html).includes('Draw salary · ₦840'))
})
