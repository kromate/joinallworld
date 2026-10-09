// A tab left open across a deploy keeps its old JavaScript; its hashed chunks are gone from the host. When a lazy chunk fails to
// load, ask once whether the app was updated (the entry script of a fresh `/` differs from this page's own): if so a small banner
// offers a Reload, which only the player taps — a typed draft or a running activity is never lost to an automatic reload.
// If nothing changed the failure is an ordinary network one and the existing retry behaviour stands.
// A tab that never loads another chunk would otherwise never learn of an update (its old code does not even know the new screens exist), so the
// same check also runs, quietly, when the tab is shown again after a while and about every ten minutes while it stays visible
// (`watchForUpdates`): one small request for the home page, never more often, and never an automatic reload.
import { ref } from 'vue'

export type ChunkFailureDecision = 'reload-banner' | 'retry'

/** Pure: a failed import plus the build ids (or entry script URLs) of this page and of the host now. Unknown on either side means retry. */
export function decideChunkFailure({ failed, currentBuild, freshBuild }: { failed: boolean; currentBuild: string | null; freshBuild: string | null }): ChunkFailureDecision {
  if (!failed || !currentBuild || !freshBuild) return 'retry'
  return currentBuild === freshBuild ? 'retry' : 'reload-banner'
}

/** Whether an error is a failed dynamic import / module load (the wording differs by browser). */
export function isChunkLoadError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '')
  return /dynamically imported module|importing a module script failed|Unable to preload CSS/i.test(message)
}

/** The path of the module entry script in an HTML page ("/assets/app-AbC123.js"), or null. */
export function entryScriptOf(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (src) { try { return new URL(src, 'https://x.invalid').pathname } catch { return null } }
  }
  return null
}

/** True once the host is known to be serving a newer build than this page. */
export const updateAvailable = ref(false)

const RECHECK_MS = 60_000
let checking: Promise<void> | null = null
let lastNegative = -Infinity

/** Called on a failed import. Checks at most once at a time (and not again within a minute after a "not updated" answer). */
export function noteChunkFailure(fetcher: typeof fetch = globalThis.fetch.bind(globalThis), doc: Document | undefined = globalThis.document, now: () => number = Date.now): Promise<void> {
  if (updateAvailable.value || checking || now() - lastNegative < RECHECK_MS) return checking ?? Promise.resolve()
  checking = (async () => {
    try {
      if (await hostIsNewer(fetcher, doc)) updateAvailable.value = true
      else lastNegative = now()
    } catch { lastNegative = now() }
    finally { checking = null }
  })()
  return checking
}

/** Whether the host's home page names a different entry script than this page's own. Unknown on either side is "no". Throws when the host cannot be asked. */
async function hostIsNewer(fetcher: typeof fetch, doc: Document | undefined): Promise<boolean> {
  const current = doc ? entryScriptOf(Array.from(doc.querySelectorAll('script[type="module"]')).map((node) => node.outerHTML).join('')) : null
  const response = await fetcher('/', { cache: 'no-store', headers: { accept: 'text/html' } })
  const fresh = response.ok ? entryScriptOf(await response.text()) : null
  return Boolean(current && fresh && current !== fresh)
}

export function resetUpdateNotice(): void { updateAvailable.value = false; checking = null; lastNegative = -Infinity; lastLook = -Infinity }

/** The least time between two quiet looks. */
export const LOOK_EVERY_MS = 10 * 60_000
let lastLook = -Infinity

/**
 * Look, now and then, whether the host serves a newer build than this page: when the tab comes back into view and on a slow timer while it is
 * visible. Never while hidden, never more than once per LOOK_EVERY_MS, and it stops once the banner is up. Returns a function that stops it.
 */
export function watchForUpdates(doc: Document = globalThis.document, fetcher: typeof fetch = globalThis.fetch.bind(globalThis), now: () => number = Date.now, every = LOOK_EVERY_MS): () => void {
  lastLook = now() // the page has just loaded: it is current
  const look = (): void => {
    if (updateAvailable.value || doc.visibilityState === 'hidden' || now() - lastLook < every) return
    lastLook = now()
    void noteChunkFailure(fetcher, doc, now)
  }
  doc.addEventListener('visibilitychange', look)
  const timer = setInterval(look, every)
  return () => { doc.removeEventListener('visibilitychange', look); clearInterval(timer) }
}
