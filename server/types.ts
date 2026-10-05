/**
 * Server-only types: what is stored, and the contracts between the host and its modules.
 *
 * Derived from server/store.ts (the stored document and the storage interface), server/server.ts
 * (the context, the request object, the socket fields), server/routes/index.ts and
 * server/ws/index.ts (the two registries), server/routes/once.ts (receipts) and the header
 * comments of server/social/service.ts, server/civic/data.ts, server/moderation/service.ts,
 * server/support/service.ts and server/growth/data.ts (the five namespaced collections).
 *
 * Nothing here is sent to a browser as it stands: a SessionRecord holds the cookie secret.
 */
import type { LifeState } from '../src/types/life.ts'
import type { ActionType } from '../src/types/actions.ts'
import type { ActionRequest, CityId, ClientFrameType, IceServerConfig, PlayerRef, PublicSession, ServerFrame, TimedId } from '../src/types/protocol.ts'
import type { ConversationKind, LookIds, PlayerReportReceipt, ReportReason, SocialUpdate } from '../src/types/social.ts'
import type { PlayerReportStatus, StoreStats, SupportReport } from '../src/types/support.ts'
import type { ConsentView, OutreachLogLine, ShareFacts, ShareKind, TableGameId, TelemetryConfigResponse } from '../src/types/growth.ts'
import type { CampusElectionRecord } from '../src/types/campus.ts'

// ---- the stored document -------------------------------------------------------------------------
//
// One JSON document, `<dataDir>/devices.json`:
//   { version: 1, sessions, archivedLives?, social?, civic?, support?, moderation?, growth? }
// `sessions` and `archivedLives` are keyed maps the store clones entry by entry; every other
// top-level key is a namespaced collection created on first use by protocol.js collection().

/** Receipt of one POST /api/action (or ctx.act with an action id), kept for the action window (24 h). */
export interface ActionReceipt {
  /** The time inside the action id. */
  actionAt: number
  /** Authority prefix + JSON of [cityId, type, id, mode] + canonical payload; over 96 characters it is stored as head#length#hash. */
  fingerprint: string
  ok: boolean
  code: string
  /** Absent on receipts written before it was kept, and on every receipt the Worker writes. */
  type?: ActionType
}

/** Receipt of one ctx.once write (a transfer, a group, a shout-out, a problem report, …). */
export interface OnceReceipt {
  /** The time inside the client id. */
  at: number
  /** 'transfer', 'group', 'interact' (the one "light" kind), 'civic.run', 'civic.rent-ad', 'civic.shoutout', 'support.report'. */
  kind: string
  /** Bounded fingerprint of the request's contents. */
  fp: string
  /** What run() returned, at most 2 KB of JSON. */
  result: Record<string, unknown>
}

/** One city's life of one session (server/life-service.ts settleCity). */
export interface CityLifeRecord {
  state: LifeState
  /** Server ms this life was last settled to. */
  updatedAt: number
  /**
   * The per-life secret mixed into every random seed. 16–64 characters `[A-Za-z0-9_-]`. Stored
   * beside the state, never inside it, so nothing that sends a state can send it.
   */
  salt: string
}

/**
 * A device session. The key in `db.sessions` is `secret`.
 * Receipts are per SESSION (`actions`, `once`), not per city.
 */
export interface SessionRecord {
  /** The `sid` cookie value. Never returned, logged or copied into a collection. */
  secret: string
  /** The only id other players, collections and responses ever see. */
  publicId: string
  name: string
  /** Sliding expiry in server ms; an expired session with a lived life is archived. */
  expiresAt: number
  /** Created lazily, one entry per city the player has opened. */
  cities: Partial<Record<CityId, CityLifeRecord>>
  /** Keyed by action id. */
  actions: Record<TimedId, ActionReceipt>
  /** Set only when the session was created with `onboarding: true`: its lives start as guests of the quick start. */
  onboarding?: true
  /**
   * The session's ONE character: the city it is in. Written at start-up for every session already
   * stored (server/world/service.ts migrateCharacters) and when an intercity trip arrives, which also
   * records when and from where — a session that moved is then refused a new life in the city it left
   * (409 `city_moved`). A session created since the last start has none until it travels; readers
   * fall back to the city asked for.
   */
  character?: { v: 1; city: string; movedAt?: number; from?: string }
  /** Keyed by client/request id; created by the first ctx.once. */
  once?: Record<TimedId, OnceReceipt>
  /** server/world/service.ts rekey(): a separate life that was already filed under the city a character arrived in, put aside as `<city>:<ms>`. */
  legacyLives?: Record<string, CityLifeRecord>
  legacyLifeCities?: Record<string, CityId>
}
/**
 * WORKER: what deploy/cloudflare-worker.ts stores in its `sessions` table. Action receipts live
 * in their own SQL table (without `type`), and there is no `once` and no `onboarding`.
 */
export type WorkerSessionRecord = Pick<SessionRecord, 'secret' | 'publicId' | 'name' | 'expiresAt' | 'cities' | 'character' | 'legacyLives' | 'legacyLifeCities'>

/** An expired session's lives, kept without the secret (protocol.js archivedLife). Keyed by public id. */
export interface ArchivedLife {
  publicId: string
  name: string
  cities: Partial<Record<CityId, CityLifeRecord>>
  archivedAt: number
}

// ---- social collection (db.social) ---------------------------------------------------------------

export interface SocialPlayerRecord {
  name: string
  /** First and latest social request, server ms. */
  first: number
  seen: number
  /** Other id → since. */
  friends: Record<string, number>
  /** Friend requests received / sent: other id → at. */
  in: Record<string, number>
  out: Record<string, number>
  blocked: Record<string, number>
  /** Conversations this player lists, with their read marker. */
  convs: Record<string, { read: number }>
  /** At most 50, newest last. */
  updates: SocialUpdate[]
  /** At most 20, newest last. */
  reports: PlayerReportReceipt[]
  baeIn: Record<string, { at: number; cityId: CityId }>
  bae: string | null
  /** The host whose house this player is inside. */
  visiting: string | null
  /** Naira received as gifts on Lagos day `day`. */
  recv: { day: number; amount: number }
  /** Chats started with non-friends on Lagos day `day`. */
  chats: { day: number; count: number }
}
export interface MessageRecord {
  seq: number
  /** null for a system line. */
  from: string | null
  body: string
  at: number
  /** The sender's clientId. */
  cid?: string
  sys?: true
}
export interface ConversationRecord {
  id: string
  kind: ConversationKind
  /** Public ids. */
  members: string[]
  /** Groups only. */
  name?: string
  /** Groups (who runs it) and houses (the host). */
  owner?: string
  // INCONSISTENT: server/social/service.ts:690 also stores `creator` on a new group; the header comment of
  // that file (line 19) does not list it and nothing reads it.
  creator?: string
  /** Sequence number of the last message. */
  seq: number
  created: number
  /** Bounded history: the last 200. */
  messages: MessageRecord[]
}
export interface KnockRecord {
  at: number
  expires: number
  status: 'pending' | 'accepted' | 'declined'
  cityId: CityId
  // INCONSISTENT: `answeredAt` is written at server/social/service.ts:903 and read at :344, but is missing
  // from the collection shape documented at :21.
  answeredAt?: number
}
export interface VisitRecord { since: number; expires: number; cityId: CityId }
export interface HouseRecord {
  /** Visitor id → knock. */
  knocks: Record<string, KnockRecord>
  /** Guest id → visit. */
  guests: Record<string, VisitRecord>
}
/** The payload of the server-only action 'social.server': `op` selects what it does to the life. */
export type SocialEffectPayload =
  | { op: 'friend'; id: string; name: string }
  | { op: 'unfriend'; id: string }
  | { op: 'bae'; id: string; name: string }
  | { op: 'bae-end'; id: string }
  | { op: 'transfer-in'; from: string; name: string; amount: number; refund?: true }
/** A life effect owed to a player who was not connected (a gift waiting to be credited, a friendship to record). */
export interface PendingEffect {
  n: number
  at: number
  /** The city it was sent from; applied there, or to the recipient's most recently played life. */
  cityId: CityId
  payload: SocialEffectPayload
  /** Money: never dropped to make room. */
  keep: boolean
  /** An unclaimed gift on its way back to the sender. */
  refund?: true
}
/** A player's report about another player, for moderators (`R-<n>`). */
export interface PlayerReportRecord {
  id: string
  by: string
  about: string
  aboutName: string
  reason: ReportReason
  text: string
  at: number
  status: PlayerReportStatus
  evidence: string[]
  note?: string
  updatedAt?: number
}
export interface SocialCollection {
  players: Record<string, SocialPlayerRecord>
  convs: Record<string, ConversationRecord>
  houses: Record<string, HouseRecord>
  pending: Record<string, PendingEffect[]>
  /** At most 2000, newest last. */
  reports: PlayerReportRecord[]
  /** Shared counter for update ids, group ids, report ids and effect numbers. */
  seq: number
  /** Last hourly housekeeping run. */
  sweptAt?: number
}

// ---- civic collection (db.civic) -----------------------------------------------------------------

export interface ResidentRecord {
  name: string
  /** District (house id), `'own'` while the life lives in its own house on a plot, or null until the life has a house. */
  house: string | null
  since: number
  lastSeen: number
  /** Lagos day of the last check-in that counted a visit. */
  day: number
  cash: number
  /** Lagos week `earned` belongs to. */
  week: number
  earned: number
  gems: number
  claims: number
}
export interface ElectionRecord {
  candidates: Record<string, { name: string; slogan: string; at: number }>
  /** Voter id → candidate id. */
  votes: Record<string, string>
  /** Current election only: salted address key → votes counted from it. */
  addr?: Record<string, number>
  /** Current election only: address keys the audit trail already has a line for. */
  capLogged?: Record<string, true>
}
export interface AnnouncementRecord { id: string; by: PlayerRef; text: string; at: number; /** week of the Governor's election */ term: number }
export interface AdRecord { by: PlayerRef; text: string; colour: string; icon: string; at: number; expiresAt: number }
export interface ShoutoutRecord { id: string; by: PlayerRef; title: string; artist: string; at: number; startsAt: number; endsAt: number; requestId: string | null }
export interface CivicCityRecord {
  /** Last id issued for announcements (`a<n>`) and shout-outs (`r<n>`). */
  seq: number
  /** Resident-days. */
  visits: number
  prunedAt: number
  residents: Record<string, ResidentRecord>
  gov: { elections: Record<string, ElectionRecord>; announcements: AnnouncementRecord[] }
  ads: { billboard: Record<string, AdRecord>; sea: Record<string, AdRecord> }
  hunt: { found: number; claims: number; byDay: Record<string, number> }
  radio: { queues: Record<string, ShoutoutRecord[]>; daily: Record<string, { day: number; n: number }> }
}
export interface CivicCollection {
  v: 1
  /** `true` = hidden from that list; no entry = listed. */
  prefs: Record<string, { richList?: true; directory?: true }>
  /** Random; mixed into the address keys of the vote cap. Created by the first vote. */
  salt?: string
  // INCONSISTENT: `prefsPrunedAt` is written by server/routes/civic.ts:96-97 but is not in the shape documented
  // in server/civic/data.ts.
  prefsPrunedAt?: number
  cities: Partial<Record<CityId, CivicCityRecord>>
}

// ---- moderation and support collections ----------------------------------------------------------

export interface MuteRecord { at: number; until: number; reason: string; report?: string }
export interface AuditRecord { n: number; at: number; action: string; target: string; detail: string; from: string }
/**
 * db.moderation. Blocks are NOT here (they are `players[id].blocked` in the social collection) and
 * neither are reports (social.reports for players, support.reports for problems).
 */
export interface ModerationCollection {
  mutes: Record<string, MuteRecord>
  /** At most 1000, newest last. */
  audit: AuditRecord[]
  seq: number
}
/** db.support. */
export interface SupportCollection {
  /** At most 2000, newest last; a full inbox drops its oldest CLOSED report. */
  reports: SupportReport[]
  seq: number
}

// ---- growth collection (db.growth, server/growth/data.ts) ----------------------------------------
//
// Public ids only: never a cookie secret, an address or a device token (those are kept or compared
// only as a hash salted with `salt`). Created on first use by growthOf(); outreach.js adds
// `contacts`, `push` and `outreach` on ITS first use.

/** One finished table game not yet applied to the life (POST /api/growth/tables/claim applies it once). */
export interface PendingTableResult { cityId?: CityId; id: string; game: TableGameId; label: string; won: boolean; human: boolean; counted: boolean }
export interface GrowthPlayerRecord {
  /** Server ms of the last hello; 0 before the first. */
  seen: number
  /** Up to 3 salted hashes of this browser's device token. */
  devices: string[]
  /** Who invited this player, by which share code, and whether the two gifts have happened. */
  ref: { by: string; code: string; at: number; welcomed: boolean; counted: boolean } | null
  /** Friends who came through this player's links (at most 100), by public id. */
  invited: Record<string, { name: string; at: number; state: 'joined' | 'counted'; device: string }>
  /** How many invited friends have counted (titles). */
  counted: number
  /** Counted friends whose reward this inviter has not been paid yet (at most 40). */
  owed: string[]
  /** Share links made on Lagos day `day`. */
  shares: { day: number; n: number }
  consent: ConsentView | null
  /** The last finished table game (for a share). */
  table: { cityId?: CityId; game: TableGameId; label: string; won: boolean; at: number } | null
  /** At most 12. */
  wins: PendingTableResult[]
}
export interface ShareRecord { cityId?: CityId; by: string; kind: ShareKind; at: number; facts: ShareFacts; opened: number; joined: number }
/** server/growth/metrics.ts: daily totals, retention cohorts, and lives still inside their 31-day window (`steps` is a bit mask of funnel steps). */
export interface GrowthMetricsRecord {
  cities?: Partial<Record<CityId, GrowthCityMetricsRecord>>
  days?: Record<string, Record<string, number>>
  cohorts?: Record<string, { size: number; r: Record<string, number> }>
  lives?: Record<string, { first: number; last: number | null; steps: number }>
}
export type GrowthCityMetricsRecord = Omit<GrowthMetricsRecord, 'cities'>
export interface GrowthCityTablesRecord {
  ratings?: Record<string, Partial<Record<TableGameId, { rating: number; played: number; won: number }>>>
}
/** server/growth/tables.ts: ratings per player per game, and how often two players' games counted today. */
export interface GrowthTablesRecord {
  cities?: Partial<Record<CityId, GrowthCityTablesRecord>>
  ratings?: Record<string, Partial<Record<TableGameId, { rating: number; played: number; won: number }>>>
  pairs?: { day: number; counts: Record<string, number> }
}
/** What a channel last sent per period: the Lagos day of the last 'away' message and the Lagos week of the last 'week' one. */
export interface OutreachPeriods { away?: number; week?: number }
/** A consented e-mail address. It is returned to nobody: its owner sees it masked. */
export interface EmailContactRecord {
  email: string
  confirmed: boolean
  /** Part of every signed link; a changed address gets a new one, which voids the old links. */
  nonce: string
  at: number
  confirmedAt: number | null
  welcomed: boolean
  /** When confirmation e-mails were asked for (last 24 h). */
  confirms: number[]
  /** When scheduled messages went out (last 12). */
  sends: number[]
  periods: OutreachPeriods
  /** The last dry-run message composed for this player. */
  preview: { kind: string; at: number; subject: string; text: string } | null
}
export interface PushContactRecord {
  /** At most 3 per player. */
  subs: { endpoint: string; p256dh: string; auth: string; at: number }[]
  sends: number[]
  periods: OutreachPeriods
}
export interface OutreachRecord {
  /** The operator's kill switch per channel. */
  off: { email?: boolean; push?: boolean }
  /** At most 200 lines. */
  log: OutreachLogLine[]
  /** Messages sent (or composed in dry-run) per Lagos day, kept for 14 days. */
  sent: Record<string, { email: number; push: number }>
  /** The last 10 dry-run previews. */
  previews: { kind: string; at: number; subject: string; text: string }[]
  /** Set when a push service asked the server to wait. */
  pushPausedUntil?: number
}
export interface GrowthCollection {
  /** Random, made once; mixed into every hash of a device token or an address. */
  salt: string
  players: Record<string, GrowthPlayerRecord>
  /** Keyed by share code; at most 20 000, kept 30 days. */
  shares: Record<string, ShareRecord>
  metrics: GrowthMetricsRecord
  tables: GrowthTablesRecord
  /** Last hourly sweep. */
  sweptAt: number
  contacts?: Record<string, EmailContactRecord>
  push?: Record<string, PushContactRecord>
  outreach?: OutreachRecord
}

export interface Database {
  version: 1
  /** Keyed by cookie secret. */
  sessions: Record<string, SessionRecord>
  /** Keyed by public id. */
  archivedLives?: Record<string, ArchivedLife>
  social?: SocialCollection
  civic?: CivicCollection
  support?: SupportCollection
  moderation?: ModerationCollection
  growth?: GrowthCollection
  /** server/routes/campus.ts: this week's Student Union election. Created by the first nomination or vote, so it is not in COLLECTION_NAMES. */
  campus?: { election?: CampusElectionRecord }
  /** A collection a module added (collection names: a lower-case letter, then 1–31 letters or digits). */
  [collection: string]: unknown
}
/** Top-level keys of the document. */
export const DATABASE_KEYS = ['version', 'sessions', 'archivedLives', 'social', 'civic', 'support', 'moderation', 'growth', 'campus'] as const satisfies readonly (keyof Database)[]
/** The namespaced collections reached through `collection(db, name)`. */
export const COLLECTION_NAMES = ['social', 'civic', 'support', 'moderation', 'growth'] as const
export type CollectionName = (typeof COLLECTION_NAMES)[number]
export interface Collections {
  social: SocialCollection
  civic: CivicCollection
  support: SupportCollection
  moderation: ModerationCollection
  growth: GrowthCollection
}

// ---- storage interface ---------------------------------------------------------------------------

/** Host-only extras on the view a transaction sees. Feature modules must not rely on them. */
export interface StoreHelpers {
  /** Keys of sessions whose record satisfies `predicate`, without copying every record. */
  scanSessions(predicate: (record: SessionRecord, key: string) => boolean): string[]
  sessionKeyByPublicId(publicId: string): string | undefined
  /** WORKER: a store that keeps receipts apart from the session records counts the live ones itself (deploy/sqlite-store.ts). */
  onceCounts?(liveSince: number, lightKinds: readonly string[]): { money: number; light: number }
}
/** What `fn(db)` receives: private copies; nothing reaches the document unless the transaction returns. */
export type Db = Database & { readonly $store?: StoreHelpers }

export interface TransactOptions<T> {
  /**
   * Default true: the promise resolves only once the change is in the data file. `false`, or a
   * function of the result returning false, makes it lazy (written within about a second) — only
   * for a request that acknowledges nothing a player could see as an outcome.
   */
  durable?: boolean | ((result: T) => boolean)
  /** Runs once the change is in the file, in commit order, before the promise resolves. For in-memory indexes. */
  committed?: (result: T) => void
  /** A lazy transaction still waits for the unsaved durable changes of others it may have read. */
  waitForObserved?: boolean
}
/** Rejections carry `{ status: 503, code: 'storage_unavailable', reason }` when a write failed; the change was undone. */
export interface Store {
  transact<T>(operation: (db: Db) => T | Promise<T>, options?: TransactOptions<T>): Promise<T>
  read<T>(operation: (db: Db) => T | Promise<T>): Promise<T>
  flush?(): Promise<void>
  close?(): Promise<void>
  stats?(): StoreStats
  /** True while one of THIS store's transaction or read callbacks is running (hosts with several stores in one isolate). */
  executing?(): boolean
}

// ---- the route-module contract (server/routes/index.ts) ------------------------------------------

/** An error a handler throws to answer with a status: `ctx.fail(status, code)`, optionally with a `reason`. */
export interface HttpError extends Error {
  status: number
  code: string
  reason?: string
}

/** Portable request: no Node req/res, so a module can run on another host. */
export interface RouteRequest {
  method: string
  path: string
  /** `:name` segments of the route key, URI-decoded. */
  params: Record<string, string>
  query: URLSearchParams
  /** The client address, for rate-limit keys and the vote cap only. Never store it. */
  ip: string
  /** True only for a request carrying the operator's bearer token. */
  moderator(): boolean
  /** Rejects 415 / 413 / 400. */
  json(): Promise<Record<string, unknown>>
  session(db: Db, options?: { renew?: boolean }): SessionRecord | undefined
  /** Throws 401 device_session_required. */
  requireSession(db: Db, options?: { renew?: boolean }): SessionRecord
  /** Set by session()/requireSession() once the request's session is known (server/server.ts); the telemetry route reads it. */
  publicId?: string
  /** Foundation-only: the cookie secret and the raw Node request. */
  secret: string | undefined
  raw: unknown
}

export interface RouteResult {
  /** Default 200. */
  status?: number
  /** JSON object; the host adds `serverTime` (and `storage: 'failing'`) to a success. */
  body?: object
  /** Only Set-Cookie, Cache-Control and Retry-After are kept. */
  headers?: Record<string, string | string[]>
  /** Re-issue the sliding session cookie. */
  renew?: boolean
  /** Runs once the answer is out; a throw is logged and goes no further. */
  after?: () => void | Promise<void>
}
export type RouteHandler = (request: RouteRequest) => RouteResult | void | Promise<RouteResult | void>
export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
/** `'METHOD /api/<area>/…'`; a `:name` segment captures into request.params. */
export type RouteKey = `${RouteMethod} /api/${string}`
/** A route module's default export: called once at start-up with the context. */
export type RouteModule = (ctx: RouteContext) => Record<RouteKey, RouteHandler> | void
/** What buildRoutes() returns. `keys` is the registry src/types/protocol.test.ts compares with HTTP_ROUTE_KEYS. */
export interface RouteTable {
  keys: string[]
  match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string>; key: string } | null
}

/** What the rules engine answers for one action. */
export interface ActionOutcome {
  ok: boolean
  code: string
  state: LifeState
  reason?: string
  duplicate?: true
}
/** The body ctx.act takes: an action named by server code, never forwarded from a request. */
export interface ActBody {
  type: ActionType
  cityId: CityId
  payload?: Record<string, unknown>
  /** The request's action id (then the receipt steps of POST /api/action run), or a fixed seed string under a stateGuard. */
  actionId?: string
  /** At least 12 characters saying why a repeat cannot apply twice. Stripped before the action runs. */
  stateGuard?: string
}
export interface CommandOptions {
  /** Run with server authority, so server-only action types work. */
  internal?: boolean
  /** A fixed name for the calling route; required with `afterAction`. */
  scope?: string
  /** Synchronous; runs once after a SUCCESSFUL action and before the receipt. A throw discards everything. */
  afterAction?: (step: { db: Db; session: SessionRecord; result: ActionOutcome }) => void
}
export interface OnceDescriptor {
  /** The client's `<ms>:<uuid>` id. Mandatory: 400 without it. */
  id: unknown
  kind: string
  fingerprint: unknown
}
/** null, or why a player cannot post text right now. */
export interface MuteVerdict { code: 'muted'; reason: string; until: number }

/** Checks one module provides for another; each is absent until its module has been built. */
export interface ContextChecks {
  /** Social: is `guestId` an accepted, unexpired guest of `hostId` whose life is at home in `cityId`? */
  homeGuest?: (db: Db, guestId: string, hostId: string, cityId: CityId) => boolean
  /** Social: the same with the visit's expiry (server ms), or 0. */
  homeGuestUntil?: (db: Db, guestId: string, hostId: string, cityId: CityId) => number
  /** Social: either has blocked the other (in memory). */
  blocked?: (a: string, b: string) => boolean
  /** Social: is anybody blocked at all? */
  anyBlocks?: () => boolean
  /** Moderation. */
  muted?: (publicId: string) => MuteVerdict | null
  /** World: throws 409 `city_moved` when the session's character travelled away from `cityId` and has no life left there. */
  cityGate?: (session: SessionRecord, cityId: string) => void
  /** Growth: that player answered the age question with "under 18" (the one home of the age answer). */
  minor?: (db: Db, publicId: string) => boolean
}

export interface ServerConfig {
  sessionTtlMs: number
  actionWindowMs: number
  maxActiveSessions: number
  /** Optional TURN credential source for GET /api/voice-config. */
  voiceConfigProvider?: (session: PublicSession) => Promise<{ iceServers: IceServerConfig[]; expiresAt: number }> | { iceServers: IceServerConfig[]; expiresAt: number }
  /** At most 40 characters. */
  buildId: string
  votesPerAddress: number
  voteCapMode: 'flag' | 'refuse'
  heartbeatMs: number
  /** Whether the operator routes are enabled (the token itself is never in the context). */
  moderation: boolean
  /** PUBLIC_ORIGIN (`https://play.example`), or '' when it is not set: links in messages that leave the game need it. */
  publicOrigin: string
}

/** In-process events between server modules; nothing is sent to a client by raising one. */
export interface ServerEvents {
  /** rooms.js: a room's membership or a member's name changed. `cause` is who joined, left or was renamed. */
  'room-changed': { room: string; cityId: string; venueId: string; members: string[]; cause: string | null }
  /** social: a house visit ended; rooms.js drops that guest from the host's Home room. */
  'visit-ended': { hostId: string; guestId: string }
  /** social: a block or unblock was committed. */
  'blocks-changed': { a: string; b: string }
  /** host: every heartbeat. */
  heartbeat: { now: number }
  /** rooms.js: the host's life left home. */
  'home-closed': { hostId: string; cityId: string }
  /** rooms.js: a guest was dropped because the visit ran out. */
  'guest-expired': { hostId: string; guestId: string; cityId: string }
  /** rooms.js: a guest was dropped because the host had no socket in their own Home room past the grace period. */
  'host-absent': { hostId: string; guestId: string; cityId: string }
  /** civic: a player's directory preference is in the file; the world registry follows it (a hidden player's house stays on the map, anonymous). */
  'directory-pref': { id: string; hidden: boolean }
}

/** One small HTML page outside /api/ (ctx.pages): the link-preview page `/s/<code>` and the e-mail pages `/e/…`. No script runs on it and it sets no cookie. */
export type PageHandler = (request: { path: string; query: URLSearchParams; origin: string; ip: string; method: string }) => Promise<{ status?: number; html: string; cache?: boolean }>

/**
 * What the host's telemetry object offers the route modules (server/telemetry/index.ts); the host
 * itself uses more of it. Off, and doing nothing at all, unless its environment keys are set.
 */
export interface ContextTelemetry {
  enabled: boolean
  publicConfig(): TelemetryConfigResponse
  /** The player's browser said Accept (true) or Reject (false); returns whether analytics is now on for them. */
  consent(publicId: string, granted: boolean): boolean
}

/** The world's shard store (server/world/shards.ts): one append-only file per local government. Used only through server/world/service.ts. */
export interface ShardStore {
  read<T>(name: string, operation: (state: object) => T): Promise<T>
  /** `operation` returns the records that change the shard; it must not change the state itself. */
  transact<T>(name: string, operation: (state: object) => { records?: unknown[]; result: T }): Promise<T>
  /** The shard's state if it is already open, without reading its file. */
  peek(name: string): object | null
  /** One small derived JSON file beside the shards (the city summary). */
  readMeta(): Promise<unknown>
  writeMeta(value: unknown): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

/** Foundation internals. Not for feature modules. */
export interface ContextCore {
  archiveSession(db: Db, secret: string, session: SessionRecord): void
  expiredSessionKeys(db: Db): string[]
  sessionByPublicId(db: Db, publicId: string): SessionRecord | undefined
  unresponsive(ws: WsConnection): boolean
  storeStats(): StoreStats | null
  newIdentity(): { secret: string; publicId: string }
  newId(): string
  cookieHeader(request: RouteRequest, secret: string): string
  sockets(): WsConnection[]
  isOpen(ws: WsConnection): boolean
  /** The stored session of a socket, inside a transaction. */
  sessionOf(ws: WsConnection, db: Db): SessionRecord | undefined
  /** What POST /api/action runs: no server authority. */
  playerAct(state: LifeState, body: ActionRequest): ActionOutcome
  /** The receipt steps of an action; a repeat answers `{ ok, code, duplicate: true }` with no state. */
  actionOnce(session: SessionRecord, body: ActionRequest | ActBody, run: () => ActionOutcome, options?: { authority?: string }): ActionOutcome | { ok: boolean; code: string; duplicate: true }
  storageFailing(): boolean
  log(line: string): void
  /** True on a host that forgets what is in memory when nothing is pending (the Worker): a module that must not lose a seat keeps a timer going. Absent on Node. */
  hibernates?: boolean
  /**
   * Venue-chat retry receipts kept by a host whose memory does not last (the Worker): the Map-like history of this sender in
   * this room. Absent on Node, where ws/rooms.js keeps them in memory.
   */
  chatHistory?(ws: WsConnection, body: string): { has(id: string): boolean; get(id: string): unknown; set(id: string, chat: unknown): void; delete(id: string): void; keys(): Iterable<string>; readonly size: number }
  /** Kept here so the weakly-held life watcher lives as long as the server (set by rooms.js). */
  lifeWatcher?: (publicId: string, cityId: CityId, state: LifeState) => void
  // The four room lifecycle functions. The socket registry replaces the host's no-op defaults.
  validateMemberships(secret: string | undefined, cityId: CityId, state: LifeState, publicId?: string): Promise<void>
  revalidate(publicId: string): Promise<void>
  roomStillValid(ws: WsConnection, db: Db, session: SessionRecord, cityId: string, state: LifeState): boolean
  refreshNames(session: PublicSession): void
}

/** The server context every route and ws module receives once at start-up. */
export interface RouteContext {
  store: Store
  /** Server time in ms — never call Date.now(). */
  now(): number
  fail(status: number, code: string): HttpError
  /** In-memory rate limiter: at most `count` (120) calls per `windowMs` (60 000) for one key. */
  allow(key: string, count?: number, windowMs?: number): boolean
  /** The module's namespaced top-level collection, created on first use. */
  collection<K extends CollectionName>(db: Db, name: K, initial?: Partial<Collections[K]>): Collections[K]
  collection(db: Db, name: string, initial?: object): Record<string, unknown>
  /** To one socket (dropped silently unless it is open). */
  send(ws: WsConnection, message: ServerFrame): void
  /** The ONLY identity a module may expose. */
  publicSession(session: SessionRecord): PublicSession
  cityIds: readonly CityId[]
  randomId(): string
  on<E extends keyof ServerEvents>(event: E, listener: (data: ServerEvents[E]) => void): void
  emit<E extends keyof ServerEvents>(event: E, data: ServerEvents[E]): void
  /** The session's life in that city, settled to now (created on first use). */
  settle(session: SessionRecord, cityId: CityId): LifeState
  /** Run a game action with server authority, inside transact. Must be retry-safe or it throws. */
  act(state: LifeState, body: ActBody): ActionOutcome
  /** One game action for the caller as a whole request. Call it directly from the handler, never inside transact. */
  command(request: RouteRequest, body: ActionRequest, options?: CommandOptions): Promise<ActionOutcome>
  /** Exactly-once for a write that charges or creates something, inside transact. A repeat returns the first result plus `duplicate: true`. */
  once<R extends { ok?: boolean }>(db: Db, session: SessionRecord, descriptor: OnceDescriptor, run: (at: number) => R): R | (R & { duplicate: true })
  /** The id's time, or throws the same 400/409 — to refuse early. */
  onceId(id: unknown): number
  /** To every open socket of that player; returns how many. */
  push(publicId: string, message: ServerFrame): number
  online(publicId: string): boolean
  /** Read-only: that player's stored life is at Home in that city. */
  atHome(db: Db, publicId: string, cityId: string): boolean
  checks: ContextChecks
  config: ServerConfig
  /** Promises the host awaits before it takes requests. */
  startup: Promise<unknown>[]
  /** Async functions the host runs, in order, when it stops — before the world registry and the store are closed. Absent on a host without it. */
  closing?: (() => Promise<void>)[]
  /** Path prefix → page. Absent on a host that does not serve pages. */
  pages?: Map<string, PageHandler>
  /** Work that outlives the request that started it: a host that could stop between requests (the Worker) keeps itself up for it; Node does nothing. */
  waitUntil?(promise: Promise<unknown>): void
  /** One of the outreach settings on the host's allowlist (host-context.js OUTREACH_ENV), or '' — nothing else of the environment is reachable. */
  env(name: string): string
  /** An outside request for server/growth/outreach.ts: https only, never follows a redirect, cut off after 15 s. */
  fetch(url: string, init?: object): Promise<unknown>
  /** A secret this server makes for itself (signing key, push keys): DATA_DIR/keys with mode 0600 on Node, the Durable Object's own storage on the Worker. */
  keyFile<T extends object>(name: string, make: () => T | Promise<T>): Promise<T>
  /** Null on a host started without the shard store: the world routes then answer 503 `world_unavailable`. */
  shards: ShardStore | null
  telemetry: ContextTelemetry
  core: ContextCore
}

// ---- the ws-module contract (server/ws/index.ts) -------------------------------------------------

/**
 * An authenticated socket as the host and its modules see it. The underlying object is a `ws`
 * WebSocket; only the fields the server reads or adds are listed.
 */
export interface WsConnection {
  /** 1 = open. */
  readyState: number
  /** The sender's PUBLIC identity. */
  session: PublicSession
  /** The cookie secret: used to find the stored session; never sent to anyone. */
  secret: string
  expiresAt: number
  lastSessionRenewedAt: number
  ip: string
  // heartbeat (server.js)
  alive: boolean
  pingedAt: number
  seenAt: number
  // rooms.js — read-only for every other module
  /** `<city>:<venue>` or `<city>:home:<publicId>`; null outside a room. */
  room: string | null
  voice: { enabled: boolean; muted: boolean }
  position: { x: number; z: number }
  /** Server ms of the moves in the last second. */
  lastMoves: number[]
  /** Appearance recorded from the server-held life on join. */
  look: LookIds | null
  /** Marked by a life change: nothing is forwarded until it has been re-checked against the store. */
  stale: boolean
  /** Until when a guest's entitlement is remembered; 0 for a non-guest. */
  guestUntil: number
  // ws/social.js
  /** This socket asked `people-list` and is told when its room's membership changes. */
  peopleWatch?: boolean
  // growth/tables.js
  /** `<city>:<venue>` this socket last listed with `table-list` (it is told when a table there changes), or null. */
  tablesVenue?: string | null
}

/** A parsed client frame: `type` selected the handler; every other field is untrusted. */
export interface IncomingFrame { type: string; [field: string]: unknown }
/** A throw of `Error('machine_code')` (optionally with a string `reason`) becomes an `error` frame. */
export type WsMessageHandler = (ws: WsConnection, message: IncomingFrame) => void | Promise<void>
/** `{ room: true, handle }` is refused with 'join_required' unless the socket is in a room. */
export type WsMessageEntry = WsMessageHandler | { room?: boolean; handle: WsMessageHandler }

/** What the host tells socket modules about outside socket messages. Each hook is optional. */
export interface WsLifecycle {
  /** A life was settled or acted on and committed: drop sockets whose room it no longer allows. */
  validateMemberships?(secret: string | undefined, cityId: CityId, state: LifeState, publicId?: string): void | Promise<void>
  /** Re-check that player's sockets against the STORED lives. Called after every API request of a player with a socket in a room. */
  revalidate?(publicId: string): void | Promise<void>
  /** Would this socket's room still be granted? Asked before voice configuration is handed out. */
  roomStillValid?(ws: WsConnection, db: Db, session: SessionRecord, cityId: string, state: LifeState): boolean
  /** A session was created or renamed (the registry has already updated the sockets): re-announce presence. */
  refreshNames?(session: PublicSession): void
}
export interface WsHandlers {
  /** Message types are global; a duplicate aborts start-up. 2–40 characters `[a-z][a-z0-9-]*`. */
  messages?: Partial<Record<ClientFrameType, WsMessageEntry>> & Record<string, WsMessageEntry>
  /** A socket connected (already authenticated). */
  open?(ws: WsConnection): void
  close?(ws: WsConnection): void
  /** A host that lost its memory while the socket stayed connected hands it back with the fields it carried: rejoin your registries, announce nothing. Node never calls it. */
  restore?(ws: WsConnection): void
  lifecycle?: WsLifecycle
}
/** A ws module's default export. */
export type WsHandlerModule = (ctx: RouteContext) => WsHandlers | void
/** What buildSocketHandlers() returns. */
export interface WsDispatch {
  messages: Map<string, { room: boolean; handle: WsMessageHandler }>
  open(ws: WsConnection): void
  close(ws: WsConnection): void
  /** Hand a still-connected socket back to every module after the host lost its memory (Worker only). */
  restore(ws: WsConnection): void
}

/** The part of a Response that server/growth reads from an answer to ctx.fetch (typed `unknown` there; see growth/data.ts outboundResponse). */
export interface OutboundResponse {
  /** Undefined when the answer carried no numeric status; the senders then treat it as neither success nor an HTTP error code, as the JavaScript did. */
  status?: number
  headers?: { get(name: string): string | null }
}
