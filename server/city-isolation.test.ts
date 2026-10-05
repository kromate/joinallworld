import test from 'node:test'
import assert from 'node:assert/strict'
import { createLife } from '../src/life.ts'
import { cityOf, emptyCivic } from './civic/data.ts'
import { adsView, rent } from './civic/ads.ts'
import { addShoutout, radioView } from './civic/radio.ts'
import { huntCounters, neighboursView, richListView } from './civic/residents.ts'
import { count, touch } from './growth/metrics.ts'
import { digestForLife, messageLifeOf } from './growth/outreach.ts'
import { factsFor } from './growth/share.ts'
import { ratingsForCity, takePendingTableResults } from './growth/tables.ts'
import { createServerTelemetry } from './telemetry/index.ts'
import type { GrowthCollection, GrowthPlayerRecord, SessionRecord } from './types.ts'

const NOW = 1_700_000_000_000
const ADA = '123e4567-e89b-42d3-a456-426614174000'

function growth(): GrowthCollection {
  return { salt: 'city-isolation-salt', players: {}, shares: {}, metrics: {}, tables: {}, sweptAt: 0 }
}

function player(): GrowthPlayerRecord {
  return { seen: 0, devices: [], ref: null, invited: {}, counted: 0, owed: [], shares: { day: 0, n: 0 }, consent: { age: 'adult', push: false, email: false, at: NOW }, table: null, wins: [] }
}

test('civic collections isolate residents, rich lists, neighbours, governor data, ads, hunt and radio by city', () => {
  const civic = emptyCivic()
  const lagos = cityOf(civic, 'lagos')
  const ibadan = cityOf(civic, 'ibadan')
  lagos.residents[ADA] = { name: 'Ada', house: 'yaba', since: NOW, lastSeen: NOW, day: 1, cash: 50_000, week: 1, earned: 10_000, gems: 3, claims: 1 }
  lagos.visits = 1
  lagos.hunt = { found: 3, claims: 1, byDay: { '19675': 3 } }
  lagos.gov.announcements.push({ id: 'a1', by: { id: ADA, name: 'Ada' }, text: 'Lagos only', at: NOW, term: 1 })
  const roads = [{ id: 'bb-city', near: 'park', road: 'City Road' }]
  rent(lagos, NOW, { id: ADA, name: 'Ada' }, 'billboard', 'bb-city', { text: 'Hello', colour: 'gold', icon: 'star' }, roads)
  addShoutout(lagos, NOW, { id: ADA, name: 'Ada' }, 'club-a', { title: 'One City', artist: 'Ada' }, 'r1')

  assert.deepEqual(Object.keys(ibadan.residents), [])
  assert.deepEqual(richListView(ibadan, NOW, 86_400_000, {}, null).balances, [])
  assert.equal(neighboursView(ibadan, NOW, 86_400_000, () => false, {}, null, [{ id: 'bodija', name: 'Bodija' }]).total, 0)
  assert.deepEqual(ibadan.gov.announcements, [])
  assert.equal(adsView(ibadan, NOW, null, roads).billboards.slots[0]?.ad, null)
  assert.deepEqual(huntCounters(ibadan, NOW), { found: 0, today: 0, claims: 0 })
  assert.deepEqual(radioView(ibadan, NOW, 'club-a', null, ['club-a']).queue, [])
  assert.equal(radioView(lagos, NOW, 'club-a', null, ['club-a']).playing?.title, 'One City')
})

test('privacy preferences follow the person while city civic records stay isolated', () => {
  const civic = emptyCivic()
  civic.prefs[ADA] = { richList: true, directory: true }
  for (const cityId of ['lagos', 'ibadan'] as const) {
    const city = cityOf(civic, cityId)
    city.residents[ADA] = { name: 'Ada', house: null, since: NOW, lastSeen: NOW, day: 1, cash: 100, week: 1, earned: 50, gems: 0, claims: 0 }
    assert.equal(richListView(city, NOW, 86_400_000, civic.prefs, ADA).you?.listed, false)
    assert.equal(neighboursView(city, NOW, 86_400_000, () => true, civic.prefs, null).listed, 0)
  }
})

test('growth metrics and ratings are city-scoped while pending payouts and pair caps stay account-global', () => {
  const g = growth()
  count(g, NOW, 'lagos', 'sessions')
  count(g, NOW, 'ibadan', 'sessions', 2)
  const lagosLife = createLife(null, { now: NOW, cityId: 'lagos' })
  const ibadanLife = createLife({ estate: { city: 'ibadan' } }, { now: NOW, cityId: 'ibadan' })
  touch(g, NOW, ADA, lagosLife)
  touch(g, NOW, ADA, ibadanLife)
  assert.equal(Object.values(g.metrics.cities?.lagos?.days ?? {})[0]?.sessions, 1)
  assert.equal(Object.values(g.metrics.cities?.ibadan?.days ?? {})[0]?.sessions, 2)
  assert.notEqual(g.metrics.cities?.lagos?.lives, g.metrics.cities?.ibadan?.lives)

  ratingsForCity(g, 'lagos')[ADA] = { whot: { rating: 1200, played: 1, won: 1 } }
  ratingsForCity(g, 'ibadan')[ADA] = { whot: { rating: 900, played: 1, won: 0 } }
  assert.equal(ratingsForCity(g, 'lagos')[ADA]?.whot?.rating, 1200)
  assert.equal(ratingsForCity(g, 'ibadan')[ADA]?.whot?.rating, 900)
  g.tables.pairs = { day: 1, counts: { 'ada|bola': 3 } }
  assert.equal(g.tables.pairs.counts['ada|bola'], 3, 'the anti-farming pair cap is global across travel')

  const profile = player()
  profile.wins.push(
    { cityId: 'lagos', id: 'l1', game: 'whot', label: 'Whot', won: true, human: true, counted: true },
    { cityId: 'ibadan', id: 'i1', game: 'whot', label: 'Whot', won: true, human: true, counted: true },
  )
  assert.deepEqual(takePendingTableResults(profile, 'ibadan').map((result) => result.id), ['i1'])
  assert.deepEqual(profile.wins.map((result) => result.id), ['l1'], 'a Lagos payout cannot be claimed after travelling to Ibadan')
})

test('share facts use the character city rather than a caller-selected storage key', () => {
  const state = createLife({ estate: { city: 'ibadan' } }, { now: NOW, cityId: 'ibadan' })
  const facts = factsFor('missions', { name: 'Ada' }, state, 'lagos', NOW, player())
  assert.equal(facts?.city, 'Ibadan')
})

test('scheduled digests follow the character city, not the most recently updated stray life', () => {
  const lagos = createLife(null, { now: NOW, cityId: 'lagos' })
  const ibadan = createLife({ estate: { city: 'ibadan' } }, { now: NOW, cityId: 'ibadan' })
  const session: SessionRecord = {
    secret: 'secret', publicId: ADA, name: 'Ada', expiresAt: NOW + 60_000,
    cities: { lagos: { state: lagos, updatedAt: NOW, salt: 'lagos-salt-123456' }, ibadan: { state: ibadan, updatedAt: NOW - 1000, salt: 'ibadan-salt-12345' } },
    actions: {}, character: { v: 2, city: 'ibadan' },
  }
  const life = messageLifeOf(session, ['lagos', 'ibadan'], NOW)
  if (!life) throw new Error('expected a message life')
  assert.equal(life.cityId, 'ibadan')
  assert.match(digestForLife(life, NOW).digest.subject, /Ibadan/)
})

test('server analytics accepts a registry city dimension and rejects unknown location strings', async () => {
  const calls: string[] = []
  const telemetry = createServerTelemetry({
    env: { POSTHOG_KEY: 'phc_projectkey123', POSTHOG_HOST: 'https://eu.i.posthog.com', TELEMETRY_ENV: 'production', TELEMETRY_DEBUG: '1' },
    fetch: async (_url, init) => { calls.push(String(init?.body ?? '')); return new Response(null, { status: 200 }) },
    now: () => NOW,
  })
  telemetry.consent(ADA, true)
  telemetry.track(ADA, 'chat_message_sent', { venue_id: 'park' }, 'ibadan')
  telemetry.track(ADA, 'chat_message_sent', { venue_id: 'park' }, '6.5,3.2')
  await telemetry.flush()
  const body = calls.join('\n')
  assert.match(body, /"city_id":"ibadan"/)
  assert.equal(body.includes('6.5,3.2'), false)
  await telemetry.close()
})
