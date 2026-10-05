import { timedLink } from '../../content/travel.ts'
import type { CityLink } from '../../../types/content.ts'

/** Fares, timers and distances are beta game values. The Idu–Rigasa train is real; Kaduna is not open, so nothing leaves for it yet. */
export const ABUJA_LINKS = Object.freeze({
  lagosRoad: timedLink({ a: 'lagos', b: 'abuja', mode: 'road', beta: true, label: 'Night bus through Lokoja', icon: '🚌', fare: 14000, km: 760 }),
  lagosAir: timedLink({ a: 'lagos', b: 'abuja', mode: 'air', beta: true, label: 'Flight between Lagos and Abuja', icon: '✈️', fare: 65000, km: 520 }),
  ibadanRoad: timedLink({ a: 'ibadan', b: 'abuja', mode: 'road', beta: true, label: 'Bus through Ilorin', icon: '🚌', fare: 12000, km: 640 }),
  phRoad: timedLink({ a: 'abuja', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Enugu', icon: '🚌', fare: 11000, km: 600 }),
  phAir: timedLink({ a: 'abuja', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight between Abuja and Port Harcourt', icon: '✈️', fare: 55000, km: 450 }),
  kadunaRail: timedLink({ a: 'abuja', b: 'kaduna', mode: 'rail', beta: true, label: 'Train between Idu and Rigasa', icon: '🚆', fare: 6000, km: 186 }),
} satisfies Readonly<Record<string, CityLink>>)
