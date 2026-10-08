/** Coalesce redraws; a moving camera requests another frame only until damping settles. */
export function createDemandFrames(options: {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
  draw: () => boolean;
}): { invalidate(): void; dispose(): void } {
  let pending: number | null = null;
  let disposed = false;
  function invalidate() {
    if (disposed || pending !== null) return;
    pending = options.request(() => {
      pending = null;
      if (!disposed && options.draw()) invalidate();
    });
  }
  return { invalidate, dispose() { disposed = true; if (pending !== null) options.cancel(pending); pending = null; } };
}
