// "Where you live" as data: country → state → city → local government. The creator walks this
// tree, so a new place is a new entry here and nothing else: a city is open when the rules say it
// is (CITY_RULES), and its local governments come from the life's view (estate.lgas), which is
// what the server validates. Places that are not open yet are listed as coming, never as dead controls.
import { cityRules, knownCityIds } from '../../../game/cities/registry.ts'
import type { LgaCard } from '../../../types/view.ts'

export interface CityPlace { id: string; name: string }
export interface StatePlace { id: string; name: string; cities: readonly CityPlace[] }
export interface CountryPlace { id: string; name: string; states: readonly StatePlace[] }

/**
 * The places Allworld knows about, read from the city registry (src/game/cities): every catalogued city under its state, the first
 * state being the first city's. Open or coming is not written here either: it is the city's own status in the rules. A city that is
 * added to the registry (a module, or a reserved id) shows up here without another table.
 */
export function placesFrom(cityIds: readonly string[]): readonly CountryPlace[] {
  const states = new Map<string, { id: string; name: string; cities: CityPlace[] }>()
  for (const id of cityIds) {
    const rules = cityRules(id)
    if (!rules || id.startsWith('test-')) continue
    const state = states.get(rules.state.id) ?? { id: rules.state.id, name: rules.state.name, cities: [] }
    state.cities.push({ id: rules.id, name: rules.name })
    states.set(state.id, state)
  }
  return [{ id: 'nigeria', name: 'Nigeria', states: [...states.values()] }]
}
export const PLACES: readonly CountryPlace[] = placesFrom(knownCityIds())

/** Whether lives can be lived in this city today. */
export const cityOpen = (cityId: string): boolean => cityRules(cityId)?.status === 'open'
/** A state is open when any of its cities is. */
export const stateOpen = (state: StatePlace): boolean => state.cities.some((city) => cityOpen(city.id))
/** What the city calls the districts a player chooses between ('local government', 'district'). */
export const unitOf = (cityId: string): string => cityRules(cityId)?.unit ?? 'area'

/** The first state with an open city, the first open city in it: where the chooser starts. */
export function firstOpen(places: readonly CountryPlace[] = PLACES): { state: StatePlace; city: CityPlace } | null {
  for (const country of places) for (const state of country.states) for (const city of state.cities) if (cityOpen(city.id)) return { state, city }
  return null
}

/** The state a city belongs to, or null. */
export function stateOfCity(cityId: string, places: readonly CountryPlace[] = PLACES): StatePlace | null {
  for (const country of places) for (const state of country.states) if (state.cities.some((city) => city.id === cityId)) return state
  return null
}

/** The zone a local government lies in, for grouping ('island', 'mainland', 'east'); '' for a city that has none. */
export function zoneOf(cityId: string, lgaId: string): string {
  return cityRules(cityId)?.units.find((unit) => unit.id === lgaId)?.zone ?? ''
}
const ZONE_TITLES: Readonly<Record<string, string>> = { island: 'The island', mainland: 'The mainland', east: 'The east, by the lagoon' }
const ZONE_ORDER = ['island', 'mainland', 'east']

export interface LgaGroup { zone: string; title: string; items: LgaCard[] }
/** The local governments of a city, filtered by what was typed, grouped by zone in a fixed order, each group in alphabetical order. */
export function groupLgas(cityId: string, lgas: readonly LgaCard[], query = ''): LgaGroup[] {
  const needle = query.trim().toLowerCase()
  const shown = lgas.filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.line.toLowerCase().includes(needle))
  const zones = new Map<string, LgaCard[]>()
  for (const item of shown) { const zone = zoneOf(cityId, item.id); zones.set(zone, [...(zones.get(zone) ?? []), item]) }
  const keys = [...zones.keys()].sort((a, b) => (ZONE_ORDER.indexOf(a) + 1 || 99) - (ZONE_ORDER.indexOf(b) + 1 || 99))
  // A city whose units all lie in one zone (an inland city) gets one plain list, not a heading that says nothing.
  return keys.map((zone) => ({ zone, title: keys.length > 1 ? ZONE_TITLES[zone] ?? '' : '', items: (zones.get(zone) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)) }))
}
