// The civic client: the small cache of server responses the civic panels draw from, and the
// request helpers that give every server-backed control a pending state, a success, or a failure
// with a reason and a retry. Same promises as the existing src/ui/panels/civic-ui.js:
//   - a response is fetched at most once per `maxAge`, never from a timer;
//   - one request per control at a time (`busy(tag)`), a second press is refused as 'busy';
//   - a paid request keeps its id for a retry, so a lost answer repeats the SAME request (applied once);
//   - after a success the life is re-synced so the wallet shows the new balance.
// The cache is reactive, so a screen reads it and redraws by itself; nothing here calls render.
// Rules and validation live on the server (server/civic) and in src/game/systems/civic.ts.
// This file is in the first download (the Governor badge reads the cache): the request helpers the civic screens use are in
// civicClient.ts, fetched with them.
import { reactive, shallowReactive } from 'vue'
import type { CivicNotice } from '../../../types/civic.ts'
import { pulseKey, unseenNews } from './civicBasics.ts'

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
export function createNewsRead(storage: () => Pick<Storage, 'getItem' | 'setItem'> | null | undefined): NewsRead {
  let read: Record<string, number> | null = null
  const load = (): Record<string, number> => {
    if (!read) { try { read = JSON.parse(storage()?.getItem(NEWS_KEY) ?? 'null') || {} } catch { read = {} } }
    return read ?? {}
  }
  return {
    at: (cityId) => Number(load()[cityId]) || 0,
    mark(cityId, newest) {
      const all = load()
      if (newest <= (Number(all[cityId]) || 0)) return false
      all[cityId] = newest
      try { storage()?.setItem(NEWS_KEY, JSON.stringify(all)) } catch { /* read for this visit only */ }
      return true
    },
  }
}

// ---- the one shared store of this page ---------------------------------------------------------

export interface CivicStore {
  cache: Map<string, CivicEntry>
  /** Tags of the writes that are on their way: reactive, so a pressed control shows "Working…". */
  pending: Set<string>
  news: NewsRead
}
export const createStore = (storage: () => Pick<Storage, 'getItem' | 'setItem'> | null | undefined = () => globalThis.localStorage): CivicStore => ({
  cache: new Map(), pending: reactive(new Set<string>()), news: createNewsRead(storage),
})
export const sharedStore: CivicStore = createStore()

export const entryOf = <T>(store: CivicStore, key: string): CivicEntry<T> => {
  let item = store.cache.get(key)
  if (!item) { item = shallowReactive(blank()); store.cache.set(key, item) }
  return item as CivicEntry<T>
}

export function newestNotice(store: CivicStore, cityId: string): readonly Pick<CivicNotice, 'at'>[] {
  const own = (store.cache.get(pulseKey(cityId))?.data as { notices?: readonly CivicNotice[] } | null)?.notices
  return own ?? []
}
/**
 * City news (a new Governor, an announcement) that is new to THIS life and that the player has not
 * opened the Governor app for yet: its badge on the Phone. News from before the life began in the
 * city (state.civic.since) never counts, so a brand-new life starts with no badge.
 */
export function civicNews(view: { cityId: string }, state: { civic?: { since?: number | null } | null }, store: CivicStore = sharedStore): number {
  return unseenNews(newestNotice(store, view.cityId), { readAt: store.news.at(view.cityId), since: state.civic?.since ?? null })
}
