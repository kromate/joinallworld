import assert from 'node:assert/strict'
import test from 'node:test'
import type { LandingDeps } from './landingStore.ts'
import { createLanding } from './landingStore.ts'
import type { LandingLoaderDeps } from './landingLoader.ts'
import { createLandingLoader } from './landingLoader.ts'

function fixture(over: Partial<LandingLoaderDeps> = {}, pending: { join?: string | null; ref?: string | null; table?: string | null; go?: string | null } = {}) {
  const kept = { join: pending.join ?? null, ref: pending.ref ?? null, table: pending.table ?? null, go: pending.go ?? null }
  const events: string[] = []
  const calls: string[] = []
  let imports = 0
  let identity = 'actor-a', city = 'lagos'
  const { load: customLoad, identity: customIdentity, cityId: customCity, ...rest } = over
  const base: LandingLoaderDeps = {
    fetchJson: (async (path: string) => { calls.push(path); return path === '/api/social/join' ? { ok: true, code: 'joined', host: { name: 'Ada' }, venue: 'market' } : {} }) as LandingDeps['fetchJson'],
    online: () => true, cityId: customCity ?? (() => city), identity: customIdentity ?? (() => identity), sessionId: () => 'actor-a', isGuest: () => true,
    refresh: async () => { events.push('refresh') }, open: (id) => { events.push(`open:${id}`) }, toast: (text) => { events.push(`toast:${text}`) }, venueLabel: (id) => id, welcomeText: () => 'Welcome',
    tableExists: () => false, deviceToken: () => 'device', track: (name) => { events.push(`track:${name}`) }, cleanAddress: () => events.push('clean'), takeLinkHost: () => events.push('take'),
    joinTarget: () => kept.join, forgetJoin: () => { kept.join = null }, pendingRef: () => kept.ref, forgetRef: () => { kept.ref = null },
    pendingTable: () => kept.table, forgetTable: () => { kept.table = null }, pendingGo: () => kept.go, forgetGo: () => { kept.go = null },
    panelFor: (go) => go === 'messages' ? 'messages' : null, setTimeout: () => 1, clearTimeout: () => {}, importFailed: () => events.push('import-failed'),
    ...rest,
    load: async () => { imports++; return customLoad ? customLoad() : { createLanding } },
  }
  return { loader: createLandingLoader(base), kept, events, calls, get imports() { return imports }, setIdentity(value: string) { identity = value }, setCity(value: string) { city = value } }
}

test('ordinary connected return does not import the link feature or make requests', async () => {
  const f = fixture()
  const banner = f.loader.banner, landed = f.loader.landed
  await f.loader.land()
  assert.equal(f.imports, 0)
  assert.deepEqual(f.calls, [])
  assert.equal(f.loader.banner, banner)
  assert.equal(f.loader.landed, landed)
})

test('pending link imports the real landing store, preserves refs, and keeps its request order', async () => {
  const f = fixture({}, { join: 'host-public-id' })
  const banner = f.loader.banner, landed = f.loader.landed
  await f.loader.land()
  assert.equal(f.imports, 1)
  assert.deepEqual(f.calls, ['/api/social/join'])
  assert.ok(f.events.indexOf('clean') < f.events.indexOf('take'))
  assert.equal(f.kept.join, null)
  assert.equal(f.loader.banner, banner)
  assert.equal(f.loader.landed, landed)
  assert.equal(f.loader.banner.value?.title, 'You’re joining Ada')
  assert.deepEqual(f.loader.landed.value, { kind: 'house', by: { id: 'host-public-id', name: 'Ada' } })
})

test('an explicit owed welcome loads on demand and is consumed once by the real store', async () => {
  const f = fixture()
  f.loader.owe()
  assert.equal(f.imports, 1, 'the explicit quick-start outcome loads its handler')
  await f.loader.land(); await f.loader.land()
  assert.equal(f.imports, 1)
  assert.equal(f.events.filter((event) => event === 'toast:Welcome').length, 1)
  assert.equal(f.calls.length, 0)
})

test('an import failure reports failure, retains exact link tokens, and retries later', async () => {
  let attempts = 0
  const f = fixture({ load: async () => { attempts++; if (attempts === 1) throw new Error('chunk unavailable'); return { createLanding } } }, { join: 'exact-join', ref: 'exact-ref', table: 'exact-table', go: 'exact-go' })
  await f.loader.land()
  assert.deepEqual(f.kept, { join: 'exact-join', ref: 'exact-ref', table: 'exact-table', go: 'exact-go' })
  assert.ok(f.events.includes('import-failed'))
  assert.deepEqual(f.calls, [])
  await f.loader.land()
  assert.equal(attempts, 2)
  assert.deepEqual(f.calls, ['/api/growth/referral/link', '/api/social/join'], 'a supplied join target means the share lookup is unnecessary')
})

test('a ref-only link looks up its sharer before attaching the referral and joining', async () => {
  const calls: string[] = []
  const f = fixture({ fetchJson: (async (path: string) => {
    calls.push(path)
    if (path === '/api/growth/share/abcd1234') return { ok: true, by: { id: 'share-host', name: 'Ada' } }
    if (path === '/api/growth/referral/link') return { ok: true, by: 'Ada' }
    if (path === '/api/social/join') return { ok: true, code: 'joined', host: { name: 'Ada' }, venue: 'market' }
    return {}
  }) as LandingDeps['fetchJson'] }, { ref: 'abcd1234' })
  await f.loader.land()
  assert.deepEqual(calls, ['/api/growth/share/abcd1234', '/api/growth/referral/link', '/api/social/join'])
  assert.equal(f.loader.banner.value?.title, 'You’re joining Ada')
})

test('same-tick identity and city return still invalidate the deferred continuation', async () => {
  type Loaded = Awaited<ReturnType<LandingLoaderDeps['load']>>
  let release!: (module: Loaded) => void
  const deferred = new Promise<Loaded>((resolve) => { release = resolve })
  const f = fixture({ load: () => deferred }, { join: 'retained' })
  const work = f.loader.land()
  f.setIdentity('actor-b'); f.loader.invalidate()
  f.setCity('ibadan'); f.loader.invalidate()
  f.setIdentity('actor-a'); f.loader.invalidate()
  f.setCity('lagos'); f.loader.invalidate()
  release({ createLanding })
  await work
  assert.deepEqual(f.calls, [], 'the stale load did not reach the real handler')
  assert.equal(f.kept.join, 'retained')
  await f.loader.land()
  assert.deepEqual(f.calls, ['/api/social/join'], 'a fresh call can retry the retained link')
})

test('identity change during the real join request keeps its token and suppresses old result effects', async () => {
  let finish!: (answer: unknown) => void
  let markStarted!: () => void
  const responseScope: { current?: () => boolean } = {}
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const answer = new Promise<unknown>((resolve) => { finish = resolve })
  const calls: string[] = []
  const f = fixture({ fetchJson: (async (path: string, _options?: unknown, current?: () => boolean) => { calls.push(path); responseScope.current = current; markStarted(); return answer }) as LandingDeps['fetchJson'] }, { join: 'retained-host' })
  const work = f.loader.land()
  await started
  assert.equal(responseScope.current?.(), true, 'the transport receives the operation scope guard')
  f.setIdentity('actor-b'); f.loader.invalidate()
  f.setIdentity('actor-a'); f.loader.invalidate()
  assert.equal(responseScope.current?.(), false, 'the guard rejects the request even after identity returns to its original value')
  finish({ ok: true, code: 'joined', host: { name: 'Ada' }, venue: 'market' })
  await work
  assert.equal(f.kept.join, 'retained-host')
  assert.equal(f.loader.landed.value, null)
  assert.equal(f.loader.banner.value, null)
  assert.deepEqual(calls, ['/api/social/join'])
  assert.ok(!f.events.some((event) => event.startsWith('track:') || event === 'refresh' || event.startsWith('toast:')))
})

test('context change during table lookup retains the table and does not publish the old landed result', async () => {
  let finish!: (exists: boolean) => void
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const result = new Promise<boolean>((resolve) => { finish = resolve })
  const f = fixture({ tableExists: () => { markStarted(); return result } }, { join: 'host-public-id', table: 'buka-corner' })
  const work = f.loader.land()
  await started
  f.setIdentity('actor-b'); f.loader.invalidate()
  f.setIdentity('actor-a'); f.loader.invalidate()
  f.setCity('ibadan'); f.loader.invalidate()
  f.setCity('lagos'); f.loader.invalidate()
  finish(true)
  await work
  assert.equal(f.kept.join, null, 'the join completed while its original context was current')
  assert.equal(f.kept.table, 'buka-corner')
  assert.equal(f.loader.landed.value, null, 'the landed view waits until all deferred table work is current')
  assert.equal(f.loader.banner.value, null)
  assert.ok(!f.events.some((event) => event.startsWith('open:')))
})

test('identity or city invalidation clears an old Knock target before it can open', async () => {
  for (const changed of ['identity', 'city'] as const) {
    const f = fixture({ fetchJson: (async () => ({ ok: true, code: 'at_home', host: { name: 'Ada' } })) as LandingDeps['fetchJson'] }, { join: 'host-public-id' })
    await f.loader.land()
    assert.equal(f.loader.banner.value?.knock, true)
    assert.ok(f.loader.landed.value)
    if (changed === 'identity') f.setIdentity('actor-b'); else f.setCity('ibadan')
    f.loader.invalidate()
    assert.equal(f.loader.banner.value, null)
    assert.equal(f.loader.landed.value, null)
    f.loader.knock()
    assert.ok(!f.events.some((event) => event.startsWith('open:invite')))
  }
})

test('an owed welcome imported for an old identity cannot be shown to the next identity', async () => {
  type Loaded = Awaited<ReturnType<LandingLoaderDeps['load']>>
  let release!: (module: Loaded) => void
  const deferred = new Promise<Loaded>((resolve) => { release = resolve })
  const f = fixture({ load: () => deferred })
  f.loader.owe()
  f.setIdentity('actor-b'); f.loader.invalidate()
  release({ createLanding })
  await Promise.resolve()
  await f.loader.land()
  assert.deepEqual(f.calls, [])
  assert.ok(!f.events.some((event) => event.startsWith('toast:')), 'welcome remains bound to actor A')
})

test('permanent link refusal still proceeds to the named table and owed welcome', async () => {
  const events: string[] = []
  const calls: string[] = []
  const f = fixture({
    fetchJson: (async (path: string) => { calls.push(path); throw Object.assign(new Error(`refused ${path}`), { status: 400 }) }) as LandingDeps['fetchJson'],
    tableExists: () => true,
    open: (id) => { events.push(`open:${id}`) },
    toast: (text) => { events.push(`toast:${text}`) },
  }, { ref: 'abcd1234', table: 'buka-corner' })
  f.loader.owe()
  await f.loader.land()
  assert.equal(f.kept.ref, null)
  assert.equal(f.kept.table, null)
  assert.deepEqual(calls, ['/api/growth/share/abcd1234'], 'a refused share lookup skips the join request')
  assert.deepEqual(events, ['open:tables', 'toast:Welcome'])
})
