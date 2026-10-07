import type { StreetJourney, WireStreetTile } from '../street/types.ts'
import type { ActionFailCode } from './actions.ts'
import type { HostErrorCode, JsonBodyErrorCode, Ok, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts'

type StreetRefusal = ActionFailCode<'street.place'> | 'plot_required' | 'street_location_changed' | 'gate_required' | 'street_capacity' | 'not_walking' | 'street_sequence_changed' | 'street_move_refused' | 'door_out_of_range' | 'other_estate' | 'venue_unavailable' | 'street_journey_missing'
type StreetErrors = HostErrorCode | SessionErrorCode | StorageErrorCode | 'city_moved' | 'street_unavailable' | 'estate_gate_unavailable' | 'street_journey_missing' | 'street_tile_out_of_range' | 'invalid_street_tile' | 'invalid_street_position' | 'invalid_street_door' | 'invalid_city' | 'street_rate_limited'
type Refused = { ok: false; code: StreetRefusal; reason: string }
type JourneyResult<Code extends string> = Ok<{ ok: true; code: Code; journey: StreetJourney } | Refused>
type Receipt = { clientId: TimedId }

export interface StreetHttpRoutes {
  'GET /api/street/me': { response: Ok<{ ok: true; code: 'street'; journey: StreetJourney }>; errors: StreetErrors }
  'GET /api/street/tile': { response: Ok<WireStreetTile>; errors: StreetErrors }
  'POST /api/street/begin': { body: Receipt; response: JourneyResult<'started'>; errors: StreetErrors | JsonBodyErrorCode }
  'POST /api/street/move': { body: { journeyId: string; seq: number; x: number; z: number }; response: Ok<{ ok: true; code: 'moved'; journey: StreetJourney; duplicate?: true } | Refused>; errors: StreetErrors | JsonBodyErrorCode }
  'POST /api/street/enter': { body: Receipt & { journeyId: string; doorId: string }; response: Ok<{ ok: true; code: 'entered'; location: string; journey: StreetJourney } | Refused>; errors: StreetErrors | JsonBodyErrorCode }
  'POST /api/street/exit': { body: Receipt; response: JourneyResult<'exited'>; errors: StreetErrors | JsonBodyErrorCode }
}
