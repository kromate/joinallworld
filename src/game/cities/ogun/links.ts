import type { CityLink } from '../../../types/content.ts'

export const OGUN_LINKS = Object.freeze({
  lagosOta: { a: 'lagos', b: 'ota', mode: 'road', label: 'Bus on the Lagos–Abeokuta Expressway', icon: '🚌', fare: 2000, seconds: 60, km: 40, beta: true },
  lagosAbeokuta: { a: 'lagos', b: 'abeokuta', mode: 'road', label: 'Bus on the Lagos–Abeokuta Expressway', icon: '🚌', fare: 3500, seconds: 120, km: 100, beta: true },
  lagosAbeokutaRail: { a: 'lagos', b: 'abeokuta', mode: 'rail', label: 'Train between Mobolaji Johnson and Professor Wole Soyinka stations', icon: '🚆', fare: 7000, seconds: 80, km: 110, beta: true },
  otaAbeokuta: { a: 'ota', b: 'abeokuta', mode: 'road', label: 'Bus through Ifo', icon: '🚌', fare: 2500, seconds: 90, km: 70, beta: true },
  abeokutaIbadan: { a: 'abeokuta', b: 'ibadan', mode: 'road', label: 'Bus on the Abeokuta–Ibadan Road', icon: '🚌', fare: 3000, seconds: 90, km: 85, beta: true },
  abeokutaIbadanRail: { a: 'abeokuta', b: 'ibadan', mode: 'rail', label: 'Train between Professor Wole Soyinka and Obafemi Awolowo stations', icon: '🚆', fare: 4000, seconds: 45, km: 85, beta: true },
  abeokutaSagamu: { a: 'abeokuta', b: 'sagamu', mode: 'road', label: 'Bus on the Sagamu–Abeokuta Road', icon: '🚌', fare: 2500, seconds: 90, km: 75, beta: true },
  otaSagamu: { a: 'ota', b: 'sagamu', mode: 'road', label: 'Bus through the expressway interchange', icon: '🚌', fare: 2500, seconds: 90, km: 80, beta: true },
  sagamuIjebu: { a: 'sagamu', b: 'ijebu-ode', mode: 'road', label: 'Bus on the Sagamu–Benin Road', icon: '🚌', fare: 1500, seconds: 50, km: 55, beta: true },
} satisfies Readonly<Record<string, CityLink>>)
