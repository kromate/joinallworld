/**
 * The trust layer's wire shapes (server/routes/trust.ts). Rules: src/game/trust/. No answer carries a phone number, an ID number,
 * a birthday or an address: a badge is a tier, a count of upheld complaints and whether listings are held.
 */
import type { PostKind, TrustBadge, TrustRefusal, TrustReportReason, TrustTier } from '../game/trust/index.ts'
import type { ApiEnvelope, HostErrorCode, JsonBodyErrorCode, Ok, SessionErrorCode, StorageErrorCode } from './protocol.ts'

export type CheckState = 'ready' | 'unavailable'
export interface TrustMe extends ApiEnvelope {
  tier: TrustTier
  label: string
  /** The age answer: true 18 or older, false under 18, null not answered. */
  adult: boolean | null
  complaints: number
  held: boolean
  checks: { phone: CheckState; id: CheckState }
  /** For each kind of post: null when allowed, or why not. */
  can: Record<PostKind, TrustRefusal | null>
}
export interface TrustAnswer extends ApiEnvelope { ok: boolean; code: string; reason?: string; id?: string; duplicate?: true }

type TrustRead = HostErrorCode | SessionErrorCode | 'rate_limited'
type TrustWrite = TrustRead | JsonBodyErrorCode | StorageErrorCode
export interface TrustHttpRoutes {
  'GET /api/trust/me': { response: Ok<TrustMe>; errors: TrustRead }
  'GET /api/trust/profile/:id': { response: Ok<{ badge: TrustBadge }>; errors: TrustRead | 'invalid_player' | 'unknown_player' }
  'POST /api/trust/check/:kind/start': { body: Record<string, never>; response: Ok<TrustAnswer>; errors: TrustWrite | 'unknown_check' }
  'POST /api/trust/report': { body: { about: string; reason: TrustReportReason; note?: string }; response: Ok<TrustAnswer>; errors: TrustWrite | 'invalid_reason' | 'unknown_player' }
}
