import type { CityModule } from '../../../types/content.ts'
import { IBADAN_RULES } from './rules.ts'
import type { IbadanDistrictId, IbadanHubId, IbadanLocalGovernmentId } from './rules.ts'

export const ibadanCity = Object.freeze({
  id: 'ibadan',
  rules: IBADAN_RULES,
  loadContent: async () => (await import('./content.ts')).IBADAN_CONTENT,
  loadMap: async () => (await import('./map.ts')).IBADAN_MAP,
  loadRoutes: async () => (await import('./rail.ts')).IBADAN_ROUTE_GEOMETRY,
} satisfies CityModule<'ibadan', 'oyo', IbadanLocalGovernmentId, IbadanDistrictId, IbadanHubId>)

export { IBADAN_LGAS, IBADAN_MAP_ORIGIN, IBADAN_RULES } from './rules.ts'
