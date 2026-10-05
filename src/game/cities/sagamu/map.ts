import type { CityMapPack } from '../../../types/content.ts'
import { OGUN_CITY_LGA_IDS } from '../../../map3d/geo/data/ogun.ts'
import { SAGAMU_LANDMARKS } from '../ogun/landmarks.ts'
import { ogunCityGeometry, ogunStateOverview } from '../ogun/mapOverview.ts'
import { SAGAMU_MAP_ORIGIN } from './rules.ts'
import type { SagamuLocalGovernmentId } from './rules.ts'

export const SAGAMU_MAP: CityMapPack<'sagamu', SagamuLocalGovernmentId> = Object.freeze({
  cityId: 'sagamu', origin: SAGAMU_MAP_ORIGIN, projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
  localUnitIds: OGUN_CITY_LGA_IDS.sagamu, stateFeatureId: 'ogun-state',
  loadScene: async () => {
    const [{ sagamuCity }, { createModulePack }, { ogunScene }] = await Promise.all([import('./index.ts'), import('../../../map3d/cities/module.ts'), import('../ogun/scene.ts')])
    return createModulePack(sagamuCity, ogunScene('sagamu', SAGAMU_LANDMARKS))
  },
  loadGeometry: async () => ogunCityGeometry(OGUN_CITY_LGA_IDS.sagamu),
  loadStateOverview: async () => ogunStateOverview(),
})
