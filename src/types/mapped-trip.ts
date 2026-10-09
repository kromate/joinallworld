import type { CityId } from './protocol.ts'
import type { DrivingInput, DrivingRoute } from '../game/living-world/driving.ts'

export interface MappedTripMotion {
  routeId: string
  routeVersion: string
  position: { x: number; z: number }
  heading: number
  speed: number
  checkpointIndex: number
  checkpointEntry: 'blocked' | 'armed' | 'entered'
  stopDwellMs: number
  status: 'running' | 'paused' | 'complete'
  feedback: string
}

/** Private, server-owned mapped vehicle session contract. No client pose or completion input exists. */
export interface MappedTripView {
  tripId: string
  fleetUnitId: string
  cityId: CityId
  location: string
  routeId: string
  routeVersion: string
  revision: number
  nextSequence: number
  route: DrivingRoute
  state: MappedTripMotion
  supplierCheckpoint: number
  shopCheckpoint: number
  depotCheckpoint: number
  recovery: boolean
}

export interface MappedTripResponse {
  ok: boolean
  code: string
  reason?: string
  duplicate?: true
  trip: MappedTripView | null
  frameMs: 100
  maxFrames: 5
}

export interface MappedTripStartRequest { cityId: CityId; requestId: string }
export interface MappedTripControlRequest {
  cityId: CityId
  tripId: string
  sequence: number
  frames: DrivingInput[]
}
export interface MappedTripLifecycleRequest {
  cityId: CityId
  requestId: string
  tripId: string
  revision: number
}
