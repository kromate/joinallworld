import type { CityMapPack } from '../../../types/content.ts'
import type { ModuleCharacter } from '../../../map3d/cities/module.ts'
import { toLocal } from '../../../geo/frame.ts'
import { PORT_HARCOURT_LGA_IDS, RIVERS_BOAT_ROUTE } from '../../../map3d/geo/data/rivers.ts'
import { PORT_HARCOURT_LANDMARKS } from './landmarks.ts'
import { riversCityGeometry, riversMangrovePolygons, riversStateOverview } from './geometry.ts'
import { PORT_HARCOURT_MAP_ORIGIN } from './rules.ts'
import type { PortHarcourtLocalGovernmentId } from './rules.ts'

/** What the map of Port Harcourt adds to its roads and water: its expressways drawn strongest, the places whose names are kept longest, and the name of its whole-extent view. */
const PORT_HARCOURT_CHARACTER: ModuleCharacter = {
  trunkRoads: ['East - West Road', 'Port Harcourt - Aba Expressway', 'Enugu - Port Harcourt Expressway', 'Ikwerre Road'],
  notable: ['pleasure-park', 'isaac-boro-park', 'mile-one-market', 'uniport', 'airport', 'bonny-jetty', 'okrika-jetty', 'refinery', 'government-house'],
  extent: 'city',
}

export const PORT_HARCOURT_MAP: CityMapPack<'port-harcourt', PortHarcourtLocalGovernmentId> = Object.freeze({
  cityId: 'port-harcourt', origin: PORT_HARCOURT_MAP_ORIGIN,
  projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
  localUnitIds: PORT_HARCOURT_LGA_IDS, stateFeatureId: 'rivers-state',
  loadScene: async () => {
    const [{ portHarcourtCity }, { createModulePack }, { mangroveDecoration }, { PORT_HARCOURT_ROADS }] = await Promise.all([
      import('./index.ts'), import('../../../map3d/cities/module.ts'), import('./scenery.ts'), import('./roads.ts'),
    ])
    const pack = await createModulePack(portHarcourtCity, { landmarks: PORT_HARCOURT_LANDMARKS, roads: PORT_HARCOURT_ROADS, character: PORT_HARCOURT_CHARACTER, spread: true })
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
