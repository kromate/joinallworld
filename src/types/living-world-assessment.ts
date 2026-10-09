/** Registered cpe-101 lab; the server derives and settles the existing course mark. */
import type { AssessmentPracticeGate, AssessmentPracticeView } from '../campus/unilag/assessment-practice.ts'
import type { ApiEnvelope, CityGateErrorCode, CityId, HostErrorCode, JsonBodyErrorCode, OnceErrorCode, SessionErrorCode, StorageErrorCode } from './protocol.ts'

export type AssessmentOperation = { kind: 'probe' | 'inspect'; a: boolean; b: boolean }
  | { kind: 'repair'; gate: AssessmentPracticeGate }
  | { kind: 'submit' }
export interface AssessmentResponse {
  ok: boolean
  code: string
  feedback?: string
  duplicate?: true
  term: { semester: 1; startDay: number; courseId: 'cpe-101' } | null
  practice: AssessmentPracticeView | null
  revision: number | null
  assignmentMark: number | null
}
export interface AssessmentStartRequest { cityId: CityId; requestId: string }
export interface AssessmentStepRequest extends AssessmentStartRequest { expectedRevision: number; operation: AssessmentOperation }
type AssessmentError = HostErrorCode | SessionErrorCode | StorageErrorCode | CityGateErrorCode
  | 'invalid_city' | 'rate_limited' | 'busy' | 'onboarding_required' | 'city_moved'
  | 'invalid_assessment_request' | 'assessment_scenario_unavailable' | 'assessment_storage_unavailable' | 'assessment_record_too_large'
export interface LivingWorldAssessmentRoutes {
  'GET /api/living-world/assessment': { query: { city: CityId }; response: ApiEnvelope & AssessmentResponse; errors: AssessmentError }
  'POST /api/living-world/assessment/start': { body: AssessmentStartRequest; response: ApiEnvelope & AssessmentResponse; errors: AssessmentError | JsonBodyErrorCode | OnceErrorCode }
  'POST /api/living-world/assessment/step': { body: AssessmentStepRequest; response: ApiEnvelope & AssessmentResponse; errors: AssessmentError | JsonBodyErrorCode | OnceErrorCode }
}
