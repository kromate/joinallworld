import type { CityMapPack } from '../../../types/content.ts'
import { toLocal } from '../../../geo/frame.ts'
import { PORT_HARCOURT_LGA_IDS, RIVERS_BOAT_ROUTE } from '../../../map3d/geo/data/rivers.ts'
import { PORT_HARCOURT_LANDMARKS } from './landmarks.ts'
import { riversCityGeometry, riversMangrovePolygons, riversStateOverview } from './geometry.ts'
import { PORT_HARCOURT_MAP_ORIGIN } from './rules.ts'
import type { PortHarcourtLocalGovernmentId } from './rules.ts'

export const PORT_HARCOURT_MAP: CityMapPack<'port-harcourt', PortHarcourtLocalGovernmentId> = Object.freeze({
  cityId: 'port-harcourt', origin: PORT_HARCOURT_MAP_ORIGIN,
  projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
  localUnitIds: PORT_HARCOURT_LGA_IDS, stateFeatureId: 'rivers-state',
  loadScene: async () => {
    const [{ portHarcourtCity }, { createModulePack }, { mangroveDecoration }] = await Promise.all([
      import('./index.ts'), import('../../../map3d/cities/module.ts'), import('./scenery.ts'),
    ])
    const pack = await createModulePack(portHarcourtCity, PORT_HARCOURT_LANDMARKS)
    return {
      ...pack,
      localRoutes: [{
        a: 'bonny-jetty', b: 'okrika-jetty', mode: 'boat' as const,
        points: RIVERS_BOAT_ROUTE.map(([lon, lat]) => {
          const [x, z] = toLocal(PORT_HARCOURT_MAP_ORIGIN, lon, lat)
          return { x, y: 0, z }
        }),
      }],
      decorate: mangroveDecoration(riversMangrovePolygons(), PORT_HARCOURT_MAP_ORIGIN),
    }
  },
  loadGeometry: async () => riversCityGeometry(),
  loadStateOverview: async () => riversStateOverview(),
})
