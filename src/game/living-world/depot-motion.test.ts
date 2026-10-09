import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createStreetAssets } from '../../../server/street/assets.ts'
import { resolveMarinaDepotSite } from '../../../server/living-world/depot-site.ts'
import type { StreetAssetReader } from '../../../server/street/types.ts'
import type { MetrePoint, StreetTile } from '../../street/types.ts'
import { MARINA_DEPOT_SOURCE_PINS } from './depot-site.ts'
import type { DepotSiteDescriptor } from './depot-site.ts'
import { inspectMarinaDepotMotion } from './depot-motion.ts'

const { city, version, tile: tileCoord, packSha256 } = MARINA_DEPOT_SOURCE_PINS
const packFile = `pack-${packSha256}.txt`

async function fixture() {
  const base = new URL('../../../public/assets/street/lagos/', import.meta.url)
  const pointer: unknown = JSON.parse(await readFile(new URL('manifest.txt', base), 'utf8'))
  const retained = JSON.parse(await readFile(new URL(`manifest-${version}.txt`, base), 'utf8'))
  const pack = await readFile(new URL(packFile, base), 'utf8')
  const reader: StreetAssetReader = {
    async readManifest(requestCity, requestedVersion) {
      if (requestCity !== city) return null
      return requestedVersion === undefined ? pointer : requestedVersion === version ? retained : null
    },
    async readTile(requestCity, requestedVersion, file) {
      return requestCity === city && requestedVersion === version && file === packFile ? pack : null
    },
  }
  const site = await resolveMarinaDepotSite(reader)
  assert.ok(site)
  const { decoded } = await createStreetAssets(reader).tile(city, version, tileCoord)
  return { site, tile: decoded }
}

function square(center: MetrePoint, radius: number): MetrePoint[] {
  return [
    { x: center.x - radius, z: center.z - radius }, { x: center.x + radius, z: center.z - radius },
    { x: center.x + radius, z: center.z + radius }, { x: center.x - radius, z: center.z + radius },
  ]
}
function unsetGround(tile: StreetTile, point: MetrePoint): StreetTile {
  const ground = tile.ground.slice()
  const col = Math.floor(point.x / 2), row = Math.floor(point.z / 2), word = row * 2 + Math.floor(col / 32)
  ground[word] = (ground[word] ?? 0) & ~(1 << (col % 32))
  return { ...tile, ground }
}

test('pinned fictional depot has a conservative continuous S-turn envelope but remains unintegrated', async () => {
  const { site, tile } = await fixture()
  const result = inspectMarinaDepotMotion(site, tile)
  assert.equal(result.routeAuthorized, false)
  assert.equal(result.vehicle.candidateMaskAndStaticObstacles, 'clear')
  assert.equal(result.vehicle.reason, 'ok')
  assert.ok(result.vehicle.candidatePath.length > 20)
  assert.equal(result.vehicle.integration, 'unverified')
  assert.equal(result.actor.candidateMaskAndStaticObstacles, 'clear')
  assert.equal(result.actor.integration, 'unverified')
  assert.equal(result.actor.assumedRadiusM, 0.8)
  assert.ok(result.remainingProof.includes('actor_model_bounds_and_door_contact'))
  assert.equal(result.siteId, 'marina-fictional-depot')
})

test('missing ground under the continuous vehicle sweep blocks the candidate', async () => {
  const { site, tile } = await fixture()
  const original = inspectMarinaDepotMotion(site, tile)
  assert.equal(original.vehicle.reason, 'ok')
  const damaged = unsetGround(tile, site.parkingPose.center)
  const result = inspectMarinaDepotMotion(site, damaged)
  assert.equal(result.vehicle.reason, 'missing_ground_cell')
  assert.equal(result.vehicle.candidateMaskAndStaticObstacles, 'blocked')
  assert.equal(result.routeAuthorized, false)
})

test('static footprints intersecting either swept actor or vehicle candidate fail closed', async () => {
  const { site, tile } = await fixture()
  const path = inspectMarinaDepotMotion(site, tile).vehicle.candidatePath
  assert.ok(path.length > 5)
  const vehicleBlock: StreetTile = {
    ...tile,
    buildings: [...tile.buildings, { id: 'test-motion-block', source: 'generated-fabric', height: 4, footprint: square(path[5]!, 0.2) }],
  }
  const vehicleResult = inspectMarinaDepotMotion(site, vehicleBlock)
  assert.equal(vehicleResult.vehicle.reason, 'building_clearance')
  assert.equal(vehicleResult.routeAuthorized, false)

  const midpoint = {
    x: (site.boarding.approach.x + site.boarding.doorGroundAnchor.x) / 2,
    z: (site.boarding.approach.z + site.boarding.doorGroundAnchor.z) / 2,
  }
  const actorBlock: StreetTile = {
    ...tile,
    buildings: [...tile.buildings, { id: 'test-actor-block', source: 'generated-fabric', height: 4, footprint: square(midpoint, 0.2) }],
  }
  assert.equal(inspectMarinaDepotMotion(site, actorBlock).actor.reason, 'building_clearance')
})

test('wrong pinned tile is rejected without implying that a candidate authorizes travel', async () => {
  const { site, tile } = await fixture()
  const result = inspectMarinaDepotMotion(site, { ...tile, version: 'street-v1-other' })
  assert.equal(result.vehicle.reason, 'invalid_site_or_tile')
  assert.equal(result.actor.reason, 'invalid_site_or_tile')
  assert.equal(result.routeAuthorized, false)
})

test('an actor sweep that leaves the authored hardstand is rejected before mask checks', async () => {
  const { site, tile } = await fixture()
  const polygon = site.surface.polygon
  const innerA = polygon[0]!, innerB = polygon[1]!, outerB = polygon[2]!, outerA = polygon[3]!
  const edgeMid = { x: (outerA.x + outerB.x) / 2, z: (outerA.z + outerB.z) / 2 }
  const outward = { x: (outerA.x - innerA.x + outerB.x - innerB.x) / 2, z: (outerA.z - innerA.z + outerB.z - innerB.z) / 2 }
  const length = Math.hypot(outward.x, outward.z)
  const outside = { x: edgeMid.x + outward.x / length * 1.1, z: edgeMid.z + outward.z / length * 1.1 }
  const shifted: DepotSiteDescriptor = {
    ...site,
    boarding: { ...site.boarding, approach: outside, doorGroundAnchor: { x: outside.x, z: outside.z - 1.5 } },
  }
  assert.equal(inspectMarinaDepotMotion(shifted, tile).actor.reason, 'outside_authored_support')
})

test('malformed descriptor returns a safe non-authorizing report instead of throwing', async () => {
  const { tile } = await fixture()
  const missing = inspectMarinaDepotMotion(null, tile)
  assert.equal(missing.vehicle.reason, 'invalid_site_or_tile')
  assert.equal(missing.actor.reason, 'invalid_site_or_tile')
  assert.deepEqual(missing.actor.approach, [{ x: 0, z: 0 }, { x: 0, z: 0 }])
  assert.equal(missing.routeAuthorized, false)
})
