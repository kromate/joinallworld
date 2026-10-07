/**
 * The public record: what the routes under /api/world/records answer. Nothing here is private: names and counts, never who voted for whom.
 * The chain that seals it is src/records/chain.ts; the rules for what goes in are in docs/POLITICS.md.
 */
import type { CityId, Ok } from './protocol.ts'
import type { HostErrorCode } from './protocol.ts'

export type RecordKind = 'term' | 'impeachment' | 'ruling' | 'party' | 'operator'
/** Short facts of one entry: whole numbers, text and true/false, nothing nested. */
export type RecordFacts = Record<string, string | number | boolean | null>

export interface RecordEntryView {
  n: number
  at: number
  kind: RecordKind
  /** `city:<id>`, `state:<id>`, `nation:<id>`, or `world`. */
  scope: string
  scopeName: string
  /** The term (the week of its election), when the entry belongs to one. */
  week: number | null
  /** One sentence, as the Hall of Records shows it. */
  title: string
  facts: RecordFacts
  prev: string
  hash: string
}
export interface RecordsResponse {
  entries: RecordEntryView[]
  /** The `n` to ask for next, to go further back; null at the start. */
  before: number | null
  head: string
  count: number
}
export interface RecordsProof { algorithm: 'sha256'; count: number; head: string; genesis: string; how: string }

type RecordsRead = HostErrorCode | 'records_rate_limited' | 'invalid_query'
export interface RecordsHttpRoutes {
  'GET /api/world/records': { query: { scope?: string; kind?: RecordKind; before?: number; limit?: number; city?: CityId }; response: Ok<RecordsResponse>; errors: RecordsRead }
  'GET /api/world/records/proof': { response: Ok<RecordsProof>; errors: RecordsRead }
}
