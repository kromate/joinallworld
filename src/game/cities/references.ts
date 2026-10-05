import { cachedCityContent, isCityId } from './registry.ts'

export interface CityReference { cityId: string; id: string }

/** Deployed Lagos keys retain their original shape; every other city has its own namespace. */
export const cityReference = (cityId: string, id: string): string => cityId === 'lagos' ? id : `${cityId}:${id}`

/**
 * Validate against loaded catalogues without fetching a previous city's prose. Cold references
 * remain bounded saved history; they cannot authorize an activity in the current city.
 * Bare legacy keys are Lagos first, then a distinct current-city id when both catalogues are known.
 */
export function readCityReference(value: unknown, currentCity: string, exists: (city: string, id: string) => boolean): CityReference | null {
  if (typeof value !== 'string') return null
  const separator = value.indexOf(':')
  const id = separator < 0 ? value : value.slice(separator + 1)
  if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(id)) return null
  if (separator < 0) {
    if (!cachedCityContent('lagos') || exists('lagos', id)) return { cityId: 'lagos', id }
    return currentCity !== 'lagos' && cachedCityContent(currentCity) && exists(currentCity, id) ? { cityId: currentCity, id } : null
  }
  const cityId = value.slice(0, separator)
  if (!isCityId(cityId)) return null
  if (cachedCityContent(cityId) && !exists(cityId, id)) return null
  return { cityId, id }
}
