import type { CityModuleRules, LgaDefinition } from '../../../types/content.ts'
import { CITY_LINKS } from '../links.ts'

export type LagosLocalGovernmentId =
  | 'agege' | 'ajeromi-ifelodun' | 'alimosho' | 'amuwo-odofin' | 'apapa' | 'badagry' | 'epe' | 'eti-osa' | 'ibeju-lekki'
  | 'ifako-ijaiye' | 'ikeja' | 'ikorodu' | 'kosofe' | 'lagos-island' | 'lagos-mainland' | 'mushin' | 'ojo' | 'oshodi-isolo'
  | 'somolu' | 'surulere'

export type LagosDistrictId = 'mushin' | 'yaba' | 'lekki' | 'ikoyi' | 'banana'
export type LagosHubId = 'ojota-road' | 'ikeja-airport' | 'ebute-metta-rail'

type LagosLgaSeed = Omit<LgaDefinition, 'id' | 'beta' | 'districts'> & {
  id: LagosLocalGovernmentId
  districts?: LagosDistrictId[]
}

export const LAGOS_LGAS: readonly (Omit<LgaDefinition, 'id' | 'districts'> & {
  id: LagosLocalGovernmentId
  districts: LagosDistrictId[]
})[] = Object.freeze(([
  { id: 'agege', name: 'Agege', zone: 'mainland', land: 120000 },
  { id: 'ajeromi-ifelodun', name: 'Ajeromi-Ifelodun', zone: 'mainland', land: 100000 },
  { id: 'alimosho', name: 'Alimosho', zone: 'mainland', land: 90000 },
  { id: 'amuwo-odofin', name: 'Amuwo-Odofin', zone: 'mainland', land: 150000 },
  { id: 'apapa', name: 'Apapa', zone: 'mainland', land: 280000 },
  { id: 'badagry', name: 'Badagry', zone: 'mainland', land: 60000 },
  { id: 'epe', name: 'Epe', zone: 'east', land: 60000 },
  { id: 'eti-osa', name: 'Eti-Osa', zone: 'island', land: 750000, districts: ['lekki', 'ikoyi', 'banana'] },
  { id: 'ibeju-lekki', name: 'Ibeju-Lekki', zone: 'east', land: 90000 },
  { id: 'ifako-ijaiye', name: 'Ifako-Ijaiye', zone: 'mainland', land: 110000 },
  { id: 'ikeja', name: 'Ikeja', zone: 'mainland', land: 500000 },
  { id: 'ikorodu', name: 'Ikorodu', zone: 'mainland', land: 70000 },
  { id: 'kosofe', name: 'Kosofe', zone: 'mainland', land: 180000 },
  { id: 'lagos-island', name: 'Lagos Island', zone: 'island', land: 420000 },
  { id: 'lagos-mainland', name: 'Lagos Mainland', zone: 'mainland', land: 240000, districts: ['yaba'] },
  { id: 'mushin', name: 'Mushin', zone: 'mainland', land: 130000, districts: ['mushin'] },
  { id: 'ojo', name: 'Ojo', zone: 'mainland', land: 80000 },
  { id: 'oshodi-isolo', name: 'Oshodi-Isolo', zone: 'mainland', land: 160000 },
  { id: 'somolu', name: 'Somolu', zone: 'mainland', land: 170000 },
  { id: 'surulere', name: 'Surulere', zone: 'mainland', land: 260000 },
] satisfies LagosLgaSeed[]).map((lga) => Object.freeze({ beta: true, districts: [], ...lga })))

/** Pinned frame projection of the Lagos Island anchor, 3.40 E and 6.45 N. */
export const LAGOS_MAP_ORIGIN = Object.freeze({ x: -5052, z: 2835 })

export const LAGOS_RULES = Object.freeze({
  id: 'lagos',
  name: 'Lagos',
  status: 'open',
  unit: 'local government',
  units: LAGOS_LGAS,
  hub: { road: 'Ojota Motor Park', air: 'the airport at Ikeja', rail: 'Mobolaji Johnson Station at Ebute Metta' },
  state: { id: 'lagos', name: 'Lagos State', unit: 'local government' },
  country: { id: 'ng', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  rentedHomeIds: ['mushin', 'yaba', 'lekki', 'ikoyi', 'banana'],
  defaultRentedHome: 'yaba',
  careerIds: ['community-helper', 'tech', 'banking', 'music', 'trading', 'nursing', 'hair', 'chef', 'dj', 'fitness', 'creator', 'teaching', 'event', 'football', 'retail'],
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
  links: CITY_LINKS.filter((link) => link.a === 'lagos' || link.b === 'lagos'),
} satisfies CityModuleRules<'lagos', 'lagos', LagosLocalGovernmentId, LagosDistrictId, LagosHubId>)
