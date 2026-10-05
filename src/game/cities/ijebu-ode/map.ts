import type { CityMapPack } from '../../../types/content.ts'
import { OGUN_CITY_LGA_IDS } from '../../../map3d/geo/data/ogun.ts'
import { IJEBU_ODE_LANDMARKS } from '../ogun/landmarks.ts'
import { ogunCityGeometry, ogunStateOverview } from '../ogun/mapOverview.ts'
import { IJEBU_ODE_MAP_ORIGIN } from './rules.ts'
import type { IjebuOdeLocalGovernmentId } from './rules.ts'

export const IJEBU_ODE_MAP: CityMapPack<'ijebu-ode', IjebuOdeLocalGovernmentId> = Object.freeze({
  cityId: 'ijebu-ode', origin: IJEBU_ODE_MAP_ORIGIN, projection: 'nigeria-equirectangular-v1', unitsPerKm: 10,
  localUnitIds: OGUN_CITY_LGA_IDS['ijebu-ode'], stateFeatureId: 'ogun-state',
  loadScene: async () => {
    const [{ ijebuOdeCity }, { createModulePack }] = await Promise.all([import('./index.ts'), import('../../../map3d/cities/module.ts')])
    return createModulePack(ijebuOdeCity, IJEBU_ODE_LANDMARKS)
  },
  loadGeometry: async () => ogunCityGeometry(OGUN_CITY_LGA_IDS['ijebu-ode']),
  loadStateOverview: async () => ogunStateOverview(),
})
