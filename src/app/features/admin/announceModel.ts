// Announcements without a screen: the three starting points an admin can fill in, and the timeline that puts what is coming, what is showing and
// what has ended in one order. Pure, so it is tested without a browser.
export interface Template { id: string; label: string; title: string; body: string; action: string; hours: number }
export const TEMPLATES: readonly Template[] = [
  { id: 'maintenance', label: 'Maintenance', title: 'A short break soon', body: 'Allworld will restart for an update in a few minutes. Your progress is saved. Please finish what you are doing.', action: '', hours: 2 },
  { id: 'feature', label: 'New feature', title: 'Something new in Allworld', body: 'There is a new thing to try today. Open the Map and have a look around.', action: 'map', hours: 72 },
  { id: 'event', label: 'Event', title: 'An event is on today', body: 'Join in today for a little extra. Open Missions to see what is on.', action: 'missions', hours: 24 },
]
export interface Entry { id: string; title: string; at: number; sentAt: number; expiresAt: number; status: string }
export interface Slot { id: string; title: string; at: number; phase: 'upcoming' | 'showing' | 'past'; status: string }
/** What is coming (soonest first), what is showing, then what is over (latest first). */
export function timeline(rows: readonly Entry[], now: number): Slot[] {
  const slot = (row: Entry): Slot => ({ id: row.id, title: row.title, at: row.sentAt || row.at, status: row.status, phase: row.status === 'cancelled' || (row.expiresAt > 0 && row.expiresAt <= now) || row.status === 'ended' ? 'past' : row.sentAt === 0 && row.at > now ? 'upcoming' : 'showing' })
  const all = rows.map(slot), order = { upcoming: 0, showing: 1, past: 2 }
  return all.sort((a, b) => order[a.phase] - order[b.phase] || (a.phase === 'past' ? b.at - a.at : a.at - b.at))
}
