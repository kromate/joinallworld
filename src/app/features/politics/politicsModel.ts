// Politics: the keys and paths of what the app reads, and the sentences it shows. Pure: no application code, so the tests load it alone.
import type { GovResponse } from '../../../types/civic.ts'
import type { JusticeResponse, JusticeSeatView, LeverView, OffenceView, PartyView, PoliticsResponse, SeatView, TierId } from '../../../types/politics.ts'
import { PARTY } from '../../../game/content/politics.ts'
import { govKey } from '../civic/civicModel.ts'

export type TabId = TierId | 'parties' | 'justice'
export const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'city', label: 'City' }, { id: 'state', label: 'State' }, { id: 'nation', label: 'Nation' }, { id: 'parties', label: 'Parties' }, { id: 'justice', label: 'Justice' },
]
export const overviewKey = (cityId: string): string => `politics:${cityId}`
export const overviewPath = (cityId: string): string => `/api/politics/overview?city=${cityId}`
/** The city's own ballot is the one the Governor app reads, so they share one cached copy. */
export const ballotKey = (cityId: string, tier: TierId): string => (tier === 'city' ? govKey(cityId) : `gov:${cityId}:${tier}`)
export const ballotPath = (cityId: string, tier: TierId): string => (tier === 'city' ? `/api/civic/gov?city=${cityId}` : `/api/civic/gov?city=${cityId}&tier=${tier}`)

export const seatOf = (data: PoliticsResponse | null | undefined, tier: TierId): SeatView | null => data?.seats.find((seat) => seat.tier === tier) ?? null
export const partyName = (data: PoliticsResponse | null | undefined, id: string | null | undefined): PartyView | null => (id ? data?.parties.find((party) => party.id === id) ?? null : null)

/** "5%": the value of a lever as a player reads it. */
const unitText = (unit: LeverView['unit']): string => (unit === '%' ? '%' : ` ${unit}`)
export const leverText = (lever: Pick<LeverView, 'unit'>, value: number): string => `${value}${unitText(lever.unit)}`
export const leverRange = (lever: Pick<LeverView, 'min' | 'max' | 'unit'>): string => `${lever.min}–${lever.max}${unitText(lever.unit)}`

/** Why a lever cannot be set to `value`, as a sentence, or '' when it can. */
export function leverWhy(lever: Pick<LeverView, 'min' | 'max' | 'unit' | 'label'>, value: unknown): string {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'Enter a whole number.'
  return value < lever.min || value > lever.max ? `${lever.label} can be ${leverRange(lever)}.` : ''
}

export const quorumLine = (seat: Pick<SeatView, 'quorum'>): string => `An election needs at least ${seat.quorum} votes to count. With fewer, nobody takes office and the seat stays empty.`

/** Who holds the seat, in one line. */
export function officeLine(seat: Pick<SeatView, 'title' | 'name'>, gov: Pick<GovResponse, 'governor'> | null | undefined, party: string | null): string {
  if (!gov) return ''
  return gov.governor ? `${gov.governor.name} is ${seat.title} of ${seat.name}${party ? ` · ${party}` : ''}` : `${seat.title} of ${seat.name}: nobody holds the seat this week.`
}

/** What the ledger line says in a few words. */
export const ledgerKind = (kind: SeatView['treasury']['ledger'][number]['kind']): string => (kind === 'levy' ? 'Levy' : kind === 'fee' ? 'Filing fee' : 'Salary')

export const partyNameWhy = (name: string): string => {
  const length = [...name.trim()].length
  return length < PARTY.nameMin ? `Name the party (${PARTY.nameMin}–${PARTY.nameMax} characters).` : ''
}
export const partyMottoWhy = (motto: string): string => ([...motto.trim()].length < PARTY.mottoMin ? `Write a motto (${PARTY.mottoMin}–${PARTY.mottoMax} characters).` : '')

// ---- justice -----------------------------------------------------------------------------------------

export const justiceKey = (cityId: string): string => `justice:${cityId}`
export const justicePath = (cityId: string): string => `/api/politics/justice/overview?city=${cityId}`

/** "12 minutes", "1 h 30 min": how long is left of a sentence. */
export function timeLeft(until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / 60000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} minute${minutes === 1 ? '' : 's'}`
}
export const jailLine = (jail: NonNullable<NonNullable<JusticeResponse['you']>['jail']>, now: number): string =>
  `You are in jail for ${timeLeft(jail.until, now)} more, arrested by ${jail.by.name}. You cannot travel or work, but you can message and call people.`

/** Why the Fight button is off, as a sentence, or '' when it can be pressed. */
export function fightWhy(offline: string | null, you: JusticeResponse['you'], together: boolean, now: number): string {
  if (offline) return offline
  if (!you) return 'Connect to fight.'
  if (you.jail) return `You are in jail for ${timeLeft(you.jail.until, now)} more.`
  return together ? '' : 'You can only fight someone in the same place as you.'
}
/** Why an officer cannot arrest this offender now, or ''. */
export const arrestWhy = (offline: string | null, offence: Pick<OffenceView, 'here' | 'by'>): string => offline ?? (offence.here ? '' : `${offence.by.name} is not here with you. Find them first.`)
/** The seats whose officeholder the caller is. */
export const enrolSeats = (justice: Pick<JusticeResponse, 'seats'> | null | undefined): JusticeSeatView[] => justice?.seats.filter((seat) => seat.canEnrol) ?? []
export const officerOf = (seat: Pick<JusticeSeatView, 'officers'>, id: string): boolean => seat.officers.some((officer) => officer.id === id)
export const offenceLine = (offence: Pick<OffenceView, 'by' | 'against' | 'venue'>): string => `${offence.by.name} attacked ${offence.against.name} at ${offence.venue}`
