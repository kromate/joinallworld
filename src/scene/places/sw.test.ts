// OWNER: scenes (unique places) — public/sw.js: the fetch handler answers only the place files, cache-first in 'allworld-places-v1', never keeps an
// error, and the notification handlers are still there. The worker script is run in a vm context against a fake Cache Storage.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8')
const HASH = 'ab'.repeat(32), ORIGIN = 'https://allworld.test'

class FakeCache {
  entries = new Map<string, Response>(); puts: string[] = []
  async match(key: string) { return this.entries.get(key)?.clone() }
  async put(key: string, response: Response) { this.puts.push(key); this.entries.set(key, response) }
}
/** A same-origin answer as a browser gives it (`type` is 'basic'; a constructed Response says 'default'). */
const basic = (body: string, status = 200): Response => Object.defineProperty(new Response(body, { status }), 'type', { value: 'basic' })
function worker(options: { fetch?: (request: Request) => Promise<Response>; openFails?: boolean } = {}) {
  const listeners = new Map<string, (event: any) => void>(), stores = new Map<string, FakeCache>(), network: string[] = []
  const caches = {
    async open(name: string) { if (options.openFails) throw new Error('quota'); let c = stores.get(name); if (!c) stores.set(name, c = new FakeCache()); return c },
    async keys() { return [...stores.keys()] },
    async delete(name: string) { return stores.delete(name) },
  }
  const self = { addEventListener: (type: string, fn: (event: any) => void) => listeners.set(type, fn), skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] }, caches, location: { origin: ORIGIN }, registration: {} }
  const context = vm.createContext({ self, caches, URL, Response, Request, Headers, Promise, console,
    fetch: async (request: Request) => { network.push(request.url); return options.fetch ? options.fetch(request) : basic('model') } })
  vm.runInContext(source, context)
  return { listeners, stores, network, self }
}
/** Dispatches a fetch event; returns what respondWith got (undefined: the worker left the request to the browser) and the waitUntil promises. */
async function ask(w: ReturnType<typeof worker>, url: string, init: RequestInit = {}) {
  const waits: Promise<unknown>[] = []
  let answered: Promise<Response> | undefined
  w.listeners.get('fetch')!({ request: new Request(url, init), respondWith: (p: Promise<Response>) => { answered = p }, waitUntil: (p: Promise<unknown>) => { waits.push(p) } })
  const response = answered ? await answered : undefined
  await Promise.all(waits)
  return response
}

test('a place model is fetched once and then answered from Cache Storage, whatever the query string', async () => {
  const w = worker()
  const first = await ask(w, `${ORIGIN}/assets/places/${HASH}.glb`)
  assert.equal(first?.status, 200); assert.equal(await first!.text(), 'model')
  assert.equal(w.network.length, 1)
  const cache = w.stores.get('allworld-places-v1')!
  assert.deepEqual(cache.puts, [`${ORIGIN}/assets/places/${HASH}.glb`])
  const again = await ask(w, `${ORIGIN}/assets/places/${HASH}.glb?x=1`)
  assert.equal(await again!.text(), 'model')
  assert.equal(w.network.length, 1, 'the second read never reached the network')
})

test('the two atlas files are kept the same way', async () => {
  const w = worker()
  for (const name of [`trim-${HASH}.webp`, `trim-1024-${HASH}.webp`]) {
    assert.equal((await ask(w, `${ORIGIN}/assets/places/${name}`))?.status, 200)
    assert.equal((await ask(w, `${ORIGIN}/assets/places/${name}`))?.status, 200)
  }
  assert.equal(w.network.length, 2)
})

test('errors, redirects and partial answers are never kept', async () => {
  for (const status of [404, 500, 503, 206]) {
    const w = worker({ fetch: async () => basic('x', status) })
    const response = await ask(w, `${ORIGIN}/assets/places/${HASH}.glb`)
    assert.equal(response?.status, status, 'the answer is passed through')
    assert.deepEqual(w.stores.get('allworld-places-v1')?.puts ?? [], [], `status ${status} is not stored`)
    await ask(w, `${ORIGIN}/assets/places/${HASH}.glb`)
    assert.equal(w.network.length, 2, `status ${status} is asked for again`)
  }
  const offline = worker({ fetch: async () => { throw new TypeError('offline') } })
  await assert.rejects(ask(offline, `${ORIGIN}/assets/places/${HASH}.glb`), /offline/)
  assert.deepEqual(offline.stores.get('allworld-places-v1')?.puts ?? [], [])
})

test('everything else is left to the browser: other paths, other origins, other methods, ranges, malformed hashes', async () => {
  const w = worker()
  for (const url of [`${ORIGIN}/assets/index.js`, `${ORIGIN}/assets/places/short.glb`, `${ORIGIN}/assets/places/${HASH.toUpperCase()}.glb`, `${ORIGIN}/assets/places/${HASH}.glb.x`, `${ORIGIN}/assets/places/trim-${HASH}.png`,
    `${ORIGIN}/assets/packs/${HASH}.glb`, `${ORIGIN}/api/me`, `${ORIGIN}/`, `https://elsewhere.test/assets/places/${HASH}.glb`]) {
    assert.equal(await ask(w, url), undefined, url)
  }
  assert.equal(await ask(w, `${ORIGIN}/assets/places/${HASH}.glb`, { method: 'POST', body: 'x' }), undefined)
  assert.equal(await ask(w, `${ORIGIN}/assets/places/${HASH}.glb`, { headers: { range: 'bytes=0-9' } }), undefined)
  assert.equal(w.network.length, 0); assert.equal(w.stores.size, 0)
})

test('if Cache Storage fails the network answer is used as it is', async () => {
  const w = worker({ openFails: true })
  const response = await ask(w, `${ORIGIN}/assets/places/${HASH}.glb`)
  assert.equal(await response!.text(), 'model')
  assert.equal(w.network.length, 1)
})

test('an update drops older place caches and keeps the current one; push and click handlers are unchanged', async () => {
  const w = worker()
  w.stores.set('allworld-places-v0', new FakeCache()); w.stores.set('allworld-places-v1', new FakeCache()); w.stores.set('someone-elses', new FakeCache())
  let finished: Promise<unknown> | undefined
  w.listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => { finished = p } })
  await finished
  assert.deepEqual([...w.stores.keys()].sort(), ['allworld-places-v1', 'someone-elses'])
  for (const type of ['install', 'activate', 'push', 'notificationclick', 'fetch']) assert.ok(w.listeners.has(type), type)
  assert.match(source, /the only Cache Storage it uses is the place cache/)
})
