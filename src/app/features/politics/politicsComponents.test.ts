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
  treasury: { balance: 4200, ledger: [{ at: 1, kind: 'levy', amount: 120, note: 'Market levy on 1 × Jollof' }] }, you: { isOfficeholder: false, salary: 0, grantRoom: 0 },
  accounts: { income: 5000, salary: 800, granted: 300 }, grants: [{ to: { id: 'g1', name: 'Gbenga' }, amount: 300, purpose: 'School desks', at: 1, party: null }],
  audit: { at: 1, by: { id: 'a', name: 'Ada' }, income: 5000, salary: 800, granted: 300, grants: 1, flags: ['concentration'] }, petition: { signed: 1, needed: 3, mine: false, open: true }, ...patch,
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
  assert.ok(words.includes('This term: ₦5,000 came in, ₦800 was drawn as salary and ₦300 was granted.') && words.includes('Gbenga') && words.includes('School desks'), 'the accounts and the grants are public')
  assert.ok(words.includes('Ask for an audit') && words.includes('Most of the money granted went to one person.'), 'a report and its warning')
  assert.ok(words.includes('Petition to remove the Chairman: 1 of 3 signatures') && words.includes('Sign to remove the Chairman'))
  assert.ok(words.includes('Run for Chairman · ₦2,000'))
})

test('Politics: the officeholder sees a box for each rule inside its range and the salary button', async () => {
  const cityId = app.game.view.value.cityId
  civic.put(`politics:${cityId}`, overview(cityId, { you: { isOfficeholder: true, salary: 840, grantRoom: 1260 } }))
  civic.put(`gov:${cityId}`, ballot())
  const html = await render()
  assert.match(html, /<input[^>]*type="number"[^>]*min="0"[^>]*max="10"/)
  assert.ok(text(html).includes('Draw salary · ₦840'))
})

test('Justice: a sentence in a banner, the force with its sentence, and an offence an officer cannot act on until the offender is here', async () => {
  const cityId = app.game.view.value.cityId
  const { politicsUi } = await load<{ politicsUi: { tab: string } }>('/src/app/features/politics/politicsDrafts.ts')
  civic.put(`politics:${cityId}`, overview(cityId))
  civic.put(`justice:${cityId}`, {
    city: cityId,
    seats: [{ tier: 'city', scope: 'city:x', title: 'Chairman', name: 'Lagos', officers: [{ id: 'o1', name: 'Chi' }], judges: [{ id: 'j1', name: 'Judy' }], capacity: 3, judgeCapacity: 2, bail: 3000, canEnrol: true, sentence: 10 }],
    you: { jail: { until: server.now() + 12 * 60000, minutes: 15, by: { id: 'o1', name: 'Chi' } }, police: { tier: 'city', scope: 'city:x' }, wanted: [{ id: 'o9', kind: 'assault', by: { id: 'me', name: 'Me' }, against: { id: 'b', name: 'Bola' }, city: 'lagos', venue: 'park', at: server.now(), here: false }] },
    offences: [{ id: 'o7', kind: 'assault', by: { id: 'a', name: 'Ada' }, against: { id: 'b', name: 'Bola' }, city: 'lagos', venue: 'park', at: server.now(), here: false }],
    rules: { minDays: 1, minEnergy: 20, cooldownMinutes: 5, offenceHours: 24, arrestsPerHour: 6 },
    court: {
      lawyer: false, judge: { tier: 'city', scope: 'city:x' }, bail: 3000, lawyers: [{ id: 'l1', name: 'Lex' }], fees: { appeal: 500, escalate: 1500 },
      case: { id: 'o5', defendant: { id: 'me', name: 'Me' }, officer: { id: 'o1', name: 'Chi' }, offence: 'o5', tier: 'city', court: 'city:x', filedAt: 1, statement: 'He swung first', counsel: { id: 'l1', name: 'Lex', argument: null }, appeals: 0, status: 'decided',
        ruling: { by: { id: 'j1', name: 'Judy' }, verdict: 'upheld', note: 'It stands', at: 2, tier: 'city' }, lower: null, until: server.now() + 600000 },
      counselFor: [], rulings: [],
      docket: [{ id: 'o6', defendant: { id: 'd', name: 'Dayo' }, officer: { id: 'o1', name: 'Chi' }, offence: 'o6', tier: 'city', court: 'city:x', filedAt: 1, statement: 'Not me', counsel: null, appeals: 0, status: 'open', ruling: null, lower: null, until: null }],
    },
  })
  politicsUi.tab = 'justice'
  try {
    const html = await render()
    const words = text(html)
    assert.ok(words.includes('You are in jail'), words.slice(0, 300))
    assert.ok(words.includes('arrested by Chi') && words.includes('you can message and call people'))
    assert.ok(words.includes('Assault sentence in force: 10 minutes') && words.includes('1 of 3 officers'))
    assert.ok(words.includes('Ada attacked Bola at park') && words.includes('Ada is not here with you. Find them first.'))
    assert.match(html, /<button[^>]*disabled[^>]*>(?:<!--[^>]*-->)*Arrest Ada/)
    assert.ok(words.includes('You hold this seat') && words.includes('You are wanted'))
    assert.ok(words.includes('Bail: ₦3,000') && words.includes('1 of 2 judges: Judy'))
    assert.ok(words.includes('Your case') && words.includes('He swung first') && words.includes('Judy upheld it: It stands'), 'the defendant sees the ruling')
    assert.ok(words.includes('Take it to the state court · ₦1,500') && words.includes('Pay bail · ₦3,000'))
    assert.ok(words.includes('The bench · city court') && words.includes('Dayo, arrested by Chi') && words.includes('Not me'))
    assert.ok(['Uphold', 'Reduce', 'Quash'].every((label) => words.includes(label)))
    assert.ok(words.includes('Give your reasons first'), 'a ruling needs its public reasons')
  } finally { politicsUi.tab = 'city' }
})
