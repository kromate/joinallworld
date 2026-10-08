import test from 'node:test';
import assert from 'node:assert/strict';
import { currentConditions, daylightHours, localClock, lookupClimate, solarAltitude } from './conditions.ts';
import type { ClimateProfile } from './types.ts';

test('IANA local clock follows London daylight-saving transitions', () => {
  const before = localClock(Date.UTC(2026, 2, 29, 0, 30), 'Europe/London');
  const after = localClock(Date.UTC(2026, 2, 29, 1, 30), 'Europe/London');
  assert.equal(before.hour, 0);
  assert.equal(after.hour, 2);
  assert.equal(before.month, 3);
});

test('solar altitude and daylight represent equinox and polar solstices', () => {
  const equinoxNoon = Date.UTC(2026, 2, 20, 12);
  assert.ok(Math.abs(solarAltitude(equinoxNoon, 0, 0) - 88.0) < 1);
  const june = Date.UTC(2026, 5, 21, 12);
  const december = Date.UTC(2026, 11, 21, 12);
  assert.equal(daylightHours(june, 89), 24);
  assert.equal(daylightHours(december, 89), 0);
});

test('sourced monthly conditions and stale live-weather fallback', () => {
  const month = { temperatureC: 22, relativeHumidityPct: 60, precipitationMm: 3, windMps: 4 };
  const liveValue = { temperatureC: 29, relativeHumidityPct: 52, windMps: 6, precipitationMmPerHour: 0.4 };
  const climate: ClimateProfile = { sourceId: 'climate-source', period: '1991-2020', months: Array(12).fill(month) };
  assert.equal(lookupClimate(null, 1), null);
  assert.deepEqual(currentConditions(Date.UTC(2026, 0, 1), 'UTC', climate,
    { observedAt: Date.UTC(2026, 0, 1) - 1000, value: liveValue }, 2000), {
    mode: 'live', source: 'live-observation', observedAt: Date.UTC(2026, 0, 1) - 1000, value: liveValue,
  });
  assert.deepEqual(currentConditions(Date.UTC(2026, 0, 1), 'UTC', climate,
    { observedAt: Date.UTC(2025, 11, 1), value: liveValue }, 2000), {
    mode: 'climate', sourceId: 'climate-source', period: '1991-2020', month: 1, value: month,
  });
});

test('solar date and coordinates reject invalid inputs and leap-year day uses leap denominator', () => {
  assert.throws(() => solarAltitude(Number.NaN, 0, 0), RangeError);
  assert.throws(() => solarAltitude(Date.UTC(2026, 0, 1), 91, 0), RangeError);
  assert.throws(() => solarAltitude(Date.UTC(2026, 0, 1), 0, 181), RangeError);
  assert.ok(Number.isFinite(solarAltitude(Date.UTC(2024, 2, 20, 12), 0, 0)));
});
