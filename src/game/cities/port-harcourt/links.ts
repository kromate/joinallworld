import { timedLink } from '../../content/travel.ts'
import type { CityLink } from '../../../types/content.ts'

export const PORT_HARCOURT_LINKS = Object.freeze({
  lagosRoad: timedLink({ a: 'lagos', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Benin and the East–West Road', icon: '🚌', fare: 12000, km: 620 }),
  lagosAir: timedLink({ a: 'lagos', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight between Lagos and Port Harcourt', icon: '✈️', fare: 60000, km: 440 }),
} satisfies Readonly<Record<string, CityLink>>)
