/** A transport open alone does not prove the authenticated service recovered. */
export const STABLE_CONNECTION_MS = 30000
export function reconnectDelay(attempt: number, baseMs: number, capMs: number): number {
  return Math.floor(Math.random() * Math.min(capMs, baseMs * 2 ** attempt))
}
