import type { CityClimate, CityHub, CityMapOrigin, CityModuleRules } from '../../../types/content.ts'
import type { CitySpec, ClimateProfile, PopulationTier, RealPlaceFact } from '../spec.ts'
import { formulaCareerPlan, formulaRoadArrival } from './careers.ts'

const landFor = (tier: PopulationTier): number => {
  switch (tier) {
    case 'town': return 55_000
    case 'small-city': return 70_000
    case 'city': return 90_000
    case 'major-city': return 120_000
  }
}

const active = (status: 'operational' | 'limited' | 'inactive'): boolean => status !== 'inactive'
const RAIN_CHANCE_BY_PROFILE: Readonly<Record<ClimateProfile, CityClimate['rainChanceByMonth']>> = Object.freeze({
  'humid-coastal': [0.2, 0.22, 0.34, 0.5, 0.62, 0.66, 0.52, 0.5, 0.68, 0.58, 0.38, 0.24],
  'southern-wet-dry': [0.12, 0.15, 0.26, 0.38, 0.52, 0.58, 0.45, 0.4, 0.58, 0.48, 0.25, 0.14],
  'middle-belt-wet-dry': [0.04, 0.06, 0.15, 0.32, 0.48, 0.56, 0.62, 0.66, 0.6, 0.34, 0.08, 0.04],
  'northern-savanna': [0.01, 0.02, 0.04, 0.14, 0.32, 0.48, 0.6, 0.64, 0.48, 0.16, 0.03, 0.01],
  sahel: [0.01, 0.01, 0.02, 0.08, 0.2, 0.36, 0.52, 0.58, 0.36, 0.1, 0.02, 0.01],
})
const placeNamed = (places: readonly RealPlaceFact[], id: string): RealPlaceFact => {
  const place = places.find(item => item.id === id)
  if (!place) throw new TypeError(`Missing transport place ${id}`)
  return place
}

export function buildFormulaRules<City extends string>(spec: CitySpec<City>, origin: CityMapOrigin): CityModuleRules<City> {
  const road = formulaRoadArrival(spec.places)
  if (!road) throw new TypeError(`${spec.id} needs a road hub`)
  const careers = formulaCareerPlan(spec.places)
  const airportFact = spec.transport.airports.find(item => active(item.status))
  const railFact = spec.transport.rail.find(item => active(item.status))
  const airport = airportFact ? placeNamed(spec.places, airportFact.placeId) : null
  const rail = railFact ? placeNamed(spec.places, railFact.placeId) : null
  const hubs: CityHub[] = [
    { id: `${spec.id}-road`, name: road.name, mode: 'road', venueId: road.id },
    ...(airport ? [{ id: `${spec.id}-air`, name: airport.name, mode: 'air' as const, venueId: airport.id }] : []),
    ...(rail ? [{ id: `${spec.id}-rail`, name: rail.name, mode: 'rail' as const, venueId: rail.id }] : []),
  ]
  const rentedHomeIds = spec.localUnits.map(unit => `${spec.id}-${unit.id}-home`)
  const firstHome = rentedHomeIds[0]
  if (!firstHome) throw new TypeError(`${spec.id} needs a local unit`)
  return Object.freeze({
    id: spec.id,
    name: spec.name,
    status: 'open',
    unit: spec.state.unit,
    units: spec.localUnits.map(unit => ({ id: unit.id, name: unit.name, zone: 'mainland' as const, land: landFor(unit.populationTier), beta: true as const, districts: [`${unit.id}-home`] })),
    hub: { road: road.name, air: airport?.name ?? 'No verified air hub', ...(rail ? { rail: rail.name } : {}) },
    state: { id: spec.state.id, name: spec.state.name, unit: spec.state.unit },
    country: spec.country,
    timezone: spec.timezone,
    defaultName: 'New arrival',
    rentedHomeIds,
    defaultRentedHome: firstHome,
    careerIds: Object.keys(careers.venues),
    atlas: { lon: spec.atlas.lon, lat: spec.atlas.lat, teaser: spec.atlas.teaser, preview: spec.atlas.preview },
    mapOrigin: origin,
    districts: spec.localUnits.map(unit => ({ id: `${unit.id}-home`, name: unit.name, localUnitId: unit.id })),
    hubs,
    links: [],
    seaPlots: false,
    legacyLgaChoice: true,
    climate: { beta: true as const, rainChanceByMonth: RAIN_CHANCE_BY_PROFILE[spec.climate.profile], clearLabel: spec.climate.clearLabel, ...(spec.climate.harmattan ? { harmattan: spec.climate.harmattan } : {}) },
  })
}
