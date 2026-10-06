// What the tour may say about the world: the cities that are open besides the one the player is in, read from the
// city registry, so a city is named only once it can be travelled to and a new one appears without a change here.
import { cityName, playableCityIds } from '../../../game/cities/registry.ts'
import type { TourWorld } from './tourModel.ts'

export function openWorld(cityId: string): TourWorld {
  const cities = playableCityIds().filter(id => id !== cityId).flatMap(id => { const name = cityName(id); return name ? [name] : [] })
  return { cities, country: 'Nigeria' }
}
