import type { ClimateMonth, ClimateProfile } from './types.ts';

/** IANA-zone clock fields derived only from the supplied instant. */
export function localClock(epochMs: number, timezone: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
  weekday: string; timezone: string;
} {
  if (!Number.isFinite(epochMs) || !Number.isFinite(new Date(epochMs).getTime())) throw new RangeError('epochMs must be a valid instant');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(epochMs);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { year: Number(fields.year), month: Number(fields.month), day: Number(fields.day),
    hour: Number(fields.hour), minute: Number(fields.minute), second: Number(fields.second),
    weekday: fields.weekday!, timezone };
}

function solarTerms(epochMs: number): { declination: number; equationMinutes: number; utcMinutes: number } {
  if (!Number.isFinite(epochMs) || !Number.isFinite(new Date(epochMs).getTime())) throw new RangeError('epochMs must be a valid instant');
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const day = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) -
    Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const yearLength = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
  const gamma = 2 * Math.PI / yearLength * (day - 1 + (hour - 12) / 24);
  const equationMinutes = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  return { declination, equationMinutes, utcMinutes: hour * 60 };
}

/** Approximate geometric solar altitude in degrees (NOAA fractional-year equations). */
export function solarAltitude(epochMs: number, latitude: number, longitude: number): number {
  validateCoordinates(latitude, longitude);
  const { declination, equationMinutes, utcMinutes } = solarTerms(epochMs);
  const trueSolarMinutes = ((utcMinutes + equationMinutes + 4 * longitude) % 1440 + 1440) % 1440;
  const hourAngle = (trueSolarMinutes / 4 - 180) * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosZenith = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) * 180 / Math.PI;
}

/** Approximate daylight duration, counting the conventional -0.833° sunrise threshold. */
export function daylightHours(epochMs: number, latitude: number): number {
  validateCoordinates(latitude);
  const { declination } = solarTerms(epochMs);
  const lat = latitude * Math.PI / 180;
  const cosHour = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(lat) * Math.sin(declination)) /
    (Math.cos(lat) * Math.cos(declination));
  if (cosHour <= -1) return 24;
  if (cosHour >= 1) return 0;
  return 24 * Math.acos(cosHour) / Math.PI;
}

function validateCoordinates(latitude: number, longitude?: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      (longitude !== undefined && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    throw new RangeError('latitude and longitude must be finite WGS84 degrees');
  }
}

/** Monthly climate is indexed January=1; null means no sourced profile. */
export function lookupClimate(profile: ClimateProfile | null, month: number): ClimateMonth | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('month must be 1..12');
  return profile?.months[month - 1] ?? null;
}

/** A live observation is distinct from monthly climate normals. Precipitation,
 * when supplied, is a rate, never a monthly accumulation.
 */
export interface LiveWeatherValue {
  temperatureC: number;
  relativeHumidityPct: number;
  windMps: number;
  precipitationMmPerHour?: number;
}
export interface LiveWeatherReading { observedAt: number; value: LiveWeatherValue }
export type ConditionsResult =
  | { mode: 'live'; source: 'live-observation'; observedAt: number; value: LiveWeatherValue }
  | { mode: 'climate'; sourceId: string; period: string; month: number; value: ClimateMonth }
  | null;

/** Use a live observation only while fresh; otherwise fall back to the sourced month. */
export function currentConditions(
  epochMs: number, timezone: string, climate: ClimateProfile | null,
  live: LiveWeatherReading | null, staleAfterMs: number,
): ConditionsResult {
  if (!Number.isFinite(epochMs) || !Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    throw new RangeError('epochMs and nonnegative staleAfterMs must be finite');
  }
  if (live && Number.isFinite(live.observedAt) && live.observedAt <= epochMs &&
      epochMs - live.observedAt <= staleAfterMs) {
    return { mode: 'live', source: 'live-observation', observedAt: live.observedAt, value: live.value };
  }
  const month = localClock(epochMs, timezone).month;
  const value = lookupClimate(climate, month);
  return value && climate ? { mode: 'climate', sourceId: climate.sourceId, period: climate.period, month, value } : null;
}
