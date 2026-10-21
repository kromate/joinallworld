// The installed app's offline page: who registers the service worker (offlineWorker.ts), and what the worker's fetch handler (public/sw.js)
// does with a page load that works, one the server refuses, one with no network, and requests that are not page loads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { installedApp, startOfflineWorker, type OfflineWindow } from './offlineWorker.ts'

const media = (mode: string | null) => (query: string) => ({ matches: mode !== null && query === `(display-mode: ${mode})` })
function fakeWindow(mode: string | null, referrer = '', fails = false): { win: OfflineWindow; registered: string[] } {
  const registered: string[] = []
  const serviceWorker = { register: async (url: string) => { if (fails) throw new Error('no'); registered.push(url); return {} } } as unknown as ServiceWorkerContainer
  return { win: { navigator: { serviceWorker }, matchMedia: media(mode), document: { referrer } }, registered }
}

test('the worker is registered inside the installed app only', async () => {
  for (const [mode, referrer, expected] of [['standalone', '', true], ['fullscreen', '', true], [null, 'android-app://com.joinallworld.app/', true], ['browser', '', false], [null, 'https://www.google.com/', false]] as const) {
    const { win, registered } = fakeWindow(mode, referrer)
    assert.equal(installedApp(win), expected, `${mode} ${referrer}`)
    assert.equal(await startOfflineWorker(win), expected)
    assert.deepEqual(registered, expected ? ['/sw.js'] : [])
  }
})

test('no service worker support, or a failed registration, is quiet', async () => {
  assert.equal(await startOfflineWorker({ matchMedia: media('standalone') }), false)
  assert.equal(await startOfflineWorker(fakeWindow('standalone', '', true).win), false)
})

type Handler = (event: Record<string, unknown>) => void
function worker(network: (request: { url: string }) => Promise<Response>) {
  const handlers = new Map<string, Handler>()
  const scope = { addEventListener: (type: string, handler: Handler) => { handlers.set(type, handler) }, skipWaiting: () => undefined, clients: { claim: async () => undefined }, registration: {} }
  vm.runInNewContext(readFileSync(fileURLToPath(new URL('../../../../public/sw.js', import.meta.url)), 'utf8'), { self: scope, fetch: network, Response })
  return async (request: { url: string; mode: string; method: string }, preloadResponse: Promise<Response | undefined> = Promise.resolve(undefined)): Promise<Response | null> => {
    let answer: Promise<Response> | null = null
    handlers.get('fetch')?.({ request, preloadResponse, respondWith: (response: Promise<Response>) => { answer = response } })
    return answer
  }
}
const page = (url: string) => ({ url, mode: 'navigate', method: 'GET' })

test('a page load that reaches the server is handed back untouched, error pages included', async () => {
  const fetchPage = worker(async () => new Response('server', { status: 500 }))
  const answer = await fetchPage(page('https://joinallworld.com/'))
  assert.equal(answer?.status, 500)
  assert.equal(await answer?.text(), 'server')
  const preloaded = await fetchPage(page('https://joinallworld.com/'), Promise.resolve(new Response('early')))
  assert.equal(await preloaded?.text(), 'early', 'the navigation preload answer is used when there is one')
})

test('a page load with no network shows the offline page, which has no script and retries by itself', async () => {
  const fetchPage = worker(async () => { throw new TypeError('Failed to fetch') })
  const answer = await fetchPage(page('https://joinallworld.com/visit/lagos'), Promise.reject(new TypeError('Failed to fetch')))
  assert.equal(answer?.status, 200, 'Chrome has counted an error status here as a crash of the installed app')
  assert.match(answer?.headers.get('content-type') ?? '', /^text\/html/)
  assert.match(answer?.headers.get('content-security-policy') ?? '', /default-src 'none'/)
  const html = await answer?.text() ?? ''
  assert.match(html, /You are offline/)
  assert.match(html, /http-equiv="refresh" content="10"/)
  assert.doesNotMatch(html, /<script/i)
})

test('requests that are not page loads never pass through the worker', async () => {
  const fetchPage = worker(async () => { throw new Error('must not be called') })
  assert.equal(await fetchPage({ url: 'https://joinallworld.com/assets/a.js', mode: 'cors', method: 'GET' }), null)
  assert.equal(await fetchPage({ url: 'https://joinallworld.com/', mode: 'navigate', method: 'POST' }), null)
})
