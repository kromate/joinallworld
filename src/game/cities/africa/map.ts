import { toLocal } from '../../../geo/frame.ts'
import type { CityMapPack, CityModule, LonLatPolygon } from '../../../types/content.ts'
import type { CityPack, Point2 } from '../../../map3d/types.ts'
import type { RoadRows } from '../../../map3d/cities/module.ts'
import { validateDestinationFacts } from './types.ts'
import type { DestinationFacts } from './types.ts'

export interface DestinationGeometry {
  readonly land: readonly LonLatPolygon[]
  /** The play area where it is more than the land, because water lies inside it. */
  readonly playArea?: readonly LonLatPolygon[]
  readonly buildings: readonly {
    readonly id: string
    readonly ring: readonly Point2[]
    readonly heightM: number
    readonly heightKind: 'source' | 'estimated'
  }[]
  readonly roads: readonly { readonly id: string; readonly name: string; readonly major: boolean; readonly points: readonly Point2[] }[]
}

/** The wider map of a destination whose geography was gathered city-wide rather than as a central sample. */
export interface DestinationTerrain {
  /** A wider first-level outline for the overview; the play area outline is used when absent. */
  readonly state?: readonly LonLatPolygon[]
  /** Rivers, lakes and sea inside the play area, as polygons. */
  readonly water: readonly LonLatPolygon[]
  /** The same water carried on beyond the play area, to the edge of the ground that is drawn (rivers and the shore of a sea or lake do not stop at the play area). It is drawn only; the declared water stays `water`. */
  readonly reachWater?: readonly LonLatPolygon[]
  /** Main roads in the compact row format of `RoadRows`. */
  readonly roads: RoadRows
  /** Names of the strongest roads. */
  readonly trunkRoads: readonly string[]
  /** Ground labels that are not venues: neighbourhoods, and water bodies (`kind: 'water'`). */
  readonly names: readonly { readonly id: string; readonly name: string; readonly lon: number; readonly lat: number; readonly kind: 'neighbourhood' | 'water' }[]
  /** The colour of the ground round the built-up outline (the countryside, desert or savanna the city sits in), so that the play area's old square never shows. */
  readonly surround?: string
  /** Where each layer came from. */
  readonly source: string
  readonly licence: string
}

export function createDestinationMap(facts: DestinationFacts, geometry: DestinationGeometry, loadModule: () => Promise<CityModule>, terrain?: DestinationTerrain): CityMapPack<string, 'centre'> {
  const valid = validateDestinationFacts(facts)
  if (!geometry.land.length || geometry.buildings.length > 350 || geometry.roads.length > 160) throw new RangeError('Starter map geometry exceeds its bounds')
  const rings = [...geometry.land.flat(), ...(geometry.playArea?.flat() ?? []), ...(terrain?.state?.flat() ?? []), ...(terrain?.water.flat() ?? []), ...geometry.buildings.map(building => building.ring), ...geometry.roads.map(road => road.points)]
  for (const ring of rings) {
    if (ring.length > 6000 || !ring.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) throw new TypeError('Starter map needs finite WGS84 points')
  }
  if (!geometry.buildings.every(building => Number.isFinite(building.heightM) && building.heightM >= 1 && building.heightM <= 100 && building.ring.length >= 4)) throw new TypeError('Starter building height or ring is invalid')
  return Object.freeze<CityMapPack<string, 'centre'>>({
    cityId: valid.id, origin: valid.mapOrigin, projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
    localUnitIds: ['centre'], stateFeatureId: valid.state.idunique,
    loadGeometry: async () => ({
      localUnits: { centre: geometry.land }, playArea: geometry.playArea ?? geometry.land, state: terrain?.state ?? geometry.playArea ?? geometry.land, water: terrain?.water ?? [],
      gridDegrees: .000001, sharedArcCount: 0, source: `${terrain ? `${terrain.source}. ` : ''}${valid.sourceLabel}. ${valid.coverageNote}`, licence: terrain ? `${valid.licence}; ${terrain.licence}` : valid.licence,
    }),
    loadScene: async (): Promise<CityPack> => {
      const [{ createModulePack }, module] = await Promise.all([import('../../../map3d/cities/module.ts'), loadModule()])
      if (terrain) {
        // City-wide geography: the shared module renderer draws the outline, water, roads and labels, as for the Nigerian cities.
        const labels = terrain.names.map(name => ({ id: name.id, name: name.name, lon: name.lon, lat: name.lat, kind: name.kind }))
        return createModulePack(module, { spread: true, landmarks: labels, roads: terrain.roads, character: { extent: 'city', trunkRoads: terrain.trunkRoads }, ...(terrain.surround ? { surround: terrain.surround } : {}), ...(terrain.reachWater ? { reachWater: terrain.reachWater } : {}) })
      }
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
