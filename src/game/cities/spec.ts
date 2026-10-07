import type {
  HomePalette,
  OpeningHours,
  ParametricLandmark,
  ParametricRoofStyle,
  ParametricSignStyle,
  ParametricVenueProp,
} from '../../types/content.ts'
import type { CityPersonSeed } from './contentBuilder.ts'
import { validateCitySpec } from './specValidation.ts'

export type PopulationTier = 'town' | 'small-city' | 'city' | 'major-city'

export type RealPlaceKind =
  | 'airport' | 'church' | 'civic-landmark' | 'college' | 'craft-centre' | 'eatery' | 'garden'
  | 'government' | 'heritage' | 'hospital' | 'industry' | 'market' | 'mosque' | 'museum'
  | 'nightlife' | 'park' | 'polling' | 'polytechnic' | 'port' | 'rail-station' | 'road-hub'
  | 'salon' | 'savings' | 'school' | 'sport' | 'stadium' | 'university'

export type SourceUse = 'coordinate' | 'identity' | 'hours' | 'population' | 'climate' | 'transport' | 'geography'

export type ClimateProfile = 'humid-coastal' | 'southern-wet-dry' | 'middle-belt-wet-dry' | 'northern-savanna' | 'sahel'

export type FormulaBusinessProductId =
  | 'local-plate' | 'jollof' | 'puff-puff'
  | 'zobo' | 'bread' | 'soap' | 'smoked-fish'
  | 'ankara' | 'adire' | 'aso-oke' | 'indigo'
  | 'clay-pot' | 'leather-sandals' | 'cap' | 'basket'

export type CoordinateReference =
  | { readonly provider: 'openstreetmap'; readonly element: 'node' | 'way' | 'relation'; readonly id: number }
  | { readonly provider: 'wikidata'; readonly entity: `Q${number}` }

export interface SourceCache {
  /** Repository-relative path. Parent segments and absolute paths are rejected. */
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export interface SourceGroup {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly checkedOn: `${number}-${number}-${number}`
  readonly supports: readonly SourceUse[]
  readonly licence?: string
  readonly cache: SourceCache
}

export interface SourcedFact {
  readonly sourceIds: readonly string[]
  readonly note?: string
}

export interface LocalUnitFact extends SourcedFact {
  readonly id: string
  readonly name: string
  /** Exact name in the pinned administrative-boundary source. */
  readonly sourceName: string
  readonly populationTier: PopulationTier
  readonly description: string
}

export type CoordinateAccuracy = 'published-point' | 'mapped-feature' | 'feature-centroid' | 'route-reference'

export interface RealPlaceFact extends SourcedFact {
  readonly id: string
  readonly name: string
  readonly kind: RealPlaceKind
  readonly lon: number
  readonly lat: number
  readonly localUnitId: string
  readonly description: string
  readonly coordinateSourceId: string
  readonly coordinateRef: CoordinateReference
  readonly accuracy: CoordinateAccuracy
  readonly hours?: OpeningHours
  /** Required visual choices are product data. The optional landmark must match the sourced place. */
  readonly scene: {
    readonly roof: ParametricRoofStyle
    readonly sign: ParametricSignStyle
    readonly props?: readonly [] | readonly [ParametricVenueProp] | readonly [ParametricVenueProp, ParametricVenueProp]
    readonly landmark?: ParametricLandmark
  }
  /** An eatery's served dish, by identity fact id. */
  readonly featuredIdentityId?: string
  /** A market's sourced specialties, by identity fact id. */
  readonly specialtyIds?: readonly string[]
}

export interface IdentityFact extends SourcedFact {
  readonly id: string
  readonly name: string
  readonly description: string
  /** A matching shared shop product may be supplied locally. */
  readonly localProductId?: FormulaBusinessProductId
}

export interface TransportPlaceFact extends SourcedFact {
  readonly placeId: string
  readonly status: 'operational' | 'limited' | 'inactive'
}

export interface RailFact extends TransportPlaceFact {
  readonly lineName: string
}

export interface CityClimateFact extends SourcedFact {
  /** Factual climate category; the compiler derives beta gameplay probabilities from it. */
  readonly profile: ClimateProfile
  readonly rainyMonths: readonly number[]
  readonly dryMonths: readonly number[]
  readonly description: string
  readonly clearLabel: string
  readonly harmattan?: { readonly months: readonly number[]; readonly label: string }
}

export interface TransportAbsenceFact extends SourcedFact {
  readonly mode: 'airport' | 'rail' | 'port'
  readonly note: string
}

/** Required service kinds a sparse city may document as unmapped instead of placing. */
export type UnmappableKind = 'church' | 'eatery' | 'garden' | 'mosque' | 'park' | 'polling' | 'road-hub' | 'salon' | 'savings' | 'stadium'

/**
 * A required service kind with no exact OSM element or Wikidata P625 record at research time.
 * It makes no claim that the service is absent from the city; the formula uses a documented fallback.
 */
export interface UnmappedKindFact {
  readonly kind: UnmappableKind
  readonly note: string
}

export interface CitySpec<City extends string = string> {
  readonly schemaVersion: 1
  readonly id: City
  readonly name: string
  readonly state: { readonly id: string; readonly name: string; readonly sourceName: string; readonly unit: string; readonly sourceIds: readonly string[] }
  readonly country: { readonly id: string; readonly name: string }
  readonly timezone: 'Africa/Lagos'
  readonly atlas: {
    readonly lon: number
    readonly lat: number
    readonly teaser: string
    readonly preview: readonly string[]
    readonly coordinateSourceId: string
    readonly coordinateRef: CoordinateReference
  }
  readonly population: SourcedFact & { readonly tier: PopulationTier }
  readonly localUnits: readonly LocalUnitFact[]
  readonly places: readonly RealPlaceFact[]
  readonly identity: {
    readonly foods: readonly IdentityFact[]
    readonly crafts: readonly IdentityFact[]
    readonly industries: readonly IdentityFact[]
    /** Sourced facts that are not a food, craft or industry: a festival, a language, a landmark. A regular's lines may cite them. */
    readonly culture?: readonly IdentityFact[]
  }
  /** Empty arrays make no claim. Only sourced, observed facilities belong here. */
  readonly transport: {
    readonly airports: readonly TransportPlaceFact[]
    readonly rail: readonly RailFact[]
    readonly ports: readonly TransportPlaceFact[]
    /** Optional sourced negative findings. Empty service arrays make no absence claim. */
    readonly absent?: readonly TransportAbsenceFact[]
  }
  readonly climate: CityClimateFact
  readonly homePalette: HomePalette
  /** Committed derived geometry input. It contains selected raw boundaries and clipped OSM surface data. */
  readonly geometry: { readonly surface: SourceCache }
  readonly sourceGroups: readonly SourceGroup[]
  /** Documented unmapped service kinds. Empty or omitted means every required kind is placed. */
  readonly unmapped?: readonly UnmappedKindFact[]
  readonly origin?: { readonly x: number; readonly z: number }
}

/** One authored regular and the place they stand at. */
export interface CastEntry extends CityPersonSeed {
  readonly placeId: string
}

const definedSpecs = new WeakSet<object>()

export const unmappedKindsOf = (spec: CitySpec): ReadonlySet<RealPlaceKind> => new Set((spec.unmapped ?? []).map(fact => fact.kind))

export { validateCitySpec }

export function defineCitySpec<const Spec extends CitySpec>(spec: Spec): CitySpec<Spec['id']> {
  const errors = validateCitySpec(spec)
  if (errors.length) throw new TypeError(`Invalid city spec:\n- ${errors.join('\n- ')}`)
  definedSpecs.add(spec)
  return spec
}

export const isDefinedCitySpec = (value: unknown): value is CitySpec => typeof value === 'object' && value !== null && definedSpecs.has(value)
