import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideChunkFailure, entryScriptOf, isChunkLoadError, noteChunkFailure, resetUpdateNotice, updateAvailable } from './updateNotice.ts'

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
