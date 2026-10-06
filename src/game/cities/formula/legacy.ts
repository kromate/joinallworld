import type { CityContentSpec } from '../contentBuilder.ts'
import type {
  CityAtlasMarker,
  CityContent,
  CityDistrict,
  CityHub,
  CityLink,
  CityMapGeometry,
  CityModuleRules,
} from '../../../types/content.ts'

export interface LegacyCitySnapshot {
  readonly rules: CityModuleRules
  readonly content: CityContent
  readonly geometry: CityMapGeometry
}

export interface LegacyCityRecipe {
  readonly kind: 'legacy-preservation'
  readonly id: string
  readonly family: 'ogun'
  readonly exports: {
    readonly city: string
    readonly rules: string
    readonly content: string
    readonly map: string
    readonly localUnits: string
    readonly mapOrigin: string
    readonly typePrefix: string
  }
  readonly rules: {
    readonly name: string
    readonly localUnits: readonly {
      readonly id: string
      readonly name: string
      readonly zone: 'mainland'
      readonly land: number
      readonly districts?: readonly string[]
    }[]
    readonly hub: { readonly road: string; readonly air: string; readonly rail?: string }
    readonly rentedHomeIds: readonly string[]
    readonly defaultRentedHome: string
    readonly atlas: CityAtlasMarker
    readonly mapOrigin: Readonly<{ x: number; z: number }>
    readonly districts: readonly CityDistrict[]
    readonly hubs: readonly CityHub[]
    readonly links: readonly CityLink[]
  }
  readonly content: CityContentSpec<string>
  readonly map: {
    readonly stateFeatureId: string
    readonly landmarksExport: string
  }
  readonly baselineSha256: string
  readonly baselineBytes: number
  readonly loadSnapshot: () => Promise<LegacyCitySnapshot>
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA256 = /^[0-9a-f]{64}$/
const definedRecipes = new WeakSet<object>()

export function defineLegacyCityRecipe<const Recipe extends LegacyCityRecipe>(recipe: Recipe): Recipe {
  if (!SLUG.test(recipe.id)) throw new TypeError('Legacy city id must be a lowercase slug')
  if (!SHA256.test(recipe.baselineSha256)) throw new TypeError(`${recipe.id}: legacy baseline SHA-256 is invalid`)
  if (!Number.isSafeInteger(recipe.baselineBytes) || recipe.baselineBytes < 1) throw new TypeError(`${recipe.id}: legacy baseline byte count is invalid`)
  if (recipe.content.cityId !== recipe.id) throw new TypeError(`${recipe.id}: legacy content id does not match`)
  if (!recipe.rules.localUnits.length) throw new TypeError(`${recipe.id}: legacy rules need local units`)
  const identifiers = Object.values(recipe.exports)
  if (identifiers.some(identifier => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier))) throw new TypeError(`${recipe.id}: legacy export identifiers are invalid`)
  definedRecipes.add(recipe)
  return recipe
}

export const isDefinedLegacyCityRecipe = (value: unknown): value is LegacyCityRecipe =>
  typeof value === 'object' && value !== null && definedRecipes.has(value)
