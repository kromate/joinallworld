// The civic request helpers: loading a server response into the cache (civicCore.ts) and sending a civic request with a pending
// state, a success, or a failure with a reason and a retry. Fetched with the civic screens; the first download holds only the cache.
import type { ToastKind } from '../../types/panel.ts'
import type { FetchJson } from '../../types/client.ts'
import { explain } from './civicBasics.ts'
import { entryOf, newestNotice, sharedStore } from './civicCore.ts'
import type { CivicEntry, CivicStore, RequestSlot, SendResult } from './civicCore.ts'

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
