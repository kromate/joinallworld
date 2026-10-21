// OWNER: scenes (unique places) — the Node host's route for the shared place models (server/places-files.ts), against a temporary folder.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultPlacesDir, servePlaceFile } from './places-files.ts'

const bytes = Buffer.from('glTF-pretend-model')
const hash = createHash('sha256').update(bytes).digest('hex')

test('a stored model is served by its hash with the immutable headers; a bad or absent hash is a 404', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'places-files-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, `${hash}.glb`), bytes)
  await writeFile(join(dir, 'secret.txt'), 'not a model')
  const found = await servePlaceFile(dir, `/assets/places/${hash}.glb`, 'GET')
  assert.equal(found.status, 200)
  assert.deepEqual(found.body, bytes)
  assert.equal(found.headers['Content-Type'], 'model/gltf-binary')
  assert.equal(found.headers['Cache-Control'], 'public, max-age=31536000, immutable')
  assert.equal(found.headers.ETag, `"${hash}"`)
  assert.equal(found.headers['Content-Length'], String(bytes.length))
  for (const path of ['/assets/places/secret.txt', '/assets/places/../secret.glb', `/assets/places/${'b'.repeat(64)}.glb`, '/assets/places/short.glb', `/assets/places/%2e%2e%2f${hash}.glb`]) {
    const answer = await servePlaceFile(dir, path, 'GET')
    assert.equal(answer.status, 404, path)
    assert.equal(answer.headers['Cache-Control'], 'no-store', path)
  }
  assert.equal((await servePlaceFile(dir, `/assets/places/${hash}.glb`, 'GET', `"${hash}"`)).status, 304)
  const head = await servePlaceFile(dir, `/assets/places/${hash}.glb`, 'HEAD')
  assert.equal(head.status, 200); assert.equal(head.body, null)
})

test('the folder is PLACES_DIR, else scripts/places/out/store under the working directory', () => {
  assert.equal(defaultPlacesDir({ PLACES_DIR: '/data/places' }), '/data/places')
  assert.ok(defaultPlacesDir({}).endsWith('scripts/places/out/store'))
})
