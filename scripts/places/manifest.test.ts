// OWNER: scenes (unique places) — scripts/places/manifest.ts: manifests from packer reports (packed status only, files verified), the generated runtime modules,
// and the committed files being exactly what the generator would write now.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parsePlaceManifest } from '../../src/scene/places/manifest.ts'
import { MANIFEST_DIR, RUNTIME_DIR, atlasOf, buildCityManifest, main, renderAtlasModule, renderCityModule, renderManifestJson, renderRegistry } from './manifest.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const glb = (n: number, size = 32) => { const bytes = new Uint8Array(size); bytes.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0], 0); new DataView(bytes.buffer).setUint32(8, size, true); bytes[16] = n; return bytes }
const ATLAS = atlasOf()

function city(name: string, venues: Record<string, { status: string; tamper?: 'bytes' | 'missing' }>) {
  const out = mkdtempSync(join(tmpdir(), 'places-manifest-')), dir = join(out, name)
  mkdirSync(dir)
  let n = 0
  for (const [venueId, { status, tamper }] of Object.entries(venues)) {
    const packed: Record<string, unknown> = {}
    for (const lod of [0, 1, 2]) {
      const bytes = glb(++n), file = `${venueId}.lod${lod}.${sha(bytes).slice(0, 8)}.glb`
      if (tamper !== 'missing' || lod !== 1) writeFileSync(join(dir, file), tamper === 'bytes' && lod === 2 ? glb(99) : bytes)
      packed[`lod${lod}`] = { file, bytes: bytes.length, brotliBytes: 20, sha256: sha(bytes), triangles: [1000, 300, 40][lod] }
    }
    writeFileSync(join(dir, `${venueId}.json`), JSON.stringify({ city: name, venueId, archetype: 'airport-terminal', status, packed: status === 'ok' ? undefined : packed }))
  }
  return { out, cleanup: () => rmSync(out, { recursive: true, force: true }) }
}

test('only packed reports whose files are what they claim become manifest entries', () => {
  const w = city('testville', { airport: { status: 'packed' }, clinic: { status: 'ok' }, bank: { status: 'rejected' }, mosque: { status: 'packed', tamper: 'bytes' }, church: { status: 'packed', tamper: 'missing' }, hall: { status: 'packed' } })
  try {
    const { manifest, skipped, files } = buildCityManifest('testville', w.out, ATLAS)
    assert.deepEqual(Object.keys(manifest.venues), ['airport', 'hall'], 'sorted, packed and verified only')
    assert.deepEqual(skipped.map(s => s.venueId).sort(), ['bank', 'church', 'clinic', 'mosque'])
    assert.match(skipped.find(s => s.venueId === 'mosque')!.reason, /differs from its report/)
    assert.match(skipped.find(s => s.venueId === 'church')!.reason, /file missing/)
    assert.equal(files.length, 6)
    assert.deepEqual(manifest.venues.airport!.lod2, { sha256: manifest.venues.airport!.lod2.sha256, bytes: 32, brotliBytes: 20, triangles: 40 })
    assert.equal(manifest.atlas.sha256, ATLAS.full.sha256)
    assert.deepEqual(parsePlaceManifest(JSON.parse(renderManifestJson(manifest)), 'testville'), manifest, 'the written JSON parses back to the same manifest')
  } finally { w.cleanup() }
})

test('a venue missing from the output is dropped from the manifest unless --merge keeps it', () => {
  const first = city('testville', { airport: { status: 'packed' }, hall: { status: 'packed' } })
  const second = city('testville', { hall: { status: 'packed' } })
  try {
    const previous = buildCityManifest('testville', first.out, ATLAS).manifest
    const dropped = buildCityManifest('testville', second.out, ATLAS, { previous })
    assert.deepEqual(Object.keys(dropped.manifest.venues), ['hall']); assert.deepEqual(dropped.dropped, ['airport'])
    const merged = buildCityManifest('testville', second.out, ATLAS, { previous, merge: true })
    assert.deepEqual(Object.keys(merged.manifest.venues), ['airport', 'hall']); assert.deepEqual(merged.dropped, [])
  } finally { first.cleanup(); second.cleanup() }
})

test('a report over a gate or naming another city is refused rather than published', () => {
  const w = city('testville', { airport: { status: 'packed' } })
  try {
    const path = join(w.out, 'testville', 'airport.json'), report = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...report, city: 'elsewhere' }))
    assert.match(buildCityManifest('testville', w.out, ATLAS).skipped[0]!.reason, /another city/)
    writeFileSync(path, JSON.stringify({ ...report, packed: { ...report.packed, lod2: { ...report.packed.lod2, triangles: 501 } } }))
    assert.throws(() => buildCityManifest('testville', w.out, ATLAS), /Place manifest/, 'a LOD2 over 500 triangles does not pass the parser')
  } finally { w.cleanup() }
})

test('the generated modules: a city module that parses, a registry of lazy imports, an atlas module', () => {
  const w = city('testville', { airport: { status: 'packed' } })
  try {
    const { manifest } = buildCityManifest('testville', w.out, ATLAS)
    const module = renderCityModule(manifest)
    assert.match(module, /^\/\/ Generated by scripts\/places\/manifest\.ts/); assert.match(module, /import type \{ PlaceManifest \} from '\.\.\/manifest\.ts'/)
    assert.ok(module.includes(JSON.stringify(manifest)))
    const registry = renderRegistry(['lagos', 'abuja'])
    assert.match(registry, /'abuja': \(\) => import\('\.\/cities\/abuja\.ts'\),\n  'lagos': \(\) => import\('\.\/cities\/lagos\.ts'\)/)
    assert.doesNotMatch(registry, /^import .*cities/m, 'no static import of a city: nothing enters the startup bundle')
    assert.match(renderAtlasModule(ATLAS), /"size": 1024/)
  } finally { w.cleanup() }
})

test('the committed manifests, city modules, registry and atlas module are exactly what the generator writes now', () => {
  const logs: string[] = [], log = console.log, error = console.error
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')) }; console.error = (...args: unknown[]) => { logs.push(args.join(' ')) }
  try { assert.equal(main(['--check']), 0, logs.join('\n')) } finally { console.log = log; console.error = error }
  assert.ok(readFileSync(join(RUNTIME_DIR, 'registry.generated.ts'), 'utf8').includes("import('./cities/"))
  assert.ok(MANIFEST_DIR.endsWith('scripts/places/manifest'))
})
