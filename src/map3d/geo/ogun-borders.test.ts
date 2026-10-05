import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CityModule, LonLatPolygon } from '../../types/content.ts'
import { abeokutaCity } from '../../game/cities/abeokuta/index.ts'
import { otaCity } from '../../game/cities/ota/index.ts'
import { ijebuOdeCity } from '../../game/cities/ijebu-ode/index.ts'
import { sagamuCity } from '../../game/cities/sagamu/index.ts'
import { IJEBU_ODE_LANDMARKS, OGUN_STATE_LANDMARKS, ABEOKUTA_LANDMARKS, OTA_LANDMARKS, SAGAMU_LANDMARKS } from '../../game/cities/ogun/landmarks.ts'
import { LAGOS } from './data/lagos.ts'
import { OGUN_CITY_LGA_IDS, OGUN_COMING_LGA_IDS, OGUN_LGAS, OGUN_STATE } from './data/ogun.ts'
import { OYO_LGAS, OYO_STATE } from './data/oyo.ts'
import { decodeTopology } from './topo.ts'
import type { RawTopo } from './topo.ts'

type Edge = readonly [number, number, number, number]
const key = (lon: number, lat: number): string => `${lon},${lat}`
const edgeKey = ([ax, ay, bx, by]: Edge): string => (key(ax, ay) < key(bx, by) ? `${key(ax, ay)}|${key(bx, by)}` : `${key(bx, by)}|${key(ax, ay)}`)

function polygonsOf(raw: RawTopo, id: string): LonLatPolygon[] {
  const feature = decodeTopology(raw).byId.get(id)
  if (!feature) throw new Error(`Missing feature ${id}`)
  return feature.rings.map((polygon) => polygon.map((ring) => {
    const points: [number, number][] = []
    for (let i = 0; i < ring.length; i += 2) points.push([ring[i]!, ring[i + 1]!])
    return points
  }))
}
function edgesOf(polygons: readonly LonLatPolygon[]): Edge[] {
  const edges: Edge[] = []
  for (const polygon of polygons) for (const ring of polygon) for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!
    edges.push([a[0], a[1], b[0], b[1]])
  }
  return edges
}
const allFeatureEdges = (raw: RawTopo): Edge[] => edgesOf(decodeTopology(raw).features.flatMap((feature) => polygonsOf(raw, feature.id)))

const inRing = (lon: number, lat: number, ring: LonLatPolygon[number]): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!
    if ((a[1] > lat) !== (b[1] > lat) && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
const covers = (polygons: readonly LonLatPolygon[], lon: number, lat: number): boolean =>
  polygons.some((polygon) => polygon.reduce((inside, ring) => (inRing(lon, lat, ring) ? !inside : inside), false))

function distanceToEdge(lon: number, lat: number, [ax, ay, bx, by]: Edge): number {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(lon - ax - t * dx, lat - ay - t * dy)
}

const sharedEdges = (a: readonly Edge[], b: readonly Edge[]): Edge[] => {
  const keys = new Set(b.map(edgeKey))
  return a.filter((edge) => keys.has(edgeKey(edge)))
}

/** The shared edges must form one open chain: two ends, every other vertex used by exactly two edges. */
function assertOneChain(shared: readonly Edge[], label: string): number {
  const degree = new Map<string, number>()
  for (const [ax, ay, bx, by] of shared) for (const k of [key(ax, ay), key(bx, by)]) degree.set(k, (degree.get(k) ?? 0) + 1)
  const counts = [...degree.values()]
  assert.equal(counts.filter((c) => c === 1).length, 2, `${label}: the border has exactly two ends`)
  assert.equal(counts.some((c) => c > 2), false, `${label}: the border does not branch`)
  assert.equal(degree.size, shared.length + 1, `${label}: the border is one continuous chain`)
  return degree.size
}

const ogunState = polygonsOf(OGUN_STATE, 'ogun-state')
const ogunEdges = edgesOf(ogunState)
const GRID = OGUN_STATE.grid

test('Ogun and Lagos share one border chain with identical vertices', () => {
  const lagosEdges = edgesOf(polygonsOf(LAGOS, 'lagos-state'))
  const shared = sharedEdges(ogunEdges, lagosEdges)
  const vertices = assertOneChain(shared, 'Ogun-Lagos')
  assert.equal(vertices, 430, 'the accepted 430-vertex seam')
  // The seam runs along Lagos's northern and western edge: every vertex lies north or west of the Lagos coast belt.
  for (const [ax, ay] of shared) assert.ok(ay > 6.2 && ax < 4.7, 'seam vertices lie on the Lagos land border')
  // No Lagos vertex that is off the seam lies inside Ogun, and no Ogun vertex off the seam lies inside Lagos.
  const seam = new Set(shared.flatMap(([ax, ay, bx, by]) => [key(ax, ay), key(bx, by)]))
  const lagos = polygonsOf(LAGOS, 'lagos-state')
  for (const [ax, ay] of ogunEdges) if (!seam.has(key(ax, ay))) assert.equal(covers(lagos, ax, ay), false, `Ogun vertex ${ax},${ay} is outside Lagos`)
  for (const [ax, ay] of edgesOf(lagos)) if (!seam.has(key(ax, ay))) assert.equal(covers(ogunState, ax, ay), false, `Lagos vertex ${ax},${ay} is outside Ogun`)
})

test('Ogun and Oyo share one border chain with identical vertices along Oyo\'s southern edge', () => {
  const oyo = polygonsOf(OYO_STATE, 'oyo-state'), oyoEdges = edgesOf(oyo)
  const shared = sharedEdges(ogunEdges, oyoEdges)
  const vertices = assertOneChain(shared, 'Ogun-Oyo')
  assert.ok(vertices > 400, 'the border keeps its source detail')
  const lats = shared.flatMap(([, ay, , by]) => [ay, by]), lons = shared.flatMap(([ax, , bx]) => [ax, bx])
  assert.ok(Math.min(...lats) > 7.0 && Math.max(...lats) < 8.0, 'the shared border is Oyo\'s southern edge')
  assert.ok(Math.min(...lons) < 2.8 && Math.max(...lons) > 4.0, 'it spans the width of Ogun north of Ijebu')
  const seam = new Set(shared.flatMap(([ax, ay, bx, by]) => [key(ax, ay), key(bx, by)]))
  for (const [ax, ay] of ogunEdges) if (!seam.has(key(ax, ay))) assert.equal(covers(oyo, ax, ay), false, `Ogun vertex ${ax},${ay} is outside Oyo`)
  for (const [ax, ay] of oyoEdges) if (!seam.has(key(ax, ay))) assert.equal(covers(ogunState, ax, ay), false, `Oyo vertex ${ax},${ay} is outside Ogun`)
})

test('the local-government layers follow the same seams as the state outlines', () => {
  const ogunLgaEdges = allFeatureEdges(OGUN_LGAS)
  const seams: [string, Edge[]][] = [
    ['Lagos', sharedEdges(ogunEdges, edgesOf(polygonsOf(LAGOS, 'lagos-state')))],
    ['Oyo', sharedEdges(ogunEdges, edgesOf(polygonsOf(OYO_STATE, 'oyo-state')))],
  ]
  for (const [label, seam] of seams) {
    // Local-government outlines may carry extra collinear vertices; every seam vertex must still lie on one of their edges.
    for (const [ax, ay] of seam) assert.ok(ogunLgaEdges.some((edge) => distanceToEdge(ax, ay, edge) < GRID / 2), `${label} seam vertex ${ax},${ay} lies on an Ogun local-government edge`)
  }
  const oyoLgaEdges = allFeatureEdges(OYO_LGAS)
  for (const [ax, ay] of seams[1]![1]) assert.ok(oyoLgaEdges.some((edge) => distanceToEdge(ax, ay, edge) < GRID / 2), `Oyo seam vertex ${ax},${ay} lies on an Oyo local-government edge`)
})

test('the 20 local-government names match the official list and the opened cities hold the right ones', () => {
  const flat = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, '')
  const official = [
    'Abeokuta North', 'Abeokuta South', 'Ado-Odo/Ota', 'Ewekoro', 'Ifo', 'Ijebu East', 'Ijebu North', 'Ijebu North East', 'Ijebu Ode', 'Ikenne',
    'Imeko Afon', 'Ipokia', 'Obafemi Owode', 'Odeda', 'Odogbolu', 'Ogun Waterside', 'Remo North', 'Sagamu', 'Yewa North', 'Yewa South',
  ]
  const topology = decodeTopology(OGUN_LGAS), byName = new Map(topology.features.map((feature) => [flat(feature.name), feature.id]))
  assert.deepEqual([...byName.keys()].sort(), official.map(flat).sort())
  const expected: Record<string, string[]> = {
    abeokuta: ['Abeokuta North', 'Abeokuta South', 'Odeda', 'Obafemi Owode'],
    ota: ['Ado-Odo/Ota'],
    'ijebu-ode': ['Ijebu Ode', 'Ijebu North East', 'Odogbolu'],
    sagamu: ['Sagamu', 'Ikenne', 'Remo North'],
  }
  for (const [city, names] of Object.entries(expected)) assert.deepEqual([...OGUN_CITY_LGA_IDS[city as keyof typeof OGUN_CITY_LGA_IDS]].sort(), names.map((name) => byName.get(flat(name))!).sort(), city)
  const opened = new Set(Object.values(OGUN_CITY_LGA_IDS).flat())
  assert.deepEqual([...OGUN_COMING_LGA_IDS].sort(), topology.features.map((feature) => feature.id).filter((id) => !opened.has(id as never)).sort())
})

const cities = [abeokutaCity, otaCity, ijebuOdeCity, sagamuCity] as readonly CityModule[]
const lgaNameKey = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, '')

for (const city of cities) {
  test(`${city.id}: every venue lies inside its own local-government footprint and the city map extent, in the local government its district names`, async () => {
    const [content, map] = await Promise.all([city.loadContent(), city.loadMap()]), geometry = await map.loadGeometry()
    const outer = geometry.playArea.flatMap((polygon) => polygon[0] ?? [])
    const minLon = Math.min(...outer.map((p) => p[0])), maxLon = Math.max(...outer.map((p) => p[0]))
    const minLat = Math.min(...outer.map((p) => p[1])), maxLat = Math.max(...outer.map((p) => p[1]))
    const names = new Map(decodeTopology(OGUN_LGAS).features.map((feature) => [feature.id, lgaNameKey(feature.name)]))
    const spots = new Map<string, string>()
    for (const venue of content.venues) {
      if (venue.position.kind !== 'lon-lat') continue
      const { lon, lat } = venue.position
      assert.ok(lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat, `${venue.id} is inside the ${city.id} map extent`)
      const unit = Object.keys(geometry.localUnits).find((id) => covers(geometry.localUnits[id] ?? [], lon, lat))
      assert.ok(unit, `${venue.id} is inside a ${city.id} local government`)
      const suffix = lgaNameKey(venue.district.split(',').at(-1) ?? '')
      if ([...names.values()].includes(suffix)) assert.equal(names.get(unit), suffix, `${venue.id}: district "${venue.district}" matches the local government at its point`)
      if (venue.id === 'home') continue
      const at = `${lon.toFixed(4)},${lat.toFixed(4)}`
      assert.equal(spots.has(at), false, `${venue.id} does not share a point with ${spots.get(at)}`)
      spots.set(at, venue.id)
    }
  })
}

/** Coordinates checked against OpenStreetMap, Wikidata and Wikimedia Commons structured coordinates. */
const VERIFIED: readonly { id: string; name: string; lon: number; lat: number; source: string }[] = [
  { id: 'olumo-rock', name: 'Olumo Rock', lon: 3.34261, lat: 7.16726, source: 'Wikidata Q18357041' },
  { id: 'alake-palace', name: "Alake's Palace", lon: 3.35294, lat: 7.16433, source: 'Wikidata Q126111457' },
  { id: 'itoku-market', name: 'Itoku market', lon: 3.3425, lat: 7.15677, source: 'Wikidata Q130493565' },
  { id: 'kuto-market', name: 'Kuto market', lon: 3.35038, lat: 7.13918, source: 'Wikidata Q108600697' },
  { id: 'centenary-hall', name: 'Centenary Hall', lon: 3.35351, lat: 7.16401, source: 'Wikidata Q109272765' },
  { id: 'funaab', name: 'FUNAAB', lon: 3.43723, lat: 7.22328, source: 'OpenStreetMap way 705301227' },
  { id: 'oopl', name: 'Olusegun Obasanjo Presidential Library', lon: 3.36405, lat: 7.12596, source: 'Wikidata Q86339554' },
  { id: 'mko-abiola-stadium', name: 'MKO Abiola Stadium', lon: 3.35528, lat: 7.1325, source: 'Wikidata Q6716446' },
  { id: 'covenant-university', name: 'Covenant University', lon: 3.15743, lat: 6.66994, source: 'Wikidata Q742241' },
  { id: 'babcock-university', name: 'Babcock University', lon: 3.7187, lat: 6.894, source: 'Wikidata Q653638' },
  { id: 'oou-ago-iwoye', name: 'Olabisi Onabanjo University', lon: 3.87144, lat: 6.92185, source: 'OpenStreetMap way 789111299' },
  { id: 'tasued', name: 'TASUED', lon: 3.93049, lat: 6.79281, source: 'Wikidata Q7675831' },
  { id: 'ojude-oba-city-reference', name: 'Ijebu-Ode city reference for Ojude Oba', lon: 3.9151668, lat: 6.8140077, source: 'OpenStreetMap node 501496491' },
  { id: 'sagamu-interchange', name: 'Sagamu Interchange', lon: 3.5788, lat: 6.8832, source: 'OpenStreetMap ways 281964151-281964163' },
  { id: 'wole-soyinka-station', name: 'Professor Wole Soyinka Station', lon: 3.39844, lat: 7.12918, source: 'OpenStreetMap way 1323182112' },
  { id: 'papalanto-station', name: 'Papalanto station', lon: 3.23336, lat: 6.91335, source: 'OpenStreetMap node 9074714198, on the railway line' },
]

const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }): number =>
  Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_540)

test('the reference landmarks are within 1 km of their verified coordinates, in the right local government', () => {
  const catalogue = [...OGUN_STATE_LANDMARKS, ...ABEOKUTA_LANDMARKS, ...OTA_LANDMARKS, ...IJEBU_ODE_LANDMARKS, ...SAGAMU_LANDMARKS]
  const homes: Record<string, string> = {
    'olumo-rock': 'abeokuta-south', 'alake-palace': 'abeokuta-south', 'itoku-market': 'abeokuta-north', 'kuto-market': 'abeokuta-south',
    'centenary-hall': 'abeokuta-south', funaab: 'odeda', oopl: 'obafemi-owode', 'mko-abiola-stadium': 'abeokuta-south',
    'covenant-university': 'ado-odo-ota', 'babcock-university': 'ikenne', 'oou-ago-iwoye': 'ijebu-north', tasued: 'ijebu-ode',
    // The source ADM2 outline places the old town centre inside Odogbolu; both belong to the Ijebu-Ode city footprint.
    'ojude-oba-city-reference': 'odogbolu', 'sagamu-interchange': 'sagamu', 'wole-soyinka-station': 'obafemi-owode', 'papalanto-station': 'ewekoro',
  }
  const units = new Map(Object.entries(homes).map(([id, unit]) => [id, polygonsOf(OGUN_LGAS, unit)]))
  for (const verified of VERIFIED) {
    const point = catalogue.find((item) => item.id === verified.id)
    assert.ok(point, `${verified.name} is in the landmark catalogue`)
    assert.ok(metres(point, verified) < 1000, `${verified.name} is within 1 km of ${verified.source} (${Math.round(metres(point, verified))} m)`)
    assert.ok(covers(units.get(verified.id)!, point.lon, point.lat), `${verified.name} lies in ${homes[verified.id]}`)
  }
})
