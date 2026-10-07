// When Allworld is slow to open (a phone on weak mobile data is the usual reason), the loading screen says so and, later, offers a way out.
//   after 15 s   "taking longer than usual": the player knows it is the network, not a frozen page
//   after 40 s   a "Start fresh" button (bootFresh.ts, fetched only when this stage is reached so the first download stays small)
// Times are counted from when the page began loading (performance.now()), so a slow download of the first script counts too.
// A failed chunk while the page is still opening reloads by itself, at most RELOAD_MAX times in RELOAD_WINDOW_MS; after that the player is asked.
export type BootStage = 'loading' | 'slow' | 'fresh'
export const SLOW_AFTER_MS = 15_000
export const FRESH_AFTER_MS = 40_000
export const RELOAD_MAX = 3
export const RELOAD_WINDOW_MS = 180_000
export const RELOAD_KEY = 'joinallworld-boot-reloads'

export const BOOT_WORDS = {
  loading: 'Opening Allworld…',
  slow: 'This is taking longer than usual. Your network may be slow. Still trying…',
} as const

export const bootStage = (elapsedMs: number): BootStage => (elapsedMs >= FRESH_AFTER_MS ? 'fresh' : elapsedMs >= SLOW_AFTER_MS ? 'slow' : 'loading')

/** Milliseconds until the stage changes, or null once the last stage has been reached. */
export const nextStageIn = (elapsedMs: number): number | null => (elapsedMs < SLOW_AFTER_MS ? Math.ceil(SLOW_AFTER_MS - elapsedMs) : elapsedMs < FRESH_AFTER_MS ? Math.ceil(FRESH_AFTER_MS - elapsedMs) : null)

type Memory = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Whether one more automatic reload is allowed now, and if so it is recorded. The record is kept in sessionStorage so it survives
 * the reload itself; where that is unavailable the answer is no, because an unrecorded reload could repeat for ever.
 */
export function takeAutoReload(memory: Memory | null, now: number): boolean {
  if (!memory) return false
  try {
    const parsed: unknown = JSON.parse(memory.getItem(RELOAD_KEY) ?? '[]')
    const recent = (Array.isArray(parsed) ? parsed : []).filter((at): at is number => typeof at === 'number' && at <= now && now - at < RELOAD_WINDOW_MS)
    if (recent.length >= RELOAD_MAX) return false
    memory.setItem(RELOAD_KEY, JSON.stringify([...recent, now]))
    return true
  } catch { return false }
}
