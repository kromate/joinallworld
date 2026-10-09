import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveDistrictRoute } from './district-route.ts'
import type { StreetAssetReader } from '../street/types.ts'

const city = 'lagos'
const version = 'street-v1-c0dd6f6101f6f562'
const tileFile = 'pack-eab52104e1de300cccc38b649ce561fb1db87e7158676ec3c705701f8e60b52a.txt'
type Manifest = { city: string; version: string; tiles: { tile: { x: number; z: number }; sha256: string; packKey?: string; packSha256?: string }[]; [key: string]: unknown }

async function publishedFixture(currentMode: 'pointer' | 'full' = 'pointer') {
  const base = new URL('../../public/assets/street/lagos/', import.meta.url)
  const pointer: unknown = JSON.parse(await readFile(new URL('manifest.txt', base), 'utf8'))
  const retained = JSON.parse(await readFile(new URL(`manifest-${version}.txt`, base), 'utf8')) as Manifest
  const pack = await readFile(new URL(tileFile, base), 'utf8')
  const reads: string[] = []
  const reader: StreetAssetReader = {
    async readManifest(requestCity, requestedVersion) {
      reads.push(`manifest:${requestCity}:${requestedVersion ?? 'current'}`)
      if (requestCity !== city) return null
      if (requestedVersion === undefined) return currentMode === 'pointer' ? pointer : retained
      return requestedVersion === version ? retained : null
    },
    async readTile(requestCity, requestedVersion, file) {
      reads.push(`tile:${requestCity}:${requestedVersion}:${file}`)
      return requestCity === city && requestedVersion === version && file === tileFile ? pack : null
    },
  }
  return { reader, reads, retained, pointer }
}

test('missing reader is a zero-I/O closed result', async () => {
  assert.equal(await resolveDistrictRoute(), null)
})

test('the published pinned Marina segment yields only a clearance-unverified fictional proposal', async () => {
  const { reader } = await publishedFixture()
  const proposal = await resolveDistrictRoute(reader)
  assert.ok(proposal)
  assert.equal(proposal.proposalOnly, true)
  assert.equal(proposal.clearance, 'unverified')
  assert.equal(proposal.road.id, 'road:lagos:15')
  assert.deepEqual(proposal.road.centerline, [{ x: -1152, z: -607.47 }, { x: -1024, z: -589.44 }])
  assert.equal(proposal.assumedVehicleHalfWidth, 1.2)
  assert.equal(proposal.edgeMargin, 0.4)
  assert.equal(proposal.widthDerivedCenterRadius, 2.4)
  assert.deepEqual(proposal.stops.map(stop => stop.id), ['practice-depot', 'practice-shop'])
  assert.deepEqual(proposal.stops.map(stop => stop.label), ['Fictional practice depot', 'Fictional practice shop'])
  assert.ok(proposal.stops[0].at.x < proposal.stops[1].at.x)
  assert.ok(Object.isFrozen(proposal) && Object.isFrozen(proposal.road.centerline) && Object.isFrozen(proposal.stops))
})

test('a legacy full current manifest and a current pointer resolve to the same pinned proposal', async () => {
  const pointerReader = await publishedFixture('pointer')
  const fullReader = await publishedFixture('full')
  assert.deepEqual(await resolveDistrictRoute(fullReader.reader), await resolveDistrictRoute(pointerReader.reader))
})

test('changed current version, changed manifest pin, and corrupt pack fail closed', async () => {
  const changedPointer = await publishedFixture()
  changedPointer.reader.readManifest = async (_requestCity, requestedVersion) => requestedVersion === undefined
    ? { p: 1, city, targetVersion: 'street-v1-different' }
    : changedPointer.retained
  assert.equal(await resolveDistrictRoute(changedPointer.reader), null)

  const changedManifest = await publishedFixture()
  const tile = changedManifest.retained.tiles.find(item => item.tile.x === -9 && item.tile.z === -5)
  assert.ok(tile)
  tile.sha256 = '0'.repeat(64)
  assert.equal(await resolveDistrictRoute(changedManifest.reader), null)

  const corruptPack = await publishedFixture()
  corruptPack.reader.readTile = async () => 'corrupt pack bytes'
  assert.equal(await resolveDistrictRoute(corruptPack.reader), null)
})
