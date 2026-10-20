/**
 * OWNER: scenes
 * Ground markers: the ring that shows a spot is playable, the dimmer one for a spot that is not available right now, and the
 * ripple where a tap or walk sends the avatar. Flat rings and short dashes drawn on the glow layer, so there is no dark
 * centre; the ground shows through. Plain typed-array geometry, so it runs under `node --test` without WebGL.
 *
 *   spotMark(b, accent)          the chosen spot: a bright ring, a dashed inner ring, a small centre dot
 *   spotMark(b, accent, false)   not available: a thin muted dashed ring only
 *   nearMark(b)                  the lighter ring under a spot the avatar is near
 *   rippleMark(b)                one ring at unit size; rippleStep() grows and fades it
 *   pulse(t, reduced)            a 1 ± 0.04 breath for the spot ring (always 1 when motion is reduced)
 *   rippleStep(ms, reduced)      { scale, opacity } for a ripple `ms` after the tap
 */

import type { Batch, BatchGeometry, Colour } from './types.ts';
import { GLOW } from './build.ts';

const TAU = Math.PI * 2;

/** A flat ring (or an arc of one) lying on the ground, facing up. */
export function annulus(inner: number, outer: number, seg = 24, from = 0, to = TAU, y = 0): BatchGeometry {
  const steps = Math.max(1, Math.round(seg * (to - from) / TAU)), pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + (to - from) * i / steps, s = Math.sin(a), c = Math.cos(a);
    pos.push(s * inner, y, c * inner, s * outer, y, c * outer);
    nor.push(0, 1, 0, 0, 1, 0);
    if (i < steps) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), idx };
}

/** `n` short dashes round a ring. */
function dashes(b: Batch, inner: number, outer: number, n: number, share: number, y: number, colour: Colour): void {
  const step = TAU / n;
  for (let i = 0; i < n; i++) b.geometry(annulus(inner, outer, 3, i * step, i * step + step * share, y), colour, GLOW);
}

const MUTED = '#c9c4b8';
const CREAM = '#fff3c4';

export function spotMark(b: Batch, accent: Colour, available = true): void {
  if (!available) { dashes(b, 0.7, 0.76, 14, 0.5, 0.11, MUTED); return; }
  b.geometry(annulus(0.84, 0.98, 32, 0, TAU, 0.12), accent, GLOW);
  dashes(b, 0.6, 0.67, 12, 0.6, 0.115, CREAM);
  b.disc(0, 0.115, 0, 0.1, CREAM, { seg: 10, ...GLOW });
}
export function nearMark(b: Batch): void { b.geometry(annulus(1.0, 1.06, 36, 0, TAU, 0.13), '#ffffff', GLOW); }
export function rippleMark(b: Batch): void { b.geometry(annulus(0.86, 1, 28, 0, TAU, 0.1), '#ffffff', GLOW); }

export function pulse(t: number, reduced: boolean): number { return reduced ? 1 : 1 + Math.sin(t * 2.4) * 0.04; }

export const RIPPLE_MS = 700;
/** A ripple grows from 0.35 to 1.5 times its size and fades out over RIPPLE_MS; reduced motion shows it still, half bright, for a moment. */
export function rippleStep(ms: number, reduced: boolean): { scale: number; opacity: number; done: boolean } {
  const k = Math.min(1, Math.max(0, ms / RIPPLE_MS)), done = k >= 1;
  if (reduced) return { scale: 1, opacity: done ? 0 : 0.55, done };
  const ease = 1 - (1 - k) * (1 - k);
  return { scale: 0.35 + ease * 1.15, opacity: done ? 0 : (1 - k) * 0.9, done };
}
