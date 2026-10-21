// OWNER: scenes (unique places) — warming the current city's LOD1 place models on idle (startPlaceModelWarmup in src/scene/recipe/prefetch.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import { startPlaceModelWarmup } from '../recipe/prefetch.ts'
import type { PlaceLod, PlaceManifest } from './manifest.ts'

const hex = (n: number) => n.toString(16).padStart(64, '0')
const lod = (n: number, bytes: number): PlaceLod => ({ sha256: hex(n), bytes, brotliBytes: 1, triangles: 1 })
function manifest(city: string, ids: string[], offset = 0): PlaceManifest {
  return { schema: 'allworld-place-models', version: 1, city, atlas: { url: `/assets/places/trim-${hex(999)}.webp`, sha256: hex(999) },
    venues: Object.fromEntries(ids.map((id, i) => [id, { archetype: 'x', lod0: lod(100 + offset + i, 1000), lod1: lod(200 + offset + i, 20 + i), lod2: lod(300 + offset + i, 5) }])) }
}
const body = (bytes: number) => new Response(new Uint8Array(bytes).buffer, { status: 200, headers: { 'content-length': String(bytes) } })

function rig(over: Partial<Parameters<typeof startPlaceModelWarmup>[0]> = {}, holdAtStart = false) {
  const queue: (() => void | Promise<void>)[] = [], fetched: string[] = [], loads: string[] = []
  let city = 'alpha', refresh = () => {}, holding = holdAtStart
  const manifests: Record<string, PlaceManifest> = { alpha: manifest('alpha', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), beta: manifest('beta', ['x'], 50) }
  const stop = startPlaceModelWarmup({
    currentCity: () => city, onCityChange: r => { refresh = r; return () => {} }, idle: run => { queue.push(run) }, hold: () => holding,
    loadManifest: async id => { loads.push(id); return manifests[id] ?? null },
    fetcher: async input => { const url = String(input); fetched.push(url); const venue = Object.values(manifests).flatMap(m => Object.values(m.venues)).find(v => url.endsWith(`${v.lod1.sha256}.glb`)); return body(venue!.lod1.bytes) },
    ...over,
  })
  const turn = async () => { const run = queue.shift(); assert.ok(run, 'an idle turn was asked for'); await run() }
  return { queue, fetched, loads, stop, turn, move(next: string) { city = next; refresh() }, hold(on: boolean) { holding = on } }
}

test('warms LOD1 of the current city one file per idle turn, at most six, the arrival venue first', async () => {
  const r = rig({ first: () => 'c' })
  await r.turn()                                   // plans the city
  assert.deepEqual(r.loads, ['alpha']); assert.equal(r.fetched.length, 0)
  for (let i = 0; i < 6; i++) { assert.equal(r.queue.length, 1); await r.turn(); assert.equal(r.fetched.length, i + 1) }
  assert.equal(r.queue.length, 0, 'six files, then it stops')
  const hashes = r.fetched.map(url => url.split('/').at(-1)!.replace('.glb', ''))
  assert.equal(hashes[0], hex(202), 'the arrival venue (c) came first')
  assert.deepEqual(hashes.slice(1), [200, 201, 203, 204, 205].map(hex))
  assert.ok(r.fetched.every(url => /^\/assets\/places\/[0-9a-f]{64}\.glb$/.test(url)), 'only model addresses, only LOD1 (no LOD0 hash)')
  assert.ok(!r.fetched.some(url => url.includes(hex(100))))
  r.stop()
})

test('nothing is fetched while the hold is on (Light mode, Save-Data, 2G), and nothing starts by itself afterwards', async () => {
  const r = rig({}, true)
  r.move('alpha')
  assert.equal(r.queue.length, 0, 'no idle turn is even asked for')
  assert.equal(r.fetched.length + r.loads.length, 0)
  r.hold(false)
  r.move('alpha')
  await r.turn(); await r.turn()
  assert.equal(r.fetched.length, 1)
  r.hold(true)
  await r.turn().catch(() => {})
  assert.equal(r.fetched.length, 1, 'a turn that finds the hold on fetches nothing')
  r.stop()
})

test('a change of city drops the old plan; a city without models, and a failed or wrong-length file, are quietly skipped', async () => {
  const r = rig()
  await r.turn(); await r.turn()
  r.move('beta')
  await r.turn(); await r.turn()
  assert.deepEqual(r.loads, ['alpha', 'beta'])
  assert.equal(r.fetched.length, 2); assert.ok(r.fetched[1]!.endsWith(`${hex(250)}.glb`))
  r.move('nowhere'); await r.turn()
  assert.equal(r.queue.length, 0, 'a city without models asks for nothing more')
  const bad = rig({ fetcher: async () => body(3) })
  await bad.turn(); await bad.turn()
  assert.equal(bad.queue.length, 1, 'the failure is swallowed and the next file is tried')
  bad.stop(); r.stop()
  const stopped = rig(); stopped.stop(); stopped.move('alpha')
  assert.equal(stopped.queue.length, 1, 'the one turn asked for before stopping')
})
