/**
 * Social wire shapes: everything `/api/social/*` returns and accepts, the social frames on
 * `/socket`, and the browser's outbox entry.
 *
 * Derived from server/social/service.js (the rules), server/routes/social.js and
 * server/ws/social.js (the two adapters), server/social/presence.js, and — for what the browser
 * reads — src/ui/panels/social-client.js, messages.js, people.js, contacts.js, invite.js and
 * src/game/social-model.js.
 *
 * Conventions of every social route: it needs the session cookie; malformed input is HTTP 400
 * `{ error }`; a refusal for a game reason is HTTP 200 `{ ok: false, code, reason }`; a success is
 * `{ ok: true, code, … }`. A session whose lives are all still held for the quick start (their
 * look is not confirmed: state.onboarding.required) is refused with 403 `onboarding_required` on
 * every one of them; a guest who has tapped Play is in the city like anyone else.
 * WORKER: none of this exists on the Cloudflare Worker (every path is 404, every frame `invalid_message`).
 */
import type { ApiEnvelope, CityId, HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, PlayerRef, Refusal, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts'

// ---- building blocks -----------------------------------------------------------------------------

/** `yes(code, extra)` in the service. */
export type Done<Code extends string, Extra = unknown> = { ok: true; code: Code } & Extra
/** Set on a success that changed nothing because it had already been applied. */
export interface Repeat { duplicate?: true }

/** server/social/presence.js, as reported by whereabouts(). */
export type PresenceStatus = 'online' | 'away' | 'reconnecting' | 'offline'
export interface Whereabouts {
  status: PresenceStatus
  /** Server ms the connection was last heard from; once gone, when the last connection closed (absent after a restart). */
  seenAt?: number
  /** Only for a friend who is online in a room. */
  cityId?: string
  /** A venue id, `'home'`, or `'visit'` (in someone else's Home room). Only with `cityId`. */
  venue?: string
}

/**
 * The appearance option ids of the server-held life, re-validated on join (src/game/systems/
 * onboarding.js checkLook): eight ids always, plus the three optional fields exactly when the life's
 * look has them. The closed sets are life.ts `Look`.
 */
export interface LookIds {
  body: string
  hair: string
  outfit: string
  fabric: string
  skin: string
  hairColor: string
  outfitColor: string
  bottomsColor: string
  /** Only while at least one accessory is worn. */
  accessories?: string[]
  /** Only for a face / an expression other than the default. */
  face?: string
  expression?: string
}

export type ConversationKind = 'dm' | 'group' | 'house'
/** `dm.<idA>.<idB>` (ids sorted), `g.<n>`, `h.<hostId>`. */
export type ConversationId = string

/** A conversation as one member sees it (service.js summary()). */
export interface Conversation {
  id: ConversationId
  kind: ConversationKind
  /** dm: the other player's name; house: `<host>’s house`; group: its name. */
  name: string
  members: PlayerRef[]
  /** Public id of who runs a group, or of the host of a house chat; null for a dm. */
  owner: string | null
  /** dm only: the other player's public id. */
  with: string | null
  last: { seq: number; from: PlayerRef | null; body: string; at: number } | null
  unread: number
}

/** One message as one member sees it (service.js messageView()). */
export interface Message {
  seq: number
  /** `<conv>#<seq>`. */
  id: string
  conv: ConversationId
  /** null for a system line. */
  from: PlayerRef | null
  body: string
  at: number
  sys?: true
  /** The sender's retry key — only on the sender's own messages. */
  clientId?: string
}

export type SocialUpdateKind =
  | 'friend-request' | 'friend-accepted' | 'report' | 'group-added' | 'invite-knock' | 'invite-answer'
  | 'bae-request' | 'bae-answer' | 'transfer' | 'moderation'
/** One line of Messages → Updates (service.js notify()). */
export interface SocialUpdate {
  id: number
  kind: SocialUpdateKind
  text: string
  at: number
  read: boolean
  /** `{ from }`, `{ host }`, `{ conv }`, `{ report }` or `{ from, amount }` depending on `kind`; absent for `moderation`. */
  data?: { from?: string; host?: string; conv?: string; report?: string; amount?: number }
  // INCONSISTENT: src/ui/panels/inbox.js:52 keys a notification by `update.at` + `update.kind`, not by this
  // `id`, so two updates of one kind in the same millisecond share a key.
}

export type ReportReason = 'harassment' | 'spam' | 'cheating' | 'offensive-name' | 'other'
/** A player's own copy of a report they filed (`R-<n>`); the status follows the moderator's. */
export interface PlayerReportReceipt {
  id: string
  about: string
  name: string
  reason: ReportReason
  at: number
  status: 'received' | 'dismissed' | 'actioned'
}

export type HouseRole = 'host' | 'guest' | 'none'
/** A house as one viewer sees it (service.js houseView()). */
export interface HouseView {
  host: PlayerRef
  /** LIMITS.guests. */
  capacity: number
  guests: (PlayerRef & { since: number; expiresAt: number })[]
  role: HouseRole
  /** The city of the viewer's visit, else of the first guest's, else null. */
  cityId: CityId | null
  /** `h.<hostId>` when there are guests and the viewer is host or guest. */
  conv: ConversationId | null
  hostStatus: 'home' | 'out' | 'reconnecting' | 'offline'
  /** Pending knocks; only ever non-empty for the host. */
  knocks: { from: PlayerRef; at: number; expiresAt: number }[]
}

export interface Friend extends PlayerRef, Whereabouts {
  /** Server ms the friendship began. */
  since: number
  bae: boolean
}

export interface SocialLimits {
  body: number
  groupSize: number
  groupName: number
  guests: number
  reportText: number
  reasons: ReportReason[]
}

/** GET /api/social/me. */
export interface SocialOverview {
  ok: true
  code: 'ok'
  me: { id: string; name: string; since: number }
  /** Sorted by name. */
  friends: Friend[]
  requests: { in: (PlayerRef & { at: number })[]; out: (PlayerRef & { at: number })[] }
  baeRequests: (PlayerRef & { at: number })[]
  bae: PlayerRef | null
  blocked: (PlayerRef & { at: number })[]
  /** Newest first. */
  conversations: Conversation[]
  /** Newest first. */
  updates: SocialUpdate[]
  /** Newest first. */
  reports: PlayerReportReceipt[]
  /** The caller's own house. */
  house: HouseView
  /** The house the caller is inside as a guest, else null. */
  visiting: HouseView | null
  /** `/v/<publicId>`. */
  invitePath: string
  limits: SocialLimits
}

/** One player in the caller's venue room. */
export interface PersonHere extends PlayerRef {
  friend: boolean
  /** The caller has a friend request out to them. */
  requested: boolean
  /** They have a friend request out to the caller. */
  incoming: boolean
  look: LookIds | null
  /** The room module has them in the room right now (always true except for a house guest who has not joined yet). */
  here: boolean
}
/** GET /api/social/people and the `people` frame. */
export interface PeopleListing {
  ok: true
  code: 'ok'
  cityId: CityId
  /** The caller's stored location. */
  venue: string
  self: 'travelling' | 'joined' | 'not_joined'
  players: PersonHere[]
  count: number
}

export interface SearchResult extends PlayerRef { friend: boolean }

/** GET /api/social/players/:id → `player`. Where they are is only detailed for a friend. */
export interface PersonCard extends PlayerRef, Whereabouts {
  self: boolean
  friend: boolean
  requested: boolean
  incoming: boolean
  /** The caller blocked them. */
  blocked: boolean
  bae: boolean
  /** The caller's Bae request to them is waiting. */
  baeAsked: boolean
}

// ---- request bodies ------------------------------------------------------------------------------

export interface FriendRequestBody { to: string; cityId: CityId }
export interface FriendAnswerBody { from: string; accept: boolean; cityId: CityId }
export interface FriendRemoveBody { id: string; cityId: CityId }
export interface BlockBody { id: string; cityId: CityId }
export interface UnblockBody { id: string }
export interface PlayerReportBody { id: string; reason: ReportReason; text?: string }
/** `clientId` here is any retry key of 8–80 characters `[A-Za-z0-9:_-]`; the browser sends a TimedId. */
export type SendMessageBody = ({ to: string } | { conv: ConversationId }) & { body: string; clientId: string }
export interface ReadBody { seq?: number }
export interface GroupCreateBody { name: string; members: string[]; clientId: TimedId }
export type GroupUpdateBody = { op: 'rename'; name: string } | { op: 'add' | 'remove'; id: string } | { op: 'leave' }
export interface KnockBody { host: string; cityId: CityId }
export interface KnockAnswerBody { visitor: string; answer: 'accept' | 'decline' }
/** A guest leaves (`guest` omitted) or the host asks `guest` to leave. */
export interface HouseLeaveBody { host: string; guest?: string }
/** `action` is an id from PLAYER_ACTIONS (src/game/content/npcs.js): hello, gist, joke, shade. */
export interface InteractBody { action: string; cityId: CityId; clientId: TimedId }
export interface BaeAskBody { id: string; cityId: CityId }
export interface BaeAnswerBody { from: string; accept: boolean; cityId: CityId }
export interface BaeEndBody { cityId: CityId }
export interface TransferBody { to: string; amount: number; cityId: CityId; clientId: TimedId }

// ---- results -------------------------------------------------------------------------------------

/** other(): the same three refusals wherever another player is named. */
export type OtherPlayerRefusal = 'self' | 'unknown_player' | 'blocked'
export type TextRefusal = 'muted' | 'text_blocked'
/** Group names also refuse links and contact details. */
export type LabelRefusal = TextRefusal | 'links_not_allowed' | 'contact_not_allowed'

export type FriendAnswerResult =
  | Done<'accepted', { player: PlayerRef } & Repeat>
  | Done<'declined', { player: PlayerRef }>
  | Refusal<'no_request' | 'friends_full'>
/** A request to someone who already asked the caller is answered as an accept. */
export type FriendRequestResult =
  | Done<'requested' | 'already_friends', { player: PlayerRef } & Repeat>
  | FriendAnswerResult
  | Refusal<OtherPlayerRefusal | 'rate_limited' | 'too_many_requests' | 'inbox_full' | 'friends_full'>
export type FriendRemoveResult = Done<'removed', Repeat>
export type BlockResult = Done<'blocked', Repeat> | Refusal<'self' | 'unknown_player' | 'block_list_full'>
export type UnblockResult = Done<'unblocked'>
export type PlayerReportResult = Done<'reported', { receipt: PlayerReportReceipt } & Repeat> | Refusal<'self' | 'unknown_player' | 'rate_limited'>
export type ConversationsResult = Done<'ok', { conversations: Conversation[]; unread: number }>
/** At most 50 messages after `?after=<seq>`; `read` is the caller's read marker. */
export type HistoryResult = Done<'ok', { conv: Conversation; messages: Message[]; read: number }> | Refusal<'not_a_member'>
export type ReadResult = Done<'read', { conv: Conversation }> | Refusal<'not_a_member'>
export type SendMessageResult =
  | Done<'sent', { conv: Conversation; message: Message } & Repeat>
  | Refusal<OtherPlayerRefusal | TextRefusal | 'not_a_member' | 'rate_limited' | 'new_chat_limit' | 'awaiting_reply'>
export type GroupCreateResult =
  | Done<'created', { conv: Conversation } & Repeat>
  | Refusal<LabelRefusal | 'rate_limited' | 'too_many_groups' | 'group_full' | 'friends_only' | 'not_a_member'>
export type GroupUpdateResult =
  | Done<'left'>
  | Done<'updated', { conv: Conversation } & Repeat>
  | Refusal<LabelRefusal | 'not_a_member' | 'owner_only' | 'group_full' | 'friends_only' | 'too_many_groups' | 'self'>
/** `knock` is the caller's own knock at that door, if one is stored. */
export type HouseResult =
  | Done<'ok', { house: HouseView; knock: { status: 'pending' | 'accepted' | 'declined'; expiresAt: number } | null }>
  | Refusal<'unknown_player'>
export type KnockResult =
  | Done<'inside', { house: HouseView; duplicate: true }>
  | Done<'knocking', { expiresAt: number } & Repeat>
  | Refusal<OtherPlayerRefusal | 'knock_cooldown' | 'host_offline' | 'host_reconnecting' | 'host_not_home' | 'house_full' | 'rate_limited'>
/**
 * THE INVITE LANDING: who the caller is joining and how that player can be reached right now.
 *   'joined'        the caller is a brand-new guest and the inviter is in a public venue: the guest was
 *                   put there (free, once per life, only in its first minutes). Answers `venue`.
 *   'here'          they already share that venue. Answers `venue`.
 *   'at_home'       the inviter is at home: the client offers the knock.
 *   'out' | 'offline' | 'reconnecting'   nothing to join right now.
 * `hostStatus` is exactly what GET /api/social/house/:host tells anyone who holds the link.
 */
export type JoinResult =
  | Done<'joined' | 'here', { host: PlayerRef; hostStatus: 'out'; venue: string }>
  | Done<'at_home', { host: PlayerRef; hostStatus: 'home' }>
  | Done<'out', { host: PlayerRef; hostStatus: 'out' }>
  | Done<'offline', { host: PlayerRef; hostStatus: 'offline' }>
  | Done<'reconnecting', { host: PlayerRef; hostStatus: 'reconnecting' }>
  | Refusal<'self' | 'unknown_player' | 'rate_limited'>
export type KnockAnswerResult =
  | Done<'accepted' | 'declined', { house: HouseView } & Repeat>
  | Refusal<'knock_expired' | 'already_answered' | 'host_not_home' | 'house_full'>
export type HouseLeaveResult = Done<'left', Repeat> | Refusal<'host_only'>
/**
 * `code` is the rules engine's ('interacted', or another success such as a joke that flopped);
 * `message` is the life's message line, `closeness` the caller's points with that player.
 * Refusals also pass through whatever the rules engine answered.
 */
export type InteractResult =
  | Done<string, { message: string; closeness: number } & Repeat>
  | Refusal<OtherPlayerRefusal | 'rate_limited' | 'not_joined' | 'not_here' | (string & {})>
export type BaeAskResult = Done<'asked', Repeat> | Refusal<OtherPlayerRefusal | 'friends_only' | 'already_have_bae' | 'rate_limited' | (string & {})>
export type BaeAnswerResult = Done<'accepted', Repeat> | Done<'declined'> | Refusal<'no_request' | 'already_have_bae' | (string & {})>
export type BaeEndResult = Done<'ended', Repeat>
export type TransferResult =
  | Done<'sent', { amount: number; to: PlayerRef; /** false: stored until the recipient's next request */ credited: boolean; creditedCity: CityId; /** the sender's cash afterwards */ balance: number } & Repeat>
  | Refusal<OtherPlayerRefusal | 'rate_limited' | 'friends_only' | 'account_too_new' | 'friendship_too_new' | 'recipient_limit' | 'recipient_unavailable' | 'recipient_no_life' | (string & {})>

// ---- HTTP ----------------------------------------------------------------------------------------

/** What every social route can throw before its own validation. 403 `onboarding_required`; 429 `rate_limited` (240 a minute per player). */
type SocialCommon = HostErrorCode | SessionErrorCode | StorageErrorCode | 'onboarding_required'
type SocialPost = SocialCommon | JsonBodyErrorCode

export interface SocialHttpRoutes {
  'GET /api/social/me': { response: Ok<SocialOverview>; errors: SocialCommon }
  'POST /api/social/updates/read': { body: Record<string, never>; response: Ok<Done<'read'>>; errors: SocialPost }
  'GET /api/social/people': { query: { city: CityId }; response: Ok<PeopleListing>; errors: SocialCommon | 'invalid_city' }
  /** `q`: 2–36 characters; a leading `@` is dropped. Matches a name fragment or a whole public id; at most 10 results. */
  'GET /api/social/search': { query: { q: string }; response: Ok<Done<'ok', { results: SearchResult[] }> | Refusal<'rate_limited'>>; errors: SocialCommon | 'invalid_query' }
  'GET /api/social/players/:id': { params: { id: string }; response: Ok<Done<'ok', { player: PersonCard }> | Refusal<'unknown_player'>>; errors: SocialCommon | 'invalid_player' }
  'POST /api/social/players/:id/interact': { params: { id: string }; body: InteractBody; response: Ok<InteractResult>; errors: SocialPost | OnceErrorCode | 'invalid_player' | 'invalid_city' | 'invalid_interaction' }
  'POST /api/social/friends/request': { body: FriendRequestBody; response: Ok<FriendRequestResult>; errors: SocialPost | 'invalid_player' | 'invalid_city' }
  'POST /api/social/friends/answer': { body: FriendAnswerBody; response: Ok<FriendAnswerResult>; errors: SocialPost | 'invalid_player' | 'invalid_city' | 'invalid_answer' }
  'POST /api/social/friends/remove': { body: FriendRemoveBody; response: Ok<FriendRemoveResult>; errors: SocialPost | 'invalid_player' | 'invalid_city' }
  'POST /api/social/block': { body: BlockBody; response: Ok<BlockResult>; errors: SocialPost | 'invalid_player' | 'invalid_city' }
  'POST /api/social/unblock': { body: UnblockBody; response: Ok<UnblockResult>; errors: SocialPost | 'invalid_player' }
  'POST /api/social/reports': { body: PlayerReportBody; response: Ok<PlayerReportResult>; errors: SocialPost | 'invalid_player' | 'invalid_reason' | 'invalid_report_text' }
  'GET /api/social/conversations': { response: Ok<ConversationsResult>; errors: SocialCommon }
  'GET /api/social/conversations/:id': { params: { id: ConversationId }; query: { after?: number }; response: Ok<HistoryResult>; errors: SocialCommon | 'invalid_conversation' }
  'POST /api/social/conversations/:id/read': { params: { id: ConversationId }; body: ReadBody; response: Ok<ReadResult>; errors: SocialPost | 'invalid_conversation' }
  /** 409 `client_id_conflict`: the same clientId was already used in that conversation with another body. */
  'POST /api/social/messages': { body: SendMessageBody; response: Ok<SendMessageResult>; errors: SocialPost | 'invalid_client_id' | 'invalid_message' | 'invalid_player' | 'invalid_conversation' | 'client_id_conflict' }
  'POST /api/social/groups': { body: GroupCreateBody; response: Ok<GroupCreateResult>; errors: SocialPost | OnceErrorCode | 'invalid_group_name' | 'invalid_members' | 'invalid_player' }
  'POST /api/social/groups/:id': { params: { id: ConversationId }; body: GroupUpdateBody; response: Ok<GroupUpdateResult>; errors: SocialPost | 'invalid_conversation' | 'invalid_group_name' | 'invalid_player' | 'invalid_group_op' }
  'GET /api/social/house/:host': { params: { host: string }; response: Ok<HouseResult>; errors: SocialCommon | 'invalid_player' }
  /** The same body as a knock: `{ host, cityId }`. */
  'POST /api/social/join': { body: KnockBody; response: Ok<JoinResult>; errors: SocialPost | 'invalid_player' | 'invalid_city' }
  'POST /api/social/house/knock': { body: KnockBody; response: Ok<KnockResult>; errors: SocialPost | 'invalid_player' | 'invalid_city' }
  'POST /api/social/house/answer': { body: KnockAnswerBody; response: Ok<KnockAnswerResult>; errors: SocialPost | 'invalid_player' | 'invalid_answer' }
  'POST /api/social/house/leave': { body: HouseLeaveBody; response: Ok<HouseLeaveResult>; errors: SocialPost | 'invalid_player' }
  'POST /api/social/bae/ask': { body: BaeAskBody; response: Ok<BaeAskResult>; errors: SocialPost | 'invalid_player' | 'invalid_city' }
  'POST /api/social/bae/answer': { body: BaeAnswerBody; response: Ok<BaeAnswerResult>; errors: SocialPost | 'invalid_player' | 'invalid_city' | 'invalid_answer' }
  'POST /api/social/bae/end': { body: BaeEndBody; response: Ok<BaeEndResult>; errors: SocialPost | 'invalid_city' }
  'POST /api/social/transfers': { body: TransferBody; response: Ok<TransferResult>; errors: SocialPost | OnceErrorCode | 'invalid_player' | 'invalid_city' | 'invalid_amount' }
}

// ---- socket: client → server (server/ws/social.js) ----------------------------------------------
//
// Each is answered on the sending socket. The browser sends only `people-list` (and `join` with a
// hostId): src/ui/panels/social-client.js does every other write over HTTP so that it always
// resolves to sent or failed. The other five are accepted by the server and used by its tests.

/** Same body as POST /api/social/messages. Answered `dm-sent` or `dm-failed`, never an `error` frame. */
export type DmSendFrame = { type: 'dm-send' } & SendMessageBody
export interface DmReadFrame { type: 'dm-read'; conv: ConversationId; seq?: number }
/** Asks for the who-is-here listing AND subscribes this socket to `people-changed`. At most 60 a minute. */
export interface PeopleListFrame { type: 'people-list'; cityId: CityId }
export type FriendRequestSendFrame = { type: 'friend-request' } & FriendRequestBody
export type FriendAnswerSendFrame = { type: 'friend-answer' } & FriendAnswerBody
export type InviteKnockSendFrame = { type: 'invite-knock' } & KnockBody
export type InviteAnswerSendFrame = { type: 'invite-answer' } & KnockAnswerBody
export type SocialClientFrame =
  | DmSendFrame | DmReadFrame | PeopleListFrame | FriendRequestSendFrame | FriendAnswerSendFrame | InviteKnockSendFrame | InviteAnswerSendFrame

// ---- socket: server → client ---------------------------------------------------------------------

/** Reply to `dm-send`. `clientId` is echoed when it was a string of at most 80 characters. */
export interface DmSentFrame { type: 'dm-sent'; clientId?: string; conv: Conversation; message: Message; duplicate?: true }
/** Reply to a refused OR malformed `dm-send` (`code` is then the 400 code, with a fixed `reason`). */
export interface DmFailedFrame { type: 'dm-failed'; clientId?: string; code: string; reason: string }
/** Reply to `dm-read`: the ReadResult spread into the frame. */
// INCONSISTENT: server/ws/social.js:9 documents `dm-read-ok { conv }` as if `conv` were the id; it is the whole
// conversation summary, with `ok` and `code` beside it, and a refusal (`not_a_member`) arrives under this same type.
export type DmReadOkFrame = { type: 'dm-read-ok' } & ReadResult
/** Reply to `people-list`. */
// INCONSISTENT: server/ws/social.js:10 documents `people { venue, self, players, count }`; the frame also carries
// `ok`, `code` and `cityId`, and src/ui/panels/social-client.js:201 drops the frame unless `ok` is set.
export type PeopleFrame = { type: 'people' } & PeopleListing
/** Reply to `friend-request` and `friend-answer`. */
export type FriendResultFrame = { type: 'friend-result' } & (FriendRequestResult | FriendAnswerResult)
/** Reply to `invite-knock` (`op: 'knock'`) and `invite-answer` (`op: 'answer'`). */
export type InviteResultFrame = ({ type: 'invite-result'; op: 'knock' } & KnockResult) | ({ type: 'invite-result'; op: 'answer' } & KnockAnswerResult)

/** A message in one of the player's conversations — also their own, for their other tabs. */
export interface DmFrame { type: 'dm'; conv: Conversation; message: Message }
export interface SocialUpdateFrame { type: 'social-update'; update: SocialUpdate }
/** Something of the player's changed server-side: re-read GET /api/social/me (and the life). */
export interface SocialSyncFrame { type: 'social-sync' }
export interface FriendRequestFrame { type: 'friend-request'; from: PlayerRef }
export interface FriendAcceptedFrame { type: 'friend-accepted'; by: PlayerRef }
/** A friend's first socket connected, or their last one closed. */
export interface PeoplePresenceFrame { type: 'people-presence'; id: string; status: 'online' | 'reconnecting' }
/** Who shares the player's venue room changed; carries no member data. Only to sockets that sent `people-list`. */
export interface PeopleChangedFrame { type: 'people-changed'; cityId: string; venueId: string }
export interface PeopleInteractionFrame { type: 'people-interaction'; from: PlayerRef; action: string; label: string; /** false: it flopped */ landed: boolean }
export interface InviteKnockFrame { type: 'invite-knock'; from: PlayerRef; expiresAt: number }
/** To the visitor. Note the tense: the request says `accept`/`decline`, the push says `accepted`/`declined`. */
export interface InviteAnswerFrame { type: 'invite-answer'; host: PlayerRef; answer: 'accepted' | 'declined'; house: HouseView }
/** The house as the recipient now sees it: sent to host and guests when the guest list changes. */
export interface InviteHouseFrame { type: 'invite-house'; house: HouseView }
export interface TransferFrame { type: 'transfer'; from: PlayerRef; amount: number; credited: boolean }

export type SocialReplyFrame = DmSentFrame | DmFailedFrame | DmReadOkFrame | PeopleFrame | FriendResultFrame | InviteResultFrame
export type SocialPushFrame =
  | DmFrame | SocialUpdateFrame | SocialSyncFrame | FriendRequestFrame | FriendAcceptedFrame | PeoplePresenceFrame | PeopleChangedFrame
  | PeopleInteractionFrame | InviteKnockFrame | InviteAnswerFrame | InviteHouseFrame | TransferFrame
export type SocialServerFrame = SocialReplyFrame | SocialPushFrame

// ---- browser side --------------------------------------------------------------------------------

/** What src/ui/panels/social-client.js call() resolves to when the request itself failed. */
export interface CallFailure {
  ok: false
  code: string
  reason: string
  /** true: no HTTP answer at all (the request may or may not have arrived). */
  transport: boolean
}

/** An unconfirmed message in the outbox (src/game/social-model.js createOutbox). */
export interface OutboxEntry {
  clientId: string
  /** Conversation id, or the provisional `to:<publicId>` of a chat that does not exist yet. */
  key: string
  body: string
  /** Browser clock (Date.now()), not server time. */
  at: number
  status: 'pending' | 'failed'
  tries: number
  reason: string | null
  /** A server refusal code, or `'failed'` / `'timeout'`. */
  code: string | null
  /** Added by social-client.js send(): what to POST. */
  target?: { to: string } | { conv: ConversationId }
}
/** What a thread shows: confirmed messages, then this conversation's outbox entries. */
export type ThreadItem = Message | OutboxEntry

/** The player's own knock, tracked by the Invite panel (social-client.js S.knock). */
export interface KnockState {
  host: string
  name: string
  status: 'sending' | 'knocking' | 'accepted' | 'declined' | 'failed'
  reason?: string
  expiresAt?: number
}

// ---- runtime key lists (protocol.test.ts) --------------------------------------------------------

export const SOCIAL_OVERVIEW_KEYS = [
  'bae', 'baeRequests', 'blocked', 'code', 'conversations', 'friends', 'house', 'invitePath', 'limits', 'me', 'ok', 'reports',
  'requests', 'serverTime', 'updates', 'visiting',
] as const satisfies readonly (keyof SocialOverview | keyof ApiEnvelope)[]
export const HOUSE_VIEW_KEYS = ['capacity', 'cityId', 'conv', 'guests', 'host', 'hostStatus', 'knocks', 'role'] as const satisfies readonly (keyof HouseView)[]
export const SOCIAL_LIMITS_KEYS = ['body', 'groupName', 'groupSize', 'guests', 'reasons', 'reportText'] as const satisfies readonly (keyof SocialLimits)[]
export const PEOPLE_LISTING_KEYS = ['cityId', 'code', 'count', 'ok', 'players', 'self', 'serverTime', 'venue'] as const satisfies readonly (keyof PeopleListing | keyof ApiEnvelope)[]
export const CONVERSATION_KEYS = ['id', 'kind', 'last', 'members', 'name', 'owner', 'unread', 'with'] as const satisfies readonly (keyof Conversation)[]
/** A sender's own message; someone else's has no `clientId`, a system line adds `sys`. */
export const OWN_MESSAGE_KEYS = ['at', 'body', 'clientId', 'conv', 'from', 'id', 'seq'] as const satisfies readonly (keyof Message)[]
export const REPORT_REASONS = ['harassment', 'spam', 'cheating', 'offensive-name', 'other'] as const satisfies readonly ReportReason[]
