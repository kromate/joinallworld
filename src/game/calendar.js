/**
 * OWNER: growth
 * The events calendar as pure functions of a server time: what is on now, what is coming, and an
 * "add to calendar" file for one occurrence. No I/O, no clock of its own, no DOM — shared by the
 * rules engine (systems/events.js), the server (the pulse of live events) and the Events app.
 */
import { lagosTime, lagosDayStart, isOpen } from './clock.js';
import { EVENTS_CALENDAR } from './content/calendar.js';
import { VENUES, venueLabel } from './content/venues.js';

const HOUR = 3600000, DAY = 86400000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Lagos day index of 'YYYY-MM-DD', or null when it is not a real date. */
export function dayOfDate(text) {
  const match = DATE.exec(String(text ?? ''));
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const back = new Date(ms);
  return back.getUTCMonth() === Number(match[2]) - 1 && back.getUTCDate() === Number(match[3]) ? Math.floor(ms / DAY) : null;
}

/**
 * The occurrence of `event` that starts on Lagos day `day`, or null.
 * @returns {{ id: string, key: string, start: number, end: number } | null}  server ms; `key` is unique per occurrence
 */
export function occurrenceOn(event, day) {
  const when = event?.when;
  if (!when) return null;
  const from = Number.isFinite(when.from) ? when.from : 0;
  // `to` at or before `from` runs past midnight; with no hours a dated event lasts the whole day.
  const to = Number.isFinite(when.to) ? when.to : 24;
  const length = (to > from ? to - from : to + 24 - from) * HOUR;
  if (Number.isInteger(when.weekday)) {
    if (lagosTime(lagosDayStart(day)).weekday !== when.weekday) return null;
  } else {
    const first = dayOfDate(when.start), last = dayOfDate(when.end);
    if (first === null || last === null || day < first || day > last) return null;
  }
  const start = lagosDayStart(day) + from * HOUR;
  return { id: event.id, key: `${event.id}:${day}`, start, end: start + length };
}

const known = (event, cityId) => Object.hasOwn(VENUES, event.venue) && typeof venueLabel(event.venue, cityId) === 'string';
const describe = (event, occurrence, cityId, now) => ({
  id: event.id, key: occurrence.key, title: event.title, blurb: event.blurb, venue: event.venue, venueLabel: venueLabel(event.venue, cityId), icon: event.icon,
  start: occurrence.start, end: occurrence.end, live: now >= occurrence.start && now < occurrence.end,
  spray: event.spray === true, table: event.table ?? null,
});

/**
 * Every occurrence that overlaps [from, to), soonest first. An occurrence whose venue is closed
 * for its whole length is left out: a closed door never hosts.
 * @param {number} from server ms  @param {number} to server ms  @param {string} [cityId]
 */
export function eventsBetween(from, to, cityId = 'lagos', calendar = EVENTS_CALENDAR) {
  const out = [];
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return out;
  // An occurrence may have started the day before (a club night past midnight).
  for (let day = lagosTime(from).day - 1; day <= lagosTime(to - 1).day; day++) {
    for (const event of calendar) {
      const occurrence = occurrenceOn(event, day);
      if (!occurrence || occurrence.end <= from || occurrence.start >= to || !known(event, cityId)) continue;
      const hours = VENUES[event.venue].hours;
      if (hours && !isOpen(hours, occurrence.start) && !isOpen(hours, occurrence.end - 60000)) continue;
      out.push(describe(event, occurrence, cityId, from));
    }
  }
  return out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** What is on at `now`. */
export const eventsAt = (now, cityId = 'lagos', calendar = EVENTS_CALENDAR) => eventsBetween(now, now + 1, cityId, calendar).filter((event) => event.live);
/** What is on now or starts within `days` days, soonest first. */
export const upcomingEvents = (now, days = 7, cityId = 'lagos', calendar = EVENTS_CALENDAR) => eventsBetween(now, now + days * DAY, cityId, calendar);
/** The live event at a venue, or null. */
export const eventAtVenue = (now, venue, cityId = 'lagos', calendar = EVENTS_CALENDAR) => eventsAt(now, cityId, calendar).find((event) => event.venue === venue) ?? null;
/** Is anything on during the Lagos day that contains `now`? */
export const hasEventToday = (now, cityId = 'lagos', calendar = EVENTS_CALENDAR) => { const start = lagosDayStart(lagosTime(now).day); return eventsBetween(Math.max(now, start), start + DAY, cityId, calendar).length > 0; };

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const fold = (text) => String(text ?? '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, ' ');
/**
 * One occurrence as an iCalendar file (RFC 5545), for "Add to my calendar". Nothing is sent
 * anywhere: the browser hands the text to the phone's own calendar.
 * @param {{ key: string, title: string, blurb: string, venueLabel: string, start: number, end: number }} event
 */
export function eventIcs(event, link = '') {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Allworld//Events//EN', 'BEGIN:VEVENT', `UID:${fold(event.key)}@allworld`, `DTSTAMP:${stamp(event.start)}`,
    `DTSTART:${stamp(event.start)}`, `DTEND:${stamp(event.end)}`, `SUMMARY:${fold(`Allworld: ${event.title}`)}`, `LOCATION:${fold(`${event.venueLabel} (in Allworld)`)}`,
    `DESCRIPTION:${fold(`${event.blurb}${link ? ` ${link}` : ''}`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
