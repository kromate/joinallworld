import assert from 'node:assert/strict'
import test from 'node:test'
import { Mesh, MeshStandardMaterial } from 'three'
import { createKit } from '../scene/kit.ts'
import { buildCity, WATER_Y } from './city-build.ts'
import { flatModel, flatSvg } from './flat.ts'
import { buildNetwork } from './roads.ts'
import type { CityPack, Point2 } from './types.ts'

const bank: Point2[] = [[-30, -30], [30, -30], [30, 30], [-30, 30]]
const channel: Point2[] = [[-10, -10], [10, -10], [10, 10], [-10, 10]]
const island: Point2[] = [[-2, -2], [2, -2], [2, 2], [-2, 2]]
const bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }
const pack: CityPack = {
  id: 'test-water', name: 'Test Water', inland: true,
  bounds: { ...bounds, fit: bounds, sea: { x0: 0, x1: 0, z0: 40, z1: 40 } },
  land: [{ id: 'bank', kind: 'mainland', exact: true, points: bank, holes: [channel] }, { id: 'island', kind: 'island', exact: true, points: island }],
  water: [{ id: 'channel', points: channel, holes: [island] }],
  roads: [], sites: {}, homes: { cabin: { x: -20, z: 0, district: 'Bank' } }, soon: {},
  districts: [], zones: [], fabric: [], estates: {}, lgas: [], geo: { box: [0, 0, 1, 1] }, decorate() {},
}

test('explicit waterways preserve land surroundings and islands in the flat map', () => {
  const model = flatModel(pack, buildNetwork(pack)), svg = flatSvg(model)
  assert.equal(model.inland, true)
  assert.equal(model.sea, null)
  assert.equal(model.water.length, 1)
  assert.equal((model.water[0]?.d.match(/M/g) ?? []).length, 2, 'water retains its island hole')
  assert.match(svg, /data-water="channel"/)
  assert.match(svg, /<rect[^>]+fill="#bcd596"/)
})

test('3D waterways triangulate the same island hole above the regional ground', () => {
  const kit = createKit(), city = buildCity(kit, pack, buildNetwork(pack))
  try {
    const mesh = city.group.getObjectByName('waterways')
    assert.ok(mesh instanceof Mesh && mesh.material instanceof MeshStandardMaterial)
    const positions = mesh.geometry.getAttribute('position'), index = mesh.geometry.index
    assert.ok(index)
    let area = 0
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2)
      area += Math.abs((positions.getX(b) - positions.getX(a)) * (positions.getZ(c) - positions.getZ(a)) - (positions.getZ(b) - positions.getZ(a)) * (positions.getX(c) - positions.getX(a))) / 2
      assert.ok(Math.abs(positions.getY(a) - (WATER_Y + 0.01)) < 1e-6)
    }
    assert.equal(area, 384)
    const day = mesh.material.color.getHex()
    city.setTime('night')
    assert.notEqual(mesh.material.color.getHex(), day)
    const base = city.group.getObjectByName('water')
    assert.ok(base instanceof Mesh && base.material instanceof MeshStandardMaterial)
    assert.equal(base.material.color.getHexString(), 'bcd596', 'land outside the footprint remains land at night')
  } finally { city.dispose(); kit.dispose() }
})
