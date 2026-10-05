// The account screens without a DOM: the model's sentences, the provider client's requests, the
// store's steps and the Google button's credential check. Every request goes to a stand-in made
// here — no test reaches a real provider or a real server.
import assert from 'node:assert/strict'
import test from 'node:test'
import { NEW_PASSWORD_MIN, PROVIDER_TEXT, RESET_SENT, SERVER_TEXT, VERIFY_PENDING, VERIFY_SENT, characterChanged, cleanEmail, credentialClaim, emailProblem, outcomeText, passwordProblem, refusalOf, serverText, tokenSaysVerified } from './accountModel.ts'
import { ProviderProblem, createIdentityProvider } from './identityProvider.ts'
import { createAccount } from './accountStore.ts'
import type { AccountDeps } from './accountStore.ts'
import { GOOGLE_SCRIPT, loadGoogleIdentity, newNonce, renderGoogleButton } from './googleButton.ts'
import type { GoogleIdentity } from './googleButton.ts'
import type { FetchJson } from '../../types/client.ts'

const b64 = (value: unknown): string => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** Something shaped like a signed token, with these claims. Nothing verifies it here. */
const jwt = (claims: Record<string, unknown>): string => `${b64({ alg: 'RS256', kid: 'k' })}.${b64(claims)}.c2lnbmF0dXJlLWJ5dGVzLWhlcmU`
const PASSWORD = 'correct horse battery staple'
const KEY = 'test-web-api-key-0000000000000000000000'
const ORIGIN = 'https://game.test'

// ---- the model ----

test('an address and a password are judged by shape only', () => {
  for (const good of ['ada@example.com', '  Ada@Example.COM ', 'a.b+c@sub.example.org']) assert.equal(emailProblem(good), '', good)
  for (const bad of ['', 'ada', 'ada@', '@example.com', 'ada@example', 'a da@example.com', `${'a'.repeat(250)}@example.com`]) assert.equal(emailProblem(bad), 'Enter your e-mail address.', bad)
  assert.equal(cleanEmail('  Ada@Example.COM '), 'ada@example.com')
  assert.equal(passwordProblem('', false), 'Enter your password.')
  assert.equal(passwordProblem('x', false), '', 'signing in accepts whatever password the account has')
  assert.equal(passwordProblem('x'.repeat(NEW_PASSWORD_MIN - 1), true), 'Use a password of at least 10 characters.')
  assert.equal(passwordProblem('x'.repeat(NEW_PASSWORD_MIN), true), '')
  assert.equal(passwordProblem('x'.repeat(129), false), 'Use a password of at most 128 characters.')
})

test('the screen never says whether an address has an account: one sentence per kind of refusal', () => {
  // Signing in: a wrong password, an unknown address, a malformed address and a disabled account read the same.
  const signIn = ['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_EMAIL', 'USER_DISABLED', 'WEAK_PASSWORD : Password should be at least 6 characters'].map((message) => PROVIDER_TEXT[refusalOf(message, 400, false)])
  assert.deepEqual([...new Set(signIn)], ['That e-mail and password do not match an account.'])
  // Creating: an address already in use reads the same as any other refusal that is not about the password.
  const create = ['EMAIL_EXISTS', 'INVALID_EMAIL', 'OPERATION_NOT_ALLOWED', 'ADMIN_ONLY_OPERATION', 'SOMETHING_NEW'].map((message) => PROVIDER_TEXT[refusalOf(message, 400, true)])
  assert.deepEqual([...new Set(create)], ['An account could not be created with that e-mail. If you already have one, sign in or reset your password.'])
  assert.equal(refusalOf('WEAK_PASSWORD : Password should be at least 6 characters', 400, true), 'weak_password')
  assert.equal(refusalOf('PASSWORD_DOES_NOT_MEET_REQUIREMENTS', 400, true), 'weak_password')
  for (const message of ['TOO_MANY_ATTEMPTS_TRY_LATER : try later', 'QUOTA_EXCEEDED']) assert.equal(refusalOf(message, 400, false), 'throttled')
  assert.equal(refusalOf('anything', 429, false), 'throttled'); assert.equal(refusalOf('INTERNAL', 503, true), 'unavailable')
  for (const nothing of [undefined, null, 42, '', 'lower case words']) assert.equal(refusalOf(nothing, 400, false), 'unavailable', String(nothing))
  assert.equal(refusalOf('SOMETHING_NEW', 400, false), 'unavailable', 'an unknown refusal of a sign-in is not presented as a wrong password')
  assert.ok(!Object.values(PROVIDER_TEXT).some((text) => /exists|already registered|not found|no account with/i.test(text)))
  assert.equal(RESET_SENT, 'If that address has an account, an e-mail with a reset link is on its way.')
})

test('server refusals have a sentence each, and anything unknown asks to try again', () => {
  for (const code of ['invalid_token', 'email_unverified', 'parked_full', 'account_rate_limited', 'accounts_unavailable', 'csrf_rejected', 'account_required', 'account_mismatch']) assert.ok(SERVER_TEXT[code], code)
  assert.equal(serverText('email_unverified'), 'Confirm your e-mail address first: open the link we sent you.')
  for (const unknown of ['never_heard_of_it', 'constructor', '__proto__', undefined, 42]) assert.equal(serverText(unknown), 'That did not work. Try again in a moment.', String(unknown))
})

test('after a sign-in: what happened to the character, and whether the cached life must go', () => {
  const ada = { id: 'a', name: 'Ada' }
  assert.equal(outcomeText({ outcome: 'linked', character: ada, parked: null }), 'Saved. Ada is now kept with your account: sign in on any device to play on.')
  assert.equal(outcomeText({ outcome: 'restored', character: ada, parked: null }), 'Welcome back. This device now plays Ada.')
  assert.equal(outcomeText({ outcome: 'parked', character: ada, parked: { id: 'b', name: 'Bola', at: 1 } }), 'This account already has a character, Ada. It is the one in play.')
  assert.equal(outcomeText({ outcome: 'signed_in', character: null, parked: null }), 'You are signed in. The character you start now is kept with your account.')
  assert.deepEqual((['linked', 'restored', 'parked', 'signed_in'] as const).map(characterChanged), [false, true, true, true])
})

test('a token’s own claims are read only to choose a screen; junk reads as "not confirmed"', () => {
  assert.equal(tokenSaysVerified(jwt({ email_verified: true })), true)
  for (const claims of [{ email_verified: false }, { email_verified: 'true' }, {}]) assert.equal(tokenSaysVerified(jwt(claims)), false)
  for (const junk of ['', 'a.b.c', 'not-a-token', `${b64({})}.!!!.x`]) assert.equal(tokenSaysVerified(junk), false, junk)
  assert.equal(credentialClaim(jwt({ nonce: 'abc' }), 'nonce'), 'abc'); assert.equal(credentialClaim('junk', 'nonce'), undefined)
})

// ---- the provider client ----

interface Sent { url: string; init: RequestInit }
/** A provider stand-in: answers by the last path segment of the URL. */
function providerFetch(answers: Record<string, { status?: number; body: unknown } | (() => never)>) {
  const sent: Sent[] = []
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    sent.push({ url, init })
    const name = (url.split('?')[0] ?? '').split(/[/:]/).at(-1) ?? ''
    const answer = answers[name]
    if (typeof answer === 'function') return answer()
    if (!answer) return new Response('{"error":{"message":"NOT_SCRIPTED"}}', { status: 400 })
    return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }) as typeof globalThis.fetch
  return { fetch, sent, bodyOf: (index: number): unknown => { const body = sent[index]?.init.body; return typeof body === 'string' && body.startsWith('{') ? JSON.parse(body) : body } }
}
const refused = (refusal: string) => (error: unknown): boolean => error instanceof ProviderProblem && error.refusal === refusal

test('the provider client: the password goes to the provider only, without this site’s cookies, and comes back as tokens', async () => {
  const tokens = { idToken: jwt({ email_verified: true }), refreshToken: 'refresh-token-0000000000000000' }
  const p = providerFetch({ signInWithPassword: { body: tokens }, signUp: { body: tokens }, sendOobCode: { body: { email: 'ada@example.com' } }, token: { body: { id_token: tokens.idToken, refresh_token: 'refresh-token-1111111111111111' } }, signInWithIdp: { body: { ...tokens, providerId: 'google.com' } }, delete: { body: {} } })
  const provider = createIdentityProvider({ apiKey: KEY, origin: ORIGIN, fetch: p.fetch })
  assert.deepEqual(await provider.signIn('ada@example.com', PASSWORD), tokens)
  assert.equal(p.sent[0]?.url, `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`)
  assert.deepEqual(p.bodyOf(0), { email: 'ada@example.com', password: PASSWORD, returnSecureToken: true })
  assert.deepEqual([p.sent[0]?.init.method, p.sent[0]?.init.credentials, p.sent[0]?.init.cache], ['POST', 'omit', 'no-store'])
  assert.deepEqual(await provider.signUp('ada@example.com', PASSWORD), tokens)
  assert.match(p.sent[1]?.url ?? '', /accounts:signUp\?key=/)
  await provider.sendVerification(tokens.idToken)
  assert.deepEqual(p.bodyOf(2), { requestType: 'VERIFY_EMAIL', idToken: tokens.idToken })
  assert.deepEqual(await provider.refresh(tokens.refreshToken), { idToken: tokens.idToken, refreshToken: 'refresh-token-1111111111111111' })
  assert.equal(p.sent[3]?.url, `https://securetoken.googleapis.com/v1/token?key=${KEY}`)
  assert.equal(p.bodyOf(3), `grant_type=refresh_token&refresh_token=${tokens.refreshToken}`)
  assert.deepEqual(await provider.withGoogle('google-credential'), tokens)
  assert.deepEqual(p.bodyOf(4), { requestUri: ORIGIN, postBody: 'id_token=google-credential&providerId=google.com', returnSecureToken: true, returnIdpCredential: false })
  await provider.deleteUser(tokens.idToken)
  assert.deepEqual(p.bodyOf(5), { idToken: tokens.idToken })
  for (const request of p.sent) { assert.ok(/^https:\/\/(identitytoolkit|securetoken)\.googleapis\.com\//.test(request.url), request.url); assert.equal(request.init.credentials, 'omit') }
})

test('the provider client: refusals are reduced to a kind, and no error carries what was typed', async () => {
  const bad = (message: string, status = 400) => ({ status, body: { error: { code: status, message } } })
  const cases: [Record<string, { status?: number; body: unknown } | (() => never)>, 'signIn' | 'signUp', string][] = [
    [{ signInWithPassword: bad('INVALID_LOGIN_CREDENTIALS') }, 'signIn', 'credentials'], [{ signInWithPassword: bad('EMAIL_NOT_FOUND') }, 'signIn', 'credentials'], [{ signInWithPassword: bad('USER_DISABLED') }, 'signIn', 'credentials'],
    [{ signUp: bad('EMAIL_EXISTS') }, 'signUp', 'not_created'], [{ signUp: bad('WEAK_PASSWORD : too short') }, 'signUp', 'weak_password'],
    [{ signInWithPassword: bad('TOO_MANY_ATTEMPTS_TRY_LATER') }, 'signIn', 'throttled'], [{ signInWithPassword: bad('BACKEND_ERROR', 503) }, 'signIn', 'unavailable'],
    [{ signInWithPassword: { body: 'not json' } }, 'signIn', 'unavailable'], [{ signInWithPassword: { body: { idToken: 'short' } } }, 'signIn', 'unavailable'],
    [{ signInWithPassword: () => { throw new TypeError('fetch failed') } }, 'signIn', 'unavailable'],
  ]
  for (const [answers, method, refusal] of cases) {
    const provider = createIdentityProvider({ apiKey: KEY, origin: ORIGIN, fetch: providerFetch(answers).fetch })
    const error = await provider[method]('ada@example.com', PASSWORD).then(() => null, (thrown: unknown) => thrown)
    assert.ok(refused(refusal)(error), `${Object.keys(answers)[0]} → ${refusal}`)
    assert.ok(!JSON.stringify({ message: (error as Error).message, stack: (error as Error).stack, ...(error as object) }).includes(PASSWORD), 'the password is in no error')
    assert.ok(!(error as Error).message.includes('ada@example.com'))
  }
  // Google asks for an existing password to be proved first: that is not a sign-in.
  const confirm = createIdentityProvider({ apiKey: KEY, origin: ORIGIN, fetch: providerFetch({ signInWithIdp: { body: { needConfirmation: true, providerId: 'google.com' } } }).fetch })
  await assert.rejects(confirm.withGoogle('google-credential'), refused('credentials'))
})

// ---- the store ----

const VERIFIED = jwt({ email_verified: true, sub: 'UidAda' }), UNVERIFIED = jwt({ email_verified: false, sub: 'UidAda' }), FRESH = jwt({ email_verified: true, sub: 'UidAda', n: 2 })
interface ServerCall { path: string; method: string; body: Record<string, unknown> | null }
function setup({ enabled = true, guest = true, account = null as { email: string; provider: 'google' | 'password'; createdAt: number; devices: number } | null, provider = {} as Record<string, { status?: number; body: unknown } | (() => never)>, server = {} as Record<string, (body: Record<string, unknown> | null) => unknown>,
  /** Answer some provider requests by hand (a refresh that changes its answer); anything it returns null for is answered from `provider`. */
  intercept = (() => null) as (url: string) => unknown } = {}) {
  const calls: ServerCall[] = [], effects: string[] = []
  // The anti-forgery token belongs to the cookie: a sign-in that went through set a new cookie, so the server answers with a new token.
  let loaded = 0, cookieToken = 'csrf-of-the-old-cookie'
  const p = providerFetch({ signInWithPassword: { body: { idToken: VERIFIED, refreshToken: 'refresh-token-0000000000000000' } }, sendOobCode: { body: {} }, delete: { body: {} }, ...provider })
  const fetchJson = (async (path: string, options: { method?: string; body?: unknown } = {}) => {
    const call: ServerCall = { path, method: options.method ?? 'GET', body: (options.body ?? null) as Record<string, unknown> | null }
    calls.push(call)
    const handler = server[`${call.method} ${path}`]
    if (handler) { const answer = await handler(call.body); if (path === '/api/account/sign-in') cookieToken = 'csrf-of-the-new-cookie'; return answer }
    if (path === '/api/account') return enabled ? { enabled: true, provider: { apiKey: KEY, googleClientId: '1234567890-testclient.apps.googleusercontent.com' }, csrf: cookieToken, guest, account, character: account ? { id: 'pub-ada', name: 'Ada' } : null, parked: [], serverTime: 1 } : { enabled: false, serverTime: 1 }
    throw Object.assign(new Error('not_found'), { status: 404, code: 'not_found' })
  }) as FetchJson
  const deps: AccountDeps = {
    fetchJson,
    loadProvider: async () => {
      loaded += 1
      const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { const scripted = intercept(String(input)); if (scripted === null) return p.fetch(input, init); p.sent.push({ url: String(input), init: init ?? {} }); return new Response(JSON.stringify(scripted)) }) as typeof globalThis.fetch
      return { createIdentityProvider: (options) => createIdentityProvider({ ...options, fetch }) }
    },
    origin: () => ORIGIN,
    forgetLife: () => { effects.push('forget') },
    reload: () => { effects.push('reload') },
  }
  const store = createAccount(deps)
  return { store, calls, effects, provider: p, providerLoads: () => loaded, posts: () => calls.filter((call) => call.method === 'POST') }
}
/** What the game server answers to a sign-in that went through. */
const SIGNED_IN = (outcome: string, extra: Record<string, unknown> = {}) => () => ({ outcome, created: false, character: { id: 'pub-ada', name: 'Ada' }, parked: null, devices: 1, ended: 0, csrf: 'csrf-of-the-new-cookie', serverTime: 2, ...extra })
/** A refusal as fetchJson throws it. */
const REFUSE = (status: number, code: string) => (): never => { throw Object.assign(new Error(code), { status, code }) }
/** Nothing secret may sit in what the screens can read. */
const noSecrets = (state: object): void => { const text = JSON.stringify(state); for (const secret of [PASSWORD, 'eyJ', 'refresh-token', 'csrf-of']) assert.ok(!text.includes(secret), `the state holds ${secret}`) }

test('store: on a server without accounts nothing is offered, and the provider’s code is never fetched', async () => {
  const f = setup({ enabled: false })
  assert.deepEqual([f.store.state.loaded, f.store.state.enabled], [false, false])
  await f.store.load()
  assert.deepEqual([f.store.state.loaded, f.store.state.enabled, f.store.state.googleClientId, f.store.state.account], [true, false, '', null])
  await f.store.load(); await Promise.all([f.store.load(true), f.store.load(true)])
  assert.equal(f.calls.length, 2, 'one request per load, shared by callers that arrive together')
  assert.equal(f.providerLoads(), 0)
  // A server that cannot be reached leaves accounts hidden rather than broken.
  const down = setup({ server: { 'GET /api/account': () => { throw new Error('Connection lost') } } })
  await down.store.load(); assert.deepEqual([down.store.state.loaded, down.store.state.enabled], [false, false])
})

test('store: save your character with a password — one token handed over with the session’s own anti-forgery token, nothing secret kept', async () => {
  const again = setup({ server: { 'POST /api/account/sign-in': SIGNED_IN('linked') } })
  await again.store.load(); again.store.begin()
  assert.equal(again.providerLoads(), 0, 'opening the screen does not fetch the provider’s code')
  assert.equal(await again.store.withPassword(' Ada@Example.com ', PASSWORD, false), true)
  assert.equal(again.providerLoads(), 1)
  assert.deepEqual(again.provider.bodyOf(0), { email: 'ada@example.com', password: PASSWORD, returnSecureToken: true })
  assert.deepEqual(again.posts(), [{ path: '/api/account/sign-in', method: 'POST', body: { idToken: VERIFIED, csrf: 'csrf-of-the-old-cookie' } }])
  assert.deepEqual([again.store.state.step, again.store.state.error, again.store.state.result?.outcome, again.store.state.busy], ['done', '', 'linked', false])
  noSecrets(again.store.state)
  // The same character stays in play: the page starts again with the new cookie, and the cached life is still right.
  again.store.continueToGame(); assert.deepEqual(again.effects, ['reload'])
})

test('store: restoring on another device forgets the life this device had cached before it starts again', async () => {
  const g = setup({ guest: false, server: { 'POST /api/account/sign-in': SIGNED_IN('restored') } })
  await g.store.load(); g.store.begin()
  assert.equal(await g.store.withPassword('ada@example.com', PASSWORD, false), true)
  assert.equal(g.store.state.step, 'done')
  g.store.continueToGame(); assert.deepEqual(g.effects, ['forget', 'reload'])
})

test('store: local checks stop a bad address or a short new password before anything is sent', async () => {
  const f = setup(); await f.store.load(); f.store.begin()
  assert.equal(await f.store.withPassword('not-an-address', PASSWORD, false), false); assert.equal(f.store.state.error, 'Enter your e-mail address.')
  assert.equal(await f.store.withPassword('ada@example.com', 'short', true), false); assert.equal(f.store.state.error, 'Use a password of at least 10 characters.')
  assert.equal(await f.store.withPassword('ada@example.com', '', false), false); assert.equal(f.store.state.error, 'Enter your password.')
  assert.equal(f.providerLoads(), 0); assert.equal(f.provider.sent.length, 0); assert.deepEqual(f.posts(), [])
})

test('store: creating an account waits for the address to be confirmed, and only then signs in', async () => {
  // The provider's refresh answers "not confirmed yet" once, then "confirmed".
  const refreshed = [{ id_token: UNVERIFIED, refresh_token: 'refresh-token-1111111111111111' }, { id_token: VERIFIED, refresh_token: 'refresh-token-2222222222222222' }]
  let refreshes = 0
  const f = setup({
    provider: { signUp: { body: { idToken: UNVERIFIED, refreshToken: 'refresh-token-0000000000000000' } } },
    intercept: (url) => (url.includes('securetoken') ? refreshed[Math.min(refreshes++, 1)] : null),
    server: { 'POST /api/account/sign-in': SIGNED_IN('linked', { created: true }) },
  })
  const account = f.store
  await account.load(); account.begin()
  assert.equal(await account.withPassword('new@example.com', PASSWORD, true), true)
  assert.deepEqual([account.state.step, account.state.notice], ['verify', VERIFY_SENT])
  assert.deepEqual(f.provider.sent.map((request) => (request.url.split('?')[0] ?? '').split(':').at(-1)), ['signUp', 'sendOobCode'], 'the account is made and the confirmation link is sent')
  assert.deepEqual(f.posts(), [], 'nothing is handed to the game server before the address is confirmed')
  noSecrets(account.state)
  // "I have confirmed it" too early: still waiting, with a sentence that says so.
  assert.equal(await account.confirmed(), false)
  assert.deepEqual([account.state.step, account.state.error], ['verify', VERIFY_PENDING]); assert.deepEqual(f.posts(), [])
  // The link can be sent again.
  assert.equal(await account.resendVerification(), true); assert.equal(account.state.notice, VERIFY_SENT)
  // Confirmed: a fresh token says so, and that is the one handed over.
  assert.equal(await account.confirmed(), true)
  assert.deepEqual(f.posts().map((call) => [call.path, call.body?.idToken]), [['/api/account/sign-in', VERIFIED]])
  assert.deepEqual([account.state.step, account.state.result?.outcome], ['done', 'linked'])
  noSecrets(account.state)
  // Starting over drops the waiting sign-in: "I have confirmed it" then has nothing to continue.
  account.begin()
  assert.equal(await account.confirmed(), false); assert.equal(account.state.step, 'form')
})

test('store: an existing account whose address was never confirmed is sent the link again; the server’s "not confirmed" is honoured too', async () => {
  const f = setup({ provider: { signInWithPassword: { body: { idToken: UNVERIFIED, refreshToken: 'refresh-token-0000000000000000' } } } })
  await f.store.load(); f.store.begin()
  assert.equal(await f.store.withPassword('ada@example.com', PASSWORD, false), true)
  assert.deepEqual([f.store.state.step, f.store.state.notice], ['verify', VERIFY_SENT]); assert.deepEqual(f.posts(), [])
  // A token that claims to be confirmed while the server disagrees: the server decides.
  const g = setup({ provider: { token: { body: { id_token: VERIFIED, refresh_token: 'refresh-token-1111111111111111' } }, signInWithPassword: { body: { idToken: UNVERIFIED, refreshToken: 'refresh-token-0000000000000000' } } }, server: { 'POST /api/account/sign-in': REFUSE(403, 'email_unverified') } })
  await g.store.load(); g.store.begin()
  await g.store.withPassword('ada@example.com', PASSWORD, false)
  assert.equal(await g.store.confirmed(), false)
  assert.deepEqual([g.store.state.step, g.store.state.error], ['verify', VERIFY_PENDING])
})

test('store: a refused sign-in shows one sentence and changes nothing', async () => {
  const wrong = setup({ provider: { signInWithPassword: { status: 400, body: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } } } } })
  await wrong.store.load(); wrong.store.begin()
  assert.equal(await wrong.store.withPassword('ada@example.com', PASSWORD, false), false)
  assert.deepEqual([wrong.store.state.step, wrong.store.state.error, wrong.store.state.busy], ['form', 'That e-mail and password do not match an account.', false]); assert.deepEqual(wrong.posts(), [])
  const taken = setup({ provider: { signUp: { status: 400, body: { error: { message: 'EMAIL_EXISTS' } } } } })
  await taken.store.load(); taken.store.begin()
  await taken.store.withPassword('ada@example.com', PASSWORD, true)
  assert.equal(taken.store.state.error, PROVIDER_TEXT.not_created); assert.equal(taken.store.state.step, 'form')
  for (const [code, text] of [['invalid_token', SERVER_TEXT.invalid_token], ['account_rate_limited', SERVER_TEXT.account_rate_limited], ['parked_full', SERVER_TEXT.parked_full], ['storage_unavailable', SERVER_TEXT.storage_unavailable]] as const) {
    const f = setup({ server: { 'POST /api/account/sign-in': REFUSE(code === 'parked_full' ? 409 : 401, code) } })
    await f.store.load(); f.store.begin()
    assert.equal(await f.store.withPassword('ada@example.com', PASSWORD, false), false)
    assert.deepEqual([f.store.state.step, f.store.state.error], ['form', text], code)
    f.store.continueToGame(); assert.deepEqual(f.effects, ['reload'], 'a refused sign-in never forgets the life on this device')
    noSecrets(f.store.state)
  }
})

test('store: Google sign-in, and the merge choice when both the account and this device had a character', async () => {
  const parked = { id: 'pub-bola', name: 'Bola', at: 5 }
  const f = setup({
    provider: { signInWithIdp: { body: { idToken: VERIFIED, refreshToken: 'refresh-token-0000000000000000', providerId: 'google.com' } }, token: { body: { id_token: FRESH, refresh_token: 'refresh-token-1111111111111111' } } },
    server: { 'POST /api/account/sign-in': SIGNED_IN('parked', { parked }), 'POST /api/account/character': (body) => ({ character: { id: body?.use, name: 'Bola' }, parked: [{ id: 'pub-ada', name: 'Ada', at: 6 }], serverTime: 3 }) },
  })
  await f.store.load(); f.store.begin()
  assert.equal(await f.store.withGoogle('google-credential'), true)
  assert.deepEqual(f.provider.bodyOf(0), { requestUri: ORIGIN, postBody: 'id_token=google-credential&providerId=google.com', returnSecureToken: true, returnIdpCredential: false })
  assert.deepEqual([f.store.state.step, f.store.state.result?.character?.name, f.store.state.result?.parked], ['choice', 'Ada', parked])
  // Play the device's character instead: proved with a FRESH token from the sign-in that just happened (nothing is asked twice), and the NEW cookie's token.
  assert.equal(await f.store.choose('pub-bola'), true)
  assert.match(f.provider.sent.at(-1)?.url ?? '', /securetoken\.googleapis\.com/)
  assert.deepEqual(f.posts().at(-1), { path: '/api/account/character', method: 'POST', body: { use: 'pub-bola', idToken: FRESH, csrf: 'csrf-of-the-new-cookie' } })
  noSecrets(f.store.state)
  assert.deepEqual([f.store.state.step, f.store.state.character, f.store.state.parked.map((item) => item.name)], ['done', { id: 'pub-bola', name: 'Bola' }, ['Ada']])
  f.store.continueToGame(); assert.deepEqual(f.effects, ['forget', 'reload'])
  // Keep the account's character: no request at all.
  const g = setup({ provider: { signInWithIdp: { body: { idToken: VERIFIED, refreshToken: 'refresh-token-0000000000000000', providerId: 'google.com' } } }, server: { 'POST /api/account/sign-in': SIGNED_IN('parked', { parked }) } })
  await g.store.load(); g.store.begin(); await g.store.withGoogle('google-credential')
  const before = g.posts().length
  assert.equal(await g.store.choose(null), true); assert.equal(g.posts().length, before); assert.equal(g.store.state.step, 'done')
  g.store.continueToGame(); assert.deepEqual(g.effects, ['forget', 'reload'], 'the life this device had cached is the one that was set aside')
})

test('store: a reset request says the same thing for every address, and a malformed one is not sent', async () => {
  const f = setup({ server: { 'POST /api/account/password-reset': () => ({ ok: true, serverTime: 2 }) } })
  await f.store.load(); f.store.begin()
  const notices: string[] = []
  for (const email of ['known@example.com', ' Unknown@Example.com ']) { assert.equal(await f.store.resetPassword(email), true); notices.push(f.store.state.notice) }
  assert.deepEqual(notices, [RESET_SENT, RESET_SENT])
  assert.deepEqual(f.posts().map((call) => call.body), [{ email: 'known@example.com', csrf: 'csrf-of-the-old-cookie' }, { email: 'unknown@example.com', csrf: 'csrf-of-the-old-cookie' }])
  assert.equal(f.providerLoads(), 0, 'the reset goes through the game server; the provider’s code is not needed for it')
  assert.equal(await f.store.resetPassword('nope'), false); assert.equal(f.store.state.error, 'Enter your e-mail address.'); assert.equal(f.posts().length, 2)
  const limited = setup({ server: { 'POST /api/account/password-reset': REFUSE(429, 'account_rate_limited') } })
  await limited.store.load(); limited.store.begin()
  assert.equal(await limited.store.resetPassword('ada@example.com'), false); assert.equal(limited.store.state.error, SERVER_TEXT.account_rate_limited)
})

test('store: signing this browser out needs nothing more; ending other sign-ins, the data download and switching character each prove who you are first', async () => {
  const account = { email: 'ada@example.com', provider: 'password' as const, createdAt: 1, devices: 3 }
  const f = setup({ account, server: {
    'POST /api/account/sign-out': () => ({ ok: true }), 'POST /api/account/sign-out-everywhere': () => ({ ok: true, ended: 2 }),
    'POST /api/account/character': () => ({ character: { id: 'pub-bola', name: 'Bola' }, parked: [] }), 'POST /api/account/export': () => ({ account: { email: 'ada@example.com' }, devices: [], character: null, setAside: [], history: [], serverTime: 9 }),
  } })
  await f.store.load()
  assert.deepEqual(f.store.state.account, account)
  assert.equal(await f.store.signOutEverywhere({ password: PASSWORD }), true)
  assert.equal(f.store.state.notice, 'Signed out on 2 other devices.'); assert.deepEqual(f.effects, [], 'this device stays signed in: no reload')
  assert.equal((await f.store.exportData({ password: PASSWORD }))?.account.email, 'ada@example.com')
  assert.equal(await f.store.switchTo('pub-bola', { password: PASSWORD }), true); assert.deepEqual(f.effects, ['forget', 'reload'])
  // Each of the three signed in again at the provider with the ACCOUNT's address and handed that fresh token over.
  assert.deepEqual(f.provider.sent.map((request) => (request.url.split('?')[0] ?? '').split(':').at(-1)), ['signInWithPassword', 'signInWithPassword', 'signInWithPassword'])
  assert.deepEqual(f.provider.bodyOf(0), { email: 'ada@example.com', password: PASSWORD, returnSecureToken: true })
  assert.deepEqual(f.posts().map((call) => [call.path, call.body]), [['/api/account/sign-out-everywhere', { idToken: VERIFIED, csrf: 'csrf-of-the-old-cookie' }], ['/api/account/export', { idToken: VERIFIED, csrf: 'csrf-of-the-old-cookie' }], ['/api/account/character', { use: 'pub-bola', idToken: VERIFIED, csrf: 'csrf-of-the-old-cookie' }]])
  assert.ok(!f.calls.some((call) => call.method === 'GET' && call.path.includes('export')), 'the data is never asked for with a GET')
  noSecrets(f.store.state)
  // Signing out: the cookie's own token, no sign-in at the provider.
  const sent = f.provider.sent.length
  assert.equal(await f.store.signOut(), true); assert.deepEqual(f.effects, ['forget', 'reload', 'forget', 'reload'])
  assert.deepEqual(f.posts().at(-1), { path: '/api/account/sign-out', method: 'POST', body: { csrf: 'csrf-of-the-old-cookie' } }); assert.equal(f.provider.sent.length, sent)
  // A wrong password stops each of them before the game server is asked anything.
  const wrong = setup({ account, provider: { signInWithPassword: { status: 400, body: { error: { message: 'INVALID_PASSWORD' } } } } })
  await wrong.store.load()
  assert.equal(await wrong.store.signOutEverywhere({ password: 'no' }), false); assert.equal(await wrong.store.switchTo('pub-bola', { password: 'no' }), false); assert.equal(await wrong.store.exportData({ password: 'no' }), null)
  assert.deepEqual([wrong.posts().length, wrong.effects.length, wrong.store.state.error], [0, 0, 'That e-mail and password do not match an account.'])
  const guest = setup({ server: { 'POST /api/account/sign-out': REFUSE(409, 'account_required') } })
  await guest.store.load()
  assert.equal(await guest.store.signOut(), false); assert.equal(guest.store.state.error, SERVER_TEXT.account_required); assert.deepEqual(guest.effects, [], 'a refused sign-out forgets nothing')
})

test('store: accounts switched off — a browser still signed in is told who it is and can sign out; nothing else is offered', async () => {
  const f = setup({ server: { 'GET /api/account': () => ({ enabled: false, csrf: 'csrf-of-the-old-cookie', account: { email: 'ada@example.com', provider: 'password', createdAt: 1, devices: 1 }, character: { id: 'pub-ada', name: 'Ada' }, serverTime: 1 }), 'POST /api/account/sign-out': () => ({ ok: true }) } })
  await f.store.load()
  assert.deepEqual([f.store.state.enabled, f.store.state.account?.email, f.store.state.googleClientId], [false, 'ada@example.com', ''])
  assert.equal(await f.store.signOut(), true)
  assert.deepEqual(f.posts(), [{ path: '/api/account/sign-out', method: 'POST', body: { csrf: 'csrf-of-the-old-cookie' } }]); assert.deepEqual(f.effects, ['forget', 'reload'])
})

test('after a sign-in the screen says how many devices are signed in, and when others were signed out', async () => {
  const { devicesText } = await import('./accountModel.ts')
  assert.equal(devicesText({ devices: 1, ended: 0 }), '')
  assert.equal(devicesText({ devices: 3, ended: 0 }), '3 devices are signed in to this account. If one of them is not yours, use “Sign out everywhere else” in Settings.')
  assert.equal(devicesText({ devices: 1, ended: 1 }), 'One other device that was signed in to this account before has been signed out.')
  assert.equal(devicesText({ devices: 1, ended: 2 }), '2 other devices that were signed in to this account before have been signed out.')
  const f = setup({ server: { 'POST /api/account/sign-in': SIGNED_IN('linked', { devices: 1, ended: 1 }) } })
  await f.store.load(); f.store.begin(); await f.store.withPassword('ada@example.com', PASSWORD, false)
  assert.deepEqual([f.store.state.result?.devices, f.store.state.result?.ended], [1, 1])
})

test('store: deleting proves who you are again, deletes here first and at the provider second, and keeps or erases the character as asked', async () => {
  const account = { email: 'ada@example.com', provider: 'password' as const, createdAt: 1, devices: 1 }
  const f = setup({ account, server: { 'POST /api/account/delete': () => ({ ok: true, kept: true }) } })
  await f.store.load()
  assert.equal(await f.store.remove({ password: PASSWORD }, false), true)
  assert.deepEqual(f.provider.sent.map((request) => (request.url.split('?')[0] ?? '').split(':').at(-1)), ['signInWithPassword', 'delete'])
  assert.deepEqual(f.provider.bodyOf(0), { email: 'ada@example.com', password: PASSWORD, returnSecureToken: true }, 'the address is the account’s own, never one typed into the delete form')
  assert.deepEqual(f.posts(), [{ path: '/api/account/delete', method: 'POST', body: { idToken: VERIFIED, confirm: 'delete', erase: false, csrf: 'csrf-of-the-old-cookie' } }])
  assert.deepEqual(f.effects, ['reload'], 'the character stays on this device as a guest life')
  // Erasing the character too: the cached life goes.
  const erase = setup({ account, server: { 'POST /api/account/delete': () => ({ ok: true, kept: false }) } })
  await erase.store.load(); await erase.store.remove({ password: PASSWORD }, true)
  assert.equal(erase.posts()[0]?.body?.erase, true); assert.deepEqual(erase.effects, ['forget', 'reload'])
  // A wrong password: nothing reaches the game server, nothing is deleted anywhere.
  const wrong = setup({ account, provider: { signInWithPassword: { status: 400, body: { error: { message: 'INVALID_PASSWORD' } } } } })
  await wrong.store.load()
  assert.equal(await wrong.store.remove({ password: 'not it' }, true), false)
  assert.deepEqual([wrong.store.state.error, wrong.posts().length, wrong.effects.length], ['That e-mail and password do not match an account.', 0, 0])
  // The server refuses (another account's sign-in): the provider's record is NOT removed.
  const refused = setup({ account, server: { 'POST /api/account/delete': REFUSE(403, 'account_mismatch') } })
  await refused.store.load()
  assert.equal(await refused.store.remove({ password: PASSWORD }, false), false)
  assert.equal(refused.store.state.error, SERVER_TEXT.account_mismatch); assert.ok(!refused.provider.sent.some((request) => request.url.includes(':delete')))
  // A Google account confirms with a new Google credential.
  const google = setup({ account: { ...account, provider: 'google' }, provider: { signInWithIdp: { body: { idToken: VERIFIED, refreshToken: 'refresh-token-0000000000000000', providerId: 'google.com' } } }, server: { 'POST /api/account/delete': () => ({ ok: true, kept: true }) } })
  await google.store.load()
  assert.equal(await google.store.remove({ credential: 'google-credential' }, false), true)
  assert.deepEqual(google.provider.sent.map((request) => (request.url.split('?')[0] ?? '').split(':').at(-1)), ['signInWithIdp', 'delete'])
})

test('store: one thing at a time — a second tap while a request is out does nothing', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const f = setup({ server: { 'POST /api/account/sign-out': async () => { await gate; return { ok: true } } } })
  await f.store.load()
  const first = f.store.signOut()
  assert.equal(f.store.state.busy, true)
  assert.equal(await f.store.signOut(), false); assert.equal(await f.store.signOutEverywhere({ password: PASSWORD }), false)
  release(); assert.equal(await first, true)
  assert.equal(f.posts().length, 1); assert.equal(f.store.state.busy, false)
})

// ---- the Google button ----

function fakeGoogle() {
  const made: { options: Parameters<GoogleIdentity['initialize']>[0] | null; rendered: unknown[]; cancelled: number } = { options: null, rendered: [], cancelled: 0 }
  const api: GoogleIdentity = { initialize(options) { made.options = options }, renderButton(_host, options) { made.rendered.push(options) }, cancel() { made.cancelled += 1 } }
  return { api, made }
}
const host = (): HTMLElement => ({ clientWidth: 320, replaceChildren() {} }) as unknown as HTMLElement
const credential = (nonce: string): string => jwt({ iss: 'https://accounts.google.com', sub: '1234567890', nonce, padding: 'x'.repeat(60) })

test('the Google button: Google draws it, and only a credential made for THIS button is passed on', () => {
  const { api, made } = fakeGoogle(), got: string[] = []
  const remove = renderGoogleButton(api, host(), 'client-id', (value) => got.push(value), 'nonce-of-this-button')
  assert.deepEqual([made.options?.client_id, made.options?.nonce, made.options?.auto_select], ['client-id', 'nonce-of-this-button', false])
  assert.deepEqual(made.rendered, [{ type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: 320 }])
  made.options?.callback({ credential: credential('another-nonce') })
  made.options?.callback({ credential: 'short' }); made.options?.callback({}); made.options?.callback(null); made.options?.callback({ credential: 42 })
  assert.deepEqual(got, [], 'a credential with another nonce, or none, is ignored')
  const good = credential('nonce-of-this-button')
  made.options?.callback({ credential: good })
  assert.deepEqual(got, [good])
  remove(); assert.equal(made.cancelled, 1)
  made.options?.callback({ credential: good })
  assert.deepEqual(got, [good], 'after the button is removed nothing is passed on')
  assert.match(newNonce(), /^[0-9a-f]{32}$/); assert.notEqual(newNonce(), newNonce())
})

test('the Google button: its script is added only when asked for, from Google’s own address, and a failure is reported', async () => {
  const added: { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null; remove(): void }[] = []
  const doc = { createElement: () => ({ src: '', async: false, referrerPolicy: '', onload: null, onerror: null, remove() {} }), head: { append(script: (typeof added)[number]) { added.push(script) } } } as unknown as Document
  const failing = loadGoogleIdentity(doc)
  assert.equal(added.length, 1); assert.equal(added[0]?.src, GOOGLE_SCRIPT); assert.equal(GOOGLE_SCRIPT, 'https://accounts.google.com/gsi/client')
  added[0]?.onerror?.()
  await assert.rejects(failing, /could not be loaded/)
  const { api } = fakeGoogle()
  const loading = loadGoogleIdentity(doc)
  Reflect.set(globalThis, 'google', { accounts: { id: api } })
  try {
    added[1]?.onload?.()
    assert.equal(await loading, api)
    assert.equal(await loadGoogleIdentity(doc), api, 'once it is there the script is not added again'); assert.equal(added.length, 2)
  } finally { Reflect.deleteProperty(globalThis, 'google') }
})
