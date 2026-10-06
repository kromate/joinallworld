import { CAREER_IDS } from '../../content/career-ids.ts'
import type { RealPlaceFact, RealPlaceKind } from '../spec.ts'

const CAREER_KINDS: Readonly<Record<string, readonly RealPlaceKind[]>> = Object.freeze({
  'community-helper': ['garden', 'government', 'park'],
  tech: ['university', 'polytechnic', 'college', 'school', 'savings'],
  banking: ['savings', 'government'],
  music: ['nightlife', 'garden', 'sport'],
  trading: ['market'],
  nursing: ['hospital'],
  hair: ['salon'],
  chef: ['eatery', 'market'],
  dj: ['nightlife', 'garden'],
  fitness: ['stadium', 'sport', 'park', 'garden'],
  creator: ['craft-centre', 'university', 'polytechnic', 'college', 'school'],
  teaching: ['university', 'polytechnic', 'college', 'school'],
  event: ['government', 'garden', 'stadium', 'sport'],
  football: ['stadium', 'sport'],
  retail: ['market'],
})

export interface FormulaCareerPlan {
  readonly venues: Readonly<Record<string, string>>
  /** Careers with no compatible sourced venue in this city. */
  readonly unavailable: readonly string[]
}

/** Maps each shared career to the first compatible sourced venue; careers with none are unavailable here. */
export function formulaCareerPlan(places: readonly RealPlaceFact[]): FormulaCareerPlan {
  const venues: Record<string, string> = {}
  const unavailable: string[] = []
  for (const careerId of CAREER_IDS) {
    const kinds = CAREER_KINDS[careerId] ?? []
    const venue = kinds.flatMap(kind => places.filter(place => place.kind === kind)).at(0)
    if (venue) venues[careerId] = venue.id
    else unavailable.push(careerId)
  }
  if (!venues.tech) throw new TypeError('No compatible venue can host tech')
  return Object.freeze({ venues: Object.freeze(venues), unavailable: Object.freeze(unavailable) })
}

const RECREATION_ORDER: readonly RealPlaceKind[] = ['park', 'garden', 'stadium', 'sport', 'civic-landmark', 'heritage', 'museum']

/** The arrival "first fun" venue: a park, else the nearest documented recreation fallback. */
export function formulaArrivalRecreation(places: readonly RealPlaceFact[]): RealPlaceFact | undefined {
  return RECREATION_ORDER.flatMap(kind => places.filter(place => place.kind === kind)).at(0)
}

/** The road arrival venue: a sourced road hub, else the first sourced market (arrivals set down by the market). */
export function formulaRoadArrival(places: readonly RealPlaceFact[]): RealPlaceFact | undefined {
  return places.find(place => place.kind === 'road-hub') ?? places.find(place => place.kind === 'market')
}
