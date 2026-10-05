import { timedLink } from '../../content/travel.ts'
import type { CityLink } from '../../../types/content.ts'

/**
 * Fares, timers and distances are beta game values; air distances are rounded great-circle references.
 * The Lagos–Kano railway exists, but the game runs no train on it yet: that link is listed as coming and cannot be booked.
 */
export const KANO_LINKS = Object.freeze({
  lagosAir: timedLink({ a: 'lagos', b: 'kano', mode: 'air', beta: true, label: 'Flight between Lagos and Kano', icon: '✈️', fare: 85000, km: 834 }),
  lagosRoad: timedLink({ a: 'lagos', b: 'kano', mode: 'road', beta: true, label: 'Long-distance bus through Ilorin and Kaduna', icon: '🚌', fare: 20000, km: 1100 }),
  lagosRail: timedLink({ a: 'lagos', b: 'kano', mode: 'rail', status: 'coming', beta: true, label: 'Train on the Lagos–Kano line', icon: '🚆', fare: 16000, km: 1100 }),
  abujaAir: timedLink({ a: 'abuja', b: 'kano', mode: 'air', beta: true, label: 'Flight between Abuja and Kano', icon: '✈️', fare: 45000, km: 364 }),
  abujaRoad: timedLink({ a: 'abuja', b: 'kano', mode: 'road', beta: true, label: 'Bus through Kaduna and Zaria', icon: '🚌', fare: 9000, km: 450 }),
} satisfies Readonly<Record<string, CityLink>>)
