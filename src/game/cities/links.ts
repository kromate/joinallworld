import { timedLink } from '../content/travel.ts'
import type { CityLink } from '../../types/content.ts'

/** The Lagos–Ibadan train: listed by both cities' rules, kept out of the legacy road table. */
export const LAGOS_IBADAN_RAIL: CityLink = Object.freeze(timedLink({ a: 'lagos', b: 'ibadan', mode: 'rail', beta: true, label: 'Train between Mobolaji Johnson and Obafemi Awolowo stations', icon: '🚆', fare: 9000, km: 157 }))

/** Intercity links are symmetric. Fares and durations are original beta values. */
export const CITY_LINKS: readonly CityLink[] = Object.freeze([
  timedLink({ a: 'lagos', b: 'ibadan', mode: 'road', beta: true, label: 'Bus on the Lagos–Ibadan Expressway', icon: '🚌', fare: 3500, km: 130 }),
  timedLink({ a: 'lagos', b: 'abuja', mode: 'road', beta: true, label: 'Night bus through Lokoja', icon: '🚌', fare: 14000, km: 760 }),
  timedLink({ a: 'lagos', b: 'abuja', mode: 'air', beta: true, label: 'Flight between Lagos and Abuja', icon: '✈️', fare: 65000, km: 520 }),
  timedLink({ a: 'lagos', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Benin and the East–West Road', icon: '🚌', fare: 12000, km: 620 }),
  timedLink({ a: 'lagos', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight between Lagos and Port Harcourt', icon: '✈️', fare: 60000, km: 440 }),
  timedLink({ a: 'ibadan', b: 'abuja', mode: 'road', beta: true, label: 'Bus through Ilorin', icon: '🚌', fare: 12000, km: 640 }),
  timedLink({ a: 'abuja', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Enugu', icon: '🚌', fare: 11000, km: 600 }),
  timedLink({ a: 'abuja', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight between Abuja and Port Harcourt', icon: '✈️', fare: 55000, km: 450 }),
])
