import type { CityModule } from '../../../types/content.ts'
import { IJEBU_ODE_RULES } from './rules.ts'
import type { IjebuOdeDistrictId, IjebuOdeHubId, IjebuOdeLocalGovernmentId } from './rules.ts'

export const ijebuOdeCity = Object.freeze({
  id: 'ijebu-ode', rules: IJEBU_ODE_RULES,
  loadContent: async () => (await import('./content.ts')).IJEBU_ODE_CONTENT,
  loadMap: async () => (await import('#city-map/ijebu-ode')).IJEBU_ODE_MAP,
} satisfies CityModule<'ijebu-ode', 'ogun', IjebuOdeLocalGovernmentId, IjebuOdeDistrictId, IjebuOdeHubId>)

export { IJEBU_ODE_LGAS, IJEBU_ODE_MAP_ORIGIN, IJEBU_ODE_RULES } from './rules.ts'
