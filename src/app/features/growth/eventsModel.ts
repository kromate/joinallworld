// What the Events app says, worked out from the calendar and the view. Pure, so it is tested
// without a browser. The calendar is data (src/game/content/calendar.ts) read by pure functions
// (src/game/calendar.ts); nothing here makes a request.
import type { CalendarOccurrence } from '../../../types/growth.ts'
import type { EventsView } from '../../../types/view.ts'
import type { PhoneNotification } from '../../types/panel.ts'
import { span, until } from './growthModel.ts'

/** The red badge on the Events icon: 1 while an event is on that the player has not attended. */
export const eventsBadge = (view: { events?: Pick<EventsView, 'live'> | null }): number => ((view.events?.live ?? []).some((event) => !event.attended) ? 1 : 0)

/** The Phone's notification lines: every event that is on now. */
export function eventsNotifications(view: { connected: boolean; events?: Pick<EventsView, 'live'> | null }, upcoming: readonly CalendarOccurrence[]): PhoneNotification[] {
  if (!view.connected) return []
  return upcoming.filter((event) => event.live).map((event) => ({
    id: `event:${event.key}`, at: event.start, fresh: !view.events?.live?.find((item) => item.key === event.key)?.attended, app: 'events', text: `On now: ${event.title} at ${event.venueLabel}`,
  }))
}

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
