import type { CityLink } from '../../../types/content.ts'

/**
 * Fares, timers and distances are beta game values; air distances are rounded great-circle references.
 * The Lagos–Kano railway exists, but the game runs no train on it yet: that link is listed as coming and cannot be booked.
 */
export const KANO_LINKS = Object.freeze({
  lagosAir: { a: 'lagos', b: 'kano', mode: 'air', beta: true, label: 'Flight between Lagos and Kano', icon: '✈️', fare: 85000, seconds: 110, km: 834 },
  lagosRoad: { a: 'lagos', b: 'kano', mode: 'road', beta: true, label: 'Long-distance bus through Ilorin and Kaduna', icon: '🚌', fare: 20000, seconds: 480, km: 1100 },
  lagosRail: { a: 'lagos', b: 'kano', mode: 'rail', status: 'coming', beta: true, label: 'Train on the Lagos–Kano line', icon: '🚆', fare: 16000, seconds: 420, km: 1100 },
  abujaAir: { a: 'abuja', b: 'kano', mode: 'air', beta: true, label: 'Flight between Abuja and Kano', icon: '✈️', fare: 45000, seconds: 70, km: 364 },
  abujaRoad: { a: 'abuja', b: 'kano', mode: 'road', beta: true, label: 'Bus through Kaduna and Zaria', icon: '🚌', fare: 9000, seconds: 240, km: 450 },
} satisfies Readonly<Record<string, CityLink>>)
