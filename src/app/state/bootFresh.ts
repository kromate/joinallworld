// "Start fresh" for a loading screen that has been stuck for 40 s: it clears what this site keeps on the device for loading (its service worker and Cache Storage), and the caller reloads.
// It never touches localStorage or cookies: the guest identity lives there, and the player's progress is saved on the server.
// Fetched with a dynamic import when the 40 s stage is reached, so none of it is in the first download.
export const FRESH_WORDS = {
  note: 'Still not opening? Start fresh clears saved files on this device and reloads. Your progress is saved on the server.',
  fresh: 'Start fresh',
  clearing: 'Clearing…',
} as const

export interface FreshEnv {
  serviceWorker?: { getRegistrations(): Promise<readonly { unregister(): Promise<boolean> }[]> } | undefined
  caches?: { keys(): Promise<string[]>; delete(key: string): Promise<boolean> } | undefined
}

/** Remove this site's service workers and cached files. A step that fails is skipped: the reload that follows must always happen. */
export async function startFresh(env: FreshEnv): Promise<{ workers: number; caches: number }> {
  let workers = 0, cleared = 0
  try { for (const registration of (await env.serviceWorker?.getRegistrations()) ?? []) { if (await registration.unregister().catch(() => false)) workers += 1 } } catch { /* none to remove */ }
  try { for (const key of (await env.caches?.keys()) ?? []) { if (await env.caches?.delete(key).catch(() => false)) cleared += 1 } } catch { /* none to remove */ }
  return { workers, caches: cleared }
}
