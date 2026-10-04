/**
 * OWNER: scenes
 * THE ONLY FRAME LOOP IN THE GAME'S SCENES — and it is not allowed to idle.
 *
 * BATTERY RULE: a scene is drawn on demand. A frame loop may run only while there is live input
 * or motion in progress (a movement key or the joystick is held, the avatar is walking to a
 * target, the camera is still easing after a drag or a zoom). The loop below has no way to run
 * otherwise: every frame asks its owner "is anything still moving?" and it ends itself on the
 * first "no". It also ends when the page is hidden. src/venue-world.test.ts proves: idle → zero
 * frames; walking → frames; arrived → flat again; hidden → stopped. This file is the single
 * place in src/scene, src/ui and the host that may name the browser's frame callback.
 */

/**
 *   loop.wake()    start it (no-op when running, hidden, or when the platform has no frame callback)
 *   loop.stop()
 *   loop.running / loop.frames / loop.available
 * tick(dt) → true to keep going. The loop stops itself the moment tick returns false, and when the
 * page is hidden; onHidden() lets the owner drop held input, and onVisible() lets it resume a
 * motion that was cut short (it must call wake() itself — the loop never restarts on its own).
 */
/** The slice of `document` the loop uses (tests pass a stub). */
export interface MotionDocument {
  visibilityState?: string;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}
export interface MotionLoopOptions {
  onHidden?: () => void;
  onVisible?: () => void;
  request?: ((callback: (time: number) => void) => number) | undefined;
  cancel?: ((handle: number) => void) | undefined;
  doc?: MotionDocument | null | undefined;
  clock?: () => number;
}
export interface MotionLoop {
  running: boolean;
  frames: number;
  available: boolean;
  wake(): boolean;
  stop(): void;
  dispose(): void;
}
export function createMotionLoop(tick: (dt: number) => boolean | void, { onHidden, onVisible, request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame, doc = globalThis.document, clock = () => globalThis.performance.now() }: MotionLoopOptions = {}): MotionLoop {
  let handle: number | null = null, last = 0, queued = false;
  const hidden = () => doc?.visibilityState === 'hidden';
  const loop: MotionLoop = {
    running: false, frames: 0,
    available: typeof request === 'function',
    wake() {
      if (loop.running || !loop.available || hidden()) return loop.running;
      loop.running = true; last = clock();
      // A callback that could not be cancelled is still on its way: it will do, never ask for a second one.
      if (!queued) { queued = true; handle = request!(frame); }
      return true;
    },
    stop() {
      if (queued && typeof cancel === 'function') { cancel(handle!); queued = false; }
      handle = null; loop.running = false;
    },
    dispose() { loop.stop(); doc?.removeEventListener?.('visibilitychange', onVisibility); },
  };
  function frame(time: number) {
    queued = false; handle = null;
    if (!loop.running) return;
    const at = Number.isFinite(time) ? time : clock();
    const dt = Math.max(0, Math.min(0.05, (at - last) / 1000));
    last = at; loop.frames += 1;
    let more = false;
    try { more = tick(dt) === true; } catch (error) { console.error('Scene motion stopped:', error); }
    if (more && loop.running && !hidden()) { queued = true; handle = request!(frame); } else loop.running = false;
  }
  function onVisibility() { if (hidden()) { loop.stop(); onHidden?.(); } else onVisible?.(); }
  doc?.addEventListener?.('visibilitychange', onVisibility);
  return loop;
}
