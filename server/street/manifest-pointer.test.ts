import assert from 'node:assert/strict'
import test from 'node:test'
import { createStreetAssets, parseStreetManifestPointer } from './assets.ts'
import type { StreetAssetReader } from './types.ts'

const full = (city: string, version: string) => ({ v: 1, city, version, tileSize: 128, quantum: 100, groundCell: 2, tiles: [], doors: [] })
const pointer = (city: string, targetVersion: string) => ({ p: 1, city, targetVersion })
const validVersion = (tail: string) => `street-v1-${tail}`

function reader(current: unknown, versions: Record<string, unknown> = {}) {
  const reads: { city: string; version?: string }[] = []
  const source: StreetAssetReader = {
    async readManifest(city, version) {
      reads.push({ city, version })
      return version === undefined ? current : versions[version] ?? null
    },
    async readTile() { return null },
  }
  return { source, reads, versions }
}

test('pointer parser accepts only the exact bounded envelope and leaves legacy manifests alone', () => {
  const version = validVersion('0123456789abcdef')
  assert.equal(parseStreetManifestPointer(pointer('lagos', version), 'lagos'), version)
  assert.equal(parseStreetManifestPointer(full('lagos', version), 'lagos'), null)
  assert.equal(parseStreetManifestPointer(null, 'lagos'), null)
  for (const value of [
    { ...pointer('lagos', version), extra: true },
    { p: 2, city: 'lagos', targetVersion: version },
    pointer('ibadan', version),
    pointer('lagos', '../manifest.txt'),
    pointer('lagos', `street-v1-${'a'.repeat(101)}`),
    { p: 1, city: 'lagos', targetVersion: 12 },
  ]) assert.throws(() => parseStreetManifestPointer(value, 'lagos'))
})

test('a current pointer resolves exactly one immutable manifest and returns the same parsed full manifest', async () => {
  const version = validVersion('lagos-current')
  const stored = full('lagos', version), assetsReader = reader(pointer('lagos', version), { [version]: stored })
  const assets = createStreetAssets(assetsReader.source), legacyAssets = createStreetAssets(reader(stored).source)
  assert.deepEqual(await assets.manifest('lagos'), { city: 'lagos', version, tiles: new Map(), doors: new Map() })
  assert.deepEqual(await assets.manifest('lagos'), await legacyAssets.manifest('lagos'))
  assert.deepEqual(assetsReader.reads, [{ city: 'lagos', version: undefined }, { city: 'lagos', version }])
})

test('legacy full current manifests remain compatible and explicit old versions bypass the pointer', async () => {
  const oldVersion = validVersion('old-retained'), currentVersion = validVersion('new-current')
  const assetsReader = reader(full('lagos', currentVersion), { [oldVersion]: full('lagos', oldVersion), [currentVersion]: full('lagos', currentVersion) })
  const assets = createStreetAssets(assetsReader.source)
  assert.equal((await assets.manifest('lagos')).version, currentVersion)
  assert.equal((await assets.manifest('lagos', oldVersion)).version, oldVersion)
  assert.deepEqual(assetsReader.reads, [{ city: 'lagos', version: undefined }, { city: 'lagos', version: oldVersion }])

  const pointerReader = reader(pointer('lagos', oldVersion), { [oldVersion]: pointer('lagos', oldVersion) })
  await assert.rejects(createStreetAssets(pointerReader.source).manifest('lagos', oldVersion), /cannot be a pointer/)
})

test('bad, missing, and mismatched pointer targets fail closed and are not cached', async () => {
  const version = validVersion('target')
  const malformed = reader({ p: 1, city: 'lagos', targetVersion: version, path: '../bad' }, { [version]: full('lagos', version) })
  const malformedAssets = createStreetAssets(malformed.source)
  await assert.rejects(malformedAssets.manifest('lagos'), /Invalid current street manifest pointer/)
  assert.equal(malformedAssets.diagnostics().manifests, 0)

  const missing = reader(pointer('lagos', version))
  const missingAssets = createStreetAssets(missing.source)
  await assert.rejects(missingAssets.manifest('lagos'))
  assert.equal(missingAssets.diagnostics().manifests, 0)
  missing.versions[version] = full('lagos', version)
  assert.equal((await missingAssets.manifest('lagos')).version, version, 'a failed target is not cached and can recover when the asset appears')

  const mismatch = reader(pointer('lagos', version), { [version]: full('ibadan', version) })
  const mismatchAssets = createStreetAssets(mismatch.source)
  await assert.rejects(mismatchAssets.manifest('lagos'), /Invalid immutable street manifest/)
  assert.equal(mismatchAssets.diagnostics().manifests, 0)

  const wrongVersion = validVersion('different'), versionMismatch = reader(pointer('lagos', version), { [version]: full('lagos', wrongVersion) })
  const versionMismatchAssets = createStreetAssets(versionMismatch.source)
  await assert.rejects(versionMismatchAssets.manifest('lagos'), /Retained street geometry version unavailable/)
  assert.equal(versionMismatchAssets.diagnostics().manifests, 0)
})

test('unchanged pointer refresh reads only the small pointer; a new version loads and validates its full file', async () => {
  const originalNow = Date.now
  let now = 10_000
  Date.now = () => now
  try {
    const first = validVersion('first'), second = validVersion('second')
    const assetsReader = reader(pointer('lagos', first), { [first]: full('lagos', first), [second]: full('lagos', second) })
    const assets = createStreetAssets(assetsReader.source)
    assert.equal((await assets.manifest('lagos')).version, first)
    assert.equal((await assets.manifest('lagos')).version, first)
    assert.equal(assetsReader.reads.length, 2)

    now += 59_999
    assert.equal((await assets.manifest('lagos')).version, first)
    assert.equal(assetsReader.reads.length, 2, 'the existing current cache still lasts 60 seconds')

    now += 1
    assert.equal((await assets.manifest('lagos')).version, first)
    assert.deepEqual(assetsReader.reads.slice(2), [{ city: 'lagos', version: undefined }], 'same-version refresh reuses the parsed LRU entry')

    assetsReader.source.readManifest = async (city, version) => {
      assetsReader.reads.push({ city, version })
      return version === undefined ? pointer('lagos', second) : version === second ? full('lagos', second) : null
    }
    now += 60_000
    assert.equal((await assets.manifest('lagos')).version, second)
    assert.deepEqual(assetsReader.reads.slice(3), [{ city: 'lagos', version: undefined }, { city: 'lagos', version: second }])
  } finally { Date.now = originalNow }
})

test('the four-entry parsed-manifest LRU is touched on hits and evicts its least recently used version', async () => {
  const cities = ['a', 'b', 'c', 'd', 'e'], versions = Object.fromEntries(cities.map(city => [validVersion(city), full(city, validVersion(city))]))
  const assetsReader = reader(null, versions), assets = createStreetAssets(assetsReader.source)
  for (const city of cities.slice(0, 4)) await assets.manifest(city, validVersion(city))
  await assets.manifest('a', validVersion('a')) // promote a; b is now least-recently-used
  await assets.manifest('e', validVersion('e'))
  assert.equal(assets.diagnostics().manifests, 4)
  const before = assetsReader.reads.length
  await assets.manifest('b', validVersion('b'))
  assert.equal(assetsReader.reads.length, before + 1, 'the evicted manifest must be fetched again')
})

test('same pending lookup is shared and the existing four-pending-request limit remains enforced', async () => {
  const versions = ['a', 'b', 'c', 'd', 'e'].map(validVersion)
  const releases = new Map<string, (value: unknown) => void>()
  const reads: string[] = []
  const source: StreetAssetReader = {
    readManifest(_city, version) {
      if (!version) return Promise.resolve(null)
      reads.push(version)
      return new Promise(resolve => releases.set(version, resolve))
    },
    async readTile() { return null },
  }
  const assets = createStreetAssets(source)
  const sameA = assets.manifest('a', versions[0]), sameAAgain = assets.manifest('a', versions[0])
  const b = assets.manifest('b', versions[1]), c = assets.manifest('c', versions[2]), d = assets.manifest('d', versions[3])
  assert.deepEqual(reads, versions.slice(0, 4))
  await assert.rejects(assets.manifest('e', versions[4]), /reader is busy/)
  for (const version of versions.slice(0, 4)) releases.get(version)?.(full(version === versions[0] ? 'a' : version === versions[1] ? 'b' : version === versions[2] ? 'c' : 'd', version))
  await Promise.all([sameA, sameAAgain, b, c, d])
  assert.equal(reads.filter(version => version === versions[0]).length, 1)
  assert.equal(assets.diagnostics().manifestPending, 0)
})
