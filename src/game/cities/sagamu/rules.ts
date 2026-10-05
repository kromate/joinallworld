import type { CityModuleRules, LgaDefinition } from '../../../types/content.ts'
import { OGUN_LINKS } from '../ogun/links.ts'
import { OGUN_RULES_BASE } from '../ogun/rules.ts'

export type SagamuLocalGovernmentId = 'sagamu' | 'ikenne' | 'remo-north'
export type SagamuDistrictId = 'sagamu-centre' | 'ilisan' | 'ikenne-town'
export type SagamuHubId = 'sagamu-interchange'
type Seed = Omit<LgaDefinition, 'id' | 'districts' | 'beta'> & { id: SagamuLocalGovernmentId; districts?: SagamuDistrictId[] }

export const SAGAMU_LGAS = Object.freeze(([
  { id: 'sagamu', name: 'Sagamu', zone: 'mainland', land: 90000, districts: ['sagamu-centre'] },
  { id: 'ikenne', name: 'Ikenne', zone: 'mainland', land: 70000, districts: ['ilisan', 'ikenne-town'] },
  { id: 'remo-north', name: 'Remo North', zone: 'mainland', land: 55000 },
] satisfies Seed[]).map(unit => Object.freeze({ beta: true, districts: [], ...unit })))

export const SAGAMU_MAP_ORIGIN = Object.freeze({ x: -4801, z: 2386 })

export const SAGAMU_RULES = Object.freeze({
  ...OGUN_RULES_BASE,
  id: 'sagamu', name: 'Sagamu', units: SAGAMU_LGAS,
  hub: { road: 'Sagamu Interchange', air: 'Murtala Muhammed Airport via Lagos' },
  rentedHomeIds: ['sagamu-centre-room', 'ilisan-flat', 'ikenne-house'], defaultRentedHome: 'sagamu-centre-room',
  atlas: { lon: 3.64, lat: 6.85, teaser: 'A Remo crossroads linking markets, schools and the roads east and west.', preview: ['Sagamu interchange', 'Ikenne and Ilishan-Remo', 'Remo markets and stadium'] },
  mapOrigin: SAGAMU_MAP_ORIGIN,
  districts: [
    { id: 'sagamu-centre', name: 'Sagamu Centre', localUnitId: 'sagamu' },
    { id: 'ilisan', name: 'Ilishan-Remo', localUnitId: 'ikenne' },
    { id: 'ikenne-town', name: 'Ikenne', localUnitId: 'ikenne' },
  ],
  hubs: [{ id: 'sagamu-interchange', name: 'Sagamu Interchange', mode: 'road', venueId: 'sagamu-interchange' }],
  links: [OGUN_LINKS.abeokutaSagamu, OGUN_LINKS.otaSagamu, OGUN_LINKS.sagamuIjebu],
} satisfies CityModuleRules<'sagamu', 'ogun', SagamuLocalGovernmentId, SagamuDistrictId, SagamuHubId>)
