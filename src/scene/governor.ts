/**
 * OWNER: scenes
 * The frame governor (phase 7, idea 17). Pure: it is fed the gap between two drawn frames and answers with a render scale.
 *
 * What it does, in plain words
 *   - It keeps the last 90 frame gaps. After 45 of them it looks at the p90 (the gap 9 frames in 10 beat).
 *   - Over 21 ms: the picture is drawn at 0.1 less of the tier's pixel ratio (never under 0.6). The frames drawn at the old
 *     scale are forgotten, so the next look judges the new scale alone.
 *   - After a step down, if the next look is hardly better (p90 under 5 % lower), the scale was not the problem (the device is
 *     limited by script or by geometry, not by pixels): the step is undone and the verdict says `pressed`, which is what
 *     street-life/adaptive.ts reads to draw fewer people. A device that cannot be helped by blur is never left blurred.
 *   - After a run of clean frames (45 at first) it probes back up by 0.1. A probe that misses is undone and the run needed
 *     before the next probe doubles (up to 16 times the first wait); a probe that holds halves it again.
 *   - A lone gap over 150 ms (a shader link, a texture upload, a scene being built) is ignored. Two in a row are a real slow
 *     spell and count. A gap over a second is the page being hidden or idle, not a frame: it is dropped.
 *   - `reset()` when a scene is rebuilt: the old gaps and the "scale does not help" finding are forgotten (the scale stays), and the
 *     scene's first two seconds, which are busy with its own start, are not judged.
 *   - `?scale=0.8` in the address (scaleFromSearch) fixes the scale and the governor never moves it: for measuring.
 *
 * It never touches a renderer. The host applies the scale it reports with renderer.setPixelRatio(base * scale) and resizes the
 * post stack. Nothing here asks for frames: the host feeds it from the frames its own loop draws (the battery rule is untouched).
 */

/** A frame slower than this missed 48 Hz; the p90 is judged against it. */
export const SLOW_MS = 21;
export const GOVERNOR_RING = 90, GOVERNOR_LOOK = 45;
export const SCALE_STEP = 0.1, SCALE_MIN = 0.6;
/** A gap over this, alone, is a stall (a link, an upload, a build) and not the speed of the device. */
export const LONE_MS = 150;
/** A gap over this is not a frame: the page was hidden, or the loop had stopped and started again. */
export const PAUSE_MS = 1000;
/** The first gaps after a scale change carry the work of resizing the buffers: not counted. */
export const GOVERNOR_SKIP = 3;
/** A scene that was just rebuilt is busy for a while (textures uploaded in slices, people streamed in, the shaders linked): its first seconds are not judged. */
export const SETTLE_SECONDS = 2;
/** A step down that lowers the p90 by less than this share bought nothing. */
export const MIN_GAIN = 0.05;
/** The clean frames needed before a probe up: the first wait, and the most it grows to. */
export const PROBE_FRAMES = 45, PROBE_FRAMES_MAX = 45 * 16;

export interface GovernorVerdict {
  /** Share of the tier's pixel ratio to draw at: 0.6 to 1. */
  readonly scale: number
  /** The last look found the p90 over SLOW_MS. */
  readonly slow: boolean
  /** Slow, and the render scale cannot help (it is at the floor, or lowering it bought nothing): the street should draw less. */
  readonly pressed: boolean
  /** Seconds the picture has been drawn at full scale without a slow look. 0 below full scale. */
  readonly fullSeconds: number
  /** Counts the looks; changes whenever the governor has judged a fresh run of frames. */
  readonly seq: number
  /** Seconds of frames seen (a clock for the readers: it only moves when frames do). */
  readonly clock: number
  /** The p90 of the last look (ms), or null before the first. */
  readonly p90: number | null
}

export interface Governor {
  /** Feed the gap since the last drawn frame (ms). Returns the new scale when it changed, else null. */
  frame(gapMs: number): number | null
  /** A scene was rebuilt: forget the gaps and the finding that the scale does not help. The scale stays. */
  reset(): void
  readonly scale: number
  readonly locked: boolean
  readonly verdict: GovernorVerdict
  /** The p90 of the gaps held (ms), or null before any look. */
  readonly p90: number | null
}

export interface GovernorOptions {
  /** Fix the scale (0.25 to 1) and never move it. */
  locked?: number | null
  min?: number
  /** Seconds of a new scene's frames not judged (SETTLE_SECONDS); tests use 0. */
  settleSeconds?: number
}

/** `?scale=0.8` → 0.8 (clamped to 0.25..1); anything else → null. */
export function scaleFromSearch(search = ''): number | null {
  let value: string | null = null;
  try { value = new URLSearchParams(search).get('scale'); } catch { value = null; }
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(1, Math.max(0.25, n)) : null;
}
export const pageScale = (): number | null => scaleFromSearch((globalThis.location as { search?: string } | undefined)?.search ?? '');

const roundScale = (level: number): number => Math.round((1 - level * SCALE_STEP) * 100) / 100;

export function createGovernor({ locked = null, min = SCALE_MIN, settleSeconds = SETTLE_SECONDS }: GovernorOptions = {}): Governor {
  const fixed = locked !== null && Number.isFinite(locked) ? Math.min(1, Math.max(0.25, locked)) : null;
  const deepest = Math.max(0, Math.round((1 - Math.max(0.25, Math.min(1, min))) / SCALE_STEP));
  const ring = new Float64Array(GOVERNOR_RING), sorted = new Float64Array(GOVERNOR_RING);
  let write = 0, held = 0, skip = GOVERNOR_SKIP, settle = settleSeconds, lastLong = false, clean = 0;
  // level 0 is full scale; each level is SCALE_STEP lower.
  let level = 0, last: 'none' | 'down' | 'up' = 'none', before = 0;
  let futile = false, probeWait = PROBE_FRAMES, slow = false, pressed = false, seq = 0, clock = 0, fullFor = 0, p90: number | null = null;

  const forget = (): void => { write = 0; held = 0; clean = 0; lastLong = false; skip = GOVERNOR_SKIP; };
  const look = (): number => {
    const view = sorted.subarray(0, held);
    view.set(ring.subarray(0, held));
    view.sort();
    return view[Math.min(held - 1, Math.floor(held * 0.9))]!;
  };

  const governor: Governor = {
    get scale() { return fixed ?? roundScale(level); },
    get locked() { return fixed !== null; },
    get p90() { return p90; },
    get verdict() { return { scale: governor.scale, slow, pressed, fullSeconds: level === 0 && fixed === null ? fullFor : 0, seq, clock, p90 }; },
    reset() { forget(); futile = false; last = 'none'; slow = false; pressed = false; settle = settleSeconds; },
    frame(gapMs) {
      if (fixed !== null) return null;
      if (!(gapMs > 0) || !Number.isFinite(gapMs) || gapMs > PAUSE_MS) { lastLong = false; clean = 0; return null; }
      if (gapMs > LONE_MS) {
        // One long gap is a stall; a second one straight after is the device.
        if (!lastLong) { lastLong = true; return null; }
      } else lastLong = false;
      if (skip > 0) { skip -= 1; return null; }
      if (settle > 0) { settle -= gapMs / 1000; return null; }
      clock += gapMs / 1000; fullFor += level === 0 ? gapMs / 1000 : 0;
      ring[write] = gapMs; write = (write + 1) % GOVERNOR_RING; held = Math.min(held + 1, GOVERNOR_RING);
      clean = gapMs > SLOW_MS ? 0 : clean + 1;
      if (held < GOVERNOR_LOOK) return null;

      const seen = look(); p90 = seen; seq += 1;
      slow = seen > SLOW_MS;
      if (!slow) {
        pressed = false;
        // A probe that held makes the next one come sooner; a step down that settled is just the new level.
        if (last === 'up') probeWait = Math.max(PROBE_FRAMES, Math.floor(probeWait / 2));
        last = 'none';
        if (level > 0 && clean >= probeWait) {
          level -= 1; last = 'up'; fullFor = 0; forget();
          return governor.scale;
        }
        return null;
      }
      // Slow. A probe that missed goes back down, and the next one waits twice as long.
      fullFor = 0;
      if (last === 'up') {
        probeWait = Math.min(PROBE_FRAMES_MAX, probeWait * 2);
        level += 1; last = 'down'; before = seen; pressed = false; forget();
        return governor.scale;
      }
      // A step down that did not help is undone, and the street is told to draw less instead.
      if (last === 'down' && seen > before * (1 - MIN_GAIN)) {
        futile = true; level = Math.max(0, level - 1); last = 'none'; pressed = true; forget();
        return governor.scale;
      }
      if (!futile && level < deepest) {
        level += 1; last = 'down'; before = seen; pressed = false; forget();
        return governor.scale;
      }
      // At the floor, or known not to help: the street's turn. Start a fresh run so the next look judges new frames.
      pressed = true; last = 'none'; forget();
      return null;
    },
  };
  return governor;
}

// ---- who is reading ------------------------------------------------------------------------------------------------------
// street-life/adaptive.ts reads the verdict of the governor the scene host runs, so there is one judgement of the frame time and one
// ring of gaps. The host sets itself here when it is made and clears itself when it goes.
let active: Governor | null = null;
export function setActiveGovernor(next: Governor | null): void { active = next; }
/** The host is going: stop being the one the street reads (unless another host has taken over since). */
export function releaseGovernor(old: Governor): void { if (active === old) active = null; }
/** The verdict of the governor the host runs, or null when there is none (a test, a harness). */
export function activeVerdict(): GovernorVerdict | null { return active ? active.verdict : null; }
