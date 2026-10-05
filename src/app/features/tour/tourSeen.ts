// Who has been shown the tour, and when it is due. Pure (storage is passed in), so it runs under node --test.
//
// "Seen" is remembered per player on this device (the session's public id), and a life that has already done
// something in the world is never new: the server's own record of activities and the first reward says so on
// any device, so the tour does not replay on another one. Hints off (Settings) means no tour by itself;
// Phone → Help and Settings still start it.

export const TOUR_KEY = 'joinallworld-tour-seen'
const KEPT = 24

type Reader = Pick<Storage, 'getItem'> | null | undefined
type Writer = Pick<Storage, 'getItem' | 'setItem'> | null | undefined

function read(storage: Reader): string[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(TOUR_KEY) ?? 'null')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}
export const tourSeen = (storage: Reader, who: string): boolean => Boolean(who) && read(storage).includes(who)
export function markTourSeen(storage: Writer, who: string): void {
  if (!who) return
  const kept = read(storage)
  if (kept.includes(who)) return
  try { storage?.setItem(TOUR_KEY, JSON.stringify([...kept, who].slice(-KEPT))) } catch { /* seen for this visit only: the caller holds it in memory too */ }
}

export interface TourFacts {
  connected: boolean
  /** The character creator still holds the life. */
  creating: boolean
  who: string
  /** Activities finished and the server time of the first reward: a life that has played is not new. */
  activities: number
  firstAt: number | null
  seen: boolean
  hintsOff: boolean
  /** Something running or on top: an activity, a sheet, a call, the map, the community panel. */
  busy: boolean
  /** The HUD the steps point at is on screen. */
  hudReady: boolean
}
/** 'start' now; 'wait' (look again when something changes); 'never' (not for this player). */
export function tourDue(facts: TourFacts): 'start' | 'wait' | 'never' {
  if (facts.seen || facts.hintsOff || facts.activities > 0 || facts.firstAt !== null) return 'never'
  if (!facts.connected || facts.creating || !facts.who || facts.busy || !facts.hudReady) return 'wait'
  return 'start'
}
