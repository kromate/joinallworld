import { createDestinationMap } from '../africa/map.ts'
import { FACTS } from './facts.ts'
import { GEOMETRY } from './geometry.ts'
export const CITY_MAP = createDestinationMap(FACTS, GEOMETRY, async () => (await import('./index.ts')).city)
