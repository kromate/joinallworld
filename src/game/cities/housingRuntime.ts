import { cityRules } from './registry.ts'
import { contentFor } from './runtime.ts'
import type { CityHousingContent, HomeMapSpot, HouseDefinition } from '../../types/content.ts'

/** The selected city's rented-home catalogue. Content loading remains the caller's boundary. */
export const housingFor = (cityId: string): readonly CityHousingContent[] => contentFor(cityId).housing

export const housesFor = (cityId: string): readonly HouseDefinition[] => housingFor(cityId).map(({ definition }) => definition)

export function houseFor(cityId: string, id: unknown): HouseDefinition | null {
  return typeof id === 'string' ? housingFor(cityId).find(({ definition }) => definition.id === id)?.definition ?? null : null
}

export function houseSpotFor(cityId: string, id: unknown): HomeMapSpot | null {
  return typeof id === 'string' ? housingFor(cityId).find(({ definition }) => definition.id === id)?.spot ?? null : null
}

export function defaultHouseFor(cityId: string): HouseDefinition {
  const houses = housesFor(cityId)
  const preferred = houses.find((house) => house.id === cityRules(cityId)?.defaultRentedHome)
  if (!preferred) throw new TypeError(`City ${cityId} has no declared default rented home`)
  return preferred
}
