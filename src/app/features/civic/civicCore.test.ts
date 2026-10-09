// The civic client without a browser: the cache and its age limit, one request per control, a
// refusal with a reason, the kept request id of a paid write, and the news the Governor badge counts.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FetchJson } from '../../types/client.ts'
import type { CivicNotice } from '../../../types/civic.ts'
import { civicActor, civicNews, createStore, requestSlot, sharedStore } from './civicCore.ts'
import { createCivic } from './civicClient.ts'
import type { CivicDeps } from './civicClient.ts'
import { actorDraft, adsUi, govDraft, govRefusal, govRunRequest, radioDraft } from './civicDrafts.ts'
import { politicsUi, runRequest } from '../politics/politicsDrafts.ts'

function setup(options: { connected?: boolean; answer?: (path: string, body: unknown) => unknown | Promise<unknown> } = {}) {
  const calls: { path: string; method: string; body: unknown; headers?: Record<string, string> }[] = []
  const toasts: { text: string; kind?: string }[] = []
  const kept = new Map<string, string>()
  const clock = { now: 1_000_000 }
  const flags: { connected: boolean; refreshed: number; ids: number; actor: string | null } = { connected: options.connected ?? true, refreshed: 0, ids: 0, actor: 'player-a' }
  const fetchJson = (async (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body, headers: init?.headers })
    const answer = await (options.answer ?? ((): unknown => ({ ok: true })))(path, init?.body)
    if (answer instanceof Error) throw answer
    return answer
  }) as FetchJson
  const deps: CivicDeps = {
    fetchJson, refresh: async () => { flags.refreshed += 1 }, newId: () => `${clock.now}:id-${++flags.ids}`, toast: (text, kind) => { toasts.push({ text, kind }) },
    connected: () => flags.connected, actor: () => flags.actor, cityId: () => 'lagos', linkWhy: () => 'This device has no internet connection.', now: () => clock.now,
  }
  const store = createStore(() => ({ getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => { kept.set(key, value) } }))
  const switchActor = (id: string | null): void => { flags.actor = id; civicActor(store, id) }
  return { civic: createCivic(deps, store), store, calls, toasts, clock, flags, kept, switchActor, deps }
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
  assert.deepEqual(calls[0], { path: '/api/civic/prefs', method: 'POST', body: { cityId: 'lagos', directory: true }, headers: { 'X-Allworld-Actor': 'player-a' } })
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

test('send: a lost answer states uncertainty and keeps the same request safe to retry', async () => {
  const { civic, toasts } = setup({ answer: () => Object.assign(new Error('Failed to fetch'), { code: 'network' }) })
  const result = await civic.send('rent:bb-01', '/api/civic/ads/rent', {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'network')
  assert.match(result.reason ?? '', /We could not confirm the result\. Retry this same request/)
  assert.doesNotMatch(result.reason ?? '', /Nothing was charged/)
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
  assert.equal(JSON.parse(kept.get('joinallworld-civic-news-read:player-a') ?? '{}').lagos, 300, 'remembered for this actor on the device')
  assert.equal(civicNews({ cityId: 'lagos' }, { civic: { since: null } }, store), 0)
})

test('actor replacement blanks held entries and badges immediately; old loads cannot fill or finish the new load', async () => {
  const replies: ((value: unknown) => void)[] = []
  const { civic, store, switchActor } = setup({ answer: () => new Promise((resolve) => replies.push(resolve)) })
  civic.put('pulse:lagos', { notices: [{ at: 200 }] })
  const held = civic.entry('private')
  civic.put('private', { name: 'Ada' })
  let oldAfter = 0, newAfter = 0
  const old = civic.load('private', '/private', { after: () => { oldAfter += 1 } })
  switchActor('player-b')
  assert.equal(held.data, null)
  assert.equal(civicNews({ cityId: 'lagos' }, { civic: { since: 100 } }, store), 0)
  const fresh = civic.load('private', '/private', { after: () => { newAfter += 1 } })
  replies[0]?.({ name: 'Ada' })
  await old
  assert.equal(held.data, null)
  assert.equal(held.loading, true, 'old finally does not complete the replacement load')
  assert.equal(oldAfter, 0)
  replies[1]?.({ name: 'Bola' })
  await fresh
  assert.deepEqual(held.data, { name: 'Bola' })
  assert.equal(newAfter, 1)
})

test('old sends cannot toast, refresh, or release the replacement actor pending tag', async () => {
  const replies: ((value: unknown) => void)[] = []
  const { civic, switchActor, toasts, flags } = setup({ answer: () => new Promise((resolve) => replies.push(resolve)) })
  const old = civic.send('buy', '/buy', {}, { success: 'Ada bought it.' })
  switchActor('player-b')
  const fresh = civic.send('buy', '/buy', {}, { success: 'Bola bought it.' })
  replies[0]?.({ ok: true, code: 'bought', state: {}, market: { owner: 'Ada' } })
  const result = await old
  assert.deepEqual(result, { ok: false, code: 'stale_identity_response' })
  assert.equal(civic.busy('buy'), true)
  assert.deepEqual(toasts, [])
  assert.equal(flags.refreshed, 0)
  replies[1]?.({ ok: true, code: 'bought' })
  assert.equal((await fresh).ok, true)
  assert.equal(civic.busy('buy'), false)
  assert.deepEqual(toasts, [{ text: 'Bola bought it.', kind: 'good' }])
})

test('a resolved answer and extracted payload cannot be reused after replacement or an A-B-A identity change', async () => {
  const { civic, switchActor } = setup({ answer: () => ({ ok: true, code: 'bought', market: { owner: 'Ada' } }) })
  const result = await civic.send('buy', '/buy', {})
  const extracted = result.market
  switchActor('player-b')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'stale_identity_response')
  assert.equal('market' in result, false)
  assert.equal(result.market, undefined)
  civic.put('market', extracted)
  assert.equal(civic.entry('market').data, null)
  civic.put('wrapped', { market: extracted })
  assert.equal(civic.entry('wrapped').data, null)
  switchActor('player-a')
  assert.equal(result.ok, false)
  civic.put('market', extracted)
  assert.equal(civic.entry('market').data, null)
})

test('request ids stay stable for same-actor retries and old completion cannot clear a replacement slot', async () => {
  const { civic, switchActor, calls } = setup({ answer: () => ({ ok: true, code: 'bought' }) })
  const slot = requestSlot(), first = civic.requestId(slot, ['buy'])
  assert.equal(civic.requestId(slot, ['buy']), first)
  const result = await civic.send('buy', '/buy', { requestId: first })
  switchActor('player-b')
  const next = civic.requestId(slot, ['buy'])
  assert.notEqual(next, first)
  civic.requestDone(slot, result)
  assert.equal(slot.id, next)
  assert.equal((await civic.send('buy', '/buy', { requestId: first })).code, 'actor_changed')
  assert.equal(calls.length, 1, 'a raw legacy request id cannot be sent for another actor')
})

test('an identity change during wallet refresh suppresses the completed response and toast', async () => {
  const { civic, deps, switchActor, toasts } = setup({ answer: () => ({ ok: true, code: 'bought', state: {}, market: { owner: 'Ada' } }) })
  deps.refresh = async () => { switchActor('player-b') }
  const result = await civic.send('buy', '/buy', {}, { success: 'Bought.' })
  assert.equal(result.code, 'stale_identity_response')
  assert.equal(result.market, undefined)
  assert.deepEqual(toasts, [])
})

test('a confirmed write remains confirmed when the wallet refresh fails', async () => {
  const { civic, deps } = setup({ answer: () => ({ ok: true, code: 'bought', state: {} }) })
  deps.refresh = async () => { throw new Error('Refresh unavailable') }
  assert.equal((await civic.send('buy', '/buy', {})).ok, true)
})

test('an actor mismatch from the host asks for a reload and does not refresh or claim a charge', async () => {
  const { civic, flags, calls, toasts } = setup({ answer: () => Object.assign(new Error('actor_changed'), { code: 'actor_changed', status: 409 }) })
  const result = await civic.send('buy', '/buy', { requestId: '1000000:old-request' })
  assert.equal(result.code, 'actor_changed')
  assert.match(result.reason ?? '', /Your character changed\. Reload/)
  assert.equal(calls[0]?.headers?.['X-Allworld-Actor'], 'player-a')
  assert.equal(flags.refreshed, 0)
  assert.equal(toasts.at(-1)?.text, result.reason)
})

test('late errors and sign-out cannot restore private data or leave the old control pending', async () => {
  let reject: (error: Error) => void = () => {}
  const { civic, switchActor, toasts } = setup({ answer: () => new Promise((_resolve, fail) => { reject = fail }) })
  civic.put('private', { name: 'Ada' })
  const held = civic.entry('private'), sending = civic.send('buy', '/buy', {})
  switchActor(null)
  assert.equal(held.data, null)
  assert.equal(civic.busy('buy'), false)
  reject(new Error('Lost old answer'))
  assert.equal((await sending).code, 'stale_identity_response')
  assert.deepEqual(toasts, [])
})

test('civic and politics forms restore only their actor, including unfinished paid request ids', () => {
  const before = sharedStore.actor.id
  try {
    civicActor(sharedStore, 'draft-actor-a')
    govDraft.slogan = 'Ada slogan'; govDraft.announcement = 'Ada announcement'
    govRunRequest.id = 'ada-request'; govRunRequest.what = 'ada-intent'
    govRefusal.value = { key: 'gov:lagos', code: 'held', reason: 'Ada refusal' }
    adsUi.text = 'Ada advert'; radioDraft.title = 'Ada song'; radioDraft.requestId = 'ada-radio'
    politicsUi.court.statement = 'Ada statement'; politicsUi.grant.purpose = 'Ada purpose'
    runRequest.id = 'ada-politics'; runRequest.what = 'ada-politics-intent'
    civicActor(sharedStore, 'draft-actor-b')
    assert.equal(govDraft.slogan, ''); assert.equal(govDraft.announcement, '')
    assert.equal(govRunRequest.id, null); assert.equal(govRefusal.value, null)
    assert.equal(adsUi.text, ''); assert.equal(radioDraft.title, ''); assert.equal(radioDraft.requestId, null)
    assert.equal(politicsUi.court.statement, ''); assert.equal(politicsUi.grant.purpose, ''); assert.equal(runRequest.id, null)
    govDraft.slogan = 'Bola slogan'; politicsUi.court.statement = 'Bola statement'
    civicActor(sharedStore, null)
    assert.equal(govDraft.slogan, ''); assert.equal(politicsUi.court.statement, '')
    civicActor(sharedStore, 'draft-actor-a')
    assert.equal(govDraft.slogan, 'Ada slogan'); assert.equal(govRunRequest.id, 'ada-request')
    assert.deepEqual(govRefusal.value, { key: 'gov:lagos', code: 'held', reason: 'Ada refusal' }); assert.equal(radioDraft.requestId, 'ada-radio')
    assert.equal(politicsUi.court.statement, 'Ada statement'); assert.equal(runRequest.id, 'ada-politics')
    civicActor(sharedStore, 'draft-actor-a')
    assert.equal(govRunRequest.id, 'ada-request', 'reconnecting the same actor leaves its intent untouched')
    civicActor(sharedStore, 'draft-actor-b')
    assert.equal(govDraft.slogan, 'Bola slogan'); assert.equal(politicsUi.court.statement, 'Bola statement')
  } finally { civicActor(sharedStore, before) }
})

test('actor draft records remove keys belonging only to the previous actor', () => {
  const before = sharedStore.actor.id
  const order = actorDraft<Record<string, number>>(() => ({}))
  try {
    civicActor(sharedStore, 'order-actor-a')
    order.rice = 3
    civicActor(sharedStore, 'order-actor-b')
    assert.deepEqual(order, {})
    order.water = 1
    civicActor(sharedStore, 'order-actor-a')
    assert.deepEqual(order, { rice: 3 })
    civicActor(sharedStore, 'order-actor-b')
    assert.deepEqual(order, { water: 1 })
  } finally { civicActor(sharedStore, before) }
})

test('an ambiguous paid request retains its id when its actor returns, while old responses remain stale', async () => {
  let requests = 0
  const { civic, switchActor, calls } = setup({ answer: () => ++requests === 1 ? new Error('Lost answer') : { ok: true, code: 'bought', duplicate: true } })
  const slot = requestSlot(), id = civic.requestId(slot, ['buy'])
  const saved = { ...slot }
  const lost = await civic.send('buy', '/buy', { requestId: id })
  assert.equal(lost.code, 'network')
  switchActor('player-b')
  civic.requestId(slot, ['buy'])
  switchActor('player-a')
  Object.assign(slot, saved)
  assert.equal(civic.requestId(slot, ['buy']), id)
  assert.equal(lost.code, 'stale_identity_response')
  const retried = await civic.send('buy', '/buy', { requestId: id })
  assert.equal(retried.ok, true); assert.equal(retried.duplicate, true)
  assert.deepEqual(calls.map((call) => call.body), [{ cityId: 'lagos', requestId: id }, { cityId: 'lagos', requestId: id }])
})
