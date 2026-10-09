import { createDestinationModule } from '../africa/module.ts'
import { FACTS } from './facts.ts'
export const city = createDestinationModule(FACTS, async () => (await import('#city-map/accra')).CITY_MAP)
