// What the dashboard works out from the server's answers, without a screen: the series of the tiles and charts, the new accounts of each day,
// the colour a size or a fill deserves, and who is "returning". Pure, so it is tested without a browser.
import { change } from './charts/chartModel.ts'

export interface DayRow { day: number; date: string; new: number; seen: number; sessions: number; funnel: Record<string, number>; daily: Record<string, number | null> | null }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "6 Oct" from "2026-10-06". */
export const shortDate = (date: string): string => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`
/** One number of every day (a gap is null), for a chart. */
export const series = (days: readonly DayRow[], pick: (row: DayRow) => number | null): (number | null)[] => days.map(pick)
export const field = (name: string) => (row: DayRow): number | null => row.daily?.[name] ?? null
/** New accounts a day: the growth of the account count between two measured days (null when either day was not measured, or an account was deleted). */
export function accountsPerDay(days: readonly DayRow[]): (number | null)[] {
  return days.map((row, index) => {
    const now = row.daily?.['accounts'], before = days[index - 1]?.daily?.['accounts']
    return typeof now === 'number' && typeof before === 'number' && now >= before ? now - before : null
  })
}
/** The last `n` entries. */
export const lastDays = <T>(list: readonly T[], n: number): T[] => list.slice(Math.max(0, list.length - n))
export function tileChange(values: readonly (number | null)[]): string | null {
  const now = values[values.length - 1], before = values[values.length - 2]
  return typeof now === 'number' ? change(now, typeof before === 'number' ? before : null)?.word ?? null : null
}
export type Tone = 'ok' | 'warn' | 'bad'
/** The colour of a fill: amber from 70 percent of the cap, red from 90. */
export const fillTone = (used: number, most: number): Tone => (most > 0 && used / most >= 0.9 ? 'bad' : most > 0 && used / most >= 0.7 ? 'warn' : 'ok')
/** The colour of a stored collection: docs/CAPACITY.md puts the practical limit of a whole-collection store near 10 MB, so amber from 2 MB and red from 8 MB. */
export const sizeTone = (chars: number): Tone => (chars >= 8_000_000 ? 'bad' : chars >= 2_000_000 ? 'warn' : 'ok')
/** Players seen in the last 7 days that did not begin in them: the lives followed minus the new ones. An approximation (the new count is by the day a life was first seen). */
export const returning = (seen7: number, new7: number): number => Math.max(0, seen7 - new7)
export const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0)
