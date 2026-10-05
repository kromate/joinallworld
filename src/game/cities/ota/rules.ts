import type { CityModuleRules, LgaDefinition } from '../../../types/content.ts'
import { OGUN_LINKS } from '../ogun/links.ts'
import { OGUN_RULES_BASE } from '../ogun/rules.ts'

export type OtaLocalGovernmentId = 'ado-odo-ota'
export type OtaDistrictId = 'ota-centre' | 'sango' | 'ilupeju-ota'
export type OtaHubId = 'sango-road'

export const OTA_LGAS: readonly (Omit<LgaDefinition, 'id' | 'districts'> & {
  id: OtaLocalGovernmentId; districts: OtaDistrictId[]
})[] = Object.freeze([
  { id: 'ado-odo-ota', name: 'Ado Odo/Ota', zone: 'mainland', land: 110000, districts: ['ota-centre', 'sango', 'ilupeju-ota'], beta: true },
])

export const OTA_MAP_ORIGIN = Object.freeze({ x: -5396, z: 2644 })

export const OTA_RULES = Object.freeze({
  ...OGUN_RULES_BASE,
  id: 'ota', name: 'Ota', units: OTA_LGAS,
  hub: { road: 'Sango-Ota Motor Park', air: 'Murtala Muhammed Airport via Lagos' },
  rentedHomeIds: ['ota-centre-room', 'ota-sango-flat', 'ota-ilupeju-house'], defaultRentedHome: 'ota-sango-flat',
  atlas: {
    lon: 3.20, lat: 6.68,
    teaser: 'A border city of universities, industry and daily movement into Lagos.',
    preview: ['Ota and Sango markets', 'Covenant and Bells universities', 'The Lagos–Abeokuta corridor'],
  },
  mapOrigin: OTA_MAP_ORIGIN,
  districts: [
    { id: 'ota-centre', name: 'Ota Centre', localUnitId: 'ado-odo-ota' },
    { id: 'sango', name: 'Sango-Ota', localUnitId: 'ado-odo-ota' },
    { id: 'ilupeju-ota', name: 'Ilupeju-Ota', localUnitId: 'ado-odo-ota' },
  ],
  hubs: [{ id: 'sango-road', name: 'Sango-Ota Motor Park', mode: 'road', venueId: 'sango-park' }],
  links: [OGUN_LINKS.lagosOta, OGUN_LINKS.otaAbeokuta, OGUN_LINKS.otaSagamu],
} satisfies CityModuleRules<'ota', 'ogun', OtaLocalGovernmentId, OtaDistrictId, OtaHubId>)
