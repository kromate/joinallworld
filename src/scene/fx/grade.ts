/**
 * OWNER: scenes
 * The colour grade of the HIGH tier, made in code: a 16x16x16 lookup table from a handful of numbers (lift, gamma, gain per
 * channel, warmth, saturation). Nothing is downloaded and no file is shipped. The mood comes from the city's season and the
 * hour: harmattan amber in the dry Sahel months, grey-blue in the rains, a clean blue in a clear dry season, and a sodium
 * orange cast at night. The grade is applied last and kept subtle: every gain stays within 8% of 1, so it sits on top of the
 * lighting presets (src/scene/lighting.ts, src/game/conditions/look.ts) instead of fighting them.
 *
 * Pure: numbers in, bytes out. No THREE, no DOM. The draw side (post.ts) wraps the bytes in a 3D texture.
 */
import { lagosTime } from '../../game/clock.ts';
import { citySeason } from '../../game/world-time.ts';
import type { CityClimate } from '../../types/content.ts';

export const LUT_SIZE = 16;
export type HourBand = 'dawn' | 'day' | 'dusk' | 'night';
/** The mood a season gives: harmattan haze, the rains, or a clear dry spell. */
export type GradeKind = 'harmattan' | 'rains' | 'clear';
export const HOUR_BANDS: readonly HourBand[] = Object.freeze(['dawn', 'day', 'dusk', 'night'] as const);
export const GRADE_KINDS: readonly GradeKind[] = Object.freeze(['harmattan', 'rains', 'clear'] as const);

type Triple = readonly [number, number, number];
export interface GradeParams {
  /** Raises the shadows per channel (0 to 0.05). White stays at the gain. */
  lift: Triple
  /** Mid-tone curve per channel (1 = unchanged, above 1 brightens the mids). */
  gamma: Triple
  /** Multiplies each channel (kept inside 0.92 to 1.08 once warmth is folded in). */
  gain: Triple
  /** Warm (positive) or cool (negative): red up and blue down, or the reverse. */
  warmth: number
  /** 1 = unchanged. */
  saturation: number
}

/** The largest push on any channel's gain: the brief's "gain within 8%". */
export const GAIN_LIMIT = 0.08;

const SEASON: Readonly<Record<GradeKind, GradeParams>> = Object.freeze({
  harmattan: { lift: [0.012, 0.008, 0], gamma: [1, 1, 1.03], gain: [1.03, 1.01, 0.96], warmth: 0.03, saturation: 0.92 },
  rains: { lift: [0, 0.004, 0.012], gamma: [1, 1, 1], gain: [0.97, 0.99, 1.03], warmth: -0.03, saturation: 0.88 },
  clear: { lift: [0, 0, 0.004], gamma: [1, 1, 1], gain: [0.99, 1, 1.03], warmth: -0.015, saturation: 1.04 },
});

/** What the hour adds on top of the season: a pink-gold cast at the edges of the day, sodium orange at night. */
const BAND: Readonly<Record<HourBand, GradeParams>> = Object.freeze({
  dawn: { lift: [0.004, 0.002, 0.006], gamma: [1, 1, 1], gain: [1.02, 1, 0.99], warmth: 0.015, saturation: 1 },
  day: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], warmth: 0, saturation: 1 },
  dusk: { lift: [0.006, 0.002, 0.006], gamma: [1, 1, 1], gain: [1.03, 1, 0.97], warmth: 0.025, saturation: 1.03 },
  night: { lift: [0, 0.003, 0.008], gamma: [1, 1, 1], gain: [1.05, 1, 0.93], warmth: 0.025, saturation: 1.05 },
});

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const times = (a: Triple, b: Triple): Triple => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

/** The mood of a season: harmattan wins, then the rains, otherwise a clear dry spell. */
export const gradeKind = (season: { wet: boolean; harmattan: boolean }): GradeKind => (season.harmattan ? 'harmattan' : season.wet ? 'rains' : 'clear');

/** The hour band of a Lagos minute of the day (the same edges as timeOfDay in src/scene/lighting.ts: dusk is the hour around dark). */
export function hourBand(minuteOfDay: number): HourBand {
  if (minuteOfDay >= 390 && minuteOfDay < 1050) return 'day';
  if (minuteOfDay >= 330 && minuteOfDay < 390) return 'dawn';
  if (minuteOfDay >= 1050 && minuteOfDay < 1170) return 'dusk';
  return 'night';
}

/** The kind and band a city is in at `now` (ms). A city with no climate has a clear dry season. */
export function gradeFor(climate: Pick<CityClimate, 'rainChanceByMonth' | 'clearLabel' | 'harmattan'> | null | undefined, now: number): { kind: GradeKind; band: HourBand } {
  return { kind: gradeKind(citySeason(climate, now)), band: hourBand(lagosTime(now).minuteOfDay) };
}

/** Season and hour combined: lifts add, gammas and gains multiply, warmth moves red against blue, and every gain is held to the limit. */
export function gradeParams(kind: GradeKind, band: HourBand): GradeParams {
  const s = SEASON[kind], b = BAND[band];
  const warmth = s.warmth + b.warmth;
  const gain = times(s.gain, b.gain);
  const warmed: Triple = [gain[0] * (1 + warmth * 0.5), gain[1], gain[2] * (1 - warmth * 0.5)];
  return {
    lift: [s.lift[0] + b.lift[0], s.lift[1] + b.lift[1], s.lift[2] + b.lift[2]],
    gamma: times(s.gamma, b.gamma),
    gain: [clamp(warmed[0], 1 - GAIN_LIMIT, 1 + GAIN_LIMIT), clamp(warmed[1], 1 - GAIN_LIMIT, 1 + GAIN_LIMIT), clamp(warmed[2], 1 - GAIN_LIMIT, 1 + GAIN_LIMIT)],
    warmth,
    saturation: s.saturation * b.saturation,
  };
}

/** One colour (sRGB, 0 to 1 per channel) through the grade. Each channel only ever rises with its input, so grey stays monotone. */
export function applyGrade(p: GradeParams, r: number, g: number, b: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const input = [r, g, b] as const;
  for (let c = 0; c < 3; c += 1) {
    const v = clamp(input[c]! * p.gain[c]! + p.lift[c]! * (1 - input[c]!), 0, 1);
    out[c] = Math.pow(v, 1 / p.gamma[c]!);
  }
  const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  return [clamp(luma + (out[0] - luma) * p.saturation, 0, 1), clamp(luma + (out[1] - luma) * p.saturation, 0, 1), clamp(luma + (out[2] - luma) * p.saturation, 0, 1)];
}

/**
 * The 16^3 table as 8-bit RGBA, red fastest then green then blue (the layout of a three.js Data3DTexture, whose texture
 * coordinate is the input colour). Input colours are sRGB, which is how the LUT effect hands them over.
 */
export function buildLut(p: GradeParams, size = LUT_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  const step = 1 / (size - 1);
  let at = 0;
  for (let z = 0; z < size; z += 1) for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const [r, g, b] = applyGrade(p, x * step, y * step, z * step);
    data[at] = Math.round(r * 255); data[at + 1] = Math.round(g * 255); data[at + 2] = Math.round(b * 255); data[at + 3] = 255;
    at += 4;
  }
  return data;
}

/** A short fingerprint of bytes (FNV-1a, 8 hex digits), so a grade can be pinned in a test and never change by accident. */
export function lutHash(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) { h ^= data[i]!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
