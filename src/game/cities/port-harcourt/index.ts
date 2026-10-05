import type { CityModule } from '../../../types/content.ts'
import { PORT_HARCOURT_RULES } from './rules.ts'
import type { PortHarcourtDistrictId, PortHarcourtHubId, PortHarcourtLocalGovernmentId } from './rules.ts'

export const portHarcourtCity = Object.freeze({
  id:'port-harcourt',rules:PORT_HARCOURT_RULES,
  loadContent:async()=>(await import('./content.ts')).PORT_HARCOURT_CONTENT,
  loadMap:async()=>(await import('./map.ts')).PORT_HARCOURT_MAP,
} satisfies CityModule<'port-harcourt','rivers',PortHarcourtLocalGovernmentId,PortHarcourtDistrictId,PortHarcourtHubId>)

export { PORT_HARCOURT_LGAS,PORT_HARCOURT_MAP_ORIGIN,PORT_HARCOURT_RULES } from './rules.ts'
