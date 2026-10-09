// The civic request helpers: loading a server response into the cache (civicCore.ts) and sending a civic request with a pending
// state, a success, or a failure with a reason and a retry. Fetched with the civic screens.
import type { ToastKind } from '../../types/panel.ts'
import type { FetchJson } from '../../types/client.ts'
import { explain } from './civicBasics.ts'
import { civicActor, entryOf, newestNotice, sharedStore } from './civicCore.ts'
import type { CivicEntry, CivicStore, RequestSlot, SendResult } from './civicCore.ts'

export interface CivicDeps {
  fetchJson: FetchJson
  /** The re-sync of the life after a paid write. */
  refresh(): Promise<unknown>
  newId(): string
  toast(text: string, kind?: ToastKind): void
  connected(): boolean
  actor(): string | null
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
  const syncActor = (): void => civicActor(store, deps.actor())
  function scope() {
    syncActor()
    const actor = store.actor.id, generation = store.actor.generation, city = deps.cityId()
    return { actor, generation, city, current: () => { syncActor(); return actor === store.actor.id && generation === store.actor.generation && city === deps.cityId() } }
  }
  const dataOwners = new WeakMap<object, () => boolean>()
  const requestIds = new WeakMap<object, unknown>()
  const requestActors = new Map<string, { actor: string | null; generation: number }>()
  const loads = new WeakMap<CivicEntry, symbol>()
  const stale = { ok: false, code: 'stale_identity_response' }
  function objects(value: unknown, visit: (item: object) => boolean, seen = new Set<object>()): boolean {
    if (value === null || typeof value !== 'object' || seen.has(value)) return true
    seen.add(value)
    return visit(value) && Object.values(value).every((child: unknown) => objects(child, visit, seen))
  }
  function remember<T>(data: T, current: () => boolean): T {
    objects(data, (item) => { dataOwners.set(item, current); return true })
    return data
  }
  function answer(result: SendResult, current: () => boolean, requestId?: unknown): SendResult {
    remember(result, current)
    // A caller can resume after identity changes, even when the fetch finished beforehand.
    const guarded = new Proxy(result, {
      get: (target, key) => Reflect.get(current() ? target : stale, key),
      has: (target, key) => Reflect.has(current() ? target : stale, key),
      ownKeys: (target) => Reflect.ownKeys(current() ? target : stale),
      getOwnPropertyDescriptor: (target, key) => Reflect.getOwnPropertyDescriptor(current() ? target : stale, key),
    })
    dataOwners.set(guarded, current)
    requestIds.set(guarded, requestId)
    return guarded
  }
  const entry = <T>(key: string): CivicEntry<T> => { syncActor(); return entryOf<T>(store, key) }
  const put = <T>(key: string, data: T): void => {
    syncActor()
    if (!objects(data, (item) => dataOwners.get(item)?.() ?? true)) return
    Object.assign(entryOf<T>(store, key), { data, at: now(), error: null })
  }
  const pendingKey = (city: string, tag: string): string => JSON.stringify([city, tag])
  const busy = (tag: string): boolean => { syncActor(); return store.pending.has(pendingKey(deps.cityId(), tag)) }

  /**
   * Fetch `path` into the cache unless a fresh copy (younger than maxAge) is there. Never runs from a
   * timer: a screen calls it when it opens and when the state it shows changes.
   */
  function load<T>(key: string, path: string, { maxAge = 30000, force = false, after }: LoadOptions<T> = {}): Promise<void> {
    const actor = scope()
    const item = entryOf<T>(store, key)
    if (item.loading || !deps.connected() || actor.actor === null) return Promise.resolve()
    if (!force && item.path === path && item.at && now() - item.at < maxAge) return Promise.resolve()
    const token = Symbol()
    loads.set(item, token)
    item.loading = true; item.path = path
    return deps.fetchJson<T>(path, { headers: { 'X-Allworld-Actor': actor.actor } }).then((data) => {
      if (actor.current() && loads.get(item) === token) { item.data = remember(data, actor.current); item.error = null }
    }, (error: unknown) => {
      if (actor.current() && loads.get(item) === token) item.error = explain(error)
    }).finally(() => {
      if (loads.get(item) !== token || actor.generation !== store.actor.generation) return
      item.loading = false
      if (actor.current()) { item.at = now(); after?.(item) }
    })
  }

  /**
   * POST a civic request. Resolves { ok, code, reason?, ...body }; never rejects. While it runs,
   * busy(tag) is true so the control can show a pending label. A refusal or failure is toasted with
   * its reason. After a success the life is re-synced so the wallet shows the new balance.
   */
  async function send(tag: string, path: string, body: Record<string, unknown>, { success = '' }: SendOptions = {}): Promise<SendResult> {
    const actor = scope(), pending = pendingKey(actor.city, tag)
    if (store.pending.has(pending)) return { ok: false, code: 'busy' }
    if (!deps.connected() || actor.actor === null) { deps.toast(`${deps.linkWhy()} Nothing was sent.`, 'error'); return { ok: false, code: 'offline' } }
    if (typeof body.requestId === 'string') {
      const owner = requestActors.get(body.requestId)
      if (owner && (owner.actor !== actor.actor || owner.generation !== actor.generation)) {
        const reason = 'This request belongs to a previous character. Reload this screen before trying again.'
        deps.toast(reason, 'error')
        return { ok: false, code: 'actor_changed', reason }
      }
      requestActors.set(body.requestId, { actor: actor.actor, generation: actor.generation })
    }
    store.pending.add(pending)
    let result: SendResult
    try {
      result = await deps.fetchJson<SendResult>(path, { method: 'POST', headers: { 'X-Allworld-Actor': actor.actor }, body: { ...body, cityId: actor.city } })
      if (!actor.current()) return stale
      if (result.ok) {
        if (result.state) {
          try { await deps.refresh() } catch { /* The write was confirmed; a failed refresh cannot undo it. */ }
          if (!actor.current()) return stale
        }
        if (success) deps.toast(success, 'good')
      }
      else deps.toast(result.reason || 'That could not be done.', 'error')
    } catch (error) {
      if (!actor.current()) return stale
      const code = error !== null && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
      const reason = code === 'actor_changed' ? 'Your character changed. Reload this screen before trying again.' : `${explain(error)} We could not confirm the result. Retry this same request to check it without paying twice.`
      result = { ok: false, code: typeof code === 'string' && code ? code : 'network', reason }
      deps.toast(result.reason ?? '', 'error')
    } finally { if (actor.generation === store.actor.generation) store.pending.delete(pending) }
    return answer(result, actor.current, body.requestId)
  }

  /**
   * The request id of a paid civic request (rent, stand for office): `<server ms>:<uuid>`, the form
   * the server requires. `slot` is a module-level object the screen keeps; the id is reused for as
   * long as the request's contents are the same, so pressing the button again after a lost answer
   * repeats the SAME request (applied once), and changing anything makes a new one. Call
   * `requestDone(slot, result)` afterwards: an applied request forgets its id.
   */
  function requestId(slot: RequestSlot, contents: unknown): string {
    const actor = scope()
    const what = JSON.stringify([actor.actor, actor.generation, actor.city, contents])
    if (slot.what !== what || !slot.id) { slot.what = what; slot.id = deps.newId() }
    return slot.id
  }
  const requestDone = (slot: RequestSlot, result: Pick<SendResult, 'ok'> | null | undefined): void => {
    syncActor()
    if (result?.ok && (!requestIds.has(result) || requestIds.get(result) === slot.id)) { slot.what = null; slot.id = null }
  }

  /** The Governor app is on screen: its news is read. True when that changed what the badge shows. */
  function markNewsRead(): boolean {
    syncActor()
    const cityId = deps.cityId()
    return store.news.mark(cityId, Math.max(0, ...newestNotice(store, cityId).map((item) => item.at)))
  }

  return { entry, put, busy, load, send, requestId, requestDone, markNewsRead, changed: () => deps.changed?.() }
}
export type Civic = ReturnType<typeof createCivic>
