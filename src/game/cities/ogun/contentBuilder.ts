import { JOBS } from '../../content/jobs.ts'
import { toLocal } from '../../../geo/frame.ts'
import type {
  ActivityDefinition, CalendarEvent, CitySceneVariant, CityContent, CityCultureCard, CityGuidePlace, CityVenueContent,
  DreamDefinition, HouseDefinition, JobDefinition, NpcDefinition, SceneKind, SpotDefinition,
  StarterGoal, TravelModeDefinition, VenueCategoryId, VenueDefinition, WishDefinition,
} from '../../../types/content.ts'
import type { DreamId, LotteryId } from '../../../types/life.ts'

export interface OgunPoint { readonly lon: number; readonly lat: number }
export interface OgunBounds { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
export interface OgunSpotSeed { readonly id: string; readonly label: string; readonly activities?: readonly ActivityDefinition[] }
export interface OgunVenueSeed {
  readonly id: string; readonly name: string; readonly district: string; readonly kind: SceneKind
  readonly category: VenueCategoryId | 'home'; readonly icon: string; readonly point: OgunPoint
  readonly description: string; readonly ambient: readonly string[]; readonly spots: readonly OgunSpotSeed[]
  readonly hours?: Readonly<{ open: number; close: number; days?: number[] }>
  readonly variant?: 'speakeasy' | 'church' | 'mosque' | CitySceneVariant; readonly beta?: boolean; readonly note?: string
}
export interface OgunPersonSeed { readonly name: string; readonly role: string; readonly quotes: readonly [string, string] }
export interface OgunHouseSeed {
  readonly id: string; readonly label: string; readonly districtId: string; readonly district: string
  readonly rent: number; readonly grid: number; readonly point: OgunPoint
}
export interface OgunContentSpec<City extends string> {
  readonly cityId: City; readonly cityName: string; readonly origin: Readonly<{ x: number; z: number }>; readonly bounds: OgunBounds
  readonly localUnitDescriptions: Readonly<Record<string, string>>
  readonly venues: readonly OgunVenueSeed[]; readonly people: readonly OgunPersonSeed[]
  readonly careerVenues: Readonly<Record<string, string>>; readonly careerSummaries: Readonly<Record<string, string>>
  readonly houses: readonly OgunHouseSeed[]; readonly events: readonly CalendarEvent[]
  readonly firstFun: Readonly<{ venue: string; spot: string; activity: string; title: string; hint: string }>
  readonly buka: string; readonly thingsToDo: readonly CityGuidePlace[]; readonly culture: CityCultureCard
  readonly localModes: readonly TravelModeDefinition[]; readonly radioVenueIds: readonly string[]
  readonly billboardRoads: CityContent<City>['billboardRoads']; readonly tablePlaces: CityContent<City>['tablePlaces']
  readonly dreamWording: Readonly<Partial<Record<DreamId, Partial<Pick<DreamDefinition, 'label' | 'goal' | 'measure'>>>>>
  readonly lotteryWording: Readonly<Partial<Record<LotteryId, { bullets: readonly string[] }>>>
}

export const activity = (id: string, label: string, icon: string, tags: string[], fields: Partial<ActivityDefinition> = {}): ActivityDefinition => ({
  id, label, icon, duration: 8, cost: 0, effects: { fun: 5 }, tags, beta: true, ...fields,
})
export const spot = (id: string, label: string, ...activities: ActivityDefinition[]): OgunSpotSeed => ({ id, label, activities })
export const work = (): OgunSpotSeed => ({ id: 'work', label: 'Staff area', activities: [] })
export function peopleFor(venues: readonly OgunVenueSeed[], names: readonly string[]): readonly OgunPersonSeed[] {
  if (names.length < venues.length * 2) throw new Error('Two distinct names are required for every public venue')
  return Object.freeze(venues.flatMap((venue, index) => [
    { name: names[index * 2]!, role: `${venue.name} guide`, quotes: [`Ẹ káàbọ̀. ${venue.description}`, `I help people find their way around ${venue.district}.`] as const },
    { name: names[index * 2 + 1]!, role: `${venue.name} regular`, quotes: [`I come to ${venue.name} often enough to know its rhythm.`, `Ask me what changes around ${venue.district} from morning to evening.`] as const },
  ]))
}

const homeSeed = (point: OgunPoint): OgunVenueSeed => ({
  id: 'home', name: 'Home', district: 'Your district', kind: 'home', category: 'home', icon: 'home', point,
  description: 'Rest, cook and arrange your home.', ambient: [], spots: [
    spot('kitchen', 'Kitchen', { id: 'garri', label: 'Eat Dry Garri', icon: '🥣', duration: 5, cost: 0, effects: { hunger: 20 }, tags: ['food'], beta: true }),
    spot('bathroom', 'Bathroom', { id: 'bath', label: 'Take a Bath', icon: '🛁', duration: 6, cost: 0, effects: { hygiene: 25 }, tags: ['hygiene'], beta: true }),
    spot('bedroom', 'Bedroom', { id: 'nap', label: 'Take a Nap', icon: '🛏️', duration: 15, cost: 0, effectsPerSecond: { energy: 2 }, tags: ['sleep'], beta: true }),
  ],
})

export const hospitalSpots = (): readonly OgunSpotSeed[] => [
  spot('clinic', 'Outpatient clinic',
    activity('hospital-doctor', 'See the Doctor', 'health', ['cure'], { duration: 8, cost: 1500, requiresIllness: true, effects: { energy: 6 } }),
    activity('health-checkup', 'Get a health check-up', 'health', ['checkup'], { duration: 8, cost: 500 })),
  spot('ward', 'Free clinic', activity('hospital-free', 'Queue at the Free Clinic', 'health', ['cure'], { duration: 45, cost: 0, requiresIllness: true, effects: {} })),
  work(),
]

function displayPoint(origin: Readonly<{ x: number; z: number }>, bounds: OgunBounds, point: OgunPoint): { x: number; y: number } {
  const [x, z] = toLocal(origin, point.lon, point.lat)
  return { x: Math.round(((x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100), y: Math.round(((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * 100) }
}

const goals = (spec: OgunContentSpec<string>): readonly StarterGoal[] => Object.freeze([
  { id: 'first-fun', title: spec.firstFun.title, hint: spec.firstFun.hint, icon: '✨', cash: 500, stars: 1, beta: true, done: { activity: spec.firstFun.activity }, go: [spec.firstFun.venue, spec.firstFun.spot], activity: spec.firstFun.activity },
  { id: 'say-hello', title: 'Say hello to someone', hint: 'Tap a person nearby', icon: '👋', cash: 500, stars: 1, beta: true, done: { events: ['npc.greeted', 'friend.made', 'relationship.changed'] }, open: 'people' },
  { id: 'settle-in', title: 'Settle in', hint: 'Choose your traits, dream and local government', icon: '🏠', cash: 1000, stars: 1, beta: true, done: { events: ['life.started'] }, open: 'onboarding' },
  { id: 'eat', title: 'Eat something', hint: 'Use your kitchen', icon: '🍲', cash: 500, stars: 1, done: { events: ['meal.eaten'], tags: ['food'] }, go: ['home', 'kitchen'] },
  { id: 'freshen-up', title: 'Freshen up', hint: 'Use your bathroom', icon: '🫧', cash: 500, stars: 1, done: { tags: ['hygiene'] }, go: ['home', 'bathroom'] },
  { id: 'get-a-job', title: 'Get a job', hint: 'Open Phone → Jobs', icon: '💼', cash: 1000, stars: 1, done: { events: ['job.applied'], hasJob: true }, open: 'jobs' },
  { id: 'buy-something', title: 'Buy something new', hint: 'Open Buy and place an item', icon: '🛋️', cash: 1000, stars: 1, done: { events: ['item.bought'] }, open: 'buy', go: ['home'] },
  { id: 'visit-buka', title: 'Visit a local kitchen', hint: 'Open Map and choose the food stop', icon: '🍛', cash: 1500, stars: 1, done: { venue: spec.buka }, open: 'map', params: { destination: spec.buka } },
  { id: 'make-a-friend', title: 'Make a new friend', hint: 'Tap someone at a venue', icon: '👋', cash: 1500, stars: 1, done: { events: ['npc.greeted', 'friend.made'], fresh: true }, open: 'people' },
  { id: 'work-a-shift', title: 'Work a shift', hint: 'Go to your workplace', icon: '⏰', cash: 2000, stars: 1, beta: true, done: { events: ['shift.completed'] }, workplace: true },
])

const wishes = (spec: OgunContentSpec<string>): readonly WishDefinition[] => Object.freeze([
  { id: 'earn-15k', label: 'Make ₦15,000 today', hint: 'Shifts and goal rewards count', icon: '💰', on: 'earn', amount: 15000 },
  { id: 'park-art', label: spec.firstFun.title, hint: spec.firstFun.hint, icon: '✨', on: 'activity', venue: spec.firstFun.venue, activity: spec.firstFun.activity, beta: true },
  { id: 'work-shift', label: 'Finish a shift', hint: 'Go to your workplace and work', icon: '💼', on: 'event', event: 'shift.completed', beta: true },
  { id: 'eat-out', label: 'Eat local food', hint: 'Visit the local kitchen', icon: '🍛', on: 'activity', venue: spec.buka, tags: ['food'], beta: true },
  { id: 'greet-three', label: 'Say hello to 3 people', hint: 'Tap people at any venue', icon: '👋', on: 'event', event: 'npc.greeted', count: 3, beta: true },
  { id: 'new-friend', label: 'Make a friend', hint: 'Keep talking to someone you like', icon: '🤝', on: 'event', event: 'friend.made', beta: true },
  ...spec.thingsToDo.slice(0, 4).map((place, index): WishDefinition => ({ id: `ogun-visit-${index}`, label: `Visit ${place.name}`, hint: place.line, icon: '📍', on: 'visit', venue: place.venueId, beta: true })),
])

export function buildOgunContent<City extends string>(spec: OgunContentSpec<City>): CityContent<City> {
  const seeds = [homeSeed(spec.houses[0]?.point ?? spec.venues[0]?.point ?? { lon: 0, lat: 0 }), ...spec.venues]
  const venues: readonly CityVenueContent<City>[] = Object.freeze(seeds.map((seed) => {
    const spots = Object.fromEntries(seed.spots.map((entry): [string, SpotDefinition] => [entry.id, { id: entry.id, label: entry.label, activities: [...(entry.activities ?? [])] }]))
    const definition: VenueDefinition = {
      id: seed.id, label: seed.name, district: seed.district, icon: seed.icon, category: seed.category,
      description: seed.description, zone: 'mainland', map: displayPoint(spec.origin, spec.bounds, seed.point), ambient: [...seed.ambient],
      scene: { kind: seed.kind, ...(seed.variant ? { variant: seed.variant } : {}) }, spots,
      ...(seed.hours ? { hours: { ...seed.hours } } : {}), ...(seed.beta ? { beta: true } : {}), ...(seed.note ? { note: seed.note } : {}),
    }
    return Object.freeze({ cityId: spec.cityId, id: seed.id, kind: seed.kind, name: seed.name, district: seed.district, position: { kind: 'lon-lat' as const, ...seed.point }, whatYouCanDo: seed.description, definition: Object.freeze(definition), spotWording: Object.freeze({}), activityWording: Object.freeze({}) })
  }))
  const publicVenues = venues.filter((venue) => venue.id !== 'home')
  if (spec.people.length !== publicVenues.length * 2) throw new Error(`${spec.cityId} requires two authored regulars at every public venue`)
  const regulars = Object.freeze(publicVenues.flatMap((venue, venueIndex) => spec.people.slice(venueIndex * 2, venueIndex * 2 + 2).map((person, personIndex) => {
    const id = `${spec.cityId}-${venue.id}-${personIndex + 1}`
    const definition: NpcDefinition = { id, venue: venue.id, name: person.name, role: person.role, emoji: personIndex ? 'neighbour' : 'person', quotes: [...person.quotes], at: null, beta: true }
    return Object.freeze({ cityId: spec.cityId, id, venueId: venue.id, definition: Object.freeze(definition) })
  })))
  const workplaces = Object.freeze(Object.values(JOBS).map((job) => {
    const venueId = spec.careerVenues[job.id], venue = venues.find((entry) => entry.id === venueId)
    if (!venueId || !venue) throw new Error(`${spec.cityId} missing workplace for ${job.id}`)
    const definition: JobDefinition = { ...job, summary: spec.careerSummaries[job.id] ?? `Build a ${job.label.toLowerCase()} career at ${venue.name}.`, workplace: { venue: venueId, spot: 'work' }, workplaceName: venue.name, shift: { ...job.shift, id: `${spec.cityId}-${job.id}-shift`, note: `${venue.name} beta workplace; shared career ladder and shift rules.` } }
    return Object.freeze({ careerId: job.id, venueId, definition: Object.freeze(definition) })
  }))
  const tech = workplaces.find((workplace) => workplace.careerId === 'tech')
  if (!tech) throw new Error(`${spec.cityId} requires a tech workplace for the startup dream`)
  const dreamWording = Object.freeze({
    ...spec.dreamWording,
    'lekki-landlord': { ...spec.dreamWording['lekki-landlord'], label: spec.dreamWording['lekki-landlord']?.label ?? `${spec.cityName} Landlord` },
    'yaba-unicorn': {
      ...spec.dreamWording['yaba-unicorn'], label: spec.dreamWording['yaba-unicorn']?.label ?? `${spec.cityName} Founder`, goal: `Get your startup funded at ${tech.definition.workplaceName}.`,
      measure: `Coding to level 8 is 60%, Hustle to level 5 is 20%, a first ${tech.definition.workplaceName} visit is 5%, and getting funded is the last 15%.`,
    },
  })
  const localHouse = `Choose any ${spec.cityName} local government and receive its free starter house`
  const lotteryWording = Object.freeze({
    'lapo-baby': { bullets: ['₦60,000 LAPO loan to start, repaid at ₦12,000 every week', 'Hustle starts at level 2', 'Learn every skill 25% faster', localHouse] },
    'civil-servant': { bullets: ['No loan: you start debt-free', 'Modest savings, less cash than a loan start', 'Charisma starts at level 1', localHouse] },
    'street-smart': { bullets: ['No loan, but very little cash', 'Hustle starts at level 3 and Fitness at level 2', 'Hunger and Energy drop 15% slower', localHouse] },
    ajebutter: { bullets: ['No loan and a large allowance', 'Charisma starts at level 2', 'Soft life: learn every skill 10% slower', `Easily bored: Fun drops 15% faster; ${localHouse.toLowerCase()}`] },
  })
  return Object.freeze({
    cityId: spec.cityId, localModes: spec.localModes, dreamWording, lotteryWording,
    localUnitDescriptions: spec.localUnitDescriptions, venues, regulars, workplaces, unavailableCareerIds: Object.freeze([]),
    housing: Object.freeze(spec.houses.map((house) => ({ districtId: house.districtId, position: house.point, definition: { id: house.id, label: house.label, district: house.district, grid: house.grid, rent: house.rent, moveIn: house.rent * 3, description: `A beta rental option in ${house.district}.`, betaFields: ['grid', 'rent', 'moveIn'] } satisfies HouseDefinition, spot: { district: house.district, zone: 'mainland' as const, map: displayPoint(spec.origin, spec.bounds, house.point) } }))),
    events: spec.events, starterGoals: goals(spec), wishes: wishes(spec), radioVenueIds: spec.radioVenueIds,
    billboardRoads: spec.billboardRoads, tablePlaces: spec.tablePlaces, thingsToDo: spec.thingsToDo, culture: spec.culture,
  })
}

export const OGUN_LOCAL_MODES: readonly TravelModeDefinition[] = Object.freeze([
  { id: 'trek', label: 'Trek', icon: '🚶', fare: 0, seconds: 13, needs: { energy: -10, hygiene: -7 }, xp: { fitness: 15 }, exposed: true, eventChance: 0.4, blurb: 'Free and best for short distances.', beta: true },
  { id: 'okada', label: 'Okada', icon: '🏍️', fare: 250, seconds: 5, needs: { hygiene: -3 }, exposed: true, eventChance: 0.15, blurb: 'Fast through local traffic, with no roof.', beta: true },
  { id: 'danfo', label: 'Bus', icon: '🚌', fare: 250, seconds: 9, needs: {}, eventChance: 0.2, blurb: 'A shared bus on the main routes.', beta: true },
  { id: 'cab', label: 'Taxi', icon: '🚕', fare: 450, seconds: 7, needs: { energy: 1 }, eventChance: 0.15, blurb: 'A direct ride across town.', beta: true },
])
