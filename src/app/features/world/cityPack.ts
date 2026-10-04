// The typed boundary to the lazy map modules the "find my local government" button needs
// (src/map3d/regions.js: the city packs, src/map3d/lga.js: which box a position falls in).
// Both are fetched with a dynamic import the first time they are asked for, never with the
// panel: a player who picks from the list never downloads them.
import type { LgaId } from '../../../types/life.ts'

/** A local government the device's position fell in. `sure` is false when it is only the nearest. */
export interface FoundLga { id: LgaId; name: string; sure: boolean }
/** What of a city pack the lookup reads. */
export interface CityPack { name: string }

export interface CityPackApi {
  /** Does this city have a pack to look the position up in? */
  has(cityId: string): boolean
  load(cityId: string): Promise<CityPack | null>
  resolve(pack: CityPack, latitude: number, longitude: number): FoundLga | null
}

interface RegionsModule { hasCityPack(cityId: string): boolean; loadCityPack(cityId: string): Promise<CityPack | null> }
interface LgaModule { resolveLga(pack: CityPack, latitude: number, longitude: number): FoundLga | null }

/** The real modules, fetched now. */
export async function loadCityPackApi(): Promise<CityPackApi> {
  const [regions, lga] = await Promise.all([
    import('../../../map3d/regions.ts') as unknown as Promise<RegionsModule>,
    import('../../../map3d/lga.ts') as unknown as Promise<LgaModule>,
  ])
  return { has: regions.hasCityPack, load: regions.loadCityPack, resolve: lga.resolveLga }
}
