import { timedLink } from '../content/travel.ts'
import type { CityLink } from '../../types/content.ts'

/**
 * Links between cities that nobody wrote by hand. A pure function of the open cities, so a city opened later
 * (anywhere in the world) is connected to every other city the moment it is registered.
 *
 * THE RULE
 *   road  every pair whose road distance is at most `maxRoadKm`, unless a road link is authored. Road distance is
 *         the great-circle distance between the two atlas positions times `roadFactor`.
 *   air   every pair of cities that both have an air hub, from `minAirKm` up, unless an air link is authored.
 *         Past `maxRoadKm` air is offered between ANY two open cities: a city without an airport is assumed to be
 *         served from its nearest airfield, so no pair is ever left without a way to travel.
 *   rail  never generated. Only authored railways exist.
 *
 * FARES (fitted to the authored links, which keep their own fares)
 *   road  ROAD.base + ROAD.perKm × road km, rounded to ROAD.step   (authored: 130 km ₦3,500; 760 km ₦14,000; 1,100 km ₦20,000)
 *   air   AIR.base  + AIR.perKm  × air km,  rounded to AIR.step    (authored: 364 km ₦45,000; 520 km ₦65,000; 834 km ₦85,000)
 * Durations come from `timedLink`, so they stay inside the timetable's clamps.
 */
export const GENERATED_LINKS = Object.freeze({
  roadFactor: 1.35,
  maxRoadKm: 1500,
  minAirKm: 250,
  road: Object.freeze({ base: 1500, perKm: 16, step: 500 }),
  air: Object.freeze({ base: 20000, perKm: 80, step: 1000 }),
})

export interface LinkableCity {
  id: string
  name: string
  lon: number
  lat: number
  /** Whether the city has an air hub of its own. */
  airport: boolean
}

const EARTH_RADIUS_KM = 6371
const rad = (degrees: number): number => (degrees * Math.PI) / 180

/** Great-circle distance in kilometres. */
export function greatCircleKm(a: Pick<LinkableCity, 'lon' | 'lat'>, b: Pick<LinkableCity, 'lon' | 'lat'>): number {
  const half = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(half)))
}

const rounded = (value: number, step: number): number => Math.max(step, Math.round(value / step) * step)
export const generatedRoadFare = (roadKm: number): number => rounded(GENERATED_LINKS.road.base + GENERATED_LINKS.road.perKm * roadKm, GENERATED_LINKS.road.step)
export const generatedAirFare = (airKm: number): number => rounded(GENERATED_LINKS.air.base + GENERATED_LINKS.air.perKm * airKm, GENERATED_LINKS.air.step)

const pairKey = (a: string, b: string, mode: string): string => `${[a, b].sort().join('|')}|${mode}`

/** The links missing between `cities`, given the `authored` ones. Pairs are listed once, ids in alphabetical order. */
export function generateCityLinks(cities: readonly LinkableCity[], authored: readonly Pick<CityLink, 'a' | 'b' | 'mode'>[]): readonly CityLink[] {
  const have = new Set(authored.map(link => pairKey(link.a, link.b, link.mode)))
  const usable = cities.filter(city => Number.isFinite(city.lon) && Number.isFinite(city.lat)).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  const made: CityLink[] = []
  for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
    const a = usable[i]!, b = usable[j]!, air = Math.round(greatCircleKm(a, b)), road = Math.round(air * GENERATED_LINKS.roadFactor)
    if (road <= GENERATED_LINKS.maxRoadKm && !have.has(pairKey(a.id, b.id, 'road'))) {
      made.push(timedLink({ a: a.id, b: b.id, mode: 'road', beta: true, label: `Bus between ${a.name} and ${b.name}`, icon: '🚌', fare: generatedRoadFare(road), km: road }))
    }
    const bothAirports = a.airport && b.airport && air >= GENERATED_LINKS.minAirKm
    const beyondRoad = road > GENERATED_LINKS.maxRoadKm
    if ((bothAirports || beyondRoad) && !have.has(pairKey(a.id, b.id, 'air'))) {
      const served = a.airport && b.airport
      made.push(timedLink({ a: a.id, b: b.id, mode: 'air', beta: true, label: served ? `Flight between ${a.name} and ${b.name}` : `Flight between ${a.name} and ${b.name}, from the nearest airfield`, icon: '✈️', fare: generatedAirFare(air), km: air }))
    }
  }
  return Object.freeze(made)
}
