import type { CityMapGeometry, CityStateOverview, LonLatPolygon, LonLatRing } from '../../../types/content.ts'
import {
  PORT_HARCOURT_LGA_IDS, RIVERS_CITY_WATER, RIVERS_LAND, RIVERS_LGAS, RIVERS_MANGROVE,
  RIVERS_STATE, RIVERS_STATE_WATER,
} from '../../../map3d/geo/data/rivers.ts'
import { decodeTopology } from '../../../map3d/geo/topo.ts'
import type { Feature } from '../../../map3d/geo/topo.ts'
import { PORT_HARCOURT_LANDMARKS } from './landmarks.ts'

function ringCoordinates(ring: Float64Array): LonLatRing {
  const points: [number, number][] = []
  for (let i = 0; i < ring.length; i += 2) points.push([ring[i]!, ring[i + 1]!])
  return points
}

function polygonsOf(feature: Feature): readonly LonLatPolygon[] {
  return feature.rings.map((polygon) => polygon.map(ringCoordinates))
}

function decoded() {
  const lgas = decodeTopology(RIVERS_LGAS), land = decodeTopology(RIVERS_LAND), cityWater = decodeTopology(RIVERS_CITY_WATER)
  const state = decodeTopology(RIVERS_STATE).byId.get('rivers-state')
  if (!state) throw new Error('Rivers state outline is missing')
  return { lgas, land, cityWater, state }
}

export function riversCityGeometry(): CityMapGeometry {
  const { lgas, land, cityWater, state } = decoded()
  const localUnits: Record<string, readonly LonLatPolygon[]> = {}
  const playArea: LonLatPolygon[] = []
  const selected = new Set<number>()
  for (const id of PORT_HARCOURT_LGA_IDS) {
    const feature = land.byId.get(id)
    const administrativeUnit = lgas.byId.get(id)
    if (!feature) throw new Error(`Rivers geometry is missing ${id}`)
    if (!administrativeUnit) throw new Error(`Rivers administrative geometry is missing ${id}`)
    localUnits[id] = polygonsOf(feature)
    playArea.push(...polygonsOf(administrativeUnit))
    selected.add(feature.index)
  }
  const water = cityWater.features.flatMap(polygonsOf)
  return Object.freeze({
    localUnits: Object.freeze(localUnits),
    playArea: Object.freeze(playArea),
    state: Object.freeze(polygonsOf(state)),
    water: Object.freeze(water),
    gridDegrees: RIVERS_LAND.grid,
    sharedArcCount: land.users.filter((users) => users.filter((index) => selected.has(index)).length > 1).length,
    source: 'geoBoundaries gbOpen Nigeria release 9469f09, GRID3 2022; OpenStreetMap Geofabrik Nigeria 2026-10-03 water',
    licence: 'CC BY 4.0; ODbL 1.0',
  })
}

export function riversMangrovePolygons(): readonly LonLatPolygon[] {
  const feature = decodeTopology(RIVERS_MANGROVE).byId.get('port-harcourt-mangrove')
  return feature ? Object.freeze(polygonsOf(feature)) : Object.freeze([])
}

export function riversStateOverview(): CityStateOverview {
  const { lgas, state } = decoded()
  const mappedWater = decodeTopology(RIVERS_STATE_WATER).byId.get('rivers-water')
  return Object.freeze({
    stateId: 'rivers', name: 'Rivers State', outline: Object.freeze(polygonsOf(state)),
    water: Object.freeze(mappedWater ? polygonsOf(mappedWater) : []),
    localUnits: Object.freeze(lgas.features.map((feature) => Object.freeze({ id: feature.id, name: feature.name, polygons: Object.freeze(polygonsOf(feature)) }))),
    neighbours: Object.freeze([]),
    landmarks: Object.freeze(PORT_HARCOURT_LANDMARKS.map(({ id, name, lon, lat }) => Object.freeze({ id, name, lon, lat }))),
  })
}
