import type { RetentionHttpRoutes } from './cadence.ts'
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
import type { LandBuyRequest, LandView } from './land.ts'
import type { GrowthHttpRoutes, GrowthModerationHttpRoutes, TableClientFrame, TableErrorCode, TableServerFrame } from './growth.ts'
import type { ProjectHttpRoutes } from './projects.ts'
import type { CampusHttpRoutes } from './campus.ts'
import type { CallClientFrame, CallServerFrame } from './calls.ts'
import type { ArenaClientFrame, ArenaErrorCode, ArenaServerFrame } from './arena.ts'
import type { SpaceClientFrame, SpaceServerFrame } from './spaces.ts'
import type { InboxLine } from './feed.ts'
/** The feed's inbox changed (server/feed/): how many lines are unread, and the new one. */
export interface FeedInboxFrame { type: 'feed-inbox'; unseen: number; line?: InboxLine }
import type { NoticeFrame, NoticeHttpRoutes } from './notice.ts'
import type { CompanionHttpRoutes } from './companion.ts'
import type { AnnounceFrame } from './announce.ts'
import type { AdminHttpRoutes } from './admin.ts'
import type { TrustHttpRoutes } from './trust.ts'
import type { RealValueHttpRoutes } from './real-value-http.ts'
import type { ShowcaseHttpRoutes } from './showcase-http.ts'
import type { StreetHttpRoutes } from './street-http.ts'
import type { StoreHttpRoutes } from './store.ts'
import type { LiveClientFrame, LiveServerFrame } from './live.ts'
import type { AccountHttpRoutes } from './account.ts'
import type { PingHttpRoutes } from './ping.ts'
import type { VisitHttpRoutes } from './visit.ts'
import type { PlacesHttpRoutes } from './places.ts'
import type { CommerceHttpRoutes } from './commerce.ts'
import type { BusinessHttpRoutes } from './business.ts'
import type { MarketHttpRoutes } from './market.ts'
import type { PoliticsHttpRoutes } from './politics.ts'
import type { RecordsHttpRoutes } from './records.ts'
import type { LivingWorldHttpRoutes } from './living-world.ts'
import type { AgentsHttpRoutes } from './agents-http.ts'
import type { LivingWorldBarberRoutes } from './living-world-barber.ts'
import type { LivingWorldClerkRoutes } from './living-world-clerk.ts'
import type { LivingWorldJusticeRoutes } from './living-world-justice.ts'
import type { LivingWorldAssessmentRoutes } from './living-world-assessment.ts'
import type { PublicProfileHttpRoutes } from './public-profile.ts'
import type { ArenaHttpRoutes } from './arena.ts'
import type { ClansHttpRoutes } from './clans.ts'
import type { SpacesHttpRoutes } from './spaces.ts'
import type { FeedHttpRoutes } from './feed.ts'
import type { PromoteHttpRoutes } from './promote.ts'
import type { EarnHttpRoutes } from './earn.ts'
import type { WorldEventsHttpRoutes, WorldLiveFrame } from './world-events.ts'
import type { DanfoHttpRoutes } from './danfo.ts'
import type { WatchHttpRoutes } from './watch.ts'
import type { MiniGamesHttpRoutes } from './minigames.ts'
import type { SwitchesHttpRoutes } from './switches.ts'
import type { NeighbourhoodHttpRoutes, EconomyHttpRoutes, BillboardHttpRoutes } from './neighbourhood.ts'
import type { StoryHttpRoutes } from './story-http.ts'
import type { ShareLoopsHttpRoutes } from './shareloops.ts'
import type { GlueHttpRoutes } from './glue.ts'
import type { StoryTalkView, StoryTalkTurn, TalkHistoryLine } from './story-talk.ts'

// ---- shared primitives ---------------------------------------------------------------------------

/**
 * server/protocol.ts CITY_IDS: the cities a server keeps lives for. (The rules engine knows more
 * cities as data — life.ts `WorldCityId` — but only these can be asked for.)
 */
export type CityId = import('../game/cities/ids.ts').CityId

/** The only identity a server ever exposes: `id` is the session's PUBLIC id, never the cookie secret. */
export interface PublicSession {
  id: string
  name: string
  /** An AI agent plays this character: always for an agent character, for a few minutes after a key last acted for a player's own (server/agents/). */
  agent?: true
  /** Server ms the mark lapses; absent for an agent character, which is marked for good. */
  agentUntil?: number
}
/**
 * The caller's OWN session, as the session routes answer it (server/routes/core.ts ownSession):
 * the public identity plus the cities this session has a life in.
 */
export interface OwnSession extends PublicSession {
  cities?: CityId[]
}
/** `{ id, name }` of any player, as stored and returned by the social and civic features. */
export interface PlayerRef extends PublicSession {
  /** Only ever set by the social routes, on the founder's own character: the "Founder" tag. A name cannot earn it. */
  founder?: true
}

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
/** Session resolution: 401 if absent, 409 if the expected actor no longer owns the device session. */
export type SessionErrorCode = 'device_session_required' | 'actor_changed'
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
  /** Present only when the serving trusted host enables interactive starts; never persisted in the life. */
  interactiveTeachingStarts?: true
  storyMode?: true
  /** The server-held life, settled to `serverTime`. */
  state: LifeState
  /** The character's revision when this answer was made (see LifeChangedFrame). */
  rev: number
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
  /** Present only when the serving trusted host enables interactive starts; never accepted from the request. */
  interactiveTeachingStarts?: true
  storyMode?: true
  ok: boolean
  code: string
  state: LifeState
  /** Only on a first refusal that has a sentence; the same sentence is in `state.message`. */
  reason?: string
  duplicate?: true
  /** The character's revision when this answer was made (see LifeChangedFrame). */
  rev: number
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
  /** The call relay is configured on this host (the one thing the owner checks; never a secret). */
  relay: boolean
  /** The hosted companion is configured (a boolean only). */
  companionAi?: boolean
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
  'GET /api/characters': {
    response: { active: string | null; legacy: { id: string; city: string; cash: number; updatedAt: number }[] }
    errors: HostErrorCode | SessionErrorCode | StorageErrorCode
  }
  'POST /api/characters/switch': {
    body: { id: string; clientId: TimedId }
    response: { ok: true; city: string; duplicate?: true }
    errors: HostErrorCode | SessionErrorCode | StorageErrorCode | 'unknown_legacy_life' | 'invalid_character' | 'busy' | 'client_id_conflict'
  }
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
  GrowthHttpRoutes, GrowthModerationHttpRoutes, CampusHttpRoutes, ProjectHttpRoutes, RetentionHttpRoutes, AccountHttpRoutes, PingHttpRoutes, VisitHttpRoutes, PlacesHttpRoutes, BusinessHttpRoutes, MarketHttpRoutes, CommerceHttpRoutes, NoticeHttpRoutes, CompanionHttpRoutes, AdminHttpRoutes, StoreHttpRoutes, PoliticsHttpRoutes, RecordsHttpRoutes, TrustHttpRoutes, RealValueHttpRoutes, ShowcaseHttpRoutes, StreetHttpRoutes, LivingWorldHttpRoutes, AgentsHttpRoutes, LivingWorldBarberRoutes, LivingWorldClerkRoutes, LivingWorldJusticeRoutes, LivingWorldAssessmentRoutes, PublicProfileHttpRoutes, ArenaHttpRoutes, ClansHttpRoutes, StoryHttpRoutes, SpacesHttpRoutes, FeedHttpRoutes, PromoteHttpRoutes, EarnHttpRoutes, WorldEventsHttpRoutes, NeighbourhoodHttpRoutes, EconomyHttpRoutes, BillboardHttpRoutes {
  'GET /api/loops/passport': ShareLoopsHttpRoutes['GET /api/loops/passport']
  'GET /api/loops/wrapped': ShareLoopsHttpRoutes['GET /api/loops/wrapped']
  'GET /api/loops/fame': ShareLoopsHttpRoutes['GET /api/loops/fame']
  'GET /api/loops/frontpage': ShareLoopsHttpRoutes['GET /api/loops/frontpage']
  'GET /api/story/talk': { response: Ok<StoryTalkView>; errors: HostErrorCode | SessionErrorCode | StorageErrorCode | 'character_required' | 'city_content_unavailable' | 'talk_venue_unavailable' }
  'POST /api/story/talk': { body: { npc: string; clientId: string; question: string; history?: TalkHistoryLine[] }; response: Ok<StoryTalkTurn>; errors: HostErrorCode | SessionErrorCode | StorageErrorCode | JsonBodyErrorCode | OnceErrorCode | 'character_required' | 'city_content_unavailable' | 'talk_venue_unavailable' | 'talk_regular_unavailable' | 'invalid_talk_request' | 'invalid_talk_history' }
  'GET /api/world/land': { query: { city: CityId }; response: Ok<LandView>; errors: HostErrorCode | SessionErrorCode | StorageErrorCode | 'invalid_city' | 'land_rate_limited' | 'world_unavailable' | 'land_recovery_required' }
  'POST /api/world/land/buy': { body: LandBuyRequest; response: Ok<{ ok: boolean; code: string; duplicate?: true; pending?: true }>; errors: HostErrorCode | SessionErrorCode | StorageErrorCode | JsonBodyErrorCode | OnceErrorCode | 'invalid_city' | 'invalid_land_purchase' | 'land_rate_limited' | 'world_unavailable' | 'land_recovery_required' | 'land_pending' | 'not_owned_home' | 'land_price_changed' | 'land_intent_changed' }
}
/** Drive a danfo (docs/DANFO.md): merged into HttpRoutes here, beside the list above rather than in it. */
export interface HttpRoutes extends DanfoHttpRoutes {}
/** Shared watching (docs/ALLWORLD-HOUSE.md): merged the same way. */
export interface HttpRoutes extends WatchHttpRoutes {}
/** Local mini-games (docs/MINI-GAMES.md): the market haggle, the skit studio's caption check, NYSC camp and JAMB season. */
export interface HttpRoutes extends MiniGamesHttpRoutes {}
/** The operator's switches (server/routes/switches-mod.ts): merged the same way. */
export interface HttpRoutes extends SwitchesHttpRoutes {}
export type HttpRouteKey = keyof HttpRoutes
export type ResponseOf<K extends HttpRouteKey> = HttpRoutes[K]['response']
export type ErrorCodeOf<K extends HttpRouteKey> = HttpRoutes[K]['errors']
/** The social glue (docs/SOCIAL-GLUE.md): merged into HttpRoutes the same way, kept apart from the other phases' lines. */
export interface HttpRoutes extends GlueHttpRoutes {}
/** Allworld's rules before sharing (server/routes/sharing.ts, server/sharing-policy.ts): asked once per account or guest, per terms version. */
export interface SharingTermsAnswer { version: string; accepted: boolean }
export interface HttpRoutes {
  'GET /api/sharing/terms': { response: SharingTermsAnswer; errors: HostErrorCode | SessionErrorCode }
  'POST /api/sharing/terms': { body: { version: string; over13: true }; response: SharingTermsAnswer; errors: HostErrorCode | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode | 'terms_confirmation_required' | 'device_session_required' }
}

// ---- WebSocket /socket: venue rooms (server/ws/rooms.ts) -----------------------------------------
//
// The socket is opened with the session cookie and an Origin header; a refused upgrade is a bare
// HTTP 403 on Node (WORKER: a JSON error — 403 origin_rejected or websocket_required, 401 device_session_required,
// 429 rate_limited, 503 socket_capacity — one session or one address holding too many). When EVERY socket the host takes is
// in use, the upgrade succeeds and the socket is closed at once with code 1013 ("try again later") and the reason
// 'socket_capacity' on both hosts: a page can read a close code, and tries again with a growing pause (docs/CAPACITY.md).
// Frames are JSON text of at most 16 KB. There is no `leave` frame on either host: a socket leaves its room by joining
// another one or by closing.

/**
 * Enter a venue room. The server admits the socket only to the venue the stored life occupies.
 * `hostId` (Home only): join THAT player's Home room as an accepted guest.
 */
export interface JoinFrame {
  type: 'join'
  cityId: CityId
  venueId: string
  hostId?: string
  /** This page reads a public venue as its group: one `presence` snapshot, then `presence-delta` frames (see PresenceDeltaFrame). Without it every change is a whole `presence` list. */
  deltas?: true
  /** The public id of a friend to be placed with (their group), when there is room; only a mutual friend is honoured. */
  with?: string
}
/**
 * Stand in a place (src/places/model.ts): the Square, or the room of a group chat. The stored life does not move. The server
 * admits the socket only if the social module says this player may stand there (server/social/places.ts).
 */
export interface PlaceJoinFrame {
  type: 'join'
  place: 'square' | 'room'
  /** The group's id (`g.<number>`), for `place: 'room'`. */
  roomId?: string
  deltas?: true
  with?: string
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
/** Ask for the venue's groups (answered `groups`): `room: true`, so only a socket that has joined. */
export interface GroupsFrame { type: 'groups' }
/** Move to another group of the venue: by its id (`group`, refused when it is full) or to a friend's group (`friend`; when that group is full, the move waits for room). Answered with a fresh `presence` and a `group` notice. */
export interface GroupJoinFrame { type: 'group-join'; group?: string; friend?: string }
export type RoomClientFrame = JoinFrame | PlaceJoinFrame | MoveFrame | VoiceStateFrame | SignalFrame | ChatSendFrame | GroupsFrame | GroupJoinFrame

export interface PresenceMember extends PublicSession {
  /** What an AI agent is doing now, in a few words (only agents carry it). */
  doing?: string
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
  /** Only to a page that joined with `deltas`: the list is its GROUP of the venue (never more than the group maximum plus two), and `counts` says how many are here in all. Later changes arrive as `presence-delta`. */
  counts?: RoomCounts
  delta?: true
}
/** A venue's own group, everyone in the venue and how many groups there are; `cap` is a group's hard maximum. */
export interface RoomCounts { here: number; total: number; groups: number; cap: number }
/**
 * What changed in the page's group since its last `presence` snapshot, to a page that joined with `deltas`: members who
 * joined (or changed their name), ids that left, where members moved to (gathered and sent at most about eight times a second),
 * voice changes, and the counts when they changed. Members the recipient has a block with are left out, as in `presence`.
 */
export interface PresenceDeltaFrame {
  type: 'presence-delta'
  joined?: PresenceMember[]
  left?: string[]
  moved?: { id: string; x: number; z: number }[]
  voice?: { id: string; enabled: boolean; muted: boolean }[]
  counts?: RoomCounts
}
/** One group in the answer to `groups`. `friends` are the caller's friends in it (names); a stranger is only a count. */
export interface GroupSummary { id: string; no: number; size: number; open: boolean; mine: boolean; friends: PublicSession[]; /** The clan whose room this group is (server/clans/venue.ts): its name and colour. */ clan?: { name: string; hex: string } }
export interface GroupsListFrame { type: 'groups'; here: number; total: number; groups: GroupSummary[]; more: number }
/** A calm line about where the player is: they were moved to another group, or could not be placed with a friend. */
export interface GroupNoticeFrame {
  type: 'group'
  event: 'placed' | 'moved' | 'apart' | 'waiting' | 'notice'
  here: number
  text: string
  friend?: PublicSession
}
export interface ChatFrame {
  type: 'chat'
  id: string
  /** Echo of the sender's retry key; absent when none was sent. */
  clientId?: string
  from: PublicSession
  body: string
  at: number
  /** Who is speaking, when it is not a person: an AI agent's line, so a client can voice it. Absent on a person's line. */
  speaker?: 'agent'
  /** A stable number for the speaker (the same every time for the same player) from which a client picks one voice. Only on lines with a `speaker`. */
  voiceSeed?: number
  /** The server read the line as asking for money, a withdrawal, an account number or a code (server/moderation/scam-words.ts): other people's phones show a calm warning with Report. Absent on every other line; the line itself is delivered as typed. */
  scam?: true
}
/**
 * An AI character's line as speakable text, for the people in the place's VOICE circle only (the same line also goes to everyone as a `chat` frame). Each listener's phone
 * speaks it with its own voice for `voiceSeed`, near or far by `x`/`z` like a person's voice; no audio crosses the network. AI characters never receive room voice.
 */
export interface VoiceTextFrame {
  type: 'voice-text'
  /** The id of the `chat` frame it belongs to, so a page that shows both speaks the line once. */
  id: string
  from: PublicSession
  body: string
  at: number
  voiceSeed: number
  /** Where the speaker stands in the room, for the volume. */
  x: number
  z: number
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
  | 'invalid_room' | 'onboarding_required' | 'venue_mismatch' | 'not_a_guest' | 'visit_ended' | 'not_admitted' | 'place_full' | 'place_ended'
  | 'invalid_position' | 'move_rate_limited' | 'invalid_voice_state' | 'voice_room_full'
  | 'invalid_signal' | 'peer_not_in_room' | 'peer_out_of_range'
  | 'invalid_chat' | 'text_blocked' | 'muted' | 'links_not_allowed' | 'contact_not_allowed'
  // the no-fee filter on venue chat (src/game/trust/fees.ts)
  | 'fee_request' | 'money_doubling'
  // venue groups (server/ws/rooms.ts)
  | 'group_full' | 'group_gone' | 'in_voice' | 'not_a_friend'
  // malformed social frames (server/social/service.ts throws ctx.fail(400, code))
  | 'invalid_player' | 'invalid_city' | 'invalid_conversation' | 'invalid_answer'
  // a call frame from a device that does not carry the call (server/social/calls.ts)
  | 'call_elsewhere'
  // refused table frames (server/growth/tables.ts), always with a `reason`
  | TableErrorCode
  // refused real-time game room frames (server/growth/arena.ts), always with a `reason`
  | ArenaErrorCode
/** WORKER: codes only the Worker sends, in addition to every code above: a retried chat id with another body, and an expired session on an open socket. */
export type WorkerSocketErrorCode = 'chat_id_conflict' | 'device_session_required'
export type SocketErrorCode = 'sharing_terms_required' | NodeSocketErrorCode | WorkerSocketErrorCode

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
export type RoomServerFrame = PresenceFrame | PresenceDeltaFrame | GroupsListFrame | GroupNoticeFrame | ChatFrame | VoiceTextFrame | SignalRelayFrame | ErrorFrame

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
/** Asks for the counts frames (`pulse`): answered at once with the current counts, then sent when they change. Not repeated. */
export interface PulseWatchFrame { type: 'pulse-watch' }
export type ClientFrame = RoomClientFrame | SocialClientFrame | TableClientFrame | ArenaClientFrame | CallClientFrame | LiveClientFrame | PulseWatchFrame | SpaceClientFrame
/**
 * ONE CHARACTER ON SEVERAL DEVICES (docs/DEVICES.md). Every answer that carries the life (GET /api/life, POST /api/action)
 * carries `rev`, a number that only goes up for one character: a device never replaces what it shows with an answer whose
 * `rev` is lower than the one it already took. When the life changes in a way a player would see — an accepted action from
 * any device, a settlement with an outcome, another city — every open socket of that character is sent this frame, a few
 * tens of milliseconds later so that a burst is one frame. `rev` is the revision to have at least; a device that holds a
 * lower one reads the life again. `by` lists the action ids that caused it, so the device that sent one of them (and has
 * the answer already) does not read again, and another device knows the change was made elsewhere.
 */
export interface LifeChangedFrame { type: 'life-changed'; rev: number; by?: string[] }
/**
 * The counts of the header pill (server/pulse.ts), pushed to every open socket when a socket opens and then whenever they
 * changed (at most about every two seconds). The same numbers GET /api/world/pulse answers, which stays as the fallback.
 */
export interface PulseFrame { type: 'pulse'; online: number; visits: number; today: number; cities: Record<string, number>; /** AI agents present now (never counted in `online`). */ ai?: number; /** The same agents by city (only cities with any). */ aiCities?: Record<string, number> }

/**
 * Everything a server may send. Clients must ignore types they do not know: the community panel's
 * socket and the social client's socket both receive every frame addressed to the player.
 * WORKER: also `HeartbeatFrame`.
 */
export type ServerFrame = RoomServerFrame | SocialServerFrame | TableServerFrame | ArenaServerFrame | CallServerFrame | LifeChangedFrame | LiveServerFrame | NoticeFrame | PulseFrame | AnnounceFrame | SpaceServerFrame | FeedInboxFrame | WorldLiveFrame
export type ClientFrameType = ClientFrame['type']
export type ServerFrameType = ServerFrame['type']

// ---- runtime key lists (compared with the running server by protocol.test.ts) -------------------

export { registeredCityIds } from '../game/cities/registry.ts'

export const HTTP_ROUTE_KEYS = [
  'GET /api/mod/switches', 'POST /api/mod/switches', 'POST /api/mod/switches/house',
  'GET /api/feed/me', 'POST /api/feed/seen', 'GET /api/feed/list', 'GET /api/feed/crew', 'GET /api/feed/by', 'GET /api/feed/post', 'POST /api/feed/post', 'POST /api/feed/post/remove', 'POST /api/feed/react', 'POST /api/feed/reply', 'POST /api/feed/reply/remove', 'POST /api/feed/report', 'POST /api/feed/draft/remove', 'POST /api/feed/media', 'GET /api/feed/media/:hash', 'GET /api/feed/portrait/:id', 'GET /api/feed/profile', 'POST /api/feed/profile', 'POST /api/feed/handle', 'GET /api/feed/code', 'POST /api/feed/follow', 'GET /api/feed/suggestions', 'POST /api/feed/vouch', 'POST /api/feed/crews', 'POST /api/feed/crews/join', 'POST /api/feed/crews/leave', 'GET /api/feed/crews/one', 'GET /api/feed/events', 'GET /api/feed/events/one', 'POST /api/feed/events', 'POST /api/feed/events/rsvp', 'POST /api/feed/events/cancel', 'GET /api/feed/gigs', 'POST /api/feed/gigs', 'POST /api/feed/gigs/act', 'GET /api/mod/feed', 'POST /api/mod/feed', 'GET /api/feed/communities', 'POST /api/feed/crews/mod', 'POST /api/feed/crews/locals', 'POST /api/feed/located', 'POST /api/feed/crews/world', 'GET /api/feed/contacts', 'POST /api/feed/contacts/self', 'POST /api/feed/contacts/match', 'POST /api/feed/contacts/forget', 'GET /api/promote/me', 'GET /api/promote/directory', 'POST /api/promote/listings', 'POST /api/promote/listings/remove', 'POST /api/promote/order', 'POST /api/promote/order/verify', 'POST /api/promote/contact', 'GET /api/admin/promote', 'POST /api/admin/promote/act', 'GET /api/earn/me', 'POST /api/earn/account', 'POST /api/earn/account/refresh', 'GET /api/earn/ready', 'POST /api/earn/price', 'POST /api/earn/pay', 'POST /api/earn/pay/verify', 'GET /api/admin/earn', 'POST /api/admin/earn/pay', 'GET /api/admin/feed', 'POST /api/admin/feed/undo', 'POST /api/admin/feed/act',
  'GET /api/profiles/:id',
  'GET /api/sharing/terms', 'POST /api/sharing/terms',
  'GET /api/danfo/park', 'POST /api/danfo/start', 'POST /api/danfo/stop', 'POST /api/danfo/finish', 'POST /api/danfo/abandon', 'GET /api/danfo/run', 'POST /api/danfo/join', 'POST /api/danfo/leave', 'POST /api/danfo/shout', 'POST /api/danfo/collect', 'GET /api/danfo/board',
  'GET /api/minigames/haggle/stalls', 'POST /api/minigames/haggle/open', 'POST /api/minigames/haggle/offer', 'POST /api/minigames/haggle/buy', 'POST /api/minigames/skit/check', 'GET /api/minigames/seasons', 'POST /api/minigames/nysc/join', 'POST /api/minigames/nysc/duty', 'POST /api/minigames/nysc/pass-out', 'POST /api/minigames/jamb/join', 'POST /api/minigames/jamb/today', 'POST /api/minigames/jamb/answer', 'POST /api/minigames/jamb/mock/start', 'POST /api/minigames/jamb/mock/submit',
  'GET /api/living-world/assessment', 'POST /api/living-world/assessment/start', 'POST /api/living-world/assessment/step',
  'GET /api/living-world/justice-practice', 'POST /api/living-world/justice-practice/start', 'POST /api/living-world/justice-practice/step',
  'GET /api/living-world/barber',
  'GET /api/living-world/clerk', 'POST /api/living-world/clerk/start',
  'POST /api/living-world/clerk/step', 'POST /api/living-world/clerk/claim',
  'POST /api/living-world/barber/start', 'POST /api/living-world/barber/input',
  'POST /api/living-world/barber/pause', 'POST /api/living-world/barber/resume',
  'POST /api/living-world/barber/claim', 'POST /api/living-world/barber/upgrade',
  'GET /api/living-world/qualification', 'POST /api/living-world/qualification/claim',
  'GET /api/living-world/rental', 'POST /api/living-world/rental/claim',
  'GET /api/living-world/driving',
  'POST /api/living-world/driving/start', 'POST /api/living-world/driving/input',
  'POST /api/living-world/driving/resume', 'POST /api/living-world/driving/pause', 'POST /api/living-world/driving/restart',
  'POST /api/social/visit/capture-consent',
  'GET /api/world/land',
  'POST /api/world/land/buy',
  'GET /api/world/street',
  'GET /api/street/me', 'GET /api/street/tile',
  'POST /api/street/begin', 'POST /api/street/move', 'POST /api/street/enter', 'POST /api/street/exit',
  'POST /api/social/visit/plot/enter',
  'GET /api/social/visit/home',
  'GET /api/places', 'GET /api/places/square', 'GET /api/places/room',
  'POST /api/places/room/edit', 'POST /api/places/room/link', 'POST /api/places/room/remove', 'POST /api/places/room/peek', 'POST /api/places/room/enter',
  'GET /api/retention', 'POST /api/retention/rhythm', 'POST /api/retention/season',
  'GET /api/projects', 'POST /api/projects/contribute', 'POST /api/projects/quiet', 'POST /api/projects/claim',
  'GET /api/health',
  'POST /api/session',
  'GET /api/session',
  'GET /api/voice-config',
  'GET /api/characters',
  'POST /api/characters/switch',
  'GET /api/life',
  'POST /api/action',
  'GET /api/social/me',
  'GET /api/social/family',
  'POST /api/social/family',
  'GET /api/social/friends',
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
  'POST /api/social/conversations/:id/pins',
  'GET /api/social/everyone',
  'POST /api/social/chats/open',
  'POST /api/social/messages/many',
  'POST /api/social/conversations/:id/read',
  'POST /api/social/messages',
  'POST /api/social/groups',
  'POST /api/social/groups/:id',
  'GET /api/social/friends/search',
  'POST /api/social/conversations/:id/prefs',
  'POST /api/social/prefs',
  'POST /api/social/introduction',
  'POST /api/social/conversations/:id/react',
  'POST /api/social/conversations/:id/message',
  'POST /api/social/notify',
  'POST /api/social/voice',
  'GET /api/social/voice/:id',
  'POST /api/social/images',
  'GET /api/social/images/:id',
  'GET /api/social/house/:host',
  'POST /api/social/join',
  'POST /api/social/house/knock',
  'POST /api/social/house/answer',
  'POST /api/social/house/leave',
  'POST /api/social/bae/ask',
  'POST /api/social/bae/answer',
  'POST /api/social/bae/end',
  'POST /api/social/romance/answer',
  'POST /api/social/romance/public',
  'POST /api/social/transfers',
  'POST /api/social/spray',
  'POST /api/social/money-requests',
  'POST /api/social/money-requests/answer',
  'GET /api/social/ping',
  'GET /api/social/ping/:id',
  'POST /api/social/ping',
  'POST /api/social/ping/cancel',
  'POST /api/social/ping/open',
  'POST /api/social/ping/join',
  'GET /api/social/visit/door',
  'POST /api/social/visit/door',
  'POST /api/social/visit/close',
  'POST /api/social/visit/end',
  'POST /api/social/visit/enter',
  'POST /api/social/visit/invite',
  'POST /api/social/visit/link',
  'GET /api/social/visit/links',
  'POST /api/social/visit/link/end',
  'POST /api/social/visit/peek',
  'POST /api/social/visit/link/enter',
  'POST /api/social/visit/party/start',
  'POST /api/social/visit/party/role',
  'POST /api/social/visit/party/spray',
  'POST /api/social/visit/party/end',
  'GET /api/civic/pulse',
  'GET /api/civic/gov',
  'POST /api/civic/gov/run',
  'POST /api/civic/works/give',
  'POST /api/civic/works/order',
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
  'GET /api/civic/boards',
  'POST /api/civic/prefs',
  'POST /api/support/reports',
  'GET /api/support/statement',
  'GET /api/support/history',
  'GET /api/support/reports',
  'GET /api/mod/overview',
  'POST /api/mod/companion-test',
  'POST /api/companion/ask',
  'GET /api/mod/reports',
  'GET /api/mod/problems',
  'GET /api/mod/mutes',
  'GET /api/mod/pictures',
  'GET /api/mod/pictures/:id',
  'GET /api/mod/audit',
  'GET /api/mod/content',
  'POST /api/mod/reports/:id/dismiss',
  'POST /api/mod/problems/:id/status',
  'POST /api/mod/mutes',
  'POST /api/mod/mutes/:id/lift',
  'POST /api/mod/pictures/:id',
  'POST /api/mod/players/:id/pictures',
  'POST /api/mod/content/remove',
  'POST /api/notice',
  'GET /api/admin/me',
  'GET /api/admin/dashboard',
  'GET /api/admin/economy',
  'GET /api/admin/history',
  'POST /api/admin/players/bulk',
  'GET /api/admin/players',
  'GET /api/admin/players/:id',
  'GET /api/admin/test-sessions',
  'POST /api/admin/test-sessions/remove',
  'POST /api/admin/players/:id/erase',
  'GET /api/admin/erasure/:id',
  'POST /api/admin/erasure/:id/retry',
  'POST /api/admin/players/:id/act',
  'POST /api/admin/world/grant',
  'GET /api/admin/announcements',
  'POST /api/admin/announcements',
  'POST /api/admin/announcements/:id/cancel',
  'GET /api/admin/settings',
  'POST /api/admin/settings',
  'GET /api/admin/prayers',
  'POST /api/admin/prayers/act',
  'GET /api/admin/residents',
  'POST /api/admin/residents/reply',
  'GET /api/admin/festivals',
  'POST /api/admin/festivals',
  'POST /api/admin/notice',
  'GET /api/admin/moderation/reports',
  'POST /api/admin/moderation/reports/:id/act',
  'GET /api/admin/moderation/shops',
  'POST /api/admin/moderation/shops/act',
  'GET /api/admin/politics',
  'POST /api/admin/politics/act',
  'GET /api/admin/moderation/content',
  'POST /api/admin/moderation/content/remove',
  'GET /api/admin/audit',
  'GET /api/admin/tools',
  'GET /api/admin/moderation/voice/:id',
  'POST /api/admin/moderation/voice/:id/act',
  'GET /api/admin/moderation/pictures',
  'GET /api/admin/moderation/pictures/:id',
  'POST /api/admin/moderation/pictures/:id/act',
  'POST /api/admin/moderation/pictures/player',
  'POST /api/admin/companion/test',
  'GET /api/world/me',
  'GET /api/world/pulse',
  'GET /api/world/pulse/online',
  'GET /api/world/festivals',
  'GET /api/world/detty', 'GET /api/world/detty/me', 'POST /api/world/detty/checkin',
  'GET /api/world/feed',
  'GET /api/world/gist',
  'GET /api/world/episode',
  'GET /api/arena/replay/:id',
  'GET /api/arena/daily',
  'GET /api/clans/me', 'GET /api/clans/preview', 'POST /api/clans/create', 'POST /api/clans/join', 'POST /api/clans/leave', 'POST /api/clans/kick',
  'POST /api/clans/role', 'POST /api/clans/edit', 'POST /api/clans/code', 'POST /api/clans/venue', 'POST /api/clans/prize', 'GET /api/clans/boards', 'GET /api/clans/league',
  'GET /api/story/help', 'POST /api/story/help', 'POST /api/story/help/join', 'POST /api/story/help/answer',
  'POST /api/story/help/seat', 'POST /api/story/help/errand', 'POST /api/story/help/end',
  'GET /api/story/signature', 'POST /api/story/signature',
  'GET /api/story/talk', 'POST /api/story/talk',
  'GET /api/loops/passport', 'GET /api/loops/wrapped', 'GET /api/loops/fame', 'GET /api/loops/frontpage',
  'GET /api/spaces/status', 'POST /api/spaces/design', 'POST /api/spaces/check', 'POST /api/spaces/apply', 'GET /api/spaces/host', 'POST /api/spaces/host', 'GET /api/spaces/games', 'GET /api/spaces/game', 'POST /api/spaces/games',
  'GET /api/spaces/models', 'POST /api/spaces/models', 'POST /api/spaces/models/rename', 'POST /api/spaces/models/delete', 'POST /api/spaces/models/report', 'GET /api/spaces/model-file/:hash', 'GET /api/mod/spaces/models', 'POST /api/mod/spaces/models', 'POST /api/mod/spaces/switch', 'GET /api/spaces/world', 'POST /api/spaces/world/layout', 'POST /api/spaces/world/script',
  'GET /api/spaces/worlds', 'POST /api/spaces/worlds', 'POST /api/spaces/worlds/update', 'POST /api/spaces/worlds/delete', 'POST /api/spaces/worlds/like', 'POST /api/spaces/worlds/builders', 'POST /api/spaces/models/upload-link', 'POST /api/spaces/models/upload/:token', 'POST /api/spaces/house', 'POST /api/spaces/worlds/cover', 'GET /api/spaces/world-cover/:id', 'GET /api/spaces/depth/:name', 'POST /api/mod/spaces/depth/:name',
  'POST /api/arena/clip',
  'GET /api/world/pray',
  'POST /api/world/pray',
  'GET /api/world/works',
  'GET /api/world/birthday',
  'POST /api/world/birthday',
  'GET /api/world/home-city',
  'POST /api/world/home-city',
  'GET /api/world/legacy',
  'POST /api/world/legacy/preview',
  'POST /api/world/legacy/pass',
  'POST /api/world/legacy/accept',
  'POST /api/world/legacy/decline',
  'POST /api/world/legacy/cancel',
  'GET /api/world/city',
  'GET /api/world/lga/:id',
  'GET /api/world/lga/:id/estates',
  'GET /api/world/lga/:id/estate/:estate/houses',
  'GET /api/world/lga/:id/people',
  'POST /api/world/badges',
  'POST /api/growth/hello',
  'POST /api/growth/share',
  'GET /api/growth/share/:code',
  'POST /api/growth/referral/link',
  'POST /api/growth/consent',
  'POST /api/growth/tables/claim',
  'POST /api/growth/oro/state',
  'POST /api/growth/oro/guess',
  'POST /api/growth/email',
  'POST /api/growth/email/remove',
  'POST /api/growth/comeback',
  'POST /api/growth/nudge',
  'GET /api/growth/push/key',
  'POST /api/growth/push/subscribe',
  'POST /api/growth/push/test',
  'POST /api/growth/push/unsubscribe',
  'POST /api/growth/client',
  'POST /api/growth/source',
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
  'GET /api/world/bonus',
  'POST /api/account/bonus',
  'GET /api/commerce',
  'GET /api/commerce/directory',
  'POST /api/commerce/start',
  'POST /api/commerce/profile',
  'POST /api/commerce/refresh',
  'POST /api/commerce/connect',
  'POST /api/commerce/connect/complete',
  'POST /api/commerce/publish',
  'POST /api/commerce/disconnect',
  'GET /api/business/venue',
  'GET /api/business/mine',
  'POST /api/business/open',
  'POST /api/business/stock',
  'POST /api/business/price',
  'POST /api/business/collect',
  'POST /api/business/rent',
  'POST /api/business/upgrade',
  'POST /api/business/close',
  'POST /api/business/bag',
  'POST /api/business/bag/stock',
  'POST /api/business/bag/return',
  'POST /api/business/buy',
  'POST /api/business/rate',
  'POST /api/business/report',
  'GET /api/mod/business/reports',
  'POST /api/mod/business/rename',
  'POST /api/mod/business/close',
  'GET /api/market/view',
  'GET /api/market/history',
  'POST /api/market/deposit',
  'POST /api/market/withdraw',
  'POST /api/market/order',
  'POST /api/market/cancel',
  'POST /api/market/anon',
  'POST /api/mod/market/freeze',
  'GET /api/mod/store',
  'GET /api/mod/store/compare',
  'GET /api/mod/store/hashes',
  'POST /api/mod/store/migrate',
  'POST /api/mod/store/layout',
  'POST /api/mod/store/safety',
  'GET /api/politics/overview',
  'GET /api/world/records',
  'GET /api/world/records/proof',
  'POST /api/politics/decree',
  'POST /api/politics/salary',
  'POST /api/politics/bill',
  'POST /api/politics/bill/vote',
  'POST /api/politics/bill/sign',
  'POST /api/politics/grant',
  'POST /api/politics/audit',
  'POST /api/politics/impeach',
  'POST /api/politics/party/found',
  'POST /api/politics/party/join',
  'POST /api/politics/party/leave',
  'GET /api/politics/justice/overview',
  'POST /api/politics/justice/fight',
  'POST /api/politics/justice/enrol',
  'POST /api/politics/justice/dismiss',
  'POST /api/politics/justice/arrest',
  'POST /api/politics/justice/appeal',
  'POST /api/politics/justice/escalate',
  'POST /api/politics/justice/bail',
  'POST /api/politics/justice/prison/work',
  'POST /api/politics/justice/prison/parole',
  'POST /api/politics/justice/prison/visit',
  'POST /api/politics/justice/argue',
  'POST /api/politics/justice/rule',
  'POST /api/politics/justice/lawyer',
  'GET /api/admin/trust/reports',
  'POST /api/admin/trust/reports/:id/act',
  'POST /api/admin/trust/players/:id/act',
  'GET /api/trust/me',
  'GET /api/real-value/listings', 'GET /api/real-value/mine', 'GET /api/real-value/listings/:id',
  'GET /api/real-value/share/:id', 'GET /api/real-value/link/:id', 'GET /api/real-value/analytics/:id',
  'GET /api/real-value/contacts', 'GET /api/real-value/contacts/:id',
  'POST /api/real-value/listings', 'POST /api/real-value/listings/:id/edit', 'POST /api/real-value/listings/:id/close',
  'POST /api/real-value/listings/:id/report', 'POST /api/real-value/listings/:id/event', 'POST /api/real-value/listings/:id/contact-request',
  'POST /api/real-value/contacts/:id/answer', 'POST /api/real-value/contacts/:id/revoke',
  'GET /api/showcase/directory', 'GET /api/showcase/mine', 'GET /api/showcase/photo/:id', 'GET /api/showcase/entry/:token', 'GET /api/showcase/:id',
  'POST /api/showcase/mine', 'POST /api/showcase/mine/photos', 'POST /api/showcase/mine/photos/arrange', 'POST /api/showcase/mine/photos/remove', 'POST /api/showcase/mine/submit', 'POST /api/showcase/mine/share',
  'POST /api/showcase/mine/hide', 'POST /api/showcase/mine/remove', 'POST /api/showcase/:id/go', 'POST /api/showcase/:id/report',
  'GET /api/mod/showcase', 'POST /api/mod/showcase', 'GET /api/mod/showcase/photo/:id',
  'POST /api/agents/mcp', 'GET /api/agents/mcp', 'DELETE /api/agents/mcp',
  'GET /api/agents/oauth/resource', 'GET /api/agents/oauth/server', 'POST /api/agents/oauth/register', 'GET /api/agents/oauth/authorize', 'POST /api/agents/oauth/authorize', 'POST /api/agents/oauth/token', 'POST /api/agents/oauth/revoke', 'GET /api/agents', 'POST /api/agents/keys', 'POST /api/agents/keys/:id/revoke', 'GET /api/agents/keys/:id/audit',
  'POST /api/agents/characters/:id/remove', 'GET /api/agents/board', 'GET /api/mod/agents', 'POST /api/mod/agents/switch',
  'POST /api/agents/claim', 'GET /api/agents/claim/:token', 'POST /api/agents/keys/:id/rename', 'POST /api/agents/characters/:id/takeover', 'GET /api/agents/league', 'GET /api/agents/services', 'POST /api/mod/agents/settings',
  'GET /api/agents/arena', 'POST /api/agents/arena/enter', 'POST /api/agents/arena/challenge', 'GET /api/agents/arena/challenge/:code', 'GET /api/agents/arena/cup/:id', 'GET /api/agents/arena/now',
  'GET /api/agents/call/config', 'POST /api/agents/call/start', 'POST /api/agents/call/transcribe', 'POST /api/agents/call/turn', 'POST /api/agents/call/end',
  'GET /api/agents/online', 'POST /api/agents/talk',
  'GET /api/agents/memory', 'POST /api/agents/memory/forget', 'POST /api/agents/memory/remember', 'POST /api/agents/memory/flirt', 'POST /api/agents/memory/partner', 'GET /api/agents/memory/export', 'GET /api/agents/spot', 'POST /api/agents/spot/guess', 'POST /api/agents/spot/opt', 'GET /api/agents/roles', 'POST /api/agents/roles/ask',
  'POST /api/trust/phone/complete',
  'POST /api/trust/dojah/webhook',
  'POST /api/trust/id/start',
  'GET /api/trust/id/result',
  'GET /api/trust/profile/:id',
  'POST /api/trust/check/:kind/start',
  'POST /api/trust/report',
  'GET /api/glue/close', 'GET /api/glue/close/now', 'POST /api/glue/close', 'GET /api/glue/talks', 'POST /api/glue/talks', 'POST /api/glue/talks/remind', 'POST /api/glue/talks/open', 'POST /api/glue/talks/cancel', 'GET /api/glue/board', 'POST /api/glue/board/posts', 'POST /api/glue/board/same', 'POST /api/glue/board/report', 'POST /api/glue/board/moderate', 'GET /api/glue/trips', 'POST /api/glue/trips', 'POST /api/glue/trips/answer', 'POST /api/glue/trips/manage', 'POST /api/glue/trips/go', 'GET /api/glue/family', 'POST /api/glue/family/propose', 'POST /api/glue/family/answer', 'POST /api/glue/family/withdraw', 'POST /api/glue/family/ceremony', 'POST /api/glue/family/home', 'POST /api/glue/family/divorce',
  'GET /api/world/event', 'GET /api/world/event/me', 'POST /api/world/event/step', 'GET /api/world/stage', 'POST /api/world/stage',
  'GET /api/world/election-night', 'POST /api/world/election-night/speech', 'POST /api/world/election-night/card', 'GET /api/admin/world-events', 'POST /api/admin/world-events',
  'GET /api/neighbourhood/board', 'POST /api/neighbourhood/notices', 'POST /api/neighbourhood/notices/vote', 'POST /api/neighbourhood/notices/report', 'POST /api/neighbourhood/notices/remove', 'GET /api/neighbourhood/meetups', 'POST /api/neighbourhood/meetups/plan',
  'GET /api/admin/neighbourhood', 'POST /api/admin/neighbourhood/act', 'POST /api/admin/neighbourhood/meetup',
  'GET /api/economy', 'GET /api/promote/boards', 'GET /api/promote/street',
  'GET /api/watch/matches', 'POST /api/watch/predict', 'GET /api/watch/board', 'GET /api/watch/house', 'POST /api/watch/house/vote', 'GET /api/watch/premieres', 'POST /api/watch/artist/apply', 'POST /api/watch/premiere', 'POST /api/watch/premiere/cancel', 'GET /api/admin/watch', 'POST /api/admin/watch',
] as const satisfies readonly HttpRouteKey[]

/** WORKER: the same registry, so the same routes. (`/api/mod/*` answers only when the MODERATOR_TOKEN secret is set, as on Node.) */
export const WORKER_HTTP_ROUTE_KEYS: readonly HttpRouteKey[] = HTTP_ROUTE_KEYS
/** WORKER: the one route the host answers itself instead of handing it to the registry (the bounded relay test). */
export const WORKER_HOST_ROUTE_KEYS = ['GET /api/voice-config'] as const satisfies readonly HttpRouteKey[]

/** `type` of every frame the Node server accepts (server/ws/index.ts buildSocketHandlers). */
export const CLIENT_FRAME_TYPES = [
  'join', 'move', 'voice-state', 'signal', 'chat', 'groups', 'group-join',
  'dm-send', 'dm-read', 'people-list', 'friend-request', 'friend-answer', 'invite-knock', 'invite-answer',
  'table-list', 'table-watch', 'table-unwatch', 'table-sit', 'table-stake', 'table-options', 'table-start', 'table-move', 'table-leave', 'table-again',
  'arena-create', 'arena-join', 'arena-watch', 'arena-start', 'arena-options', 'arena-input', 'arena-again', 'arena-leave', 'arena-stake', 'arena-back',
  'call-invite', 'call-accept', 'call-decline', 'call-cancel', 'call-hangup', 'call-signal', 'call-settings', 'call-ice', 'call-report',
  'live-watch', 'live-unwatch', 'pulse-watch',
  'space-join', 'space-tick', 'space-leave', 'space-screen',
] as const satisfies readonly ClientFrameType[]
/** WORKER: every frame type of the registry, and the answer to its application heartbeat. */
export const WORKER_CLIENT_FRAME_TYPES: readonly (ClientFrameType | HeartbeatAckFrame['type'])[] = [...CLIENT_FRAME_TYPES, 'heartbeat-ack']

/** `type` of every frame the Node server sends (server/server.ts, server/ws/*.js, server/social/service.ts, server/growth/tables.ts). */
export const SERVER_FRAME_TYPES = [
  'presence', 'presence-delta', 'groups', 'group', 'chat', 'voice-text', 'signal', 'error',
  'dm-sent', 'dm-failed', 'dm-read-ok', 'people', 'friend-result', 'invite-result',
  'dm', 'social-update', 'social-sync', 'friend-request', 'friend-accepted', 'people-presence', 'people-changed',
  'people-interaction', 'invite-knock', 'invite-answer', 'invite-house', 'transfer',
  'tables', 'table-state', 'tables-changed',
  'arena-state', 'arena-snap',
  'call-incoming', 'call-state', 'call-signal', 'call-settings', 'call-ice',
  'life-changed', 'social-read', 'social-changed', 'message-changed', 'message-pins',
  'live-snapshot', 'live-move',
  'ping-incoming', 'ping-joined', 'ping-ended',
  'notice', 'pulse', 'announce',
  'space-room', 'space-peer', 'space-screen',
  'feed-inbox',
  'world-live',
] as const satisfies readonly ServerFrameType[]
/** WORKER: every frame type the shared modules send, and its application heartbeat. */
export const WORKER_SERVER_FRAME_TYPES: readonly (ServerFrameType | HeartbeatFrame['type'])[] = [...SERVER_FRAME_TYPES, 'heartbeat']

/** Exact key sets of the core responses on the Node host, sorted. `storage` appears only while saving fails. */
export const HEALTH_RESPONSE_KEYS = ['build', 'companionAi', 'ok', 'relay', 'serverTime'] as const satisfies readonly (keyof HealthResponse)[]
export const SESSION_RESPONSE_KEYS = ['serverTime', 'session'] as const satisfies readonly (keyof SessionResponse)[]
export const PUBLIC_SESSION_KEYS = ['id', 'name'] as const satisfies readonly (keyof PublicSession)[]
/** What the Node server sends as its own session. */
export const OWN_SESSION_KEYS = ['cities', 'id', 'name'] as const satisfies readonly (keyof OwnSession)[]
export const LIFE_RESPONSE_KEYS = ['rev', 'serverTime', 'state'] as const satisfies readonly (keyof LifeResponse)[]
/** The same answer from a host that advertises interactive teaching starts. The default-off keyset above stays compatible. */
export const LIFE_RESPONSE_TEACHING_KEYS = ['interactiveTeachingStarts', 'rev', 'serverTime', 'state'] as const satisfies readonly (keyof LifeResponse)[]
/** A first answer to an accepted action; a refusal with a sentence adds `reason`, a repeat adds `duplicate`. */
export const ACTION_RESPONSE_KEYS = ['code', 'ok', 'rev', 'serverTime', 'state'] as const satisfies readonly (keyof ActionResponse)[]
export const ACTION_RESPONSE_TEACHING_KEYS = ['code', 'interactiveTeachingStarts', 'ok', 'rev', 'serverTime', 'state'] as const satisfies readonly (keyof ActionResponse)[]
export const ACTION_DUPLICATE_RESPONSE_KEYS = ['code', 'duplicate', 'ok', 'rev', 'serverTime', 'state'] as const satisfies readonly (keyof ActionResponse)[]
export const ACTION_DUPLICATE_RESPONSE_TEACHING_KEYS = ['code', 'duplicate', 'interactiveTeachingStarts', 'ok', 'rev', 'serverTime', 'state'] as const satisfies readonly (keyof ActionResponse)[]
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
