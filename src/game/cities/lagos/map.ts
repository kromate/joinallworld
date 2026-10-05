import { LAGOS_LGAS } from './rules.ts'
import { ORIGINS } from '../../../map3d/geo/frame.ts'
import type { CityMapPack } from '../../../types/content.ts'
import type { LagosLocalGovernmentId } from './rules.ts'

/**
 * The lightweight half of the Lagos map contract. The geometry chunk named here is loaded by the
 * map host only when Lagos is shown. The origin is the pinned frame projection of 3.40 E, 6.45 N.
 */
export const LAGOS_MAP: CityMapPack<'lagos', LagosLocalGovernmentId> = Object.freeze({
  cityId: 'lagos',
  origin: ORIGINS.lagos,
  projection: 'nigeria-equirectangular-v1',
  unitsPerKm: 10,
  localUnitIds: Object.freeze(LAGOS_LGAS.map((unit) => unit.id)),
  stateFeatureId: 'lagos-state',
  loadScene: async () => (await import('../../../map3d/cities/lagos.ts')).default,
  loadGeometry: async () => {
    const [{ lagosShapes }, { LAGOS }, { decodeTopology }] = await Promise.all([
      import('../../../map3d/geo/lagos-shapes.ts'),
      import('../../../map3d/geo/data/lagos.ts'),
      import('../../../map3d/geo/topo.ts'),
    ])
    const shapes = lagosShapes()
    const topology = decodeTopology(LAGOS)
    return Object.freeze({
      localUnits: shapes.lgas,
      playArea: shapes.state,
      state: shapes.state,
      water: shapes.lagoon,
      gridDegrees: topology.grid,
      sharedArcCount: topology.users.filter((users) => users.length > 1).length,
      source: 'geoBoundaries gbOpen Nigeria, release 9469f09, GRID3 2022',
      licence: 'CC BY 4.0',
    })
  },
})
