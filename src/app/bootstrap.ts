import { STORAGE_KEY } from '../storage-key.ts'
import { warmLanding } from './features/start/warmLanding.ts'
import type { Component } from 'vue'

export interface LoadedGame { default: Component; ready(): void }

import { initialCity } from '../storage-city.ts'
export { initialCity } from '../storage-city.ts'

function savedState(raw: string): unknown {
  try { const saved: unknown = JSON.parse(raw); return typeof saved === 'object' && saved !== null ? (saved as { state?: unknown }).state : null } catch { return null }
}

const FAILED_KEY = 'joinallworld-boot-failed'
export function bootFailed(): boolean { try { return globalThis.sessionStorage.getItem(FAILED_KEY) === '1' } catch { return false } }
export function noteBootResult(failed: boolean): void { try { if (failed) globalThis.sessionStorage.setItem(FAILED_KEY, '1'); else globalThis.sessionStorage.removeItem(FAILED_KEY) } catch { /* private mode */ } }

export async function loadGame(): Promise<LoadedGame> {
  warmLanding() // a device that has never played opens on the landing: fetch its code now, beside the city and the shell
  const { isCityId, loadCityContent } = await import('../game/cities/registry.ts')
  const { loadLifeCities } = await import('../game/cities/lifeCities.ts')
  let cached: string | null = null
  try { cached = globalThis.localStorage.getItem(STORAGE_KEY) } catch { /* The server session can still restore the character. */ }
  // A first attempt in this tab already failed ("Try again"): the saved copy is dropped and the server's answer is used.
  if (cached !== null && bootFailed()) { try { globalThis.localStorage.removeItem(STORAGE_KEY) } catch { /* nothing more to do */ } cached = null }
  if (cached !== null) {
    // Every city the saved life refers to is loaded before it is rebuilt. When one cannot be, the saved copy is dropped
    // and the server's answer is waited for instead (the session cookie is not touched).
    let usable = false
    try { usable = (await loadLifeCities(savedState(cached), [initialCity(cached, isCityId)])).length === 0 } catch { /* dropped below */ }
    if (!usable) { try { globalThis.localStorage.removeItem(STORAGE_KEY) } catch { /* nothing more to do */ } cached = null }
  }
  await loadCityContent(initialCity(cached, isCityId))
  return import('./startApp.ts')
}
