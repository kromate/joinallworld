import { JOBS } from '../../content/jobs.ts'
import { activity, buildCityContent, hospitalSpots, spot, work } from '../contentBuilder.ts'
import { fromLocal, toLocal } from '../../../geo/frame.ts'
import type { CityContent, TravelModeDefinition } from '../../../types/content.ts'
import type { CityBounds, CityContentSpec, CityPoint, CityPersonSeed, CityVenueSeed } from '../contentBuilder.ts'
import { destinationVenueIds, validateDestinationFacts } from './types.ts'
import type { DestinationFacts, DestinationPlace } from './types.ts'

const betaNote = 'Starter gameplay placeholder; shared game economy values are provisional and do not describe local prices.'

function pointAt(facts: DestinationFacts, east: number, north: number): CityPoint {
  const { mapOrigin, centre } = validateDestinationFacts(facts)
  const [x, z] = toLocal(mapOrigin, centre.lon, centre.lat)
  return fromLocal(mapOrigin, x + east, z - north)
}

function contentBounds(facts: DestinationFacts, venues: readonly CityVenueSeed[], home: CityPoint): CityBounds {
  const valid = validateDestinationFacts(facts)
  const [west, south, east, north] = valid.bounds
  const frameCorners = [toLocal(valid.mapOrigin, west, south), toLocal(valid.mapOrigin, east, north)]
  const points = [...frameCorners, ...venues.map(venue => toLocal(valid.mapOrigin, venue.point.lon, venue.point.lat)), toLocal(valid.mapOrigin, home.lon, home.lat)]
  const xs = points.map(point => point[0]), zs = points.map(point => point[1])
  const minX = Math.min(...xs) - 2, maxX = Math.max(...xs) + 2, minZ = Math.min(...zs) - 2, maxZ = Math.max(...zs) + 2
  return { minX, maxX: maxX === minX ? minX + 4 : maxX, minZ, maxZ: maxZ === minZ ? minZ + 4 : maxZ }
}

const localModes: readonly TravelModeDefinition[] = Object.freeze([
  { id: 'trek', label: 'Walk', icon: '🚶', fare: 0, seconds: 13, needs: { energy: -10, hygiene: -7 }, xp: { fitness: 15 }, exposed: true, eventChance: 0.2, blurb: 'Walk between nearby places.', beta: true },
  { id: 'danfo', label: 'Bus', icon: '🚌', fare: 250, seconds: 9, needs: {}, eventChance: 0.1, blurb: 'Take a shared local bus.', beta: true },
  { id: 'cab', label: 'Taxi', icon: '🚕', fare: 450, seconds: 7, needs: { energy: 1 }, eventChance: 0.05, blurb: 'Take a direct taxi ride.', beta: true },
])

const regularPairs: readonly (readonly [string, string])[] = Object.freeze([
  ['Visitor guide', 'Welcome people arriving in the city.'],
  ['Transit host', 'Help visitors find their way around.'],
  ['Meal host', 'Help visitors find a place to eat.'],
  ['Community host', 'Organise activities for the neighbourhood.'],
  ['Clinic guide', 'Help visitors understand the clinic game stop.'],
  ['Recreation host', 'Help visitors find a free activity.'],
])

// Fictional, neutral game-character names; they do not identify real residents.
const starterNames: readonly string[] = Object.freeze([
  'Alex', 'Casey', 'Jordan', 'Morgan', 'Riley', 'Taylor', 'Avery', 'Quinn', 'Jamie', 'Robin',
  'Jesse', 'Cameron', 'Drew', 'Skyler', 'Sidney', 'Sam', 'Ari', 'Lee', 'Remy', 'Noel',
  'Blake', 'Dana', 'Eden', 'Finley', 'Gray', 'Harper', 'Indigo', 'Kai', 'Logan', 'Marlow',
  'Nico', 'Oakley', 'Parker', 'Reese', 'Sage', 'Tatum', 'Uri', 'Vale', 'Wren', 'Yael',
  'Arden', 'Briar', 'Corin', 'Devon', 'Emery', 'Frankie', 'Greer', 'Hollis', 'Ira', 'Jules',
  'Kendall', 'Lane', 'Merritt', 'Nova', 'Onyx', 'Penn', 'Rowan', 'Shiloh', 'Teddy', 'Winter',
])

const peopleFor = (id: string, venues: readonly CityVenueSeed[]): readonly CityPersonSeed[] => Object.freeze(venues.flatMap((venue, index) => {
  const [role, line] = regularPairs[index] ?? ['Visitor host', 'Help visitors find an activity at this game venue.']
  const firstName = starterNames[index * 2]
  const secondName = starterNames[index * 2 + 1]
  if (!firstName || !secondName) throw new RangeError('Starter game character name pool is too small for the authored venues.')
  return [
    { name: firstName, role, quotes: [line, 'What would you like to do today?'] as const },
    { name: secondName, role: 'Neighbour', quotes: ['Good to see you here.', 'There is always something to do.'] as const },
  ].map(person => ({ ...person, note: `${id} starter game character at ${venue.name}; not a factual local biography.` }))
}))

function starterHospitalSpots() {
  return hospitalSpots().map(place => ({
    ...place,
    activities: place.activities?.map(item => ({ ...item, cost: 0, beta: true, note: betaNote })),
  }))
}

function replaceHomeMeal(content: CityContent<string>, cityId: string): CityContent<string> {
  const venues = content.venues.map(venue => {
    if (venue.id !== 'home') return venue
    const kitchen = venue.definition.spots.kitchen
    if (!kitchen) return venue
    const activities = kitchen.activities.map(item => item.id === 'garri'
      ? { ...item, id: `${cityId}-home-simple-meal`, label: 'Make a simple meal', effects: { hunger: 20 }, beta: true, note: betaNote }
      : item)
    const definition = { ...venue.definition, beta: true, spots: { ...venue.definition.spots, kitchen: { ...kitchen, activities } } }
    return { ...venue, definition }
  })
  const housing = content.housing.map(home => ({ ...home, definition: { ...home.definition, description: `Starter rental game option for the ${home.definition.district} play zone. Shared Naira amounts are provisional.`, betaFields: ['grid', 'rent', 'moveIn'] } }))
  const workplaces = content.workplaces.map(place => ({
    ...place,
    definition: { ...place.definition, beta: true, summary: place.careerId === 'tech' ? 'Build technical skills and complete a shared beta work shift.' : 'Help run activities at the community game venue.', shift: { ...place.definition.shift, beta: true, note: betaNote } },
  }))
  return Object.freeze({
    ...content,
    venues: Object.freeze(venues),
    housing: Object.freeze(housing),
    workplaces: Object.freeze(workplaces),
    starterGoals: Object.freeze(content.starterGoals.map(goal => ({ ...goal, beta: true }))),
    wishes: Object.freeze(content.wishes.map(wish => ({ ...wish, beta: true }))),
  })
}

/** The one activity an added real place offers, by what kind of place it is. */
function visitSeed(valid: DestinationFacts, place: DestinationPlace, id: string): CityVenueSeed {
  const sight = place.kind === 'worship' ? ['Take a quiet moment', '🕊️', ['rest', 'fun'], { fun: 6, energy: 5 }] as const
    : place.kind === 'quad' ? ['Walk the campus', '🎓', ['fun'], { fun: 8, energy: 1 }] as const
    : place.kind === 'viewing' ? ['Watch from the stands', '🏟️', ['fun'], { fun: 10 }] as const
    : ['Look around', '🧭', ['fun'], { fun: 8, energy: 1 }] as const
  return {
    id, name: place.name, district: place.district, kind: place.kind, category: place.category, icon: place.icon,
    point: { lon: place.lon, lat: place.lat }, description: place.line, ambient: [], beta: true,
    note: `${place.name}: OpenStreetMap ${place.osm}${place.wikidata ? `, Wikidata ${place.wikidata}` : ''} (${place.accuracy}). ${valid.licence}.`,
    spots: [spot('visit', 'Visit', activity(`${id}-visit`, sight[0], sight[1], [...sight[2]], { cost: 0, effects: sight[3], beta: true, note: betaNote }))],
  }
}

/** Build generic playable prose and activities without inventing local businesses or customs. Real places, where given, replace the generic names and points. */
export function buildDestinationContent(facts: DestinationFacts, places: readonly DestinationPlace[] = []): CityContent<string> {
  const valid = validateDestinationFacts(facts)
  const ids = destinationVenueIds(valid.id, valid.airport.id)
  const centre = pointAt(valid, 0, 0)
  const generic: readonly CityVenueSeed[] = Object.freeze([
    {
      id: ids.airport, name: valid.airport.name, district: valid.names?.area ?? 'Starter play zone', kind: 'airport', category: 'civic', icon: 'airport',
      point: { lon: valid.airport.lon, lat: valid.airport.lat }, description: `Arrive at ${valid.airport.name}.`, ambient: [], beta: true,
      note: `${valid.sourceLabel}; airport location: ${valid.airport.sourceUrl}. ${valid.licence}.`,
      spots: [spot('arrival', 'Visitor information', activity(`${valid.id}-arrival-info`, 'Read visitor information', '🧭', ['travel'], { effects: { fun: 2 }, beta: true, note: betaNote }))],
    },
    {
      id: ids.transit, name: 'City transit stop (game venue)', district: 'Starter play zone', kind: 'hub', category: 'civic', icon: 'bus',
      point: pointAt(valid, 1, 0), description: 'A game stop for local travel choices; it is not a mapped terminal.', ambient: [], beta: true, note: betaNote,
      spots: [spot('arrival', 'Travel information', activity(`${valid.id}-transit-info`, 'Check local travel options', '🚌', ['travel'], { effects: { fun: 2 }, beta: true, note: betaNote }))],
    },
    {
      id: ids.meal, name: 'Visitor meal stop (game venue)', district: 'Starter play zone', kind: 'buka', category: 'food', icon: 'food',
      point: pointAt(valid, -1, 0), description: 'A fictional gameplay stop for a meal; it does not represent a sourced restaurant.', ambient: [], beta: true, note: betaNote,
      spots: [spot('counter', 'Meal counter', activity(`${valid.id}-visitor-meal`, 'Have a simple meal', '🍲', ['food'], { cost: 0, effects: { hunger: 30, fun: 5 }, beta: true, note: betaNote }))],
    },
    {
      id: ids.community, name: 'Community workshop (game venue)', district: 'Starter play zone', kind: 'office', category: 'work', icon: 'office',
      point: pointAt(valid, 0, 1), description: 'A fictional game venue for community activities and starter jobs.', ambient: [], beta: true, note: betaNote,
      spots: [spot('visit', 'Community room', activity(`${valid.id}-community-session`, 'Join a community activity', '✨', ['fun'], { effects: { fun: 10, energy: 2 }, beta: true, note: betaNote })), work()],
    },
    {
      id: ids.clinic, name: 'Clinic (game venue)', district: 'Starter play zone', kind: 'hospital', category: 'care', icon: 'health',
      point: pointAt(valid, 0, -1), description: 'A fictional gameplay clinic using the shared clinic activities.', ambient: [], beta: true, note: betaNote,
      spots: starterHospitalSpots(),
    },
    {
      id: ids.recreation, name: 'Recreation area (game venue)', district: 'Starter play zone', kind: 'park', category: 'fun', icon: 'park',
      point: pointAt(valid, 1, 1), description: 'A fictional free gameplay space for rest and recreation.', ambient: [], beta: true, note: betaNote,
      spots: [spot('visit', 'Open space',
        activity(`${valid.id}-recreation`, 'Take a free break', '🌿', ['fun'], { cost: 0, effects: { fun: 12, energy: 3 }, beta: true, note: betaNote }),
        activity(`${valid.id}-quiet-rest`, 'Sit and rest', '🪑', ['rest'], { cost: 0, effects: { energy: 10 }, beta: true, note: betaNote }),
        activity(`${valid.id}-evening-rest`, 'Enjoy a quiet evening', '🌙', ['nightlife', 'fun'], { cost: 0, effects: { fun: 10, energy: 2 }, beta: true, note: betaNote }),
      )],
    },
    {
      id: ids.market, name: 'Market game (game venue)', district: 'Starter play zone', kind: 'market', category: 'work', icon: 'market',
      point: pointAt(valid, -1, 1), description: 'A fictional game market for browsing shared starter goods; it is not a mapped business.', ambient: [], beta: true, note: betaNote,
      spots: [spot('aisle', 'Game market aisle', activity(`${valid.id}-market-browse`, 'Browse starter goods', '🧺', ['market'], { cost: 0, effects: { fun: 3 }, beta: true, note: betaNote })), work()],
    },
    {
      id: ids.worship, name: 'Quiet reflection space (game venue)', district: 'Starter play zone', kind: 'worship', category: 'fun', icon: 'worship',
      point: pointAt(valid, -1, -1), description: 'A fictional quiet space for reflection; it does not represent a specific faith site.', ambient: [], beta: true, note: betaNote,
      spots: [spot('visit', 'Quiet space', activity(`${valid.id}-quiet-reflection`, 'Take a quiet reflection break', '🕊️', ['rest', 'fun'], { cost: 0, effects: { fun: 6, energy: 5 }, beta: true, note: betaNote }))],
    },
    {
      id: ids.polling, name: 'Community voting simulation (game venue)', district: 'Starter play zone', kind: 'polling', category: 'civic', icon: 'poll',
      point: pointAt(valid, 2, 0), description: 'A fictional civic game activity; it is not an election office or polling station.', ambient: [], beta: true, note: betaNote,
      spots: [spot('officials', 'Game information desk', activity(`${valid.id}-community-vote-info`, 'Read the community voting game rules', '🗳️', ['civic'], { cost: 0, effects: { fun: 2 }, beta: true, note: betaNote }))],
    },
    {
      id: ids.government, name: 'Community notices (game venue)', district: 'Starter play zone', kind: 'statehouse', category: 'civic', icon: 'civic',
      point: pointAt(valid, 0, 2), description: 'A fictional noticeboard for the starter game community; it does not represent a real government office.', ambient: [], beta: true, note: betaNote,
      spots: [spot('notices', 'Community noticeboard', activity(`${valid.id}-community-notices`, 'Read community game notices', '📋', ['civic'], { cost: 0, effects: { fun: 2 }, beta: true, note: betaNote }))],
    },
  ])
  const real = new Map<string, DestinationPlace>(places.flatMap(place => place.slot ? [[ids[place.slot], place] as const] : []))
  const slotted = generic.map((venue): CityVenueSeed => {
    const place = real.get(venue.id)
    if (!place) return venue
    // The slot keeps its id, kind, spots and activities; the real place gives it a name, a point and a description.
    return { ...venue, name: place.name, district: place.district, point: { lon: place.lon, lat: place.lat }, description: place.line,
      note: `${place.name}: OpenStreetMap ${place.osm}${place.wikidata ? `, Wikidata ${place.wikidata}` : ''} (${place.accuracy}). ${valid.licence}. ${betaNote}` }
  })
  const added = places.filter(place => !place.slot).map(place => {
    if (!place.key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(place.key)) throw new TypeError(`${valid.id}: an added place needs a lowercase key`)
    return visitSeed(valid, place, `${valid.id}-${place.key}`)
  })
  const venues: readonly CityVenueSeed[] = Object.freeze([...slotted, ...added])
  const area = valid.names?.area ?? 'Starter play zone'
  const home = centre
  const bounds = contentBounds(valid, venues, home)
  const recreationActivity = `${valid.id}-recreation`
  const careers = Object.values(JOBS).filter(job => job.id !== 'community-helper' && job.id !== 'tech').map(job => job.id)
  const content = buildCityContent({
    cityId: valid.id,
    cityName: valid.name,
    origin: valid.mapOrigin,
    bounds,
    localUnitDescriptions: { centre: `${area} within ${valid.coverageNote}` },
    venues,
    people: peopleFor(valid.id, venues),
    careerVenues: { 'community-helper': ids.community, tech: ids.community },
    careerSummaries: { 'community-helper': 'Help run activities at the community game venue.', tech: 'Build technical skills at the community game venue.' },
    unavailableCareerIds: careers,
    houses: [{ id: `${valid.id}-centre-home`, label: 'Starter room (game home)', districtId: 'centre-home', district: area, rent: 6000, grid: 6, point: home }],
    events: [],
    firstFun: { venue: ids.recreation, spot: 'visit', activity: recreationActivity, title: 'Take a free break', hint: 'Visit the recreation game venue for fun and rest.' },
    buka: ids.meal,
    thingsToDo: venues.map(venue => ({ venueId: venue.id, name: venue.name, line: venue.description })),
    culture: { greeting: 'Welcome, traveller.', food: [], knownFor: [] },
    localModes,
    radioVenueIds: [ids.recreation], billboardRoads: [],
    tablePlaces: [{ id: `${ids.recreation}-chess`, venueId: ids.recreation, game: 'chess', label: 'Starter chess table (game venue)', seats: 2 }],
    dreamWording: {}, lotteryWording: {},
    unitLabel: valid.names?.unit ?? 'starter play zone', wishPrefix: valid.id,
  })
  return replaceHomeMeal({
    ...content,
    business: {
      plate: `${valid.name} starter plate (game menu)`,
      markets: { [ids.market]: { known: [], footfall: 1 } },
      localProductIds: [],
    },
  }, valid.id)
}
