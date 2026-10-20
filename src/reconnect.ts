/** A transport open alone does not prove the authenticated service recovered. */
export const STABLE_CONNECTION_MS = 30000
export function reconnectDelay(attempt: number, baseMs: number, capMs: number): number {
  return Math.floor(Math.random() * Math.min(capMs, baseMs * 2 ** attempt))
}

/** Call `retry` when the network comes back or the tab is shown again. Returns a function that stops listening. */
export function onWake(retry: () => void, win: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined = globalThis.window, doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'> | undefined = globalThis.document): () => void {
  const shown = (): void => { if (!doc?.hidden) retry() }
  win?.addEventListener('online', retry)
  doc?.addEventListener('visibilitychange', shown)
  return () => { win?.removeEventListener('online', retry); doc?.removeEventListener('visibilitychange', shown) }
}
