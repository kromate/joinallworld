import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOOK_EVERY_MS, decideChunkFailure, entryScriptOf, isChunkLoadError, noteChunkFailure, resetUpdateNotice, updateAvailable, watchForUpdates } from './updateNotice.ts'

test('a failed import with a different build means reload-banner; same, unknown or no failure means retry', () => {
  assert.equal(decideChunkFailure({ failed: true, currentBuild: '/assets/app-aaa.js', freshBuild: '/assets/app-bbb.js' }), 'reload-banner')
  assert.equal(decideChunkFailure({ failed: true, currentBuild: 'a', freshBuild: 'a' }), 'retry')
  assert.equal(decideChunkFailure({ failed: true, currentBuild: null, freshBuild: 'b' }), 'retry')
  assert.equal(decideChunkFailure({ failed: true, currentBuild: 'a', freshBuild: null }), 'retry')
  assert.equal(decideChunkFailure({ failed: false, currentBuild: 'a', freshBuild: 'b' }), 'retry')
})

test('the entry script is read from the module script tag, and chunk errors are recognised', () => {
  assert.equal(entryScriptOf('<head><script type="module" crossorigin src="/assets/app-AbC.js"></script><link rel="modulepreload" href="/assets/x.js"></head>'), '/assets/app-AbC.js')
  assert.equal(entryScriptOf('<script src="/a.js"></script>'), null)
  assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-1.js')))
  assert.ok(!isChunkLoadError(new Error('boom')))
})

test('noteChunkFailure shows the banner only when the host serves a different entry, and checks once at a time', async () => {
  resetUpdateNotice()
  const doc = { querySelectorAll: () => [{ outerHTML: '<script type="module" src="/assets/app-old.js"></script>' }] } as unknown as Document
  let calls = 0
  const page = (entry: string): typeof fetch => (async () => { calls += 1; return new Response(`<script type="module" src="${entry}"></script>`) }) as typeof fetch
  await noteChunkFailure(page('/assets/app-old.js'), doc, () => 0)
  assert.equal(updateAvailable.value, false)
  await noteChunkFailure(page('/assets/app-new.js'), doc, () => 10) // inside the minute: not asked again
  assert.equal(calls, 1); assert.equal(updateAvailable.value, false)
  await noteChunkFailure(page('/assets/app-new.js'), doc, () => 120_000)
  assert.equal(updateAvailable.value, true)
  resetUpdateNotice()
  await noteChunkFailure((async () => { throw new Error('offline') }) as typeof fetch, doc, () => 0)
  assert.equal(updateAvailable.value, false)
})

/** A fake page: a list of its listeners, a visibility state and its own entry script. */
function fakeDoc(entry = '/assets/app-old.js') {
  const listeners: (() => void)[] = []
  const doc = { visibilityState: 'visible' as 'visible' | 'hidden', querySelectorAll: () => [{ outerHTML: `<script type="module" src="${entry}"></script>` }],
    addEventListener: (_type: string, listener: () => void) => { listeners.push(listener) }, removeEventListener: (_type: string, listener: () => void) => { listeners.splice(listeners.indexOf(listener), 1) } }
  return { doc: doc as unknown as Document, raw: doc, show: () => { for (const listener of [...listeners]) listener() }, listeners }
}
const host = (entry: string, count: { n: number }): typeof fetch => (async () => { count.n += 1; return new Response(`<script type="module" src="${entry}"></script>`) }) as typeof fetch
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

test('a tab shown again after a while asks once whether the host has a newer build, and offers the reload when it does', async () => {
  resetUpdateNotice()
  let time = 1_000
  const page = fakeDoc(), count = { n: 0 }
  const stop = watchForUpdates(page.doc, host('/assets/app-new.js', count), () => time)
  page.show(); await settle()
  assert.deepEqual([count.n, updateAvailable.value], [0, false], 'just loaded: nothing to look at yet')
  time += LOOK_EVERY_MS + 1
  page.raw.visibilityState = 'hidden'; page.show(); await settle()
  assert.equal(count.n, 0, 'a hidden tab is never asked')
  page.raw.visibilityState = 'visible'; page.show(); await settle()
  assert.deepEqual([count.n, updateAvailable.value], [1, true], 'back in view after the interval: a newer build is found')
  time += LOOK_EVERY_MS + 1; page.show(); await settle()
  assert.equal(count.n, 1, 'once the banner is up nothing more is asked')
  stop(); assert.equal(page.listeners.length, 0, 'it stops cleanly')
})

test('the quiet look is never more often than its interval, says nothing when the build is the same or the host is out of reach, and leaves real chunk failures alone', async () => {
  resetUpdateNotice()
  let time = 0
  const page = fakeDoc('/assets/app-old.js'), count = { n: 0 }
  const stop = watchForUpdates(page.doc, host('/assets/app-old.js', count), () => time)
  time += 60_000; page.show(); await settle()
  assert.equal(count.n, 0, 'a minute after loading is too soon')
  time += LOOK_EVERY_MS; page.show(); await settle(); page.show(); await settle()
  assert.deepEqual([count.n, updateAvailable.value], [1, false], 'asked once, the same build, no banner; a second show in the same moment asks nothing')
  stop()
  resetUpdateNotice()
  const offline = watchForUpdates(page.doc, (async () => { throw new Error('offline') }) as typeof fetch, () => time, 1000)
  time += 5000; page.show(); await settle()
  assert.equal(updateAvailable.value, false); offline()
  // A failed chunk afterwards is still judged on its own, whatever the quiet looks did.
  const failing = host('/assets/app-new.js', { n: 0 })
  await noteChunkFailure(failing, page.doc, () => 1_000_000)
  assert.equal(updateAvailable.value, true)
  resetUpdateNotice()
})
