import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CityContent, CityMapGeometry, CityMapPack, CityModule, LonLatPolygon } from '../../types/content.ts'
import { JOBS } from '../content/jobs.ts'
import { linksFrom, cityModule, loadCityContent, registerCityForTest } from './registry.ts'
import { project, unproject } from '../../map3d/geo/frame.ts'
import { KINDS as BUILT_SCENE_KINDS } from '../../scene/venue-scenes.ts'

export interface CityContractOptions { profile?: 'opened' | 'test-fixture' }

const unique = (values: readonly string[], label: string): void => { assert.equal(new Set(values).size, values.length, `${label} ids are unique`) }
const supportedSceneKinds = new Set([...BUILT_SCENE_KINDS, 'home', 'unilag'])
const requiredSceneGroups = [
  { label: 'home', kinds: ['home'] }, { label: 'food', kinds: ['buka'] }, { label: 'recreation', kinds: ['park', 'viewing', 'walk', 'beach'] },
  { label: 'market', kinds: ['market', 'mall'] }, { label: 'health', kinds: ['hospital'] }, { label: 'worship', kinds: ['worship'] },
  { label: 'polling', kinds: ['polling'] }, { label: 'government', kinds: ['statehouse'] },
] as const

const optionsFor = (module: CityModule, options: CityContractOptions): Required<CityContractOptions> => {
  const profile = options.profile ?? 'opened'
  if (profile === 'test-fixture') assert.ok(module.id.startsWith('test-'), 'only test-* modules may use the restricted contract profile')
  return { profile }
}
const activitiesAt = (content: CityContent, venueId: string, spotId?: string): readonly { id: string; tags?: string[] }[] => {
  const venue = content.venues.find((entry) => entry.id === venueId)?.definition
  return venue ? Object.values(venue.spots).filter((spot) => spotId === undefined || spot.id === spotId).flatMap((spot) => spot.activities) : []
}

export function assertCityContentContract(module: CityModule, content: CityContent, options: CityContractOptions = {}): void {
  const { profile } = optionsFor(module, options)
  assert.equal(content.cityId, module.id)
  const venueIds = content.venues.map((venue) => venue.id), venues = new Set(venueIds)
  unique(venueIds, 'venue')
  for (const [oldId, target] of Object.entries(module.rules.legacyVenueAliases ?? {})) {
    assert.ok(oldId.length > 0 && venues.has(target), `legacy venue ${oldId} resolves inside ${module.id}`)
  }
  for (const venue of content.venues) {
    assert.equal(venue.cityId, module.id); assert.equal(venue.id, venue.definition.id); assert.equal(venue.kind, venue.definition.scene.kind)
    assert.equal(venue.name, venue.definition.label, 'venue name matches its definition')
    assert.equal(venue.district, venue.definition.district, 'venue district matches its definition')
    assert.ok(supportedSceneKinds.has(venue.kind), `${venue.id} uses built scene kind ${venue.kind}`)
    assert.ok(venue.whatYouCanDo.length > 0, `${venue.id} describes what a player can do`)
  }
  if (profile === 'opened') {
    const kinds = new Set<string>(content.venues.map((venue) => venue.kind))
    for (const group of requiredSceneGroups) assert.ok(group.kinds.some((kind) => kinds.has(kind)), `required venue kind: ${group.label}`)
    const nightlife = ['club', 'shrine', 'rooftop'].some((kind) => kinds.has(kind))
      || content.venues.some((venue) => activitiesAt(content, venue.id).some((activity) => activity.tags?.includes('nightlife')))
    assert.ok(nightlife, 'required nightlife coverage: a nightlife scene or an activity tagged nightlife')
  }
  unique(content.regulars.map((regular) => regular.id), 'regular')
  for (const regular of content.regulars) {
    assert.equal(regular.cityId, module.id); assert.equal(regular.id, regular.definition.id, 'regular id matches its definition'); assert.ok(venues.has(regular.venueId), `${regular.id} belongs to this city's venue`); assert.equal(regular.venueId, regular.definition.venue)
  }
  for (const venue of content.venues.filter((entry) => entry.id !== 'home')) assert.ok(content.regulars.filter((regular) => regular.venueId === venue.id).length >= 2, `${venue.id} has two regulars`)
  const careerIds = [...content.workplaces.map((workplace) => workplace.careerId), ...content.unavailableCareerIds]
  unique(careerIds, 'career coverage')
  assert.deepEqual(careerIds.sort(), Object.keys(JOBS).sort(), 'every career has a workplace or is explicitly unavailable')
  assert.deepEqual([...module.rules.careerIds].sort(), content.workplaces.map((workplace) => workplace.careerId).sort(), 'eager career ids match lazy workplaces')
  for (const workplace of content.workplaces) {
    assert.equal(workplace.careerId, workplace.definition.id, 'workplace career id matches its definition')
    assert.ok(venues.has(workplace.venueId), `${workplace.careerId} has a venue in this city`)
    assert.equal(workplace.venueId, workplace.definition.workplace.venue)
    assert.ok(workplace.definition.workplace.spot.length > 0, `${workplace.careerId} declares its work spot`)
  }
  for (const event of content.events) assert.ok(venues.has(event.venue), `${event.id} uses this city's venue`)
  unique(content.housing.map((house) => house.definition.id), 'rented home'); assert.ok(content.housing.length > 0, 'at least one rented home is available')
  assert.deepEqual([...module.rules.rentedHomeIds].sort(), content.housing.map(house => house.definition.id).sort(), 'eager home ids match the lazy housing catalogue')
  assert.ok(module.rules.rentedHomeIds.includes(module.rules.defaultRentedHome), 'the default rented home is registered')
  for (const house of content.housing) {
    assert.equal(house.definition.district, house.spot.district)
    if (house.districtId !== undefined) assert.ok(module.rules.districts.some(district => district.id === house.districtId), `${house.definition.id} has an authored district`)
  }
  for (const venueId of content.radioVenueIds) assert.ok(venues.has(venueId), `radio venue ${venueId} exists`)
  for (const slot of content.billboardRoads) assert.ok(venues.has(slot.near), `billboard ${slot.id} has a local anchor`)
  for (const table of content.tablePlaces) assert.ok(venues.has(table.venueId), `table ${table.id} has a local venue`)
  for (const place of content.thingsToDo) assert.ok(venues.has(place.venueId), `guide place ${place.venueId} exists`)
  for (const goal of content.starterGoals) {
    if (goal.done.venue) assert.ok(venues.has(goal.done.venue), `goal ${goal.id} completion venue exists`)
    if (goal.go) {
      const [venueId, spotId] = goal.go; assert.ok(venues.has(venueId), `goal ${goal.id} destination venue exists`)
      if (spotId) assert.ok(content.venues.find((venue) => venue.id === venueId)?.definition.spots[spotId], `goal ${goal.id} destination spot exists`)
    }
    const destination = typeof goal.params?.destination === 'string' ? goal.params.destination : null
    if (destination) assert.ok(venues.has(destination), `goal ${goal.id} parameter destination exists`)
    const activityId = goal.activity ?? goal.done.activity
    if (activityId) {
      const scope = goal.go ? activitiesAt(content, goal.go[0], goal.go[1]) : content.venues.flatMap((venue) => activitiesAt(content, venue.id))
      assert.ok(scope.some((activity) => activity.id === activityId), `goal ${goal.id} activity exists in its destination`)
    }
  }
  for (const wish of content.wishes) {
    if (wish.on !== 'activity' && wish.on !== 'visit') continue
    assert.ok(venues.has(wish.venue), `wish ${wish.id} venue exists`)
    if (wish.on === 'visit') continue
    const scope = activitiesAt(content, wish.venue, wish.spot)
    if (wish.spot) assert.ok(content.venues.find((venue) => venue.id === wish.venue)?.definition.spots[wish.spot], `wish ${wish.id} spot exists`)
    if (wish.activity) assert.ok(scope.some((activity) => activity.id === wish.activity), `wish ${wish.id} activity exists`)
  }
}

interface PreparedPolygon { rings: Float64Array[]; minX: number; maxX: number; minZ: number; maxZ: number }
const inRing = (x: number, z: number, ring: ArrayLike<number>): boolean => {
  let inside = false
  for (let i = 0, n = ring.length / 2, j = n - 1; i < n; j = i++) {
    const ax = ring[i * 2]!, az = ring[i * 2 + 1]!, bx = ring[j * 2]!, bz = ring[j * 2 + 1]!
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside
  }
  return inside
}
const prepare = (polygon: LonLatPolygon): PreparedPolygon => {
  const rings = polygon.map((ring) => Float64Array.from(ring.flatMap(([lon, lat]) => { const point = project(lon, lat); return [point.x, point.z] })))
  assert.ok(rings[0] && rings[0].length >= 6, 'every polygon has an outer ring with at least three points')
  const out: PreparedPolygon = { rings, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (let i = 0; i < rings[0].length; i += 2) { out.minX = Math.min(out.minX, rings[0][i]!); out.maxX = Math.max(out.maxX, rings[0][i]!); out.minZ = Math.min(out.minZ, rings[0][i + 1]!); out.maxZ = Math.max(out.maxZ, rings[0][i + 1]!) }
  return out
}
const covers = (p: PreparedPolygon, x: number, z: number): boolean => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && p.rings.reduce((inside, ring) => inRing(x, z, ring) ? !inside : inside, false)
const prepared = (polygons: readonly LonLatPolygon[]): PreparedPolygon[] => polygons.map(prepare)
const pointKey = ([lon, lat]: readonly [number, number]): string => `${lon},${lat}`
const segmentKey = (a: readonly [number, number], b: readonly [number, number]): string => pointKey(a) < pointKey(b) ? `${pointKey(a)}|${pointKey(b)}` : `${pointKey(b)}|${pointKey(a)}`

function assertSharedBorders(geometry: CityMapGeometry): void {
  const owners = new Map<string, Set<string>>()
  for (const [unitId, polygons] of Object.entries(geometry.localUnits)) for (const polygon of polygons) for (const ring of polygon) for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length]; if (!a || !b || pointKey(a) === pointKey(b)) continue
    const key = segmentKey(a, b), set = owners.get(key) ?? new Set<string>(); set.add(unitId); owners.set(key, set)
  }
  for (const [segment, usedBy] of owners) assert.ok(usedBy.size <= 2, `border segment ${segment} belongs to at most two local units`)
  if (Object.keys(geometry.localUnits).length > 1) {
    assert.ok([...owners.values()].some((usedBy) => usedBy.size === 2), 'neighbouring local units share exact border segments')
    assert.ok(geometry.sharedArcCount > 0, 'shared-arc topology reports shared borders')
  }
}

function assertTiling(geometry: CityMapGeometry): void {
  const state = prepared(geometry.state), playArea = prepared(geometry.playArea), water = prepared(geometry.water)
  const units = Object.entries(geometry.localUnits).map(([id, polygons]) => ({ id, polygons: prepared(polygons) }))
  assert.ok(state.length > 0, 'state geometry exists'); assert.ok(playArea.length > 0, 'city play-area geometry exists')
  for (const unit of units) assert.ok(unit.polygons.length > 0, `${unit.id} has polygon geometry`)
  const all = [...state, ...playArea, ...water, ...units.flatMap((unit) => unit.polygons)]
  const minX = Math.min(...all.map((p) => p.minX)), maxX = Math.max(...all.map((p) => p.maxX)), minZ = Math.min(...all.map((p) => p.minZ)), maxZ = Math.max(...all.map((p) => p.maxZ))
  const step = Math.max(0.5, Math.max(maxX - minX, maxZ - minZ) / 320)
  let inState = 0, inPlayArea = 0, playOutsideState = 0, difference = 0, overlap = 0, landWaterOverlap = 0, outsideLand = 0, outsideWater = 0
  for (let x = minX; x <= maxX; x += step) for (let z = minZ; z <= maxZ; z += step) {
    const s = state.some((p) => covers(p, x, z)), city = playArea.some((p) => covers(p, x, z))
    const land = units.filter((unit) => unit.polygons.some((p) => covers(p, x, z))).length, wet = water.some((p) => covers(p, x, z))
    if (s) inState += 1; if (city) inPlayArea += 1; if (city && !s) playOutsideState += 1
    if (city !== (land > 0 || wet)) difference += 1; if (land > 1) overlap += 1; if (land && wet) landWaterOverlap += 1
    if (!city && land) outsideLand += 1; if (!city && wet) outsideWater += 1
  }
  assert.ok(inState > 0, 'state polygon covers sampled ground'); assert.ok(inPlayArea > 0, 'city play area covers sampled ground')
  assert.ok(playOutsideState / inPlayArea < 0.001, `city play area stays inside the state (outside ${(playOutsideState / inPlayArea * 100).toFixed(3)}%)`)
  assert.ok(outsideLand / inPlayArea < 0.001, `local-unit land stays inside the city play area (outside ${(outsideLand / inPlayArea * 100).toFixed(3)}%)`)
  assert.ok(outsideWater / inPlayArea < 0.001, `declared local water stays inside the city play area (outside ${(outsideWater / inPlayArea * 100).toFixed(3)}%)`)
  assert.ok(difference / inPlayArea < 0.01, `local units plus water cover the city play area within 1% (difference ${(difference / inPlayArea * 100).toFixed(2)}%)`)
  assert.ok(overlap / inPlayArea < 0.001, `local-unit polygons do not overlap (overlap ${(overlap / inPlayArea * 100).toFixed(3)}%)`)
  assert.ok(landWaterOverlap / inPlayArea < 0.002, 'water does not overlap local-unit land')
}

export async function assertCityMapContract(module: CityModule, map: CityMapPack): Promise<void> {
  assert.equal(map.cityId, module.id); assert.equal(map.projection, 'nigeria-equirectangular-v1'); assert.equal(map.unitsPerKm, 10)
  assert.ok(Number.isInteger(map.origin.x) && Number.isInteger(map.origin.z), 'map origin uses whole frame units'); assert.deepEqual(map.origin, module.rules.mapOrigin)
  assert.deepEqual([...map.localUnitIds].sort(), module.rules.units.map((unit) => unit.id).sort())
  const [scene, geometry] = await Promise.all([map.loadScene(), map.loadGeometry()])
  assert.equal(scene.id, module.id); assert.deepEqual(scene.lgas.map((unit) => unit.id).sort(), module.rules.units.map((unit) => unit.id).sort())
  assert.deepEqual(Object.keys(geometry.localUnits).sort(), module.rules.units.map((unit) => unit.id).sort()); assert.ok(geometry.gridDegrees > 0)
  assert.ok(geometry.source.length > 0 && geometry.licence.length > 0, 'geometry states its source and licence')
  let worst = 0
  for (const polygons of [...Object.values(geometry.localUnits), geometry.playArea, geometry.state, geometry.water]) for (const polygon of polygons) for (const ring of polygon) for (const [lon, lat] of ring) {
    assert.ok(Number.isFinite(lon) && Number.isFinite(lat), 'geometry is finite longitude and latitude'); const p = project(lon, lat), back = unproject(p.x, p.z); worst = Math.max(worst, Math.abs(back.lon - lon), Math.abs(back.lat - lat))
  }
  assert.ok(worst < 1e-9, `shared-frame round trip error ${worst}`); assertSharedBorders(geometry); assertTiling(geometry)
}

const linkShape = (link: { to: string; mode: string; label: string; icon: string; fare: number; seconds: number; km: number; beta?: boolean }) => ({ to: link.to, mode: link.mode, label: link.label, icon: link.icon, fare: link.fare, seconds: link.seconds, km: link.km, beta: link.beta })
export function assertCityRulesContract(module: CityModule, options: CityContractOptions = {}): void {
  const { profile } = optionsFor(module, options)
  assert.equal(module.id, module.rules.id); assert.equal(module.rules.status, 'open'); assert.ok(module.rules.timezone.length > 0); assert.ok(module.rules.units.length > 0)
  unique(module.rules.units.map((unit) => unit.id), 'local unit'); unique(module.rules.districts.map((district) => district.id), 'district'); unique(module.rules.hubs.map((hub) => hub.id), 'hub')
  if (profile === 'opened') {
    assert.ok(module.rules.districts.length > 0, 'opened city declares at least one rented-home district')
    assert.ok(module.rules.hubs.some((hub) => hub.mode === 'road'), 'opened city declares a road hub')
  }
  const units = new Set(module.rules.units.map((unit) => unit.id)); for (const district of module.rules.districts) assert.ok(units.has(district.localUnitId), `${district.id} belongs to a local unit`)
  for (const link of module.rules.links) {
    assert.ok(link.a === module.id || link.b === module.id, 'each link touches its city'); if (profile === 'test-fixture') continue
    const fromA = linksFrom(link.a).find((candidate) => candidate.to === link.b && candidate.mode === link.mode), fromB = linksFrom(link.b).find((candidate) => candidate.to === link.a && candidate.mode === link.mode)
    assert.ok(fromA && fromB, `${link.a} and ${link.b} expose a round-trip registry link`)
    assert.deepEqual(linkShape(fromA), { ...linkShape(fromB), to: link.b }); assert.deepEqual(linkShape(fromA), { to: link.b, mode: link.mode, label: link.label, icon: link.icon, fare: link.fare, seconds: link.seconds, km: link.km, beta: link.beta }, 'module link matches the registry')
  }
}

export async function assertCityModuleContract(module: CityModule, options: CityContractOptions = {}): Promise<void> {
  assertCityRulesContract(module, options); assertCityContentContract(module, await module.loadContent(), options); await assertCityMapContract(module, await module.loadMap())
}
export function cityContractTest(module: CityModule, options: CityContractOptions = {}): void {
  test(`${module.id}: eager city rules contract`, () => assertCityRulesContract(module, options))
  test(`${module.id}: lazy content contract`, async () => assertCityContentContract(module, await module.loadContent(), options))
  test(`${module.id}: lazy map contract`, async () => assertCityMapContract(module, await module.loadMap()))
  test(`${module.id}: a new guest starts at a public venue`, async () => {
    const registration = cityModule(module.id) ? null : registerCityForTest(module)
    try {
      await loadCityContent(module.id)
      const [{ createLife, dispatch }, { DEFAULT_LOOK }] = await Promise.all([import('../../life.ts'), import('../content/traits.ts')])
      const context = { cityId: module.id, now: Date.UTC(2026, 0, 5, 9), isNew: true, quickStart: true }
      const state = createLife(null, context)
      assert.notEqual(state.location, 'home')
      assert.equal(dispatch(state, { type: 'onboarding.quick-start', payload: { look: DEFAULT_LOOK } }, context).ok, true)
      assert.notEqual(state.location, 'home')
      assert.equal(state.onboarding.done, false)
    } finally { registration?.dispose() }
  })
}
