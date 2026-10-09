import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { inspectMarinaDistrictSweep } from './district-sweep.ts'
import { MARINA_DEPOT_SOURCE_PINS } from '../../src/game/living-world/depot-site.ts'
import type { StreetAssetReader } from '../street/types.ts'

type ManifestEntry = { tile: { x: number; z: number }; file: string; sha256: string; packKey?: string; packSha256?: string }
type Manifest = { city: string; version: string; tiles: ManifestEntry[]; [key: string]: unknown }
type StreetPack = { tiles: { key: string; wire: { roads: { id: string; points: number[] }[]; [key: string]: unknown } }[] }

async function publishedFixture() {
  const pins = MARINA_DEPOT_SOURCE_PINS
  const base = new URL('../../public/assets/street/lagos/', import.meta.url)
  const pointer = JSON.parse(await readFile(new URL('manifest.txt', base), 'utf8')) as unknown
  const manifest = JSON.parse(await readFile(new URL(`manifest-${pins.version}.txt`, base), 'utf8')) as Manifest
  const entry = manifest.tiles.find(item => item.tile.x === pins.tile.x && item.tile.z === pins.tile.z)
  assert.ok(entry?.packSha256)
  const packText = await readFile(new URL(entry.file, base), 'utf8')
  let current: unknown = pointer, retained: unknown = manifest, packed: string | null = packText
  const reader: StreetAssetReader = {
    async readManifest(city, version) {
      if (city !== pins.city) return null
      return version === undefined ? current : version === pins.version ? retained : null
    },
    async readTile(city, version, file) {
      return city === pins.city && version === pins.version && file === entry.file ? packed : null
    },
  }
  return {
    reader,
    pins,
    manifest,
    setCurrent(value: unknown) { current = value },
    setRetained(value: unknown) { retained = value },
    setPack(value: string | null) { packed = value },
    packText,
  }
}

function marinaPose(station: number, side = 2, headingOffset = 0) {
  const start = { x: 0, z: 32.53 }, end = { x: 128, z: 50.56 }
  const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz)
  const tangent = { x: dx / length, z: dz / length }, normal = { x: -tangent.z, z: tangent.x }
  return {
    center: { x: start.x + tangent.x * station + normal.x * side, z: start.z + tangent.z * station + normal.z * side },
    headingRadians: Math.atan2(dx, dz) + headingOffset,
  }
}

test('missing published-asset reader is a closed no-evidence result', async () => {
  assert.equal(await inspectMarinaDistrictSweep(undefined, marinaPose(16), marinaPose(112)), null)
})

test('the actual pinned depot-to-shop station corridor clears the verified sedan and buildings only', async () => {
  const fixture = await publishedFixture()
  const result = await inspectMarinaDistrictSweep(fixture.reader, marinaPose(16), marinaPose(112))
  assert.ok(result)
  assert.equal(result.sweep.reason, 'clear')
  assert.equal(result.evidence.kind, 'retained-street-manifest-pack-logical-tile-verified')
  assert.equal(result.evidence.city, fixture.pins.city)
  assert.equal(result.evidence.version, fixture.pins.version)
  assert.equal(result.evidence.manifestCanonicalSha256, fixture.pins.manifestCanonicalSha256)
  assert.deepEqual(result.evidence.tile, fixture.pins.tile)
  assert.equal(result.evidence.tileSha256, fixture.pins.tileSha256)
  assert.equal(result.evidence.packSha256, fixture.pins.packSha256)
  assert.equal(result.evidence.road.id, fixture.pins.roadId)
  assert.deepEqual(result.evidence.road.centerline, [{ x: 0, z: 32.53 }, { x: 128, z: 50.56 }])
  assert.equal(result.evidence.road.widthM, 8)
  assert.ok(result.evidence.checkedBuildingFootprints > 0)
  assert.equal(result.routeAuthorized, false)
  assert.equal(result.canBoard, false)
  assert.equal(result.geometryOnly, true)
  assert.equal(result.limitations.length, 4)
})

test('a center outside the lane and a turned body crossing its edge are refused', async () => {
  const fixture = await publishedFixture()
  const offroad = await inspectMarinaDistrictSweep(fixture.reader, marinaPose(50, 3.5), marinaPose(60, 3.5))
  assert.equal(offroad?.sweep.reason, 'outside_support')
  const turned = await inspectMarinaDistrictSweep(fixture.reader, marinaPose(50, 2, Math.PI / 2), marinaPose(51, 2, Math.PI / 2))
  assert.equal(turned?.sweep.reason, 'outside_support', 'the center remains within the road width, but the actual sedan body does not')
  assert.equal(turned?.routeAuthorized, false)
})

test('changed manifest, corrupt pack/tile, and altered pinned road bytes fail closed', async () => {
  const changedCurrent = await publishedFixture()
  changedCurrent.setCurrent({ p: 1, city: changedCurrent.pins.city, targetVersion: 'street-v1-not-pinned' })
  assert.equal(await inspectMarinaDistrictSweep(changedCurrent.reader, marinaPose(16), marinaPose(112)), null)

  const changedManifest = await publishedFixture()
  const altered = structuredClone(changedManifest.manifest)
  const entry = altered.tiles.find(item => item.tile.x === changedManifest.pins.tile.x && item.tile.z === changedManifest.pins.tile.z)
  assert.ok(entry)
  entry.sha256 = '0'.repeat(64)
  changedManifest.setRetained(altered)
  assert.equal(await inspectMarinaDistrictSweep(changedManifest.reader, marinaPose(16), marinaPose(112)), null)

  const corruptPack = await publishedFixture()
  corruptPack.setPack('not the pinned pack')
  assert.equal(await inspectMarinaDistrictSweep(corruptPack.reader, marinaPose(16), marinaPose(112)), null)

  const alteredRoad = await publishedFixture()
  const wire = JSON.parse(alteredRoad.packText) as StreetPack
  const logical = wire.tiles.find(item => item.key === `${alteredRoad.pins.tile.x}_${alteredRoad.pins.tile.z}`)
  assert.ok(logical)
  const road = logical.wire.roads.find(item => item.id === alteredRoad.pins.roadId)
  assert.ok(road)
  road.points[0] = road.points[0]! + 1
  alteredRoad.setPack(JSON.stringify(wire))
  assert.equal(await inspectMarinaDistrictSweep(alteredRoad.reader, marinaPose(16), marinaPose(112)), null,
    'changed road coordinates cannot be paired with the pinned pack and logical-tile digests')
})

test('bounded diagnostic poses fail closed after the same verified source read', async () => {
  const fixture = await publishedFixture()
  const result = await inspectMarinaDistrictSweep(fixture.reader, { center: { x: 100_001, z: 0 }, headingRadians: 0 }, marinaPose(16))
  assert.ok(result)
  assert.equal(result.sweep.reason, 'invalid_pose')
  assert.equal(result.routeAuthorized, false)
})
