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

const waitLabel = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);

/**
 * Opening state of a place's hours at `now`, with the one label every screen shows (map card,
 * Ride app, Jobs and Career). Shared by systems/travel.js and systems/career.js so a venue's
 * hours can never be described two ways.
 * @returns {{ open, always, hours, status, minutes, opensAt }}
 *   hours   'Open 24 hours' | '8AM – 10PM'
 *   status  'Open 24 hours' | 'Open now · closes 10PM' | 'Closed · opens 8AM (in 5h 19m)'
 */
export function openingInfo(hours, now) {
  if (!hours) return { open: true, always: true, hours: 'Open 24 hours', status: 'Open 24 hours', minutes: 0, opensAt: null };
  const range = `${formatHour(hours.open)} – ${formatHour(hours.close)}`;
  if (isOpen(hours, now)) return { open: true, always: false, hours: range, status: `Open now · closes ${formatHour(hours.close)}`, minutes: 0, opensAt: null };
  let minutes;
  if (hours.days) minutes = minutesUntilOpen(hours, now);
  else { const gap = Math.round(hours.open * 60) - lagosTime(now).minuteOfDay; minutes = ((gap % 1440) + 1440) % 1440 || 1440; }
  if (minutes === Infinity) return { open: false, always: false, hours: range, status: 'Closed', minutes, opensAt: null };
  const day = minutes >= 1440 ? `${WEEKDAYS[lagosTime(now + minutes * 60000).weekday].slice(0, 3)} ` : '';
  const opensAt = `${day}${formatHour(hours.open)}`;
  return { open: false, always: false, hours: range, status: `Closed · opens ${opensAt} (in ${waitLabel(minutes)})`, minutes, opensAt };
}
