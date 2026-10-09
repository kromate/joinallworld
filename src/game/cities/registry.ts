import { CITY_CATALOGUE, CITY_LOADERS } from './catalogue.ts'
import { generateCityLinks } from './generatedLinks.ts'
import type { CityCatalogueEntry } from './catalogue.ts'
import type { CityId } from './ids.ts'
import type { CityAtlasMarker, CityContent, CityCountry, CityDistrict, CityHub, CityLink, CityLinkFrom, CityMapOrigin, CityMapPack, CityModule, CityRouteGeometry, CityRules, CityState } from '../../types/content.ts'

export const DEFAULT_CITY_ID: CityId<'lagos'> = 'lagos'

export interface CityCompatibility { acceptStoredLives: boolean; allowNewLives: boolean; contentSource: string | null; note: string }
export interface KnownCity { catalogue: CityCatalogueEntry; serverKnown: boolean; compatibility: CityCompatibility }
export interface CataloguedCityRules extends CityRules {
  state: CityState
  country: CityCountry
  timezone: string
  atlas: CityAtlasMarker
  mapOrigin: CityMapOrigin | null
  districts: readonly CityDistrict[]
  rentedHomeIds: readonly string[]
  defaultRentedHome: string | null
  defaultName: string
  careerIds: readonly string[]
  campus?: 'unilag'
  hasStateOverview?: boolean
  hubs: readonly CityHub[]
}

const catalogueById: ReadonlyMap<string, CityCatalogueEntry> = new Map(CITY_CATALOGUE.map((city) => [city.id, city]))
const PLAYABLE_ORDER = ['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano'] as const
export const KNOWN_CITIES: Readonly<Record<string, KnownCity | undefined>> = Object.freeze(Object.fromEntries(CITY_CATALOGUE.map((catalogue) => [catalogue.id, Object.freeze({
  catalogue,
  serverKnown: catalogue.open,
  compatibility: Object.freeze({ acceptStoredLives: catalogue.open, allowNewLives: catalogue.open, contentSource: catalogue.open ? catalogue.id : null, note: catalogue.open ? 'Open and playable.' : 'Reserved for future city content.' }),
})])))

const fixtures = new Map<string, CityModule>()
const loadedModules = new Map<string, CityModule>()
const loadedRules = new Map<string, CataloguedCityRules>()
const loadedContent = new Map<string, CityContent>()
const loadedMaps = new Map<string, CityMapPack>()
const pendingModules = new Map<string, Promise<CityModule>>()
const pendingContent = new Map<string, Promise<CityContent>>()
const pendingMaps = new Map<string, Promise<CityMapPack>>()
let authoredCityLinks: readonly CityLink[] | null = null
/** Loaded authored routes only. loadCityLinks fills this live binding. */
export let CITY_LINKS: readonly CityLink[] = Object.freeze([])
let pendingLinks: Promise<readonly CityLink[]> | null = null
let linkCache: readonly CityLink[] | null = null

/** Full rules that have actually loaded. This compatibility table never invents partial city rules. */
const mutableCityRules: Record<string, CityRules> = Object.create(null)
export const CITY_RULES: Readonly<Record<string, CityRules>> = mutableCityRules
const publicRules = ({ id, name, status, unit, units, hub, civicTitle, climate }: CityRules): CityRules => Object.freeze({
  id, name, status, unit, units, hub, ...(civicTitle ? { civicTitle } : {}), ...(climate ? { climate } : {}),
})

function rememberModule(module: CityModule): CityModule {
  loadedModules.set(module.id, module)
  loadedRules.set(module.id, module.rules)
  mutableCityRules[module.id] = publicRules(module.rules)
  linkCache = null
  return module
}

async function readCityModule(id: string): Promise<CityModule> {
  const fixture = fixtures.get(id)
  if (fixture) return fixture
  const cached = loadedModules.get(id)
  if (cached) return cached
  const loader = CITY_LOADERS[id]
  if (!loader) throw new RangeError(`City rules are not available: ${id}`)
  const module = await loader()
  if (module.id !== id || module.rules.id !== id) throw new Error(`City module id ${module.id} does not match ${id}`)
  return rememberModule(module)
}

function loadCityModule(id: string): Promise<CityModule> {
  const existing = pendingModules.get(id)
  if (existing) return existing
  const work = readCityModule(id).finally(() => { if (pendingModules.get(id) === work) pendingModules.delete(id) })
  pendingModules.set(id, work)
  return work
}

const catalogueOfModule = (module: CityModule): CityCatalogueEntry => Object.freeze({
  id: module.id,
  name: module.rules.name,
  state: Object.freeze({ id: module.rules.state.id, name: module.rules.state.name }),
  ...(module.rules.country.id !== 'ng' && module.rules.country.id !== 'nigeria' ? { countryISO: module.rules.country.id, countryName: module.rules.country.name } : {}),
  lon: module.rules.atlas.lon,
  lat: module.rules.atlas.lat,
  open: module.rules.status === 'open',
  airport: module.rules.hubs.some((hub) => hub.mode === 'air'),
  ...(module.rules.atlas.teaser ? { teaser: module.rules.atlas.teaser } : {}),
  ...(module.rules.atlas.preview ? { preview: module.rules.atlas.preview } : {}),
})

export const cityCatalogue = (): readonly CityCatalogueEntry[] => {
  if (!fixtures.size) return CITY_CATALOGUE
  const catalogue = new Map(CITY_CATALOGUE.map((city) => [city.id, city]))
  for (const module of fixtures.values()) catalogue.set(module.id, catalogueOfModule(module))
  return Object.freeze([...catalogue.values()])
}
export const cityCatalogueEntry = (value: unknown): CityCatalogueEntry | null => {
  if (typeof value !== 'string') return null
  const fixture = fixtures.get(value)
  return fixture ? catalogueOfModule(fixture) : catalogueById.get(value) ?? null
}
export const catalogueCitiesInState = (stateId: unknown): readonly CityCatalogueEntry[] => typeof stateId === 'string' ? cityCatalogue().filter((city) => city.state.id === stateId) : []
export const knownCityIds = (): readonly string[] => Object.freeze([...CITY_CATALOGUE.map((city) => city.id), ...fixtures.keys()].filter((id, index, all) => all.indexOf(id) === index))
export const registeredCityIds = (): readonly CityId[] => Object.freeze([...CITY_CATALOGUE.filter((city) => city.open).map((city) => city.id), ...fixtures.keys()].filter((id, index, all) => all.indexOf(id) === index))
export const playableCityIds = (): readonly CityId[] => {
  const open = new Set(CITY_CATALOGUE.filter((city) => city.open).map((city) => city.id))
  const ordered = PLAYABLE_ORDER.filter((id) => open.delete(id))
  return Object.freeze([...ordered, ...open, ...fixtures.keys()].filter((id, index, all) => all.indexOf(id) === index))
}
export const isKnownCityId = (value: unknown): value is string => typeof value === 'string' && (catalogueById.has(value) || fixtures.has(value))
export const isCityId = (value: unknown): value is CityId => typeof value === 'string' && (catalogueById.get(value)?.open === true || fixtures.has(value))
export const isOpenCityId = isCityId

/** Loaded modules and full rules only. Hosts await a loader before synchronous engine work. */
export const cityModule = (value: unknown): CityModule | null => typeof value === 'string' ? fixtures.get(value) ?? loadedModules.get(value) ?? null : null
export const cityRules = (value: unknown): CataloguedCityRules | null => typeof value === 'string' ? fixtures.get(value)?.rules ?? loadedRules.get(value) ?? null : null

export async function loadCityRules(cityId: unknown): Promise<CataloguedCityRules> {
  if (typeof cityId !== 'string') throw new TypeError('A city id is required')
  return (await loadCityModule(cityId)).rules
}
export async function loadAllCityRules(): Promise<readonly CataloguedCityRules[]> { return Promise.all(playableCityIds().map(loadCityRules)) }
export async function loadStateOverviewCity(stateId: unknown): Promise<string | null> {
  if (typeof stateId !== 'string') return null
  for (const city of catalogueCitiesInState(stateId).filter((item) => item.open)) if ((await loadCityRules(city.id)).hasStateOverview) return city.id
  return null
}

export const cityName = (value: unknown): string | null => cityRules(value)?.name ?? cityCatalogueEntry(value)?.name ?? null
export const cityDefaultName = (value: unknown): string => cityRules(value)?.defaultName ?? 'New Lagosian'
export const isDefaultName = (name: unknown): boolean => name === 'New Lagosian' || [...loadedRules.values(), ...[...fixtures.values()].map((value) => value.rules)].some((rules) => rules.defaultName === name)
/** Loaded full rules in a state. Catalogue-only marker callers use catalogueCitiesInState. */
export const citiesInState = (stateId: unknown): readonly CataloguedCityRules[] => typeof stateId === 'string'
  ? [...loadedRules.values(), ...[...fixtures.values()].map((value) => value.rules)].filter((rules) => rules.state.id === stateId)
  : []

const linkKey = (link: Pick<CityLink, 'a' | 'b' | 'mode'>): string => `${[link.a, link.b].sort().join('|')}|${link.mode}`
const sameLink = (a: CityLink, b: CityLink): boolean => a.a === b.a && a.b === b.b && a.mode === b.mode && (a.status ?? 'open') === (b.status ?? 'open') && a.label === b.label && a.icon === b.icon && a.fare === b.fare && a.seconds === b.seconds && a.km === b.km && a.beta === b.beta

/** Load the authored route catalogue. Hosts await this before synchronous travel views are built. */
export function loadCityLinks(): Promise<readonly CityLink[]> {
  if (authoredCityLinks) return Promise.resolve(authoredCityLinks)
  if (pendingLinks) return pendingLinks
  pendingLinks = import('./routes.generated.ts').then((module) => { authoredCityLinks = module.AUTHORED_CITY_LINKS; CITY_LINKS = authoredCityLinks; linkCache = null; return authoredCityLinks }).finally(() => { pendingLinks = null })
  return pendingLinks
}

/** Authored routes win over generated road and air routes. Rail is never generated. */
export function allCityLinks(): readonly CityLink[] {
  if (linkCache) return linkCache
  const merged = new Map<string, CityLink>()
  for (const link of authoredCityLinks ?? [...loadedModules.values()].flatMap((module) => module.rules.links)) merged.set(linkKey(link), link)
  const fixtureLinks = new Map<string, CityLink>()
  for (const link of [...fixtures.values()].flatMap((module) => module.rules.links)) {
    const key = linkKey(link), existing = fixtureLinks.get(key)
    if (existing && !sameLink(existing, link)) throw new Error(`Conflicting fixtures city link ${key}`)
    fixtureLinks.set(key, link); merged.set(key, link)
  }
  const open = CITY_CATALOGUE.filter((city) => city.open).map((city) => ({ id: city.id, name: city.name, lon: city.lon, lat: city.lat, airport: city.airport, countryId: city.countryISO ?? 'ng' }))
  for (const link of generateCityLinks(open, [...merged.values()])) merged.set(linkKey(link), link)
  return linkCache = Object.freeze([...merged.values()])
}
export const cityLinks = (cityId: string): readonly CityLink[] => allCityLinks().filter((link) => link.a === cityId || link.b === cityId)
export const linksFrom = (cityId: string): CityLinkFrom[] => cityLinks(cityId).map(({ a, b, ...link }) => ({ ...link, to: a === cityId ? b : a }))

async function readCityContent(cityId: string): Promise<CityContent> {
  const cached = loadedContent.get(cityId)
  if (cached) return cached
  const [module] = await Promise.all([loadCityModule(cityId), loadCityLinks()])
  const content = await module.loadContent()
  if (content.cityId !== module.id) throw new Error(`City content id ${content.cityId} does not match ${module.id}`)
  if (cityModule(module.id) === module) loadedContent.set(module.id, content)
  return content
}
export function loadCityContent(cityId: unknown): Promise<CityContent> {
  if (typeof cityId !== 'string') return Promise.reject(new TypeError('A city id is required'))
  const pending = pendingContent.get(cityId)
  if (pending) return pending
  const work = readCityContent(cityId).finally(() => { if (pendingContent.get(cityId) === work) pendingContent.delete(cityId) })
  pendingContent.set(cityId, work)
  return work
}
export function cityContent(cityId: unknown): CityContent {
  if (typeof cityId !== 'string') throw new TypeError('A city id is required')
  const content = loadedContent.get(cityId)
  if (!content) throw new Error(`City content has not been loaded: ${cityId}`)
  return content
}
export const cachedCityContent = (cityId: unknown): CityContent | null => typeof cityId === 'string' ? loadedContent.get(cityId) ?? null : null

async function readCityMap(cityId: string): Promise<CityMapPack> {
  const cached = loadedMaps.get(cityId)
  if (cached) return cached
  const module = await loadCityModule(cityId), map = await module.loadMap()
  if (map.cityId !== module.id) throw new Error(`City map id ${map.cityId} does not match ${module.id}`)
  if (cityModule(module.id) === module) loadedMaps.set(module.id, map)
  return map
}
export function loadCityMap(cityId: unknown): Promise<CityMapPack> {
  if (typeof cityId !== 'string') return Promise.reject(new TypeError('A city id is required'))
  const pending = pendingMaps.get(cityId)
  if (pending) return pending
  const work = readCityMap(cityId).finally(() => { if (pendingMaps.get(cityId) === work) pendingMaps.delete(cityId) })
  pendingMaps.set(cityId, work)
  return work
}
export function cityMap(cityId: unknown): CityMapPack {
  if (typeof cityId !== 'string') throw new TypeError('A city id is required')
  const map = loadedMaps.get(cityId)
  if (!map) throw new Error(`City map has not been loaded: ${cityId}`)
  return map
}

/** Register one isolated fictional module for a test and remove every cached value on disposal. */
export function registerCityForTest(module: CityModule, { replaceClosed = false }: { replaceClosed?: boolean } = {}): { dispose: () => void } {
  const replacesReserved = replaceClosed && cityCatalogueEntry(module.id)?.open === false && !cityModule(module.id)
  if (!module.id.startsWith('test-') && !replacesReserved) throw new Error('Test city ids must start with test- or replace a closed reserved city')
  if (isKnownCityId(module.id) && !replacesReserved) throw new Error(`City id is already registered: ${module.id}`)
  fixtures.set(module.id, module); mutableCityRules[module.id] = publicRules(module.rules); linkCache = null
  let disposed = false
  return Object.freeze({ dispose: () => {
    if (disposed) return
    disposed = true
    if (fixtures.get(module.id) === module) { fixtures.delete(module.id); delete mutableCityRules[module.id]; linkCache = null }
    pendingModules.delete(module.id); pendingContent.delete(module.id); pendingMaps.delete(module.id)
    loadedModules.delete(module.id); loadedRules.delete(module.id); loadedContent.delete(module.id); loadedMaps.delete(module.id)
  } })
}

/** Map-only route geometry; loading rules never downloads its coordinates. */
export async function loadCityRoutes(id: string): Promise<readonly CityRouteGeometry[]> {
  if (!fixtures.has(id) && !CITY_LOADERS[id]) return []
  return (await loadCityModule(id)).loadRoutes?.() ?? []
}
