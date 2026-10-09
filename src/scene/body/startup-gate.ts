/** Retryable, render-driven gate for importing the venue's optional stand-in module. */
export interface RetryableStartup {
  readonly pending: boolean;
  start<T>(eligible: boolean, load: () => Promise<T>, ready: (value: T) => void, failed?: (error: unknown) => void): boolean;
  dispose(): void;
}

export function createRetryableStartup(options: { cooldownMs?: number; now?: () => number } = {}): RetryableStartup {
  const cooldownMs = Number.isFinite(options.cooldownMs) ? Math.max(0, options.cooldownMs!) : 2_000;
  const now = options.now ?? Date.now;
  let disposed = false, pending = false, retryAt = 0;
  return {
    get pending() { return pending; },
    start<T>(eligible, load, ready, failed) {
      if (disposed || pending || !eligible || now() < retryAt) return false;
      pending = true;
      void Promise.resolve().then(load).then(value => {
        if (disposed) {
          const disposable = value as { dispose?: () => void } | null;
          disposable?.dispose?.();
          return;
        }
        ready(value);
      }).catch(error => {
        if (disposed) return;
        retryAt = now() + cooldownMs;
        failed?.(error);
      }).finally(() => { pending = false; });
      return true;
    },
    dispose() { disposed = true; },
  };
}
