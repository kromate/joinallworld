/** Shared time and light presets; no geometry, renderer, asset or venue-builder imports. */
import { lagosTime } from '../game/clock.ts';
import type { Lighting, Mood, TimeOfDay } from './types.ts';

export const TIMES: readonly TimeOfDay[] = Object.freeze<TimeOfDay[]>(['day', 'dusk', 'night']);
export const isTimeOfDay = (value: unknown): value is TimeOfDay => TIMES.includes(value as TimeOfDay);

/**
 * Day / dusk / night presets per mood. sky: [horizon, zenith]; hemi: [sky, ground, intensity];
 * sun: [colour, intensity, position]; rim: [colour, intensity] (the host's back light);
 * glow: strength of lit surfaces; lamps: point-light scale.
 *
 * LIT FOR EVERY SKIN TONE. The hemisphere's ground colour is the light that reaches a face from
 * below: it is a warm bounce off sand, laterite or a wooden floor — never dark green or near-black,
 * which is what turned the darkest skin tones into silhouettes. Night keeps a hemisphere of at
 * least 1 and leans on the rim light, so people stay readable against a dark sky; the club keeps
 * its purple but gets a warmer floor bounce for faces.
 */
export const LIGHTING: Readonly<Record<Mood, Readonly<Record<TimeOfDay, Lighting>>>> = Object.freeze({
  outdoor: {
    day: { sky: ['#cfe9f3', '#6fb4e6'], hemi: ['#eaf4ff', '#c9b08a', 1.9], sun: ['#fff0d2', 2.4, [-10, 26, 12]], rim: ['#cfe2ff', 0.7], glow: 0.6, lamps: 0.1 },
    dusk: { sky: ['#f0b48c', '#5d528f'], hemi: ['#f3cdb6', '#8a6f6a', 1.5], sun: ['#ff9a5c', 1.9, [-22, 11, 7]], rim: ['#c9b6f0', 0.9], glow: 1.05, lamps: 0.8 },
    night: { sky: ['#243152', '#0b1020'], hemi: ['#9fb4e6', '#3a3550', 1.05], sun: ['#9fb9ea', 0.8, [-12, 25, 8]], rim: ['#bcd0ff', 0.95], glow: 1.3, lamps: 1.6 },
  },
  indoor: {
    day: { sky: ['#d6e9ef', '#8cc0e2'], hemi: ['#fff6ea', '#cdbba6', 2.2], sun: ['#fff1d8', 1.9, [-8, 26, 14]], rim: ['#dfeaff', 0.5], glow: 0.85, lamps: 0.45 },
    dusk: { sky: ['#e3a37c', '#6f5f95'], hemi: ['#ffe4c7', '#a8937f', 1.9], sun: ['#ffb57c', 1.4, [-18, 14, 10]], rim: ['#d9c8f2', 0.6], glow: 1.05, lamps: 0.85 },
    night: { sky: ['#232e4a', '#0e1324'], hemi: ['#ecdfc9', '#7a6f78', 1.6], sun: ['#c9d3ee', 0.9, [-12, 25, 8]], rim: ['#c6d4ff', 0.7], glow: 1.2, lamps: 1.1 },
  },
  club: {
    day: { sky: ['#241d3a', '#120f1f'], hemi: ['#b3a2ea', '#4a3550', 1.1], sun: ['#c0b0ff', 0.7, [-10, 26, 10]], rim: ['#ffd9b0', 0.8], glow: 1.2, lamps: 1.05 },
    dusk: { sky: ['#221b36', '#110e1d'], hemi: ['#a996e2', '#46324c', 1.05], sun: ['#b8a4ff', 0.6, [-10, 26, 10]], rim: ['#ffd9b0', 0.8], glow: 1.3, lamps: 1.15 },
    night: { sky: ['#1e1833', '#0d0a18'], hemi: ['#a08cdc', '#422f48', 1], sun: ['#b8a4ff', 0.55, [-10, 26, 10]], rim: ['#ffd9b0', 0.85], glow: 1.35, lamps: 1.2 },
  },
});

/** Lagos time of day from server ms: day 06:30–17:30, dusk for the hour either side of night. */
export function timeOfDay(ms: number): TimeOfDay {
  const { minuteOfDay } = lagosTime(ms);
  if (minuteOfDay >= 390 && minuteOfDay < 1050) return 'day';
  if ((minuteOfDay >= 330 && minuteOfDay < 390) || (minuteOfDay >= 1050 && minuteOfDay < 1170)) return 'dusk';
  return 'night';
}
export const lightingFor = (mood: string, time: unknown): Lighting => (LIGHTING[mood as Mood] || LIGHTING.outdoor)[isTimeOfDay(time) ? time : 'day'];

