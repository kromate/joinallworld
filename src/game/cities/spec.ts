import type {
  HomePalette,
  OpeningHours,
  ParametricLandmark,
  ParametricRoofStyle,
  ParametricSignStyle,
  ParametricVenueProp,
} from '../../types/content.ts'

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
  readonly origin?: { readonly x: number; readonly z: number }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA256 = /^[0-9a-f]{64}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const COLOUR = /^#[0-9a-f]{6}$/i
const definedSpecs = new WeakSet<object>()

const duplicateValues = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>(), duplicate = new Set<string>()
  for (const value of values) (seen.has(value) ? duplicate : seen).add(value)
  return [...duplicate]
}

const validateReferences = (label: string, ids: readonly string[], sources: ReadonlyMap<string, SourceGroup>, errors: string[]): void => {
  if (!ids.length) errors.push(`${label} needs at least one source`)
  for (const id of ids) if (!sources.has(id)) errors.push(`${label} references unknown source ${id}`)
}

const validateTypedReferences = (
  label: string,
  ids: readonly string[],
  use: SourceUse,
  sources: ReadonlyMap<string, SourceGroup>,
  errors: string[],
): void => {
  validateReferences(label, ids, sources, errors)
  if (!ids.some(id => sources.get(id)?.supports.includes(use))) errors.push(`${label} needs a source that supports ${use}`)
}

const validateMonths = (label: string, months: readonly number[], errors: string[]): void => {
  if (!months.length) errors.push(`${label} needs at least one month`)
  if (new Set(months).size !== months.length) errors.push(`${label} repeats a month`)
  if (months.some(month => !Number.isInteger(month) || month < 1 || month > 12)) errors.push(`${label} must use month numbers 1 to 12`)
}

const coordinateProviderFor = (url: string): CoordinateReference['provider'] | null => {
  const match = /^https:\/\/([^/:?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(url)
  const host = match?.[1]?.toLowerCase()
  if (!host) return null
  if (host === 'openstreetmap.org' || host.endsWith('.openstreetmap.org') || host === 'overpass-api.de' || host.endsWith('.overpass-api.de')) return 'openstreetmap'
  if (host === 'wikidata.org' || host.endsWith('.wikidata.org')) return 'wikidata'
  return null
}

const validateCoordinateReference = (label: string, reference: CoordinateReference, errors: string[]): void => {
  if (reference.provider === 'openstreetmap') {
    if (!['node', 'way', 'relation'].includes(reference.element) || !Number.isSafeInteger(reference.id) || reference.id < 1) errors.push(`${label} has an invalid OSM element reference`)
    return
  }
  if (!/^Q[1-9]\d*$/.test(reference.entity)) errors.push(`${label} has an invalid Wikidata entity reference`)
}

const requiredKinds: readonly RealPlaceKind[] = ['church', 'eatery', 'garden', 'government', 'hospital', 'market', 'mosque', 'park', 'polling', 'road-hub', 'salon', 'savings', 'stadium']

export function validateCitySpec(spec: CitySpec): readonly string[] {
  const errors: string[] = []
  if (!SLUG.test(spec.id)) errors.push('city id must be a lowercase slug')
  if (!spec.name.trim()) errors.push('city name is required')
  if (!SLUG.test(spec.state.id)) errors.push('state id must be a lowercase slug')
  if (!spec.state.name.trim() || !spec.state.sourceName.trim() || !spec.state.unit.trim()) errors.push('state needs name, sourceName and unit')
  if (!SLUG.test(spec.country.id) || !spec.country.name.trim()) errors.push('country needs a lowercase slug id and name')
  if (!spec.localUnits.length) errors.push('at least one local unit is required')
  if (spec.places.length < 20 || spec.places.length > 30) errors.push('a new city needs 20 to 30 real places')
  const expectedSurfacePath = `scripts/geo/sources/formula/${spec.id}-surface.geojson`
  if (spec.geometry.surface.path !== expectedSurfacePath) errors.push(`geometry surface path must be ${expectedSurfacePath}`)
  if (!SHA256.test(spec.geometry.surface.sha256)) errors.push('geometry surface sha256 is invalid')
  if (!Number.isSafeInteger(spec.geometry.surface.bytes) || spec.geometry.surface.bytes < 1) errors.push('geometry surface bytes are invalid')

  for (const duplicate of duplicateValues(spec.sourceGroups.map(source => source.id))) errors.push(`duplicate source id ${duplicate}`)
  for (const duplicate of duplicateValues(spec.localUnits.map(unit => unit.id))) errors.push(`duplicate local-unit id ${duplicate}`)
  for (const duplicate of duplicateValues(spec.places.map(place => place.id))) errors.push(`duplicate place id ${duplicate}`)

  const sources = new Map(spec.sourceGroups.map(source => [source.id, source]))
  const units = new Set(spec.localUnits.map(unit => unit.id))
  const places = new Map(spec.places.map(place => [place.id, place]))

  for (const source of spec.sourceGroups) {
    if (!SLUG.test(source.id)) errors.push(`source id ${source.id} must be a lowercase slug`)
    if (!source.title.trim() || !source.url.trim()) errors.push(`source ${source.id} needs a title and URL`)
    if (!DATE.test(source.checkedOn)) errors.push(`source ${source.id} needs an ISO checkedOn date`)
    if (!source.supports.length) errors.push(`source ${source.id} needs at least one declared use`)
    if (new Set(source.supports).size !== source.supports.length) errors.push(`source ${source.id} repeats a declared use`)
    if (!/^https:\/\/[^\s/]+(?:\/|$)/i.test(source.url)) errors.push(`source ${source.id} URL must be a valid HTTPS URL`)
    if (source.cache.path.startsWith('/') || source.cache.path.startsWith('\\') || source.cache.path.split(/[\\/]/).includes('..')) {
      errors.push(`source ${source.id} cache path must stay inside the repository`)
    }
    if (!SHA256.test(source.cache.sha256)) errors.push(`source ${source.id} cache sha256 is invalid`)
    if (!Number.isSafeInteger(source.cache.bytes) || source.cache.bytes < 1) errors.push(`source ${source.id} cache bytes are invalid`)
  }

  validateTypedReferences('state', spec.state.sourceIds, 'geography', sources, errors)
  validateTypedReferences('population', spec.population.sourceIds, 'population', sources, errors)
  validateTypedReferences('climate', spec.climate.sourceIds, 'climate', sources, errors)
  const atlasSource = sources.get(spec.atlas.coordinateSourceId)
  if (!atlasSource?.supports.includes('coordinate')) errors.push('atlas coordinateSourceId must reference a coordinate source')
  if (atlasSource && coordinateProviderFor(atlasSource.url) !== spec.atlas.coordinateRef.provider) errors.push('atlas coordinate source URL does not match its OSM or Wikidata reference')
  validateCoordinateReference('atlas', spec.atlas.coordinateRef, errors)
  if (!Number.isFinite(spec.atlas.lon) || spec.atlas.lon < -180 || spec.atlas.lon > 180 || !Number.isFinite(spec.atlas.lat) || spec.atlas.lat < -90 || spec.atlas.lat > 90) {
    errors.push('atlas longitude/latitude is invalid')
  }

  for (const unit of spec.localUnits) {
    if (!SLUG.test(unit.id)) errors.push(`local-unit id ${unit.id} must be a lowercase slug`)
    if (!unit.name.trim() || !unit.sourceName.trim() || !unit.description.trim()) errors.push(`local unit ${unit.id} needs name, sourceName and description`)
    validateTypedReferences(`local unit ${unit.id}`, unit.sourceIds, 'geography', sources, errors)
    if (!spec.places.some(place => place.localUnitId === unit.id)) errors.push(`local unit ${unit.id} has no real place`)
  }

  for (const place of spec.places) {
    if (!SLUG.test(place.id)) errors.push(`place id ${place.id} must be a lowercase slug`)
    if (!place.name.trim() || !place.description.trim()) errors.push(`place ${place.id} needs a name and description`)
    if (!units.has(place.localUnitId)) errors.push(`place ${place.id} references unknown local unit ${place.localUnitId}`)
    if (!Number.isFinite(place.lon) || place.lon < -180 || place.lon > 180 || !Number.isFinite(place.lat) || place.lat < -90 || place.lat > 90) errors.push(`place ${place.id} has invalid longitude/latitude`)
    validateReferences(`place ${place.id}`, place.sourceIds, sources, errors)
    const coordinateSource = sources.get(place.coordinateSourceId)
    if (!coordinateSource?.supports.includes('coordinate')) errors.push(`place ${place.id} coordinateSourceId must reference a coordinate source`)
    if (!place.sourceIds.includes(place.coordinateSourceId)) errors.push(`place ${place.id} sourceIds must include its coordinate source`)
    if (coordinateSource && coordinateProviderFor(coordinateSource.url) !== place.coordinateRef.provider) errors.push(`place ${place.id} coordinate source URL does not match its OSM or Wikidata reference`)
    if (!place.sourceIds.some(id => sources.get(id)?.supports.includes('identity'))) errors.push(`place ${place.id} needs a source that supports identity`)
    if (place.hours && (!Number.isFinite(place.hours.open) || !Number.isFinite(place.hours.close) || place.hours.open < 0 || place.hours.open > 24 || place.hours.close < 0 || place.hours.close > 24)) errors.push(`place ${place.id} has invalid opening hours`)
    if (place.hours && !place.sourceIds.some(id => sources.get(id)?.supports.includes('hours'))) errors.push(`place ${place.id} opening hours need an hours source`)
    if (place.scene.props && new Set(place.scene.props).size !== place.scene.props.length) errors.push(`place ${place.id} repeats a scene prop`)
    validateCoordinateReference(`place ${place.id}`, place.coordinateRef, errors)
  }

  for (const kind of requiredKinds) if (!spec.places.some(place => place.kind === kind)) errors.push(`city needs a sourced ${kind} place`)
  const markets = spec.places.filter(place => place.kind === 'market').length
  if (markets < 1 || markets > 3) errors.push('city needs 1 to 3 sourced markets')
  const tertiary = spec.places.filter(place => place.kind === 'college' || place.kind === 'polytechnic' || place.kind === 'university').length
  if (tertiary < 1 || tertiary > 3) errors.push('city needs 1 to 3 sourced tertiary institutions')
  const heritage = spec.places.filter(place => place.kind === 'civic-landmark' || place.kind === 'heritage' || place.kind === 'museum').length
  if (heritage < 2 || heritage > 3) errors.push('city needs 2 to 3 sourced heritage, landmark or museum sites')

  const identityFacts = [...spec.identity.foods, ...spec.identity.crafts, ...spec.identity.industries]
  for (const duplicate of duplicateValues(identityFacts.map(fact => fact.id))) errors.push(`duplicate identity id ${duplicate}`)
  const identities = new Map(identityFacts.map(fact => [fact.id, fact]))
  const foodIds = new Set(spec.identity.foods.map(fact => fact.id))
  for (const [kind, facts] of Object.entries(spec.identity)) {
    if (!facts.length) errors.push(`identity.${kind} needs at least one sourced fact`)
    for (const fact of facts) {
      if (!SLUG.test(fact.id)) errors.push(`identity id ${fact.id} must be a lowercase slug`)
      if (!fact.name.trim() || !fact.description.trim()) errors.push(`identity ${fact.id} needs a name and description`)
      validateTypedReferences(`identity ${kind} ${fact.name}`, fact.sourceIds, 'identity', sources, errors)
    }
  }
  for (const place of spec.places) {
    if (place.kind === 'eatery' && (!place.featuredIdentityId || !foodIds.has(place.featuredIdentityId))) errors.push(`eatery ${place.id} needs a sourced food featuredIdentityId`)
    if (place.featuredIdentityId && !identities.has(place.featuredIdentityId)) errors.push(`place ${place.id} references unknown identity ${place.featuredIdentityId}`)
    if (place.kind === 'market' && !place.specialtyIds?.length) errors.push(`market ${place.id} needs at least one sourced specialty`)
    if (place.specialtyIds && new Set(place.specialtyIds).size !== place.specialtyIds.length) errors.push(`place ${place.id} repeats a specialty`)
    for (const id of place.specialtyIds ?? []) if (!identities.has(id)) errors.push(`place ${place.id} references unknown specialty ${id}`)
  }

  const transport: readonly [string, readonly TransportPlaceFact[], RealPlaceKind][] = [
    ['airport', spec.transport.airports, 'airport'], ['rail', spec.transport.rail, 'rail-station'], ['port', spec.transport.ports, 'port'],
  ]
  for (const [label, facts, expectedKind] of transport) for (const fact of facts) {
    const place = places.get(fact.placeId)
    if (!place || place.kind !== expectedKind) errors.push(`${label} fact ${fact.placeId} must reference a ${expectedKind} place`)
    validateTypedReferences(`${label} fact ${fact.placeId}`, fact.sourceIds, 'transport', sources, errors)
  }
  for (const fact of spec.transport.rail) if (!fact.lineName.trim()) errors.push(`rail fact ${fact.placeId} needs a real line name`)
  const transportModes = [
    ['airport', spec.transport.airports],
    ['rail', spec.transport.rail],
    ['port', spec.transport.ports],
  ] as const
  for (const [mode, facts] of transportModes) {
    const absence = (spec.transport.absent ?? []).filter(fact => fact.mode === mode)
    if (facts.length && absence.length) errors.push(`transport ${mode} cannot be both documented and absent`)
    if (absence.length > 1) errors.push(`transport ${mode} has more than one absence record`)
  }
  for (const absence of spec.transport.absent ?? []) {
    if (!absence.note.trim()) errors.push(`transport ${absence.mode} absence needs a note`)
    validateTypedReferences(`transport ${absence.mode} absence`, absence.sourceIds, 'transport', sources, errors)
  }
  validateMonths('climate rainyMonths', spec.climate.rainyMonths, errors)
  validateMonths('climate dryMonths', spec.climate.dryMonths, errors)
  const dry = new Set(spec.climate.dryMonths)
  if (spec.climate.rainyMonths.some(month => dry.has(month))) errors.push('climate rainyMonths and dryMonths overlap')
  if (!spec.climate.description.trim() || !spec.climate.clearLabel.trim()) errors.push('climate needs a description and clear label')
  if (spec.climate.harmattan) validateMonths('climate harmattan months', spec.climate.harmattan.months, errors)
  if (![spec.homePalette.back, spec.homePalette.left, ...spec.homePalette.floor].every(colour => COLOUR.test(colour))) errors.push('homePalette colours must be #rrggbb')

  return errors
}

export function defineCitySpec<const Spec extends CitySpec>(spec: Spec): Spec {
  const errors = validateCitySpec(spec)
  if (errors.length) throw new TypeError(`Invalid city spec:\n- ${errors.join('\n- ')}`)
  definedSpecs.add(spec)
  return spec
}

export const isDefinedCitySpec = (value: unknown): value is CitySpec => typeof value === 'object' && value !== null && definedSpecs.has(value)
