/**
 * Politics: stored records and wire shapes. Design: docs/POLITICS.md. The rules are in src/game/content/politics.ts, the shared
 * record and its routes under server/politics/ and server/routes/politics.ts.
 */
import type { LifeState } from './life.ts'
import type { CityId, HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, PlayerRef, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts';

export type TierId = 'city' | 'state' | 'nation'
export type LeverId = 'marketLevy' | 'salesTax' | 'vat' | 'tradeDuty'

/** The levers an officeholder set for their term. A lever that is absent is at its base value. */
export interface DecreeRecord {
  /** The week of the election that put the officeholder in office: the decree lapses with that term. */
  week: number
  by: PlayerRef
  at: number
  values: Partial<Record<LeverId, number>>
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
  unit: '%'
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

type PoliticsRead = HostErrorCode | 'invalid_city' | 'politics_rate_limited'
type PoliticsWrite = PoliticsRead | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode

export interface PoliticsHttpRoutes {
  'GET /api/politics/overview': { query: { city: CityId }; response: Ok<PoliticsResponse>; errors: PoliticsRead }
  'POST /api/politics/decree': { body: { cityId: CityId; tier: TierId; lever: LeverId; value: number }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite | 'invalid_tier' | 'no_such_seat' }
  'POST /api/politics/salary': { body: { cityId: CityId; tier: TierId; requestId: TimedId }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite | OnceErrorCode | 'invalid_tier' | 'no_such_seat' }
  'POST /api/politics/party/found': { body: { cityId: CityId; name: string; motto: string; colour: string; requestId: TimedId }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite | OnceErrorCode }
  'POST /api/politics/party/join': { body: { cityId: CityId; party: string }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite }
  'POST /api/politics/party/leave': { body: { cityId: CityId }; response: Ok<PoliticsWriteResponse>; errors: PoliticsWrite }
}
