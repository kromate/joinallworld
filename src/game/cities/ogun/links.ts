import { timedLink } from '../../content/travel.ts'
import type { CityLink } from '../../../types/content.ts'

export const OGUN_LINKS = Object.freeze({
  lagosOta: timedLink({ a: 'lagos', b: 'ota', mode: 'road', label: 'Bus on the Lagos–Abeokuta Expressway', icon: '🚌', fare: 2000, km: 40, beta: true }),
  lagosAbeokuta: timedLink({ a: 'lagos', b: 'abeokuta', mode: 'road', label: 'Bus on the Lagos–Abeokuta Expressway', icon: '🚌', fare: 3500, km: 100, beta: true }),
  lagosAbeokutaRail: timedLink({ a: 'lagos', b: 'abeokuta', mode: 'rail', label: 'Train between Mobolaji Johnson and Professor Wole Soyinka stations', icon: '🚆', fare: 7000, km: 110, beta: true }),
  otaAbeokuta: timedLink({ a: 'ota', b: 'abeokuta', mode: 'road', label: 'Bus through Ifo', icon: '🚌', fare: 2500, km: 70, beta: true }),
  abeokutaIbadan: timedLink({ a: 'abeokuta', b: 'ibadan', mode: 'road', label: 'Bus on the Abeokuta–Ibadan Road', icon: '🚌', fare: 3000, km: 85, beta: true }),
  abeokutaIbadanRail: timedLink({ a: 'abeokuta', b: 'ibadan', mode: 'rail', label: 'Train between Professor Wole Soyinka and Obafemi Awolowo stations', icon: '🚆', fare: 4000, km: 85, beta: true }),
  abeokutaSagamu: timedLink({ a: 'abeokuta', b: 'sagamu', mode: 'road', label: 'Bus on the Sagamu–Abeokuta Road', icon: '🚌', fare: 2500, km: 75, beta: true }),
  otaSagamu: timedLink({ a: 'ota', b: 'sagamu', mode: 'road', label: 'Bus through the expressway interchange', icon: '🚌', fare: 2500, km: 80, beta: true }),
  sagamuIjebu: timedLink({ a: 'sagamu', b: 'ijebu-ode', mode: 'road', label: 'Bus on the Sagamu–Benin Road', icon: '🚌', fare: 1500, km: 55, beta: true }),
} satisfies Readonly<Record<string, CityLink>>)
