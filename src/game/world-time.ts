// The world clock contract: what part of the day it is, the day's seed and the season of a city.
// Pure arithmetic on a server time in ms: no THREE, no DOM, no network, no stored state, so the server, the worker and the
// browser compute the same answer for the same input (docs/REALISM.md, "Shared foundations"). Routines, city conditions,
// scene lighting and the moment banks (src/moments) all read it; none of them keeps its own copy of these rules.
import { lagosTime, lagosDayStart } from './clock.ts';
import { makeRng } from './util.ts';
import type { CityClimate } from '../types/content.ts';

/** The five parts of a Lagos day, in order from the first one after midnight's night. */
export const TIME_BANDS = Object.freeze(['dawn', 'morning', 'afternoon', 'evening', 'night'] as const);
export type TimeBand = (typeof TIME_BANDS)[number];

/**
 * Where each band starts, in Lagos minutes after midnight. A band lasts until the next one starts; night wraps past midnight.
 *   dawn       05:00 – 07:00   first light, the first call to prayer, the first danfo
 *   morning    07:00 – 12:00   the rush, markets and offices opening
 *   afternoon  12:00 – 17:00   the heat, lunch, the afternoon lull
 *   evening    17:00 – 21:00   closing time, traffic home, football and the viewing centres
 *   night      21:00 – 05:00   nightlife, generators, the city asleep
 * Lagos is UTC+1 all year with a sunrise near 06:30 and a sunset near 18:40, and the other cities are within an hour of it, so
 * one set of boundaries serves every city. These are original beta values.
 */
const BAND_STARTS: readonly (readonly [TimeBand, number])[] = Object.freeze([['dawn', 300], ['morning', 420], ['afternoon', 720], ['evening', 1020], ['night', 1260]] as const);

/** A band's place on the clock: `from` (inclusive) and `to` (exclusive) are server ms. */
export interface BandSpan { band: TimeBand; from: number; to: number }

/** The band of a moment, from Lagos wall-clock time. */
export function timeBand(now: number): TimeBand {
  return bandSpan(now).band;
}

/** The band of a moment together with when that stretch of the clock starts and ends (the night that began yesterday evening included). */
export function bandSpan(now: number): BandSpan {
  const { day, minuteOfDay } = lagosTime(now);
  // Index of the band the minute falls in; the minutes before 05:00 belong to the night that began the evening before.
  let index = BAND_STARTS.length - 1;
  for (let i = 0; i < BAND_STARTS.length; i++) if (minuteOfDay >= (BAND_STARTS[i] as readonly [TimeBand, number])[1]) index = i;
  const [band, start] = BAND_STARTS[index] as readonly [TimeBand, number];
  const after = BAND_STARTS[(index + 1) % BAND_STARTS.length] as readonly [TimeBand, number];
  const startsYesterday = band === 'night' && minuteOfDay < BAND_STARTS[0]![1];
  const from = lagosDayStart(startsYesterday ? day - 1 : day) + start * 60000;
  const endsTomorrow = band === 'night' && !startsYesterday;
  const to = lagosDayStart(endsTomorrow ? day + 1 : day) + after[1] * 60000;
  return { band, from, to };
}

/** A stable unsigned 32-bit seed for one city on one Lagos day (`day` is LagosTime.day). The same on every host. */
export function daySeed(cityId: string, day: number): number {
  return Math.floor(makeRng(`day|${cityId}|${Math.floor(Number.isFinite(day) ? day : 0)}`)() * 4294967296) >>> 0;
}

/** A month's chance of rain at or above this makes it the wet season: 0.25 puts Kano's June to September wet and its May shoulder dry. Original beta value. */
export const WET_RAIN_CHANCE = 0.25;

export interface CitySeason {
  /** The rainy season: this month's chance of rain is at least WET_RAIN_CHANCE. */
  wet: boolean;
  /** This month is one of the city's harmattan months. */
  harmattan: boolean;
  /** What the weather text calls the sky on a dry day (the same label weatherAt shows): the harmattan label, else the clear label. Empty when the city has no climate. */
  label: string;
}

/**
 * The season of a city in the Lagos month of `now`, read from its CityClimate (`CITY_RULES[cityId]?.climate`). The climate is passed in,
 * not looked up by id, so this stays a pure function: a city with no climate has no season (dry, no harmattan, no label).
 */
export function citySeason(climate: Pick<CityClimate, 'rainChanceByMonth' | 'clearLabel' | 'harmattan'> | null | undefined, now: number): CitySeason {
  if (!climate) return { wet: false, harmattan: false, label: '' };
  const month = new Date(lagosTime(now).day * 86400000).getUTCMonth(); // 0 = January; the Lagos day number is a civil date
  const harmattan = Boolean(climate.harmattan?.months.includes(month + 1));
  return { wet: (climate.rainChanceByMonth[month] ?? 0) >= WET_RAIN_CHANCE, harmattan, label: harmattan && climate.harmattan ? climate.harmattan.label : climate.clearLabel };
}
