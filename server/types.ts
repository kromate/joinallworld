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
import type { CallRelay } from './call-relay.ts';
import type { LifeState } from '../src/types/life.ts'
import type { ActionType } from '../src/types/actions.ts'
import type { ActionRequest, CityId, ClientFrameType, IceServerConfig, PlayerRef, PublicSession, ServerFrame, TimedId } from '../src/types/protocol.ts'
import type { ConversationKind, LookIds, PlayerReportReceipt, ReportReason, SocialUpdate } from '../src/types/social.ts'
import type { PlayerReportStatus, StoreStats, SupportReport } from '../src/types/support.ts'
import type { ConsentView, OutreachLogLine, ShareFacts, ShareKind, TableGameId, TelemetryConfigResponse } from '../src/types/growth.ts'
import type { CampusElectionRecord } from '../src/types/campus.ts'
import type { BusinessCollection } from '../src/types/business.ts'
import type { ComebackType, LedgerType, PrefKey } from '../src/game/comeback.ts'

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
   * fall back to the city asked for. Version 1 without `movedAt` is the start-up pin of the earlier build,
   * fixed at one moment: it is not trusted; the newest life decides (server/character.ts characterCity).
   */
  character?: { v: 1 | 2; city: string; movedAt?: number; from?: string }
  /** Keyed by client/request id; created by the first ctx.once. */
  once?: Record<TimedId, OnceReceipt>
  /** server/world/service.ts rekey(): a separate life that was already filed under the city a character arrived in, put aside as `<city>:<ms>`. */
  legacyLives?: Record<string, CityLifeRecord>
  /** server/pulse.ts: the Lagos day (src/game/clock.ts) this player was last counted as a visit. Absent on older sessions. */
  visitDay?: number
  /**
   * Set only on a character that belongs to an account (server/accounts/service.ts): the account's id. Such a record
   * is filed under a key no browser holds — it is reached only through a device binding (`accountDevices`), and a
   * cookie that names its key directly is refused (protocol.ts sessionOfCookie).
   */
  account?: string
  legacyLifeCities?: Record<string, CityId>
  /**
   * Counts every settlement of this character (server/life-service.ts settleCity), so it only goes up: the order of the
   * answers its devices are given (docs/DEVICES.md). Absent on a record stored before it existed, which reads as 0.
   */
  rev?: number
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
  /** A character an account set aside (server/accounts/service.ts): the account that may bring it back, and what a session record carries beside its lives. */
  account?: string
  character?: SessionRecord['character']
  legacyLives?: SessionRecord['legacyLives']
  legacyLifeCities?: SessionRecord['legacyLifeCities']
  onboarding?: true
  /** NODE: the exactly-once receipts of a character an account set aside (the Worker keeps receipts in rows keyed by public id, which stay where they are). */
  actions?: SessionRecord['actions']
  once?: SessionRecord['once']
}

// ---- accounts (db.accounts, db.accountDevices, db.accountLog — server/accounts/service.ts) ----------
//
// An account is optional. It records who may reach a character from another device; it never holds a
// password, an ID token or a refresh token. Design: docs/ACCOUNTS.md.

/** How the provider says the account last signed in. */
export type AccountProviderId = 'google' | 'password'
/** A character an account has set aside: an entry of `archivedLives` (by public id) that only this account may bring back. */
export interface ParkedLife { id: string; name: string; at: number }
/** Keyed by account id (`fb:<provider subject>`). */
export interface AccountRecord {
  v: 1
  id: string
  provider: AccountProviderId
  /** The provider's subject id, taken from a verified ID token only. */
  subject: string
  /** The verified address the provider vouched for at the last sign-in: shown to its owner, used for nothing else. */
  email: string
  createdAt: number
  lastSeenAt: number
  /** Key of the account's active character in `sessions`, or null. Never a cookie value. */
  sessionKey: string | null
  /** Public id of the active character (kept so an expired, archived character can be brought back). */
  publicId: string | null
  /** Keys of this account's device bindings in `accountDevices`. At most MAX_DEVICES. */
  devices: string[]
  /** Characters set aside when a device that already had a played life signed in. At most MAX_PARKED. */
  parked: ParkedLife[]
  /**
   * The welcome message of a NEW account (server/accounts/welcome.ts). Absent: none is owed (the mailer was not configured
   * when the account was made, or the account predates it). 'pending': owed. A number: when it was sent. 'failed' /
   * 'skipped': it will not be sent. Set in the transaction that creates the account, so it is owed exactly once.
   */
  welcome?: 'pending' | 'failed' | 'skipped' | number
  /**
   * "E-mail me about my character" was on when the account was made (the creation screen says so next to its button). Set
   * only on an account created from the build that has comeback mail; absent on an older account, which has to switch it on
   * itself. Cleared when the owner unsubscribes from everything. Read when the character first plays after the change.
   */
  mailOptIn?: true
}
/** One signed-in browser. The key in `accountDevices` is that browser's `sid` cookie value. */
export interface AccountDeviceRecord { account: string; createdAt: number; seenAt: number; expiresAt: number }
export type AccountEvent = 'created' | 'signed_in' | 'linked' | 'restored' | 'parked' | 'switched' | 'character_started' | 'signed_out' | 'signed_out_everywhere' | 'deleted'
/** One line of the account audit trail: what happened, never a token, an address or a cookie. `ref` is a salted hash of the account id. */
export interface AccountAuditRecord { n: number; at: number; event: AccountEvent; ref: string; life?: string }
export interface AccountLogCollection {
  /** Random, made once; mixed into `ref`. */
  salt: string
  seq: number
  /** At most 2000, newest last. */
  audit: AccountAuditRecord[]
  /** Digest of every ID token already used → when it stops being acceptable anyway (server ms). */
  used: Record<string, number>
  /** Last housekeeping sweep, and how many accounts it left (kept current as accounts are made and deleted). */
  sweptAt?: number
  accounts?: number
  /** Welcome messages owed: when queued, attempts made, when the next may be made, and — while one is being sent — when it was claimed. At most 500. */
  welcome?: { id: string; at: number; tries: number; nextAt: number; claimedAt?: number; /** Its one last attempt, after a claim nobody settled. */ last?: true }[]
  /** Salted hashes of the addresses welcomed in the last 30 days → when. At most 5000. */
  welcomed?: Record<string, number>
}
/** The public client configuration of the sign-in provider (server/host-context.ts accountsConfig); null = accounts are off. */
export interface AccountsConfig { projectId: string; apiKey: string; googleClientId: string }

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
  /** Conversations this player lists, with their read marker, and (set only when on) that they muted or pinned it. */
  convs: Record<string, { read: number; mute?: true; pin?: true }>
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
  /** Who may ring this player (server/social/calls.ts); absent means the default, everyone. */
  calls?: 'everyone' | 'friends' | 'nobody'
  /** Who may add this player to a group: absent means friends; 'nobody' refuses every invitation (server/social/service.ts). */
  groups?: 'nobody'
  /** Absent: a mention breaks through a muted group. 'off': a muted group stays silent even for a mention. */
  mentions?: 'off'
  /** Pictures: 'nobody' refuses every picture sent to this player (server/social/images.ts). Absent: friends. */
  pictures?: 'nobody'
  /** An operator stopped this player sending pictures. */
  noPictures?: true
  /** Pictures sent on Lagos day `day`. */
  pics?: { day: number; count: number }
  /** Phone notifications for messages (server/growth/message-push.ts). Absent fields are the defaults. */
  notify?: { hide?: true; all?: true; until?: number; quietDm?: true; noQuiet?: true }
  /** This player was introduced to the founder (that character's id), once: never cleared (server/social/founder.ts). Absent: not yet. */
  founder?: { id: string; at: number }
  /** This player came through `by`'s invite link and the two were introduced, once: never cleared (server/social/service.ts meetInviter). Absent: not yet. */
  invite?: { by: string; at: number }
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
  /** The founder's welcome note: `body` is '' and the words come from server/social/founder.ts. */
  auto?: true
  /** With `auto`: the player's start the note was written from (server/social/founder.ts welcomeNote). Absent on earlier notes. */
  start?: { name: string; city?: string; trait?: string; dream?: string; v: number }
  /** Groups only: who the body mentions, as `[player id | 'everyone', start of the `@` in body, its length]`. The text of the mention is in the body itself. */
  men?: [string, number, number][]
  /** The message this one answers: its sequence number, its author and the first characters of it, frozen when this was sent. */
  re?: { seq: number; from: string; text: string }
  /** A gift of money sent from the chat: `n` naira, and `r` of it that went to a ride debt on arrival. Its words are in `body`. */
  gift?: { n: number; r?: number }
  /** Reactions: player id → the one emoji they reacted with (at most REACTION_KINDS different emoji on a message). */
  rx?: Record<string, string>
  /** A picture: the id of its bytes (kept apart from this collection), its size and what became of it. */
  img?: ImageRef
}
/** What a message holds of a picture. The bytes are in the image store (server/social/images.ts), never here. */
export interface ImageRef {
  id: string
  w: number
  h: number
  /** Bytes. */
  n: number
  /** The players who reported it (at most the report limit). */
  rp?: string[]
  /** Hidden from everyone: enough reports, or an operator hid it, pending review. */
  hid?: true
  /** Deleted: expired, pushed out by newer pictures, or removed by an operator. */
  gone?: true
}
/** One picture in the image store. */
export interface StoredImage { id: string; conv: string; at: number; size: number; type: 'jpeg' | 'png' | 'webp' }
/** Where picture bytes are kept: files on Node, a SQLite table of the Durable Object on the Worker. Never the `social` collection. */
export interface ImageStore {
  put(image: StoredImage, bytes: Uint8Array): Promise<void>
  get(id: string): Promise<{ image: StoredImage; bytes: Uint8Array } | null>
  /** Delete these; ids that are not there are ignored. */
  remove(ids: readonly string[]): Promise<void>
  /** Delete every picture of these conversations. */
  removeConv(convs: readonly string[]): Promise<void>
  /** Delete pictures stored before `before` (server ms) and, while the total is over `maxBytes`, the oldest. Returns the ids removed. */
  trim(before: number, maxBytes: number): Promise<string[]>
  stats(): Promise<{ count: number; bytes: number }>
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
  /** Groups: when `@everyone` was last used (server ms). Absent: never. */
  everyoneAt?: number
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
  /** The gift's line in the chat, so what the arrival did to it (a ride debt repaid) can be written there. */
  gift?: { conv: string; seq: number }
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
  /** A report about a picture: its id and conversation. */
  image?: string
  conv?: string
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
  /** The founder's account and its character, as last seen (server/social/founder.ts); checked against the account on every use. */
  founder?: { account: string; id: string }
  /** Pending pings, keyed `<from>><to>` (server/social/ping.ts): at most PING.open, each dropped once it can no longer be joined or count for the wait before the next. */
  pings?: Record<string, PingRecord>
  /** Journeys to another city each player made free of charge by joining a friend: server ms, the last 24 hours only. */
  pingJoins?: Record<string, number[]>
}
/** One pending ping: who asked whom to come, when, and where the pinger was. `venue` is a venue id or `'home'`; nothing more exact than that is ever kept. */
export interface PingRecord {
  from: string
  to: string
  at: number
  expires: number
  cityId: CityId
  venue: string
  /** `joined`: the friend came. `ended`: cancelled, or the pinger left the game. Kept until the wait before the next ping is over. */
  state: 'open' | 'joined' | 'ended'
  /** Made by the server when a new player arrived through this player's invite link (nobody pressed Ping, so nothing is mailed for it). */
  auto?: true
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
  /** When this city's civic record began (epoch ms); news is never dated before it. Absent in Lagos, whose record predates the field. */
  openedAt?: number
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
  /** Friends this player nudged to come back (public id → server ms), at most 50. */
  nudged?: Record<string, number>
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
  subs: { endpoint: string; p256dh: string; auth: string; at: number; /** The device's offset from UTC in minutes, when its browser said (quiet hours for messages). */ tz?: number }[]
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
/**
 * What comeback mail remembers about one player (server/growth/comeback.ts): their choices, what was sent, and when to
 * look at them next. Bounded: at most 12 sends, 20 keys, 5 nudges. Holds no address.
 */
export interface ComebackRecord {
  /** "E-mail me about my character". */
  on: boolean
  /** An address confirmed before comeback mail existed: its weekly digest goes on while `on` is false. */
  legacy: boolean
  pausedUntil: number
  types: Record<PrefKey, boolean>
  sent: { at: number; type: LedgerType }[]
  last: Partial<Record<ComebackType, number>>
  away: Partial<Record<'3' | '7' | '28', number>>
  keys: string[]
  waitingAt: number
  nudgeAt: number
  /** Friends who asked for this player (public id, server ms), at most 5. */
  nudges: { from: string; at: number }[]
  /** Server ms to look at this player next (NEVER = not until a visit or a change). */
  next: number
  /** The Lagos day a held-back mail was last counted. */
  suppressedDay: number
  /** Made for a character that belongs to an account: the record outlives the idle-player sweep (the choice stays) and its recipient is the account's verified address. Absent: the address of Stay in touch. */
  acct?: true
  /** Ping mails sent to this player (src/game/ping.ts): when, and whose ping. At most PING.mail.kept, a week of them; counted apart from `sent`. */
  pings?: { at: number; from: string }[]
}
/** Counters per Lagos day and per type of comeback mail. */
export type ComebackStats = Record<string, Record<string, { queued: number; sent: number; failed: number; suppressed: number; unsubscribed: number }>>
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
  /** server/growth/comeback.ts */
  comeback?: Record<string, ComebackRecord>
  comebackStats?: ComebackStats
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
  /** server/business/service.ts: every player-owned shop. Created by the first shop, so it is not in COLLECTION_NAMES. */
  business?: BusinessCollection
  /** server/routes/campus.ts: this week's Student Union election. Created by the first nomination or vote, so it is not in COLLECTION_NAMES. */
  campus?: { election?: CampusElectionRecord }
  /** server/accounts/service.ts. Created by the first sign-in, so none of the three is in COLLECTION_NAMES. WORKER: `accounts` and `accountDevices` are tables of their own. */
  accounts?: Record<string, AccountRecord>
  accountDevices?: Record<string, AccountDeviceRecord>
  accountLog?: AccountLogCollection
  /** A collection a module added (collection names: a lower-case letter, then 1–31 letters or digits). */
  [collection: string]: unknown
}
/** Top-level keys of the document. */
export const DATABASE_KEYS = ['version', 'sessions', 'archivedLives', 'social', 'civic', 'support', 'moderation', 'growth', 'business', 'campus', 'accounts', 'accountDevices', 'accountLog'] as const satisfies readonly (keyof Database)[]
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
  /** WORKER: keys of the sessions whose expiry has passed, found by the stored expiry so that no other record is read (deploy/sqlite-store.ts). */
  expiredSessionKeys?(now: number): string[]
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
  /** JSON characters held per collection, for the operator's overview. */
  sizes?(): Record<string, number>
  /** True while one of THIS store's transaction or read callbacks is running (hosts with several stores in one isolate). */
  executing?(): boolean
}

// ---- the route-module contract (server/routes/index.ts) ------------------------------------------

/** An error a handler throws to answer with a status: `ctx.fail(status, code)`, optionally with a `reason`. */
export interface HttpError extends Error {
  status: number
  code: string
  reason?: string
  /** Seconds after which trying again can succeed: the host sends it as `Retry-After` and as `retryAfter` in the answer. */
  retryAfter?: number
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
  /** Rejects 415 / 413 / 400. The body may be at most `limit` bytes (default 8 KiB). */
  json(limit?: number): Promise<Record<string, unknown>>
  session(db: Db, options?: { renew?: boolean }): SessionRecord | undefined
  /** Throws 401 device_session_required. */
  requireSession(db: Db, options?: { renew?: boolean }): SessionRecord
  /** Set by session()/requireSession() once the request's session is known (server/server.ts); the telemetry route reads it. */
  publicId?: string
  /**
   * Foundation-only. `secret` is the key of the caller's stored session: the cookie value until session() has resolved it,
   * then the record's own key (the two differ for a signed-in device, whose cookie is a device binding). `cookie` is
   * always the `sid` value the browser presented — the only value that may ever be sent back in a Set-Cookie.
   */
  secret: string | undefined
  cookie?: string | undefined
  /** The same value, only when it may name an account's device binding (host-context.ts mayBind): undefined for a cookie that arrived under the old name over HTTPS. */
  binding?: string | undefined
  /** True only when the request carried an Origin header naming this host (and, when present, Sec-Fetch-Site: same-origin). The account routes require it. */
  strictOrigin?: boolean
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
  /** Instead of `body`: bytes to send as they are, with their content type. Always sent `private`, `nosniff` and `inline`. */
  file?: { bytes: Uint8Array; type: string }
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
  /** The character's revision, on an outcome of ctx.command (server/routes/core.ts executeCommand). */
  rev?: number
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
  /** Tables: is this player seated at a game table? */
  seated?: (publicId: string) => boolean
  /** Rooms: the public ids sharing the caller's group of a venue room (null when the caller is not in it), and the venue's counts. */
  groupPeers?: (publicId: string, room: string) => string[] | null
  venueCounts?: (room: string) => { total: number; groups: number } | null
  /** Moderation. */
  muted?: (publicId: string) => MuteVerdict | null
  /** World: throws 409 `city_moved` when the session's character travelled away from `cityId` and has no life left there. */
  cityGate?: (session: SessionRecord, cityId: string) => void
  /** Growth: that player answered the age question with "under 18" (the one home of the age answer). */
  minor?: (db: Db, publicId: string) => boolean
  /**
   * Accounts: a session POST /api/session has just created. When the presented cookie is a device binding of an account
   * that has no character yet, the new record becomes that account's character (and is returned re-keyed).
   */
  adoptSession?: (db: Db, binding: string | undefined, session: SessionRecord) => SessionRecord
}

export interface ServerConfig {
  sessionTtlMs: number
  actionWindowMs: number
  /** Stored device sessions the host takes; a new visitor beyond it is asked to wait (server/host-context.ts capacityConfig). */
  maxActiveSessions: number
  /** Open sockets in all, per network address and per session (the same place). */
  maxSockets: number
  socketsPerAddress: number
  socketsPerPlayer: number
  /** New sessions one network address may make in an hour. */
  newSessionsPerAddress: number
  /** The sizes of the groups a public venue's room is split into (src/game/roomGroups.ts; server/host-context.ts capacityConfig). */
  roomGroupTarget: number
  roomGroupMax: number
  roomGroupMin: number
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
  /** The sign-in provider's public configuration; null or absent = accounts are off and every account route says so. */
  accounts?: AccountsConfig | null
  /** SHA-256 of the founder account's address (server/host-context.ts founderEmailHash); '' = no founder. Absent: the built-in one. */
  founderEmailSha256?: string
}

/** In-process events between server modules; nothing is sent to a client by raising one. */
export interface ServerEvents {
  /** rooms.js: a room's membership or a member's name changed. `cause` is who joined, left or was renamed. */
  'room-changed': { room: string; cityId: string; venueId: string; members: string[]; cause: string | null }
  /** social: a house visit ended; rooms.js drops that guest from the host's Home room. */
  'visit-ended': { hostId: string; guestId: string }
  /** social: a player who came through `inviter`'s link was introduced to them (comeback mail looks at the inviter soon). */
  'invite-joined': { inviter: string; /** The player who joined (absent on a build that did not say). */ newcomer?: string }
  /** social: a block or unblock was committed. */
  'blocks-changed': { a: string; b: string }
  /** social: a message reached a player's conversation (a direct message, a group message, a mention, a reply or a gift). The phone notification is decided from the stored state a few seconds later (growth/message-push.ts). */
  'chat-notice': { to: string; from: string | null; conv: string; seq: number; kind: 'message' | 'group' | 'mention' | 'reply' | 'gift' }
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
  /** Keys of the sessions to archive now. `always`: a session is about to be made, so a host that otherwise looks only now and then looks at once. */
  expiredSessionKeys(db: Db, always?: boolean): string[]
  sessionByPublicId(db: Db, publicId: string): SessionRecord | undefined
  unresponsive(ws: WsConnection): boolean
  storeStats(): StoreStats | null
  newIdentity(): { secret: string; publicId: string }
  newId(): string
  /** The Set-Cookie value(s) for a session cookie (two when a cookie under the old name is removed with it). */
  cookieHeader(request: RouteRequest, secret: string): string | string[]
  /** The Set-Cookie value(s) that remove the session cookie, with the same attributes it was set with. */
  clearCookieHeader?(request: RouteRequest): string | string[]
  /** Close one socket now (a device that signed out, a session that was re-keyed). */
  closeSocket?(ws: WsConnection, code: number, reason: string): void
  sockets(): WsConnection[]
  /** The open sockets of one player, found without walking everyone's. Absent on a host built without it: ask sockets(). */
  socketsOf?(publicId: string): WsConnection[]
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
  /** A character changed outside a settlement (another of its lives was put in play): its devices are told (host-context.ts lifeAnnouncer). */
  lifeChanged?: (publicId: string, rev: number) => void
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
  /** Would a call of allow(key, count) be allowed now? Counts nothing and creates no row: for checking a shared bucket before counting against a key of the caller's own. Absent on a host without it. */
  peek?(key: string, count?: number): boolean
  /** Milliseconds until the window of a limiter key ends (0: no window is running). For telling a refused caller when to come back. Absent on a host without it. */
  retryIn?(key: string): number
  /** The picture bytes (server/social/images.ts); null on a host built without them. */
  images: ImageStore | null
  /** The module's namespaced top-level collection, created on first use. */
  collection<K extends CollectionName>(db: Db, name: K, initial?: Partial<Collections[K]>): Collections[K]
  collection(db: Db, name: string, initial?: object): Record<string, unknown>
  /** To one socket (dropped silently unless it is open). */
  send(ws: WsConnection, message: ServerFrame): void
  /** The same frame to many sockets, turned into text once (a room's member list goes to everyone in it). Absent on a host built without it: send to each. */
  broadcast?(sockets: Iterable<WsConnection>, message: ServerFrame): void
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
  /** Relay credentials for calls (server/call-relay.ts). Absent on a context built without one: calls then get STUN only. */
  callRelay?: CallRelay
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
  /** The key of the stored session: used to find it; never sent to anyone. */
  secret: string
  /** The `sid` cookie the socket was opened with (differs from `secret` for a signed-in device). */
  device?: string
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
  /** The group of the room this socket is in (a public venue; null in a Home room). Kept so a sleeping Worker puts it back where it was. */
  group?: string | null
  /** This client reads the room as one snapshot and then changes (presence-delta), not a whole list every time. */
  deltas?: boolean
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
  // social/live.js
  /** Set while this socket watches live location (`live-watch`): the city whose counts it is sent, or '' for its friends only. */
  liveCity?: string | null
  // pulse.js
  /** This socket asked for the counts frames (`pulse-watch`) and is sent them when they change. */
  pulseWatch?: boolean
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
