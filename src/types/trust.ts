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
  adultVerified?: true
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
  /** Provider-only signed raw bytes; unavailable through the player's JSON client. */
  'POST /api/trust/dojah/webhook': { body: never; response: Ok<TrustAnswer>; errors: HostErrorCode | JsonBodyErrorCode | StorageErrorCode | 'provider_unavailable' | 'invalid_signature' | 'unsupported_verification_result' | 'verification_storage_invalid' }
  'POST /api/trust/phone/complete': { body: { clientId: string; csrf: string; idToken: string }; response: Ok<TrustAnswer & { tier: TrustTier }>; errors: TrustWrite | 'provider_unavailable' | 'origin_required' | 'csrf_rejected' | 'account_required' | 'invalid_token' | 'linked_phone_required' | 'account_changed' }
  'POST /api/trust/id/start': { body: { clientId: string; consent: true }; response: Ok<TrustAnswer & { ref: string; appId: string; publicKey: string; widgetId: string; environment: string }>; errors: TrustWrite | 'provider_unavailable' | 'origin_required' | 'verification_consent_required' | 'account_required' | 'verification_capacity' | 'verification_storage_invalid' }
  'GET /api/trust/id/result': { response: Ok<{ ref: string; status: 'pending' | 'passed' | 'failed' | 'expired'; environment: string }>; errors: TrustRead | 'account_required' | 'verification_unavailable' }
  'GET /api/trust/me': { response: Ok<TrustMe>; errors: TrustRead }
  'GET /api/trust/profile/:id': { response: Ok<{ badge: TrustBadge }>; errors: TrustRead | 'invalid_player' | 'unknown_player' }
  'POST /api/trust/check/:kind/start': { body: Record<string, never>; response: Ok<TrustAnswer>; errors: TrustWrite | 'unknown_check' }
  'POST /api/trust/report': { body: { about: string; reason: TrustReportReason; note?: string }; response: Ok<TrustAnswer>; errors: TrustWrite | 'invalid_reason' | 'unknown_player' }
}
