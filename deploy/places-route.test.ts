// OWNER: scenes (unique places) — the Worker route for the shared place models (deploy/places-route.ts), with a fake R2 bucket and a fake edge cache.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { isPlaceRequest, servePlaceModel } from './places-route.ts'
import type { PlaceBucket, PlaceCache } from './places-route.ts'

const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0x4a, 0x53, 0x4f, 0x4e])
const hash = createHash('sha256').update(bytes).digest('hex')
const origin = 'https://allworld.test'
const ask = (path: string, init: RequestInit = {}) => new Request(`${origin}${path}`, init)

function fakes(contents: Record<string, Uint8Array> = { [`places/${hash}.glb`]: bytes }) {
  const reads: string[] = [], stored = new Map<string, Response>(), puts: string[] = []
  const bucket: PlaceBucket = {
    async get(key) {
      reads.push(key)
      const found = contents[key]
      return found ? { body: new Response(new Uint8Array(found).buffer).body!, size: found.length, arrayBuffer: async () => new Uint8Array(found).buffer } : null
    },
  }
  const cache: PlaceCache = {
    async match(request) { return stored.get(request.url)?.clone() },
    async put(request, response) { puts.push(request.url); stored.set(request.url, response) },
  }
  return { bucket, cache, reads, stored, puts }
}
const settle = async (jobs: Promise<unknown>[]) => { await Promise.all(jobs) }

test('a model is served from R2 key places/<sha256>.glb with the immutable headers and its own bytes', async () => {
  const { bucket, cache, reads } = fakes(), jobs: Promise<unknown>[] = []
  const response = await servePlaceModel(ask(`/assets/places/${hash}.glb`), bucket, cache, work => jobs.push(work))
  await settle(jobs)
  assert.equal(response.status, 200)
  assert.deepEqual(reads, [`places/${hash}.glb`])
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary')
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(response.headers.get('etag'), `"${hash}"`)
  assert.equal(response.headers.get('content-length'), String(bytes.length))
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)
})

test('the edge cache is filled once and then answers without touching R2, whatever the query string', async () => {
  const { bucket, cache, reads, puts } = fakes(), jobs: Promise<unknown>[] = []
  const wait = (work: Promise<unknown>) => jobs.push(work)
  await servePlaceModel(ask(`/assets/places/${hash}.glb`), bucket, cache, wait)
  await settle(jobs)
  assert.deepEqual(puts, [`${origin}/assets/places/${hash}.glb`])
  const again = await servePlaceModel(ask(`/assets/places/${hash}.glb?x=1`), bucket, cache, wait)
  await settle(jobs)
  assert.equal(again.status, 200)
  assert.equal(reads.length, 1, 'the second read came from the cache')
  assert.equal(puts.length, 1)
  assert.deepEqual(new Uint8Array(await again.arrayBuffer()), bytes)
  assert.equal(again.headers.get('cache-control'), 'public, max-age=31536000, immutable')
})

test('a bad address, a missing object and a missing binding are 404s that nothing keeps', async () => {
  const { bucket, cache, reads, puts } = fakes()
  const bad = ['/assets/places/nothex.glb', `/assets/places/${hash.slice(1)}.glb`, `/assets/places/${hash.toUpperCase()}.glb`, `/assets/places/${hash}.glb.map`.replace('.map', '.x.glb'), `/assets/places/../${hash}.glb`, '/assets/places/.glb']
  for (const path of bad) {
    const response = await servePlaceModel(ask(path), bucket, cache)
    assert.equal(response.status, 404, path)
    assert.equal(response.headers.get('cache-control'), 'no-store', path)
  }
  assert.equal(reads.length, 0, 'a malformed address never reaches R2')
  const absent = 'a'.repeat(64)
  const missing = await servePlaceModel(ask(`/assets/places/${absent}.glb`), bucket, cache)
  assert.equal(missing.status, 404); assert.equal(missing.headers.get('cache-control'), 'no-store')
  assert.equal(puts.length, 0, 'a 404 is not cached')
  const noBinding = await servePlaceModel(ask(`/assets/places/${hash}.glb`), undefined, null)
  assert.equal(noBinding.status, 404)
})

test('a matching validator is answered 304 without a read, and HEAD has headers but no body', async () => {
  const { bucket, cache, reads } = fakes()
  const same = await servePlaceModel(ask(`/assets/places/${hash}.glb`, { headers: { 'if-none-match': `"${hash}"` } }), bucket, cache)
  assert.equal(same.status, 304); assert.equal(reads.length, 0)
  const other = await servePlaceModel(ask(`/assets/places/${hash}.glb`, { headers: { 'if-none-match': '"other"' } }), bucket, cache)
  assert.equal(other.status, 200); await other.arrayBuffer()
  const head = await servePlaceModel(ask(`/assets/places/${hash}.glb`, { method: 'HEAD' }), bucket, cache)
  assert.equal(head.status, 200); assert.equal(head.body, null); assert.equal(head.headers.get('content-type'), 'model/gltf-binary')
})

test('only a .glb under /assets/places/ is the route: the atlas and everything else pass through to the asset binding', () => {
  const route = (path: string) => isPlaceRequest(new URL(`${origin}${path}`))
  assert.equal(route(`/assets/places/${hash}.glb`), true)
  assert.equal(route('/assets/places/garbage.glb'), true, 'a malformed model address is still answered here, as a 404')
  assert.equal(route(`/assets/places/trim-${hash}.webp`), false)
  assert.equal(route(`/assets/packs/x/${hash}.glb`), false)
  assert.equal(route('/assets/places/'), false)
})
