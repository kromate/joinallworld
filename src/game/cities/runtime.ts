/** Synchronous catalogue views once a city's content is available to the engine. */
import { cityContent, cachedCityContent, cityRules, knownCityIds } from './registry.ts'
import type { CityContent, VenueDefinition, NpcDefinition, JobDefinition } from '../../types/content.ts'

export const contentFor = (city: string): CityContent => cityContent(city)
/** The first frontage is private scenery around the player's own home, never a city-wide social room. */
function neighbourhoodFor(city: string, id = 'neighbourhood'): VenueDefinition | undefined {
  const home = contentFor(city).venues.find(item => item.id === 'home')?.definition
  return home ? { ...home, id, label: id === 'neighbourhood' ? 'Outside your home' : 'City streets', description: 'Walk to a doorway to enter.', ambient: ['The city around you.'], scene: { kind: 'walk' }, spots: { street: { id: 'street', label: 'Outside', activities: [] } } } : undefined
}
export const venuesFor = (city: string): readonly VenueDefinition[] => {
  const venues = contentFor(city).venues.map(item => item.definition), neighbourhood = neighbourhoodFor(city)
  return neighbourhood ? [...venues, neighbourhood] : venues
}
export const venueFor = (city: string, id: unknown): VenueDefinition | undefined => id === 'neighbourhood' || id === 'city-street' ? neighbourhoodFor(city, id) : contentFor(city).venues.find(item => item.id === id)?.definition
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

/** Display prose is only available after the caller has loaded the city's content. */
export function localUnitDescription(city: string, id: string): string {
  const line = contentFor(city).localUnitDescriptions[id]
  if (typeof line !== 'string') throw new TypeError(`City ${city} has no description for ${id}`)
  return line
}

/**
 * Where a ticket lands a visitor: the venue of the city's hub for the way they came (flight: the airport, road: the motor park or bus
 * terminal, rail: the station), or the public arrival venue where the city has no such venue, the way was a boat or something else, or
 * `open` says the venue is closed to walk-ins at that moment.
 */
export function ticketArrivalVenue(city: string, mode: unknown, open: (venue: VenueDefinition) => boolean = () => true): VenueDefinition {
  const hubId = mode === 'air' || mode === 'road' || mode === 'rail' ? cityRules(city)?.hubs.find(hub => hub.mode === mode)?.venueId : undefined
  const venue = hubId ? venueFor(city, hubId) : undefined
  return venue && venue.id !== 'home' && venue.category !== 'home' && open(venue) ? venue : publicArrivalVenue(city)
}
