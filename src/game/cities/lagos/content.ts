import { EVENTS_CALENDAR } from '../../content/calendar.ts'
import { BILLBOARDS, RADIO } from '../../content/civic.ts'
import { STARTER_GOALS, WISHES } from '../../content/goals.ts'
import { JOBS } from '../../content/jobs.ts'
import { HOUSES } from '../../content/housing.ts'
import { NPCS } from '../../content/npcs.ts'
import { HOME_SPOTS, VENUES } from '../../content/venues.ts'
import { TABLES } from '../../../tables/places.ts'
import type { CityContent, CityGuidePlace, CityVenueContent } from '../../../types/content.ts'

const venues: readonly CityVenueContent<'lagos'>[] = Object.freeze(Object.values(VENUES).map((definition) => Object.freeze({
  cityId: 'lagos' as const,
  id: definition.id,
  kind: definition.scene.kind,
  name: definition.label,
  district: definition.district,
  position: { kind: 'legacy-map' as const, point: definition.map },
  ...(definition.hours ? { hours: definition.hours } : {}),
  whatYouCanDo: definition.description,
  definition,
  spotWording: Object.freeze({}),
  activityWording: Object.freeze({}),
})))

const GUIDE_IDS = ['park', 'amala-shitta', 'shrine', 'market', 'beach'] as const
const thingsToDo: readonly CityGuidePlace[] = Object.freeze(GUIDE_IDS.map((venueId) => {
  const venue = VENUES[venueId]
  return Object.freeze({ venueId, name: venue.label, line: venue.description })
}))

const housing = Object.freeze(Object.values(HOUSES).map((definition) => {
  const spot = HOME_SPOTS[definition.id]
  if (!spot) throw new Error(`Missing Lagos home map spot: ${definition.id}`)
  return Object.freeze({ definition, spot })
}))

export const LAGOS_CONTENT: CityContent<'lagos'> = Object.freeze({
  cityId: 'lagos',
  venues,
  regulars: Object.freeze(Object.values(NPCS).map((definition) => Object.freeze({
    cityId: 'lagos' as const,
    id: definition.id,
    venueId: definition.venue,
    definition,
  }))),
  workplaces: Object.freeze(Object.values(JOBS).map((definition) => Object.freeze({
    careerId: definition.id,
    venueId: definition.workplace.venue,
    definition,
  }))),
  unavailableCareerIds: Object.freeze([]),
  housing,
  events: EVENTS_CALENDAR,
  starterGoals: STARTER_GOALS,
  wishes: WISHES,
  radioVenueIds: RADIO.venues,
  billboardRoads: BILLBOARDS.slots,
  tablePlaces: Object.freeze(TABLES.map((table) => Object.freeze({
    id: table.id,
    venueId: table.venue,
    game: table.game,
    label: table.label,
    seats: table.seats,
  }))),
  thingsToDo,
  culture: Object.freeze({
    greeting: 'How far?',
    food: Object.freeze(['amala and ewedu', 'jollof rice', 'suya']),
    knownFor: Object.freeze(['the lagoon', 'markets', 'music and art']),
  }),
})
