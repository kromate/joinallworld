/**
 * Growth wire shapes: everything `/api/growth/*` and `/api/mod/growth/*` returns and accepts, the
 * `table-*` frames on `/socket`, and the two telemetry endpoints.
 *
 * Derived from server/routes/growth.ts and server/routes/growth-mod.ts (the adapters),
 * server/growth/referral.ts, share.js, outreach.js, tables.js and metrics.js (the answers),
 * server/ws/tables.ts (the socket adapter), server/telemetry/routes.ts and config.js, and the pure
 * modules src/game/share-model.ts, digest.js, calendar.js and outreach.js.
 *
 * Conventions of the `/api/growth/` routes that act for a player: the session cookie is required;
 * `cityId` is in the body; a refusal for a game reason is HTTP 200 `{ ok: false, code, reason }`
 * (`not_ready` for a session whose life in that city does not exist yet or is still held for the
 * quick start — a life is never created here); malformed input is HTTP 400 `{ error }`; each is
 * limited to 120 requests a minute per player (429 `rate_limited`).
 * WORKER: none of this exists on the Cloudflare Worker (every path is 404, every frame `invalid_message`).
 */
import type { LifeState } from './life.ts'
import type { GrowthView } from './view.ts'
import type { CityId, HostErrorCode, JsonBodyErrorCode, Ok, PlayerRef, Refusal, SessionErrorCode, StorageErrorCode } from './protocol.ts'
import type { Done, Repeat } from './social.ts'
import type { PrefKey } from '../game/comeback-prefs.ts'

// ---- shares and the events calendar ---------------------------------------------------------------

/** src/game/share-model.ts SHARE_KINDS. */
export type ShareKind = 'invite' | 'house' | 'missions' | 'week' | 'table' | 'event'

/**
 * What a share says (share-model.js cleanFacts): facts the server took from the sharer's own life.
 * Every field is always present; one that does not apply to the kind is `''`, `0` or `false`.
 * The only player-chosen text is `name`, which has passed the text filter.
 */
export interface ShareFacts {
  kind: ShareKind
  /** The sharer's display name. */
  name: string
  /** Where the sharer lives: the local government of their own house or the district of the home they rent; '' for a guest. */
  district: string
  city: string
  /** Missions finished today / in the set (missions). */
  done: number
  total: number
  /** Days lived actively (missions, week). */
  days: number
  /** Days played this week (week). */
  stamps: number
  /** The sharer's current title (missions, week). */
  title: string
  /** Table game label (table). */
  game: string
  won: boolean
  /** Event title (event). */
  event: string
  /** Venue label (event, table). */
  venue: string
  /** A table to land beside: makes a 'table' share an invitation to that table. */
  tableId: string
}

/** One occurrence of a calendar event (src/game/calendar.ts describe): server ms; `key` is unique per occurrence. */
export interface CalendarOccurrence {
  id: string
  key: string
  title: string
  blurb: string
  venue: string
  venueLabel: string
  icon: string
  start: number
  end: number
  /** It is on at the time the list was made. */
  live: boolean
  spray: boolean
  /** A table-game id the event features, or null. */
  table: string | null
}

// ---- hello: what happened while away, referrals, consent, the digest ------------------------------

/** What the caller may see of their own consent (growth.js consentView). */
export interface ConsentView {
  age: 'adult' | 'minor'
  push: boolean
  email: boolean
  /** Server ms the age question was last answered. */
  at: number
}

/** A friend who came through the caller's link. 'counted' once they have been paid for work on enough days. */
export interface InvitedFriend extends PlayerRef {
  state: 'joined' | 'counted'
  at: number
}

/** What the caller sees about their own referrals (referral.js view). Names only. */
export interface ReferralView {
  /** Who invited the caller, and whether the two gifts on their side have happened. */
  by: (PlayerRef & { welcomed: boolean; counted: boolean }) | null
  /** Newest first, at most 30. */
  invited: InvitedFriend[]
  /** Invited friends that have counted (for titles). */
  counted: number
  /** Invited friends still in state 'joined'. */
  waiting: number
  /** Counted friends whose reward the caller has not been paid yet. */
  owed: number
  /** The label of the referral title held, or null. */
  title: string | null
  nextTitle: { id: string; count: number; label: string } | null
  rules: { welcome: number; reward: number; stars: number; perWeek: number; lifetime: number; workDays: number; linkWithinDays: number }
  /** `view.growth.referral` of the caller's life. */
  paid: GrowthView['referral'] | null
}

/** The caller's own channels outside the game (outreach.js mine). The address is only ever shown masked. */
export interface OutreachMine {
  /** The WhatsApp Channel link the owner configured, or ''. */
  channel: string
  email: { address: string; confirmed: boolean; preview: { kind: string; subject: string; text: string } | null } | null
  push: { devices: number }
  /** Whether e-mail really leaves the server (otherwise it is composed and kept as a preview: dry-run). */
  live: { email: boolean }
  /** What the player chose about e-mails on their character, and the friends they have nudged. */
  comeback: ComebackView
}

/** The caller's choices about comeback mail (docs/COMEBACK-MAIL.md). Without a confirmed address everything is off. */
export interface ComebackView {
  /** Where the mails go: the address of Stay in touch, the verified address of the account, or nowhere yet. */
  source: 'contact' | 'account' | null
  /** The address the mails go to, masked, when `source` is 'account' (a Stay in touch address is in `contact.email`). */
  address?: string
  /** "E-mail me about my character". */
  on: boolean
  /** Server ms until which everything is paused, or 0. */
  pausedUntil: number
  types: Record<PrefKey, boolean>
  /** Friends the caller nudged (public id → server ms), kept 7 days: the card shows when it can be done again. */
  nudged: Record<string, number>
}
export interface ComebackBody { cityId: CityId; on?: boolean; types?: Partial<Record<PrefKey, boolean>>; pause?: boolean }
export interface NudgeBody { cityId: CityId; to: string }

/** The weekly digest exactly as it would be sent (src/game/digest.ts composeDigest). */
export interface Digest {
  subject: string
  greeting: string
  /** At most DIGEST.maxLines. */
  lines: string[]
  /** How many more lines there were. */
  more: number
  /** Up to three things to do, each with the panel that does it. */
  tasks: { text: string; app: string }[]
  footer: string
  caps: { perDay: number; perWeek: number; settleMinutes: number; quietFrom: number; quietTo: number; backoffDays: number[]; maxPerAbsence: number }
}

export interface HelloBody {
  cityId: CityId
  /** This browser's device token (16–64 characters `[A-Za-z0-9-]`); kept only as a salted hash. */
  device?: string
}
/** The one growth success without a `code`. */
export type HelloResult =
  | ({ ok: true } & {
    /** Present only when this request paid a referral gift: the life afterwards. */
    state?: LifeState
    /** Same value as `contact.channel`. */
    channel: string
    contact: OutreachMine
    /** `since`: server ms of the previous hello, or null on the first. */
    away: { hours: number; since: number | null }
    referral: ReferralView
    consent: ConsentView | null
    /** What is on now or starts within seven days, soonest first, at most 12. */
    events: CalendarOccurrence[]
    digest: Digest & { delivery: 'dry-run' }
    sharesLeft: number
  })
  | Refusal<'not_ready' | 'server_full'>

// ---- shares and referral links --------------------------------------------------------------------

export interface ShareBody {
  cityId: CityId
  kind: ShareKind
  /** kind 'event': the calendar event id. */
  event?: string
  /** kind 'table': a table id — the share is then an invitation to that table instead of the last result. */
  table?: string
}
/** `path` is `/s/<code>`. The same card twice on one Lagos day is the same link. */
export type ShareResult =
  | Done<'shared', { share: { code: string; path: string; facts: ShareFacts } }>
  | Refusal<'not_ready' | 'server_full' | 'nothing_to_share' | 'share_limit'>
export type ShareLookupResult =
  | { ok: true; kind: ShareKind; by: PlayerRef; facts: ShareFacts }
  | Refusal<'unknown_link'>

export interface ReferralLinkBody {
  cityId: CityId
  /** A share code (8–16 characters `[a-z0-9]`). */
  code: string
  device: string
}
/** A repeat with the same code answers `duplicate` and no `by`; a first link answers `by`, the inviter's name. */
export type ReferralLinkResult =
  | Done<'linked', { by: string }>
  | Done<'linked', { duplicate: true }>
  | Refusal<'not_ready' | 'server_full' | 'already_linked' | 'unknown_link' | 'own_link' | 'mutual_link' | 'too_late' | 'same_device' | 'address_limit' | 'inviter_full'>

// ---- consent, e-mail and push ---------------------------------------------------------------------

/**
 * The age question. Saying the age switches nothing on; `false` switches a channel off and deletes
 * what was stored for it. An age once given as under 18 is not raised by asking again.
 */
// INCONSISTENT: the route list at the top of server/routes/growth.ts documents this body as
// `{ age, push?, email? }`, without `cityId`, but the handler is built with route(), which validates
// `body.cityId` first and answers 400 invalid_city without one.
export interface ConsentBody {
  cityId: CityId
  age: 'adult' | 'minor'
  push?: boolean
  email?: boolean
}
export type ConsentResult =
  | Done<'saved', { consent: ConsentView }>
  | (Refusal<'under_18'> & { consent: ConsentView })
  | Refusal<'not_ready' | 'server_full'>

/** The one growth route that takes no `cityId`: it is not built with route(). `consent` must be the literal true. */
export interface EmailBody {
  email: string
  consent: true
}
/**
 * `email` is the stored address, masked. In dry-run no message exists to carry the confirmation
 * link, so the player's own screen gets its path instead (`confirmPath`).
 */
export type EmailResult =
  | Done<'confirm_sent', { email: string; dryRun: false }>
  | Done<'dry_run', { email: string; dryRun: true; confirmPath: string }>
  | Refusal<'age_required' | 'under_18' | 'invalid_email' | 'email_typo' | 'email_disposable' | 'confirm_limit'>

/** What PushSubscription.toJSON() gives: an https endpoint and the two base64url keys. */
export interface PushSubscriptionLike {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
export interface PushSubscribeBody {
  cityId: CityId
  subscription: PushSubscriptionLike
  consent: true
}
export interface PushUnsubscribeBody {
  cityId: CityId
  /** One subscription; without it, all of the caller's. */
  endpoint?: string
}

// ---- table games: claiming results ----------------------------------------------------------------

/** src/tables/games.ts GAMES. */
export type TableGameId = 'whot' | 'penalty'

/** The caller's rating in one game (two-player matches between two real players). */
export interface TableRating {
  rating: number
  played: number
  won: number
  /** Fewer than RATING.provisionalGames played. */
  provisional: boolean
}
/**
 * Each finished game not yet applied to the life, with the code 'growth.table-result' answered
 * ('paid', 'counted', 'for_fun' — or a veto code). `state` is present only when there was one.
 */
export type TablesClaimResult =
  | Done<'claimed', {
    results: { game: string; label: string; won: boolean; code: string }[]
    state?: LifeState
    ratings: Partial<Record<TableGameId, TableRating>>
  }>
  | Refusal<'not_ready'>

/** server/growth/metrics.ts CLIENT_SIGNALS: what a browser may report about itself. Anything else is ignored. */
export type ClientSignal = 'webgl-missing' | 'opera-mini' | 'save-data' | 'slow-start' | 'installed' | 'share-sheet' | 'share-fallback'

// ---- HTTP: /api/growth/ ---------------------------------------------------------------------------

/** What every route built with route() can throw before its own validation. */
type GrowthPost = HostErrorCode | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode | 'invalid_city'

export interface GrowthHttpRoutes {
  'POST /api/growth/hello': { body: HelloBody; response: Ok<HelloResult>; errors: GrowthPost }
  'POST /api/growth/share': { body: ShareBody; response: Ok<ShareResult>; errors: GrowthPost | 'invalid_share_kind' | 'invalid_event' | 'invalid_table' }
  /** No session needed. 60 a minute per address. */
  'GET /api/growth/share/:code': { params: { code: string }; response: Ok<ShareLookupResult>; errors: HostErrorCode | 'invalid_share_code' }
  'POST /api/growth/referral/link': { body: ReferralLinkBody; response: Ok<ReferralLinkResult>; errors: GrowthPost | 'invalid_share_code' | 'device_required' }
  'POST /api/growth/consent': { body: ConsentBody; response: Ok<ConsentResult>; errors: GrowthPost | 'invalid_age' | 'invalid_consent' }
  /** 400 `consent_required` unless `consent` is true; 10 an hour per address and 6 an hour per player. */
  'POST /api/growth/email': { body: EmailBody; response: Ok<EmailResult>; errors: HostErrorCode | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode | 'consent_required' }
  /** `removed` is false when no address was stored. */
  'POST /api/growth/email/remove': { body: { cityId: CityId }; response: Ok<Done<'removed', { removed: boolean }> | Refusal<'not_ready'>>; errors: GrowthPost }
  /** Switch comeback mail on or off, per type, or pause it 30 days (`pause: true`; `false` lifts it). Needs a confirmed address to switch anything on. */
  'POST /api/growth/comeback': { body: ComebackBody; response: Ok<Done<'saved', { comeback: ComebackView }> | Refusal<'not_ready' | 'no_address'>>; errors: GrowthPost | 'invalid_comeback' }
  /** Ask an away friend (2 days or more) to come back: friends only, once per friend per 7 days, 5 an hour. The answer never says whether the friend has an address. */
  'POST /api/growth/nudge': { body: NudgeBody; response: Ok<Done<'nudged', { note: string; nudged: number }> | Refusal<'not_ready' | 'not_friends' | 'not_away' | 'cooldown' | 'muted'>>; errors: GrowthPost | 'invalid_player' | 'rate_limited' }
  /** The server's VAPID public key (base64url). No session needed; never cached. */
  'GET /api/growth/push/key': { response: Ok<{ ok: true; publicKey: string }>; errors: HostErrorCode }
  'POST /api/growth/push/subscribe': {
    body: PushSubscribeBody
    response: Ok<Done<'subscribed'> | Refusal<'not_ready' | 'age_required' | 'under_18'>>
    errors: GrowthPost | 'consent_required' | 'invalid_subscription'
  }
  'POST /api/growth/push/unsubscribe': { body: PushUnsubscribeBody; response: Ok<Done<'unsubscribed'> | Refusal<'not_ready'>>; errors: GrowthPost }
  'POST /api/growth/tables/claim': { body: { cityId: CityId }; response: Ok<TablesClaimResult>; errors: GrowthPost }
  /** No session needed. At most 8 signals a request, 10 requests a minute per address; `counted` is how many were known. */
  'POST /api/growth/client': { body: { signals: ClientSignal[] }; response: Ok<{ ok: true; counted: number }>; errors: HostErrorCode | JsonBodyErrorCode }
}

// ---- HTTP: /api/mod/growth/ (the operator's view) -------------------------------------------------
//
// Same access rules as the other operator routes (support.ts ModerationHttpRoutes): 404 unless the
// server was started with MODERATOR_TOKEN, the token only in `Authorization: Bearer`.

/** A retention cell: null while that day has not come yet ("too early to say" is not "nobody came back"). */
export type RetentionCell = { returned: number; rate: number } | null

/** One Lagos day of counters: `day`, `date` ('YYYY-MM-DD') and every counter that was counted that day. */
export type MetricsDay = { day: number; date: string } & Record<string, number | string>

export interface MetricsCohort {
  day: number
  date: string
  /** Lives that began on that day. */
  size: number
  d1: RetentionCell
  d3: RetentionCell
  d7: RetentionCell
  d14: RetentionCell
  d30: RetentionCell
}

/** server/growth/metrics.ts FUNNEL_ORDER. */
export type FunnelStep = 'onboarded' | 'goal-1' | 'settled' | 'job' | 'shift' | 'goals-done' | 'mission' | 'table' | 'day-two-work'

/** GET /api/mod/growth/metrics: first-party daily totals and retention cohorts. Carries no player id. */
export interface GrowthMetricsResponse {
  generatedAt: number
  timezone: 'Africa/Lagos'
  source: 'first-party'
  days: MetricsDay[]
  cohorts: MetricsCohort[]
  /** Every counter summed over the days shown. */
  totals: Record<string, number>
  funnel: { step: FunnelStep; lives: number }[]
  /** Lives currently followed (inside their 31-day window). */
  tracked: number
  /** How long each kind of record is kept, as sentences. */
  retention: { daily: string; cohorts: string; perLife: string }
  /** Whether product analytics is ALSO running on this server; these numbers never depend on it. */
  analytics: 'also-configured' | 'not-configured'
}

/** One line of the outreach log: no address, no endpoint, no player id. */
export interface OutreachLogLine {
  at: number
  channel: 'email' | 'push'
  /** 'confirm', 'welcome', 'away', 'week' or 'switch'. */
  kind: string
  /** 'sent', 'dry-run', 'failed', 'skipped', 'gone', 'on', 'off'. */
  state: string
  status?: number
  /** At most 40 characters. */
  error?: string
}

/** The frequency rules a real channel honours (src/game/outreach.ts OUTREACH). */
export interface OutreachRules {
  perDay: number
  perWeek: number
  quietFrom: number
  quietTo: number
  backoffDays: number[]
  maxPerAbsence: number
  awayAfterHours: number
  weekly: { weekday: number; from: number; to: number }
  confirmsPerDay: number
  confirmHours: number
}

/** GET /api/mod/growth/outreach. */
export interface ComebackCounters { queued: number; sent: number; failed: number; suppressed: number; unsubscribed: number }
export interface OutreachOperatorResponse {
  email: {
    provider: 'zeptomail'
    configured: boolean
    /** A public origin is set (links in a message need one). */
    origin: boolean
    live: boolean
    off: boolean
    from: string | null
    confirmed: number
    awaitingConfirmation: number
    sentToday: number
    dailyCap: number
    lastError: OutreachLogLine | null
  }
  /** Comeback mail per type over the last 14 days. No address, name or id. */
  comeback: { days: number; types: Record<string, ComebackCounters>; today: Record<string, ComebackCounters>; waiting: number; /** Rounds that opened the store since the server started: the cost of the schedule. */ passes: number }
  push: { off: boolean; subscribers: number; devices: number; sentToday: number; dailyCap: number; pausedUntil: number | null; lastError: OutreachLogLine | null }
  whatsapp: { channel: string | null }
  rules: OutreachRules
  quietNow: boolean
  /** The last 100 lines, newest first. */
  log: OutreachLogLine[]
  /** The last dry-run previews, newest first; a preview never keeps a working link. */
  previews: { kind: string; at: number; subject: string; text: string }[]
}

/** What one round of the schedule did. `ran: false` when one is already running, or the server is stopping. */
export interface OutreachRunResponse {
  ran: boolean
  jobs?: number
  reason?: 'quiet_hours' | 'stopping'
  failed?: true
  /** What the comeback round did (it keeps its own hours, caps and quiet time). */
  comeback?: { ran: boolean; jobs?: number; reason?: 'not_configured' | 'idle' | 'stopping'; failed?: true }
}

type GrowthModCommon = 'not_found' | 'moderator_token_required' | 'rate_limited' | 'internal_error'

export interface GrowthModerationHttpRoutes {
  /** `days`: how many days to show (default 35, at most 400). */
  'GET /api/mod/growth/metrics': { query: { days?: number }; response: Ok<GrowthMetricsResponse>; errors: GrowthModCommon }
  'GET /api/mod/growth/outreach': { response: Ok<OutreachOperatorResponse>; errors: GrowthModCommon }
  /** The kill switch of one channel. */
  'POST /api/mod/growth/outreach/switch': {
    body: { channel: 'email' | 'push'; off: boolean }
    response: Ok<{ ok: true; channel: 'email' | 'push'; off: boolean }>
    errors: GrowthModCommon | JsonBodyErrorCode | StorageErrorCode | 'invalid_switch'
  }
  /** Run the schedule now (the same rules, caps and quiet hours apply). */
  'POST /api/mod/growth/outreach/run': { body: Record<string, never>; response: Ok<OutreachRunResponse>; errors: GrowthModCommon | JsonBodyErrorCode }
}

// ---- HTTP: telemetry (server/telemetry/routes.ts) -------------------------------------------------
//
// Registered by server/server.ts beside ROUTE_MODULES (`[...ROUTE_MODULES, telemetryRoutes]`), not by
// server/routes/index.ts, so they are not part of `HttpRoutes` / HTTP_ROUTE_KEYS, which describe
// what buildRoutes() registers by default.

/** What the browser may load. Never a secret: the PUBLIC Sentry DSN and the PostHog PROJECT key. */
export type TelemetryConfigResponse =
  | { enabled: false }
  | {
    enabled: true
    env: string
    release: string
    debug: boolean
    sentry: { dsn: string; replayOnError: boolean } | null
    posthog: { key: string; host: string; consentAt: 'reward' | 'landing' } | null
    /** Present (true) only for a caller who answered the age question with "under 18": analytics never starts for them. */
    under18?: true
  }

export interface TelemetryHttpRoutes {
  /** No session is created or renewed. */
  'GET /api/telemetry/config': { response: Ok<TelemetryConfigResponse>; errors: HostErrorCode }
  /** Kept in memory only. An Accept from a player who is under 18 is not kept. */
  'POST /api/telemetry/consent': {
    body: { analytics: boolean }
    response: Ok<{ analytics: boolean; under18?: true }>
    errors: HostErrorCode | JsonBodyErrorCode | SessionErrorCode | 'invalid_consent'
  }
}

// ---- socket: table games (server/ws/tables.ts, server/growth/tables.ts) ---------------------------
//
// A socket need not have joined a venue room: the service checks the stored life itself. A refusal
// is an ordinary `error` frame whose code is a TableErrorCode, with the sentence for the player in
// `reason` (and `message`).

/** A value of one table option (src/tables/<game>.js `options`). */
export type TableOptionValue = string | number | boolean

export interface TableSeat {
  name: string
  bot: boolean
  /** Real players only. */
  id?: string
  /** Real players only: their last connection to the table is gone (they forfeit after a while). */
  away?: boolean
  /** Present (true) once the seat has left or forfeited. */
  left?: true
}

/** What anyone may know about a table: who sits, whether a game is on. Never a card. */
export interface TableSummary {
  id: string
  venue: string
  venueLabel: string
  game: TableGameId
  gameLabel: string
  label: string
  status: 'open' | 'playing' | 'over'
  /** Seats: the most this table takes and the fewest the game needs. */
  max: number
  min: number
  options: Record<string, TableOptionValue>
  seats: TableSeat[]
  /** People attached to the table who are not seated. */
  watching: number
}

/** What a finished game recorded for one player; `rating` and `change` only in a two-player game between two real players that counted. */
export interface TableResultMine {
  won: boolean
  draw: boolean
  /** At least one opponent was a real player. */
  human: boolean
  /** It counts for pay, rating and missions (the same two players' games count three times a day). */
  counted: boolean
  rating?: number
  change?: number
}

/** Ask for a venue's tables (every table of the city without `venue`); the socket is then nudged when one of them changes. */
export interface TableListFrame { type: 'table-list'; cityId: CityId; venue?: string }
/** Attach to a table: answered with `table-state`, and again whenever the table changes. */
export interface TableWatchFrame { type: 'table-watch'; cityId: CityId; table: string }
export interface TableUnwatchFrame { type: 'table-unwatch' }
/** Take a seat; the caller's stored life must be in the table's venue. */
export interface TableSitFrame { type: 'table-sit'; cityId: CityId; table: string }
/** The first to sit sets the table's rules, before a game. Unknown names and values are ignored. */
export interface TableOptionsFrame { type: 'table-options'; cityId: CityId; table: string; options: Record<string, TableOptionValue> }
/** Start with the people seated, plus `bots` house players. */
export interface TableStartFrame { type: 'table-start'; cityId: CityId; table: string; bots?: number }
/** Play. `n` is the number of moves made when the move was chosen, so a move is applied exactly once however often it is sent. */
export interface TableMoveFrame { type: 'table-move'; cityId: CityId; table: string; n: number; move: unknown }
/** Give up the seat (during a game: forfeit). */
export interface TableLeaveFrame { type: 'table-leave'; cityId: CityId; table: string }
/** After a game: open the table again. */
export interface TableAgainFrame { type: 'table-again'; cityId: CityId; table: string }
export type TableClientFrame =
  | TableListFrame | TableWatchFrame | TableUnwatchFrame | TableSitFrame | TableOptionsFrame | TableStartFrame | TableMoveFrame
  | TableLeaveFrame | TableAgainFrame

/** The answer to `table-list`. */
export interface TablesFrame { type: 'tables'; cityId: CityId; venue: string | null; tables: TableSummary[] }
/**
 * A table as ONE player (or a watcher) may see it; sent to every socket attached to the table,
 * each with its own `view`. `view` is the game's own (src/tables/<game>.js view): it never holds
 * another player's hand.
 */
export interface TableStateFrame {
  type: 'table-state'
  cityId: CityId
  table: TableSummary
  /** The caller's seat index, or null for a watcher. */
  you: number | null
  /** The caller sat down first, so they choose the rules. */
  host: boolean
  /** Moves made so far. */
  n: number
  view: Record<string, unknown> | null
  /** The last 30 lines. */
  log: string[]
  /** Seats that may move now. */
  toMove: number[]
  /** `deadline` and `now` are server ms; `seconds` is the game's turn length. Null unless a game is on. */
  clock: { deadline: number; now: number; seconds: number } | null
  result: { text: string; calledOff: boolean; winners: number[]; mine: TableResultMine | null } | null
  optionList: { name: string; label: string; values: TableOptionValue[]; names: string[]; value: TableOptionValue }[]
  /** Present (true) only on the answer to a retry of the move just made: nothing was applied again. */
  repeat?: true
}
/** A table in a venue the socket listed changed: ask `table-list` again. Carries no table data. */
export interface TablesChangedFrame { type: 'tables-changed'; cityId: CityId; venue: string }
export type TableServerFrame = TablesFrame | TableStateFrame | TablesChangedFrame

/** Codes of a refused `table-*` frame (server/growth/tables.ts refuse()). */
export type TableErrorCode =
  | 'invalid_city' | 'unknown_table' | 'rate_limited' | 'table_crowded' | 'game_on' | 'already_seated' | 'table_full' | 'table_closed'
  | 'not_here' | 'table_changed' | 'not_host' | 'not_seated' | 'need_players' | 'no_game' | 'invalid_move' | 'stale_move'
  | 'not_your_turn' | 'illegal_move'

// ---- runtime key lists (compared with the running server by protocol.test.ts) -------------------

/** A hello that paid nothing (no `state`). */
export const HELLO_RESPONSE_KEYS = ['away', 'channel', 'consent', 'contact', 'digest', 'events', 'ok', 'referral', 'serverTime', 'sharesLeft'] as const satisfies readonly (keyof Ok<Extract<HelloResult, { ok: true }>>)[]
export const REFERRAL_VIEW_KEYS = ['by', 'counted', 'invited', 'nextTitle', 'owed', 'paid', 'rules', 'title', 'waiting'] as const satisfies readonly (keyof ReferralView)[]
export const OUTREACH_MINE_KEYS = ['channel', 'comeback', 'email', 'live', 'push'] as const satisfies readonly (keyof OutreachMine)[]
export const DIGEST_KEYS = ['caps', 'delivery', 'footer', 'greeting', 'lines', 'more', 'subject', 'tasks'] as const satisfies readonly (keyof (Digest & { delivery: 'dry-run' }))[]
export const CALENDAR_OCCURRENCE_KEYS = ['blurb', 'end', 'icon', 'id', 'key', 'live', 'spray', 'start', 'table', 'title', 'venue', 'venueLabel'] as const satisfies readonly (keyof CalendarOccurrence)[]
export const SHARE_FACTS_KEYS = [
  'city', 'days', 'district', 'done', 'event', 'game', 'kind', 'name', 'stamps', 'tableId', 'title', 'total', 'venue', 'won',
] as const satisfies readonly (keyof ShareFacts)[]
export const CONSENT_VIEW_KEYS = ['age', 'at', 'email', 'push'] as const satisfies readonly (keyof ConsentView)[]
export const TABLE_SUMMARY_KEYS = [
  'game', 'gameLabel', 'id', 'label', 'max', 'min', 'options', 'seats', 'status', 'venue', 'venueLabel', 'watching',
] as const satisfies readonly (keyof TableSummary)[]
export const TABLE_STATE_FRAME_KEYS = [
  'clock', 'cityId', 'host', 'log', 'n', 'optionList', 'result', 'table', 'toMove', 'type', 'view', 'you',
] as const satisfies readonly (keyof TableStateFrame)[]
export const GROWTH_METRICS_RESPONSE_KEYS = [
  'analytics', 'cohorts', 'days', 'funnel', 'generatedAt', 'retention', 'serverTime', 'source', 'timezone', 'totals', 'tracked',
] as const satisfies readonly (keyof Ok<GrowthMetricsResponse>)[]
export const OUTREACH_OPERATOR_RESPONSE_KEYS = [
  'comeback', 'email', 'log', 'previews', 'push', 'quietNow', 'rules', 'serverTime', 'whatsapp',
] as const satisfies readonly (keyof Ok<OutreachOperatorResponse>)[]
export const SHARE_KINDS = ['invite', 'house', 'missions', 'week', 'table', 'event'] as const satisfies readonly ShareKind[]
export const CLIENT_SIGNALS = ['webgl-missing', 'opera-mini', 'save-data', 'slow-start', 'installed', 'share-sheet', 'share-fallback'] as const satisfies readonly ClientSignal[]
export const FUNNEL_STEPS = ['onboarded', 'goal-1', 'settled', 'job', 'shift', 'goals-done', 'mission', 'table', 'day-two-work'] as const satisfies readonly FunnelStep[]
