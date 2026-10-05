import type { CityMapGeometry, CityStateOverview, LonLatPolygon, LonLatRing } from '../../../types/content.ts'
import { KANO_CITY_LGA_IDS, KANO_LGAS, KANO_LAND, KANO_STATE, KANO_WATER, KANO_STATE_WATER } from '../../../map3d/geo/data/kano.ts'
import { decodeTopology } from '../../../map3d/geo/topo.ts'
import type { Feature } from '../../../map3d/geo/topo.ts'
import { KANO_LANDMARKS } from './landmarks.ts'

function ringCoordinates(ring: Float64Array): LonLatRing {
  const points: [number, number][] = []
  for (let i = 0; i < ring.length; i += 2) points.push([ring[i]!, ring[i + 1]!])
  return points
}

const polygonsOf = (feature: Feature): readonly LonLatPolygon[] => feature.rings.map(polygon => polygon.map(ringCoordinates))

/** Independent original ADM2 footprint; mapped water only removes land from the navigable local governments. */
export function kanoCityGeometry(): CityMapGeometry {
  const lgas = decodeTopology(KANO_LGAS), land = decodeTopology(KANO_LAND)
  const state = decodeTopology(KANO_STATE).byId.get('kano-state')
  if (!state) throw new Error('Kano outline is missing')
  const localUnits: Record<string, readonly LonLatPolygon[]> = {}, playArea: LonLatPolygon[] = []
  for (const id of KANO_CITY_LGA_IDS) {
    const original = lgas.byId.get(id), dry = land.byId.get(id)
    if (!original || !dry) throw new Error(`Kano LGA geometry is missing ${id}`)
    localUnits[id] = polygonsOf(dry)
    playArea.push(...polygonsOf(original))
  }
  return Object.freeze({
    localUnits: Object.freeze(localUnits), playArea: Object.freeze(playArea), state: Object.freeze(polygonsOf(state)),
    water: Object.freeze(decodeTopology(KANO_WATER).features.flatMap(feature => [...polygonsOf(feature)])),
    gridDegrees: KANO_LAND.grid, sharedArcCount: land.users.filter(users => users.length > 1).length,
    source: 'geoBoundaries gbOpen Nigeria 9469f09, GRID3 2022; OpenStreetMap Geofabrik Nigeria 2026-10-03 water',
    licence: 'CC BY 4.0; ODbL 1.0',
  })
}

export function kanoStateOverview(): CityStateOverview {
  const state = decodeTopology(KANO_STATE).byId.get('kano-state')
  if (!state) throw new Error('Kano outline is missing')
  return Object.freeze({
    stateId: 'kano', name: 'Kano State', outline: Object.freeze(polygonsOf(state)),
    water: Object.freeze(decodeTopology(KANO_STATE_WATER).features.flatMap(feature => [...polygonsOf(feature)])),
    localUnits: Object.freeze(decodeTopology(KANO_LGAS).features.map(feature => Object.freeze({
      id: feature.id, name: feature.name, polygons: Object.freeze(polygonsOf(feature)),
    }))),
    neighbours: Object.freeze([]),
    landmarks: Object.freeze(KANO_LANDMARKS.map(({ id, name, lon, lat, kind }) => Object.freeze({ id, name, lon, lat, ...(kind === 'context' || kind === 'water' ? { context: 'State reference · not a city venue' } : {}), ...(id === 'tiga-dam' ? { departure: { cityId: 'kano', venueId: 'railway-station', label: 'See simulated Tiga outing departure' } } : {}) }))),
  })
}
