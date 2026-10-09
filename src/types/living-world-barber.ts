/** Internal simulated NPC barber apprenticeship protocol. It never describes a real client appointment. */
import type { ApiEnvelope, CityGateErrorCode, CityId, HostErrorCode, JsonBodyErrorCode, OnceErrorCode, SessionErrorCode, StorageErrorCode } from './protocol.ts'
import type { BarberPracticeInput, BarberPracticePlan, BarberPracticeState, BarberPracticeStatus } from '../game/living-world/barber.ts'
import type { BarberLessonId } from '../game/living-world/barber-catalogue.ts'

export interface BarberSessionView {
  sessionId: string
  lessonId: BarberLessonId
  cityId: CityId
  location: string
  revision: number
  nextSequence: number
  status: BarberPracticeStatus
  practice: BarberPracticeState
}
export interface BarberResultView { lessonId: BarberLessonId; styleId: string; earnedAt: number }
export interface BarberResponse {
  ok: boolean
  code: string
  reason?: string
  duplicate?: true
  session: BarberSessionView | null
  plan: BarberPracticePlan | null
  results: BarberResultView[]
  starterTool: boolean
  starterToolCost: number
}
export interface BarberStartRequest { cityId: CityId; lessonId: BarberLessonId; requestId: string }
export interface BarberControlPacket { cityId: CityId; sessionId: string; revision: number; sequence: number; frames: BarberPracticeInput[] }
export interface BarberLifecycleRequest { cityId: CityId; requestId: string; sessionId: string; revision: number }
export interface BarberClaimRequest { cityId: CityId; lessonId: BarberLessonId; sessionId: string; requestId: string }
export interface BarberUpgradeRequest { cityId: CityId; requestId: string }

type BarberHttpError = HostErrorCode | SessionErrorCode | StorageErrorCode | CityGateErrorCode
  | 'invalid_city' | 'rate_limited' | 'busy' | 'onboarding_required' | 'barber_location_unavailable' | 'barber_storage_unavailable' | 'barber_record_too_large'
export interface LivingWorldBarberRoutes {
  'GET /api/living-world/barber': { query: { city: CityId }; response: ApiEnvelope & BarberResponse; errors: BarberHttpError }
  'POST /api/living-world/barber/start': { body: BarberStartRequest; response: ApiEnvelope & BarberResponse; errors: BarberHttpError | JsonBodyErrorCode | OnceErrorCode | 'invalid_barber_request' }
  'POST /api/living-world/barber/input': { body: BarberControlPacket; response: ApiEnvelope & BarberResponse; errors: BarberHttpError | JsonBodyErrorCode | 'invalid_barber_packet' }
  'POST /api/living-world/barber/pause': { body: BarberLifecycleRequest; response: ApiEnvelope & BarberResponse; errors: BarberHttpError | JsonBodyErrorCode | OnceErrorCode | 'invalid_barber_request' }
  'POST /api/living-world/barber/resume': { body: BarberLifecycleRequest; response: ApiEnvelope & BarberResponse; errors: BarberHttpError | JsonBodyErrorCode | OnceErrorCode | 'invalid_barber_request' }
  'POST /api/living-world/barber/claim': { body: BarberClaimRequest; response: ApiEnvelope & BarberResponse; errors: BarberHttpError | JsonBodyErrorCode | OnceErrorCode | 'invalid_barber_request' }
  'POST /api/living-world/barber/upgrade': { body: BarberUpgradeRequest; response: ApiEnvelope & BarberResponse; errors: BarberHttpError | JsonBodyErrorCode | OnceErrorCode | 'invalid_barber_request' }
}
