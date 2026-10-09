import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createStreetAssets } from '../../../server/street/assets.ts'
import type { StreetAssetReader } from '../../../server/street/types.ts'
import type { StreetTile } from '../../street/types.ts'
import { inspectPinnedMarinaDepotTile } from './depot-site.ts'
import { resolveMarinaDepotSite } from '../../../server/living-world/depot-site.ts'

const city = 'lagos'
const version = 'street-v1-c0dd6f6101f6f562'
const tileFile = 'pack-eab52104e1de300cccc38b649ce561fb1db87e7158676ec3c705701f8e60b52a.txt'
type Manifest = { city: string; version: string; tiles: { tile: { x: number; z: number }; sha256: string; packKey?: string; packSha256?: string }[]; [key: string]: unknown }

async function fixture(current: 'pointer' | 'full' = 'pointer') {
  const base = new URL('../../../public/assets/street/lagos/', import.meta.url)
  const pointer: unknown = JSON.parse(await readFile(new URL('manifest.txt', base), 'utf8'))
  const retained = JSON.parse(await readFile(new URL(`manifest-${version}.txt`, base), 'utf8')) as Manifest
  const pack = await readFile(new URL(tileFile, base), 'utf8')
  const reader: StreetAssetReader = {
    async readManifest(requestCity, requestedVersion) {
      if (requestCity !== city) return null
      if (requestedVersion === undefined) return current === 'pointer' ? pointer : retained
      return requestedVersion === version ? retained : null
    },
    async readTile(requestCity, requestedVersion, file) {
      return requestCity === city && requestedVersion === version && file === tileFile ? pack : null
    },
  }
  return { reader, retained, pack }
}

async function decodedFixture(reader: StreetAssetReader): Promise<StreetTile> {
  const assets = createStreetAssets(reader)
  const { decoded } = await assets.tile(city, version, { x: -9, z: -5 })
  return decoded
}

test('published pinned Marina apron resolves as a fictional flat overlay, not driving authority', async () => {
  const { reader } = await fixture()
  const site = await resolveMarinaDepotSite(reader)
  assert.ok(site)
  assert.equal(site.provenance, 'fictional-overlay')
  assert.equal(site.sourcePins.roadId, 'road:lagos:15')
  assert.equal(site.surface.supportHeightM, 0)
  assert.equal(site.surface.surveyedTerrain, false)
  assert.equal(site.checks.groundMaskCoversSurfaceAndConnector, true)
  assert.equal(site.checks.pinnedAsset, 'verified')
  assert.equal(site.checks.buildingFootprintsExcluded, true)
  assert.equal(site.checks.estateApproachesExcluded, true)
  assert.equal(site.checks.actorVolume, 'unverified')
  assert.equal(site.checks.routeAuthorized, false)
  assert.ok(Math.abs(site.parkingPose.center.x - 80.13137255545733) < 1e-8)
  assert.ok(Math.abs(site.parkingPose.center.z - 51.54277550434179) < 1e-8)
  assert.ok(site.sedanEnvelope.halfWidthM > 1.2 && site.sedanEnvelope.halfLengthM > 2.1)
  assert.ok(site.sedanEnvelope.allHeadingCenterInsetM > site.sedanEnvelope.sourceBodyRadiusM)
  assert.ok(Object.isFrozen(site) && Object.isFrozen(site.surface) && Object.isFrozen(site.surface.polygon) && Object.isFrozen(site.parkingPose.center))
})

test('legacy full current manifest and current pointer resolve the same immutable site', async () => {
  const pointer = await fixture('pointer'), full = await fixture('full')
  assert.deepEqual(await resolveMarinaDepotSite(full.reader), await resolveMarinaDepotSite(pointer.reader))
})

test('missing, changed-current, manifest-pin and pack failures close the resolver', async () => {
  assert.equal(await resolveMarinaDepotSite(), null)

  const changed = await fixture()
  changed.reader.readManifest = async (_city, requestedVersion) => requestedVersion === undefined
    ? { p: 1, city, targetVersion: 'street-v1-different' }
    : changed.retained
  assert.equal(await resolveMarinaDepotSite(changed.reader), null)

  const badManifest = await fixture()
  badManifest.retained.tiles.find(entry => entry.tile.x === -9 && entry.tile.z === -5)!.sha256 = '0'.repeat(64)
  assert.equal(await resolveMarinaDepotSite(badManifest.reader), null)

  const badPack = await fixture()
  badPack.reader.readTile = async () => 'not the pinned pack'
  assert.equal(await resolveMarinaDepotSite(badPack.reader), null)
})

test('changed tile buildings, estate approach, or a missing ground cell reject the geometric candidate', async () => {
  const { reader } = await fixture(), actual = await decodedFixture(reader)
  const site = inspectPinnedMarinaDepotTile(actual)
  assert.ok(site)
  assert.equal(site.checks.pinnedAsset, 'not-verified-by-tile-inspector')
  const boundary = site.surface.polygon.map(point => ({ x: point.x, z: point.z }))

  const building: StreetTile = { ...actual, buildings: [...actual.buildings, { id: 'test-building', source: 'generated-fabric', height: 8, footprint: boundary }] }
  assert.equal(inspectPinnedMarinaDepotTile(building), null)

  const center = site.parkingPose.center
  const estateApproach: StreetTile = { ...actual, doors: [...actual.doors, {
    id: 'test-estate-door', source: 'generated', target: { kind: 'estate', lga: 'lagos-island', estate: 1 },
    at: { x: center.x, z: center.z - 1 }, approach: { x: center.x, z: center.z },
  }] }
  assert.equal(inspectPinnedMarinaDepotTile(estateApproach), null)

  const ground = actual.ground.slice(), col = Math.floor(center.x / 2), row = Math.floor(center.z / 2)
  ground[row * 2 + Math.floor(col / 32)] = (ground[row * 2 + Math.floor(col / 32)] ?? 0) & ~(1 << (col % 32))
  assert.equal(inspectPinnedMarinaDepotTile({ ...actual, ground }), null)
})

test('tile identity, road provenance and bridge changes do not yield an overlay', async () => {
  const { reader } = await fixture(), tile = await decodedFixture(reader)
  assert.equal(inspectPinnedMarinaDepotTile({ ...tile, version: 'street-v1-other' }), null)
  assert.equal(inspectPinnedMarinaDepotTile({ ...tile, roads: tile.roads.map(road => ({ ...road, bridge: true })) }), null)
  assert.equal(inspectPinnedMarinaDepotTile({ ...tile, roads: tile.roads.map(road => ({ ...road, source: 'generated' })) }), null)
})
