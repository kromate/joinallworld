/**
 * Politics: stored records and wire shapes. Design: docs/POLITICS.md. The rules are in src/game/content/politics.ts, the shared
 * record and its routes under server/politics/ and server/routes/politics.ts.
 */
import type { LifeState } from './life.ts'
import type { CityId, HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, PlayerRef, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts';

export type TierId = 'city' | 'state' | 'nation'
export type LeverId = 'marketLevy' | 'salesTax' | 'vat' | 'tradeDuty' | 'citySentence' | 'stateSentence' | 'nationSentence'
export type LeverUnit = '%' | 'min'

/** The levers an officeholder set for their term. A lever that is absent is at its base value. */
export interface DecreeRecord {
  /** The week of the election that put the officeholder in office: the decree lapses with that term. */
  week: number
  by: PlayerRef
  at: number
  values: Partial<Record<LeverId, number>>
}

// ---- justice ---------------------------------------------------------------------------------------

export type OffenceKind = 'assault'
export interface OffenceRecord {
  id: string
  kind: OffenceKind
  by: PlayerRef
  against: PlayerRef
  city: string
  venue: string
  at: number
  /** The attacker won the fight. */
  won: boolean
  status: 'open' | 'arrested'
}
export interface JailRecord {
  /** Server ms the sentence ends. */
  until: number
  at: number
  minutes: number
  offence: string
  /** The arresting officer. */
  by: PlayerRef
  /** The seat whose officer made the arrest (its sentence lever set the time). */
  tier: TierId
}
/** A police officer: enrolled by the officeholder of `scope` for that officeholder's term. */
export interface PoliceRecord {
  scope: string
  tier: TierId
  /** The term (week of the election) of the officeholder who enrolled them: the enrolment lapses with it. */
  week: number
  by: PlayerRef
  name: string
  at: number
}
export interface JusticeRecord {
  offences: Record<string, OffenceRecord>
  jail: Record<string, JailRecord>
  police: Record<string, PoliceRecord>
  /** Player id → server ms of their last fight. */
  fights: Record<string, number>
  /** `<attacker>|<victim>` → server ms of their last fight. */
  pairs: Record<string, number>
}

export interface LedgerLine { at: number; kind: 'levy' | 'fee' | 'salary'; amount: number; note: string }
export interface TreasuryRecord { balance: number; ledger: LedgerLine[] }

export interface PartyRecord {
  id: string
  name: string
  motto: string
  colour: string
  founder: PlayerRef
  at: number
}

// ---- the wire: what the routes under /api/politics/ answer -------------------------------------------

export interface PartyView {
  id: string
  name: string
  motto: string
  colour: string
  founder: PlayerRef
  members: number
  mine: boolean
}
export interface LeverView {
  id: LeverId
  label: string
  about: string
  min: number
  max: number
  base: number
  unit: LeverUnit
  /** What is in force now: the sitting officeholder's decree, else the base. */
  value: number
}
/** One seat as a resident of the city sees it. The ballot itself is GET /api/civic/gov?tier=. */
export interface SeatView {
  tier: TierId
  id: string
  name: string
  title: string
  /** Naira, not refunded. */
  fee: number
  /** The fewest votes an election needs to count: below it the election is void and the seat stays empty. */
  quorum: number
  /** Candidate id → the party they stand under, for this week's ballot. An independent has no entry. */
  parties: Record<string, string>
  /** The party the sitting officeholder was elected under. */
  officeholderParty: string | null
  decree: { by: PlayerRef; at: number } | null
  levers: LeverView[]
  treasury: TreasuryRecord
  /** Null for a visitor who is not signed in. */
  you: { isOfficeholder: boolean; salary: number } | null
}
export interface PoliticsResponse {
  city: CityId
  seats: SeatView[]
  parties: PartyView[]
  you: { party: string | null; canFound: boolean } | null
  partyRules: { fee: number; nameMin: number; nameMax: number; mottoMin: number; mottoMax: number; colours: string[] }
}
export interface PoliticsWriteResponse { ok: boolean; code: string; reason?: string; duplicate?: true; state?: LifeState; politics: PoliticsResponse }

// ---- justice on the wire ---------------------------------------------------------------------------

export interface OffenceView { id: string; kind: OffenceKind; by: PlayerRef; against: PlayerRef; city: string; venue: string; at: number; /** The offender is where the officer stands. */ here: boolean }
export interface JusticeSeatView {
  tier: TierId
  scope: string
  title: string
  name: string
  officers: PlayerRef[]
  capacity: number
  /** The caller holds this seat now, so may enrol and dismiss. */
  canEnrol: boolean
  /** The assault sentence in force, in minutes. */
  sentence: number
}
export interface JusticeResponse {
  city: CityId
  seats: JusticeSeatView[]
  you: { jail: { until: number; minutes: number; by: PlayerRef } | null; police: { tier: TierId; scope: string } | null; wanted: OffenceView[] } | null
  /** Open offences an officer may act on, newest first. Empty for everyone else. */
  offences: OffenceView[]
  rules: { minDays: number; minEnergy: number; cooldownMinutes: number; offenceHours: number; arrestsPerHour: number }
}
export interface JusticeWriteResponse { ok: boolean; code: string; reason?: string; duplicate?: true; state?: LifeState; justice: JusticeResponse }

type PoliticsRead = HostErrorCode | 'invalid_city' | 'politics_rate_limited'
type PoliticsWrite = PoliticsRead | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode

export interface PoliticsHttpRoutes {
  'GET /api/politics/overview': { query: { city: CityId }; response: Ok<PoliticsResponse>; errors: PoliticsRead }
  'POST /api/politics/decree': { body: { cityId: CityId; tier: TierId; lever: LeverId; value: number }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite | 'invalid_tier' | 'no_such_seat' }
  'POST /api/politics/salary': { body: { cityId: CityId; tier: TierId; requestId: TimedId }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite | OnceErrorCode | 'invalid_tier' | 'no_such_seat' }
  'POST /api/politics/party/found': { body: { cityId: CityId; name: string; motto: string; colour: string; requestId: TimedId }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite | OnceErrorCode }
  'POST /api/politics/party/join': { body: { cityId: CityId; party: string }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite }
  'GET /api/politics/justice/overview': { query: { city: CityId }; response: Ok<JusticeResponse>; errors: PoliticsRead }
  'POST /api/politics/justice/fight': { body: { cityId: CityId; target: string; requestId: TimedId }; response: Ok<JusticeWriteResponse>; errors: PoliticsWrite | OnceErrorCode }
  'POST /api/politics/justice/enrol': { body: { cityId: CityId; tier: TierId; player: string }; response: Ok<JusticeWriteResponse>; errors: PoliticsWrite | 'invalid_tier' | 'no_such_seat' }
  'POST /api/politics/justice/dismiss': { body: { cityId: CityId; tier: TierId; player: string }; response: Ok<JusticeWriteResponse>; errors: PoliticsWrite | 'invalid_tier' | 'no_such_seat' }
  'POST /api/politics/justice/arrest': { body: { cityId: CityId; offence: string; requestId: TimedId }; response: Ok<JusticeWriteResponse>; errors: PoliticsWrite | OnceErrorCode }
  'POST /api/politics/party/leave': { body: { cityId: CityId }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite }
}
