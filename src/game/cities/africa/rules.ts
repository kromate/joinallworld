import type { CityModuleRules } from '../../../types/content.ts'
import { destinationHubIds, destinationVenueIds, validateDestinationFacts } from './types.ts'
import type { DestinationFacts } from './types.ts'
import { generatedAirFare, greatCircleKm } from '../generatedLinks.ts'
import { timedLink } from '../../content/travel.ts'

type DestinationRules = CityModuleRules<string, string, 'centre', 'centre-home', string>

/** Compact rules used before the destination's map and gameplay prose load. */
export function buildDestinationRules(facts: DestinationFacts): DestinationRules {
  const valid = validateDestinationFacts(facts)
  const venues = destinationVenueIds(valid.id, valid.airport.id)
  const hubs = destinationHubIds(valid.id)
  const homeId = `${valid.id}-centre-home`
  const airKm = Math.round(greatCircleKm(valid.centre, { lon: 3.4, lat: 6.45 }))
  // A beta game connection, not a claim about commercial routes or schedules.
  const flight = timedLink({ a: 'lagos', b: valid.id, mode: 'air', beta: true,
    label: `Flight between Lagos and ${valid.name}`, icon: '✈️', km: airKm, fare: generatedAirFare(airKm) })
  const units: DestinationRules['units'] = [
    { id: 'centre', name: 'Starter play zone', zone: 'mainland', land: 55_000, beta: true, districts: ['centre-home'] },
  ]
  const cityHubs: DestinationRules['hubs'] = [
    { id: hubs.air, name: valid.airport.name, mode: 'air', venueId: venues.airport },
    { id: hubs.road, name: 'City transit stop (game venue)', mode: 'road', venueId: venues.transit },
  ]
  return Object.freeze({
    id: valid.id,
    name: valid.name,
    status: 'open',
    unit: 'starter play zone',
    units: Object.freeze(units),
    hub: Object.freeze({ road: 'City transit stop (game venue)', air: valid.airport.name }),
    state: Object.freeze({ id: valid.state.idunique, name: valid.state.name, unit: 'starter play zone' }),
    country: Object.freeze({ id: valid.country.idISOlower, name: valid.country.name }),
    timezone: valid.timezone,
    defaultName: 'New arrival',
    atlas: Object.freeze({ lon: valid.centre.lon, lat: valid.centre.lat, teaser: `${valid.name}, ${valid.state.name}. ${valid.coverageNote}`, preview: Object.freeze([valid.coverageNote]) }),
    mapOrigin: valid.mapOrigin,
    rentedHomeIds: Object.freeze([homeId]),
    defaultRentedHome: homeId,
    careerIds: Object.freeze(['community-helper', 'tech']),
    hubs: Object.freeze(cityHubs),
    links: Object.freeze([flight]),
    seaPlots: false,
    legacyLgaChoice: true,
    districts: Object.freeze([{ id: 'centre-home', name: 'Starter play zone', localUnitId: 'centre' }] satisfies DestinationRules['districts']),
  })
}
