import { originAt } from '../../../geo/frame.ts'
import type { CityMapOrigin, CityMapPack } from '../../../types/content.ts'

/** Small sourced fact set for a playable destination starter. Only the airport is a real venue. */
export interface DestinationFacts {
  readonly id: string
  readonly name: string
  readonly country: { readonly idISOlower: string; readonly name: string }
  readonly state: { readonly idunique: string; readonly name: string }
  readonly timezone: string
  readonly centre: { readonly lon: number; readonly lat: number }
  readonly airport: { readonly id: string; readonly name: string; readonly lon: number; readonly lat: number; readonly sourceUrl: string }
  readonly sourceLabel: string
  readonly sourceUrl: string
  readonly licence: string
  /** WGS84 [west, south, east, north] bounds of this starter play area. */
  readonly bounds: readonly [west: number, south: number, east: number, north: number]
  /** Explains the scope and limits of the starter play area. */
  readonly coverageNote: string
}

export type DestinationMapLoader = () => Promise<CityMapPack<string, string>>

export interface ValidatedDestinationFacts extends DestinationFacts {
  readonly mapOrigin: CityMapOrigin
}

export const destinationVenueIds = (id: string, airportId: string) => Object.freeze({
  airport: `${id}-airport-${stablePart(airportId)}`,
  transit: `${id}-transit`,
  meal: `${id}-meal-stop`,
  community: `${id}-community-workshop`,
  clinic: `${id}-clinic`,
  recreation: `${id}-recreation`,
  market: `${id}-market-game`,
  worship: `${id}-quiet-reflection`,
  polling: `${id}-community-voting-game`,
  government: `${id}-community-notices`,
})

export const destinationHubIds = (id: string) => Object.freeze({ air: `${id}-air`, road: `${id}-road` })

function stablePart(value: string): string {
  const part = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
  return part || 'source'
}

export function validateDestinationFacts(facts: DestinationFacts): ValidatedDestinationFacts {
  const text = (value: string, label: string): void => {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} must be non-empty plain text`)
  }
  text(facts.id, 'destination id')
  text(facts.name, 'destination name')
  text(facts.country.idISOlower, 'country ISO id')
  text(facts.country.name, 'country name')
  text(facts.state.idunique, 'state id')
  text(facts.state.name, 'state name')
  text(facts.timezone, 'destination timezone')
  text(facts.airport.id, 'airport id')
  text(facts.airport.name, 'airport name')
  text(facts.sourceLabel, 'source label')
  text(facts.sourceUrl, 'source URL')
  text(facts.airport.sourceUrl, 'airport source URL')
  text(facts.licence, 'source licence')
  text(facts.coverageNote, 'coverage note')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(facts.id)) throw new TypeError('destination id must be a lowercase hyphenated id')
  if (!/^[a-z]{2}$/u.test(facts.country.idISOlower)) throw new TypeError('country ISO id must be two lowercase letters')
  const sourceUrl = (value: string, label: string): void => {
    let url: URL
    try { url = new URL(value) } catch { throw new TypeError(`${label} must be an absolute HTTPS URL`) }
    if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError(`${label} must be an HTTPS URL without credentials`)
  }
  sourceUrl(facts.sourceUrl, 'source URL')
  sourceUrl(facts.airport.sourceUrl, 'airport source URL')
  try { new Intl.DateTimeFormat('en', { timeZone: facts.timezone }) }
  catch { throw new TypeError('destination timezone must be a valid IANA timezone') }
  const coordinate = (lon: number, lat: number, label: string): void => {
    if (!Number.isFinite(lon) || lon < -180 || lon > 180 || !Number.isFinite(lat) || lat < -90 || lat > 90) throw new RangeError(`${label} must be a finite WGS84 coordinate`)
  }
  coordinate(facts.centre.lon, facts.centre.lat, 'destination centre')
  coordinate(facts.airport.lon, facts.airport.lat, 'airport')
  const [west, south, east, north] = facts.bounds
  if (![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new RangeError('destination bounds must be an ordered WGS84 [west, south, east, north] box')
  }
  const mapOrigin = originAt(facts.centre.lon, facts.centre.lat)
  return Object.freeze({ ...facts, mapOrigin })
}
