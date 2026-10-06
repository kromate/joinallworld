// The typed boundary to the lazy modules the location check needs: the main home's city pack (its real boundaries) and the
// point-in-polygon test (src/map3d/residence.ts). Both arrive with a dynamic import the first time the player presses the button,
// never with a panel and never in the first download. Only the city of the main home is loaded.
import type { CityPack } from './../world/cityPack.ts'

/** What of a city pack the judgement reads (the boundaries and the frame they are drawn in). */
export type BoundaryPack = CityPack & object
export type Verdict = 'inside' | 'near' | 'outside' | 'inaccurate'

export interface LocateApi {
  has(cityId: string): boolean
  load(cityId: string): Promise<BoundaryPack | null>
  /** The test itself: runs here, returns one word, keeps nothing. */
  judge(pack: BoundaryPack, lga: string, latitude: number, longitude: number, accuracy: number): Verdict
}

interface RegionsModule { hasCityPack(cityId: string): boolean; loadCityPack(cityId: string): Promise<BoundaryPack | null> }
interface ResidenceModule { judgeResidence(pack: BoundaryPack, lga: string, latitude: number, longitude: number, accuracy: number): Verdict }

export async function loadLocateApi(): Promise<LocateApi> {
  const [regions, residence] = await Promise.all([
    import('../../../map3d/regions.ts') as unknown as Promise<RegionsModule>,
    import('../../../map3d/residence.ts') as unknown as Promise<ResidenceModule>,
  ])
  return { has: regions.hasCityPack, load: regions.loadCityPack, judge: residence.judgeResidence }
}
