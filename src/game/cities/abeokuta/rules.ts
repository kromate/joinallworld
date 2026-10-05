import type { CityModuleRules, LgaDefinition } from '../../../types/content.ts'
import { OGUN_LINKS } from '../ogun/links.ts'
import { OGUN_RULES_BASE } from '../ogun/rules.ts'
export type AbeokutaLocalGovernmentId = 'abeokuta-north' | 'abeokuta-south' | 'odeda' | 'obafemi-owode'
export type AbeokutaDistrictId = 'ake' | 'kuto' | 'odeda-campus' | 'oke-mosan'
export type AbeokutaHubId = 'kuto-road' | 'wole-soyinka-rail'
type Seed = Omit<LgaDefinition, 'id' | 'districts' | 'beta'> & { id: AbeokutaLocalGovernmentId; districts?: AbeokutaDistrictId[] }
export const ABEOKUTA_LGAS = Object.freeze(([
  { id: 'abeokuta-north', name: 'Abeokuta North', zone: 'mainland', land: 95000 },
  { id: 'abeokuta-south', name: 'Abeokuta South', zone: 'mainland', land: 135000, districts: ['ake', 'kuto'] },
  { id: 'odeda', name: 'Odeda', zone: 'mainland', land: 65000, districts: ['odeda-campus'] },
  { id: 'obafemi-owode', name: 'Obafemi/Owode', zone: 'mainland', land: 70000, districts: ['oke-mosan'] },
] satisfies Seed[]).map(unit => Object.freeze({ beta: true, districts: [], ...unit })))
export const ABEOKUTA_MAP_ORIGIN = Object.freeze({ x: -5019, z: 2039 })
export const ABEOKUTA_RULES = Object.freeze({
  ...OGUN_RULES_BASE,
  id: 'abeokuta', name: 'Abeokuta', units: ABEOKUTA_LGAS,
  hub: { road: 'Kuto Motor Park', air: 'Murtala Muhammed Airport via Lagos', rail: 'Professor Wole Soyinka Station' },
  rentedHomeIds: ['abeokuta-ake-room', 'abeokuta-kuto-flat', 'abeokuta-odeda-flat', 'abeokuta-oke-mosan-house'], defaultRentedHome: 'abeokuta-kuto-flat',
  atlas: { lon: 3.35, lat: 7.15, teaser: 'Granite hills, Egba history, adire craft and the Ogun River.', preview: ['Olumo Rock and Itoku', 'Ake palace and Centenary Hall', 'Kuto and the presidential library'] },
  mapOrigin: ABEOKUTA_MAP_ORIGIN,
  districts: [{ id: 'ake', name: 'Ake', localUnitId: 'abeokuta-south' },{ id: 'kuto', name: 'Kuto', localUnitId: 'abeokuta-south' },{ id: 'odeda-campus', name: 'Odeda campus area', localUnitId: 'odeda' },{ id: 'oke-mosan', name: 'Oke Mosan', localUnitId: 'obafemi-owode' }],
  hubs: [{ id: 'kuto-road', name: 'Kuto Motor Park', mode: 'road', venueId: 'kuto-park' },{ id: 'wole-soyinka-rail', name: 'Professor Wole Soyinka Station', mode: 'rail', venueId: 'wole-soyinka-station' }],
  links: [OGUN_LINKS.lagosAbeokuta, OGUN_LINKS.lagosAbeokutaRail, OGUN_LINKS.otaAbeokuta, OGUN_LINKS.abeokutaIbadan, OGUN_LINKS.abeokutaIbadanRail, OGUN_LINKS.abeokutaSagamu],
} satisfies CityModuleRules<'abeokuta','ogun',AbeokutaLocalGovernmentId,AbeokutaDistrictId,AbeokutaHubId>)
