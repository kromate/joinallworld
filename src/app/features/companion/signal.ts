// What the companion tells the rest of the page: a window event the sound system listens for (src/audio/engine.ts). Part of the companion's own chunk.
/** Emitted as the window event `jaw:companion` with { kind, ...detail }. */
export function signal(kind: string, detail: Record<string, unknown> = {}): void {
  try { globalThis.window?.dispatchEvent(new CustomEvent('jaw:companion', { detail: { kind, ...detail } })) } catch { /* nothing is listening */ }
}
