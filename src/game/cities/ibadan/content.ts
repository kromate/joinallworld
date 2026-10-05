import { LOTTERY } from '../../content/traits.ts'
import { JOBS } from '../../content/jobs.ts'
import { toLocal } from '../../../geo/frame.ts'
import { IBADAN_MAP_ORIGIN } from './rules.ts'
import type {
  ActivityDefinition, CalendarEvent, CityContent, CityVenueContent, HouseDefinition, JobDefinition,
  NpcDefinition, SceneKind, SpotDefinition, StarterGoal, TravelModeDefinition, VenueCategoryId, VenueDefinition, WishDefinition,
} from '../../../types/content.ts'

type Point = Readonly<{ lon: number; lat: number }>
type SpotSeed = Readonly<{ id: string; label: string; activities?: readonly ActivityDefinition[] }>
type VenueSeed = Readonly<{
  id: string
  name: string
  district: string
  kind: SceneKind
  category: VenueCategoryId | 'home'
  icon: string
  point: Point
  description: string
  ambient: readonly string[]
  spots: readonly SpotSeed[]
  hours?: Readonly<{ open: number; close: number; days?: number[] }>
  variant?: 'speakeasy' | 'church' | 'mosque'
  beta?: boolean
  note?: string
}>

const activity = (id: string, label: string, icon: string, tags: string[], fields: Partial<ActivityDefinition> = {}): ActivityDefinition => ({
  id, label, icon, duration: 8, cost: 0, effects: { fun: 5 }, tags, beta: true, ...fields,
})

const work = (): SpotSeed => ({ id: 'work', label: 'Staff area', activities: [] })
const spot = (id: string, label: string, ...activities: ActivityDefinition[]): SpotSeed => ({ id, label, activities })

const VENUE_SEEDS: readonly VenueSeed[] = [
  {
    id: 'home', name: 'Home', district: 'Your district', kind: 'home', category: 'home', icon: 'home', point: { lon: 3.9157404, lat: 7.4359015 },
    description: 'Rest, cook and arrange your home.', ambient: [], spots: [
      spot('kitchen', 'Kitchen', { id: 'garri', label: 'Eat Dry Garri', icon: '🥣', duration: 5, cost: 0, effects: { hunger: 20 }, tags: ['food'], beta: true, note: 'Free fallback food; no ingredients required.' }),
      spot('bathroom', 'Bathroom', { id: 'bath', label: 'Take a Bath', icon: '🛁', duration: 6, cost: 0, effects: { hygiene: 25 }, tags: ['hygiene'], beta: true }),
      spot('bedroom', 'Bedroom', { id: 'nap', label: 'Take a Nap', icon: '🛏️', duration: 15, cost: 0, effectsPerSecond: { energy: 2 }, tags: ['sleep'], beta: true }),
    ],
  },
  {
    id: 'ui-campus', name: 'University of Ibadan', district: 'UI, Ibadan North', kind: 'walk', category: 'fun', icon: 'school', point: { lon: 3.9068, lat: 7.4412 },
    description: 'Walk the visitor route, read by Trenchard Hall and spend time around the gardens.',
    ambient: ['Students cross the court between lectures.', 'The trees make the campus feel cooler than the road outside.'],
    spots: [spot('court', 'University Court', activity('ibadan-ui-walk', 'Walk the university court', 'walk', ['walk'], { xp: { fitness: 8 } })), work()],
    note: 'The playable visitor entry uses the published UI–Agbowo main-gate point. Trenchard Hall and the gardens remain separately sourced map overlays; this is not a full campus model.',
  },
  {
    id: 'polytechnic', name: 'The Polytechnic, Ibadan', district: 'Sango, Ibadan North', kind: 'office', category: 'work', icon: 'school', point: { lon: 3.8837345, lat: 7.4369114 },
    description: 'Visit the campus and join a practical workshop.', ambient: ['Project boards lean against the workshop walls.'],
    spots: [spot('quad', 'Main campus', activity('ibadan-poly-workshop', 'Join a practical workshop', 'tools', ['learn'], { xp: { coding: 8 } })), work()],
  },
  {
    id: 'lead-city', name: 'Lead City University', district: 'Toll Gate, Oluyole', kind: 'office', category: 'work', icon: 'school', point: { lon: 3.87577, lat: 7.32637 },
    description: 'Attend a digital-skills session and meet people building local projects.', ambient: ['A group compares notes outside the lecture rooms.'],
    spots: [spot('lab', 'Digital lab', activity('ibadan-code-session', 'Join a coding session', 'code', ['learn'], { xp: { coding: 15 } })), work()],
  },
  {
    id: 'uch', name: 'University College Hospital', district: 'Agodi, Ibadan North', kind: 'hospital', category: 'care', icon: 'health', point: { lon: 3.9037086, lat: 7.4028275 },
    description: 'Get a check-up at Ibadan’s teaching hospital.', ambient: ['Staff move between the wards and clinics.'], hours: { open: 0, close: 24 },
    spots: [
      spot('clinic', 'Outpatient clinic',
        activity('hospital-doctor', 'See the Doctor', 'health', ['cure'], { duration: 8, cost: 1500, requiresIllness: true, effects: { energy: 6 } }),
        activity('ibadan-checkup', 'Get a health check-up', 'health', ['checkup'], { duration: 8, cost: 500 }),
      ),
      spot('ward', 'Free clinic', activity('hospital-free', 'Queue at the Free Clinic', 'health', ['cure'], { duration: 45, cost: 0, requiresIllness: true, effects: {} })),
      work(),
    ],
  },
  {
    id: 'cocoa-house', name: 'Cocoa House', district: 'Dugbe, Ibadan North-West', kind: 'office', category: 'work', icon: 'office', point: { lon: 3.8788769, lat: 7.3880524 },
    description: 'Visit the Dugbe landmark and work above the commercial district.', ambient: ['Dugbe traffic threads around the tower below.'],
    spots: [spot('lobby', 'Ground-floor lobby', activity('ibadan-cocoa-history', 'Read the cocoa-trade display', 'book', ['art', 'learn'], { xp: { charisma: 6 } })), work()],
  },
  {
    id: 'mapo-hall', name: 'Mapo Hall', district: 'Mapo, Ibadan South-East', kind: 'statehouse', category: 'civic', icon: 'governor', point: { lon: 3.8969774, lat: 7.3759998 },
    description: 'Visit the civic hall, read notices and look across the old city.', ambient: ['The broad steps face the old city.'],
    spots: [spot('steps', 'Mapo steps', activity('ibadan-mapo-view', 'Look across old Ibadan', 'view', ['view', 'history'], { effects: { fun: 7, social: 2 } })), work()],
  },
  {
    id: 'mapo-polling', name: 'Mapo Civic Polling Centre', district: 'Mapo, Ibadan South-East', kind: 'polling', category: 'civic', icon: 'poll', point: { lon: 3.89706, lat: 7.37586 },
    description: 'Register, vote and follow the local count during an election.', ambient: ['Officials check the register at the civic desk.'], beta: true,
    spots: [spot('officials', 'Election officials', activity('ibadan-voter-info', 'Read the voter information', 'poll', ['civic'], { effects: { social: 2 } }))],
    note: 'Beta gameplay polling centre co-located with the mapped Mapo civic complex; it is not presented as a permanent electoral office.',
  },
  {
    id: 'agodi-gardens', name: 'Agodi Gardens', district: 'Agodi, Ibadan North', kind: 'park', category: 'fun', icon: 'park', point: { lon: 3.8982644, lat: 7.4093254 },
    description: 'Walk under the trees, play ayo and stay for an evening garden set.', ambient: ['Families spread out under the trees.'],
    spots: [spot('garden', 'Garden lawn',
      activity('ibadan-play-ayo', 'Play a round of ayo', 'tables', ['fun'], { duration: 7 }),
      activity('ibadan-garden-evening', 'Listen to an evening garden set', 'music', ['music', 'nightlife'], { hours: { open: 18, close: 23 }, xp: { music: 8 } }),
    ), work()],
  },
  {
    id: 'bowers-tower', name: 'Bower’s Tower', district: 'Oke Aare, Ibadan North', kind: 'park', category: 'fun', icon: 'view', point: { lon: 3.896598, lat: 7.392036 },
    description: 'Climb for a view over the seven hills and the brown-roof skyline.', ambient: ['The city spreads in every direction below the hill.'],
    spots: [spot('top', 'Tower viewpoint', activity('ibadan-tower-view', 'Take in the seven hills', 'view', ['view', 'photography'], { xp: { photography: 15 }, effects: { fun: 10 } })), work()],
  },
  {
    id: 'bodija-market', name: 'Bodija Market', district: 'Bodija, Ibadan North', kind: 'market', category: 'food', icon: 'market', point: { lon: 3.9157404, lat: 7.4359015 },
    description: 'Price foodstuffs, greet traders and buy ingredients.', ambient: ['Sellers call out today’s prices over the market noise.'],
    spots: [spot('aisle', 'Foodstuff aisle', activity('ibadan-bodija-price', 'Price the market', 'groceries', ['market'], { xp: { hustle: 8 } })), work()],
  },
  {
    id: 'dugbe-market', name: 'Dugbe Market', district: 'Dugbe, Ibadan North-West', kind: 'market', category: 'work', icon: 'market', point: { lon: 3.88040447, lat: 7.3870279 },
    description: 'Browse the commercial heart of Dugbe and bargain for household goods.', ambient: ['Buses, traders and office workers share the same crowded streets.'],
    spots: [spot('arcade', 'Market arcade', activity('ibadan-dugbe-bargain', 'Bargain for household goods', 'shop', ['market'], { xp: { hustle: 10 } })), work()],
  },
  {
    id: 'gbagi-market', name: 'Gbagi New International Market', district: 'Gbagi, Egbeda', kind: 'market', category: 'work', icon: 'market', point: { lon: 3.9558975, lat: 7.39337 },
    description: 'Walk the large market, compare cloth and talk with wholesalers.', ambient: ['Bolts of cloth and cartons fill the long rows.'],
    spots: [spot('cloth', 'Cloth row', activity('ibadan-gbagi-cloth', 'Compare cloth', 'fabric', ['market', 'fashion'], { xp: { hustle: 8 } })), work()],
  },
  {
    id: 'dugbe-amala', name: 'Dugbe Amala Joint', district: 'Dugbe, Ibadan North-West', kind: 'buka', category: 'food', icon: 'food', point: { lon: 3.88062, lat: 7.38716 },
    description: 'Order amala with gbegiri and ewedu at a busy local joint.', ambient: ['The server asks how much stew you want.'], beta: true,
    spots: [spot('counter', 'Food counter', activity('ibadan-amala-plate', 'Eat amala, gbegiri and ewedu', 'food', ['food'], { duration: 10, cost: 1200, effects: { hunger: 35, fun: 4 } })), work()],
    note: 'Fictional beta food counter placed inside the verified Dugbe Market area; no private business identity is claimed.',
  },
  {
    id: 'lekan-salami-stadium', name: 'Lekan Salami Stadium', district: 'Adamasingba, Ibadan North-West', kind: 'viewing', category: 'fun', icon: 'ball', point: { lon: 3.8853064, lat: 7.3963017 },
    description: 'Train, watch a match and argue over the final whistle.', ambient: ['Supporters gather around the entrances.'],
    spots: [spot('stand', 'Main stand', activity('ibadan-match-view', 'Watch the match', 'ball', ['sport'], { effects: { fun: 12, social: 5 } })), work()],
  },
  {
    id: 'national-museum', name: 'National Museum of Unity', district: 'Alesinloye, Ibadan South-West', kind: 'walk', category: 'fun', icon: 'museum', point: { lon: 3.868776, lat: 7.384937 },
    description: 'See ethnographic collections from communities across Nigeria.', ambient: ['Visitors slow down beside the carved and woven objects.'],
    spots: [spot('gallery', 'Unity gallery', activity('ibadan-museum-tour', 'Tour the collection', 'art', ['art', 'history'], { xp: { photography: 8 } })), work()],
  },
  {
    id: 'iita-forest', name: 'IITA Forest Reserve', district: 'Moniya, Akinyele', kind: 'walk', category: 'fun', icon: 'forest', point: { lon: 3.8875769, lat: 7.4951861 },
    description: 'Take a guided forest walk at the research campus.', ambient: ['Bird calls carry across the forest trail.'],
    spots: [spot('trail', 'Forest trail', activity('ibadan-forest-walk', 'Walk the forest trail', 'walk', ['walk', 'nature'], { duration: 15, xp: { fitness: 12 }, effects: { fun: 10 } })), work()],
  },
  {
    id: 'eleyele-lake', name: 'Eleyele Reservoir', district: 'Eleyele, Ido', kind: 'park', category: 'fun', icon: 'water', point: { lon: 3.8687741, lat: 7.4333509 },
    description: 'Sit by the reservoir and watch the water and birds.', ambient: ['The reservoir opens out beyond the city streets.'],
    spots: [spot('shore', 'Reservoir edge', activity('ibadan-eleyele-watch', 'Watch birds by the water', 'view', ['nature'], { xp: { photography: 8 }, effects: { fun: 8 } }))],
  },
  {
    id: 'ui-chapel', name: 'Chapel of the Resurrection', district: 'UI, Ibadan North', kind: 'worship', category: 'civic', icon: 'worship', point: { lon: 3.899173, lat: 7.447812 }, variant: 'church',
    description: 'Attend a service in the university chapel.', ambient: ['The chapel doors open onto the campus road.'],
    spots: [spot('hall', 'Chapel hall', activity('ibadan-chapel-reflect', 'Sit quietly in the chapel', 'worship', ['worship'], { effects: { social: 3, fun: 3 } }))],
  },
  {
    id: 'ui-mosque', name: 'University of Ibadan Central Mosque', district: 'UI, Ibadan North', kind: 'worship', category: 'civic', icon: 'worship', point: { lon: 3.89843, lat: 7.447241 }, variant: 'mosque',
    description: 'Visit the university mosque and join the community at prayer time.', ambient: ['People arrive along Benue Road.'],
    spots: [spot('hall', 'Prayer hall', activity('ibadan-mosque-reflect', 'Sit quietly in the mosque', 'worship', ['worship'], { effects: { social: 3, fun: 3 } }))],
  },
  {
    id: 'mokola-salon', name: 'Mokola Salon', district: 'Mokola, Ibadan North', kind: 'salon', category: 'care', icon: 'hair', point: { lon: 3.8902, lat: 7.4006 },
    description: 'Get a trim or braid and catch up on neighbourhood news.', ambient: ['The radio and the clippers compete for attention.'], beta: true,
    spots: [spot('chair', 'Styling chair', activity('ibadan-salon-visit', 'Get a fresh style', 'hair', ['care'], { duration: 12, cost: 1800, effects: { hygiene: 8, fun: 4 } })), work()],
    note: 'Fictional beta salon placed at the published Mokola commercial sampling point; no private business identity is claimed.',
  },
  {
    id: 'iwo-road-interchange', name: 'Iwo Road Interchange', district: 'Iwo Road, Egbeda', kind: 'hub', category: 'civic', icon: 'bus', point: { lon: 3.9444816, lat: 7.40288 },
    description: 'Catch an intercity bus or change to a local route.', ambient: ['Micra taxis and buses keep moving through the junction.'],
    spots: [spot('platform', 'Bus platform', activity('ibadan-hub-wait', 'Wait for your bus', 'bus', ['travel'], { duration: 4, effects: { social: 1 } }))],
  },
  {
    id: 'challenge-interchange', name: 'Orita Challenge Interchange', district: 'Challenge, Oluyole', kind: 'hub', category: 'civic', icon: 'bus', point: { lon: 3.8700195, lat: 7.3378698 },
    description: 'Change buses at the southern entrance to the city.', ambient: ['Conductors call routes over the traffic.'],
    spots: [spot('platform', 'Bus stop', activity('ibadan-challenge-wait', 'Wait for a local bus', 'bus', ['travel'], { duration: 4 }))],
  },
  {
    id: 'moniya-station', name: 'Obafemi Awolowo Station', district: 'Moniya, Akinyele', kind: 'hub', category: 'civic', icon: 'train', point: { lon: 3.896621, lat: 7.559368 },
    description: 'Board the Lagos–Ibadan train at Moniya.', ambient: ['Passengers gather under the high station roof.'],
    spots: [spot('platform', 'Rail platform', activity('ibadan-station-wait', 'Wait on the platform', 'train', ['travel'], { duration: 4 }))],
  },
  {
    id: 'ibadan-airport', name: 'Ibadan Airport', district: 'Alakia, Egbeda', kind: 'airport', category: 'civic', icon: 'plane', point: { lon: 3.9794357, lat: 7.3637424 },
    description: 'Use the city airport and watch aircraft from the terminal.', ambient: ['Announcements carry across the small terminal.'],
    spots: [spot('terminal', 'Terminal', activity('ibadan-airport-wait', 'Wait in the terminal', 'plane', ['travel'], { duration: 4 }))],
  },
] as const

const PLAY_BOUNDS = Object.freeze({ minX: -427.58440230211, maxX: 247.62636384027246, minZ: -329.2219180289585, maxZ: 333.7231503233643 })
/** Legacy percent display adapter derived from the generated Ibadan play-area bounds in the shared frame. */
const displayPoint = ({ lon, lat }: Point): { x: number; y: number } => {
  const [x, z] = toLocal(IBADAN_MAP_ORIGIN, lon, lat)
  return {
    x: Math.round(((x - PLAY_BOUNDS.minX) / (PLAY_BOUNDS.maxX - PLAY_BOUNDS.minX)) * 100),
    y: Math.round(((z - PLAY_BOUNDS.minZ) / (PLAY_BOUNDS.maxZ - PLAY_BOUNDS.minZ)) * 100),
  }
}

const makeVenue = (seed: VenueSeed): CityVenueContent<'ibadan'> => {
  const spots = Object.fromEntries(seed.spots.map((entry): [string, SpotDefinition] => [entry.id, {
    id: entry.id, label: entry.label, activities: [...(entry.activities ?? [])],
  }]))
  const definition: VenueDefinition = {
    id: seed.id, label: seed.name, district: seed.district, icon: seed.icon, category: seed.category,
    description: seed.description, zone: 'mainland', map: displayPoint(seed.point), ambient: [...seed.ambient],
    scene: { kind: seed.kind, ...(seed.variant ? { variant: seed.variant } : {}) }, spots,
    ...(seed.hours ? { hours: { ...seed.hours } } : {}), ...(seed.beta ? { beta: true } : {}), ...(seed.note ? { note: seed.note } : {}),
  }
  return Object.freeze({
    cityId: 'ibadan', id: seed.id, kind: seed.kind, name: seed.name, district: seed.district,
    position: { kind: 'lon-lat' as const, ...seed.point }, ...(seed.hours ? { hours: { ...seed.hours } } : {}),
    whatYouCanDo: seed.description, definition: Object.freeze(definition), spotWording: Object.freeze({}), activityWording: Object.freeze({}),
  })
}

const venues = Object.freeze(VENUE_SEEDS.map(makeVenue))

const PEOPLE = [
  ['Aderonke Adeyemi', 'Postgraduate student'], ['Kunle Akinyemi', 'Campus guide'],
  ['Bimpe Oladipo', 'Engineering student'], ['Seyi Adediran', 'Workshop technologist'],
  ['Tola Adebayo', 'Software student'], ['Wale Oyewole', 'Project mentor'],
  ['Ronke Ogunleye', 'Ward nurse'], ['Femi Lawal', 'Patient liaison'],
  ['Kemi Afolayan', 'Office administrator'], ['Yinka Ojo', 'Account officer'],
  ['Temitope Salami', 'Civic guide'], ['Muyiwa Ajayi', 'Photographer'],
  ['Bisola Adekunle', 'Election observer'], ['Dapo Olawale', 'Registration officer'],
  ['Yetunde Akinola', 'Tour guide'], ['Gboyega Olatunji', 'History teacher'],
  ['Funmi Adegoke', 'Garden keeper'], ['Segun Awolowo', 'Ayo player'],
  ['Modupe Oyekan', 'Produce trader'], ['Akeem Alabi', 'Yam seller'],
  ['Kikelomo Falana', 'Cloth trader'], ['Folarin Akande', 'Shopkeeper'],
  ['Morounkeji Bakare', 'Textile wholesaler'], ['Tunde Babalola', 'Market porter'],
  ['Abiola Olaniyan', 'Food server'], ['Lanre Amoo', 'Lunch regular'],
  ['Nike Adesina', 'Supporters-club member'], ['Rotimi Ogundipe', 'Youth coach'],
  ['Peju Oladele', 'Museum educator'], ['Dele Oyeniyi', 'Artist'],
  ['Doyin Adepoju', 'Forest guide'], ['Bayo Olusola', 'Bird watcher'],
  ['Titilayo Aremu', 'Lakeside visitor'], ['Jide Arowolo', 'Fisher'],
  ['Bukola Olumide', 'Choir member'], ['Leke Fashola', 'University librarian'],
  ['Rukayat Yusuf', 'Student volunteer'], ['Kazeem Bello', 'Lecturer'],
  ['Sade Balogun', 'Hair stylist'], ['Taiwo Ojo', 'Neighbourhood customer'],
  ['Olamide Abiodun', 'Micra driver'], ['Rasheed Ismail', 'Bus dispatcher'],
  ['Dupe Oladimeji', 'Market commuter'], ['Sunday Akinpelu', 'Route marshal'],
  ['Adeola Adesokan', 'Rail passenger'], ['Lukman Adewale', 'Station attendant'],
  ['Morenike Akinfenwa', 'Traveller'], ['Kayode Olabisi', 'Ground staff'],
] as const

const VENUE_QUOTES: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  'ui-campus': ['Trenchard Hall is inside the old university court; the trees make the walk worth taking.', 'Students call UI the first and the best, but everybody still checks the noticeboard.'],
  polytechnic: ['Practical work is the point here; a clean drawing is only the beginning.', 'Sango is busy outside, so people finish their workshop gist before they leave.'],
  'lead-city': ['The main campus is down by Toll Gate, off the expressway.', 'The lab stays lively when project deadlines are close.'],
  uch: ['Take a number first; the free clinic costs time, not money.', 'People come to UCH from far beyond Ibadan, so the corridors never stay quiet.'],
  'cocoa-house': ['Cocoa House still tells the story of what farmers built in the old Western Region.', 'From Dugbe you can watch the commercial city moving below.'],
  'mapo-hall': ['Mapo steps are a good place to begin understanding the old city.', 'Look towards Oja’ba and you can read several layers of Ibadan history at once.'],
  'mapo-polling': ['Check your name carefully before you join the queue.', 'The count matters as much as the vote, so people stay and watch.'],
  'bowers-tower': ['The view explains the brown-roof description better than any postcard.', 'Oke Aare gives you a wide look across the hills when the air is clear.'],
  'agodi-gardens': ['Bring an ayo board in the afternoon and stay when the music begins.', 'Agodi is where families, old friends and first dates all find their own corner.'],
  'bodija-market': ['Ask the price twice; Bodija traders expect a proper conversation.', 'Foodstuff arrives early, and the best choices move before noon.'],
  'dugbe-market': ['Dugbe mixes offices, buses and market stalls in the same few streets.', 'Hold your list tightly; one bargain usually leads to another.'],
  'gbagi-market': ['The cloth rows can take a whole morning if you compare properly.', 'Wholesalers here know which colours are moving before the rest of town does.'],
  'dugbe-amala': ['Amala wants gbegiri and ewedu together; say how much stew you want.', 'Ẹ jẹun—eat well before you hurry back into Dugbe traffic.'],
  'lekan-salami-stadium': ['Adamasingba gets louder long before the whistle.', 'Everybody in the stand becomes a coach once the match starts.'],
  'national-museum': ['The Unity gallery brings objects from different Nigerian communities into one conversation.', 'Slow down at the textiles and carved pieces; the details carry the story.'],
  'iita-forest': ['Keep to the guided trail; this is a research reserve, not a city park.', 'The bird calls change as you move away from the campus buildings.'],
  'eleyele-lake': ['The reservoir feels quietest before the city fully wakes.', 'Watch the waterline and you will usually notice birds before boats.'],
  'ui-chapel': ['The chapel is part of the university’s everyday life as well as its ceremonies.', 'People come in from Chapel Road and stay a little after the service.'],
  'ui-mosque': ['The mosque has served the university community since the early years of the campus.', 'Benue Road grows busier around prayer time.'],
  'mokola-salon': ['The chair is where neighbourhood news arrives before the radio catches up.', 'A patient braid and a clean parting cannot be rushed.'],
  'iwo-road-interchange': ['Ask the conductor where the bus terminates before you enter.', 'Iwo Road is an entrance to Ibadan and a meeting point for routes across town.'],
  'challenge-interchange': ['Challenge links the southern neighbourhoods with the old city and the expressway.', 'Micra drivers know the next connection even when the signboard does not.'],
  'moniya-station': ['Keep your ticket ready before you reach the platform.', 'The train reaches Lagos from here without following the expressway traffic.'],
  'ibadan-airport': ['The terminal is small enough that regular travellers recognise the staff.', 'Check the board before you settle in; schedules can change.'],
})

const publicVenues = venues.filter((venue) => venue.id !== 'home')
if (PEOPLE.length !== publicVenues.length * 2) throw new Error('Ibadan requires two authored regulars at every public venue')

const regulars = Object.freeze(publicVenues.flatMap((venue, venueIndex) => PEOPLE.slice(venueIndex * 2, venueIndex * 2 + 2).map(([name, role], personIndex) => {
  const id = `ibadan-${venue.id}-${personIndex + 1}`
  const definition: NpcDefinition = {
    id, venue: venue.id, name, role, emoji: personIndex === 0 ? 'person' : 'neighbour', at: null, beta: true,
    quotes: [
      VENUE_QUOTES[venue.id]?.[personIndex] ?? `Ẹ káàbọ̀. ${venue.name} is part of my usual route.`,
      personIndex === 0 ? `I work here as the ${role.toLowerCase()}; ask me where to begin.` : `As the ${role.toLowerCase()}, I hear a different side of ${venue.district} every day.`,
    ],
  }
  return Object.freeze({ cityId: 'ibadan' as const, id, venueId: venue.id, definition: Object.freeze(definition) })
})))

const CAREER_VENUES: Readonly<Record<string, string>> = Object.freeze({
  'community-helper': 'mapo-hall', tech: 'lead-city', banking: 'cocoa-house', music: 'agodi-gardens', trading: 'gbagi-market',
  nursing: 'uch', hair: 'mokola-salon', chef: 'dugbe-amala', dj: 'agodi-gardens', fitness: 'lekan-salami-stadium',
  creator: 'bowers-tower', teaching: 'ui-campus', event: 'mapo-hall', football: 'lekan-salami-stadium', retail: 'dugbe-market',
})

const CAREER_SUMMARIES: Readonly<Record<string, string>> = Object.freeze({
  'community-helper': 'Help visitors and residents at Mapo Hall’s community desk.',
  tech: 'Build and support local software projects from the Lead City digital lab.',
  banking: 'Serve Dugbe customers and grow through the banking ladder at Cocoa House.',
  music: 'Perform at Agodi garden evenings and build a music career from the live set.',
  trading: 'Learn the wholesale trade in Gbagi’s long market rows.',
  nursing: 'Work the wards and clinics at University College Hospital.',
  hair: 'Grow from salon assistant to owner through steady work in Mokola.',
  chef: 'Master the Dugbe amala counter and rise through the kitchen.',
  dj: 'Keep the Agodi evening set moving and learn what the crowd wants.',
  fitness: 'Train and coach at Lekan Salami Stadium in Adamasingba.',
  creator: 'Photograph Ibadan’s skyline and landmarks from Bower’s Tower.',
  teaching: 'Teach and mentor learners on the University of Ibadan visitor grounds.',
  event: 'Plan civic and cultural events around Mapo Hall.',
  football: 'Work match days and build a sports-presenting career at the stadium.',
  retail: 'Serve shoppers and manage stock in the Dugbe commercial district.',
})

const workplaces = Object.freeze(Object.values(JOBS).map((job) => {
  const venueId = CAREER_VENUES[job.id]
  if (!venueId) throw new Error(`Missing Ibadan workplace for ${job.id}`)
  const place = venues.find((venue) => venue.id === venueId)
  if (!place) throw new Error(`Missing Ibadan venue ${venueId}`)
  const definition: JobDefinition = {
    ...job,
    summary: CAREER_SUMMARIES[job.id] ?? job.summary,
    workplace: { venue: venueId, spot: 'work' },
    workplaceName: place.name,
    shift: { ...job.shift, id: `ibadan-${job.id}-shift`, note: 'Ibadan beta workplace; shared career ladder and shift rules.' },
  }
  return Object.freeze({ careerId: job.id, venueId, definition: Object.freeze(definition) })
}))

const house = (id: string, label: string, districtId: string, district: string, rent: number, grid: number, lon: number, lat: number): { districtId: string; position: { lon: number; lat: number }; definition: HouseDefinition; spot: { district: string; zone: 'mainland'; map: { x: number; y: number } } } => ({
  districtId,
  position: { lon, lat },
  definition: { id, label, district, grid, rent, moveIn: rent * 3, description: `A beta rental option in ${district}.`, betaFields: ['grid', 'rent', 'moveIn'] },
  spot: { district, zone: 'mainland', map: displayPoint({ lon, lat }) },
})

const events: readonly CalendarEvent[] = Object.freeze([
  { id: 'ibadan-garden-evening', title: 'Garden music evening', blurb: 'A relaxed evening set under the trees.', venue: 'agodi-gardens', icon: 'music', when: { weekday: 5, from: 18, to: 22 } },
  { id: 'ibadan-market-morning', title: 'Bodija market morning', blurb: 'Foodstuff rows are at their busiest.', venue: 'bodija-market', icon: 'groceries', when: { weekday: 6, from: 7, to: 12 } },
  { id: 'ibadan-match-day', title: 'Match day at Adamasingba', blurb: 'Supporters fill the stands.', venue: 'lekan-salami-stadium', icon: 'ball', when: { weekday: 0, from: 15, to: 19 }, table: 'penalty' },
  { id: 'ibadan-whot-evening', title: 'Whot evening', blurb: 'Settle around the card tables at Agodi.', venue: 'agodi-gardens', icon: 'tables', when: { weekday: 3, from: 17, to: 20 }, table: 'whot' },
  { id: 'ibadan-mapo-culture', title: 'Mapo culture afternoon', blurb: 'Stories, drumming and the old-city view.', venue: 'mapo-hall', icon: 'star', when: { weekday: 6, from: 14, to: 18 }, spray: true },
])

const localModes: readonly TravelModeDefinition[] = Object.freeze([
  { id: 'trek', label: 'Trek', icon: '🚶', fare: 0, seconds: 13, needs: { energy: -10, hygiene: -7 }, xp: { fitness: 15 }, exposed: true, eventChance: 0.45, blurb: 'Free, slow and best for short distances.', beta: true },
  { id: 'okada', label: 'Okada', icon: '🏍️', fare: 250, seconds: 5, needs: { hygiene: -3 }, exposed: true, eventChance: 0.15, blurb: 'Fast through traffic, with no roof.', beta: true },
  { id: 'danfo', label: 'Bus', icon: '🚌', fare: 200, seconds: 9, needs: {}, eventChance: 0.2, blurb: 'A shared local bus on the main routes.', beta: true },
  { id: 'cab', label: 'Micra taxi', icon: '🚕', fare: 350, seconds: 7, needs: { energy: 1 }, eventChance: 0.18, blurb: 'The small shared cabs associated with everyday Ibadan travel.', beta: true },
])

export const IBADAN_CONTENT: CityContent<'ibadan'> = Object.freeze({
  cityId: 'ibadan',
  dreamWording: {
    'lekki-landlord': { label: 'Ibadan Landlord' },
    'yaba-unicorn': {
      label: 'Ibadan Founder',
      goal: 'Get your startup funded at Lead City University.',
      measure: 'Coding to level 8 is 60%, Hustle to level 5 is 20%, a first Lead City University visit 5%, and getting funded the last 15%.',
    },
  },
  lotteryWording: Object.fromEntries(Object.values(LOTTERY).map(outcome => [outcome.id, {
    bullets: [...outcome.bullets.filter(line => !line.startsWith('Start in ') && line !== 'Any of the three homes is open to you'), 'Choose any Ibadan local government for your free starter house.'],
  }])),
  localModes,
  venues,
  regulars,
  workplaces,
  unavailableCareerIds: Object.freeze([]),
  housing: Object.freeze([
    house('ibadan-mokola-room', 'Single room', 'mokola', 'Mokola', 2600, 6, 3.8902, 7.4006),
    house('ibadan-bodija-flat', 'Self-contain', 'bodija', 'Bodija', 5500, 8, 3.9157404, 7.4359015),
    house('ibadan-dugbe-flat', 'One-bedroom flat', 'dugbe', 'Dugbe', 14000, 9, 3.88040447, 7.3870279),
    house('ibadan-ring-road-flat', 'Two-bedroom flat', 'ring-road', 'Ring Road', 28000, 10, 3.8586542, 7.3755249),
    house('ibadan-akobo-house', 'Detached house', 'akobo', 'Akobo', 65000, 12, 3.948, 7.449),
  ]),
  events,
  starterGoals: Object.freeze([
    { id: 'first-fun', title: 'Play a round of ayo', hint: 'Agodi Gardens · takes 7 seconds', icon: '🎲', cash: 500, stars: 1, beta: true, done: { activity: 'ibadan-play-ayo' }, go: ['agodi-gardens', 'garden'], activity: 'ibadan-play-ayo' },
    { id: 'say-hello', title: 'Say hello to someone', hint: 'Tap a person nearby', icon: '👋', cash: 500, stars: 1, beta: true, done: { events: ['npc.greeted', 'friend.made', 'relationship.changed'] }, open: 'people' },
    { id: 'settle-in', title: 'Settle in', hint: 'Choose your traits, dream and local government', icon: '🏠', cash: 1000, stars: 1, beta: true, done: { events: ['life.started'] }, open: 'onboarding' },
    { id: 'eat', title: 'Eat something', hint: 'Use your kitchen', icon: '🍲', cash: 500, stars: 1, done: { events: ['meal.eaten'], tags: ['food'] }, go: ['home', 'kitchen'] },
    { id: 'freshen-up', title: 'Freshen up', hint: 'Use your bathroom', icon: '🫧', cash: 500, stars: 1, done: { tags: ['hygiene'] }, go: ['home', 'bathroom'] },
    { id: 'get-a-job', title: 'Get a job', hint: 'Open Phone → Jobs', icon: '💼', cash: 1000, stars: 1, done: { events: ['job.applied'], hasJob: true }, open: 'jobs' },
    { id: 'buy-something', title: 'Buy something new', hint: 'Open Buy and place an item', icon: '🛋️', cash: 1000, stars: 1, done: { events: ['item.bought'] }, open: 'buy', go: ['home'] },
    { id: 'visit-buka', title: 'Visit an amala joint', hint: 'Open Map → Dugbe Amala Joint', icon: '🍛', cash: 1500, stars: 1, done: { venue: 'dugbe-amala' }, open: 'map', params: { destination: 'dugbe-amala' } },
    { id: 'make-a-friend', title: 'Make a new friend', hint: 'Tap someone at a venue', icon: '👋', cash: 1500, stars: 1, done: { events: ['npc.greeted', 'friend.made'], fresh: true }, open: 'people' },
    { id: 'work-a-shift', title: 'Work a shift', hint: 'Go to your workplace', icon: '⏰', cash: 2000, stars: 1, beta: true, done: { events: ['shift.completed'] }, workplace: true },
  ] satisfies StarterGoal[]),
  wishes: Object.freeze([
    { id: 'earn-15k', label: 'Make ₦15,000 today', hint: 'Shifts and goal rewards count', icon: '💰', on: 'earn', amount: 15000 },
    { id: 'park-art', label: 'See the city from Mapo', hint: 'Visit the Mapo steps', icon: '🏛️', on: 'activity', venue: 'mapo-hall', activity: 'ibadan-mapo-view', beta: true },
    { id: 'palms-movie', label: 'Tour the museum', hint: 'Visit the Unity gallery', icon: '🏺', on: 'activity', venue: 'national-museum', activity: 'ibadan-museum-tour', beta: true },
    { id: 'work-shift', label: 'Finish a shift', hint: 'Go to your workplace and work', icon: '💼', on: 'event', event: 'shift.completed', beta: true },
    { id: 'park-chill', label: 'Spend time at Agodi', hint: 'Play ayo or listen to music', icon: '🌳', on: 'visit', venue: 'agodi-gardens', beta: true },
    { id: 'eat-out', label: 'Eat amala in Dugbe', hint: 'Order amala, gbegiri and ewedu', icon: '🍛', on: 'activity', venue: 'dugbe-amala', activity: 'ibadan-amala-plate', beta: true },
    { id: 'market-run', label: 'Go to Bodija Market', hint: 'Price the foodstuff rows', icon: '🧺', on: 'visit', venue: 'bodija-market', beta: true },
    { id: 'beach-day', label: 'Sit by Eleyele water', hint: 'Visit the reservoir edge', icon: '🦆', on: 'visit', venue: 'eleyele-lake', beta: true },
    { id: 'greet-three', label: 'Say hello to 3 people', hint: 'Tap people at any venue', icon: '👋', on: 'event', event: 'npc.greeted', count: 3, beta: true },
    { id: 'new-friend', label: 'Make a friend', hint: 'Keep talking to someone you like', icon: '🤝', on: 'event', event: 'friend.made', beta: true },
  ] satisfies WishDefinition[]),
  radioVenueIds: Object.freeze(['agodi-gardens', 'lekan-salami-stadium']),
  billboardRoads: Object.freeze([
    { id: 'ibadan-bb-iwo-road', near: 'iwo-road-interchange', road: 'Iwo Road' },
    { id: 'ibadan-bb-challenge', near: 'challenge-interchange', road: 'Challenge Road' },
    { id: 'ibadan-bb-dugbe', near: 'dugbe-market', road: 'Dugbe Road' },
    { id: 'ibadan-bb-moniya', near: 'moniya-station', road: 'Oyo Road' },
  ]),
  tablePlaces: Object.freeze([
    { id: 'ibadan-agodi-ayo', venueId: 'agodi-gardens', game: 'whot', label: 'Ayo garden table', seats: 4 },
    { id: 'ibadan-amala-whot', venueId: 'dugbe-amala', game: 'whot', label: 'After-lunch table', seats: 4 },
    { id: 'ibadan-stadium-penalty', venueId: 'lekan-salami-stadium', game: 'penalty', label: 'Stadium penalty spot', seats: 2 },
  ]),
  thingsToDo: Object.freeze([
    { venueId: 'bowers-tower', name: 'Bower’s Tower', line: 'See the seven hills and brown roofs from Oke Aare.' },
    { venueId: 'dugbe-amala', name: 'Dugbe Amala Joint', line: 'Eat amala with gbegiri and ewedu.' },
    { venueId: 'mapo-hall', name: 'Mapo Hall', line: 'Climb the steps and look across the old city.' },
    { venueId: 'ui-campus', name: 'University of Ibadan', line: 'Follow a compact visitor route through the historic campus.' },
    { venueId: 'agodi-gardens', name: 'Agodi Gardens', line: 'Play ayo and stay for an evening garden set.' },
    { venueId: 'national-museum', name: 'National Museum of Unity', line: 'Explore an ethnographic collection from across Nigeria.' },
    { venueId: 'iita-forest', name: 'IITA Forest Reserve', line: 'Take a guided forest walk in Akinyele.' },
    { venueId: 'eleyele-lake', name: 'Eleyele Reservoir', line: 'Watch birds from the water’s edge.' },
  ]),
  culture: Object.freeze({
    greeting: 'Ẹ káàbọ̀',
    food: Object.freeze(['amala with gbegiri and ewedu', 'moin-moin', 'roasted corn']),
    knownFor: Object.freeze(['seven hills and brown roofs', 'the Olubadan chieftaincy line', 'universities, markets and old civic landmarks']),
  }),
})
