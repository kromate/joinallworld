import type { CityContent } from '../../types/content.ts'

/** The old preview keeps its original catalogue, excluding city-exclusive venues. */
export function legacyCityContent(source: CityContent, cityId: string): CityContent {
    const venues = source.venues.filter((venue) => !venue.definition.cities || venue.definition.cities.includes(cityId))
      .map((venue) => Object.freeze({ ...venue, cityId }))
    const venueIds = new Set(venues.map((venue) => venue.id))
    return Object.freeze({
      ...source,
      cityId,
      venues: Object.freeze(venues),
      regulars: Object.freeze(source.regulars.filter((regular) => venueIds.has(regular.venueId))
        .map((regular) => Object.freeze({ ...regular, cityId }))),
      workplaces: Object.freeze(source.workplaces.filter((workplace) => venueIds.has(workplace.venueId))),
      events: Object.freeze(source.events.filter((event) => venueIds.has(event.venue))),
      radioVenueIds: Object.freeze(source.radioVenueIds.filter((venueId) => venueIds.has(venueId))),
      billboardRoads: Object.freeze(source.billboardRoads.filter((slot) => venueIds.has(slot.near))),
      tablePlaces: Object.freeze(source.tablePlaces.filter((table) => venueIds.has(table.venueId))),
      thingsToDo: Object.freeze(source.thingsToDo.filter((place) => venueIds.has(place.venueId))),
    })
}
