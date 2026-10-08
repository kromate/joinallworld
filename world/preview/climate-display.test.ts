import assert from 'node:assert/strict';
import { test } from 'node:test';
import { climateAttachmentDisplay } from './climate-display.ts';
import type { ClimateProfile, SourceRecord, WorldManifest } from '../types.ts';

const source: SourceRecord = {
  id: 'synthetic-monthly-source', url: 'https://data.example.test/monthly.json', release: 'baseline-1991-2020',
  license: 'Public-domain', attribution: 'Synthetic climate source', sha256: 'a'.repeat(64), bytes: 1234,
};
function climate(overrides: Partial<ClimateProfile> = {}): ClimateProfile {
  return {
    sourceId: source.id, period: '1991–2020',
    months: Array.from({ length: 12 }, (_, index) => ({
      temperatureC: 20 + index, relativeHumidityPct: 50 + index,
      precipitationMm: 30 + index, windMps: 2 + index / 10,
    })),
    ...overrides,
  };
}
function manifest(timezone: string | null, profile: ClimateProfile | null = climate()): WorldManifest {
  return {
    schemaVersion: 1, compilerVersion: 'fixture',
    region: { id: 'fixture-city', parentId: null, name: 'Fixture', kind: 'city', countryCode: 'GH', timezone, bounds: [0, 0, 1, 1] },
    frame: 'wgs84-enu-m-v1', verticalDatum: 'WGS84-ellipsoid', coverage: 'foundation',
    exceptions: [
      'Climate attachment provenance sha256:' + 'b'.repeat(64),
      'Climate association: named city-associated sample; not a cell average.',
      'Climate sample: requested and returned native-grid coordinates are disclosed.',
      'Climate baseline: historical monthly values, not live weather.',
    ],
    sources: [{ ...source }], tiles: [], climate: profile,
  };
}

test('selects a local calendar month across the London DST boundary', () => {
  const value = manifest('Europe/London');
  const beforeLocalMidnight = climateAttachmentDisplay(value, Date.UTC(2026, 2, 31, 22, 30));
  const afterLocalMidnight = climateAttachmentDisplay(value, Date.UTC(2026, 2, 31, 23, 30));
  assert.equal(beforeLocalMidnight.mode, 'monthly');
  assert.equal(beforeLocalMidnight.month, 3);
  assert.match(beforeLocalMidnight.text, /March · 1991–2020/);
  assert.equal(afterLocalMidnight.mode, 'monthly');
  assert.equal(afterLocalMidnight.month, 4);
  assert.match(afterLocalMidnight.text, /April · 1991–2020/);
});

test('uses Africa local time and labels monthly precipitation as accumulation', () => {
  const value = climateAttachmentDisplay(manifest('Africa/Nairobi'), Date.UTC(2026, 0, 31, 21, 30));
  assert.equal(value.mode, 'monthly');
  assert.equal(value.month, 2);
  assert.match(value.text, /February · 1991–2020/);
  assert.match(value.text, /31\.0 mm monthly precipitation accumulation/);
  assert.match(value.text, /Not live weather/);
  assert.match(value.sourceText, /Synthetic climate source/);
  assert.match(value.sourceText, /Climate sample: requested and returned native-grid coordinates/);
  assert.match(value.sourceText, /Climate attachment provenance sha256:/);
  const markerOnly = manifest('Africa/Nairobi');
  markerOnly.exceptions = ['Climate attachment provenance sha256:' + 'b'.repeat(64), 'Unrelated geometry note'];
  assert.match(climateAttachmentDisplay(markerOnly, Date.UTC(2026, 0, 31, 21, 30)).text, /no additional point association is inferred/);
});

test('keeps absent profiles and missing or invalid timezones explicitly unknown', () => {
  assert.deepEqual(climateAttachmentDisplay(manifest('Africa/Accra', null), Date.UTC(2026, 5, 1)), {
    mode: 'unknown', month: null, text: 'Climate is unknown: this pack has no sourced monthly climate profile.',
    sourceText: 'No verified monthly climate source is available for this pack.',
  });
  const missing = climateAttachmentDisplay(manifest(null), Date.UTC(2026, 5, 1));
  assert.equal(missing.mode, 'unknown'); assert.equal(missing.month, null);
  assert.match(missing.text, /No UTC month is inferred/);
  const invalid = climateAttachmentDisplay(manifest('Not/A-Timezone'), Date.UTC(2026, 5, 1));
  assert.equal(invalid.mode, 'unknown'); assert.equal(invalid.month, null);
  assert.match(invalid.text, /no usable IANA timezone/);
});

test('rejects incomplete values and ambiguous source identities without displaying invented zeros', () => {
  const months = climate().months.map(value => ({ ...value }));
  months.splice(7, 1);
  const badMonths = climateAttachmentDisplay(manifest('Africa/Accra', climate({ months })), Date.UTC(2026, 5, 1));
  assert.equal(badMonths.mode, 'unknown'); assert.match(badMonths.text, /incomplete/);
  const nonfinite = climate().months.map(value => ({ ...value }));
  nonfinite[5]!.temperatureC = Number.NaN;
  const badNumber = climateAttachmentDisplay(manifest('Africa/Accra', climate({ months: nonfinite })), Date.UTC(2026, 5, 1));
  assert.equal(badNumber.mode, 'unknown'); assert.match(badNumber.text, /incomplete/);
  const duplicate = manifest('Africa/Accra'); duplicate.sources.push({ ...source });
  const badSource = climateAttachmentDisplay(duplicate, Date.UTC(2026, 5, 1));
  assert.equal(badSource.mode, 'unknown'); assert.match(badSource.text, /does not resolve uniquely/);
  assert.doesNotMatch(badNumber.text, /0\.0 °C/);
});

test('ignores large unrelated geometry notes but bounds climate disclosures', () => {
  const value = manifest('Africa/Accra');
  value.sources[0]!.attribution = '<script>alert(1)</script>';
  value.sources[0]!.url = 'https://power.example.test/monthly?T2M=1&RH2M=2&PRECTOTCORR=3';
  value.exceptions.push('Geographic source detail: ' + 'x'.repeat(9 * 1024));
  const accepted = climateAttachmentDisplay(value, Date.UTC(2026, 5, 1));
  assert.equal(accepted.mode, 'monthly');
  assert.doesNotMatch(accepted.sourceText, /Geographic source detail/);
  assert.match(accepted.sourceText, /T2M=1&RH2M=2&PRECTOTCORR=3/);
  assert.match(accepted.sourceText, /<script>alert\(1\)<\/script>/);
  const oversized = manifest('Africa/Accra');
  oversized.exceptions[1] = 'Climate association: ' + 'x'.repeat(9 * 1024);
  const result = climateAttachmentDisplay(oversized, Date.UTC(2026, 5, 1));
  assert.equal(result.mode, 'unknown');
  assert.match(result.text, /exceed the display limit/);
  assert.ok(new TextEncoder().encode(result.sourceText).byteLength <= 8 * 1024);
});

test('rejects physical values outside the monthly climate domains', () => {
  const invalidProfiles = [
    climate({ months: climate().months.map((value, index) => index === 0 ? { ...value, temperatureC: 101 } : value) }),
    climate({ months: climate().months.map((value, index) => index === 0 ? { ...value, relativeHumidityPct: -1 } : value) }),
    climate({ months: climate().months.map((value, index) => index === 0 ? { ...value, precipitationMm: -0.1 } : value) }),
    climate({ months: climate().months.map((value, index) => index === 0 ? { ...value, windMps: -0.1 } : value) }),
  ];
  for (const profile of invalidProfiles) {
    const result = climateAttachmentDisplay(manifest('Africa/Accra', profile), Date.UTC(2026, 5, 1));
    assert.equal(result.mode, 'unknown');
    assert.match(result.text, /incomplete or contains invalid values/);
  }
});
