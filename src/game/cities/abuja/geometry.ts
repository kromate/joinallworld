import type { CityMapGeometry, CityStateOverview, LonLatPolygon, LonLatRing } from '../../../types/content.ts'
import { ABUJA_AREA_COUNCIL_IDS, FCT_COUNCILS, FCT_LAND, FCT_NEIGHBOURS, FCT_STATE, FCT_WATER } from '../../../map3d/geo/data/fct.ts'
import { decodeTopology } from '../../../map3d/geo/topo.ts'
import type { Feature } from '../../../map3d/geo/topo.ts'
import { ABUJA_LANDMARKS } from './landmarks.ts'

function ringCoordinates(ring: Float64Array): LonLatRing {
  const points: [number, number][] = []
  for (let i = 0; i < ring.length; i += 2) points.push([ring[i]!, ring[i + 1]!])
  return points
}

const polygonsOf = (feature: Feature): readonly LonLatPolygon[] => feature.rings.map(polygon => polygon.map(ringCoordinates))

/** Independent original ADM2 footprint; mapped water only removes land from the navigable councils. */
export function fctCityGeometry(): CityMapGeometry {
  const councils = decodeTopology(FCT_COUNCILS), land = decodeTopology(FCT_LAND)
  const state = decodeTopology(FCT_STATE).byId.get('fct')
  if (!state) throw new Error('FCT outline is missing')
  const localUnits: Record<string, readonly LonLatPolygon[]> = {}, playArea: LonLatPolygon[] = []
  for (const id of ABUJA_AREA_COUNCIL_IDS) {
    const original = councils.byId.get(id), dry = land.byId.get(id)
    if (!original || !dry) throw new Error(`FCT council geometry is missing ${id}`)
    localUnits[id] = polygonsOf(dry)
    playArea.push(...polygonsOf(original))
  }
  return Object.freeze({
    localUnits: Object.freeze(localUnits), playArea: Object.freeze(playArea), state: Object.freeze(polygonsOf(state)),
    water: Object.freeze(decodeTopology(FCT_WATER).features.flatMap(feature => [...polygonsOf(feature)])),
    gridDegrees: FCT_LAND.grid, sharedArcCount: land.users.filter(users => users.length > 1).length,
    source: 'geoBoundaries gbOpen Nigeria 9469f09, GRID3 2022; OpenStreetMap Geofabrik Nigeria 2026-10-03 water',
    licence: 'CC BY 4.0; ODbL 1.0',
  })
}

export function fctStateOverview(): CityStateOverview {
  const state = decodeTopology(FCT_STATE).byId.get('fct')
  if (!state) throw new Error('FCT outline is missing')
  return Object.freeze({
    stateId: 'fct', name: 'Federal Capital Territory', outline: Object.freeze(polygonsOf(state)),
    water: Object.freeze(decodeTopology(FCT_WATER).features.flatMap(feature => [...polygonsOf(feature)])),
    localUnits: Object.freeze(decodeTopology(FCT_COUNCILS).features.map(feature => Object.freeze({
      id: feature.id, name: feature.name, polygons: Object.freeze(polygonsOf(feature)),
    }))),
    neighbours: Object.freeze(decodeTopology(FCT_NEIGHBOURS).features.map(feature => Object.freeze({ name: feature.name, polygons: Object.freeze(polygonsOf(feature)) }))),
    landmarks: Object.freeze(ABUJA_LANDMARKS.map(({ id, name, lon, lat, context, kind }) => Object.freeze({ id, name, lon, lat, ...(context ? { context } : kind === 'backdrop' ? { context: 'Exterior landmark · not enterable' } : {}) }))),
  })
}
