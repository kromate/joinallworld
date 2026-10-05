import type { CityMapPack } from '../../../types/content.ts'
import { OGUN_CITY_LGA_IDS } from '../../../map3d/geo/data/ogun.ts'
import { OTA_LANDMARKS } from '../ogun/landmarks.ts'
import { ogunCityGeometry, ogunStateOverview } from '../ogun/mapOverview.ts'
import { OTA_MAP_ORIGIN } from './rules.ts'
import type { OtaLocalGovernmentId } from './rules.ts'

export const OTA_MAP: CityMapPack<'ota', OtaLocalGovernmentId> = Object.freeze({
  cityId: 'ota', origin: OTA_MAP_ORIGIN, projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
  localUnitIds: OGUN_CITY_LGA_IDS.ota, stateFeatureId: 'ogun-state',
  loadScene: async () => {
    const [{ otaCity }, { createModulePack }] = await Promise.all([import('./index.ts'), import('../../../map3d/cities/module.ts')])
    return createModulePack(otaCity, OTA_LANDMARKS)
  },
  loadGeometry: async () => ogunCityGeometry(OGUN_CITY_LGA_IDS.ota),
  loadStateOverview: async () => ogunStateOverview(),
})
