import type { CityMapGeometry, LonLatPolygon, LonLatRing } from '../../../types/content.ts'
import { decodeTopology } from '../../../map3d/geo/topo.ts'
import type { Feature, RawTopo } from '../../../map3d/geo/topo.ts'

export interface FormulaCityGeometryData {
  readonly localUnits: RawTopo
  readonly state: RawTopo
  readonly land: RawTopo
  readonly water: RawTopo
  readonly localUnitIds: readonly string[]
  readonly stateFeatureId: string
  readonly source: string
  readonly licence: string
}

function ringCoordinates(ring: Float64Array): LonLatRing {
  const points: [number, number][] = []
  for (let index = 0; index < ring.length; index += 2) points.push([ring[index]!, ring[index + 1]!])
  return points
}

const polygonsOf = (feature: Feature): readonly LonLatPolygon[] =>
  feature.rings.map((polygon) => polygon.map(ringCoordinates))

export function createFormulaCityGeometry(data: FormulaCityGeometryData): CityMapGeometry {
  const administrative = decodeTopology(data.localUnits)
  const stateTopology = decodeTopology(data.state)
  const land = decodeTopology(data.land)
  const water = decodeTopology(data.water)
  const state = stateTopology.byId.get(data.stateFeatureId)
  if (!state) throw new Error(`Formula state geometry is missing ${data.stateFeatureId}`)

  const localUnits: Record<string, readonly LonLatPolygon[]> = {}
  const playArea: LonLatPolygon[] = []
  const selectedLand = new Set<number>()
  for (const id of data.localUnitIds) {
    const sourceUnit = administrative.byId.get(id)
    const dryUnit = land.byId.get(id)
    if (!sourceUnit) throw new Error(`Formula administrative geometry is missing ${id}`)
    if (!dryUnit) throw new Error(`Formula land geometry is missing ${id}`)
    localUnits[id] = polygonsOf(dryUnit)
    playArea.push(...polygonsOf(sourceUnit))
    selectedLand.add(dryUnit.index)
  }

  return Object.freeze({
    localUnits: Object.freeze(localUnits),
    playArea: Object.freeze(playArea),
    state: Object.freeze(polygonsOf(state)),
    water: Object.freeze(water.features.flatMap((feature) => [...polygonsOf(feature)])),
    gridDegrees: land.grid,
    sharedArcCount: land.users.filter((users) => users.filter((index) => selectedLand.has(index)).length > 1).length,
    source: data.source,
    licence: data.licence,
  })
}
