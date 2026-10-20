/**
 * OWNER: scenes
 * Street life: counts that follow the frame governor's verdict (zoom phase 3b; phase 7 of the open-source plan). Pure.
 *
 * The frame governor (src/scene/governor.ts) owns the measuring: one ring of frame gaps, one p90, one judgement. Pixels are tried
 * first (it lowers the render scale), and only when the scale cannot help (it is at its floor, or lowering it bought nothing) does it
 * say `pressed`. Then, and only then, the people and vehicles drawn shrink to ADAPT_SHRINK of what they were (never under ADAPT_FLOOR of
 * the start), once for each fresh look the governor takes.
 *
 * Counts used to only ever shrink in a scene. Now they come back: after the governor has held full scale for ADAPT_GROW_SECONDS
 * without a slow look, the counts grow one step toward the start. If that makes the street slow again within ADAPT_BACKOFF_SECONDS,
 * the next growth waits twice as long (up to ADAPT_GROW_MAX_SECONDS), so a device on the edge settles instead of flipping.
 * The frame guard (plan.ts) stays the last resort: a mean over 42 ms or a stall drops street life altogether.
 *
 * Without a governor (a test, the street harness) nothing is judged and the counts stay as planned.
 *
 * `?streetperf=1` shows a small readout of the governor's p90, its render scale and the counts (readoutText), for timing on a real phone.
 */
import { activeVerdict } from '../governor.ts';
import type { GovernorVerdict } from '../governor.ts';

export const ADAPT_SHRINK = 0.7, ADAPT_FLOOR = 0.25;
/** Seconds at full render scale (and quiet) before the counts grow a step; the quickest return, and the longest wait after repeated misses. */
export const ADAPT_GROW_SECONDS = 5, ADAPT_GROW_MAX_SECONDS = 80;
/** A shrink within this long of a growth means the growth was too much: the next one waits twice as long. */
export const ADAPT_BACKOFF_SECONDS = 10;

export interface Caps { crowd: number; vehicles: number }

/** One step down: ADAPT_SHRINK of each count, never under ADAPT_FLOOR of the start (at least one when the start had any), never up. */
export function shrinkCaps(caps: Caps, start: Caps): Caps {
  const one = (now: number, first: number): number => {
    if (!(first > 0)) return 0;
    const floor = Math.max(1, Math.ceil(first * ADAPT_FLOOR));
    return Math.min(now, Math.max(floor, Math.floor(now * ADAPT_SHRINK)));
  };
  return { crowd: one(caps.crowd, start.crowd), vehicles: one(caps.vehicles, start.vehicles) };
}

/** One step back up: the count that ADAPT_SHRINK would have come down from (at least one more), never over the start. */
export function growCaps(caps: Caps, start: Caps): Caps {
  const one = (now: number, first: number): number => (now >= first ? first : Math.min(first, Math.max(now + 1, Math.ceil(now / ADAPT_SHRINK))));
  return { crowd: one(caps.crowd, start.crowd), vehicles: one(caps.vehicles, start.vehicles) };
}

export interface AdaptiveCaps {
  /** Called once per street frame (the gap is the governor's business now). Returns the new caps when they changed, else null. */
  frame(dtSeconds?: number): Caps | null
  /** A new window of frames. The governor owns the window now, so there is nothing to forget here (the caps stay). */
  reset(): void
  readonly caps: Caps
  /** The governor's p90 of the frame gaps (ms), or null before its first look or without a governor. */
  readonly average: number | null
  readonly shrinks: number
  readonly grows: number
}

export function createAdaptiveCaps(start: Caps, read: () => GovernorVerdict | null = activeVerdict): AdaptiveCaps {
  const first: Caps = { crowd: Math.max(0, Math.floor(start.crowd)), vehicles: Math.max(0, Math.floor(start.vehicles)) };
  let caps: Caps = { ...first }, shrinks = 0, grows = 0, seen = -1, growWait = ADAPT_GROW_SECONDS, changedAt = -Infinity, grewAt = -Infinity;
  const below = (): boolean => caps.crowd < first.crowd || caps.vehicles < first.vehicles;
  return {
    get caps() { return caps; },
    get average() { return read()?.p90 ?? null; },
    get shrinks() { return shrinks; },
    get grows() { return grows; },
    reset() { /* the governor holds the frames */ },
    frame() {
      const verdict = read();
      // Each look of the governor is acted on once.
      if (!verdict || verdict.seq === seen) return null;
      seen = verdict.seq;
      if (verdict.pressed) {
        const next = shrinkCaps(caps, first);
        if (next.crowd === caps.crowd && next.vehicles === caps.vehicles) return null;
        if (verdict.clock - grewAt < ADAPT_BACKOFF_SECONDS) growWait = Math.min(ADAPT_GROW_MAX_SECONDS, growWait * 2);
        caps = next; shrinks += 1; changedAt = verdict.clock;
        return caps;
      }
      if (!verdict.slow && below() && verdict.fullSeconds >= ADAPT_GROW_SECONDS && verdict.clock - changedAt >= growWait) {
        caps = growCaps(caps, first); grows += 1; changedAt = grewAt = verdict.clock;
        return caps;
      }
      return null;
    },
  };
}

/** The timing readout's switch: `?streetperf=1` (or on / true). */
export function perfFlag(search = ''): boolean {
  let value: string | null = null;
  try { value = new URLSearchParams(search).get('streetperf'); } catch { value = null; }
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'on' || v === 'true';
}
export const pagePerf = (): boolean => perfFlag((globalThis.location as { search?: string } | undefined)?.search ?? '');

/** The readout's one line. `scale` is the governor's render scale (the verdict's, when not given). */
export function readoutText(s: { average: number | null; people: number; vehicles: number; shrinks: number; triangles: number; grows?: number; scale?: number }): string {
  const ms = s.average === null ? '…' : s.average.toFixed(1);
  const scale = s.scale ?? activeVerdict()?.scale;
  return `street ${ms} ms p90 · ${scale === undefined ? '' : `scale ${scale.toFixed(1)} · `}${s.people} people · ${s.vehicles} vehicles · ${s.triangles} tris${s.shrinks ? ` · shrunk ×${s.shrinks}` : ''}${s.grows ? ` · grown ×${s.grows}` : ''}`;
}
