import { NIGERIA } from '../country.ts'
import { CAREER_IDS } from '../../content/career-ids.ts'
import type { CityModuleRules } from '../../../types/content.ts'
import { CITY_LINKS, LAGOS_IBADAN_RAIL } from '../links.ts'
import { OGUN_LINKS } from '../ogun/links.ts'
import { ORIGINS } from '../../../map3d/geo/frame.ts'
import { LAGOS_LGAS } from './localUnits.ts'
import type { LagosDistrictId, LagosLocalGovernmentId } from './localUnits.ts'

export { LAGOS_LGAS } from './localUnits.ts'
export type { LagosDistrictId, LagosLocalGovernmentId } from './localUnits.ts'
export type LagosHubId = 'ojota-road' | 'ikeja-airport' | 'ebute-metta-rail'

/** The frame projection of the Lagos Island anchor, 3.40 E and 6.45 N: the shared frame's own origin for Lagos (src/map3d/geo/frame.ts). */
export const LAGOS_MAP_ORIGIN = ORIGINS.lagos

export const LAGOS_RULES = Object.freeze({
  id: 'lagos',
  name: 'Lagos',
  status: 'open',
  unit: 'local government',
  units: LAGOS_LGAS,
  hub: { road: 'Ojota Motor Park', air: 'the airport at Ikeja', rail: 'Mobolaji Johnson Station at Ebute Metta' },
  state: { id: 'lagos', name: 'Lagos State', unit: 'local government' },
  country: NIGERIA,
  timezone: 'Africa/Lagos',
  defaultName: 'New Lagosian',
  rentedHomeIds: ['mushin', 'yaba', 'lekki', 'ikoyi', 'banana'],
  defaultRentedHome: 'yaba',
  campus: 'unilag',
  careerIds: CAREER_IDS,
  atlas: {
    lon: 3.38,
    lat: 6.52,
    stand: 'low',
    teaser: 'The city that never slows down: mainland hustle, island nights and the Atlantic at your feet.',
  },
  mapOrigin: LAGOS_MAP_ORIGIN,
  districts: [
    { id: 'mushin', name: 'Mushin', localUnitId: 'mushin' },
    { id: 'yaba', name: 'Yaba', localUnitId: 'lagos-mainland' },
    { id: 'lekki', name: 'Lekki Phase 1', localUnitId: 'eti-osa' },
    { id: 'ikoyi', name: 'Ikoyi', localUnitId: 'eti-osa' },
    { id: 'banana', name: 'Banana Island', localUnitId: 'eti-osa' },
  ],
  hubs: [
    { id: 'ojota-road', name: 'Ojota Motor Park', mode: 'road' },
    { id: 'ikeja-airport', name: 'Murtala Muhammed International Airport', mode: 'air', venueId: 'airport' },
    { id: 'ebute-metta-rail', name: 'Mobolaji Johnson Station', mode: 'rail' },
  ],
  links: [...CITY_LINKS.filter((link) => link.a === 'lagos' || link.b === 'lagos'), LAGOS_IBADAN_RAIL, OGUN_LINKS.lagosOta, OGUN_LINKS.lagosAbeokuta, OGUN_LINKS.lagosAbeokutaRail],
} satisfies CityModuleRules<'lagos', 'lagos', LagosLocalGovernmentId, LagosDistrictId, LagosHubId>)
