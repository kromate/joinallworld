import { LAGOS_RULES } from './rules.ts'
import type { CityModule } from '../../../types/content.ts'
import type { LagosDistrictId, LagosHubId, LagosLocalGovernmentId } from './rules.ts'

export const lagosCity = Object.freeze({
  id: 'lagos',
  rules: LAGOS_RULES,
  loadContent: async () => (await import('./content.ts')).LAGOS_CONTENT,
  loadMap: async () => (await import('./map.ts')).LAGOS_MAP,
} satisfies CityModule<'lagos', 'lagos', LagosLocalGovernmentId, LagosDistrictId, LagosHubId>)

export { LAGOS_MAP_ORIGIN, LAGOS_RULES } from './rules.ts'
export { LAGOS_LGAS } from './localUnits.ts'
