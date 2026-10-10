import { createDestinationMap } from '../africa/map.ts'
import { FACTS } from './facts.ts'
import { GEOMETRY } from './geometry.ts'
import { TERRAIN } from './terrain.ts'
export const CITY_MAP = createDestinationMap(FACTS, GEOMETRY, async () => (await import('./index.ts')).city, { ...TERRAIN, surround: '#d9cba0' })
