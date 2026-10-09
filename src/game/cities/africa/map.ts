import { toLocal } from '../../../geo/frame.ts'
import type { CityMapPack, CityModule, LonLatPolygon } from '../../../types/content.ts'
import type { CityPack, Point2 } from '../../../map3d/types.ts'
import { validateDestinationFacts } from './types.ts'
import type { DestinationFacts } from './types.ts'

export interface DestinationGeometry {
  readonly land: readonly LonLatPolygon[]
  readonly buildings: readonly {
    readonly id: string
    readonly ring: readonly Point2[]
    readonly heightM: number
    readonly heightKind: 'source' | 'estimated'
  }[]
  readonly roads: readonly { readonly id: string; readonly name: string; readonly major: boolean; readonly points: readonly Point2[] }[]
}

export function createDestinationMap(facts: DestinationFacts, geometry: DestinationGeometry, loadModule: () => Promise<CityModule>): CityMapPack<string, 'centre'> {
  const valid = validateDestinationFacts(facts)
  if (!geometry.land.length || geometry.buildings.length > 350 || geometry.roads.length > 160) throw new RangeError('Starter map geometry exceeds its bounds')
  const rings = [...geometry.land.flat(), ...geometry.buildings.map(building => building.ring), ...geometry.roads.map(road => road.points)]
  for (const ring of rings) {
    if (ring.length > 6000 || !ring.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) throw new TypeError('Starter map needs finite WGS84 points')
  }
  if (!geometry.buildings.every(building => Number.isFinite(building.heightM) && building.heightM >= 1 && building.heightM <= 100 && building.ring.length >= 4)) throw new TypeError('Starter building height or ring is invalid')
  return Object.freeze<CityMapPack<string, 'centre'>>({
    cityId: valid.id, origin: valid.mapOrigin, projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
    localUnitIds: ['centre'], stateFeatureId: valid.state.idunique,
    loadGeometry: async () => ({
      localUnits: { centre: geometry.land }, playArea: geometry.land, state: geometry.land, water: [],
      gridDegrees: .000001, sharedArcCount: 0, source: `${valid.sourceLabel}. ${valid.coverageNote}`, licence: valid.licence,
    }),
    loadScene: async (): Promise<CityPack> => {
      const [{ createModulePack }, module] = await Promise.all([import('../../../map3d/cities/module.ts'), loadModule()])
      const pack = await createModulePack(module, { spread: true, character: { extent: 'city' } })
      const origin = valid.mapOrigin
      const buildings = geometry.buildings.map(building => {
        const points = building.ring.map(([lon, lat]) => toLocal(origin, lon, lat))
        const xs = points.map(point => point[0]), zs = points.map(point => point[1])
        const west = Math.min(...xs), east = Math.max(...xs), north = Math.min(...zs), south = Math.max(...zs)
        return { x: (west + east) / 2, z: (north + south) / 2, w: east - west, d: south - north, h: building.heightM / 100 }
      })
      return {
        ...pack,
        roads: geometry.roads.map(road => ({ id: road.id, name: road.name, major: road.major, points: road.points.map(([lon, lat]) => toLocal(origin, lon, lat)) })),
        // Source buildings replace procedural decorative housing in the sampled area.
        // Their retained rings support later extrusion; this first pass uses box silhouettes.
        fabric: [],
        decorate(batch) {
          for (const building of buildings) if (building.w > 0 && building.d > 0) {
            batch.box(building.x, building.h / 2 + .04, building.z, building.w, building.h, building.d, '#c7b79a')
            batch.box(building.x, building.h + .045, building.z, building.w, .01, building.d, '#8e7865')
          }
        },
      }
    },
  })
}
