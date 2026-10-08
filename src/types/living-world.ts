/** Internal practice protocol. The server owns every state and course field. */
import type { CityId, CityGateErrorCode, HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, SessionErrorCode, StorageErrorCode } from './protocol.ts'
import type { DrivingInput, DrivingRoute, DrivingState } from '../game/living-world/driving.ts'
import type { Qualification } from '../game/living-world/journey.ts'

export interface QualificationResponse {
  ok: boolean
  code: string
  reason?: string
  duplicate?: true
  qualification: Qualification | null
  valid: boolean
}
export interface QualificationClaimRequest { cityId: CityId; requestId: string; journeyId: string }

export interface DrivingSessionView {
  journeyId: string
  cityId: CityId
  location: string
  /** Increases for accepted controls, pause and resume; late views cannot rewind a newer one. */
  revision: number
  /** Monotonic packet sequence, rather than a client frame counter. */
  nextSequence: number
  state: DrivingState
}
export interface DrivingResponse {
  ok: boolean
  code: string
  reason?: string
  duplicate?: true
  session: DrivingSessionView | null
  course: DrivingRoute
  frameMs: 100
  maxFrames: 5
}
export interface DrivingControlPacket {
  cityId: CityId
  journeyId: string
  sequence: number
  frames: DrivingInput[]
}
/** Start uses cityId/requestId. Pause/resume also require this exact journeyId/revision. */
export interface DrivingLifecycleRequest {
  cityId: CityId
  requestId: string
  journeyId: string
  revision: number
}

export interface DrivingStartRequest { cityId: CityId; requestId: string }
type DrivingHttpError = HostErrorCode | SessionErrorCode | StorageErrorCode | CityGateErrorCode
  | 'invalid_city' | 'rate_limited' | 'busy' | 'onboarding_required'
  | 'driving_location_unavailable' | 'driving_storage_unavailable' | 'driving_record_too_large'
export interface LivingWorldHttpRoutes {
  'GET /api/living-world/qualification': { query: { city: CityId }; response: Ok<QualificationResponse>; errors: DrivingHttpError | 'qualification_storage_unavailable' }
  'POST /api/living-world/qualification/claim': { body: QualificationClaimRequest; response: Ok<QualificationResponse>; errors: DrivingHttpError | JsonBodyErrorCode | OnceErrorCode | 'qualification_storage_unavailable' | 'invalid_qualification_request' }
  'GET /api/living-world/driving': { query: { city: CityId }; response: Ok<DrivingResponse>; errors: DrivingHttpError }
  'POST /api/living-world/driving/start': { body: DrivingStartRequest; response: Ok<DrivingResponse>; errors: DrivingHttpError | JsonBodyErrorCode | OnceErrorCode | 'invalid_driving_request' }
  'POST /api/living-world/driving/input': { body: DrivingControlPacket; response: Ok<DrivingResponse>; errors: DrivingHttpError | JsonBodyErrorCode | 'invalid_driving_packet' }
  'POST /api/living-world/driving/resume': { body: DrivingLifecycleRequest; response: Ok<DrivingResponse>; errors: DrivingHttpError | JsonBodyErrorCode | OnceErrorCode | 'invalid_driving_request' }
  'POST /api/living-world/driving/pause': { body: DrivingLifecycleRequest; response: Ok<DrivingResponse>; errors: DrivingHttpError | JsonBodyErrorCode | OnceErrorCode | 'invalid_driving_request' }
}
