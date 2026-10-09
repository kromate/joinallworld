/** Fictional NPC learning exercise; no real justice or professional credential authority. */
import type { ApiEnvelope, CityGateErrorCode, CityId, HostErrorCode, JsonBodyErrorCode, OnceErrorCode, SessionErrorCode, StorageErrorCode } from './protocol.ts'
import type { ClerkPracticeView, ClerkPracticeStep } from '../game/living-world/clerk.ts'

export interface ClerkResponse {
  ok: boolean
  code: string
  reason?: string
  duplicate?: true
  practice: ClerkPracticeView | null
  revision: number | null
  claimed: boolean
  reward: 75
}
export interface ClerkStartRequest { cityId: CityId; requestId: string }
export interface ClerkStepRequest extends ClerkStartRequest {
  revision: number
  stepId: Exclude<ClerkPracticeStep, 'complete'>
  evidenceId: string
}
export interface ClerkClaimRequest extends ClerkStartRequest { revision: number }
type ClerkError = HostErrorCode | SessionErrorCode | StorageErrorCode | CityGateErrorCode
  | 'invalid_city' | 'rate_limited' | 'busy' | 'onboarding_required'
  | 'clerk_location_unavailable' | 'clerk_storage_unavailable' | 'clerk_record_too_large' | 'clerk_scenario_unavailable'
export interface LivingWorldClerkRoutes {
  'GET /api/living-world/clerk': { query: { city: CityId }; response: ApiEnvelope & ClerkResponse; errors: ClerkError }
  'POST /api/living-world/clerk/start': { body: ClerkStartRequest; response: ApiEnvelope & ClerkResponse; errors: ClerkError | JsonBodyErrorCode | OnceErrorCode | 'invalid_clerk_request' }
  'POST /api/living-world/clerk/step': { body: ClerkStepRequest; response: ApiEnvelope & ClerkResponse; errors: ClerkError | JsonBodyErrorCode | OnceErrorCode | 'invalid_clerk_request' }
  'POST /api/living-world/clerk/claim': { body: ClerkClaimRequest; response: ApiEnvelope & ClerkResponse; errors: ClerkError | JsonBodyErrorCode | OnceErrorCode | 'invalid_clerk_request' }
}
