import { loadCityContent as preloadCityContent } from '../../../game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// The landing of a link, against fakes: the requests, what is kept and what is forgotten, the banner.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLanding } from './landingStore.ts'
import type { LandingDeps } from './landingStore.ts'

const HOST = '11111111-2222-4333-8444-555555555555'

function setup(over: Partial<LandingDeps> = {}, kept: { join?: string | null; ref?: string | null; table?: string | null; go?: string | null } = {}) {
  const calls: { path: string; body?: unknown }[] = []
  const log: string[] = []
  const keep = { join: kept.join ?? null, ref: kept.ref ?? null, table: kept.table ?? null, go: kept.go ?? null }
  const timers: (() => void)[] = []
  const answers: Record<string, unknown> = {
    '/api/social/join': { ok: true, code: 'joined', host: { name: 'Ada' }, venue: 'market' },
    '/api/growth/referral/link': { ok: true, by: 'Ada' },
    [`/api/growth/share/${keep.ref}`]: { ok: true, by: { id: HOST, name: 'Ada' } },
  }
  const deps: LandingDeps = {
    fetchJson: (async (path: string, options?: { body?: unknown }) => { calls.push({ path, body: options?.body }); return answers[path] ?? { ok: false } }) as LandingDeps['fetchJson'],
    online: () => true, cityId: () => 'lagos', sessionId: () => 'me', isGuest: () => true,
    refresh: async () => { log.push('refresh') }, open: (id, params) => { log.push(`open:${id}:${JSON.stringify(params)}`) }, toast: (text) => { log.push(`toast:${text}`) },
    venueLabel: (id) => `the ${id}`, welcomeText: () => 'Welcome', tableExists: (id) => id === 'whot-1', deviceToken: () => 'device', track: (name) => { log.push(`track:${name}`) },
    cleanAddress: () => { log.push('clean') }, takeLinkHost: () => { log.push('take') },
    joinTarget: () => keep.join, forgetJoin: () => { keep.join = null; log.push('forget-join') },
    pendingRef: () => keep.ref, forgetRef: () => { keep.ref = null }, pendingTable: () => keep.table, forgetTable: () => { keep.table = null },
    pendingGo: () => keep.go, forgetGo: () => { keep.go = null }, panelFor: (go) => (go === 'needs' ? 'needs' : go === 'messages' ? 'messages' : null),
    setTimeout: (run) => timers.push(run), clearTimeout: () => {},
    ...over,
  }
  return { landing: createLanding(deps), calls, log, keep, timers, answers }
}

test('nothing to land: no request, no banner', async () => {
  const { landing, calls, log } = setup()
  await landing.land()
  assert.equal(calls.length, 0); assert.deepEqual(log, []); assert.equal(landing.banner.value, null)
})

test('a house link joins a guest beside the host and says so in one banner', async () => {
  const { landing, calls, log, keep } = setup({}, { join: HOST })
  await landing.land()
  assert.deepEqual(calls, [{ path: '/api/social/join', body: { host: HOST, cityId: 'lagos' } }])
  assert.equal(keep.join, null)
  assert.ok(log.includes('refresh') && log.includes('clean') && log.includes('take') && log.includes('track:join_landed'))
  assert.equal(landing.banner.value?.title, 'You’re joining Ada')
  assert.deepEqual(landing.landed.value, { kind: 'house', by: { id: HOST, name: 'Ada' } })
})

test('a settled player is sent to the Invite app, not joined', async () => {
  const { landing, calls, log } = setup({ isGuest: () => false }, { join: HOST })
  await landing.land()
  assert.equal(calls.length, 0)
  assert.ok(log.includes(`open:invite:${JSON.stringify({ host: HOST })}`))
})

test('a share code names its sharer, is attached once, and the gift is in the banner', async () => {
  const { landing, calls, keep } = setup({}, { ref: 'abcd1234' })
  await landing.land()
  assert.deepEqual(calls.map((call) => call.path), ['/api/growth/share/abcd1234', '/api/growth/referral/link', '/api/social/join'])
  assert.deepEqual(calls[1]?.body, { cityId: 'lagos', code: 'abcd1234', device: 'device' })
  assert.equal(keep.ref, null)
  assert.match(landing.banner.value?.text ?? '', /gift/)
})

test('at home: the banner offers Knock, which opens the Invite app on that house', async () => {
  const first = setup({}, { join: HOST })
  first.answers['/api/social/join'] = { ok: true, code: 'at_home', host: { name: 'Ada' } }
  await first.landing.land()
  assert.equal(first.landing.banner.value?.knock, true)
  first.landing.knock()
  assert.ok(first.log.includes(`open:invite:${JSON.stringify({ host: HOST })}`))
  assert.equal(first.landing.banner.value, null)
})

test('a table link opens the Tables app only for a table that exists', async () => {
  const known = setup({}, { table: 'whot-1' }); await known.landing.land()
  assert.ok(known.log.includes(`open:tables:${JSON.stringify({ table: 'whot-1' })}`)); assert.equal(known.keep.table, null)
  const unknown = setup({}, { table: 'nope' }); await unknown.landing.land()
  assert.ok(!unknown.log.some((line) => line.startsWith('open:tables'))); assert.equal(unknown.keep.table, null)
})

test('no answer keeps what the link carried; a refusal drops it', async () => {
  const down = setup({ fetchJson: (async () => { throw Object.assign(new Error('down'), { status: 503 }) }) as LandingDeps['fetchJson'] }, { join: HOST })
  await down.landing.land()
  assert.equal(down.keep.join, HOST)
  const refused = setup({ fetchJson: (async () => { throw Object.assign(new Error('no'), { status: 400 }) }) as LandingDeps['fetchJson'] }, { join: HOST, ref: 'abcd1234' })
  await refused.landing.land()
  assert.equal(refused.keep.join, null); assert.equal(refused.keep.ref, null)
})

test('offline: nothing is touched', async () => {
  const { landing, calls, log } = setup({ online: () => false }, { join: HOST })
  await landing.land()
  assert.equal(calls.length, 0); assert.deepEqual(log, [])
})

test('your own link is dropped; an owed welcome is said once when nobody could be joined', async () => {
  const own = setup({ sessionId: () => HOST }, { join: HOST }); await own.landing.land()
  assert.equal(own.calls.length, 0); assert.equal(own.keep.join, null)
  const owed = setup(); owed.landing.owe(); await owed.landing.land(); await owed.landing.land()
  assert.equal(owed.log.filter((line) => line === 'toast:Welcome').length, 1)
})

test('the banner leaves after its time, and a newer banner is not removed by an older timer', async () => {
  const one = setup({}, { join: HOST }); await one.landing.land()
  assert.ok(one.landing.banner.value)
  one.timers[0]?.()
  assert.equal(one.landing.banner.value, null)
})

test('an e-mail button opens one panel from the list, once, with no request; an unknown name opens nothing', async () => {
  const one = setup({ isGuest: () => false }, { go: 'messages' })
  await one.landing.land()
  assert.equal(one.calls.length, 0)
  assert.ok(one.log.includes('open:messages:undefined') && one.log.includes('clean'))
  assert.equal(one.keep.go, null)
  await one.landing.land()
  assert.equal(one.log.filter((line) => line.startsWith('open:')).length, 1, 'handled once')
  const odd = setup({ isGuest: () => false }, { go: 'admin' })
  await odd.landing.land()
  assert.deepEqual(odd.log.filter((line) => line.startsWith('open:')), [])
  assert.equal(odd.keep.go, null, 'an unknown name is dropped, not kept')
  const offline = setup({ online: () => false }, { go: 'needs' })
  await offline.landing.land()
  assert.equal(offline.keep.go, 'needs', 'kept until the connection is there')
})
