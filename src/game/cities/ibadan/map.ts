import { ibadanCity } from './index.ts'
import { IBADAN_LANDMARK_POINTS } from './landmarks.ts'
import type { CityMapGeometry, CityMapPack, LonLatPolygon, LonLatRing } from '../../../types/content.ts'
import { decodeTopology } from '../../../map3d/geo/topo.ts'
import type { Feature } from '../../../map3d/geo/topo.ts'
import { IBADAN_LGA_IDS, OYO_LGAS, OYO_STATE } from '../../../map3d/geo/data/oyo.ts'
import { IBADAN_MAP_ORIGIN } from './rules.ts'
import { citiesInState } from '../registry.ts'
import type { ContextSpec } from '../../../map3d/context.ts'
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

/**
 * What lies around Oyo State on the whole-state view: Ogun to the south (its city, Abeokuta, answers a tap with "Opening soon"), Osun and Ondo
 * to the east, Kwara to the north, the Republic of Benin to the west, and the Lagos road leaving towards the coast. The roads inside the play
 * area are the OpenStreetMap ones of roads.ts; this one carries on from where they leave it.
 */
const SURROUNDINGS: ContextSpec = {
  own: 'oyo',
  countries: ['bj', 'tg'],
  roads: [{ id: 'lagos', name: 'Lagos–Ibadan Expressway', line: [[3.725, 7.08], [3.7, 7.04], [3.55, 6.88], [3.42, 6.74], [3.365, 6.642]] }],
  names: [
    { id: 'ogun', text: 'OGUN STATE', kind: 'state', at: [3.45, 6.95] },
    { id: 'osun', text: 'OSUN STATE', kind: 'state', at: [4.55, 7.55] },
    { id: 'ondo', text: 'ONDO STATE', kind: 'state', at: [4.95, 6.95] },
    { id: 'kwara', text: 'KWARA STATE', kind: 'state', at: [4.1, 8.55] },
    { id: 'oyo', text: 'OYO STATE', kind: 'state', at: [3.4, 8.05] },
    { id: 'benin', text: 'REPUBLIC OF BENIN', kind: 'country', at: [2.5, 7.5] },
  ],
};

/** The lightweight Ibadan map contract. Its anchor is the pinned city-centre point, 3.93 E and 7.38 N. */
export const IBADAN_MAP: CityMapPack<'ibadan', IbadanLocalGovernmentId> = Object.freeze({
  cityId: 'ibadan',
  origin: IBADAN_MAP_ORIGIN,
  projection: 'nigeria-equirectangular-v1',
  unitsPerKm: 10,
  localUnitIds: IBADAN_LGA_IDS,
  stateFeatureId: 'oyo-state',
  loadScene: async () => {
    const [{ createModulePack }, { IBADAN_ROADS }, { IBADAN_CHARACTER }] = await Promise.all([import('../../../map3d/cities/module.ts'), import('./roads.ts'), import('./character.ts')])
    return createModulePack(ibadanCity, { landmarks: IBADAN_LANDMARK_POINTS, roads: IBADAN_ROADS, character: IBADAN_CHARACTER, surroundings: { spec: SURROUNDINGS, planned: ['ogun', 'osun', 'ondo', 'kwara'].filter((state) => citiesInState(state).length > 0) } })
  },
  loadGeometry: async () => geometry(),
})
