/**
 * Wire types of LIVE LOCATION: where a player's friends are in the game right now, pushed over `/socket`
 * (server/social/live.ts, server/ws/live.ts) and drawn by the maps and the people lists.
 *
 * Only in-game places travel here: a city id, a venue id, a trip between two venues with the server time
 * it began and how long it takes. Nothing about a device's real position exists in these frames, and a home
 * is only ever the word 'home': no plot, estate or district.
 */
import type { CityId } from './protocol.ts'

/** 'reconnecting': the last connection closed at `seenAt`; a client reads it as offline once the grace period has passed. */
export type LiveStatus = 'online' | 'reconnecting' | 'offline'

/** A trip between two venues of one city. The place on the route is a function of the server clock: no further frame is sent while it runs. */
export interface LiveTrip {
  /** Venue ids; `'home'` for the traveller's own home (never where that is). */
  from: string
  to: string
  /** A travel mode id, or 'commute'. */
  mode: string
  /** Server ms the trip began. */
  startedAt: number
  /** Seconds the whole trip takes. */
  duration: number
}
/** A journey between two cities: `cityId` of the spot is still the city being left. */
export interface LiveJourney {
  /** The destination city. */
  to: string
  mode: string
  startedAt: number
  duration: number
}
/** Where one player is. At most one of `venue`, `trip` and `journey`; none of them for someone connected but between places. */
export interface LiveSpot {
  id: string
  status: LiveStatus
  /** With 'reconnecting' and 'offline': server ms the last connection closed, when the server saw it. */
  seenAt?: number
  /** Online only. */
  cityId?: string
  /** A venue id, `'home'`, or `'visit'` (a guest in someone's home). */
  venue?: string
  trip?: LiveTrip
  journey?: LiveJourney
}
/** How many players are at each public venue of a city, and how many are on a trip inside it. No names; homes are not counted. */
export interface LiveCity {
  cityId: string
  venues: Record<string, number>
  moving: number
}

/** Watch the city the caller's character is in, and the caller's friends wherever they are. Answered with `live-snapshot`. */
export interface LiveWatchFrame { type: 'live-watch'; cityId: CityId }
/** Stop watching. Not answered. */
export interface LiveUnwatchFrame { type: 'live-unwatch' }
export type LiveClientFrame = LiveWatchFrame | LiveUnwatchFrame

/** Everything the watcher may see, as it stands at `at` (server ms): it replaces what the client held. Sent on watch, and again whenever the server had to rebuild the subscription. */
export interface LiveSnapshotFrame { type: 'live-snapshot'; at: number; city: LiveCity | null; friends: LiveSpot[] }
/** What changed since the last frame: the latest spot of each friend who moved (earlier ones in between are dropped), and the city's counts when they changed. */
export interface LiveMoveFrame { type: 'live-move'; at: number; spots?: LiveSpot[]; city?: LiveCity }
export type LiveServerFrame = LiveSnapshotFrame | LiveMoveFrame
