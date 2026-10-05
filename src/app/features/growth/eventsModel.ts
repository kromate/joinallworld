// What the Events app says, worked out from the calendar and the view. Pure, so it is tested
// without a browser. The calendar is data (src/game/content/calendar.ts) read by pure functions
// (src/game/calendar.ts); nothing here makes a request.
import type { CalendarOccurrence } from '../../../types/growth.ts'
import type { EventsView } from '../../../types/view.ts'
import type { PhoneNotification } from '../../types/panel.ts'

/** The red badge on the Events icon: 1 while an event is on that the player has not attended. */
export const eventsBadge = (view: { events?: Pick<EventsView, 'live'> | null }): number => ((view.events?.live ?? []).some((event) => !event.attended) ? 1 : 0)

/** The Phone's notification lines: every event that is on now. */
export function eventsNotifications(view: { connected: boolean; events?: Pick<EventsView, 'live'> | null }, upcoming: readonly CalendarOccurrence[]): PhoneNotification[] {
  if (!view.connected) return []
  return upcoming.filter((event) => event.live).map((event) => ({
    id: `event:${event.key}`, at: event.start, fresh: !view.events?.live?.find((item) => item.key === event.key)?.attended, app: 'events', text: `On now: ${event.title} at ${event.venueLabel}`,
  }))
}
