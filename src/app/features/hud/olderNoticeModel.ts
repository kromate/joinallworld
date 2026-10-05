// A one-time pointer to "Older characters" for a session that has one. Pure: storage and facts are passed in.

export const OLDER_KEY = 'joinallworld-older-notice'
export const OLDER_TEXT = 'You have another character · Open Settings → Older characters'

export interface OlderFacts {
  connected: boolean
  who: string
  /** The character creator still holds the life. */
  creating: boolean
  /** The tour is running or about to. */
  tour: boolean
  /** A sheet, an activity or a call is in front. */
  busy: boolean
  seen: boolean
}
/** Worth asking the server whether an older character exists. */
export const olderAskDue = (f: OlderFacts): boolean => f.connected && Boolean(f.who) && !f.creating && !f.tour && !f.busy && !f.seen
/** The notice itself: asked and answered, and there is at least one. */
export const olderNoticeDue = (f: OlderFacts, older: number): boolean => olderAskDue(f) && older > 0

type Reader = Pick<Storage, 'getItem'> | null | undefined
type Writer = Pick<Storage, 'getItem' | 'setItem'> | null | undefined
function read(storage: Reader): string[] {
  try { const value: unknown = JSON.parse(storage?.getItem(OLDER_KEY) ?? 'null'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] }
}
export const olderSeen = (storage: Reader, who: string): boolean => read(storage).includes(who)
export function markOlderSeen(storage: Writer, who: string): void {
  try { storage?.setItem(OLDER_KEY, JSON.stringify([...read(storage), who].slice(-24))) } catch { /* shown for this visit only: the caller holds it in memory too */ }
}
