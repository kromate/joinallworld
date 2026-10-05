import { knownCityIds, cityRules, cityModule, loadCityMap, KNOWN_CITIES, citiesInState } from '../game/cities/registry.ts';
/**
 * OWNER: world
 * Region registry: country → cities. Everything the country map (src/world-map.ts) and the 3D
 * city map (src/map3d/map3d.ts) know about places comes from here, so a new city is DATA plus a
 * city module — never an edit to the map code.
 *
 * TO ADD A CITY
 *   1. Write src/map3d/cities/<id>.ts exporting the same shape as cities/lagos.ts (bounds, land,
 *      roads, sites, homes, districts, zones and an optional decorate()).
 *   2. Add an entry to its country's `cities` below with `status: 'playable'` and
 *      `pack: () => import('./cities/<id>.ts')`.
 * TO ADD A COUNTRY: add an entry to COUNTRIES with an outline (longitude/latitude pairs, any
 * rough stylised shape) and its cities. The country map draws whichever country is selected.
 *
 * status   'playable'  the city can be entered and has a 3D city pack
 *          'soon'      shown on the country map with its teaser; cannot be entered
 * stand    'low' | 'high': how tall the city's marker stands on the country map, for two cities
 *          too close together for both labels to sit at the same height
 * preview  what a city that is coming soon will hold: three plain lines for its card on the country map
 * legacy   true when the server already keeps lives for this city although it is shown as coming
 *          soon. Only a player who already has such a life is offered it, labelled "Preview".
 */
import type { AfricaGroupId, AtlasLevelId, Box4, CityId, CityPack, CityStatus, ContinentId, Hub, Point2, RegionEntry, RegionKind, RegionStatus, ZoneId } from './types.ts';

/** What a city module's `import()` gives: the pack's parts as named exports, and the same object as `default`. */
export type CityModule = CityPack & { default?: CityPack };
/** One city of a country, as the registry holds it. `pack` is null while the city has no 3D pack. */
export interface CityEntry {
  id: CityId
  name: string
  region: string
  status: CityStatus
  legacy?: boolean
  lon: number
  lat: number
  stand?: 'low' | 'high'
  teaser: string
  pack: (() => Promise<CityModule>) | null
  preview?: readonly string[]
}
/** A city entry with the country it belongs to. */
export interface CityRecord extends CityEntry { country: string; countryName: string }
export interface Country {
  id: string
  name: string
  status: CityStatus
  /** [longitude, latitude] pairs. */
  outline: readonly Point2[]
  rivers: readonly (readonly Point2[])[]
  cities: Readonly<Record<string, CityEntry>>
}
export type CountryId = 'nigeria';
export interface Zone { id: ZoneId; name: string; tint: string }
export interface AfricaGroup { id: AfricaGroupId; name: string; tint: string }
export interface Continent { id: ContinentId; name: string; lon: number; lat: number }
/** What a player may do with a city: it is where they are, they may enter it, they may only look, or it is coming soon. */
export type CityAccess = 'here' | 'enter' | 'preview' | 'soon';

const cityDescriptor = (id: string): CityEntry | null => {
  const rules = cityRules(id);
  if (!rules || rules.country.id !== 'ng') return null;
  return { id, name: rules.name, region: rules.state.name, status: rules.status === 'open' ? 'playable' : 'soon', ...rules.atlas,
    ...(KNOWN_CITIES[id]?.compatibility.acceptStoredLives && rules.status !== 'open' ? { legacy: true } : {}),
    pack: cityModule(id) ? async () => (await loadCityMap(id)).loadScene() : null };
};
const nigeriaCities = (): Readonly<Record<string, CityEntry>> => Object.fromEntries(knownCityIds().flatMap(id => { const city = cityDescriptor(id); return city ? [[id, city]] : []; }));

export const COUNTRIES: Readonly<Record<CountryId, Country>> = Object.freeze({
  nigeria: {
    id: 'nigeria', name: 'Nigeria', status: 'playable',
    // A stylised outline, [longitude, latitude], drawn from general knowledge of the country's shape.
    outline: [[2.7, 6.4], [2.75, 7.6], [2.7, 9.0], [3.5, 10.1], [3.6, 11.7], [4.0, 12.9], [4.2, 13.5], [5.4, 13.85], [6.8, 13.1], [8.0, 13.3], [9.5, 12.8], [10.8, 13.35],
      [12.3, 13.1], [13.5, 13.7], [14.2, 12.6], [14.6, 11.6], [13.8, 11.0], [13.3, 10.0], [13.2, 9.3], [12.7, 8.7], [12.2, 8.3], [11.8, 7.0], [11.2, 6.5], [10.6, 7.05],
      [10.1, 6.9], [9.6, 6.5], [9.2, 6.2], [8.8, 5.7], [8.6, 4.8], [8.2, 4.55], [7.4, 4.4], [6.7, 4.35], [6.0, 4.3], [5.5, 4.9], [5.1, 5.7], [4.6, 6.2], [3.6, 6.4]],
    // The two great rivers meet at Lokoja and run to the delta.
    rivers: [
      [[3.6, 11.7], [4.5, 10.3], [5.6, 9.2], [6.2, 8.5], [6.75, 7.8], [6.7, 6.6], [6.5, 5.5], [6.2, 4.6]],
      [[13.2, 9.3], [11.6, 8.9], [10.0, 8.3], [8.5, 7.75], [6.75, 7.8]],
    ],
    get cities() { return nigeriaCities(); },
  },
});

/** Countries not in the game yet, named so the country picker can say what is planned. */
export const MORE_REGIONS: readonly string[] = Object.freeze(['More Nigerian states', 'Ghana', 'Kenya', 'South Africa', 'United Kingdom']);

export const countryList = () => Object.values(COUNTRIES);
export const citiesOf = (countryId: string) => countryId === 'nigeria' ? Object.values(nigeriaCities()) : [];
export function cityEntry(cityId: string): CityRecord | null {
  const city = cityDescriptor(cityId), country = COUNTRIES.nigeria;
  return city ? { ...city, country: country.id, countryName: country.name } : null;
}
export const isPlayable = (cityId: string) => cityEntry(cityId)?.status === 'playable';
/** Does this city have a 3D pack? Without one the city map falls back to the 2D schematic. */
export const hasCityPack = (cityId: string) => typeof cityEntry(cityId)?.pack === 'function';
export async function loadCityPack(cityId: string): Promise<CityPack | null> {
  const entry = cityEntry(cityId);
  if (typeof entry?.pack !== 'function') return null;
  const module = await entry.pack();
  return module.default || module;
}

/**
 * What a player may do with a city, given the city they are in and the legacy cities they already
 * have a life in (ids). → 'here' | 'enter' | 'preview' | 'soon'
 */
export function cityAccess(cityId: string, { current = null, held = [] }: { current?: string | null; held?: readonly string[] } = {}): CityAccess {
  const entry = cityEntry(cityId);
  if (!entry) return 'soon';
  if (cityId === current) return 'here';
  if (entry.status === 'playable') return 'enter';
  return entry.legacy && held.includes(cityId) ? 'preview' : 'soon';
}

// ---- The atlas: world → continent → country → state (src/map3d/geo) -------------------------------------
/**
 * WHAT IS OPEN, WHAT IS PLANNED, WHAT IS COMING SOON — one registry, read by the atlas (src/map3d/geo/atlas.ts).
 *
 * @typedef {'open' | 'planned' | 'soon' | null} RegionStatus
 *   'open'     in full colour; the only status that can be entered
 *   'planned'  greyed, coming soon, and announced: it has a hub city, and so a preview or a planned route
 *   'soon'     greyed, "Coming soon" — the default for every state and every country not named here
 *   null       on the map for context only (Antarctica, uninhabited territories)
 * @typedef {'state' | 'country'} RegionKind
 * @typedef {{ status?: RegionStatus, teaser?: string, city?: string, zone?: string, level?: string,
 *   hub?: { name: string, lon: number, lat: number } }} RegionEntry
 *   city   the city (a key of COUNTRIES[…].cities) that entering this state opens
 *   level  the atlas level that shows this country's states (see ATLAS_LEVELS)
 *   hub    where a planned route from the open city lands
 *
 * TO OPEN A STATE     give its city a pack and `status: 'playable'` above, then set the state's
 *                     `status: 'open'` and `city` here. Nothing in the map code changes.
 * TO OPEN A COUNTRY   set `status: 'open'` here; to give it a states level as Nigeria has, add its
 *                     data module under src/map3d/geo/data and an entry in ATLAS_LEVELS with `level`.
 */
export const ZONES: Readonly<Record<ZoneId, Zone>> = Object.freeze({
  sw: { id: 'sw', name: 'South West', tint: '#e8b04a' }, se: { id: 'se', name: 'South East', tint: '#d9765f' }, ss: { id: 'ss', name: 'South South', tint: '#4fa3a5' },
  nc: { id: 'nc', name: 'North Central', tint: '#8fae58' }, nw: { id: 'nw', name: 'North West', tint: '#b58a5a' }, ne: { id: 'ne', name: 'North East', tint: '#9a7fb8' },
});
/** The regional groups of Africa (UN geoscheme), a layer at the Africa level. */
export const AFRICA_GROUPS: Readonly<Record<AfricaGroupId, AfricaGroup>> = Object.freeze({
  north: { id: 'north', name: 'North Africa', tint: '#d9b96a' }, west: { id: 'west', name: 'West Africa', tint: '#7fb277' }, east: { id: 'east', name: 'East Africa', tint: '#d18a62' },
  central: { id: 'central', name: 'Central Africa', tint: '#6fa6a8' }, south: { id: 'south', name: 'Southern Africa', tint: '#a48cc0' },
});
export const CONTINENTS: Readonly<Record<ContinentId, Continent>> = Object.freeze({
  af: { id: 'af', name: 'Africa', lon: 20, lat: 3 }, eu: { id: 'eu', name: 'Europe', lon: 18, lat: 51 }, as: { id: 'as', name: 'Asia', lon: 92, lat: 45 },
  na: { id: 'na', name: 'North America', lon: -101, lat: 46 }, sa: { id: 'sa', name: 'South America', lon: -59, lat: -12 }, oc: { id: 'oc', name: 'Oceania', lon: 134, lat: -25 }, an: { id: 'an', name: 'Antarctica', lon: 60, lat: -80 },
});

const state = (zone: ZoneId, teaser: string, more: RegionEntry = {}): RegionEntry => ({ status: 'soon', zone, teaser, ...more });
/** Every first-level unit of Nigeria, by the ids of src/map3d/geo/data/nigeria.ts. */
const NIGERIA_STATES: Record<string, RegionEntry> = {
  lagos: state('sw', 'The city that never slows down: mainland hustle, island nights and the Atlantic at your feet.', { status: 'open' }),
  oyo: state('sw', 'Ibadan on its seven hills, old Oyo and the widest spread of brown roofs in the country.', { status: 'planned' }),
  fct: state('nc', 'Abuja, the capital under Aso Rock: wide roads, big offices and bigger politics.', { status: 'planned' }),
  rivers: state('ss', 'Port Harcourt, the Garden City: oil money, bole and fish, and creeks that run to the sea.', { status: 'planned' }),
  ogun: state('sw', 'The gateway state: Abeokuta under Olumo Rock, adire cloth and the factories on the Lagos road.'),
  osun: state('sw', 'Osogbo and its sacred grove, Ile-Ife and the oldest crowns in Yorubaland.'),
  ondo: state('sw', 'The Sunshine State: cocoa farms, Idanre Hills and a long quiet coast.'),
  ekiti: state('sw', 'Hill country and pounded yam: Ado Ekiti, Ikogosi warm springs and a professor in every family.'),
  abia: state('se', 'Aba makes it and Umuahia governs it: workshops, markets and made-in-Aba everything.'),
  anambra: state('se', 'Onitsha Main Market, the Niger bridge and Nnewi, where the spare parts come from.'),
  ebonyi: state('se', 'Salt of the nation: Abakaliki rice, salt lakes and wide farm country.'),
  enugu: state('se', 'The Coal City on its hills: red earth, old mines and the calm capital of the east.'),
  imo: state('se', 'The Eastern Heartland: Owerri nights, Oguta Lake and hospitality as a way of life.'),
  'akwa-ibom': state('ss', 'Uyo, Ibeno beach and the best afang soup you will ever taste.'),
  bayelsa: state('ss', 'Creeks, mangroves and Yenagoa: the heart of the Niger Delta, reached by road and by boat.'),
  'cross-river': state('ss', 'Calabar and its carnival, Obudu on the plateau and rainforest to the Cameroon border.'),
  delta: state('ss', 'Warri swagger, Asaba on the Niger and oil towns down every creek.'),
  edo: state('ss', 'Benin City: bronze casters, the palace of the Oba and red earth roads in every direction.'),
  benue: state('nc', 'The food basket of the nation: yams, oranges and the wide Benue at Makurdi.'),
  kogi: state('nc', 'The Confluence State: the Niger and the Benue meet at Lokoja.'),
  kwara: state('nc', 'The State of Harmony: Ilorin, where the south-west meets the north.'),
  nasarawa: state('nc', 'Solid minerals and farm country on the capital’s doorstep, from Keffi to Lafia.'),
  niger: state('nc', 'The largest state by land: Minna, Zuma Rock and the great dams on the Niger.'),
  plateau: state('nc', 'Jos on the high plateau: cool air, tin hills and strawberries by the road.'),
  jigawa: state('nw', 'Dutse among the rocks and the Hadejia wetlands, where the birds come for the winter.'),
  kaduna: state('nw', 'The old northern capital: the crocodile city on its river, and Zaria with its university and walls.'),
  kano: state('nw', 'The centre of commerce: dye pits, Kurmi market and a city a thousand years old.'),
  katsina: state('nw', 'Home of hospitality: old city walls, the Gobarau minaret and the road to the Sahel.'),
  kebbi: state('nw', 'The Argungu fishing festival and rice fields along the Sokoto river.'),
  sokoto: state('nw', 'Seat of the Caliphate: the Sultan’s palace, leather works and the edge of the Sahara.'),
  zamfara: state('nw', 'Farming is our pride: Gusau and wide fields of millet and cotton.'),
  adamawa: state('ne', 'Yola on the upper Benue, with the Mandara mountains along the border.'),
  bauchi: state('ne', 'The Pearl of Tourism: Yankari’s elephants and the warm Wikki springs.'),
  borno: state('ne', 'Home of Peace: Maiduguri, the old Kanem-Bornu empire and the shore of Lake Chad.'),
  gombe: state('ne', 'The Jewel in the Savannah: a young state of markets and rolling grassland.'),
  taraba: state('ne', 'Nature’s Gift: the Mambilla plateau, tea farms and the highest ground in Nigeria.'),
  yobe: state('ne', 'Pride of the Sahel: Damaturu, Potiskum’s cattle market and dunes to the north.'),
};
/** Countries with something to say. Every other country is `soon` (see regionEntry). Ids are ISO 3166-1 alpha-2, lower case. */
const WORLD_COUNTRIES: Record<string, RegionEntry> = {
  ng: { status: 'open', level: 'nigeria', teaser: 'Where Allworld begins. Explore open cities across Nigeria; more states are on the way.' },
  gh: { status: 'planned', teaser: 'Accra: Osu nights, Makola market and the jollof argument settled in person.', hub: { name: 'Accra', lon: -0.19, lat: 5.6 } },
  ke: { status: 'planned', teaser: 'Nairobi: matatus, tech money and a national park at the edge of town.', hub: { name: 'Nairobi', lon: 36.82, lat: -1.29 } },
  za: { status: 'planned', teaser: 'Johannesburg: the City of Gold, townships, towers and amapiano all night.', hub: { name: 'Johannesburg', lon: 28.05, lat: -26.2 } },
  gb: { status: 'planned', teaser: 'London: Peckham to the West End, and half of Lagos already there.', hub: { name: 'London', lon: -0.12, lat: 51.5 } },
  aq: { status: null, teaser: 'Ice, and nobody to sell you suya.' },
};
export const ATLAS = Object.freeze({ state: Object.freeze(NIGERIA_STATES), country: Object.freeze(WORLD_COUNTRIES) });

interface AtlasLevelBase {
  name: string
  kind: RegionKind
  /** The continent a country level frames. */
  continent?: ContinentId
  /** The country (ISO 3166-1 alpha-2, lower case) whose states a state level shows. */
  country?: string
  /** [west, south, east, north] in degrees. */
  frame: Box4
  /** The neighbouring countries the level draws itself, as flat land. */
  around?: readonly string[]
}
/** One zoom level of the atlas; `data` is the compact geographic data module the level is drawn from. */
export type AtlasLevel =
  | (AtlasLevelBase & { id: 'world'; data: () => Promise<typeof import('./geo/data/world.ts')> })
  | (AtlasLevelBase & { id: 'africa'; data: () => Promise<typeof import('./geo/data/africa.ts')> })
  | (AtlasLevelBase & { id: 'nigeria'; data: () => Promise<typeof import('./geo/data/nigeria.ts')> });
/** What the atlas reads from a registry entry once the default status is filled in. */
export interface RegionInfo extends RegionEntry { status: RegionStatus }

/**
 * The zoom levels of the atlas, from the widest in. `data` is fetched the first time the level is shown.
 * `frame` is what the level's default view holds: [west, south, east, north] in degrees.
 */
export const ATLAS_LEVELS: readonly AtlasLevel[] = Object.freeze<AtlasLevel[]>([
  { id: 'world', name: 'World', kind: 'country', frame: [-169, -58, 191, 80], data: () => import('./geo/data/world.ts') },
  { id: 'africa', name: 'Africa', kind: 'country', continent: 'af', frame: [-18.5, -35.5, 52, 38], data: () => import('./geo/data/africa.ts') },
  // `around`: the neighbouring countries the level draws itself, as flat land (ISO codes; the same list as the data module's AROUND).
  { id: 'nigeria', name: 'Nigeria', kind: 'state', country: 'ng', frame: [2.6, 4.1, 14.8, 14], around: ['bf', 'bj', 'cf', 'cm', 'ga', 'gh', 'gq', 'ne', 'ng', 'st', 'td', 'tg'], data: () => import('./geo/data/nigeria.ts') },
]);

/** @param {RegionKind} kind @param {string} id @returns {RegionEntry & { status: RegionStatus }} the registry entry, with the default status filled in */
export function regionEntry(kind: RegionKind, id: string): RegionInfo {
  const entry = Object.hasOwn(ATLAS[kind] || {}, id) ? ATLAS[kind][id] : null;
  if (kind === 'state') {
    const cities = citiesInState(id), open = cities.find(city => city.status === 'open'), city = open ?? cities[0];
    return { ...entry, ...(city ? { city: city.id } : {}), status: open ? 'open' : city ? 'planned' : entry && 'status' in entry ? entry.status as RegionStatus : 'soon' };
  }
  return { ...entry, status: entry && 'status' in entry ? entry.status as RegionStatus : 'soon' };
}
export const regionStatus = (kind: RegionKind, id: string) => regionEntry(kind, id).status;
/** Only an open region can be entered. For a state that means its city; for a country, its states level. */
export const canEnter = (kind: RegionKind, id: string) => regionStatus(kind, id) === 'open';
/** The state a city lies in, or null. */
export const stateOfCity = (cityId: string) => cityRules(cityId)?.state.id ?? null;
/** Planned routes between countries: from the open city to the hub of every country marked `planned`. */
export interface PlannedRoute { id: string; from: Hub & { id: string }; to: Hub & { id: string }; mode: 'air' }
export function plannedRoutes(fromCity = 'lagos'): PlannedRoute[] {
  const from = cityEntry(fromCity);
  if (!from) return [];
  return Object.entries(WORLD_COUNTRIES).filter(([, entry]) => entry.status === 'planned' && entry.hub).map(([id, entry]) => ({ id: `${fromCity}:${id}`, from: { id: fromCity, name: from.name, lon: from.lon, lat: from.lat }, to: { id, ...entry.hub! }, mode: 'air' as const }));
}

/** Longitude/latitude → flat map units for one country: x east, y south, the country fitted into `width`. */
export interface Projector { width: number; height: number; point: (lon: number, lat: number) => [number, number] }
export function projector(countryId: string, width = 1000): Projector {
  const outline = COUNTRIES[countryId as CountryId].outline;
  const lons = outline.map((point) => point[0]), lats = outline.map((point) => point[1]);
  const west = Math.min(...lons), east = Math.max(...lons), south = Math.min(...lats), north = Math.max(...lats);
  const scale = width / (east - west);
  return { width, height: (north - south) * scale, point: (lon, lat) => [(lon - west) * scale, (north - lat) * scale] };
}
