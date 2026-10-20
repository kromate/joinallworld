import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './test-fixture.ts'
import { SHARING_TERMS_VERSION } from '../src/types/sharing.ts'
import { sharingRequest } from './sharing-policy.ts'
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts'
import { siteFile } from './site-files.ts'
import { parsePath } from '../src/paths.ts'

test('a guest may play before agreeing but HTTP sharing is refused until age and current rules are saved', async t => {
  const f = await fixture(t)
  const guest = await f.device('River', { terms: false })
  assert.equal((await f.request('/api/session', undefined, guest.cookie)).status, 200)
  const refused = await f.request('/api/social/messages', { body: 'hello' }, guest.cookie)
  assert.equal(refused.status, 403)
  assert.equal((await refused.json()).error, 'sharing_terms_required')
  for (const body of [{ version: SHARING_TERMS_VERSION }, { version: 'older', over13: true }, { version: SHARING_TERMS_VERSION, over13: false }]) {
    assert.equal((await f.request('/api/sharing/terms', body, guest.cookie)).status, 400)
  }
  const accepted = await f.request('/api/sharing/terms', { version: SHARING_TERMS_VERSION, over13: true }, guest.cookie)
  assert.equal(accepted.status, 200)
  assert.equal((await (await f.request('/api/sharing/terms', undefined, guest.cookie)).json()).accepted, true)
  assert.notEqual((await f.request('/api/social/messages', { body: 'hello' }, guest.cookie)).status, 403)
  await f.server.store.transact(db => { const s = Object.values(db.sessions).find(s => s.publicId === guest.id); if (!s?.sharingTerms) throw Error('No guest acceptance'); s.sharingTerms.version = 'older' })
  assert.equal((await f.request('/api/social/messages', { body: 'hello' }, guest.cookie)).status, 403)
})

test('HTTP media and shop publishing cannot bypass consent; report and block stay available', async t => {
  const f = await fixture(t), guest = await f.device('River', { terms: false })
  for (const path of ['/api/social/images', '/api/social/voice', '/api/feed/media', '/api/feed/post', '/api/feed/reply', '/api/showcase/mine', '/api/showcase/mine/photos', '/api/promote/listings', '/api/neighbourhood/notices', '/api/neighbourhood/meetups/plan', '/api/civic/gov/announce', '/api/civic/radio/shoutout']) {
    assert.equal((await f.request(path, {}, guest.cookie)).status, 403, path)
  }
  for (const path of ['/api/social/reports', '/api/social/block']) {
    const body = await (await f.request(path, {}, guest.cookie)).json()
    assert.notEqual(body.error, 'sharing_terms_required', path)
  }
})

test('raw socket chat and voice cannot bypass consent even for a connected guest', async t => {
  const f = await fixture(t), guest = await f.device('River', { terms: false })
  const peer = await f.socket(guest)
  for (const frame of [{ type: 'dm-send', body: 'hello' }, { type: 'chat', body: 'hello' }, { type: 'voice-state', enabled: true }, { type: 'call-invite', to: 'someone' }]) {
    peer.ws.send(JSON.stringify(frame))
    const result = await peer.next()
    assert.equal(result.type, 'error')
    if (result.type !== 'error') throw Error('Expected a refusal')
    assert.ok(result.code === 'sharing_terms_required' || (['chat', 'voice-state'].includes(frame.type) && result.code === 'join_required'))
  }
})

test('account consent survives another device sign-in and a new terms version asks again', async t => {
  const key = await makeKey('rules-key'), provider = fakeProvider([key]), project = 'rules-test'
  const f = await fixture(t, { env: { ACCOUNTS_FIREBASE_PROJECT_ID: project, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' }, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }) })
  const first = await f.device('River')
  let tokenNumber = 0
  const signIn = async (cookie: string): Promise<string> => {
    const account = await (await f.request('/api/account', undefined, cookie)).json() as { csrf: string }
    const response = await fetch(f.base + '/api/account/sign-in', { method: 'POST', headers: { Origin: f.base, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf: account.csrf, idToken: await signToken(key, claimsFor(project, f.now(), { subject: 'RulesUser', email: 'rules@example.invalid', n: ++tokenNumber })) }) })
    assert.equal(response.status, 200, response.ok ? '' : await response.text())
    return (response.headers.get('set-cookie') ?? '').split(';')[0] || cookie
  }
  assert.equal((await f.request('/api/life?city=lagos', undefined, first.cookie)).status, 200)
  const one = await signIn(first.cookie)
  const accepted = async (cookie: string): Promise<boolean> => (await (await f.request('/api/sharing/terms', undefined, cookie)).json()).accepted
  assert.equal(await accepted(one), false, 'a guest stamp does not stand in for account agreement')
  assert.equal((await f.request('/api/sharing/terms', { version: SHARING_TERMS_VERSION, over13: true }, one)).status, 200)
  const second = await f.device('Lake', { terms: false }), two = await signIn(second.cookie)
  assert.equal(await accepted(two), true)
  await f.server.store.transact(db => { const account = Object.values(db.accounts ?? {}).find(a => a.email === 'rules@example.invalid'); assert.ok(account?.sharingTerms); account.sharingTerms.version = 'older' })
  assert.equal(await accepted(one), false)
  assert.equal(await accepted(two), false)
})

test('Play-header requests refuse external money paths before checkout or request parsing; ordinary web still reaches its route', async t => {
  const f = await fixture(t), guest = await f.device('River')
  for (const path of ['/api/earn/account', '/api/earn/price', '/api/earn/pay', '/api/earn/pay/verify', '/api/promote/order', '/api/promote/order/verify']) {
    const result = await fetch(f.base + path, { method: 'POST', headers: { 'X-Allworld-App': 'play', Cookie: guest.cookie, 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(result.status, 403, path)
    assert.equal((await result.json()).error, 'play_payment_unavailable')
    const web = await (await f.request(path, {}, guest.cookie)).json()
    assert.notEqual(web.error, 'play_payment_unavailable', path)
  }
  const page = await fetch(f.base + '/api/earn/me', { headers: { 'X-Allworld-App': 'play', Cookie: guest.cookie } })
  assert.equal(page.status, 403)
  for (const kind of ['pay', 'chat']) {
    const page = await fetch(f.base + '/api/showcase/example/go', { method: 'POST', headers: { 'X-Allworld-App': 'play', Cookie: guest.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) })
    const body = await page.json()
    assert.equal(body.error === 'play_payment_unavailable', kind === 'pay')
  }
})

test('terms, privacy deletion and shortcut destinations are real pages with correctly sized icons', async t => {
  const f = await fixture(t)
  for (const path of ['/terms', '/privacy#delete']) {
    const result = await f.request(path)
    assert.equal(result.status, 200)
    const html = await result.text()
    assert.match(html, /width=device-width/)
    assert.match(html, /lawyer/)
    assert.match(html, /support@joinallworld.com/)
    assert.doesNotMatch(html, /<script/i)
    if (path.startsWith('/privacy')) assert.match(html, /id="delete"/)
  }
  const manifest = JSON.parse(siteFile('/manifest.webmanifest', '')?.body ?? '{}')
  assert.equal(manifest.shortcuts.length, 3)
  for (const shortcut of manifest.shortcuts) {
    assert.ok(parsePath(shortcut.url), shortcut.url)
    assert.equal(shortcut.icons[0].sizes, '96x96')
    const icon = await import('node:fs/promises').then(fs => fs.readFile(new URL('../public' + shortcut.icons[0].src, import.meta.url)))
    assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [96, 96])
  }
  assert.equal(sharingRequest('GET', '/api/feed/post'), false)
  assert.equal(sharingRequest('POST', '/api/notice'), false, 'signed system announcements are not player publishing')
})
