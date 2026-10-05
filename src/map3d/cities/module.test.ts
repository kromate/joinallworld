import assert from 'node:assert/strict'
import test from 'node:test'
import { ibadanCity } from '../../game/cities/ibadan/index.ts'
import { toLocal } from '../../geo/frame.ts'

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
