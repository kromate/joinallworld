/**
 * A lazily loaded piece of the client (a code chunk) that may fail to arrive, with a truthful
 * state and bounded retries. Pure: no DOM, timers are injectable.
 *
 *   const piece = createLazyLoader(() => import('./community.ts'), { onState });
 *   const module = await piece.load();   // the loaded value, or null if it is not available (yet)
 *
 * STATE  piece.state = { status, attempt, attempts, retryInMs, error }
 *   'idle'      nothing asked for yet
 *   'loading'   an attempt is in flight
 *   'ready'     loaded; load() returns the value at once from now on
 *   'retrying'  the last attempt failed; the next one starts by itself in `retryInMs`
 *   'failed'    every automatic retry has been used; only an explicit load() tries again
 * RETRIES  After a failed attempt the next starts after RETRY_DELAYS_MS[n]: 1 s, 2 s, 4 s, 8 s,
 *   16 s (doubling, capped at 30 s if the list is longer) — five automatic retries, six attempts in
 *   all, about half a minute — and then it STOPS: a chunk that will not load is not requested
 *   for ever. Calling load() while it is waiting or failed tries again immediately (a manual retry)
 *   and, after 'failed', starts a new round of automatic retries. A load() while an attempt is in
 *   flight joins that attempt; it never starts a second one.
 * onState(state) is called on every change, so the caller can say what is true: loading, will
 * retry in N seconds, or not available until the player retries.
 */
export const RETRY_DELAYS_MS: readonly number[] = Object.freeze([1000, 2000, 4000, 8000, 16000]);
export const MAX_RETRY_DELAY_MS = 30000;

export type LazyStatus = 'idle' | 'loading' | 'ready' | 'retrying' | 'failed'
export interface LazyState { status: LazyStatus; attempt: number; attempts: number; retryInMs: number | null; error: string | null }
/** The timer functions, injectable: a handle is whatever `setTimeout` returns. */
export interface LazyOptions {
  delays?: readonly number[]
  onState?: (state: LazyState) => void
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (handle: never) => void
}
export interface LazyLoader<T> {
  state: LazyState
  readonly value: T | undefined
  /** Stop: no further automatic retry. A later load() starts again. */
  stop(): void
  /** The loaded value, or null if it is not available (yet). */
  load(): Promise<T | null>
}

export function createLazyLoader<T>(load: () => T | Promise<T>, { delays = RETRY_DELAYS_MS, onState = () => {}, setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout }: LazyOptions = {}): LazyLoader<T> {
  let value: T | undefined, timer: unknown = null, inFlight: Promise<T | null> | null = null, failures = 0, stopped = false;
  const cancelTimer = cancel as (handle: unknown) => void;
  const loader: LazyLoader<T> = {
    state: { status: 'idle', attempt: 0, attempts: delays.length + 1, retryInMs: null, error: null },
    get value() { return value; },
    stop() { stopped = true; if (timer !== null) { cancelTimer(timer); timer = null; } },
    load() {
      if (loader.state.status === 'ready') return Promise.resolve(value as T);
      stopped = false;
      if (loader.state.status === 'failed') failures = 0; // an explicit retry earns a new round of automatic ones
      return attempt();
    },
  };
  function set(status: LazyStatus, extra: Partial<LazyState> = {}): void {
    loader.state = { status, attempt: failures + (status === 'loading' ? 1 : 0), attempts: delays.length + 1, retryInMs: null, error: null, ...extra };
    try { onState(loader.state); } catch { /* a listener must not break loading */ }
  }
  function attempt(): Promise<T | null> {
    if (inFlight) return inFlight;
    if (timer !== null) { cancelTimer(timer); timer = null; }
    set('loading');
    inFlight = Promise.resolve().then(load).then((loaded) => {
      inFlight = null; value = loaded; failures = 0;
      set('ready');
      return loaded;
    }, (error) => {
      inFlight = null; failures += 1;
      const message = String((error as { message?: unknown } | null)?.message ?? error).split('\n')[0];
      if (stopped || failures > delays.length) { set('failed', { attempt: failures, error: message }); return null; }
      const wait = Math.min(delays[failures - 1] as number, MAX_RETRY_DELAY_MS);
      set('retrying', { attempt: failures, retryInMs: wait, error: message });
      timer = later(() => { timer = null; void attempt(); }, wait);
      return null;
    });
    return inFlight;
  }
  return loader;
}
