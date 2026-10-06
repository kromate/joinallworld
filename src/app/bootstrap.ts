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
  if (cached !== null) {
    // Every referenced city's rules and the current city's content must arrive before reconstruction. A failed download
    // leaves the saved copy untouched, so retrying can never trade homes or money for an empty preview.
    await loadLifeCities(savedState(cached), [initialCity(cached, isCityId)])
  } else await loadCityContent(initialCity(cached, isCityId))
  return import('./startApp.ts')
}
