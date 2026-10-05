import assert from 'node:assert/strict'
import test from 'node:test'
import type { CityMapGeometry, CityModule, LonLatPolygon } from '../../../types/content.ts'
import { abeokutaCity } from '../abeokuta/index.ts'
import { otaCity } from '../ota/index.ts'
import { ijebuOdeCity } from '../ijebu-ode/index.ts'
import { sagamuCity } from '../sagamu/index.ts'

const inRing = (lon: number, lat: number, ring: readonly (readonly [number, number])[]): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if (!a || !b) continue
    if ((a[1] > lat) !== (b[1] > lat) && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
const inPolygon = (lon: number, lat: number, polygon: LonLatPolygon): boolean => polygon.reduce((inside, ring) => inRing(lon, lat, ring) ? !inside : inside, false)
const covered = (geometry: CityMapGeometry, unitId: string, lon: number, lat: number): boolean => (geometry.localUnits[unitId] ?? []).some(polygon => inPolygon(lon, lat, polygon))

for (const module of [abeokutaCity, otaCity, ijebuOdeCity, sagamuCity] as readonly CityModule[]) {
  test(`${module.id}: venue and housing coordinates belong to the authored local-government polygons`, async () => {
    const [content, map] = await Promise.all([module.loadContent(), module.loadMap()]), geometry = await map.loadGeometry()
    for (const venue of content.venues) {
      if (venue.position.kind !== 'lon-lat') continue
      const { lon, lat } = venue.position
      assert.ok(module.rules.units.some(unit => covered(geometry, unit.id, lon, lat)), `${venue.id} is inside the ${module.id} footprint`)
    }
    for (const house of content.housing) {
      assert.ok(house.position && house.districtId, `${house.definition.id} declares its geographic district`)
      const district = module.rules.districts.find(item => item.id === house.districtId)
      assert.ok(district, `${house.definition.id} district is registered`)
      assert.ok(covered(geometry, district.localUnitId, house.position.lon, house.position.lat), `${house.definition.id} lies inside ${district.localUnitId}`)
    }
  })
}

test('named Ogun university venues lie in their verified local governments', async () => {
  const checks = [
    [abeokutaCity, 'funaab', 'odeda'],
    [otaCity, 'covenant-university', 'ado-odo-ota'],
    [otaCity, 'bells-university', 'ado-odo-ota'],
    [ijebuOdeCity, 'tasued', 'ijebu-ode'],
    [sagamuCity, 'babcock-university', 'ikenne'],
  ] as const
  for (const [module, venueId, unitId] of checks) {
    const [content, map] = await Promise.all([module.loadContent(), module.loadMap()]), geometry = await map.loadGeometry()
    const venue = content.venues.find(item => item.id === venueId)
    assert.ok(venue?.position.kind === 'lon-lat', `${venueId} has a geographic position`)
    assert.ok(covered(geometry, unitId, venue.position.lon, venue.position.lat), `${venueId} lies inside ${unitId}`)
  }
})
