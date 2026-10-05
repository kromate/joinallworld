import type { CityMapGeometry, CityStateOverview, LonLatPolygon, LonLatRing } from '../../../types/content.ts'
import { LAGOS } from '../../../map3d/geo/data/lagos.ts'
import { OGUN_LGAS, OGUN_STATE } from '../../../map3d/geo/data/ogun.ts'
import { decodeTopology } from '../../../map3d/geo/topo.ts'
import type { Feature } from '../../../map3d/geo/topo.ts'
import { OGUN_STATE_LANDMARKS } from './landmarks.ts'

export interface OgunStateLandmark {
  id: string
  name: string
  lon: number
  lat: number
}

function ringCoordinates(ring: Float64Array): LonLatRing {
  const coordinates: [number, number][] = []
  for (let index = 0; index < ring.length; index += 2) coordinates.push([ring[index]!, ring[index + 1]!])
  return coordinates
}

function polygonsOf(feature: Feature): readonly LonLatPolygon[] {
  return feature.rings.map((polygon) => polygon.map(ringCoordinates))
}

const decoded = (): {
  lgas: ReturnType<typeof decodeTopology>
  state: Feature
  lagos: Feature
} => {
  const lgas = decodeTopology(OGUN_LGAS)
  const state = decodeTopology(OGUN_STATE).byId.get('ogun-state')
  const lagos = decodeTopology(LAGOS).byId.get('lagos-state')
  if (!state || !lagos) throw new Error('The Ogun overview requires Ogun and accepted Lagos state outlines')
  return { lgas, state, lagos }
}

export function ogunCityGeometry(localUnitIds: readonly string[]): CityMapGeometry {
  const { lgas, state } = decoded(), localUnits: Record<string, readonly LonLatPolygon[]> = {}
  const selectedIndexes = new Set<number>()
  for (const id of localUnitIds) {
    const feature = lgas.byId.get(id)
    if (!feature) throw new Error(`Ogun geometry is missing ${id}`)
    localUnits[id] = polygonsOf(feature)
    selectedIndexes.add(feature.index)
  }
  return Object.freeze({
    localUnits: Object.freeze(localUnits),
    playArea: Object.freeze(Object.values(localUnits).flat()),
    state: Object.freeze(polygonsOf(state)),
    water: Object.freeze([]),
    gridDegrees: OGUN_LGAS.grid,
    sharedArcCount: lgas.users.filter((users) => users.filter((index) => selectedIndexes.has(index)).length > 1).length,
    source: 'geoBoundaries gbOpen Nigeria, release 9469f09, GRID3 2022; Lagos seam locked to accepted Lagos topology',
    licence: 'CC BY 4.0',
  })
}

export function ogunStateOverview(landmarks: readonly OgunStateLandmark[] = OGUN_STATE_LANDMARKS): CityStateOverview {
  const { lgas, state, lagos } = decoded()
  return Object.freeze({
    stateId: 'ogun',
    name: 'Ogun State',
    outline: Object.freeze(polygonsOf(state)),
    localUnits: Object.freeze(lgas.features.map((feature) => Object.freeze({ id: feature.id, name: feature.name, polygons: Object.freeze(polygonsOf(feature)) }))),
    neighbours: Object.freeze([Object.freeze({ name: 'Lagos State', polygons: Object.freeze(polygonsOf(lagos)) })]),
    ...(landmarks.length ? { landmarks: Object.freeze(landmarks.map((landmark) => Object.freeze({ ...landmark }))) } : {}),
  })
}
