// Lagos wall-clock helpers. Opening hours, job schedules and weekly billing run on real
// Africa/Lagos time. Lagos is UTC+1 all year (no daylight saving), so this is plain
// arithmetic: pure, deterministic and identical on the server, the worker and the client.

export const LAGOS_OFFSET_MS = 3600000;
const DAY_MS = 86400000;
export const WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

/**
 * @param {number} ms server time
 * @returns {{day:number, weekday:number, week:number, hour:number, minute:number, minuteOfDay:number}}
 *   day      whole Lagos days since 1970-01-01
 *   weekday  0 = Sunday … 6 = Saturday
 *   week     index of the Monday-started week (use it to detect "a new week began")
 */
export function lagosTime(ms) {
  const local = (Number.isFinite(ms) ? ms : 0) + LAGOS_OFFSET_MS;
  const day = Math.floor(local / DAY_MS);
  const minuteOfDay = Math.floor((local - day * DAY_MS) / 60000);
  return {
    day,
    weekday: (((day + 4) % 7) + 7) % 7,
    week: Math.floor((day + 3) / 7),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    minuteOfDay,
  };
}

/** Server ms at which the given Lagos day index starts. */
export const lagosDayStart = (day) => day * DAY_MS - LAGOS_OFFSET_MS;

/**
 * Opening hours: `{ open, close, days? }` with hours as numbers (9, 17.5); `close <= open`
 * wraps past midnight; `days` is an optional list of weekdays (0–6). Missing hours = always open.
 */
export function isOpen(hours, ms) {
  if (!hours) return true;
  const time = lagosTime(ms);
  const at = time.minuteOfDay / 60;
  const wraps = hours.close <= hours.open;
  const inHours = wraps ? at >= hours.open || at < hours.close : at >= hours.open && at < hours.close;
  if (!inHours) return false;
  if (!hours.days) return true;
  // After midnight on a wrapping schedule the shift belongs to the previous day.
  const weekday = wraps && at < hours.close ? (time.weekday + 6) % 7 : time.weekday;
  return hours.days.includes(weekday);
}

/** Minutes until the place next opens (0 when open now). Searches at most eight days ahead. */
export function minutesUntilOpen(hours, ms) {
  if (isOpen(hours, ms)) return 0;
  const startMinute = Math.floor(ms / 60000) + 1;
  for (let i = 0; i < 8 * 1440; i++) if (isOpen(hours, (startMinute + i) * 60000)) return i + 1;
  return Infinity;
}

export function formatHour(hour) {
  const h = Math.floor(hour) % 24;
  const minutes = Math.round((hour - Math.floor(hour)) * 60);
  return `${h % 12 || 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${h < 12 ? 'AM' : 'PM'}`;
}

export function formatClock(ms) {
  const time = lagosTime(ms);
  return `${WEEKDAYS[time.weekday].slice(0, 3)} · ${time.hour % 12 || 12}:${String(time.minute).padStart(2, '0')} ${time.hour < 12 ? 'AM' : 'PM'}`;
}
