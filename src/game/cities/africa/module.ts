import type { CityModule, CityMapPack, CityContent } from '../../../types/content.ts'
import { validateDestinationFacts } from './types.ts'
import type { DestinationFacts, DestinationMapLoader } from './types.ts'
import { buildDestinationRules } from './rules.ts'

/** Construct compact rules immediately and defer prose and sourced map geometry until requested. */
export function createDestinationModule(facts: DestinationFacts, loadMap: DestinationMapLoader, loadContent?: () => Promise<CityContent>): CityModule<string, string, string, string, string> {
  const valid = validateDestinationFacts(facts)
  const rules = buildDestinationRules(valid)
  let pendingMap: Promise<CityMapPack<string, string>> | null = null
  const loadValidatedMap = (): Promise<CityMapPack<string, string>> => {
    if (pendingMap) return pendingMap
    pendingMap = loadMap().then(map => {
      if (map.cityId !== valid.id) throw new Error(`Destination map id ${map.cityId} does not match ${valid.id}`)
      if (map.projection !== 'nigeria-equirectangular-v1' || map.unitsPerKm !== 10) throw new Error(`Destination map ${valid.id} must use the shared city-map frame`)
      if (map.origin.x !== valid.mapOrigin.x || map.origin.z !== valid.mapOrigin.z) throw new Error(`Destination map ${valid.id} origin must be anchored at its supplied centre`)
      if (!map.localUnitIds.includes('centre')) throw new Error(`Destination map ${valid.id} must contain the starter play zone`)
      return map
    }).catch(error => { pendingMap = null; throw error })
    return pendingMap
  }
  return Object.freeze({
    id: valid.id,
    rules,
    loadContent: loadContent ?? (async () => (await import('./contentBuilder.ts')).buildDestinationContent(valid)),
    loadMap: loadValidatedMap,
  })
}
