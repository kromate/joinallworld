import assert from 'node:assert/strict'
import test from 'node:test'
import { Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import lagos from './cities/lagos.ts'
import { lgaAt } from './lga.ts'
import { buildCity, WATER_Y } from './city-build.ts'
import { buildNetwork } from './roads.ts'
import { createKit } from '../scene/kit.ts'
import type { CityPack, Point2 } from './types.ts'
import type { MapContext } from './context.ts'
import { ORIGINS, toLocal } from './geo/frame.ts'

function topGroundOrWater(pack: CityPack, x: number, z: number) {
  const kit = createKit(), city = buildCity(kit, pack, buildNetwork(pack))
  city.group.updateMatrixWorld(true)
  const hits = new Raycaster(new Vector3(x, 20, z), new Vector3(0, -1, 0))
    .intersectObject(city.group, true)
    .filter(hit => hit.object.visible && (hit.object.name === 'ground' || hit.object.name === 'water'))
    .sort((a, b) => b.point.y - a.point.y)
  return { city, kit, hits }
}

function contextFixture(inland: boolean): CityPack {
  const rect = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }
  const base: Point2[] = [[-10, -10], [10, -10], [10, 10], [-10, 10]]
  const context: MapContext = { rect, land: [{ id: 'fixture-base', name: 'Fixture base', kind: 'base', points: base, holes: [], status: null }], roads: [], labels: [] }
  return {
    id: `context-height-${inland ? 'inland' : 'coastal'}`, name: 'Context height fixture', inland,
    bounds: { ...rect, fit: rect, sea: { x0: 0, x1: 0, z0: 20, z1: 20 } }, land: [], roads: [], sites: {},
    homes: { home: { x: 0, z: 0, district: 'Fixture' } }, soon: {}, districts: [], zones: [], fabric: [], estates: {},
    lgas: [], geo: { box: [0, 0, 1, 1] }, context, decorate() {},
  }
}

test('Lagos lagoon exposes the water plane while a real home remains on top of city land', () => {
  const [lagoonX, lagoonZ] = toLocal(ORIGINS.lagos, 3.43, 6.49)
  assert.equal(lgaAt(lagos, lagoonX, lagoonZ), null)
  const lagoon = topGroundOrWater(lagos, lagoonX, lagoonZ)
  try {
    assert.equal(lagoon.hits[0]?.object.name, 'water')
    assert.ok(Math.abs(lagoon.hits[0]!.point.y - WATER_Y) < 1e-5)
    const water = lagoon.hits[0]!.object
    assert.ok(water instanceof Mesh && water.material instanceof MeshStandardMaterial)
    assert.equal(water.material.color.getHexString(), '347f9b')
  } finally { lagoon.city.dispose(); lagoon.kit.dispose() }

  const home = lagos.homes.yaba!
  assert.equal(lgaAt(lagos, home.x, home.z), 'lagos-mainland')
  const onLand = topGroundOrWater(lagos, home.x, home.z)
  try {
    assert.equal(onLand.hits[0]?.object.name, 'ground')
    assert.ok(Math.abs(onLand.hits[0]!.point.y) < 1e-5, 'the authored home location stays on top of the city land surface')
  } finally { onLand.city.dispose(); onLand.kit.dispose() }
})

test('coastal base height changes no mesh topology or source X/Z; inland base stays at regional-ground height', () => {
  const coastPack = contextFixture(false), coastKit = createKit(), coast = buildCity(coastKit, coastPack, buildNetwork(coastPack))
  const inlandPack = contextFixture(true), inlandKit = createKit(), inland = buildCity(inlandKit, inlandPack, buildNetwork(inlandPack))
  try {
    const coastGround = coast.group.getObjectByName('ground') as Mesh
    const inlandGround = inland.group.getObjectByName('ground') as Mesh
    assert.ok(coastGround && inlandGround)
    const cp = coastGround.geometry.getAttribute('position'), ip = inlandGround.geometry.getAttribute('position')
    const cc = coastGround.geometry.getAttribute('color'), ic = inlandGround.geometry.getAttribute('color')
    const ci = coastGround.geometry.index!, ii = inlandGround.geometry.index!
    assert.equal(cp.count, ip.count)
    assert.equal(ci.count, ii.count)
    assert.deepEqual(Array.from(ci.array), Array.from(ii.array), 'same triangulation/index topology')
    for (let i = 0; i < cp.count; i++) {
      assert.equal(cp.getX(i), ip.getX(i), 'source X unchanged')
      assert.equal(cp.getZ(i), ip.getZ(i), 'source Z unchanged')
      assert.ok(Math.abs(cp.getY(i) - (WATER_Y - 0.02)) < 1e-6)
      assert.ok(Math.abs(ip.getY(i) - (-0.06)) < 1e-6)
      assert.equal(cc.getX(i), ic.getX(i)); assert.equal(cc.getY(i), ic.getY(i)); assert.equal(cc.getZ(i), ic.getZ(i))
    }
  } finally { coast.dispose(); coastKit.dispose(); inland.dispose(); inlandKit.dispose() }
})
