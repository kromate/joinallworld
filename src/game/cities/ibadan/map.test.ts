import assert from 'node:assert/strict'
import test from 'node:test'
import { ibadanCity } from './index.ts'
import { createModulePack } from '../../../map3d/cities/module.ts'
import { fromLocal, toLocal } from '../../../map3d/geo/frame.ts'
import { inLga } from '../../../map3d/lga.ts'
import { flatModel, flatSvg } from '../../../map3d/flat.ts'

// Geographic landmarks keep their source positions; the camera changes scale, never the outline.
test('Ibadan projects every landmark in the shared frame and keeps its eleven units inland', async () => {
  const [pack, content] = await Promise.all([createModulePack(ibadanCity), ibadanCity.loadContent()])
  assert.equal(pack.inland, true)
  assert.equal(pack.frame?.unitsPerKm, 10)
  assert.equal(pack.lgas.length, 11)
  for (const venue of content.venues.filter(item => item.id !== 'home')) {
    assert.equal(venue.position.kind, 'lon-lat')
    if (venue.position.kind !== 'lon-lat') throw new Error('Expected geographic position')
    const point = pack.sites[venue.id]
    assert.ok(point, venue.id)
    const ll = fromLocal(ibadanCity.rules.mapOrigin, point.x, point.z)
    assert.ok(Math.abs(ll.lon - venue.position.lon) < 1e-10, venue.id)
    assert.ok(Math.abs(ll.lat - venue.position.lat) < 1e-10, venue.id)
    const unit = pack.lgas.find(unit => inLga(unit, point.x, point.z))
    assert.ok(unit, `${venue.id} must lie in the playable footprint`)
    assert.ok(venue.district.endsWith(unit.name), `${venue.id}: district label must match its mapped local government ${unit.name}`)
  }
  for (const home of Object.values(pack.homes)) assert.ok(pack.lgas.some(unit => inLga(unit, home.x, home.z)))
  for (const home of content.housing) {
    assert.ok(home.position)
    const [x, z] = toLocal(ibadanCity.rules.mapOrigin, home.position.lon, home.position.lat)
    const unit = pack.lgas.find(unit => inLga(unit, x, z))
    assert.ok(unit)
    assert.equal(ibadanCity.rules.districts.find(district => district.id === home.districtId)?.localUnitId, unit.id, home.definition.id)
  }
  const flat = flatModel(pack, { roads: [] })
  assert.equal(flat.sea, null)
  assert.doesNotMatch(flatSvg(flat), /fill="#4faacb"/)
})
