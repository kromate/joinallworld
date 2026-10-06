// Who shows a location-confirmed badge, for the players on screen (docs/LOCATION.md). A badge is a fact about a past moment kept
// by the server, so the feed asks about the players a screen shows (never a position, never "who is near") in batches, and again
// every REFRESH_MS while any is shown, so a badge switched off disappears without a reload.
import { reactive } from 'vue'
import type { WorldBadge, WorldBadgesResponse } from '../../../types/world.ts'
import type { FetchJson } from '../../types/client.ts'

/** The most players one request asks about (the server refuses more). */
export const BADGE_BATCH = 40
/** How often the players on screen are asked about again. */
export const REFRESH_MS = 20000
/** The wait that lets the badges of a whole list go in one request. */
const GATHER_MS = 60

/** What is known: a badge, or null for "asked, none". An id never asked about is absent. */
export const badgeCache = reactive<Record<string, WorldBadge | null>>({})

export interface FeedDeps {
  fetchJson: FetchJson
  connected(): boolean
  visible?(): boolean
  setTimeout?: (fn: () => void, ms: number) => unknown
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (timer: unknown) => void
}

export function createBadgeFeed(deps: FeedDeps, cache: Record<string, WorldBadge | null> = badgeCache) {
  const wanted = new Map<string, number>()
  const queue = new Set<string>()
  const later = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const every = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
  const stop = deps.clearInterval ?? ((timer) => globalThis.clearInterval(timer as ReturnType<typeof setInterval>))
  const visible = deps.visible ?? (() => globalThis.document?.visibilityState !== 'hidden')
  let timer: unknown = null, gathering = false

  async function ask(ids: string[]): Promise<void> {
    for (let at = 0; at < ids.length; at += BADGE_BATCH) {
      const batch = ids.slice(at, at + BADGE_BATCH)
      try {
        const answer = await deps.fetchJson<WorldBadgesResponse>('/api/world/badges', { method: 'POST', body: { ids: batch } })
        for (const id of batch) cache[id] = answer.badges?.[id] ?? null
      } catch { /* a badge is a nicety: on any failure the last answer stays and the next round asks again */ }
    }
  }
  function flush(): void {
    gathering = false
    const ids = [...queue].filter((id) => wanted.has(id))
    queue.clear()
    if (ids.length && deps.connected()) void ask(ids)
  }
  function start(): void {
    if (timer !== null) return
    timer = every(() => { if (visible() && deps.connected() && wanted.size) void ask([...wanted.keys()]) }, REFRESH_MS)
  }
  return {
    /** A screen shows this player: returns the function that says it no longer does. */
    want(id: string): () => void {
      wanted.set(id, (wanted.get(id) ?? 0) + 1)
      if (!(id in cache)) { queue.add(id); if (!gathering) { gathering = true; later(flush, GATHER_MS) } }
      start()
      let released = false
      return () => {
        if (released) return
        released = true
        const left = (wanted.get(id) ?? 1) - 1
        if (left > 0) wanted.set(id, left); else wanted.delete(id)
        if (!wanted.size && timer !== null) { stop(timer); timer = null }
      }
    },
    /** Ask about everyone shown right now (after the player's own change, for example). */
    refresh: (): Promise<void> => (wanted.size ? ask([...wanted.keys()]) : Promise.resolve()),
    shown: (): number => wanted.size,
  }
}
export type BadgeFeed = ReturnType<typeof createBadgeFeed>
