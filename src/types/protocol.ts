/**
 * Wire protocol between the browser and the game servers: every HTTP route and every `/socket`
 * frame that is not specific to the social, civic, support, world or growth features (those live
 * in social.ts, civic.ts, support.ts, world.ts and growth.ts and are composed into `HttpRoutes`,
 * `ClientFrame` and `ServerFrame` here).
 *
 * Derived from the code, not from intent:
 *   server/server.ts            the route host (envelope, error bodies, socket error frames)
 *   server/routes/core.ts       session, life, action, voice configuration, health
 *   server/protocol.ts          validation shared with the Cloudflare Worker
 *   server/ws/rooms.ts          venue rooms: join, move, voice-state, signal, chat
 *   deploy/cloudflare-worker.ts the second host. It builds the same server context and runs the SAME route and socket
 *                               registries (server/routes/index.ts, server/ws/index.ts), so it answers every route and
 *                               accepts every frame below; the few places it still differs are marked `WORKER:`
 *
 * Types only, plus the runtime key lists at the bottom that src/types/protocol.test.ts compares
 * with what the server really registers and sends.
 */
import type { LifeState } from './life.ts'
import type { ActionType } from './actions.ts'
import type { SocialClientFrame, SocialHttpRoutes, SocialServerFrame } from './social.ts'
import type { CivicHttpRoutes } from './civic.ts'
import type { ModerationHttpRoutes, SupportHttpRoutes } from './support.ts'
import type { WorldHttpRoutes } from './world.ts'
import type { GrowthHttpRoutes, GrowthModerationHttpRoutes, TableClientFrame, TableErrorCode, TableServerFrame } from './growth.ts'
import type { CampusHttpRoutes } from './campus.ts'
import type { CallClientFrame, CallServerFrame } from './calls.ts'
import type { AccountHttpRoutes } from './account.ts'

// ---- shared primitives ---------------------------------------------------------------------------

/**
 * server/protocol.ts CITY_IDS: the cities a server keeps lives for. (The rules engine knows more
 * cities as data — life.ts `WorldCityId` — but only these can be asked for.)
 */
export type CityId = 'lagos' | 'ibadan'

/** The only identity a server ever exposes: `id` is the session's PUBLIC id, never the cookie secret. */
export interface PublicSession {
  id: string
  name: string
}
/**
 * The caller's OWN session, as the session routes answer it (server/routes/core.ts ownSession):
 * the public identity plus the cities this session has a life in.
 */
export interface OwnSession extends PublicSession {
  cities?: CityId[]
}
/** `{ id, name }` of any player, as stored and returned by the social and civic features. */
export type PlayerRef = PublicSession

/** `<unix ms>:<uuid>` — the form of an action id and of every exactly-once client/request id. */
export type TimedId = `${number}:${string}`

// ---- HTTP envelope -------------------------------------------------------------------------------

/**
 * Fields the Node route host adds to every success whose body is a JSON object (server.js `handle`).
 * WORKER: the same envelope (its store refuses everything after an uncertain write, so `storage: 'failing'` there
 * accompanies the last answers before the object restarts).
 */
export interface ApiEnvelope {
  /** Server clock in ms. The client keeps `serverTime - Date.now()` as its clock offset. */
  serverTime: number
  /** Present only while the data file cannot be written: what is shown is stored, nothing new is being saved. */
  storage?: 'failing'
}
export type Ok<T> = T & ApiEnvelope

/**
 * Body of every non-2xx answer: `{ error }`, plus `reason` when the server wrote a sentence for
 * the player (name_not_allowed, muted, storage_unavailable, client_id_required, receipt_quota, …).
 */
export interface ApiErrorBody<Code extends string = string> {
  error: Code
  reason?: string
  // INCONSISTENT: src/client.ts:138,146,147 also reads `payload.code` and `payload.message` from an
  // HTTP error body. No route on either host sends them; only socket `error` frames carry those names.
}

/** A well-formed request the rules refused: HTTP 200, nothing changed. */
export interface Refusal<Code extends string = string> {
  ok: false
  code: Code
  reason: string
}

/** Thrown by the host before any handler runs (server.js). `/api/mod/*` skips `origin_rejected`. */
export type HostErrorCode = 'origin_rejected' | 'rate_limited' | 'not_found' | 'internal_error'
/** request.json(): 415, 413 (body over 8 KB), 400. */
export type JsonBodyErrorCode = 'json_required' | 'body_too_large' | 'invalid_json'
/** request.requireSession(): 401. */
export type SessionErrorCode = 'device_session_required'
/** A write that could not be saved was undone: 503 with a `reason` (server/store.ts storageError). */
export type StorageErrorCode = 'storage_unavailable'
/** ctx.once / ctx.onceId (server/routes/once.ts): 400, 400, 409, 409, 429, 503. */
export type OnceErrorCode = 'client_id_required' | 'invalid_client_id' | 'client_id_expired' | 'client_id_conflict' | 'receipt_quota' | 'receipts_full'

/** One entry of a route map. `errors` is the union of `error` codes that route can answer with. */
export interface RouteSpec {
  params?: object
  query?: object
  body?: object
  response: object
  errors: string
}

// ---- core routes ---------------------------------------------------------------------------------

export interface SessionRequest {
  /** 3–24 characters, no control characters, and it must pass the text filter (validateName). */
  name: string
  /**
   * Only the literal `true`, and only when the request CREATES a session: lives of that session
   * start as GUESTS of the quick start — held until their look is confirmed (one action), then
   * playing in public venues until they settle in. Ignored for an existing session.
   */
  onboarding?: boolean
}
export interface SessionResponse extends ApiEnvelope {
  session: OwnSession
}

export interface LifeResponse extends ApiEnvelope {
  /** The server-held life, settled to `serverTime`. */
  state: LifeState
}

/**
 * Envelope of POST /api/action (protocol.js validateActionPayload). `payload`, when present, must
 * be a plain object of at most 2048 bytes of JSON.
 */
export interface ActionRequest {
  actionId: TimedId
  cityId: CityId
  type: ActionType
  payload?: Record<string, unknown>
  /** Legacy top-level fields, folded into the payload by src/life.ts dispatch and part of the receipt fingerprint. */
  id?: string
  mode?: string
}
/**
 * HTTP 200 whether the action was accepted or refused by the rules. A repeat of the same action id
 * answers `{ ok, code, state, duplicate: true }` with the CURRENT state and no `reason`.
 */
export interface ActionResponse extends ApiEnvelope {
  ok: boolean
  code: string
  state: LifeState
  /** Only on a first refusal that has a sentence; the same sentence is in `state.message`. */
  reason?: string
  duplicate?: true
}

export interface IceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}
export interface VoiceConfigResponse extends ApiEnvelope {
  iceServers: IceServerConfig[]
  turnConfigured: boolean
  mode: 'stun-only' | 'turn'
  /** Server ms. Only with `mode: 'turn'`. src/community.ts also accepts a date string here; no host sends one. */
  expiresAt?: number
  /** protocol.js VOICE_RADIUS. */
  // INCONSISTENT: src/community.ts:39 hard-codes VOICE_RADIUS = 12 and never reads this field.
  radius: number
}

/** Node: `{ ok, build }` (+ envelope). */
export interface HealthResponse extends ApiEnvelope {
  ok: true
  build: string
}
/**
 * WORKER: the same route (server/routes/core.ts), to which the host adds which transport answered and the build
 * under its older key as well.
 */
export interface WorkerHealthResponse extends HealthResponse {
  transport: 'cloudflare'
  buildId: string
}

export type ActionErrorCode = 'invalid_action' | 'invalid_payload' | 'action_expired' | 'action_id_conflict' | 'action_history_full'
/**
 * 409 with a `reason`: the session's one character travelled to another city ('estate.relocate'),
 * so it has no life left in the city asked for and none is started there (server/routes/world.ts cityGate).
 */
// INCONSISTENT: server/routes/world.ts:60 also puts `city` (where the character is now) on the thrown error,
// but the host's error body carries only `error` and `reason` (server/server.ts:341-342), so it never reaches a client.
export type CityGateErrorCode = 'city_moved'

export interface CoreHttpRoutes {
  'GET /api/health': { response: HealthResponse; errors: HostErrorCode }
  'POST /api/session': {
    body: SessionRequest
    response: SessionResponse
    /** `muted` (403, with reason): a muted player sent a DIFFERENT name. `device_capacity`: 503. */
    errors: HostErrorCode | JsonBodyErrorCode | StorageErrorCode | 'invalid_name' | 'name_not_allowed' | 'device_capacity' | 'muted'
  }
  'GET /api/session': { response: SessionResponse; errors: HostErrorCode | SessionErrorCode }
  'GET /api/life': {
    query: { city: CityId }
    response: LifeResponse
    errors: HostErrorCode | SessionErrorCode | StorageErrorCode | CityGateErrorCode | 'invalid_city'
  }
  'POST /api/action': {
    body: ActionRequest
    response: ActionResponse
    errors: HostErrorCode | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode | CityGateErrorCode | ActionErrorCode
  }
  'GET /api/voice-config': {
    response: VoiceConfigResponse
    /**
     * Node: 403 room_membership_required, 429 voice_config_rate_limited, 503 voice_config_unavailable.
     * WORKER: answered by the host itself (the bounded relay test, deploy/turn-provider.ts): the same refusals, plus 429 relay_test_limit.
     */
    // INCONSISTENT: the two hosts use different codes AND statuses for "not in a room" and "too many requests".
    errors: HostErrorCode | SessionErrorCode | 'room_membership_required' | 'voice_config_rate_limited' | 'voice_config_unavailable' | 'join_required' | 'relay_test_limit'
  }
}

/**
 * Every route the Node server registers through server/routes/index.ts ROUTE_MODULES. (The two
 * telemetry endpoints are added beside them by server/server.ts: growth.ts TelemetryHttpRoutes.)
 */
export interface HttpRoutes extends CoreHttpRoutes, SocialHttpRoutes, CivicHttpRoutes, SupportHttpRoutes, ModerationHttpRoutes, WorldHttpRoutes,
  GrowthHttpRoutes, GrowthModerationHttpRoutes, CampusHttpRoutes, AccountHttpRoutes {}
export type HttpRouteKey = keyof HttpRoutes
export type ResponseOf<K extends HttpRouteKey> = HttpRoutes[K]['response']
export type ErrorCodeOf<K extends HttpRouteKey> = HttpRoutes[K]['errors']

// ---- WebSocket /socket: venue rooms (server/ws/rooms.ts) -----------------------------------------
//
// The socket is opened with the session cookie and an Origin header; a refused upgrade is a bare
// HTTP 403 on Node (WORKER: a JSON error — 403 origin_rejected or websocket_required, 401 device_session_required,
// 429 rate_limited, 503 socket_capacity). Frames are JSON text of at most 16 KB. There is no `leave` frame on
// either host: a socket leaves its room by joining another one or by closing.

/**
 * Enter a venue room. The server admits the socket only to the venue the stored life occupies.
 * `hostId` (Home only): join THAT player's Home room as an accepted guest.
 */
export interface JoinFrame {
  type: 'join'
  cityId: CityId
  venueId: string
  hostId?: string
}
/** Position in the venue's voice space; both coordinates within ±20. At most 5 a second. */
export interface MoveFrame {
  type: 'move'
  x: number
  z: number
}
export interface VoiceStateFrame {
  type: 'voice-state'
  enabled: boolean
  muted: boolean
}

/** Minimal structural copy of RTCSessionDescriptionInit (this project has no DOM types). */
export interface SessionDescriptionLike {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback'
  sdp?: string
}
/** Minimal structural copy of RTCIceCandidateInit. */
export interface IceCandidateLike {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}
/**
 * What src/community.ts puts in a `signal` frame. Offer, answer and ICE are NOT separate frame
 * types: the server relays `data` untouched (any object whose JSON is at most 12 000 characters)
 * and only checks that the two peers share a room and are within voice distance.
 */
export type SignalData = { description: SessionDescriptionLike } | { candidate: IceCandidateLike }
export interface SignalFrame {
  type: 'signal'
  /** Public id of the peer. */
  to: string
  data: SignalData
}
export interface ChatSendFrame {
  type: 'chat'
  /** 1–500 characters after trimming, no control characters. */
  body: string
  /**
   * Retry key, at most 80 characters. The same id in the same room replays the stored line to the
   * sender only. Node keeps the last 100 per (sender, room) in memory and does not compare the body.
   * WORKER: the retry receipts survive the object's sleep (an id, a time and a digest of the body — never the text),
   * are kept for 24 h, and the same id with another body is `chat_id_conflict`.
   */
  clientId?: string
}
export type RoomClientFrame = JoinFrame | MoveFrame | VoiceStateFrame | SignalFrame | ChatSendFrame

export interface PresenceMember extends PublicSession {
  position: { x: number; z: number }
  /** In voice (any of the player's sockets in this room). */
  enabled: boolean
  /** Muted on every socket of the player in this room. */
  muted: boolean
}
/**
 * The room's member list, sent to every member on each join, leave, move and voice change.
 * Members the recipient has a block with are left out (on both hosts).
 */
export interface PresenceFrame {
  type: 'presence'
  members: PresenceMember[]
}
export interface ChatFrame {
  type: 'chat'
  id: string
  /** Echo of the sender's retry key; absent when none was sent. */
  clientId?: string
  from: PublicSession
  body: string
  at: number
}
export interface SignalRelayFrame {
  type: 'signal'
  /** Public id of the sender. */
  from: string
  data: SignalData
}

/** Codes the Node host and its socket modules answer with (`throw Error('code')`). */
export type NodeSocketErrorCode =
  | 'rate_limited' | 'invalid_message' | 'join_required' | 'internal_error' | 'device_session_required' | 'storage_unavailable'
  | 'invalid_room' | 'onboarding_required' | 'venue_mismatch' | 'not_a_guest' | 'visit_ended'
  | 'invalid_position' | 'move_rate_limited' | 'invalid_voice_state' | 'voice_room_full'
  | 'invalid_signal' | 'peer_not_in_room' | 'peer_out_of_range'
  | 'invalid_chat' | 'text_blocked' | 'muted'
  // malformed social frames (server/social/service.ts throws ctx.fail(400, code))
  | 'invalid_player' | 'invalid_city' | 'invalid_conversation' | 'invalid_answer'
  // refused table frames (server/growth/tables.ts), always with a `reason`
  | TableErrorCode
/** WORKER: codes only the Worker sends, in addition to every code above: a retried chat id with another body, and an expired session on an open socket. */
export type WorkerSocketErrorCode = 'chat_id_conflict' | 'device_session_required'
export type SocketErrorCode = NodeSocketErrorCode | WorkerSocketErrorCode

/**
 * Any refused frame. `code` and `error` always hold the same machine code.
 * Node adds `reason` AND `message` (the same sentence) when the server wrote one for the player —
 * a blocked or muted chat line, an unsaved write — `to` when a `signal` frame was refused, and
 * `clientId` when a `chat` frame was refused. A socket the server dropped from its room gets
 * `venue_mismatch` or `visit_ended` with no other field.
 */
export interface ErrorFrame {
  type: 'error'
  code: SocketErrorCode
  error: SocketErrorCode
  reason?: string
  message?: string
  // INCONSISTENT: server/server.ts:521,549 decide whether to echo `to` with `to !== ws.secret` — a public id
  // compared with the cookie secret, so the test is always true (it was presumably meant to be ws.session.id).
  to?: string
  clientId?: string
}
export type RoomServerFrame = PresenceFrame | ChatFrame | SignalRelayFrame | ErrorFrame

/** Close codes the hosts use: 1008 rate limit / expired session, 1011 server error. */
export type SocketCloseCode = 1008 | 1011

/**
 * WORKER: a hibernating socket cannot be pinged, so the host asks with a frame — `{ type: 'heartbeat' }` — and every
 * browser socket (src/community.ts, src/ui/panels/social-client.js, src/tables/client.ts) answers
 * `{ type: 'heartbeat-ack' }`. Node pings at the protocol level and never sends or expects either.
 */
export interface HeartbeatFrame { type: 'heartbeat' }
export interface HeartbeatAckFrame { type: 'heartbeat-ack' }
/** Everything a browser may send (on the Worker also `HeartbeatAckFrame`). */
export type ClientFrame = RoomClientFrame | SocialClientFrame | TableClientFrame | CallClientFrame
/**
 * Everything a server may send. Clients must ignore types they do not know: the community panel's
 * socket and the social client's socket both receive every frame addressed to the player.
 * WORKER: also `HeartbeatFrame`.
 */
export type ServerFrame = RoomServerFrame | SocialServerFrame | TableServerFrame | CallServerFrame
export type ClientFrameType = ClientFrame['type']
export type ServerFrameType = ServerFrame['type']

// ---- runtime key lists (compared with the running server by protocol.test.ts) -------------------

export const CITY_IDS = ['lagos', 'ibadan'] as const

export const HTTP_ROUTE_KEYS = [
  'GET /api/health',
  'POST /api/session',
  'GET /api/session',
  'GET /api/voice-config',
  'GET /api/life',
  'POST /api/action',
  'GET /api/social/me',
  'POST /api/social/updates/read',
  'GET /api/social/people',
  'GET /api/social/search',
  'GET /api/social/players/:id',
  'POST /api/social/players/:id/interact',
  'POST /api/social/friends/request',
  'POST /api/social/friends/answer',
  'POST /api/social/friends/remove',
  'POST /api/social/block',
  'POST /api/social/unblock',
  'POST /api/social/reports',
  'GET /api/social/conversations',
  'GET /api/social/conversations/:id',
  'POST /api/social/conversations/:id/read',
  'POST /api/social/messages',
  'POST /api/social/groups',
  'POST /api/social/groups/:id',
  'GET /api/social/house/:host',
  'POST /api/social/join',
  'POST /api/social/house/knock',
  'POST /api/social/house/answer',
  'POST /api/social/house/leave',
  'POST /api/social/bae/ask',
  'POST /api/social/bae/answer',
  'POST /api/social/bae/end',
  'POST /api/social/transfers',
  'GET /api/civic/pulse',
  'GET /api/civic/gov',
  'POST /api/civic/gov/run',
  'POST /api/civic/gov/vote',
  'POST /api/civic/gov/announce',
  'GET /api/civic/neighbours',
  'GET /api/civic/ads',
  'POST /api/civic/ads/rent',
  'POST /api/civic/ads/remove',
  'GET /api/civic/hunt',
  'GET /api/civic/radio',
  'POST /api/civic/radio/shoutout',
  'GET /api/civic/richlist',
  'POST /api/civic/prefs',
  'POST /api/support/reports',
  'GET /api/support/statement',
  'GET /api/support/reports',
  'GET /api/mod/overview',
  'GET /api/mod/reports',
  'GET /api/mod/problems',
  'GET /api/mod/mutes',
  'GET /api/mod/audit',
  'GET /api/mod/content',
  'POST /api/mod/reports/:id/dismiss',
  'POST /api/mod/problems/:id/status',
  'POST /api/mod/mutes',
  'POST /api/mod/mutes/:id/lift',
  'POST /api/mod/content/remove',
  'GET /api/world/me',
  'GET /api/world/pulse',
  'GET /api/world/city',
  'GET /api/world/lga/:id',
  'GET /api/world/lga/:id/estates',
  'GET /api/world/lga/:id/estate/:estate/houses',
  'GET /api/world/lga/:id/people',
  'POST /api/growth/hello',
  'POST /api/growth/share',
  'GET /api/growth/share/:code',
  'POST /api/growth/referral/link',
  'POST /api/growth/consent',
  'POST /api/growth/tables/claim',
  'POST /api/growth/email',
  'POST /api/growth/email/remove',
  'GET /api/growth/push/key',
  'POST /api/growth/push/subscribe',
  'POST /api/growth/push/unsubscribe',
  'POST /api/growth/client',
  'GET /api/mod/growth/outreach',
  'POST /api/mod/growth/outreach/switch',
  'POST /api/mod/growth/outreach/run',
  'GET /api/mod/growth/metrics',
  'GET /api/campus',
  'POST /api/campus/nominate',
  'POST /api/campus/vote',
  'GET /api/account',
  'POST /api/account/sign-in',
  'POST /api/account/character',
  'POST /api/account/sign-out',
  'POST /api/account/sign-out-everywhere',
  'POST /api/account/delete',
  'POST /api/account/export',
  'POST /api/account/password-reset',
] as const satisfies readonly HttpRouteKey[]

/** WORKER: the same registry, so the same routes. (`/api/mod/*` answers only when the MODERATOR_TOKEN secret is set, as on Node.) */
export const WORKER_HTTP_ROUTE_KEYS: readonly HttpRouteKey[] = HTTP_ROUTE_KEYS
/** WORKER: the one route the host answers itself instead of handing it to the registry (the bounded relay test). */
export const WORKER_HOST_ROUTE_KEYS = ['GET /api/voice-config'] as const satisfies readonly HttpRouteKey[]

/** `type` of every frame the Node server accepts (server/ws/index.ts buildSocketHandlers). */
export const CLIENT_FRAME_TYPES = [
  'join', 'move', 'voice-state', 'signal', 'chat',
  'dm-send', 'dm-read', 'people-list', 'friend-request', 'friend-answer', 'invite-knock', 'invite-answer',
  'table-list', 'table-watch', 'table-unwatch', 'table-sit', 'table-options', 'table-start', 'table-move', 'table-leave', 'table-again',
  'call-invite', 'call-accept', 'call-decline', 'call-cancel', 'call-hangup', 'call-signal', 'call-settings',
] as const satisfies readonly ClientFrameType[]
/** WORKER: every frame type of the registry, and the answer to its application heartbeat. */
export const WORKER_CLIENT_FRAME_TYPES: readonly (ClientFrameType | HeartbeatAckFrame['type'])[] = [...CLIENT_FRAME_TYPES, 'heartbeat-ack']

/** `type` of every frame the Node server sends (server/server.ts, server/ws/*.js, server/social/service.ts, server/growth/tables.ts). */
export const SERVER_FRAME_TYPES = [
  'presence', 'chat', 'signal', 'error',
  'dm-sent', 'dm-failed', 'dm-read-ok', 'people', 'friend-result', 'invite-result',
  'dm', 'social-update', 'social-sync', 'friend-request', 'friend-accepted', 'people-presence', 'people-changed',
  'people-interaction', 'invite-knock', 'invite-answer', 'invite-house', 'transfer',
  'tables', 'table-state', 'tables-changed',
  'call-incoming', 'call-state', 'call-signal', 'call-settings',
] as const satisfies readonly ServerFrameType[]
/** WORKER: every frame type the shared modules send, and its application heartbeat. */
export const WORKER_SERVER_FRAME_TYPES: readonly (ServerFrameType | HeartbeatFrame['type'])[] = [...SERVER_FRAME_TYPES, 'heartbeat']

/** Exact key sets of the core responses on the Node host, sorted. `storage` appears only while saving fails. */
export const HEALTH_RESPONSE_KEYS = ['build', 'ok', 'serverTime'] as const satisfies readonly (keyof HealthResponse)[]
export const SESSION_RESPONSE_KEYS = ['serverTime', 'session'] as const satisfies readonly (keyof SessionResponse)[]
export const PUBLIC_SESSION_KEYS = ['id', 'name'] as const satisfies readonly (keyof PublicSession)[]
/** What the Node server sends as its own session. */
export const OWN_SESSION_KEYS = ['cities', 'id', 'name'] as const satisfies readonly (keyof OwnSession)[]
export const LIFE_RESPONSE_KEYS = ['serverTime', 'state'] as const satisfies readonly (keyof LifeResponse)[]
/** A first answer to an accepted action; a refusal with a sentence adds `reason`, a repeat adds `duplicate`. */
export const ACTION_RESPONSE_KEYS = ['code', 'ok', 'serverTime', 'state'] as const satisfies readonly (keyof ActionResponse)[]
export const ACTION_DUPLICATE_RESPONSE_KEYS = ['code', 'duplicate', 'ok', 'serverTime', 'state'] as const satisfies readonly (keyof ActionResponse)[]
export const VOICE_CONFIG_RESPONSE_KEYS = ['iceServers', 'mode', 'radius', 'serverTime', 'turnConfigured'] as const satisfies readonly (keyof VoiceConfigResponse)[]
export const ERROR_BODY_KEYS = ['error'] as const satisfies readonly (keyof ApiErrorBody)[]
export const PRESENCE_MEMBER_KEYS = ['enabled', 'id', 'muted', 'name', 'position'] as const satisfies readonly (keyof PresenceMember)[]
export const CHAT_FRAME_KEYS = ['at', 'body', 'clientId', 'from', 'id', 'type'] as const satisfies readonly (keyof ChatFrame)[]

/** Compile-time proof that the three lists above name every member of their union, and nothing else. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
export const KEY_LISTS_ARE_COMPLETE: {
  routes: Same<(typeof HTTP_ROUTE_KEYS)[number], HttpRouteKey>
  clientFrames: Same<(typeof CLIENT_FRAME_TYPES)[number], ClientFrameType>
  serverFrames: Same<(typeof SERVER_FRAME_TYPES)[number], ServerFrameType>
} = { routes: true, clientFrames: true, serverFrames: true }
