import { toLocal } from '../../../geo/frame.ts'
import { ABUJA_AREA_COUNCIL_IDS, FCT_KADUNA_RAIL, FCT_ROADS } from '../../../map3d/geo/data/fct.ts'
import type { CityMapPack, CityRouteGeometry } from '../../../types/content.ts'
import { ABUJA_LANDMARKS } from './landmarks.ts'
import { fctCityGeometry, fctStateOverview } from './geometry.ts'
import { ABUJA_MAP_ORIGIN } from './rules.ts'
import type { AbujaAreaCouncilId } from './rules.ts'

/** Closed Kaduna preview follows source track nodes from Idu to Rigasa, with no invented station connectors. */
export const ABUJA_ROUTE_GEOMETRY: readonly CityRouteGeometry[] = Object.freeze([Object.freeze({
  a: 'abuja', b: 'kaduna', mode: 'rail' as const, points: FCT_KADUNA_RAIL,
})])

export const ABUJA_MAP: CityMapPack<'abuja', AbujaAreaCouncilId> = Object.freeze({
  cityId: 'abuja', origin: ABUJA_MAP_ORIGIN, projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
  localUnitIds: ABUJA_AREA_COUNCIL_IDS, stateFeatureId: 'fct',
  loadScene: async () => {
    const [{ abujaCity }, { createModulePack }, { abujaRailDecoration }] = await Promise.all([
      import('./index.ts'), import('../../../map3d/cities/module.ts'), import('./scenery.ts'),
    ])
    const pack = await createModulePack(abujaCity, { landmarks: ABUJA_LANDMARKS, spread: true, character: { extent: 'city', notable: ['millennium-park', 'national-mosque', 'christian-centre', 'eagle-square', 'city-gate', 'jabi-lake-park', 'airport', 'idu-station'] } })
    const [x, z] = toLocal(ABUJA_MAP_ORIGIN, 7.3410781, 9.1526752)
    return {
      ...pack,
      roads: FCT_ROADS.map(road => ({ id: road.id, name: road.name, major: true, points: road.points.map(([lon, lat]) => toLocal(ABUJA_MAP_ORIGIN, lon, lat)) })),
      estates: { ...pack.estates, bwari: { x, z, cols: 8, max: 64 } },
      decorate: abujaRailDecoration(ABUJA_MAP_ORIGIN, fctCityGeometry().state),
    }
  },
  loadGeometry: async () => fctCityGeometry(), loadStateOverview: async () => fctStateOverview(),
})
