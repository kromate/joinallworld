import {
  activity, buildCityContent, hospitalSpots, spot, work,
  type CityBounds, type CityHouseSeed, type CityPersonSeed, type CitySpotSeed, type CityVenueSeed,
} from '../contentBuilder.ts'
import type { ActivityDefinition, CityContent, CityMapOrigin, TravelModeDefinition, UnmappedService, VenueScene } from '../../../types/content.ts'
import type { BusinessTypeId } from '../../../types/business.ts'
import { unmappedKindsOf, type CitySpec, type IdentityFact, type PopulationTier, type RealPlaceFact, type RealPlaceKind } from '../spec.ts'
import { formulaArrivalRecreation, formulaCareerPlan, formulaRoadArrival } from './careers.ts'
import { sceneKindFor } from './scenes.ts'

export interface FormulaContentInput<City extends string> {
  readonly spec: CitySpec<City>
  readonly origin: CityMapOrigin
  readonly bounds: CityBounds
  readonly localUnitAnchors: Readonly<Record<string, { readonly lon: number; readonly lat: number }>>
  readonly scenes: Readonly<Record<string, VenueScene>>
}

export const FORMULA_LOCAL_MODES: readonly TravelModeDefinition[] = Object.freeze([
  { id: 'trek', label: 'Trek', icon: '🚶', fare: 0, seconds: 13, needs: { energy: -10, hygiene: -7 }, xp: { fitness: 15 }, exposed: true, eventChance: 0.4, blurb: 'Free and best for short distances.', beta: true },
  { id: 'okada', label: 'Okada', icon: '🏍️', fare: 250, seconds: 5, needs: { hygiene: -3 }, exposed: true, eventChance: 0.15, blurb: 'Fast through local traffic, with no roof.', beta: true },
  { id: 'danfo', label: 'Bus', icon: '🚌', fare: 250, seconds: 9, needs: {}, eventChance: 0.2, blurb: 'A shared bus on the main routes.', beta: true },
  { id: 'cab', label: 'Taxi', icon: '🚕', fare: 450, seconds: 7, needs: { energy: 1 }, eventChance: 0.15, blurb: 'A direct ride across town.', beta: true },
])

interface PlaceTreatment {
  readonly category: CityVenueSeed['category']
  readonly icon: string
  readonly spotId: string
  readonly spotLabel: string
  readonly activityLabel: string
  readonly tags: readonly string[]
}

const TREATMENTS: Readonly<Record<RealPlaceKind, PlaceTreatment>> = Object.freeze({
  airport: { category: 'civic', icon: 'airport', spotId: 'terminal', spotLabel: 'Terminal', activityLabel: 'Read the departures board', tags: ['travel'] },
  church: { category: 'care', icon: 'worship', spotId: 'visit', spotLabel: 'Visitor area', activityLabel: 'Visit respectfully', tags: ['worship'] },
  'civic-landmark': { category: 'civic', icon: 'walk', spotId: 'visit', spotLabel: 'Visitor point', activityLabel: 'Learn about this place', tags: ['history', 'learn'] },
  college: { category: 'work', icon: 'school', spotId: 'visit', spotLabel: 'Visitor area', activityLabel: 'Join a learning session', tags: ['learn'] },
  'craft-centre': { category: 'work', icon: 'fabric', spotId: 'visit', spotLabel: 'Workshop', activityLabel: 'Learn about the craft', tags: ['craft', 'learn'] },
  eatery: { category: 'food', icon: 'food', spotId: 'counter', spotLabel: 'Food counter', activityLabel: 'Eat a local meal', tags: ['food'] },
  garden: { category: 'nightlife', icon: 'park', spotId: 'visit', spotLabel: 'Garden', activityLabel: 'Spend an evening in the garden', tags: ['fun', 'nightlife'] },
  government: { category: 'civic', icon: 'governor', spotId: 'notices', spotLabel: 'Notice board', activityLabel: 'Read the civic notices', tags: ['civic'] },
  heritage: { category: 'fun', icon: 'museum', spotId: 'visit', spotLabel: 'Heritage site', activityLabel: 'Learn about this place', tags: ['history', 'learn'] },
  hospital: { category: 'care', icon: 'health', spotId: 'clinic', spotLabel: 'Outpatient clinic', activityLabel: 'Get a health check-up', tags: ['checkup'] },
  industry: { category: 'work', icon: 'factory', spotId: 'visit', spotLabel: 'Visitor point', activityLabel: 'Learn about local industry', tags: ['industry', 'learn'] },
  market: { category: 'work', icon: 'market', spotId: 'aisle', spotLabel: 'Market aisle', activityLabel: 'Compare market prices', tags: ['market'] },
  mosque: { category: 'care', icon: 'worship', spotId: 'visit', spotLabel: 'Visitor area', activityLabel: 'Visit respectfully', tags: ['worship'] },
  museum: { category: 'fun', icon: 'museum', spotId: 'visit', spotLabel: 'Gallery', activityLabel: 'Learn about the collection', tags: ['history', 'learn'] },
  nightlife: { category: 'nightlife', icon: 'music', spotId: 'stage', spotLabel: 'Stage', activityLabel: 'Listen to the programme', tags: ['music', 'nightlife'] },
  park: { category: 'fun', icon: 'park', spotId: 'visit', spotLabel: 'Public area', activityLabel: 'Walk through the park', tags: ['walk', 'fun'] },
  polling: { category: 'civic', icon: 'poll', spotId: 'officials', spotLabel: 'Election officials', activityLabel: 'Read voter information', tags: ['civic'] },
  polytechnic: { category: 'work', icon: 'school', spotId: 'visit', spotLabel: 'Visitor area', activityLabel: 'Join a practical workshop', tags: ['learn'] },
  port: { category: 'civic', icon: 'hub', spotId: 'terminal', spotLabel: 'Port terminal', activityLabel: 'Read the port information', tags: ['travel'] },
  'rail-station': { category: 'civic', icon: 'hub', spotId: 'platform', spotLabel: 'Station platform', activityLabel: 'Read the railway information', tags: ['travel'] },
  'road-hub': { category: 'civic', icon: 'bus', spotId: 'arrival', spotLabel: 'Arrival forecourt', activityLabel: 'Read the road departures board', tags: ['travel'] },
  salon: { category: 'care', icon: 'hair', spotId: 'chair', spotLabel: 'Styling chair', activityLabel: 'Get a fresh style', tags: ['care'] },
  savings: { category: 'work', icon: 'office', spotId: 'counter', spotLabel: 'Service counter', activityLabel: 'Learn everyday budgeting', tags: ['learn'] },
  school: { category: 'work', icon: 'school', spotId: 'visit', spotLabel: 'Visitor area', activityLabel: 'Join a learning session', tags: ['learn'] },
  sport: { category: 'fun', icon: 'ball', spotId: 'stand', spotLabel: 'Main stand', activityLabel: 'Watch a training session', tags: ['sport'] },
  stadium: { category: 'fun', icon: 'ball', spotId: 'stand', spotLabel: 'Main stand', activityLabel: 'Watch a training session', tags: ['sport'] },
  university: { category: 'work', icon: 'school', spotId: 'visit', spotLabel: 'Visitor area', activityLabel: 'Join a learning session', tags: ['learn'] },
})

const visitActivityId = (cityId: string, place: RealPlaceFact): string => `${cityId}-${place.id}-visit`

interface FormulaIdentity {
  readonly kind: 'food' | 'craft' | 'industry'
  readonly fact: IdentityFact
}

const identityIndex = (spec: CitySpec): ReadonlyMap<string, FormulaIdentity> => new Map([
  ...spec.identity.foods.map((fact): [string, FormulaIdentity] => [fact.id, { kind: 'food', fact }]),
  ...spec.identity.crafts.map((fact): [string, FormulaIdentity] => [fact.id, { kind: 'craft', fact }]),
  ...spec.identity.industries.map((fact): [string, FormulaIdentity] => [fact.id, { kind: 'industry', fact }]),
])

const businessTypeFor = (identity: FormulaIdentity): BusinessTypeId => {
  if (identity.kind === 'food') return 'food'
  if (identity.kind === 'industry') return 'provisions'
  return identity.fact.localProductId && ['ankara', 'adire', 'aso-oke', 'indigo'].includes(identity.fact.localProductId) ? 'fabric' : 'crafts'
}

const activityLabelFor = (place: RealPlaceFact, identities: ReadonlyMap<string, FormulaIdentity>, fallback: string): string => {
  if (place.kind === 'eatery' && place.featuredIdentityId) {
    const identity = identities.get(place.featuredIdentityId)
    if (identity) return `Eat ${identity.fact.name}`
  }
  if (place.kind === 'market' && place.specialtyIds?.length) {
    const names = place.specialtyIds.flatMap(id => {
      const identity = identities.get(id)
      return identity ? [identity.fact.name] : []
    })
    if (names.length) return `Browse ${names.join(' and ')}`
  }
  return fallback
}

const venueSeed = (
  cityId: string,
  unitName: string,
  place: RealPlaceFact,
  identities: ReadonlyMap<string, FormulaIdentity>,
  primaryHospitalId: string | undefined,
  extras: readonly ActivityDefinition[],
): CityVenueSeed => {
  const treatment = TREATMENTS[place.kind]
  const activityFields = place.kind === 'eatery'
    ? { cost: 700, effects: { hunger: 30, fun: 4 } }
    : place.kind === 'market' ? { xp: { hustle: 8 } } : {}
  const places: readonly CitySpotSeed[] = place.kind === 'hospital' && place.id === primaryHospitalId
    ? hospitalSpots()
    : [spot(treatment.spotId, treatment.spotLabel, activity(
      visitActivityId(cityId, place),
      activityLabelFor(place, identities, treatment.activityLabel),
      treatment.icon,
      [...treatment.tags],
      activityFields,
    ), ...extras), work()]
  return {
    id: place.id,
    name: place.name,
    district: unitName,
    kind: sceneKindFor(place.kind),
    category: treatment.category,
    icon: treatment.icon,
    point: { lon: place.lon, lat: place.lat },
    description: place.description,
    ambient: [],
    spots: places,
    ...(place.hours ? { hours: place.hours } : {}),
    note: `Sources: ${place.sourceIds.join(', ')}. Coordinate: ${place.coordinateSourceId} (${place.accuracy}).`,
  }
}

const houseShape = (tier: PopulationTier): { readonly grid: number; readonly rent: number } => {
  switch (tier) {
    case 'town': return { grid: 6, rent: 3_500 }
    case 'small-city': return { grid: 8, rent: 6_000 }
    case 'city': return { grid: 8, rent: 9_000 }
    case 'major-city': return { grid: 10, rent: 15_000 }
  }
}

const peopleFor = (cityId: string, places: readonly RealPlaceFact[]): readonly CityPersonSeed[] => places.flatMap((place, index): readonly CityPersonSeed[] => [
  { name: `${cityId} neighbour ${index * 2 + 1}`, role: `Visitor at ${place.name}`, quotes: [`I came to spend time at ${place.name}.`, 'Welcome. There is room for another neighbour here.'] },
  { name: `${cityId} neighbour ${index * 2 + 2}`, role: `Neighbour near ${place.name}`, quotes: [place.description, 'Hello. I am glad you stopped to talk.'] },
])

export function buildFormulaContent<City extends string>({ spec, origin, bounds, localUnitAnchors, scenes }: FormulaContentInput<City>): CityContent<City> {
  const unitNames = new Map(spec.localUnits.map(unit => [unit.id, unit.name]))
  const identities = identityIndex(spec)
  const roadHub = formulaRoadArrival(spec.places)
  const arrivalPark = formulaArrivalRecreation(spec.places)
  const firstMarket = spec.places.find(place => place.kind === 'market')
  const eatery = spec.places.find(place => place.kind === 'eatery') ?? firstMarket
  const primaryHospitalId = spec.places.find(place => place.kind === 'hospital')?.id
  if (!roadHub || !arrivalPark || !eatery) throw new TypeError(`${spec.id} is missing a road hub, arrival park or eatery`)
  const plate = spec.identity.foods[0]
  if (!plate) throw new TypeError(`${spec.id} needs a sourced local plate`)
  const unmapped = unmappedKindsOf(spec)
  const extras = new Map<string, ActivityDefinition[]>()
  const addExtra = (placeId: string, extra: ActivityDefinition): void => { extras.set(placeId, [...(extras.get(placeId) ?? []), extra]) }
  // Documented fallbacks for unmapped kinds: market food stalls stand in for an unmapped eatery,
  // and the arrival recreation venue carries the evening option when no garden or nightlife venue is sourced.
  if (eatery.kind !== 'eatery') {
    addExtra(eatery.id, activity(`${spec.id}-${eatery.id}-food`, `Eat ${plate.name} at a food stall`, 'food', ['food'], { cost: 700, effects: { hunger: 30, fun: 4 } }))
  }
  if (!spec.places.some(place => place.kind === 'garden' || place.kind === 'nightlife')) {
    addExtra(arrivalPark.id, activity(`${spec.id}-${arrivalPark.id}-evening`, 'Spend a quiet evening here', 'park', ['fun', 'nightlife']))
  }
  const orderedPlaces = [arrivalPark, ...spec.places.filter(place => place !== arrivalPark)]
  const venues = orderedPlaces.map(place => venueSeed(spec.id, unitNames.get(place.localUnitId) ?? place.localUnitId, place, identities, primaryHospitalId, extras.get(place.id) ?? []))
  const careers = formulaCareerPlan(spec.places)
  const unmappedServices: UnmappedService[] = [
    ...(eatery.kind !== 'eatery' && unmapped.has('eatery') ? ['food' as const] : []),
    ...(unmapped.has('polling') ? ['polling' as const] : []),
  ]
  const houses: readonly CityHouseSeed[] = spec.localUnits.map(unit => {
    const point = localUnitAnchors[unit.id]
    if (!point) throw new TypeError(`Missing geometry-derived home anchor for ${unit.id}`)
    const shape = houseShape(unit.populationTier)
    return { id: `${spec.id}-${unit.id}-home`, label: `${unit.name} home`, districtId: `${unit.id}-home`, district: unit.name, point, ...shape }
  })
  const tablePlaces = spec.places.filter(place => place.kind === 'market').map(market => ({
    id: `${spec.id}-${market.id}-table`, venueId: market.id, game: 'whot', label: `${market.name} table`, seats: 4,
  }))
  const knownFor = [...spec.identity.foods, ...spec.identity.crafts, ...spec.identity.industries].map(fact => fact.name)
  const markets = Object.fromEntries(spec.places.filter(place => place.kind === 'market').map(place => {
    const known = [...new Set((place.specialtyIds ?? []).flatMap(id => {
      const identity = identities.get(id)
      return identity ? [businessTypeFor(identity)] : []
    }))]
    return [place.id, Object.freeze({ known })]
  }))
  const localProductIds = [...new Set([
    'local-plate',
    ...[...spec.identity.foods, ...spec.identity.crafts, ...spec.identity.industries].flatMap(fact => fact.localProductId ? [fact.localProductId] : []),
  ])]
  return buildCityContent({
    cityId: spec.id,
    cityName: spec.name,
    origin,
    bounds,
    localUnitDescriptions: Object.fromEntries(spec.localUnits.map(unit => [unit.id, unit.description])),
    scenes,
    venues,
    people: peopleFor(spec.id, orderedPlaces),
    careerVenues: careers.venues,
    unavailableCareerIds: careers.unavailable,
    ...(unmappedServices.length ? { unmappedServices } : {}),
    careerSummaries: {},
    houses,
    events: [],
    firstFun: { venue: arrivalPark.id, spot: TREATMENTS[arrivalPark.kind].spotId, activity: visitActivityId(spec.id, arrivalPark), title: `Visit ${arrivalPark.name}`, hint: arrivalPark.description },
    buka: eatery.id,
    thingsToDo: spec.places.slice(0, 6).map(place => ({ venueId: place.id, name: place.name, line: place.description })),
    culture: { greeting: `Welcome to ${spec.name}`, food: spec.identity.foods.map(item => item.name), knownFor },
    localModes: FORMULA_LOCAL_MODES,
    radioVenueIds: spec.places.filter(place => place.kind === 'nightlife' || place.kind === 'garden').map(place => place.id),
    billboardRoads: [],
    tablePlaces,
    dreamWording: {},
    lotteryWording: {},
    unitLabel: spec.state.unit,
    wishPrefix: spec.id,
    homePalette: spec.homePalette,
    business: { plate: plate.name, markets, localProductIds },
  })
}
