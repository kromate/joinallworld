// What a short address asked for, kept for the visit: the place or game an address named (`/games`, `/abuja`, …) waits here
// until the player has a life to take there, so signing up, choosing a look or reloading in between never loses it.
//
// KEPT IN THIS TAB (sessionStorage, key allworld-path): { path, at, via? } — the canonical address (src/paths.ts reads it
// again), when it was kept, and `via: 'landing'` when the visitor started their life from the landing's own "Start in …" button
// (so the life already stands where the address pointed). It expires after 30 minutes. It is not a credential and holds no
// position: only a path from the fixed table.
import { shallowRef } from 'vue'
import { parsePath, pathOf } from '../../../paths.ts'
import type { PathIntent } from '../../../paths.ts'

export const INTENT_KEY = 'allworld-path'
export const INTENT_KEEP_MS = 30 * 60 * 1000

interface Kept { path: string; at: number; via?: 'landing' }
export interface WaitingIntent { intent: PathIntent; via: 'landing' | null; at: number }

let memory: Kept | null = null
const store = (): Storage | null => { try { return globalThis.sessionStorage ?? null } catch { return null } }

/** What is waiting for a life (reactive, for the landing's own line). */
export const waiting = shallowRef<PathIntent | null>(null)

function write(kept: Kept | null): void {
  memory = kept
  try { if (kept) store()?.setItem(INTENT_KEY, JSON.stringify(kept)); else store()?.removeItem(INTENT_KEY) } catch { /* kept in memory for this visit */ }
}

/** The intent kept for this tab, or null (nothing kept, an address that is no longer in the table, or older than 30 minutes). */
export function readIntent(now = Date.now()): WaitingIntent | null {
  let kept: Kept | null = memory
  try { const text = store()?.getItem(INTENT_KEY); if (text) kept = JSON.parse(text) as Kept } catch { /* the memory copy */ }
  if (!kept || typeof kept.path !== 'string' || typeof kept.at !== 'number') return null
  if (!(now - kept.at < INTENT_KEEP_MS)) { write(null); return null }
  const intent = parsePath(kept.path)
  return intent ? { intent, via: kept.via === 'landing' ? 'landing' : null, at: kept.at } : null
}

/** Keep an intent (it replaces an older one) and show it on the landing. */
export function keepIntent(intent: PathIntent, via: 'landing' | null = null, now = Date.now()): void {
  write({ path: pathOf(intent), at: now, ...(via ? { via } : {}) })
  waiting.value = intent
}
/** The landing started the life: the intent stays, marked as already reached by the start itself. */
export function markLanding(now = Date.now()): void {
  const kept = readIntent(now)
  if (kept) write({ path: pathOf(kept.intent), at: kept.at, via: 'landing' })
}
/** The intent was carried out (or given up). */
export function forgetIntent(): void { write(null); waiting.value = null }
