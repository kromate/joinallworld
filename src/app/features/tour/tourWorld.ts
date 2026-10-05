// What the tour may say about the world: the cities that are open besides the one the player is in, read from the
// city registry, so a city is named only once it can be travelled to and a new one appears without a change here.
import { cityRules, playableCityIds } from '../../../game/cities/registry.ts'
import type { TourWorld } from './tourModel.ts'

export function openWorld(cityId: string): TourWorld {
  const here = cityRules(cityId)
  const open = playableCityIds().flatMap((id) => { const rules = cityRules(id); return rules?.status === 'open' && id !== cityId ? [rules] : [] })
  // Cities of the player's own country first: they are the ones a road or a flight reaches today.
  const near = open.filter((rules) => rules.country.id === here?.country.id)
  return { cities: [...near, ...open.filter((rules) => !near.includes(rules))].map((rules) => rules.name), country: here?.country.name ?? 'Nigeria' }
}
