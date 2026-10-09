// The civic client: the small cache of server responses the civic panels draw from, and the
// request helpers that give every server-backed control a pending state, a success, or a failure
// with a reason and a retry. Same promises as the existing src/ui/panels/civic-ui.js:
//   - a response is fetched at most once per `maxAge`, never from a timer;
//   - one request per control at a time (`busy(tag)`), a second press is refused as 'busy';
//   - a paid request keeps its id for a retry, so a lost answer repeats the SAME request (applied once);
//   - after a success the life is re-synced so the wallet shows the new balance.
// The cache is reactive, so a screen reads it and redraws by itself; nothing here calls render.
// Rules and validation live on the server (server/civic) and in src/game/systems/civic.ts.
// Loaded with civic screens. The panel registry reads the store through civicBadges.ts after it is created.
import { reactive, shallowReactive } from 'vue'
import { civicBadgeStore } from './civicBadges.ts'
export { civicNews, newestNotice } from './civicBadges.ts'

export interface CivicEntry<T = unknown> { data: T | null; at: number; path: string; loading: boolean; error: string | null }
const blank = <T>(): CivicEntry<T> => ({ data: null, at: 0, path: '', loading: false, error: null })

/** The kept request id of a paid request, one slot per kind of request. */
export interface RequestSlot { what: string | null; id: string | null }
export const requestSlot = (): RequestSlot => ({ what: null, id: null })

/** What a write resolves with: the server's answer, or the refusal made here. Never rejects. */
export type SendResult = { ok: boolean; code: string; reason?: string } & Record<string, unknown>

// ---- city news the player has read ---------------------------------------------------------------

const NEWS_KEY = 'joinallworld-civic-news-read'
export interface NewsRead { at(cityId: string): number; mark(cityId: string, newest: number): boolean }
export function createNewsRead(storage: () => Pick<Storage, 'getItem' | 'setItem'> | null | undefined, key = NEWS_KEY): NewsRead {
  let read: Record<string, number> | null = null
  const load = (): Record<string, number> => {
    if (!read) { try { read = JSON.parse(storage()?.getItem(key) ?? 'null') || {} } catch { read = {} } }
    return read ?? {}
  }
  return {
    at: (cityId) => Number(load()[cityId]) || 0,
    mark(cityId, newest) {
      const all = load()
      if (newest <= (Number(all[cityId]) || 0)) return false
      all[cityId] = newest
      try { storage()?.setItem(key, JSON.stringify(all)) } catch { /* read for this visit only */ }
      return true
    },
  }
}

// ---- the one shared store of this page ---------------------------------------------------------

export interface CivicStore {
  actor: { id: string | null; generation: number }
  cache: Map<string, CivicEntry>
  /** Tags of the writes that are on their way: reactive, so a pressed control shows "Working…". */
  pending: Set<string>
  news: NewsRead
  newsFor(actor: string | null): NewsRead
}
export const createStore = (storage: () => Pick<Storage, 'getItem' | 'setItem'> | null | undefined = () => globalThis.localStorage): CivicStore => shallowReactive({
  actor: shallowReactive({ id: null, generation: 0 }), cache: shallowReactive(new Map<string, CivicEntry>()), pending: reactive(new Set<string>()), news: createNewsRead(storage),
  newsFor: (actor: string | null) => createNewsRead(actor === null ? () => null : storage, `${NEWS_KEY}:${actor ?? 'anonymous'}`),
})
export const sharedStore: CivicStore = createStore()
civicBadgeStore.value = sharedStore

export function civicActor(store: CivicStore, actor: string | null): void {
  if (store.actor.id === actor) return
  store.actor.id = actor
  store.actor.generation += 1
  for (const item of store.cache.values()) Object.assign(item, blank())
  store.pending.clear()
  store.news = store.newsFor(actor)
}

export const entryOf = <T>(store: CivicStore, key: string): CivicEntry<T> => {
  let item = store.cache.get(key)
  if (!item) { item = shallowReactive(blank()); store.cache.set(key, item) }
  return item as CivicEntry<T>
}
