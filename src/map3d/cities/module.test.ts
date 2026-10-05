import assert from 'node:assert/strict'
import test from 'node:test'
import { ibadanCity } from '../../game/cities/ibadan/index.ts'
import { toLocal } from '../../geo/frame.ts'
import { fanOut } from './module.ts'

test('rented homes use their authored geographic positions while owned estates keep their separate anchors', async () => {
  const content = await ibadanCity.loadContent(), descriptor = await ibadanCity.loadMap(), pack = await descriptor.loadScene()
  for (const home of content.housing) {
    assert.ok(home.position, `${home.definition.id} has a sourced housing anchor`)
    const expected = toLocal(descriptor.origin, home.position.lon, home.position.lat), actual = pack.homes[home.definition.id]
    assert.ok(actual)
    assert.deepEqual([actual.x, actual.z], expected)
  }
  const northHomes = content.housing.filter(home => ['ibadan-mokola-room', 'ibadan-bodija-flat'].includes(home.definition.id))
  assert.equal(northHomes.length, 2)
  assert.notDeepEqual(pack.homes[northHomes[0]!.definition.id], pack.homes[northHomes[1]!.definition.id], 'two rental districts in one local government do not collapse onto one plate')
  for (const unit of pack.lgas) {
    const estate = pack.estates[unit.id]
    assert.ok(estate)
    assert.deepEqual([estate.x, estate.z], unit.plate, 'owned-estate layout is not moved by a rented-home position')
  }
})

test('venues authored on one reference point are fanned out round it for display, and a venue with its own shift keeps it', () => {
  const at = { lon: 8.55362, lat: 12.0327 }
  const venues = [{ id: 'garden', ...at }, ...Array.from({ length: 7 }, (_, index) => ({ id: `service-${index}`, ...at })), { id: 'far', lon: 8.52, lat: 12 }, { id: 'own', ...at }]
  const shifts = fanOut(venues, { own: { east: 40, north: -40 } })
  assert.equal(shifts.garden, undefined, 'the first venue of a point keeps its place')
  assert.equal(shifts.far, undefined, 'a venue alone on its point is not moved')
  assert.deepEqual(shifts.own, { east: 40, north: -40 })
  const moved = venues.filter(venue => venue.id.startsWith('service-')).map(venue => shifts[venue.id]!)
  assert.equal(moved.length, 7)
  for (const shift of moved) assert.ok(Math.hypot(shift.east, shift.north) >= 250, 'far enough from the point to be pressed on its own')
  for (const [index, a] of moved.entries()) for (const b of moved.slice(index + 1)) assert.ok(Math.hypot(a.east - b.east, a.north - b.north) >= 200, 'and from each other')
})
