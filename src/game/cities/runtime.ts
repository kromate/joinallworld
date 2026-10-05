/** Synchronous catalogue views once a city's content is available to the engine. */
import { cityContent, cachedCityContent, knownCityIds } from './registry.ts'
import type { CityContent, VenueDefinition, NpcDefinition, JobDefinition } from '../../types/content.ts'

export const contentFor = (city: string): CityContent => cityContent(city)
export const venuesFor = (city: string): readonly VenueDefinition[] => contentFor(city).venues.map(item => item.definition)
export const venueFor = (city: string, id: unknown): VenueDefinition | undefined => contentFor(city).venues.find(item => item.id === id)?.definition
export const regularsFor = (city: string): readonly NpcDefinition[] => contentFor(city).regulars.map(item => item.definition)
export const regularFor = (city: string, id: unknown): NpcDefinition | undefined => contentFor(city).regulars.find(item => item.id === id)?.definition
export const jobsFor = (city: string): readonly JobDefinition[] => contentFor(city).workplaces.map(item => item.definition)
export const jobFor = (city: string, id: unknown): JobDefinition | undefined => jobsFor(city).find(item => item.id === id)

export function knownRegular(id: string): NpcDefinition | undefined {
  for (const city of knownCityIds()) { const npc = cachedCityContent(city)?.regulars.find(item => item.id === id)?.definition; if (npc) return npc }
  return undefined
}

/** A guest or first-time visitor enters a public place, never an unowned home. */
export function publicArrivalVenue(city: string): VenueDefinition {
  const places = venuesFor(city).filter(venue => venue.id !== 'home');
  const place = places.find(venue => venue.scene.kind === 'park') ?? places[0];
  if (!place) throw new TypeError('A city needs a public arrival venue');
  return place;
}
