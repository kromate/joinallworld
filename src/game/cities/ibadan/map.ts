import { ibadanCity } from './index.ts'
import { IBADAN_LANDMARK_POINTS } from './landmarks.ts'
import type { CityMapGeometry, CityMapPack, LonLatPolygon, LonLatRing } from '../../../types/content.ts'
import { decodeTopology } from '../../../map3d/geo/topo.ts'
import type { Feature } from '../../../map3d/geo/topo.ts'
import { IBADAN_LGA_IDS, OYO_LGAS, OYO_STATE } from '../../../map3d/geo/data/oyo.ts'
import { IBADAN_MAP_ORIGIN } from './rules.ts'
import type { IbadanLocalGovernmentId } from './rules.ts'

function ringCoordinates(ring: Float64Array): LonLatRing {
  const coordinates: [number, number][] = []
  for (let index = 0; index < ring.length; index += 2) coordinates.push([ring[index]!, ring[index + 1]!])
  return coordinates
}

function polygonsOf(feature: Feature): readonly LonLatPolygon[] {
  return feature.rings.map((polygon) => polygon.map(ringCoordinates))
}

function geometry(): CityMapGeometry {
  const lgas = decodeTopology(OYO_LGAS), state = decodeTopology(OYO_STATE)
  const localUnits: Record<string, readonly LonLatPolygon[]> = {}
  const selectedIndexes = new Set<number>()
  for (const id of IBADAN_LGA_IDS) {
    const feature = lgas.byId.get(id)
    if (!feature) throw new Error(`Oyo geometry is missing ${id}`)
    localUnits[id] = polygonsOf(feature)
    selectedIndexes.add(feature.index)
  }
  const stateFeature = state.byId.get('oyo-state')
  if (!stateFeature) throw new Error('Oyo geometry is missing the state outline')
  return Object.freeze({
    localUnits: Object.freeze(localUnits),
    playArea: Object.freeze(Object.values(localUnits).flat()),
    state: Object.freeze(polygonsOf(stateFeature)),
    water: Object.freeze([]),
    gridDegrees: OYO_LGAS.grid,
    sharedArcCount: lgas.users.filter((users) => users.filter((index) => selectedIndexes.has(index)).length > 1).length,
    source: 'geoBoundaries gbOpen Nigeria, release 9469f09, GRID3 2022',
    licence: 'CC BY 4.0',
  })
}

/** The lightweight Ibadan map contract. Its anchor is the pinned city-centre point, 3.93 E and 7.38 N. */
export const IBADAN_MAP: CityMapPack<'ibadan', IbadanLocalGovernmentId> = Object.freeze({
  cityId: 'ibadan',
  origin: IBADAN_MAP_ORIGIN,
  projection: 'nigeria-equirectangular-v1',
  unitsPerKm: 10,
  localUnitIds: IBADAN_LGA_IDS,
  stateFeatureId: 'oyo-state',
  loadScene: async () => (await import('../../../map3d/cities/module.ts')).createModulePack(ibadanCity, IBADAN_LANDMARK_POINTS),
  loadGeometry: async () => geometry(),
})
