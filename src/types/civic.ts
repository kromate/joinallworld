/**
 * Civic wire shapes: Governor and elections, neighbours, billboards and sea plots, the gem hunt
 * counters, club radio, the rich list and the listing preferences.
 *
 * Derived from server/routes/civic.ts and server/civic/{elections,ads,radio,residents,text}.js,
 * src/game/systems/civic.ts (eligibility) and src/game/content/civic.ts (the fixed option lists);
 * the browser side is src/ui/panels/{governor,neighbours,ads,richlist,radio,hunt,civic-ui}.js.
 *
 * Conventions: GET routes take `?city=`; POST routes take `cityId` in the body (civic-ui.js send()
 * adds it). A refusal by the rules is HTTP 200 `{ ok: false, code, reason }` and still carries the
 * fresh view (`gov`, `ads`, `radio`) so the panel can redraw. Paid writes take a mandatory
 * `requestId` and are applied exactly once (OnceErrorCode).
 *
 * There are NO civic socket frames: nothing in server/civic or server/routes/civic.ts calls
 * ctx.push. City news reaches a player through GET /api/civic/pulse (`notices`) and, once per
 * notice, through the life itself (the server-only action 'civic.news').
 * WORKER: none of these routes exist on the Cloudflare Worker.
 */
import type { LifeState } from './life.ts'
import type { TierId } from './politics.ts'
import type { ApiEnvelope, CityId, HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, PlayerRef, Refusal, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts'

// ---- governor ------------------------------------------------------------------------------------

export type ElectionPhase = 'nominations' | 'voting' | 'results'

export interface Candidate {
  id: string
  name: string
  slogan: string
  votes: number
  /** This candidate is the viewer. */
  you: boolean
}
/** The sitting Governor (elections.js governorAt()). */
export interface Governor {
  id: string
  name: string
  slogan: string
  votes: number
  week: number
  termStartedAt: number
  termEndsAt: number
}
export interface ElectionResult {
  week: number
  closedAt: number
  termEndsAt: number
  /** How many stood — a number, not a list. */
  candidates: number
  totalVotes: number
  winner: { id: string; name: string; slogan: string; votes: number } | null
}
export interface Announcement {
  id: string
  by: PlayerRef
  text: string
  at: number
}
export interface GovView {
  phase: ElectionPhase
  phaseEndsAt: number
  election: {
    /** Monday-started Lagos week index (src/game/clock.ts). */
    week: number
    nominationsAt: number
    votingAt: number
    closesAt: number
    /** Declaration order during nominations, best first afterwards. */
    candidates: Candidate[]
    totalVotes: number
    /** The candidate the viewer voted for, else null. */
    yourVote: string | null
  }
  governor: Governor | null
  /** This week's result on results day, otherwise last week's; null until a poll has closed. */
  lastResult: ElectionResult | null
  /** Newest first. */
  announcements: Announcement[]
}

export interface GovRules {
  beta: true
  minDaysToRun: number
  minDaysToVote: number
  minWorkDays: number
  /** 0 = no cap. */
  votesPerAddress: number
  filingFee: number
  sloganMin: number
  sloganMax: number
  maxCandidates: number
  announcementMax: number
  announcementsPerDay: number
  /** Venue id votes are cast at, or null while that venue does not exist in this build. */
  pollingVenue: string | null
}

/** One row of the eligibility checklist (src/game/systems/civic.ts civicEligibility()). */
export interface EligibilityCheck {
  id: 'days' | 'fee' | 'work' | 'place' | 'home'
  met: boolean
  label: string
  detail: string
  /** The refusal code this check stands for. */
  code: 'too_new' | 'insufficient_funds' | 'work_days' | 'wrong_place' | 'not_main_home'
}
export type Gate = { ok: true } | { ok: false; code: string; reason: string }
/** Exactly why the signed-in viewer can or cannot run, vote and announce. */
export interface GovYou {
  /** Lagos days lived in the city. */
  days: number
  isGovernor: boolean
  isCandidate: boolean
  votedFor: string | null
  run: Gate & { checks: EligibilityCheck[] }
  vote: Gate & { checks: EligibilityCheck[] }
  announce: Gate
}
/** GET /api/civic/gov, and `gov` in the three governor writes. */
export interface GovResponse extends GovView {
  city: CityId
  rules: GovRules
  /** null when signed out. */
  you: GovYou | null
}

/** `tier` names the seat (docs/POLITICS.md); the city seat when absent. */
export interface RunBody { cityId: CityId; slogan: string; requestId: TimedId; tier?: TierId }
export interface VoteBody { cityId: CityId; candidate: string; tier?: TierId }
export interface AnnounceBody { cityId: CityId; text: string; tier?: TierId }

/** cleanLine() refusals (server/civic/text.ts). */
export type LineRefusal = 'text_required' | 'text_too_short' | 'text_too_long' | 'text_blocked' | 'links_not_allowed' | 'contact_not_allowed'
type WithLife = { state: LifeState }
export type RunResponse =
  ({ ok: true; code: 'declared'; duplicate?: true } | Refusal<'already_candidate' | 'nominations_closed' | 'ballot_full' | 'muted' | LineRefusal | EligibilityCheck['code'] | (string & {})>)
  & WithLife & { gov: GovResponse }
export type VoteResponse =
  ({ ok: true; code: 'voted' } | Refusal<'already_voted' | 'polls_closed' | 'unknown_candidate' | 'address_vote_limit' | EligibilityCheck['code'] | (string & {})>)
  & WithLife & { gov: GovResponse }
/** No `state`: an announcement costs nothing. */
export type AnnounceResponse =
  ({ ok: true; code: 'announced' } | Refusal<'not_governor' | 'announcement_cooldown' | 'announcement_limit' | 'muted' | LineRefusal>)
  & { gov: GovResponse }

// ---- pulse, hunt, counters -----------------------------------------------------------------------

/** `players`: residents with an unexpired check-in; `online`: those with an open socket; `visits`: resident-days. */
export interface CityCounters { players: number; online: number; visits: number }
export interface HuntCounters { found: number; today: number; claims: number; prize: number; gemsPerDay: number }
export type NoticeKind = 'result' | 'voting' | 'nominations' | 'announcement'
/** `id` is `<kind>-<week>` or `announcement-<announcement id>`. Newest first, at most 12, last 8 days. */
export interface CivicNotice { id: string; kind: NoticeKind; at: number; title: string; text: string }

/** GET /api/civic/pulse — the signed-in poll that also checks the resident in. */
export interface PulseResponse {
  city: CityId
  /**
   * This request refreshed the caller's resident entry (signed in, a SETTLED life, within 6 check-ins a minute).
   * A life still held for the quick start, and a guest who is playing but has not settled in, is not a
   * resident: it is in no directory, list or counter.
   */
  checkedIn: boolean
  counters: CityCounters
  hunt: HuntCounters
  gov: { phase: ElectionPhase; phaseEndsAt: number; governor: Governor | null }
  notices: CivicNotice[]
  /** The radio of the club the caller is standing in, else null. */
  // INCONSISTENT: this embedded view has no `city`, but src/ui/panels/hunt.js:52 puts it in the same cache
  // entry that GET /api/civic/radio (which has `city`) fills, so the cached object has two shapes.
  radio: RadioView | null
}

/** GET /api/civic/hunt. Searching and claiming are the game actions 'civic.hunt-search' / 'civic.hunt-claim'. */
// INCONSISTENT: no browser code requests this route (src/ui/panels/hunt.js reads the pulse and the life instead).
export interface HuntResponse extends HuntCounters {
  city: CityId
  you: { found: number; total: number; claimed: boolean; canClaim: boolean } | null
}

// ---- neighbours ----------------------------------------------------------------------------------

export interface NeighbourHome { id: string; name: string; online: boolean; you: boolean }
export interface District {
  /**
   * A house id from DISTRICTS, `'own'` (residents who live in their own house on a plot, and so rent
   * in no district) or `'unknown'`. The last two are listed only when somebody is in them.
   */
  id: string
  label: string
  /** Every resident of the district, listed or not. */
  count: number
  online: number
  /** Leaves out hidden residents (except the viewer) and anything past the list caps. */
  homes: NeighbourHome[]
}
/** GET /api/civic/neighbours (needs the session). */
export interface NeighboursResponse {
  city: CityId
  demonym: string
  /** The viewer hid their own home. */
  hidden: boolean
  total: number
  online: number
  listed: number
  districts: District[]
}

// ---- billboards and sea plots --------------------------------------------------------------------

export type AdKind = 'billboard' | 'sea'
export interface AdColour { id: string; label: string; bg: string; ink: string }
export interface AdIcon { id: string; icon: string }
/** `colour` and `icon` are ids into `palette`; `text` is plain text the renderer must escape. */
export interface Ad {
  text: string
  colour: string
  icon: string
  by: PlayerRef
  at: number
  expiresAt: number
  mine: boolean
  /** What the slot costs to rent (not what was paid). */
  price: number
}
export interface BillboardSlot {
  /** `bb-01` … */
  slot: string
  /** Venue id the board stands beside. */
  near: string
  road: string
  price: number
  ad: Ad | null
}
/** A RENTED sea plot: `sea-<row>-<col>`, zero-based, row 0 nearest the shore. Free plots are not listed. */
export interface SeaPlot extends Ad { slot: string; row: number; col: number }
export interface AdsView {
  palette: { colours: AdColour[]; icons: AdIcon[] }
  billboards: { price: number; days: number; maxPerPlayer: number; slots: BillboardSlot[] }
  sea: { rows: number; cols: number; price: number; shoreRows: number; shorePrice: number; days: number; maxPerPlayer: number; plots: SeaPlot[] }
}
/** GET /api/civic/ads, and `ads` in the two ad writes. */
export interface AdsResponse extends AdsView { city: CityId }

export interface RentAdBody { cityId: CityId; kind: AdKind; slot: string; text: string; colour: string; icon: string; requestId: TimedId }
export interface RemoveAdBody { cityId: CityId; kind: AdKind; slot: string }
export type RentAdResponse =
  ({ ok: true; code: 'rented'; duplicate?: true } | Refusal<'invalid_slot' | 'already_yours' | 'slot_taken' | 'ad_limit' | 'muted' | LineRefusal | 'invalid_colour' | 'invalid_icon' | 'insufficient_funds' | (string & {})>)
  & WithLife & { ads: AdsResponse }
export type RemoveAdResponse = ({ ok: true; code: 'removed' } | Refusal<'no_ad' | 'not_yours'>) & { ads: AdsResponse }

// ---- club radio ----------------------------------------------------------------------------------

export interface RadioEntry {
  /** `r<n>`. */
  id: string
  by: PlayerRef
  title: string
  artist: string
  startsAt: number
  endsAt: number
  mine: boolean
}
export interface RadioView {
  venue: string
  /** false: this venue has no radio (then `playing` is null and `queue` empty). */
  club: boolean
  playing: RadioEntry | null
  /** Everything queued after `playing`. */
  queue: RadioEntry[]
  price: number
  slotSeconds: number
  perDay: number
  queueMax: number
  /** The viewer's shout-outs today; 0 when signed out. */
  usedToday: number
}
/** GET /api/civic/radio?city=&venue=, and `radio` in the shout-out answer. */
export interface RadioResponse extends RadioView { city: CityId }

/** The venue is not sent: it is the caller's stored location. */
export interface ShoutoutBody { cityId: CityId; title: string; artist: string; requestId: TimedId }
export type ShoutoutResponse =
  ({ ok: true; code: 'queued'; entry: RadioEntry; duplicate?: true } | Refusal<'not_in_club' | 'shoutout_limit' | 'queue_full' | 'muted' | LineRefusal | 'insufficient_funds' | (string & {})>)
  & WithLife & { radio: RadioResponse }

// ---- rich list and preferences -------------------------------------------------------------------

export interface RichRow { rank: number; id: string; name: string; amount: number; you: boolean }
export interface RichListResponse {
  city: CityId
  week: number
  /** Rows per board. */
  size: number
  balances: RichRow[]
  /** Naira received since Monday, Lagos time. */
  earners: RichRow[]
  /** null until the viewer has checked in as a resident. Ranks are null when hidden or off the board. */
  you: { listed: boolean; cash: number; earned: number; balanceRank: number | null; earnerRank: number | null } | null
  counters: CityCounters
}

// ---- place boards (cities, states, countries) -----------------------------------------------------

export type BoardScope = 'city' | 'state' | 'country'
export type BoardMeasure = 'pride' | 'earned' | 'active' | 'residents'
/** One ranked place. Only places with enough players are ranked (`BoardsResponse.min`); no player is named or counted singly. */
export interface BoardRow {
  rank: number
  id: string
  name: string
  /** The state a city is in, the country a state is in; null for a country. */
  within: string | null
  /** Players who have signed in as residents. */
  residents: number
  /** Residents who have opened the game this Lagos week. */
  active: number
  /** Naira those residents received this week (their last check-in). */
  earned: number
  /** Naira received this week per resident: rewards taking part, not size. */
  pride: number
  /** The viewer's own place. */
  you: boolean
}
export interface BoardYou {
  id: string
  name: string
  /** null while the place has too few players to be ranked. */
  rank: number | null
  /** The place just above and what this one lacks to match it, in the measure ranked by. */
  behind: { id: string; name: string; amount: number } | null
}
export interface BoardsResponse {
  scope: BoardScope
  by: BoardMeasure
  /** Lagos week the board counts. */
  week: number
  /** Players a place needs (residents and active) before its numbers are shown or ranked. */
  min: number
  rows: BoardRow[]
  /** Cursor for the next page: the rank of the last row sent. */
  next: string | null
  /** Ranked places in all, and places left off for having too few players. */
  total: number
  unranked: number
  you: BoardYou | null
  /** The winner by pride of the week before, kept for the week after. */
  lastWeek: { week: number; winner: { id: string; name: string } | null }
}

/** `true` = listed. Stored the other way round (as "hidden" flags), so no entry means listed. */
export interface PrefsBody { richList?: boolean; directory?: boolean }
export interface PrefsResponse { ok: true; prefs: { richList: boolean; directory: boolean } }

// ---- HTTP ----------------------------------------------------------------------------------------

/** 429 `civic_rate_limited` is the per-player (or per-address) civic limit; `rate_limited` is the host's. */
type CivicRead = HostErrorCode | 'invalid_city' | 'civic_rate_limited' | 'invalid_tier' | 'no_such_seat'
type CivicWrite = CivicRead | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode

export interface CivicHttpRoutes {
  'GET /api/civic/pulse': { query: { city: CityId }; response: Ok<PulseResponse>; errors: CivicRead | StorageErrorCode }
  'GET /api/civic/gov': { query: { city: CityId; tier?: TierId }; response: Ok<GovResponse>; errors: CivicRead }
  'POST /api/civic/gov/run': { body: RunBody; response: Ok<RunResponse>; errors: CivicWrite | OnceErrorCode }
  'POST /api/civic/gov/vote': { body: VoteBody; response: Ok<VoteResponse>; errors: CivicWrite }
  'POST /api/civic/gov/announce': { body: AnnounceBody; response: Ok<AnnounceResponse>; errors: CivicWrite }
  'GET /api/civic/neighbours': { query: { city: CityId }; response: Ok<NeighboursResponse>; errors: CivicRead | SessionErrorCode }
  'GET /api/civic/ads': { query: { city: CityId }; response: Ok<AdsResponse>; errors: CivicRead }
  'POST /api/civic/ads/rent': { body: RentAdBody; response: Ok<RentAdResponse>; errors: CivicWrite | OnceErrorCode }
  /** 400 `invalid_slot`: unknown kind, or a slot that is not a string of at most 16 characters. */
  'POST /api/civic/ads/remove': { body: RemoveAdBody; response: Ok<RemoveAdResponse>; errors: CivicWrite | 'invalid_slot' }
  'GET /api/civic/hunt': { query: { city: CityId }; response: Ok<HuntResponse>; errors: CivicRead }
  'GET /api/civic/radio': { query: { city: CityId; venue: string }; response: Ok<RadioResponse>; errors: CivicRead | 'invalid_venue' }
  'POST /api/civic/radio/shoutout': { body: ShoutoutBody; response: Ok<ShoutoutResponse>; errors: CivicWrite | OnceErrorCode }
  'GET /api/civic/richlist': { query: { city: CityId }; response: Ok<RichListResponse>; errors: CivicRead | StorageErrorCode }
  /** The one civic write without a city. */
  /** 400 `invalid_scope`, `invalid_measure`, `invalid_cursor`. Aggregates only: no player is named. */
  'GET /api/civic/boards': { query: { scope?: BoardScope; by?: BoardMeasure; after?: string; limit?: number }; response: Ok<BoardsResponse>; errors: HostErrorCode | 'civic_rate_limited' | 'invalid_scope' | 'invalid_measure' | 'invalid_cursor' | StorageErrorCode }
  'POST /api/civic/prefs': { body: PrefsBody; response: Ok<PrefsResponse>; errors: HostErrorCode | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode | 'civic_rate_limited' | 'invalid_prefs' }
}

// ---- runtime key lists (protocol.test.ts) --------------------------------------------------------

export const PULSE_RESPONSE_KEYS = ['checkedIn', 'city', 'counters', 'gov', 'hunt', 'notices', 'radio', 'serverTime'] as const satisfies readonly (keyof PulseResponse | keyof ApiEnvelope)[]
export const GOV_RESPONSE_KEYS = ['announcements', 'city', 'election', 'governor', 'lastResult', 'phase', 'phaseEndsAt', 'rules', 'serverTime', 'you'] as const satisfies readonly (keyof GovResponse | keyof ApiEnvelope)[]
export const GOV_RULES_KEYS = [
  'announcementMax', 'announcementsPerDay', 'beta', 'filingFee', 'maxCandidates', 'minDaysToRun', 'minDaysToVote', 'minWorkDays', 'pollingVenue',
  'sloganMax', 'sloganMin', 'votesPerAddress',
] as const satisfies readonly (keyof GovRules)[]
export const GOV_YOU_KEYS = ['announce', 'days', 'isCandidate', 'isGovernor', 'run', 'vote', 'votedFor'] as const satisfies readonly (keyof GovYou)[]
export const NEIGHBOURS_RESPONSE_KEYS = ['city', 'demonym', 'districts', 'hidden', 'listed', 'online', 'serverTime', 'total'] as const satisfies readonly (keyof NeighboursResponse | keyof ApiEnvelope)[]
export const ADS_RESPONSE_KEYS = ['billboards', 'city', 'palette', 'sea', 'serverTime'] as const satisfies readonly (keyof AdsResponse | keyof ApiEnvelope)[]
export const HUNT_RESPONSE_KEYS = ['city', 'claims', 'found', 'gemsPerDay', 'prize', 'serverTime', 'today', 'you'] as const satisfies readonly (keyof HuntResponse | keyof ApiEnvelope)[]
export const RADIO_RESPONSE_KEYS = ['city', 'club', 'perDay', 'playing', 'price', 'queue', 'queueMax', 'serverTime', 'slotSeconds', 'usedToday', 'venue'] as const satisfies readonly (keyof RadioResponse | keyof ApiEnvelope)[]
export const RICH_LIST_RESPONSE_KEYS = ['balances', 'city', 'counters', 'earners', 'serverTime', 'size', 'week', 'you'] as const satisfies readonly (keyof RichListResponse | keyof ApiEnvelope)[]
export const BOARDS_RESPONSE_KEYS = ['by', 'lastWeek', 'min', 'next', 'rows', 'scope', 'serverTime', 'total', 'unranked', 'week', 'you'] as const satisfies readonly (keyof BoardsResponse | keyof ApiEnvelope)[]
export const PREFS_RESPONSE_KEYS = ['ok', 'prefs', 'serverTime'] as const satisfies readonly (keyof PrefsResponse | keyof ApiEnvelope)[]
