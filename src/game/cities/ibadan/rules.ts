import type { CityModuleRules, LgaDefinition } from '../../../types/content.ts'

export type IbadanLocalGovernmentId =
  | 'akinyele' | 'egbeda' | 'ibadan-north' | 'ibadan-north-east' | 'ibadan-north-west'
  | 'ibadan-south-east' | 'ibadan-south-west' | 'ido' | 'lagelu' | 'oluyole' | 'ona-ara'

export type IbadanDistrictId = 'mokola' | 'bodija' | 'dugbe' | 'ring-road' | 'akobo'
export type IbadanHubId = 'iwo-road' | 'ibadan-airport' | 'moniya-rail'

type IbadanLgaSeed = Omit<LgaDefinition, 'id' | 'beta' | 'districts'> & {
  id: IbadanLocalGovernmentId
  districts?: IbadanDistrictId[]
}

export const IBADAN_LGAS: readonly (Omit<LgaDefinition, 'id' | 'districts'> & {
  id: IbadanLocalGovernmentId
  districts: IbadanDistrictId[]
})[] = Object.freeze(([
  { id: 'akinyele', name: 'Akinyele', zone: 'mainland', land: 80000 },
  { id: 'egbeda', name: 'Egbeda', zone: 'mainland', land: 90000 },
  { id: 'ibadan-north', name: 'Ibadan North', zone: 'mainland', land: 190000, districts: ['bodija', 'mokola'] },
  { id: 'ibadan-north-east', name: 'Ibadan North-East', zone: 'mainland', land: 125000 },
  { id: 'ibadan-north-west', name: 'Ibadan North-West', zone: 'mainland', land: 145000, districts: ['dugbe'] },
  { id: 'ibadan-south-east', name: 'Ibadan South-East', zone: 'mainland', land: 110000 },
  { id: 'ibadan-south-west', name: 'Ibadan South-West', zone: 'mainland', land: 155000, districts: ['ring-road'] },
  { id: 'ido', name: 'Ido', zone: 'mainland', land: 70000 },
  { id: 'lagelu', name: 'Lagelu', zone: 'mainland', land: 65000, districts: ['akobo'] },
  { id: 'oluyole', name: 'Oluyole', zone: 'mainland', land: 85000 },
  { id: 'ona-ara', name: 'Ona Ara', zone: 'mainland', land: 65000 },
] satisfies IbadanLgaSeed[]).map((unit) => Object.freeze({ beta: true, districts: [], ...unit })))

/** Pinned shared-frame projection of the Ibadan anchor, 3.93 E and 7.38 N. */
export const IBADAN_MAP_ORIGIN = Object.freeze({ x: -4470, z: 1801 })

const CAREER_IDS = Object.freeze([
  'community-helper', 'tech', 'banking', 'music', 'trading', 'nursing', 'hair', 'chef', 'dj',
  'fitness', 'creator', 'teaching', 'event', 'football', 'retail',
])

export const IBADAN_RULES = Object.freeze({
  id: 'ibadan',
  name: 'Ibadan',
  status: 'open',
  unit: 'local government',
  units: IBADAN_LGAS,
  hub: { road: 'Iwo Road Interchange', air: 'Ibadan Airport', rail: 'Obafemi Awolowo Station at Moniya' },
  seaPlots: false,
  legacyLgaChoice: true,
  legacyVenueAliases: {
    park: 'agodi-gardens', library: 'ui-campus', office: 'cocoa-house', hospital: 'uch', market: 'dugbe-market',
    beach: 'eleyele-lake', airport: 'ibadan-airport', 'polling-unit': 'mapo-polling', 'state-house': 'mapo-hall',
    'amala-shitta': 'dugbe-amala', salon: 'mokola-salon', church: 'ui-chapel', mosque: 'ui-mosque',
    'viewing-centre': 'lekan-salami-stadium', 'i-fitness': 'lekan-salami-stadium', 'canopy-walk': 'iita-forest',
    refinery: 'moniya-station', cchub: 'polytechnic', radio: 'agodi-gardens', shrine: 'agodi-gardens',
    quilox: 'agodi-gardens', rooftop: 'agodi-gardens', palms: 'dugbe-market', police: 'mapo-hall',
  },
  state: { id: 'oyo', name: 'Oyo State', unit: 'local government' },
  country: { id: 'ng', name: 'Nigeria' },
  timezone: 'Africa/Lagos',
  defaultName: 'New arrival',
  rentedHomeIds: ['ibadan-mokola-room', 'ibadan-bodija-flat', 'ibadan-dugbe-flat', 'ibadan-ring-road-flat', 'ibadan-akobo-house'],
  defaultRentedHome: 'ibadan-bodija-flat',
  careerIds: CAREER_IDS,
  atlas: {
    lon: 3.95,
    lat: 7.38,
    stand: 'high',
    teaser: 'Seven hills of brown roofs, old markets, universities and amala with gbegiri and ewedu.',
    preview: ['Mapo and the old city', 'Dugbe and Cocoa House', 'Bodija and the University of Ibadan'],
  },
  mapOrigin: IBADAN_MAP_ORIGIN,
  districts: [
    { id: 'mokola', name: 'Mokola', localUnitId: 'ibadan-north' },
    { id: 'bodija', name: 'Bodija', localUnitId: 'ibadan-north' },
    { id: 'dugbe', name: 'Dugbe', localUnitId: 'ibadan-north-west' },
    { id: 'ring-road', name: 'Ring Road', localUnitId: 'ibadan-south-west' },
    { id: 'akobo', name: 'Akobo', localUnitId: 'lagelu' },
  ],
  hubs: [
    { id: 'iwo-road', name: 'Iwo Road Interchange', mode: 'road', venueId: 'iwo-road-interchange' },
    { id: 'ibadan-airport', name: 'Ibadan Airport', mode: 'air', venueId: 'ibadan-airport' },
    { id: 'moniya-rail', name: 'Obafemi Awolowo Station', mode: 'rail', venueId: 'moniya-station' },
  ],
  links: [
    { a: 'lagos', b: 'ibadan', mode: 'road', beta: true, label: 'Bus on the Lagos–Ibadan Expressway', icon: '🚌', fare: 3500, seconds: 120, km: 130 },
    { a: 'lagos', b: 'ibadan', mode: 'rail', beta: true, label: 'Train between Mobolaji Johnson and Obafemi Awolowo stations', icon: '🚆', fare: 9000, seconds: 90, km: 157 },
  ],
} satisfies CityModuleRules<'ibadan', 'oyo', IbadanLocalGovernmentId, IbadanDistrictId, IbadanHubId>)
