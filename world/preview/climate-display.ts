import { localClock, lookupClimate } from '../conditions.ts';
import type { ClimateAttachmentDisplay } from '../climate-attachment-types.ts';
import type { ClimateMonth, SourceRecord, WorldManifest } from '../types.ts';

const SOURCE_TEXT_LIMIT_BYTES = 8 * 1024;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const CLIMATE_DISCLOSURE_PREFIXES = [
  'Climate association:', 'Climate sample:', 'Climate baseline:', 'Climate attachment provenance sha256:',
] as const;

function safePlainText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ');
}

function unknown(text: string, sourceText = 'No verified monthly climate source is available for this pack.'): ClimateAttachmentDisplay {
  return { mode: 'unknown', month: null, text, sourceText };
}

function validClimateMonth(value: unknown): value is ClimateMonth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.temperatureC === 'number' && Number.isFinite(row.temperatureC) && row.temperatureC >= -100 && row.temperatureC <= 100
    && typeof row.relativeHumidityPct === 'number' && Number.isFinite(row.relativeHumidityPct) && row.relativeHumidityPct >= 0 && row.relativeHumidityPct <= 100
    && typeof row.precipitationMm === 'number' && Number.isFinite(row.precipitationMm) && row.precipitationMm >= 0
    && typeof row.windMps === 'number' && Number.isFinite(row.windMps) && row.windMps >= 0;
}

function validSource(source: SourceRecord): boolean {
  return typeof source.id === 'string' && source.id.length > 0
    && typeof source.url === 'string' && source.url.length > 0
    && typeof source.release === 'string' && source.release.length > 0
    && typeof source.license === 'string' && source.license.length > 0
    && typeof source.attribution === 'string' && source.attribution.length > 0
    && /^[a-f0-9]{64}$/u.test(source.sha256)
    && Number.isSafeInteger(source.bytes) && source.bytes > 0;
}

function sourceDisclosure(manifest: WorldManifest, source: SourceRecord, period: string): { text: string; climateLines: string[] } | null {
  const attribution = safePlainText(source.attribution);
  const release = safePlainText(source.release);
  const license = safePlainText(source.license);
  const id = safePlainText(source.id);
  const url = safePlainText(source.url);
  if (!attribution || !release || !license || !id || !url || !Array.isArray(manifest.exceptions)
    || manifest.exceptions.some(item => typeof item !== 'string')) return null;
  const climateLines = manifest.exceptions.filter(item => CLIMATE_DISCLOSURE_PREFIXES.some(prefix => item.startsWith(prefix)));
  const rows = [
    `${attribution} · ${release} · ${license}`,
    `Source ID: ${id} · SHA-256: ${source.sha256} · ${source.bytes} bytes`,
    `Source URL: ${url}`,
    `Monthly baseline period: ${safePlainText(period) ?? '(unavailable)'}`,
    ...(climateLines.length ? ['Climate disclosures:', ...climateLines.map(item => `• ${safePlainText(item) ?? '(empty disclosure)'}`)] : []),
  ];
  const result = rows.join('\n');
  return new TextEncoder().encode(result).byteLength <= SOURCE_TEXT_LIMIT_BYTES ? { text: result, climateLines } : null;
}

/** Format only a source-bound monthly profile; this does not synthesize live weather. */
export function climateAttachmentDisplay(manifest: WorldManifest | null, epochMs: number): ClimateAttachmentDisplay {
  if (!manifest || manifest.climate === null) {
    return unknown('Climate is unknown: this pack has no sourced monthly climate profile.');
  }
  const profile = manifest.climate;
  if (!profile || typeof profile !== 'object' || typeof profile.sourceId !== 'string' || profile.sourceId.length === 0
    || typeof profile.period !== 'string' || profile.period.length === 0 || new TextEncoder().encode(profile.period).byteLength > 128 || !Array.isArray(profile.months)
    || profile.months.length !== 12 || !profile.months.every(validClimateMonth)) {
    return unknown('Climate is unknown: the monthly profile is incomplete or contains invalid values.');
  }
  if (!Array.isArray(manifest.sources)) return unknown('Climate is unknown: its source record is unavailable.');
  const matches = manifest.sources.filter(source => source?.id === profile.sourceId);
  if (matches.length !== 1 || !validSource(matches[0]!)) {
    return unknown('Climate is unknown: its source identity does not resolve uniquely.', 'Climate source provenance could not be verified.');
  }
  const source = matches[0]!;
  const disclosure = sourceDisclosure(manifest, source, profile.period);
  if (!disclosure) {
    return unknown('Climate is unknown: complete source disclosures exceed the display limit.', 'Complete climate source disclosures could not be shown within the 8 KiB limit.');
  }
  const details = disclosure.text;
  if (!Number.isFinite(epochMs) || !Number.isFinite(new Date(epochMs).getTime())) {
    return unknown('Climate is unknown for this instant: the supplied time is invalid.', details);
  }
  const timezone = manifest.region?.timezone;
  if (typeof timezone !== 'string' || timezone.length === 0) {
    return unknown('Sourced monthly climate is available, but the local calendar month is unknown because this pack has no IANA timezone. No UTC month is inferred.', details);
  }
  let month: number;
  try {
    month = localClock(epochMs, timezone).month;
  } catch {
    return unknown('Sourced monthly climate is available, but this pack has no usable IANA timezone; the local month is unknown. No UTC month is inferred.', details);
  }
  const value = lookupClimate(profile, month);
  if (!value || !validClimateMonth(value)) return unknown('Climate is unknown for the selected local month.', details);

  const attachmentMarker = disclosure.climateLines.some(item => /^Climate attachment provenance sha256:[a-f0-9]{64}$/u.test(item));
  const associationDisclosures = ['Climate association:', 'Climate sample:', 'Climate baseline:']
    .every(prefix => disclosure.climateLines.some(item => item.startsWith(prefix) && item.slice(prefix.length).trim().length > 0));
  const context = attachmentMarker && associationDisclosures
    ? 'Explicit city-association provenance and the climate-specific disclosures above are present.'
    : 'This is the source profile attached to this pack; no additional point association is inferred.';
  const text = `Historical monthly baseline (${MONTHS[month - 1]} · ${profile.period}): ${value.temperatureC.toFixed(1)} °C · ${value.relativeHumidityPct.toFixed(1)}% relative humidity · ${value.precipitationMm.toFixed(1)} mm monthly precipitation accumulation · ${value.windMps.toFixed(1)} m/s wind. Not live weather. ${context}`;
  return { mode: 'monthly', month, text, sourceText: details };
}
