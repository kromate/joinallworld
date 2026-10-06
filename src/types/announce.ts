/**
 * Announcements from the people who run the game (server/admin/announce.ts): the frame that carries them to a page.
 * An announcement is stored once on the server; a page is sent the ones that are running when its socket opens, and a new one the moment
 * it goes out. What a page has seen is kept in that browser only.
 */
export type AnnounceAction = 'map' | 'missions' | 'business' | 'invite'
/** The in-game panels an announcement may open: a fixed list, never an address. */
export const ANNOUNCE_ACTIONS = ['map', 'missions', 'business', 'invite'] as const satisfies readonly AnnounceAction[]
export interface AnnounceItem {
  id: string
  title: string
  body: string
  /** The panel its button opens, or null for no button. */
  action: AnnounceAction | null
  /** The city it is for, or null for everyone. A page for another city ignores it. */
  city: string | null
  /** Server ms it went (or is to go) out, and when it stops being shown. */
  at: number
  expiresAt: number
}
/** `live`: it went out just now (show the banner); otherwise these are the ones already running when the socket opened. */
export interface AnnounceFrame { type: 'announce'; items: AnnounceItem[]; live: boolean }
