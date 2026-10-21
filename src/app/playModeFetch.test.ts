import test from 'node:test'
import assert from 'node:assert/strict'
import { PLAY_MODE_KEY, startPlayMode } from './playMode.ts'

type Call = { path: string; method: string; headers: Headers; signal: AbortSignal | null | undefined }

/** A fake network: answers by path, and records what was sent. */
function network(answer: (path: string, call: number) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const target: { fetch?: typeof fetch } = {}
  target.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    calls.push({ path, method: init?.method ?? 'GET', headers: new Headers(init?.headers), signal: init?.signal })
    const { status, body } = answer(path, calls.length)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { calls, target }
}

/** This tab as the Play app (true) or the ordinary web (false), for the length of one test. */
function asTab(t: { after(run: () => void): void }, play: boolean): void {
  const store = new Map<string, string>([[PLAY_MODE_KEY, play ? 'play' : 'web']])
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true })
  t.after(() => { Reflect.deleteProperty(globalThis, 'sessionStorage') })
}

test('inside the Play app every API request carries the app header; other addresses and the web are untouched', async (t) => {
  asTab(t, true)
  const { calls, target } = network(() => ({ status: 200, body: { ok: true } }))
  startPlayMode(target)
  await target.fetch?.('/api/earn/me', { headers: { 'X-Allworld-Actor': 'p1' } })
  await target.fetch?.('https://example.com/api/x')
  assert.equal(calls[0]?.headers.get('X-Allworld-App'), 'play')
  assert.equal(calls[0]?.headers.get('X-Allworld-Actor'), 'p1')
  assert.equal(calls[1]?.headers.get('X-Allworld-App'), null)

  const web = network(() => ({ status: 200, body: { ok: true } }))
  asTab(t, false)
  startPlayMode(web.target)
  await web.target.fetch?.('/api/earn/me')
  assert.equal(web.calls[0]?.headers.get('X-Allworld-App'), null)
})

test('a sharing refusal asks for the rules once and sends the same request again after the player agrees', async (t) => {
  asTab(t, false)
  const { calls, target } = network((path, call) => {
    if (path === '/api/sharing/terms') return { status: 200, body: { version: 'v', accepted: true } }
    return call === 1 ? { status: 403, body: { error: 'sharing_terms_required', code: 'sharing_terms_required' } } : { status: 200, body: { ok: true } }
  })
  startPlayMode(target)
  startPlayMode(target) // a second start does not wrap twice
  const timed = AbortSignal.timeout(60_000)
  const response = await target.fetch?.('/api/feed/post', { method: 'POST', body: '{"text":"hi"}', headers: { 'X-Allworld-Actor': 'p1' }, signal: timed })
  assert.equal(response?.status, 200)
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), ['POST /api/feed/post', 'GET /api/sharing/terms', 'POST /api/feed/post'])
  assert.equal(calls[1]?.headers.get('X-Allworld-Actor'), 'p1', 'the rules are checked for the same character')
  assert.equal(calls[0]?.signal, timed)
  assert.equal(calls[2]?.signal, null, 'the repeat does not inherit a time limit that may have run out')
})

test('when the player does not agree, the original refusal is what the caller sees; other refusals are never retried', async (t) => {
  asTab(t, false)
  const declined = network(path => path === '/api/sharing/terms'
    ? { status: 200, body: { version: 'v', accepted: false } }
    : { status: 403, body: { code: 'sharing_terms_required' } })
  startPlayMode(declined.target)
  const refused = await declined.target.fetch?.('/api/feed/post', { method: 'POST', body: '{}' })
  assert.equal(refused?.status, 403)
  assert.equal(((await refused?.json()) as { code?: string }).code, 'sharing_terms_required', 'the body is still readable')
  assert.equal(declined.calls.length, 2)

  const other = network(() => ({ status: 403, body: { code: 'muted' } }))
  startPlayMode(other.target)
  assert.equal((await other.target.fetch?.('/api/feed/post', { method: 'POST', body: '{}' }))?.status, 403)
  assert.equal(other.calls.length, 1)
})
