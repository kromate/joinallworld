import { localUnitDescription } from '../../../game/cities/runtime.ts'
// The typed boundary to the world's content tables (src/game/content/world.ts): house looks and
// tiers, local governments, readable addresses. Every cast for that module is here; when it is
// converted to TypeScript these lines are deleted and the importers point at the real file.
import { HOUSE_STYLE as HOUSE_STYLE_JS, HOUSE_TIERS as HOUSE_TIERS_JS, STYLE_FIELDS as STYLE_FIELDS_JS, addressLabel as addressLabelJs, lgaOf as lgaOfJs, unpackStyle as unpackStyleJs } from '../../../game/content/world.ts'
import type { HouseStyle, HouseStyleField, HouseTierId, LgaId } from '../../../types/life.ts'

export interface StyleOption { id: string; label: string; hex?: string; price?: number }
export interface TierContent { id: HouseTierId; rank: number; label: string; icon: string; grid: number; cost: number; buildSeconds: number; groundRent: number; blurb: string }
export interface LgaContent { id: LgaId; name: string; line: string }

/** One list of options per field of a house's look; the index is what is stored and sent. */
export const HOUSE_STYLE = HOUSE_STYLE_JS as unknown as Readonly<Record<HouseStyleField, readonly StyleOption[]>>
export const HOUSE_TIERS = HOUSE_TIERS_JS as unknown as Readonly<Record<HouseTierId, TierContent>>
export const STYLE_FIELDS = STYLE_FIELDS_JS as unknown as readonly HouseStyleField[]
/** A city's local government by id, or null for an id it does not have. */
export function lgaOf(cityId: string, id: unknown): LgaContent | null {
  const unit = lgaOfJs(cityId, id)
  return unit ? { id: unit.id, name: unit.name, line: localUnitDescription(cityId, unit.id) } : null
}
/** "Plot 7, Street 3, Estate 42, Ikeja". */
export const addressLabel = addressLabelJs as unknown as (cityId: string, lga: string, estate: number, plot: number) => string
/** The house a packed number draws: its tier and its look. */
export const unpackStyle = unpackStyleJs as unknown as (bits: unknown) => { tier: HouseTierId; style: HouseStyle }
