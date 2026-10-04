// The civic client: the small cache of server responses the civic panels draw from, and the
// request helpers that give every server-backed control a pending state, a success, or a failure
// with a reason and a retry. Same promises as the existing src/ui/panels/civic-ui.js:
//   - a response is fetched at most once per `maxAge`, never from a timer;
//   - one request per control at a time (`busy(tag)`), a second press is refused as 'busy';
//   - a paid request keeps its id for a retry, so a lost answer repeats the SAME request (applied once);
//   - after a success the life is re-synced so the wallet shows the new balance.
// The cache is reactive, so a screen reads it and redraws by itself; nothing here calls render.
// Rules and validation live on the server (server/civic) and in src/game/systems/civic.js.
import { reactive, shallowReactive } from 'vue'
import type { ToastKind } from '../../types/panel.ts'
import type { FetchJson } from '../../types/client.ts'
import type { CivicNotice } from '../../../types/civic.ts'
import { explain, pulseKey, unseenNews } from './civicBasics.ts'

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

const entryOf = <T>(store: CivicStore, key: string): CivicEntry<T> => {
  let item = store.cache.get(key)
  if (!item) { item = shallowReactive(blank()); store.cache.set(key, item) }
  return item as CivicEntry<T>
}

function newestNotice(store: CivicStore, cityId: string): readonly Pick<CivicNotice, 'at'>[] {
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

export interface CivicDeps {
  fetchJson: FetchJson
  /** The re-sync of the life after a paid write. */
  refresh(): Promise<unknown>
  newId(): string
  toast(text: string, kind?: ToastKind): void
  connected(): boolean
  cityId(): string
  /** One sentence saying why nothing can be sent ("This device has no internet connection."). */
  linkWhy(): string
  /** Called after a write changed something other screens draw (the map): a redraw of the existing panels. */
  changed?(): void
  now?(): number
}

export interface LoadOptions<T> { maxAge?: number; force?: boolean; after?(item: CivicEntry<T>): void }
export interface SendOptions { success?: string }

export function createCivic(deps: CivicDeps, store: CivicStore = sharedStore) {
  const now = deps.now ?? Date.now
  const entry = <T>(key: string): CivicEntry<T> => entryOf<T>(store, key)
  const put = <T>(key: string, data: T): void => {
    Object.assign(entryOf<T>(store, key), { data, at: now(), error: null })
  }
  const busy = (tag: string): boolean => store.pending.has(tag)

  /**
   * Fetch `path` into the cache unless a fresh copy (younger than maxAge) is there. Never runs from a
   * timer: a screen calls it when it opens and when the state it shows changes.
   */
  function load<T>(key: string, path: string, { maxAge = 30000, force = false, after }: LoadOptions<T> = {}): Promise<void> {
    const item = entryOf<T>(store, key)
    if (item.loading || !deps.connected()) return Promise.resolve()
    if (!force && item.path === path && item.at && now() - item.at < maxAge) return Promise.resolve()
    item.loading = true; item.path = path
    return deps.fetchJson<T>(path).then((data) => { item.data = data; item.error = null }, (error: unknown) => { item.error = explain(error) })
      .finally(() => { item.loading = false; item.at = now(); after?.(item) })
  }

  /**
   * POST a civic request. Resolves { ok, code, reason?, ...body }; never rejects. While it runs,
   * busy(tag) is true so the control can show a pending label. A refusal or failure is toasted with
   * its reason. After a success the life is re-synced so the wallet shows the new balance.
   */
  async function send(tag: string, path: string, body: Record<string, unknown>, { success = '' }: SendOptions = {}): Promise<SendResult> {
    if (store.pending.has(tag)) return { ok: false, code: 'busy' }
    if (!deps.connected()) { deps.toast(`${deps.linkWhy()} Nothing was sent.`, 'error'); return { ok: false, code: 'offline' } }
    store.pending.add(tag)
    let result: SendResult
    try {
      result = await deps.fetchJson<SendResult>(path, { method: 'POST', body: { cityId: deps.cityId(), ...body } })
      if (result.ok) { if (success) deps.toast(success, 'good'); if (result.state) await deps.refresh() }
      else deps.toast(result.reason || 'That could not be done.', 'error')
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      result = { ok: false, code: typeof code === 'string' && code ? code : 'network', reason: `${explain(error)} Nothing was charged; you can try again.` }
      deps.toast(result.reason ?? '', 'error')
    } finally { store.pending.delete(tag) }
    return result
  }

  /**
   * The request id of a paid civic request (rent, stand for office): `<server ms>:<uuid>`, the form
   * the server requires. `slot` is a module-level object the screen keeps; the id is reused for as
   * long as the request's contents are the same, so pressing the button again after a lost answer
   * repeats the SAME request (applied once), and changing anything makes a new one. Call
   * `requestDone(slot, result)` afterwards: an applied request forgets its id.
   */
  function requestId(slot: RequestSlot, contents: unknown): string {
    const what = JSON.stringify(contents)
    if (slot.what !== what || !slot.id) { slot.what = what; slot.id = deps.newId() }
    return slot.id
  }
  const requestDone = (slot: RequestSlot, result: Pick<SendResult, 'ok'> | null | undefined): void => { if (result?.ok) { slot.what = null; slot.id = null } }

  /** The Governor app is on screen: its news is read. True when that changed what the badge shows. */
  function markNewsRead(): boolean {
    const cityId = deps.cityId()
    return store.news.mark(cityId, Math.max(0, ...newestNotice(store, cityId).map((item) => item.at)))
  }

  return { entry, put, busy, load, send, requestId, requestDone, markNewsRead, changed: () => deps.changed?.() }
}
export type Civic = ReturnType<typeof createCivic>
