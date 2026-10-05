import type { CityModule } from '../../../types/content.ts'
import { ABEOKUTA_RULES } from './rules.ts'
import type { AbeokutaDistrictId, AbeokutaHubId, AbeokutaLocalGovernmentId } from './rules.ts'

export const abeokutaCity = Object.freeze({
  id: 'abeokuta', rules: ABEOKUTA_RULES,
  loadContent: async () => (await import('./content.ts')).ABEOKUTA_CONTENT,
  loadMap: async () => (await import('./map.ts')).ABEOKUTA_MAP,
  loadRoutes: async () => (await import('./rail.ts')).ABEOKUTA_ROUTE_GEOMETRY,
} satisfies CityModule<'abeokuta', 'ogun', AbeokutaLocalGovernmentId, AbeokutaDistrictId, AbeokutaHubId>)

export { ABEOKUTA_LGAS, ABEOKUTA_MAP_ORIGIN, ABEOKUTA_RULES } from './rules.ts'
