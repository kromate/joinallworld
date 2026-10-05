import type { CityLink } from '../../../types/content.ts'

export const PORT_HARCOURT_LINKS = Object.freeze({
  lagosRoad: { a: 'lagos', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Benin and the East–West Road', icon: '🚌', fare: 12000, seconds: 360, km: 620 },
  lagosAir: { a: 'lagos', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight between Lagos and Port Harcourt', icon: '✈️', fare: 60000, seconds: 90, km: 440 },
  abaRoad: { a: 'port-harcourt', b: 'aba', mode: 'road', beta: true, label: 'Bus between Port Harcourt and Aba', icon: '🚌', fare: 2500, seconds: 90, km: 60 },
  owerriRoad: { a: 'port-harcourt', b: 'owerri', mode: 'road', beta: true, label: 'Bus between Port Harcourt and Owerri', icon: '🚌', fare: 3500, seconds: 120, km: 100 },
} satisfies Readonly<Record<string, CityLink>>)
