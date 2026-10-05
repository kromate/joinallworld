/**
 * OWNER: social
 * PING: the wire types of server/social/ping.ts and server/routes/ping.ts. The rules and numbers are src/game/ping.ts;
 * the design is docs/COMEBACK-MAIL.md ("Ping").
 */
import type { CityId, HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, PlayerRef, Refusal, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts'
import type { Done, Repeat } from './social.ts'
import type { PingNote } from '../game/ping.ts'

/** Where a pinger is, as much as a friend is ever told: the city, a public venue or `'home'`, and the words for both. */
export interface PingPlace {
  cityId: CityId
  cityName: string
  /** A venue id, or `'home'`. */
  venue: string
  home: boolean
  /** "at Freedom Park, Lagos" · "at home in Lagos". */
  label: string
}
/** A live ping as its recipient sees it. */
export interface PingNotice {
  from: PlayerRef
  at: number
  expiresAt: number
  place: PingPlace
  /** They arrived through the reader's own invite link a moment ago: nobody pressed Ping. */
  invite?: true
}
/** Why Ping cannot be pressed for one player. */
export type PingBlock = 'self' | 'unknown_player' | 'blocked' | 'not_friends' | 'founder' | 'muted' | 'travelling' | 'not_live' | 'cooldown' | 'rate_limited'
/** The state of the Ping control for one player, as the server sees it. It never says whether that player can be reached outside the game. */
export interface PingControl {
  can: boolean
  code: PingBlock | null
  reason: string | null
  /** Server ms from which the same friend may be pinged again (only with `cooldown`). */
  again: number | null
  /** The caller's own live ping to this player, with its join link (a path: `/j/<token>`). */
  live: { at: number; expiresAt: number; link: string } | null
}

export interface PingBody { to: string; clientId: TimedId }
export interface PingCancelBody { to: string }
export interface PingOpenBody { token: string }
export interface PingJoinBody { from: string; clientId: TimedId }

export type PingResult =
  | Done<'pinged', { to: PlayerRef; note: PingNote; words: string; at: number; expiresAt: number; again: number; link: string; place: PingPlace } & Repeat>
  | Refusal<PingBlock>
export type PingCancelResult = Done<'cancelled', Repeat>
/** A join link was opened. `yours`: it was made for the caller. `other`: it was made for somebody else, and nothing was done. Opening a link never signs anyone in. */
export type PingOpenResult =
  | Done<'yours', { from: PlayerRef; /** null: that ping is over. */ notice: PingNotice | null }>
  | Done<'other'>
  | Refusal<'invalid_link' | 'rate_limited'>
/** `moved`: what the join did to the caller's life. `knock`: the friend is at home, and coming in is the house's own knock. `present`: both are connected now. */
export type PingJoinResult =
  | Done<'joined' | 'here' | 'at_home', { from: PlayerRef; place: PingPlace; moved: 'none' | 'venue' | 'city'; knock: boolean; present: boolean; words: string } & Repeat>
  | (Refusal<'left' | 'not_friends' | 'blocked' | 'unknown_player' | 'reconnecting' | 'travelling' | 'busy' | 'settle_required' | 'join_cap' | 'city_not_open' | 'no_route' | 'rate_limited' | (string & {})> & { from?: PlayerRef })
export interface PingListResult { incoming: PingNotice[] }

/** To the friend who was pinged, on every open socket. */
export interface PingIncomingFrame { type: 'ping-incoming'; notice: PingNotice }
/** To the pinger: the friend came. `present`: they are connected, so a call would ring. */
export interface PingJoinedFrame { type: 'ping-joined'; by: PlayerRef; place: PingPlace; present: boolean }
/** To the friend: that ping is over (cancelled, or the pinger left the game). */
export interface PingEndedFrame { type: 'ping-ended'; from: string }
export type PingServerFrame = PingIncomingFrame | PingJoinedFrame | PingEndedFrame

type PingCommon = HostErrorCode | SessionErrorCode | StorageErrorCode | 'onboarding_required'
type PingPost = PingCommon | JsonBodyErrorCode
export interface PingHttpRoutes {
  /** The live pings waiting for the caller. Read once when the game opens and after an update of kind `ping`; never polled. */
  'GET /api/social/ping': { response: Ok<Done<'ok', PingListResult>>; errors: PingCommon }
  /** May the caller ping this player now, and if not, why and from when. */
  'GET /api/social/ping/:id': { params: { id: string }; response: Ok<Done<'ok', { control: PingControl }>>; errors: PingCommon | 'invalid_player' }
  /** Tell a friend the caller is here. Exactly once per `clientId`. */
  'POST /api/social/ping': { body: PingBody; response: Ok<PingResult>; errors: PingPost | OnceErrorCode | 'invalid_player' }
  'POST /api/social/ping/cancel': { body: PingCancelBody; response: Ok<PingCancelResult>; errors: PingPost | 'invalid_player' }
  /** What a join link is, for the browser that opened it. It changes nothing. */
  'POST /api/social/ping/open': { body: PingOpenBody; response: Ok<PingOpenResult>; errors: PingPost }
  /** Go to the friend who pinged: re-checked and applied by the server, exactly once per `clientId`. */
  'POST /api/social/ping/join': { body: PingJoinBody; response: Ok<PingJoinResult>; errors: PingPost | OnceErrorCode | 'invalid_player' }
}
