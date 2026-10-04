// Lagos wall-clock helpers. Opening hours, job schedules and weekly billing run on real
// Africa/Lagos time. Lagos is UTC+1 all year (no daylight saving), so this is plain
// arithmetic: pure, deterministic and identical on the server, the worker and the client.

export const LAGOS_OFFSET_MS = 3600000
const DAY_MS = 86400000
export const WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const)

export interface LagosTime {
  /** Whole Lagos days since 1970-01-01. */
  day: number
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** Index of the Monday-started week: use it to detect "a new week began". */
  week: number
  hour: number
  minute: number
  minuteOfDay: number
}

/** Hours as numbers (9, 17.5). `close <= open` wraps past midnight. `days` lists weekdays (0–6). */
export interface OpeningHours {
  open: number
  close: number
  days?: readonly number[]
}

export interface OpeningInfo {
  open: boolean
  /** True when the place has no hours at all. */
  always: boolean
  /** 'Open 24 hours' | '8AM – 10PM' */
  hours: string
  /** 'Open 24 hours' | 'Open now · closes 10PM' | 'Closed · opens 8AM (in 5h 19m)' | 'Closed' */
  status: string
  /** Minutes until it opens: 0 when open, Infinity when it does not open within eight days. */
  minutes: number
  opensAt: string | null
}

/** @param ms server time */
export function lagosTime(ms: number): LagosTime {
  const local = (Number.isFinite(ms) ? ms : 0) + LAGOS_OFFSET_MS
  const day = Math.floor(local / DAY_MS)
  const minuteOfDay = Math.floor((local - day * DAY_MS) / 60000)
  return {
    day,
    weekday: (((day + 4) % 7) + 7) % 7,
    week: Math.floor((day + 3) / 7),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    minuteOfDay,
  }
}

/** Server ms at which the given Lagos day index starts. */
export const lagosDayStart = (day: number): number => day * DAY_MS - LAGOS_OFFSET_MS

/** Missing hours = always open. */
export function isOpen(hours: OpeningHours | null | undefined, ms: number): boolean {
  if (!hours) return true
  const time = lagosTime(ms)
  const at = time.minuteOfDay / 60
  const wraps = hours.close <= hours.open
  const inHours = wraps ? at >= hours.open || at < hours.close : at >= hours.open && at < hours.close
  if (!inHours) return false
  if (!hours.days) return true
  // After midnight on a wrapping schedule the shift belongs to the previous day.
  const weekday = wraps && at < hours.close ? (time.weekday + 6) % 7 : time.weekday
  return hours.days.includes(weekday)
}

/** Minutes until the place next opens (0 when open now). Searches at most eight days ahead. */
export function minutesUntilOpen(hours: OpeningHours | null | undefined, ms: number): number {
  if (isOpen(hours, ms)) return 0
  const startMinute = Math.floor(ms / 60000) + 1
  for (let i = 0; i < 8 * 1440; i++) if (isOpen(hours, (startMinute + i) * 60000)) return i + 1
  return Infinity
}

export function formatHour(hour: number): string {
  const h = Math.floor(hour) % 24
  const minutes = Math.round((hour - Math.floor(hour)) * 60)
  return `${h % 12 || 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${h < 12 ? 'AM' : 'PM'}`
}

const weekdayName = (weekday: number): string => WEEKDAYS[weekday] ?? ''

export function formatClock(ms: number): string {
  const time = lagosTime(ms)
  return `${weekdayName(time.weekday).slice(0, 3)} · ${time.hour % 12 || 12}:${String(time.minute).padStart(2, '0')} ${time.hour < 12 ? 'AM' : 'PM'}`
}

const waitLabel = (minutes: number): string => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`)

/**
 * Opening state of a place's hours at `now`, with the one label every screen shows (map card,
 * Ride app, Jobs and Career). Shared by systems/travel.ts and systems/career.ts so a venue's
 * hours can never be described two ways.
 */
export function openingInfo(hours: OpeningHours | null | undefined, now: number): OpeningInfo {
  if (!hours) return { open: true, always: true, hours: 'Open 24 hours', status: 'Open 24 hours', minutes: 0, opensAt: null }
  const range = `${formatHour(hours.open)} – ${formatHour(hours.close)}`
  if (isOpen(hours, now)) return { open: true, always: false, hours: range, status: `Open now · closes ${formatHour(hours.close)}`, minutes: 0, opensAt: null }
  let minutes: number
  if (hours.days) minutes = minutesUntilOpen(hours, now)
  else { const gap = Math.round(hours.open * 60) - lagosTime(now).minuteOfDay; minutes = ((gap % 1440) + 1440) % 1440 || 1440 }
  if (minutes === Infinity) return { open: false, always: false, hours: range, status: 'Closed', minutes, opensAt: null }
  const day = minutes >= 1440 ? `${weekdayName(lagosTime(now + minutes * 60000).weekday).slice(0, 3)} ` : ''
  const opensAt = `${day}${formatHour(hours.open)}`
  return { open: false, always: false, hours: range, status: `Closed · opens ${opensAt} (in ${waitLabel(minutes)})`, minutes, opensAt }
}
