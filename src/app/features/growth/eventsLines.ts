// The lines of the Events app and its cards. Fetched with them: the first download needs only the badge and the notification
// lines in eventsModel.ts.
import type { CalendarOccurrence } from '../../../types/growth.ts'
import { span, until } from './growthModel.ts'

/** "Fri, 8:00 pm – 2:00 am · Venue · ends in 3h 5m" (or "starts in …"). */
export const whenLine = (event: CalendarOccurrence, now: number): string =>
  `${span(event.start, event.end)} · ${event.venueLabel}${event.live ? ` · ends in ${until(event.end, now)}` : ` · starts in ${until(event.start, now)}`}`
/** Why a spray amount cannot be pressed, or null. Spraying is for show: the money is gone. */
export function sprayReason(amount: number, left: number, cash: number, money: (value: number) => string): string | null {
  if (amount > left) return `Only ${money(left)} left to spray today.`
  if (amount > cash) return `You do not have ${money(amount)}.`
  return null
}
/** The line about the player's presence at an event. */
export const presenceNote = (attended: boolean, live: boolean, here: boolean): string => (attended ? 'You were there.' : live && here ? 'You are here: finish any activity to count as there.' : '')
/** What the empty state says when nothing is on right now. */
export const nothingOn = (later: readonly CalendarOccurrence[]): string => (later[0] ? `Next: ${later[0].title}, ${span(later[0].start, later[0].end)}.` : 'Check back soon.')
export const attendedLine = (count: number): string => `${count} event${count === 1 ? '' : 's'} attended so far.`
