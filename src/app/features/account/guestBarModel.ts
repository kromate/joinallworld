// When the slim "You're playing as a guest" bar may show. Pure: the page is passed in, so the rules are tested without a browser.

/** A dismissed bar stays away this long. */
export const DISMISS_MS = 7 * 24 * 3600 * 1000
export const BAR_KEY = 'joinallworld-signup-bar'

export interface BarFacts {
  /** Accounts are configured and the server has answered. */
  enabled: boolean
  /** Not signed in. */
  guest: boolean
  connected: boolean
  /** The character creator still holds the life. */
  creating: boolean
  tour: boolean
  /** A sheet is open, an activity or trip is running, a call is up. */
  busy: boolean
  /** The venue view (the bar never covers the map or a nav panel). */
  venue: boolean
  /** Dismissed until this time (ms), or 0. */
  hiddenUntil: number
  now: number
}
export const barDue = (f: BarFacts): boolean => f.enabled && f.guest && f.connected && !f.creating && !f.tour && !f.busy && f.venue && f.now >= f.hiddenUntil

type Reader = Pick<Storage, 'getItem'> | null | undefined
type Writer = Pick<Storage, 'setItem'> | null | undefined
export function hiddenUntil(storage: Reader): number {
  try { const value = Number(storage?.getItem(BAR_KEY)); return Number.isFinite(value) ? value : 0 } catch { return 0 }
}
export function dismissBar(storage: Writer, now: number): number {
  const until = now + DISMISS_MS
  try { storage?.setItem(BAR_KEY, String(until)) } catch { /* hidden for this visit only: the caller holds it in memory too */ }
  return until
}
