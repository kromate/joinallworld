/** Fictional NPC process training; no live case, legal service or financial authority. */
import type { ApiEnvelope, CityGateErrorCode, CityId, HostErrorCode, JsonBodyErrorCode, OnceErrorCode, SessionErrorCode, StorageErrorCode } from './protocol.ts'
import type { JusticePracticeAction, JusticePracticeView } from '../game/living-world/justice-practice.ts'

export interface JusticePracticeResponse {
  ok: boolean
  code: string
  feedback?: string
  duplicate?: true
  practice: JusticePracticeView | null
  revision: number | null
}
export interface JusticePracticeStartRequest { cityId: CityId; requestId: string }
export interface JusticePracticeStepRequest extends JusticePracticeStartRequest {
  expectedRevision: number
  action: JusticePracticeAction
}
type JusticePracticeError = HostErrorCode | SessionErrorCode | StorageErrorCode | CityGateErrorCode
  | 'invalid_city' | 'rate_limited' | 'busy' | 'onboarding_required' | 'city_moved'
  | 'justice_practice_scenario_unavailable' | 'justice_practice_storage_unavailable' | 'justice_practice_record_too_large'
export interface LivingWorldJusticeRoutes {
  'GET /api/living-world/justice-practice': { query: { city: CityId }; response: ApiEnvelope & JusticePracticeResponse; errors: JusticePracticeError }
  'POST /api/living-world/justice-practice/start': { body: JusticePracticeStartRequest; response: ApiEnvelope & JusticePracticeResponse; errors: JusticePracticeError | JsonBodyErrorCode | OnceErrorCode | 'invalid_justice_practice_request' }
  'POST /api/living-world/justice-practice/step': { body: JusticePracticeStepRequest; response: ApiEnvelope & JusticePracticeResponse; errors: JusticePracticeError | JsonBodyErrorCode | OnceErrorCode | 'invalid_justice_practice_request' }
}
