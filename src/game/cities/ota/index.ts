import type { CityModule } from '../../../types/content.ts'
import { OTA_RULES } from './rules.ts'
import type { OtaDistrictId, OtaHubId, OtaLocalGovernmentId } from './rules.ts'

export const otaCity = Object.freeze({
  id: 'ota', rules: OTA_RULES,
  loadContent: async () => (await import('./content.ts')).OTA_CONTENT,
  loadMap: async () => (await import('./map.ts')).OTA_MAP,
} satisfies CityModule<'ota', 'ogun', OtaLocalGovernmentId, OtaDistrictId, OtaHubId>)

export { OTA_LGAS, OTA_MAP_ORIGIN, OTA_RULES } from './rules.ts'
