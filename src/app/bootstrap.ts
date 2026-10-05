import { STORAGE_KEY } from '../storage-key.ts'
import { warmLanding } from './features/start/warmLanding.ts'
import type { Component } from 'vue'

export interface LoadedGame { default: Component; ready(): void }

import { initialCity } from '../storage-city.ts'
export { initialCity } from '../storage-city.ts'

export async function loadGame(): Promise<LoadedGame> {
  warmLanding() // a device that has never played opens on the landing: fetch its code now, beside the city and the shell
  const { isCityId, loadCityContent } = await import('../game/cities/registry.ts')
  let cached: string | null = null
  try { cached = globalThis.localStorage.getItem(STORAGE_KEY) } catch { /* The server session can still restore the character. */ }
  await loadCityContent(initialCity(cached, isCityId))
  return import('./startApp.ts')
}
