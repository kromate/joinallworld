import { legacyCityContent } from './legacyContent.ts'
/** Synchronous catalogue views once a city's content is available to the engine. */
import { cityContent, cachedCityContent, knownCityIds, cityModule } from './registry.ts'
import { LAGOS_CONTENT } from './lagos/content.ts'
import type { CityContent, VenueDefinition, NpcDefinition, JobDefinition } from '../../types/content.ts'

const legacyIbadanContent = legacyCityContent(LAGOS_CONTENT, 'ibadan')

export function contentFor(city: string): CityContent {
  const loaded = cachedCityContent(city)
  if (loaded) return loaded
  // The existing engine is also consumed synchronously by saved-life tools. These two ids
  // retain the original catalogue; new cities must cross the explicit load boundary.
  if (city === 'lagos') return LAGOS_CONTENT
  if (city === 'ibadan' && !cityModule(city)) return legacyIbadanContent
  return cityContent(city)
}
export const venuesFor = (city: string): readonly VenueDefinition[] => contentFor(city).venues.map(item => item.definition)
export const venueFor = (city: string, id: unknown): VenueDefinition | undefined => contentFor(city).venues.find(item => item.id === id)?.definition
export const regularsFor = (city: string): readonly NpcDefinition[] => contentFor(city).regulars.map(item => item.definition)
export const regularFor = (city: string, id: unknown): NpcDefinition | undefined => contentFor(city).regulars.find(item => item.id === id)?.definition
export const jobsFor = (city: string): readonly JobDefinition[] => contentFor(city).workplaces.map(item => item.definition)
export const jobFor = (city: string, id: unknown): JobDefinition | undefined => jobsFor(city).find(item => item.id === id)

export function knownRegular(id: string): NpcDefinition | undefined {
  const original = LAGOS_CONTENT.regulars.find(item => item.id === id)?.definition
  if (original) return original
  for (const city of knownCityIds()) { const npc = cachedCityContent(city)?.regulars.find(item => item.id === id)?.definition; if (npc) return npc }
  return undefined
}
