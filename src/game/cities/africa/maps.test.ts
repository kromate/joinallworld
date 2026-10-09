import assert from 'node:assert/strict'
import test from 'node:test'
import type { CityModule } from '../../../types/content.ts'
import { assertCityMapContract } from '../cityContractTest.test.ts'
import { city as yaounde } from '../yaounde/index.ts'
import { city as lome } from '../lome/index.ts'
import { city as accra } from '../accra/index.ts'
import { city as nairobi } from '../nairobi/index.ts'
import { city as algiers } from '../algiers/index.ts'

const destinations: readonly CityModule[] = [yaounde, lome, accra, nairobi, algiers]

for (const city of destinations) test(`${city.id}: real starter map preserves geometry, arrival and bounded decoration`, async () => {
  const map = await city.loadMap()
  await assertCityMapContract(city, map)
  const scene = await map.loadScene()
  const content = await city.loadContent()
  const airport = city.rules.hubs.find(hub => hub.mode === 'air')
  assert.ok(airport?.venueId && scene.sites[airport.venueId])
  assert.ok(content.venues.find(venue => venue.id === airport.venueId))
  assert.ok(scene.roads.length > 0 && scene.roads.length <= 160)
  assert.ok(scene.roads.every(road => road.id.startsWith('osm:way:') && road.points.every(point => point.every(Number.isFinite))))
  assert.equal(scene.fabric.length, 0, 'source samples do not add procedural decorative houses')
  let boxes = 0
  scene.decorate({
    box(x, y, z, w, h, d) { assert.ok([x, y, z, w, h, d].every(Number.isFinite)); assert.ok(w > 0 && h > 0 && d > 0); boxes++ },
    cyl() {}, cone() {}, at() {},
  }, { rng: () => .5 })
  assert.ok(boxes > 0 && boxes <= 700, 'at most 350 sourced building silhouettes')
  assert.ok(boxes * 12 <= 8400, 'bounded solid building triangles')
  assert.match((await map.loadGeometry()).source, /Starter visitor area/u)
})
