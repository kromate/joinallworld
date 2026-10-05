import { pointInPart } from '../../../map3d/lga.ts'
import { toLocal } from '../../../geo/frame.ts'
import { KANO_CITY_LGA_IDS, KANO_ROADS } from '../../../map3d/geo/data/kano.ts'
import { KANO_HISTORIC_WALL } from '../../../map3d/geo/data/kano-wall.ts'
import type { CityPack } from '../../../map3d/types.ts'
import type { CityMapPack } from '../../../types/content.ts'
import { KANO_LANDMARKS } from './landmarks.ts'
import { kanoCityGeometry, kanoStateOverview } from './geometry.ts'
import { KANO_MAP_ORIGIN } from './rules.ts'
import type { KanoLocalGovernmentId } from './rules.ts'

export const KANO_MAP: CityMapPack<'kano', KanoLocalGovernmentId> = Object.freeze({
  cityId: 'kano', origin: KANO_MAP_ORIGIN, projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
  localUnitIds: KANO_CITY_LGA_IDS, stateFeatureId: 'kano-state',
  loadScene: async () => {
    const [{ kanoCity }, { createModulePack }, { kanoDecoration }] = await Promise.all([
      import('./index.ts'), import('../../../map3d/cities/module.ts'), import('./scenery.ts'),
    ])
    const playArea = kanoCityGeometry().playArea.map(polygon => polygon.map(ring => ring.map(([lon, lat]) => toLocal(KANO_MAP_ORIGIN, lon, lat))))
    const markers = KANO_LANDMARKS.filter(marker => {
      const [x, z] = toLocal(KANO_MAP_ORIGIN, marker.lon, marker.lat)
      return playArea.some(polygon => pointInPart(x, z, polygon))
    })
    const pack = await createModulePack(kanoCity, { landmarks: markers, spread: true, character: { extent: 'city', notable: ['palace', 'central-mosque', 'kurmi-market', 'dye-pits', 'dala-hill', 'kofar-mata', 'kwari-market', 'airport', 'railway-station'] } })
    const wall = KANO_HISTORIC_WALL.map(([lon, lat]) => toLocal(KANO_MAP_ORIGIN, lon, lat))
    const heritageLines: NonNullable<CityPack['heritageLines']> = [{
      id: 'kano-historic-wall', name: 'Published historic wall outline · approximate', kind: 'historic-wall-alignment', points: wall,
    }]
    const wallLabel = {
      name: 'Historic wall outline (approx.)', size: 2.2,
      x: (Math.min(...wall.map(point => point[0])) + Math.max(...wall.map(point => point[0]))) / 2,
      z: (Math.min(...wall.map(point => point[1])) + Math.max(...wall.map(point => point[1]))) / 2,
    }
    // Gama locality node 2974797951 is inside the original Nassarawa ADM2 polygon and mapped dry land.
    const [x, z] = toLocal(KANO_MAP_ORIGIN, 8.55362, 12.0327)
    return {
      ...pack,
      roads: KANO_ROADS.map(road => ({ id: road.id, name: road.name, major: true,
        ...(road.bridge ? { bridge: 0.25 } : {}),
        points: road.points.map(([lon, lat]) => toLocal(KANO_MAP_ORIGIN, lon, lat)),
      })),
      heritageLines, districts: [...pack.districts, wallLabel],
      estates: { ...pack.estates, nassarawa: { x, z, cols: 8, max: 64 } },
      decorate: kanoDecoration(KANO_MAP_ORIGIN),
    }
  },
  loadGeometry: async () => kanoCityGeometry(), loadStateOverview: async () => kanoStateOverview(),
})
