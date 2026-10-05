import type { CityModuleRules, LgaDefinition } from '../../../types/content.ts'
import { OGUN_LINKS } from '../ogun/links.ts'
import { OGUN_RULES_BASE } from '../ogun/rules.ts'

export type IjebuOdeLocalGovernmentId = 'ijebu-ode' | 'ijebu-north-east' | 'odogbolu'
export type IjebuOdeDistrictId = 'ijebu-centre' | 'ijagun' | 'odogbolu'
export type IjebuOdeHubId = 'ijebu-road'
type Seed = Omit<LgaDefinition, 'id' | 'districts' | 'beta'> & { id: IjebuOdeLocalGovernmentId; districts?: IjebuOdeDistrictId[] }

export const IJEBU_ODE_LGAS = Object.freeze(([
  { id: 'ijebu-ode', name: 'Ijebu Ode', zone: 'mainland', land: 105000, districts: ['ijebu-centre'] },
  { id: 'ijebu-north-east', name: 'Ijebu North East', zone: 'mainland', land: 65000 },
  { id: 'odogbolu', name: 'Odogbolu', zone: 'mainland', land: 60000, districts: ['ijagun', 'odogbolu'] },
] satisfies Seed[]).map(unit => Object.freeze({ beta: true, districts: [], ...unit })))

export const IJEBU_ODE_MAP_ORIGIN = Object.freeze({ x: -4523, z: 2457 })

export const IJEBU_ODE_RULES = Object.freeze({
  ...OGUN_RULES_BASE,
  id: 'ijebu-ode', name: 'Ijebu-Ode', units: IJEBU_ODE_LGAS,
  hub: { road: 'Ijebu-Ode Motor Park', air: 'Murtala Muhammed Airport via Lagos' },
  rentedHomeIds: ['ijebu-centre-room', 'ijagun-flat', 'odogbolu-house'], defaultRentedHome: 'ijebu-centre-room',
  atlas: { lon: 3.92, lat: 6.82, teaser: 'Ijebu heritage, markets and the yearly colour of Ojude Oba.', preview: ['Ijebu heritage gathering', 'Ojude Oba and regberegbe', 'Ijagun and TASUED'] },
  mapOrigin: IJEBU_ODE_MAP_ORIGIN,
  districts: [
    { id: 'ijebu-centre', name: 'Ijebu-Ode Centre', localUnitId: 'ijebu-ode' },
    { id: 'ijagun', name: 'Ijagun', localUnitId: 'odogbolu' },
    { id: 'odogbolu', name: 'Odogbolu', localUnitId: 'odogbolu' },
  ],
  hubs: [{ id: 'ijebu-road', name: 'Ijebu-Ode Motor Park', mode: 'road', venueId: 'ijebu-road-park' }],
  links: [OGUN_LINKS.sagamuIjebu],
} satisfies CityModuleRules<'ijebu-ode', 'ogun', IjebuOdeLocalGovernmentId, IjebuOdeDistrictId, IjebuOdeHubId>)
