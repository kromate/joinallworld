// The civic client without a browser: the cache and its age limit, one request per control, a
// refusal with a reason, the kept request id of a paid write, and the news the Governor badge counts.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FetchJson } from '../../types/client.ts'
import type { CivicNotice } from '../../../types/civic.ts'
import { civicNews, createStore, requestSlot } from './civicCore.ts'
import { createCivic } from './civicClient.ts'
import type { CivicDeps } from './civicClient.ts'

function setup(options: { connected?: boolean; answer?: (path: string, body: unknown) => unknown | Promise<unknown> } = {}) {
  const calls: { path: string; method: string; body: unknown }[] = []
  const toasts: { text: string; kind?: string }[] = []
  const kept = new Map<string, string>()
  const clock = { now: 1_000_000 }
  const flags = { connected: options.connected ?? true, refreshed: 0, ids: 0 }
  const fetchJson = (async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body })
    const answer = await (options.answer ?? ((): unknown => ({ ok: true })))(path, init?.body)
    if (answer instanceof Error) throw answer
    return answer
  }) as FetchJson
  const deps: CivicDeps = {
    fetchJson, refresh: async () => { flags.refreshed += 1 }, newId: () => `${clock.now}:id-${++flags.ids}`, toast: (text, kind) => { toasts.push({ text, kind }) },
    connected: () => flags.connected, cityId: () => 'lagos', linkWhy: () => 'This device has no internet connection.', now: () => clock.now,
  }
  const store = createStore(() => ({ getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => { kept.set(key, value) } }))
  return { civic: createCivic(deps, store), store, calls, toasts, clock, flags, kept }
}

test('load: fetched once, kept for maxAge, forced on demand, never while offline', async () => {
  const { civic, calls, clock, flags } = setup({ answer: () => ({ total: 4 }) })
  await civic.load('hood:lagos', '/api/civic/neighbours?city=lagos', { maxAge: 30000 })
  assert.equal(civic.entry<{ total: number }>('hood:lagos').data?.total, 4)
  await civic.load('hood:lagos', '/api/civic/neighbours?city=lagos', { maxAge: 30000 })
  assert.equal(calls.length, 1, 'fresh enough')
  clock.now += 31000
  await civic.load('hood:lagos', '/api/civic/neighbours?city=lagos', { maxAge: 30000 })
  assert.equal(calls.length, 2, 'older than maxAge')
  await civic.load('hood:lagos', '/api/civic/neighbours?city=lagos', { maxAge: 30000, force: true })
  assert.equal(calls.length, 3)
  await civic.load('hood:lagos', '/other', { maxAge: 30000 })
  assert.equal(calls.length, 4, 'another path is another request')
  flags.connected = false
  await civic.load('hood:lagos', '/other', { maxAge: 0, force: true })
  assert.equal(calls.length, 4, 'offline asks nothing')
})

test('load: two at once make one request; a failure keeps the last copy and says why', async () => {
  let answers = 0
  const { civic, calls } = setup({ answer: () => (++answers === 2 ? Object.assign(new Error('x'), { code: 'civic_rate_limited' }) : { n: answers }) })
  await Promise.all([civic.load('k', '/p'), civic.load('k', '/p')])
  assert.equal(calls.length, 1)
  await civic.load('k', '/p', { force: true })
  const item = civic.entry<{ n: number }>('k')
  assert.deepEqual(item.data, { n: 1 }, 'the last good copy stays')
  assert.equal(item.error, 'You are doing that too quickly. Wait a minute and try again.')
  assert.equal(item.loading, false)
  await civic.load('k', '/p', { force: true })
  assert.equal(civic.entry('k').error, null, 'a good answer clears it')
})

test('load: a screen\'s own follow-up runs after the answer, with the entry', async () => {
  const { civic } = setup({ answer: () => ({ radio: { venue: 'quilox' } }) })
  let seen: unknown = null
  await civic.load<{ radio: unknown }>('pulse:lagos', '/pulse', { after: (item) => { seen = item.data?.radio } })
  assert.deepEqual(seen, { venue: 'quilox' })
})

test('send: a pending tag refuses a second press; the pending state ends with the answer', async () => {
  let release: (value: unknown) => void = () => {}
  const { civic, calls, toasts } = setup({ answer: () => new Promise((resolve) => { release = resolve }) })
  const first = civic.send('prefs', '/api/civic/prefs', { directory: true }, { success: 'Done.' })
  assert.equal(civic.busy('prefs'), true)
  assert.deepEqual(await civic.send('prefs', '/api/civic/prefs', {}), { ok: false, code: 'busy' })
  release({ ok: true })
  assert.equal((await first).ok, true)
  assert.equal(civic.busy('prefs'), false)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { path: '/api/civic/prefs', method: 'POST', body: { cityId: 'lagos', directory: true } })
  assert.deepEqual(toasts, [{ text: 'Done.', kind: 'good' }])
})

test('send: offline sends nothing and says so; a refusal is toasted with its reason; a success with a life re-syncs it', async () => {
  const off = setup({ connected: false })
  assert.deepEqual(await off.civic.send('x', '/p', {}), { ok: false, code: 'offline' })
  assert.equal(off.calls.length, 0)
  assert.equal(off.toasts[0]?.text, 'This device has no internet connection. Nothing was sent.')

  const refused = setup({ answer: () => ({ ok: false, code: 'too_new', reason: 'Live here two days first.' }) })
  const result = await refused.civic.send('run', '/api/civic/gov/run', {})
  assert.equal(result.ok, false)
  assert.deepEqual(refused.toasts, [{ text: 'Live here two days first.', kind: 'error' }])
  assert.equal(refused.flags.refreshed, 0)

  const paid = setup({ answer: () => ({ ok: true, code: 'declared', state: {} }) })
  await paid.civic.send('run', '/api/civic/gov/run', {}, { success: 'You are on the ballot.' })
  assert.equal(paid.flags.refreshed, 1, 'the wallet shows the new balance')
})

test('send: a lost answer says nothing was charged and can be tried again', async () => {
  const { civic, toasts } = setup({ answer: () => Object.assign(new Error('Failed to fetch'), { code: 'network' }) })
  const result = await civic.send('rent:bb-01', '/api/civic/ads/rent', {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'network')
  assert.match(result.reason ?? '', /Failed to fetch Nothing was charged; you can try again\./)
  assert.equal(toasts.at(-1)?.kind, 'error')
  assert.equal(civic.busy('rent:bb-01'), false, 'the control is usable again')
})

test('requestId: the same contents repeat the same request; a change or an applied request makes a new one', () => {
  const { civic } = setup()
  const slot = requestSlot()
  const a = civic.requestId(slot, ['lagos', 'Vote Ada'])
  assert.equal(civic.requestId(slot, ['lagos', 'Vote Ada']), a, 'retry after a lost answer: the same id, applied once')
  const b = civic.requestId(slot, ['lagos', 'Vote Ada!'])
  assert.notEqual(b, a, 'different contents are a different request')
  civic.requestDone(slot, { ok: false })
  assert.equal(civic.requestId(slot, ['lagos', 'Vote Ada!']), b, 'a refusal keeps the id')
  civic.requestDone(slot, { ok: true })
  assert.notEqual(civic.requestId(slot, ['lagos', 'Vote Ada!']), b, 'an applied request forgets its id')
})

test('put: replaces the cached copy and clears a failure', () => {
  const { civic } = setup()
  civic.entry('gov:lagos').error = 'old'
  civic.put('gov:lagos', { phase: 'voting' })
  assert.deepEqual(civic.entry('gov:lagos').data, { phase: 'voting' })
  assert.equal(civic.entry('gov:lagos').error, null)
})

test('city news: new to this life and not read yet; opening the Governor app reads it', () => {
  const { civic, store, kept } = setup()
  const notice = (id: string, at: number): CivicNotice => ({ id, kind: 'announcement', at, title: id, text: '' })
  const state = { civic: { since: 150 } }
  assert.equal(civicNews({ cityId: 'lagos' }, state, store), 0, 'nothing loaded: no badge')
  civic.put('pulse:lagos', { notices: [notice('a', 100), notice('b', 200), notice('c', 300)] })
  assert.equal(civicNews({ cityId: 'lagos' }, state, store), 2, 'news from before the life began never counts')
  assert.equal(civic.markNewsRead(), true)
  assert.equal(civicNews({ cityId: 'lagos' }, state, store), 0)
  assert.equal(civic.markNewsRead(), false, 'already read')
  assert.equal(JSON.parse(kept.get('joinallworld-civic-news-read') ?? '{}').lagos, 300, 'remembered on the device')
  assert.equal(civicNews({ cityId: 'lagos' }, { civic: { since: null } }, store), 0)
})

