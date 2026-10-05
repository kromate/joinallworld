import type { CityLink } from '../../types/content.ts'

/** Intercity links are symmetric. Fares and durations are original beta values. */
export const CITY_LINKS: readonly CityLink[] = Object.freeze([
  { a: 'lagos', b: 'ibadan', mode: 'road', beta: true, label: 'Bus on the Lagos–Ibadan Expressway', icon: '🚌', fare: 3500, seconds: 120, km: 130 },
  { a: 'lagos', b: 'abuja', mode: 'road', beta: true, label: 'Night bus through Lokoja', icon: '🚌', fare: 14000, seconds: 420, km: 760 },
  { a: 'lagos', b: 'abuja', mode: 'air', beta: true, label: 'Flight to Abuja', icon: '✈️', fare: 65000, seconds: 90, km: 520 },
  { a: 'lagos', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Benin and the East–West Road', icon: '🚌', fare: 12000, seconds: 360, km: 620 },
  { a: 'lagos', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight to Port Harcourt', icon: '✈️', fare: 60000, seconds: 90, km: 440 },
  { a: 'ibadan', b: 'abuja', mode: 'road', beta: true, label: 'Bus through Ilorin', icon: '🚌', fare: 12000, seconds: 360, km: 640 },
  { a: 'abuja', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Enugu', icon: '🚌', fare: 11000, seconds: 360, km: 600 },
  { a: 'abuja', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight to Port Harcourt', icon: '✈️', fare: 55000, seconds: 80, km: 450 },
])
