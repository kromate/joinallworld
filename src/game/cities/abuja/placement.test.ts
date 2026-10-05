import assert from 'node:assert/strict'
import test from 'node:test'
import type { LonLatPolygon } from '../../../types/content.ts'
import { fctStateOverview } from './geometry.ts'
import { abujaCity } from './index.ts'

function inRing(lon: number, lat: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!
    if ((a[1] > lat) !== (b[1] > lat) && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

const inPolygon = (lon: number, lat: number, polygon: LonLatPolygon): boolean =>
  polygon.reduce((inside, ring) => inRing(lon, lat, ring) ? !inside : inside, false)

const covered = (polygons: readonly LonLatPolygon[] | undefined, lon: number, lat: number): boolean =>
  polygons?.some(polygon => inPolygon(lon, lat, polygon)) ?? false

test('Abuja venues have administrative membership and mapped dry-land placement', async () => {
  const [content, map] = await Promise.all([abujaCity.loadContent(), abujaCity.loadMap()])
  const geometry = await map.loadGeometry()
  const overview = fctStateOverview()
  const administrativeUnits = new Map(overview.localUnits.map(unit => [unit.id, unit.polygons]))

  for (const venue of content.venues.filter(item => item.id !== 'home')) {
    if (venue.position.kind !== 'lon-lat') assert.fail(`${venue.id} needs a sourced longitude and latitude`)
    const { lon, lat } = venue.position
    const rawOwners = abujaCity.rules.units.filter(unit => covered(administrativeUnits.get(unit.id), lon, lat))
    assert.equal(rawOwners.length, 1, `${venue.id} belongs to one opened raw ADM2 local government`)
    const rawOwner = rawOwners[0]!.id
    const expectedCouncil = venue.id.startsWith('kubwa-') ? 'bwari' : venue.id.startsWith('gwagwalada-') ? 'gwagwalada' : 'abuja-municipal'
    assert.equal(rawOwner, expectedCouncil, `${venue.id} matches its authored council`)
    assert.ok(covered(geometry.localUnits[rawOwner], lon, lat), `${venue.id} is on mapped land`)
  }

  for (const house of content.housing) {
    assert.ok(house.position && house.districtId, `${house.definition.id} declares its district`)
    const district = abujaCity.rules.districts.find(item => item.id === house.districtId)
    assert.ok(district)
    const { lon, lat } = house.position
    assert.ok(covered(administrativeUnits.get(district.localUnitId), lon, lat), `${house.definition.id} is in its raw ADM2 local government`)
    assert.ok(covered(geometry.localUnits[district.localUnitId], lon, lat), `${house.definition.id} is on land in ${district.localUnitId}`)
  }

  const garden = content.venues.find(venue => venue.id === 'kubwa-garden')
  assert.ok(garden?.position.kind === 'lon-lat')
  assert.ok(covered(administrativeUnits.get('bwari'), garden.position.lon, garden.position.lat))
})
