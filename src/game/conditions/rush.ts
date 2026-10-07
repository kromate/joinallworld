// Go-slow: when the roads of a city jam. A pure function of the Lagos clock, so the server, the Worker and the browser agree to the minute.
// It is kept apart from the rest of the conditions (./conditions.ts) because the travel system asks for it on every quote and must not pull the
// other rules into the page; this file reads nothing but the clock. Every number here is an original beta value.
import { formatHour, lagosDayStart, lagosTime } from '../clock.ts'

/**
 * When the road is slow: [weekdays as a bit mask (bit 0 = Sunday … bit 6 = Saturday), from, to in Lagos minutes after midnight].
 *   Monday to Friday, 07:00–10:00     the morning rush into the office
 *   Monday to Thursday, 16:00–20:00   the evening rush home
 *   Friday, 15:00–21:00               everyone leaves early, and the owambe and the weekend start
 *   Saturday, 17:00–20:00             weddings and parties
 * Sunday is open road, apart from the church closing hour, which is too small to count.
 */
const RUSH: readonly (readonly [number, number, number])[] = [[62, 420, 600], [30, 960, 1200], [32, 900, 1260], [64, 1020, 1200]]

/** How many times longer a trip by road takes in the go-slow. Lagos jams worst; the other cities are smaller. Original beta values. */
export const goSlowFactor = (cityId: string): number => (cityId === 'lagos' ? 1.5 : 1.25)

/** The go-slow a moment is inside (`from` inclusive, `to` exclusive, server ms), or null on an open road. */
export function rushAt(now: number): { from: number; to: number } | null {
  const { day, weekday, minuteOfDay } = lagosTime(now)
  for (const [days, from, to] of RUSH) {
    if ((days >> weekday) & 1 && minuteOfDay >= from && minuteOfDay < to) return { from: lagosDayStart(day) + from * 60000, to: lagosDayStart(day) + to * 60000 }
  }
  return null
}

/** A trip's seconds in the go-slow: longer for any way of travelling that shares the road. Walking and the boat do not. */
export function slowedSeconds(seconds: number, mode: unknown, cityId: string, now: number): number {
  return !rushAt(now) || mode === 'trek' || mode === 'boat' ? seconds : seconds * goSlowFactor(cityId)
}

/** What the player is told: the same jam as a sentence, or '' on an open road. */
export function goSlowLine(cityId: string, now: number): string {
  const jam = rushAt(now)
  if (!jam) return ''
  const factor = goSlowFactor(cityId)
  return `Go-slow on the road until ${formatHour(lagosTime(jam.to).minuteOfDay / 60)}: trips by road take about ${factor === 1.5 ? 'half as long again' : 'a quarter longer'}. Walking is not held up.`
}
