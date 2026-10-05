import type { CityContent, CityMapPack, CityModule, JobDefinition, NpcDefinition, VenueDefinition } from '../../../types/content.ts'
import type { CityPack } from '../../../map3d/types.ts'
import { JOBS } from '../../content/jobs.ts'

export const FICTIONAL_CITY_ID = 'test-fictional'
export const FICTIONAL_NEIGHBOUR_CITY_ID = 'test-neighbour'

const home: VenueDefinition = {
  id: 'home', label: 'Home', district: 'Test Central', icon: 'home', category: 'home',
  description: 'Rest and get ready for the day.', zone: 'mainland', map: { x: 25, y: 50 }, ambient: [],
  scene: { kind: 'home' }, spots: {
    kitchen: { id: 'kitchen', label: 'Kitchen', activities: [] },
    bathroom: { id: 'bathroom', label: 'Bathroom', activities: [] },
    bedroom: { id: 'bedroom', label: 'Bedroom', activities: [] },
  },
}

const square: VenueDefinition = {
  id: 'test-square', label: 'Test Square', district: 'Test Central', icon: 'square', category: 'fun',
  description: 'Meet neighbours, help at the desk and play a round.', zone: 'mainland', map: { x: 60, y: 50 }, ambient: [],
  scene: { kind: 'park' }, spots: {
    centre: { id: 'centre', label: 'Centre', activities: [{ id: 'test-play', label: 'Play a round', duration: 1, cost: 0, effects: { fun: 1 }, tags: ['fun'] }] },
    clinic: { id: 'clinic', label: 'Test clinic', activities: [{ id: 'hospital-doctor', label: 'See the test doctor', duration: 2, cost: 123, tags: ['checkup'] }] },
    work: { id: 'work', label: 'Community desk', activities: [] },
  },
}

const polling: VenueDefinition = {
  id: 'polling-unit', label: 'Test Polling Unit', district: 'Test Central', icon: 'poll', category: 'civic',
  description: 'Register, vote and watch the count.', zone: 'mainland', map: { x: 65, y: 55 }, ambient: [],
  scene: { kind: 'polling' }, spots: { officials: { id: 'officials', label: 'Officials', activities: [] } },
}

const stateHouse: VenueDefinition = {
  id: 'state-house', label: 'Test State House', district: 'Test Central', icon: 'civic', category: 'civic',
  description: 'Read city notices and meet the elected administration.', zone: 'mainland', map: { x: 70, y: 50 }, ambient: [],
  scene: { kind: 'statehouse' }, spots: { office: { id: 'office', label: 'Office', activities: [] } },
}

const regular = (id: string, name: string): NpcDefinition => ({ id, venue: square.id, name, role: 'Neighbour', emoji: 'person', quotes: [`Hello from ${name}.`], at: null })
const helperJob: JobDefinition = {
  id: 'community-helper', label: 'Community helper', summary: 'Help at the square', workplace: { venue: square.id, spot: 'work' },
  workplaceName: square.label,
  shift: { id: 'test-help-shift', label: 'Help out', duration: 1, reward: 100, effects: { energy: -1 }, cooldown: 14400, tags: ['work'] },
}
const techJob: JobDefinition = {
  ...JOBS.tech,
  workplace: { venue: square.id, spot: 'work' },
  workplaceName: square.label,
  shift: { ...JOBS.tech.shift, id: 'test-tech-shift' },
}

export const fictionalContent: CityContent<typeof FICTIONAL_CITY_ID> = {
  cityId: FICTIONAL_CITY_ID,
  localUnitDescriptions: { 'test-central': 'Test only.' },
  venues: [square, polling, stateHouse, home].map((definition) => ({
    cityId: FICTIONAL_CITY_ID,
    id: definition.id,
    kind: definition.scene.kind,
    name: definition.label,
    district: definition.district,
    position: { kind: 'lon-lat', lon: definition.id === 'home' ? 8 : definition.id === square.id ? 8.01 : definition.id === polling.id ? 8.02 : 8.03, lat: 9 },
    whatYouCanDo: definition.description,
    definition,
    spotWording: {},
    activityWording: {},
  })),
  regulars: [
    { cityId: FICTIONAL_CITY_ID, id: 'test-fictional-one', venueId: square.id, definition: regular('test-fictional-one', 'One') },
    { cityId: FICTIONAL_CITY_ID, id: 'test-fictional-two', venueId: square.id, definition: regular('test-fictional-two', 'Two') },
    { cityId: FICTIONAL_CITY_ID, id: 'test-fictional-poll-one', venueId: polling.id, definition: { ...regular('test-fictional-poll-one', 'Poll One'), venue: polling.id } },
    { cityId: FICTIONAL_CITY_ID, id: 'test-fictional-poll-two', venueId: polling.id, definition: { ...regular('test-fictional-poll-two', 'Poll Two'), venue: polling.id } },
    { cityId: FICTIONAL_CITY_ID, id: 'test-fictional-state-one', venueId: stateHouse.id, definition: { ...regular('test-fictional-state-one', 'State One'), venue: stateHouse.id } },
    { cityId: FICTIONAL_CITY_ID, id: 'test-fictional-state-two', venueId: stateHouse.id, definition: { ...regular('test-fictional-state-two', 'State Two'), venue: stateHouse.id } },
  ],
  workplaces: [{ careerId: helperJob.id, venueId: square.id, definition: helperJob }, { careerId: techJob.id, venueId: square.id, definition: techJob }],
  unavailableCareerIds: ['banking', 'music', 'trading', 'nursing', 'hair', 'chef', 'dj', 'fitness', 'creator', 'teaching', 'event', 'football', 'retail'],
  housing: [{
    definition: { id: 'test-centre-flat', label: 'Test flat', district: 'Test Centre', grid: 6, rent: 10, moveIn: 30, description: 'A small test home.' },
    spot: { district: 'Test Centre', zone: 'mainland', map: { x: 25, y: 50 } },
  }],
  events: [], starterGoals: [], wishes: [], radioVenueIds: ['test-square'],
  billboardRoads: [{ id: 'test-board', near: 'test-square', road: 'Test Road' }],
  tablePlaces: [{ id: 'test-square-table', venueId: 'test-square', game: 'whot', label: 'Test square table', seats: 4 }],
  thingsToDo: [{ venueId: square.id, name: square.label, line: square.description }],
  culture: { greeting: 'Hello', food: [], knownFor: ['the test square'] },
}

const fictionalScene: CityPack = {
  id: FICTIONAL_CITY_ID,
  name: 'Fictional',
  bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1, fit: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, sea: { x0: 0, x1: 0, z0: 0, z1: 0 } },
  land: [{ id: 'test-land', kind: 'mainland', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]] }],
  roads: [{ id: 'test-road', name: 'Test Road', points: [[-0.8, 0], [0.8, 0]] }],
  sites: { 'test-square': { x: 0.2, z: 0 }, 'polling-unit': { x: 0.5, z: 0.2 }, 'state-house': { x: 0.7, z: 0 } },
  homes: { own: { x: -0.5, z: 0, district: 'Test Central' } },
  soon: {}, districts: [{ name: 'TEST CENTRAL', x: 0, z: 0, size: 1 }], zones: [[-1, -1, 1, 1]], fabric: [], estates: {},
  lgas: [{ id: 'test-central', name: 'Test Central', line: 'Test only.', land: 1, districts: ['test-centre'], polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]], plate: [0, 0], tint: '#777777', geo: { c: [9, 8], box: [8.9, 7.9, 9.1, 8.1] } }],
  geo: { box: [8.9, 7.9, 9.1, 8.1] },
  decorate: () => {},
}

export const fictionalMap: CityMapPack<typeof FICTIONAL_CITY_ID, 'test-central'> = {
  cityId: FICTIONAL_CITY_ID,
  origin: { x: 0, z: 0 },
  projection: 'nigeria-equirectangular-v1',
  unitsPerKm: 10,
  localUnitIds: ['test-central'],
  stateFeatureId: 'test-state',
  loadScene: async () => fictionalScene,
  loadGeometry: async () => ({
    localUnits: { 'test-central': [[[[7.9, 8.9], [8.1, 8.9], [8.1, 9.1], [7.9, 9.1]]]] },
    playArea: [[[[7.9, 8.9], [8.1, 8.9], [8.1, 9.1], [7.9, 9.1]]]],
    state: [[[[7.9, 8.9], [8.4, 8.9], [8.4, 9.1], [7.9, 9.1]]]],
    water: [], gridDegrees: 0.0002, sharedArcCount: 0, source: 'test-only', licence: 'test-only',
  }),
}

export const fictionalNeighbourContent: CityContent<typeof FICTIONAL_NEIGHBOUR_CITY_ID> = {
  ...fictionalContent,
  cityId: FICTIONAL_NEIGHBOUR_CITY_ID,
  localUnitDescriptions: { 'test-neighbour-central': 'Test only.' },
  venues: fictionalContent.venues.map((venue) => ({ ...venue, cityId: FICTIONAL_NEIGHBOUR_CITY_ID })),
  regulars: fictionalContent.regulars.map((regular) => {
    const id = regular.id.replace('test-fictional-', 'test-neighbour-')
    return { ...regular, cityId: FICTIONAL_NEIGHBOUR_CITY_ID, id, definition: { ...regular.definition, id } }
  }),
  housing: fictionalContent.housing.map(({ definition, spot }) => ({
    definition: { ...definition, district: 'Neighbour Centre', description: 'A small neighbouring test home.' },
    spot: { ...spot, district: 'Neighbour Centre' },
  })),
}

const fictionalNeighbourScene: CityPack = {
  ...fictionalScene,
  id: FICTIONAL_NEIGHBOUR_CITY_ID,
  name: 'Fictional Neighbour',
  lgas: fictionalScene.lgas.map((unit) => ({ ...unit, id: 'test-neighbour-central', name: 'Neighbour Central', districts: ['test-neighbour-centre'] })),
}

export const fictionalNeighbourMap: CityMapPack<typeof FICTIONAL_NEIGHBOUR_CITY_ID, 'test-neighbour-central'> = {
  ...fictionalMap,
  cityId: FICTIONAL_NEIGHBOUR_CITY_ID,
  origin: { x: 300, z: 0 },
  localUnitIds: ['test-neighbour-central'],
  stateFeatureId: 'test-state',
  loadScene: async () => fictionalNeighbourScene,
  loadGeometry: async () => ({
    localUnits: { 'test-neighbour-central': [[[[8.2, 8.9], [8.4, 8.9], [8.4, 9.1], [8.2, 9.1]]]] },
    playArea: [[[[8.2, 8.9], [8.4, 8.9], [8.4, 9.1], [8.2, 9.1]]]],
    state: [[[[7.9, 8.9], [8.4, 8.9], [8.4, 9.1], [7.9, 9.1]]]],
    water: [], gridDegrees: 0.0002, sharedArcCount: 0, source: 'test-only', licence: 'test-only',
  }),
}

let contentLoads = 0
let mapLoads = 0

export const fictionalCity: CityModule<typeof FICTIONAL_CITY_ID, 'test-state', 'test-central', 'test-centre', 'test-road'> = {
  id: FICTIONAL_CITY_ID,
  rules: {
    id: FICTIONAL_CITY_ID, name: 'Fictional', status: 'open', unit: 'local government',
    units: [{ id: 'test-central', name: 'Test Central', zone: 'mainland', land: 1, districts: ['test-centre'] }],
    hub: { road: 'Test Park', air: 'Test Park' },
    state: { id: 'test-state', name: 'Test State', unit: 'local government' },
    country: { id: 'ng', name: 'Nigeria' }, timezone: 'Africa/Lagos', atlas: { lon: 8, lat: 9, teaser: 'Test only.' }, mapOrigin: { x: 0, z: 0 },
    districts: [{ id: 'test-centre', name: 'Test Centre', localUnitId: 'test-central' }],
    rentedHomeIds: ['test-centre-flat'], defaultRentedHome: 'test-centre-flat', careerIds: ['community-helper', 'tech'],
    hubs: [{ id: 'test-road', name: 'Test Park', mode: 'road' }],
    links: [{ a: FICTIONAL_CITY_ID, b: 'test-neighbour', mode: 'road', label: 'Test bus', icon: 'bus', fare: 10, seconds: 1, km: 1, beta: true }],
  },
  loadContent: async () => { contentLoads += 1; return fictionalContent },
  loadMap: async () => { mapLoads += 1; return fictionalMap },
}

export const fictionalNeighbourCity: CityModule<typeof FICTIONAL_NEIGHBOUR_CITY_ID, 'test-state', 'test-neighbour-central', 'test-neighbour-centre', 'test-neighbour-road'> = {
  id: FICTIONAL_NEIGHBOUR_CITY_ID,
  rules: {
    id: FICTIONAL_NEIGHBOUR_CITY_ID, name: 'Fictional Neighbour', status: 'open', unit: 'local government',
    units: [{ id: 'test-neighbour-central', name: 'Neighbour Central', zone: 'mainland', land: 1, districts: ['test-neighbour-centre'] }],
    hub: { road: 'Neighbour Park', air: 'Neighbour Park' },
    state: { id: 'test-state', name: 'Test State', unit: 'local government' },
    country: { id: 'ng', name: 'Nigeria' }, timezone: 'Africa/Lagos', atlas: { lon: 8.3, lat: 9, teaser: 'Test only.' }, mapOrigin: { x: 300, z: 0 },
    districts: [{ id: 'test-neighbour-centre', name: 'Neighbour Centre', localUnitId: 'test-neighbour-central' }],
    rentedHomeIds: ['test-centre-flat'], defaultRentedHome: 'test-centre-flat', careerIds: ['community-helper', 'tech'],
    hubs: [{ id: 'test-neighbour-road', name: 'Neighbour Park', mode: 'road' }],
    links: [{ a: FICTIONAL_CITY_ID, b: FICTIONAL_NEIGHBOUR_CITY_ID, mode: 'road', label: 'Test bus', icon: 'bus', fare: 10, seconds: 1, km: 1, beta: true }],
  },
  loadContent: async () => fictionalNeighbourContent,
  loadMap: async () => fictionalNeighbourMap,
}

export const fictionalLoadCounts = (): Readonly<{ content: number; map: number }> => Object.freeze({ content: contentLoads, map: mapLoads })
export function resetFictionalLoadCounts(): void { contentLoads = 0; mapLoads = 0 }
