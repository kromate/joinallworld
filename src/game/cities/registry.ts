import { legacyCityContent } from './legacyContent.ts'
import { lagosCity } from './lagos/index.ts'
import { ibadanCity } from './ibadan/index.ts'
import { CITY_LINKS } from './links.ts'
import type { CityId } from './ids.ts'
import type { CityAtlasMarker, CityContent, CityCountry, CityDistrict, CityHub, CityLink, CityLinkFrom, CityMapOrigin, CityMapPack, CityModule, CityRules, CityState } from '../../types/content.ts'

export const DEFAULT_CITY_ID: CityId<'lagos'> = 'lagos'

export interface CityCompatibility {
  acceptStoredLives: boolean
  allowNewLives: boolean
  contentSource: string | null
  note: string
}

export interface KnownCity {
  rules: CataloguedCityRules
  serverKnown: boolean
  compatibility: CityCompatibility
}

export interface CataloguedCityRules extends CityRules {
  state: CityState
  country: CityCountry
  timezone: string
  atlas: CityAtlasMarker
  mapOrigin: CityMapOrigin | null
  districts: readonly CityDistrict[]
  rentedHomeIds: readonly string[]
  defaultRentedHome: string | null
  campus?: 'unilag'
  hubs: readonly CityHub[]
}

function closed(rules: CityRules, state: CityState, atlas: CityAtlasMarker, serverKnown = false, contentSource: string | null = null): KnownCity {
  const hubs: readonly CityHub[] = Object.freeze([
    { id: 'road', name: rules.hub.road, mode: 'road' },
    { id: 'air', name: rules.hub.air, mode: 'air' },
  ])
  const catalogued: CataloguedCityRules = Object.freeze({
    ...rules,
    state,
    country: { id: 'ng', name: 'Nigeria' },
    timezone: 'Africa/Lagos',
    atlas,
    mapOrigin: null,
    districts: [],
    rentedHomeIds: serverKnown ? lagosCity.rules.rentedHomeIds : [],
    defaultRentedHome: serverKnown ? lagosCity.rules.defaultRentedHome : null,
    hubs,
  })
  return Object.freeze({
    rules: catalogued,
    serverKnown,
    compatibility: Object.freeze({
      acceptStoredLives: serverKnown,
      allowNewLives: false,
      contentSource,
      note: serverKnown ? 'Stored lives remain readable; new lives and travel stay closed.' : 'Reserved for future city content.',
    }),
  })
}

const publicRules = ({ id, name, status, unit, units, hub }: CityRules): CityRules => Object.freeze({ id, name, status, unit, units, hub })

const MODULES: Readonly<Record<string, CityModule | undefined>> = Object.freeze({ lagos: lagosCity, ibadan: ibadanCity })

type CoreKnownCityId = 'lagos' | 'ibadan' | 'abuja' | 'port-harcourt'
type KnownCityCatalogue = Readonly<Record<CoreKnownCityId, KnownCity> & Record<string, KnownCity | undefined>>

export const KNOWN_CITIES: KnownCityCatalogue = Object.freeze({
  lagos: Object.freeze({
    rules: lagosCity.rules,
    serverKnown: true,
    compatibility: Object.freeze({ acceptStoredLives: true, allowNewLives: true, contentSource: 'lagos', note: 'Open and playable.' }),
  }),
  ibadan: closed(
    { id: 'ibadan', name: 'Ibadan', status: 'soon', unit: 'local government', units: [], hub: { road: 'Iwo Road Motor Park', air: 'Ibadan airport at Alakia' } },
    { id: 'oyo', name: 'Oyo State', unit: 'local government' },
    { lon: 3.95, lat: 7.38, stand: 'high', teaser: 'Seven hills of brown roofs, Cocoa House and the best amala in the country.', preview: ['Dugbe and Cocoa House', 'Bodija market and the University of Ibadan', 'Mapo Hall on its hill'] },
    true,
    'lagos',
  ),
  abuja: closed(
    { id: 'abuja', name: 'Abuja', status: 'soon', unit: 'district', units: [], hub: { road: 'Utako Motor Park', air: 'the airport on the Airport Road' } },
    { id: 'fct', name: 'Federal Capital Territory', unit: 'area council' },
    { lon: 7.49, lat: 9.06, teaser: 'The capital under Aso Rock: wide roads, big offices and bigger politics.', preview: ['The Three Arms Zone under Aso Rock', 'Wuse market and Jabi Lake', 'Garki, Maitama and the long expressways'] },
  ),
  'port-harcourt': closed(
    { id: 'port-harcourt', name: 'Port Harcourt', status: 'soon', unit: 'local government', units: [], hub: { road: 'Waterlines Motor Park', air: 'the airport at Omagwa' } },
    { id: 'rivers', name: 'Rivers State', unit: 'local government' },
    { lon: 7.03, lat: 4.82, teaser: 'The Garden City: oil money, bole and fish, and creeks that run to the sea.', preview: ['Old GRA and the Garden City roundabouts', 'Mile One market and the waterfront', 'The creeks down to Bonny'] },
  ),
  abeokuta: closed(
    { id: 'abeokuta', name: 'Abeokuta', status: 'soon', unit: 'local government', units: [], hub: { road: 'Lafenwa Motor Park', air: 'the nearest airport, in Lagos' } },
    { id: 'ogun', name: 'Ogun State', unit: 'local government' },
    { lon: 3.35, lat: 7.16, teaser: 'The city under the rock: Olumo, the Egba markets and adire cloth dyed by hand.', preview: ['Olumo Rock above the river', 'Adire dyeing at Itoku market', 'The Ogun river and the old Egba quarter'] },
  ),
  kano: closed(
    { id: 'kano', name: 'Kano', status: 'soon', unit: 'local government', units: [], hub: { road: 'Kano Motor Park', air: 'Mallam Aminu Kano International Airport' } },
    { id: 'kano', name: 'Kano State', unit: 'local government' },
    { lon: 8.52, lat: 12.0, teaser: 'The old trading city of the north: dye pits, the Kurmi market and the walls of the ancient city.', preview: ['Kurmi market in the old city', 'The dye pits of Kofar Mata', 'Gidan Makama and the city walls'] },
  ),
})

/** Compatibility table for callers still migrating from content/world.ts. */
export const CITY_RULES: Readonly<Record<CoreKnownCityId, CityRules> & Record<string, CityRules>> = Object.freeze({
  lagos: publicRules(KNOWN_CITIES.lagos.rules),
  ibadan: publicRules(KNOWN_CITIES.ibadan.rules),
  abuja: publicRules(KNOWN_CITIES.abuja.rules),
  'port-harcourt': publicRules(KNOWN_CITIES['port-harcourt'].rules),
  ...Object.fromEntries(Object.entries(KNOWN_CITIES).flatMap(([id, city]) => city && !['lagos', 'ibadan', 'abuja', 'port-harcourt'].includes(id) ? [[id, publicRules(city.rules)]] : [])),
})

const fixtures = new Map<string, CityModule>()
const loadedContent = new Map<string, CityContent>()
const loadedMaps = new Map<string, CityMapPack>()
const pendingContent = new Map<string, Promise<CityContent>>()
const pendingMaps = new Map<string, Promise<CityMapPack>>()

const moduleOf = (value: unknown): CityModule | null => {
  if (typeof value !== 'string') return null
  return fixtures.get(value) ?? (Object.hasOwn(MODULES, value) ? MODULES[value] : null) ?? null
}

export const knownCityIds = (): readonly string[] => Object.freeze([
  ...new Set([...Object.keys(KNOWN_CITIES), ...Object.keys(MODULES), ...fixtures.keys()]),
])

/** Cities whose stored lives a server may read. Ibadan remains here for compatibility. */
export const registeredCityIds = (): readonly CityId[] => Object.freeze([
  ...new Set([...Object.entries(KNOWN_CITIES).flatMap(([id, city]) => city?.serverKnown ? [id] : []), ...Object.keys(MODULES), ...fixtures.keys()]),
])

/** Cities that can accept a new life or a trip. */
export const playableCityIds = (): readonly CityId[] => Object.freeze([
  ...Object.keys(MODULES),
  ...fixtures.keys(),
])

export const isKnownCityId = (value: unknown): value is string => typeof value === 'string'
  && (Object.hasOwn(KNOWN_CITIES, value) || Boolean(moduleOf(value)))

export const isCityId = (value: unknown): value is CityId => typeof value === 'string'
  && registeredCityIds().includes(value)

export const isOpenCityId = (value: unknown): value is CityId => typeof value === 'string'
  && playableCityIds().includes(value)

export const cityModule = (value: unknown): CityModule | null => moduleOf(value)

export const cityRules = (value: unknown): CataloguedCityRules | null => {
  if (typeof value !== 'string') return null
  return moduleOf(value)?.rules ?? KNOWN_CITIES[value]?.rules ?? null
}

export const cityName = (value: unknown): string | null => cityRules(value)?.name ?? null

/** The name of a life that has none yet: the city module's `defaultName` ('New Lagosian' where the city does not say). */
export const cityDefaultName = (value: unknown): string => (cityRules(value) as { defaultName?: string } | null)?.defaultName ?? 'New Lagosian'
/** Whether a name is the placeholder some city gives a life that has not been named. */
export const isDefaultName = (name: unknown): boolean => name === 'New Lagosian' || knownCityIds().some(id => cityDefaultName(id) === name)

export const citiesInState = (stateId: unknown): readonly CataloguedCityRules[] => typeof stateId === 'string'
  ? knownCityIds().flatMap(id => { const rules = cityRules(id); return rules?.state.id === stateId ? [rules] : [] })
  : []

const linkKey = (link: Pick<CityLink, 'a' | 'b' | 'mode'>): string => `${[link.a, link.b].sort().join('|')}|${link.mode}`
const sameLink = (a: CityLink, b: CityLink): boolean => a.a === b.a && a.b === b.b && a.mode === b.mode && a.label === b.label && a.icon === b.icon
  && a.fare === b.fare && a.seconds === b.seconds && a.km === b.km && a.beta === b.beta

/** Canonical live link catalogue. Authored modules supersede legacy rows; authored conflicts are errors. */
export function allCityLinks(): readonly CityLink[] {
  const merged = new Map(CITY_LINKS.map((link): [string, CityLink] => [linkKey(link), link]))
  for (const [source, links] of [['modules', Object.values(MODULES).flatMap(module => module?.rules.links ?? [])], ['fixtures', Array.from(fixtures.values()).flatMap(module => module.rules.links)]] as const) {
    const authored = new Map<string, CityLink>()
    for (const link of links) {
      const key = linkKey(link), existing = authored.get(key)
      if (existing && !sameLink(existing, link)) throw new Error(`Conflicting ${source} city link ${key}`)
      authored.set(key, link); merged.set(key, link)
    }
  }
  return Object.freeze([...merged.values()])
}

export const cityLinks = (cityId: string): readonly CityLink[] => allCityLinks().filter(link => link.a === cityId || link.b === cityId)
export const linksFrom = (cityId: string): CityLinkFrom[] => cityLinks(cityId).map(({ a, b, ...link }) => ({ ...link, to: a === cityId ? b : a }))

async function readCityContent(cityId: unknown): Promise<CityContent> {
  if (typeof cityId === 'string') {
    const cached = loadedContent.get(cityId)
    if (cached) return cached
  }
  const module = moduleOf(cityId)
  if (module) {
    const content = await module.loadContent()
    if (content.cityId !== module.id) throw new Error(`City content id ${content.cityId} does not match ${module.id}`)
    if (moduleOf(module.id) === module) loadedContent.set(module.id, content)
    return content
  }
  if (typeof cityId === 'string' && KNOWN_CITIES[cityId]?.compatibility.contentSource === 'lagos') {
    const source = await lagosCity.loadContent()
    const content = legacyCityContent(source, cityId)
    loadedContent.set(cityId, content)
    return content
  }
  throw new RangeError(`City content is not available: ${String(cityId)}`)
}

export function loadCityContent(cityId: unknown): Promise<CityContent> {
  if (typeof cityId !== 'string') return Promise.reject(new TypeError('A city id is required'))
  const pending = pendingContent.get(cityId)
  if (pending) return pending
  const work = readCityContent(cityId).finally(() => { if (pendingContent.get(cityId) === work) pendingContent.delete(cityId) })
  pendingContent.set(cityId, work)
  return work
}

export function loadCityMap(cityId: unknown): Promise<CityMapPack> {
  if (typeof cityId !== 'string') return Promise.reject(new TypeError('A city id is required'))
  const pending = pendingMaps.get(cityId)
  if (pending) return pending
  const work = readCityMap(cityId).finally(() => { if (pendingMaps.get(cityId) === work) pendingMaps.delete(cityId) })
  pendingMaps.set(cityId, work)
  return work
}

/** Synchronous engine access after the host has awaited loadCityContent. */
export function cityContent(cityId: unknown): CityContent {
  if (typeof cityId !== 'string') throw new TypeError('A city id is required')
  const content = loadedContent.get(cityId)
  if (!content) throw new Error(`City content has not been loaded: ${cityId}`)
  return content
}

export const cachedCityContent = (cityId: unknown): CityContent | null => typeof cityId === 'string'
  ? loadedContent.get(cityId) ?? null
  : null

async function readCityMap(cityId: unknown): Promise<CityMapPack> {
  if (typeof cityId === 'string') {
    const cached = loadedMaps.get(cityId)
    if (cached) return cached
  }
  const module = moduleOf(cityId)
  if (!module) throw new RangeError(`City map is not available: ${String(cityId)}`)
  const map = await module.loadMap()
  if (map.cityId !== module.id) throw new Error(`City map id ${map.cityId} does not match ${module.id}`)
  if (moduleOf(module.id) === module) loadedMaps.set(module.id, map)
  return map
}

export function cityMap(cityId: unknown): CityMapPack {
  if (typeof cityId !== 'string') throw new TypeError('A city id is required')
  const map = loadedMaps.get(cityId)
  if (!map) throw new Error(`City map has not been loaded: ${cityId}`)
  return map
}

/** Register one isolated fictional module for a test and remove every cached value on disposal. */
export function registerCityForTest(module: CityModule, { replaceClosed = false }: { replaceClosed?: boolean } = {}): { dispose: () => void } {
  const replacesReserved = replaceClosed && KNOWN_CITIES[module.id]?.rules.status === 'soon' && !moduleOf(module.id)
  if (!module.id.startsWith('test-') && !replacesReserved) throw new Error('Test city ids must start with test- or replace a closed reserved city')
  if (isKnownCityId(module.id) && !replacesReserved) throw new Error(`City id is already registered: ${module.id}`)
  fixtures.set(module.id, module)
  let disposed = false
  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      if (fixtures.get(module.id) === module) fixtures.delete(module.id)
      pendingContent.delete(module.id)
      pendingMaps.delete(module.id)
      loadedContent.delete(module.id)
      loadedMaps.delete(module.id)
    },
  })
}

export { CITY_LINKS } from './links.ts'

/** Map-only route geometry; loading rules never downloads its coordinates. */
export const loadCityRoutes = async (id: string) => moduleOf(id)?.loadRoutes?.() ?? [];
