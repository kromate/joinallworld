import assert from 'node:assert/strict'
import test from 'node:test'
import type { LonLatPolygon } from '../../../types/content.ts'
import { riversStateOverview } from './geometry.ts'
import { portHarcourtCity } from './index.ts'

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

function nearestWaterEdgeMetres(lon: number, lat: number, water: readonly LonLatPolygon[]): number {
  const metresPerLon = 111_320 * Math.cos(lat * Math.PI / 180)
  let nearest = Infinity
  for (const polygon of water) for (const ring of polygon) for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!
    const ax = (a[0] - lon) * metresPerLon, ay = (a[1] - lat) * 111_320
    const dx = (b[0] - a[0]) * metresPerLon, dy = (b[1] - a[1]) * 111_320
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return nearest
}

test('Port Harcourt venues have administrative membership and qualified land or waterfront placement', async () => {
  const [content, map] = await Promise.all([portHarcourtCity.loadContent(), portHarcourtCity.loadMap()])
  const geometry = await map.loadGeometry()
  const overview = riversStateOverview()
  const administrativeUnits = new Map(overview.localUnits.map(unit => [unit.id, unit.polygons]))
  const waterReferences: Readonly<Record<string, string>> = {
    wharf: 'port-harcourt', 'bonny-jetty': 'port-harcourt', 'okrika-jetty': 'okrika',
  }

  for (const venue of content.venues.filter(item => item.id !== 'home')) {
    if (venue.position.kind !== 'lon-lat') assert.fail(`${venue.id} needs a sourced longitude and latitude`)
    const { lon, lat } = venue.position
    const rawOwners = portHarcourtCity.rules.units.filter(unit => covered(administrativeUnits.get(unit.id), lon, lat))
    assert.equal(rawOwners.length, 1, `${venue.id} belongs to one opened raw ADM2 local government`)
    const rawOwner = rawOwners[0]!.id
    const waterOwner = waterReferences[venue.id]
    if (waterOwner) {
      assert.equal(rawOwner, waterOwner, `${venue.id} has its documented administrative owner`)
      assert.ok(covered(geometry.water, lon, lat), `${venue.id} is a mapped water reference`)
    } else {
      assert.ok(covered(geometry.localUnits[rawOwner], lon, lat), `${venue.id} is on mapped land`)
    }
  }

  // Wikidata's Tourist Beach coordinate is an area marker on land, about 478 m from the derived water edge.
  const beach = content.venues.find(venue => venue.id === 'tourist-beach')
  assert.ok(beach?.position.kind === 'lon-lat')
  assert.ok(nearestWaterEdgeMetres(beach.position.lon, beach.position.lat, geometry.water) < 600, 'Tourist Beach is near the mapped shore')

  for (const house of content.housing) {
    assert.ok(house.position && house.districtId, `${house.definition.id} declares its district`)
    const district = portHarcourtCity.rules.districts.find(item => item.id === house.districtId)
    assert.ok(district)
    const { lon, lat } = house.position
    assert.ok(covered(administrativeUnits.get(district.localUnitId), lon, lat), `${house.definition.id} is in its raw ADM2 local government`)
    assert.ok(covered(geometry.localUnits[district.localUnitId], lon, lat), `${house.definition.id} is on land in ${district.localUnitId}`)
  }

  const knownUnits = [
    ['pleasure-park', 'obio-akpor'], ['yakubu-gowon-stadium', 'port-harcourt'],
    ['airport', 'ikwerre'], ['oil-mill-market', 'obio-akpor'], ['refinery', 'okrika'],
  ] as const
  for (const [venueId, unitId] of knownUnits) {
    const venue = content.venues.find(item => item.id === venueId)
    assert.ok(venue?.position.kind === 'lon-lat')
    assert.ok(covered(administrativeUnits.get(unitId), venue.position.lon, venue.position.lat), `${venueId} lies in raw ADM2 ${unitId}`)
  }
})
