// LAZY LISTS: the one pattern every long list uses (docs/LISTS.md). A list is read a PAGE at a time by cursor (the `next` the
// server gave with the last page, never an offset), the next page is asked for BEFORE the reader reaches the end, rows are
// kept once by id, a request made for an earlier query is dropped when the query changes, a failure is shown in the list with a
// retry, and a very long list is drawn through a window of rows. Nothing here touches the DOM: LazyList.vue does that and
// reads the numbers from the pure functions below, which are tested on their own.
import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

/** How far from the bottom the next page is asked for, in heights of the list's viewport. */
export const PREFETCH_SCREENS = 1.5
/** A list longer than this many rows is drawn through a window (fixed-height rows only). */
export const WINDOW_AFTER = 300
/** Rows drawn above and below the window's edges, so a fast scroll does not show blank space. */
export const OVERSCAN = 8
/** Scrolled this many viewports from the top, "Jump to top" is shown. */
export const JUMP_SCREENS = 3

/** One page as a screen's own reader returns it. `next` null: nothing follows. */
export type Fetched<T> = { ok: true; items: readonly T[]; next: string | null; total?: number | null } | { ok: false; reason: string }

export interface LazyListOptions<T> {
  /** Read the page after `cursor` (null: the first). `signal` is aborted when the query changed: stop caring about the answer. */
  fetchPage(cursor: string | null, signal: AbortSignal): Promise<Fetched<T>>
  /** The id of a row; two rows with one id are shown once, the first. */
  key(item: T): string
  /** What the rows are called, for the screen reader ("players": "Loaded 40 more players"). */
  label?: string
}

export interface LazyList<T> {
  items: ShallowRef<T[]>
  loading: Ref<boolean>
  /** The reason the last read failed, until it is retried. While it is set no page is asked for by itself. */
  error: Ref<string | null>
  /** More rows can be had (a first read has not happened, or the last page had a `next`). */
  hasMore: Ref<boolean>
  total: Ref<number | null>
  /** The sentence for the screen reader after a page was added; empty at first. */
  announcement: Ref<string>
  /** Read the next page. Does nothing while one is on its way, after a failure, or at the end. */
  loadMore(): Promise<void>
  /** Forget the rows and read the first page again (the query changed). A read still on its way for the old query is dropped. */
  reset(): Promise<void>
  /** Read again after a failure. */
  retry(): Promise<void>
  /** Add rows that arrived another way (a live push), at the top; a row already held is replaced in place. */
  upsert(item: T, atTop?: boolean): void
  /** Take a row out. */
  remove(id: string): void
}

export function createLazyList<T>(options: LazyListOptions<T>): LazyList<T> {
  const items = shallowRef<T[]>([])
  const loading = ref(false), error = ref<string | null>(null), hasMore = ref(true), total = ref<number | null>(null), announcement = ref('')
  const held = new Set<string>()
  let next: string | null = null, started = false, generation = 0, controller: AbortController | null = null

  async function read(): Promise<void> {
    const mine = generation
    loading.value = true
    controller = new AbortController()
    let got: Fetched<T>
    try { got = await options.fetchPage(started ? next : null, controller.signal) } catch (caught) { got = { ok: false, reason: caught instanceof Error ? caught.message : 'Could not load.' } }
    if (mine !== generation) return // the query changed while this was on its way
    loading.value = false
    if (!got.ok) { error.value = got.reason; return }
    const fresh = got.items.filter((item) => { const id = options.key(item); if (held.has(id)) return false; held.add(id); return true })
    items.value = items.value.concat(fresh)
    if (got.total !== undefined) total.value = got.total
    if (started && fresh.length) announcement.value = `Loaded ${fresh.length} more ${options.label ?? 'rows'}`
    started = true
    next = got.next
    hasMore.value = got.next !== null
  }
  async function loadMore(): Promise<void> {
    if (loading.value || error.value !== null || (started && next === null)) return
    await read()
  }
  async function reset(): Promise<void> {
    generation += 1
    controller?.abort()
    items.value = []; held.clear(); next = null; started = false
    loading.value = false; error.value = null; hasMore.value = true; total.value = null; announcement.value = ''
    await read()
  }
  async function retry(): Promise<void> {
    if (loading.value) return
    error.value = null
    await read()
  }
  function upsert(item: T, atTop = true): void {
    const id = options.key(item)
    if (held.has(id)) { items.value = items.value.map((row) => (options.key(row) === id ? item : row)); return }
    held.add(id)
    items.value = atTop ? [item, ...items.value] : [...items.value, item]
  }
  function remove(id: string): void {
    if (!held.delete(id)) return
    items.value = items.value.filter((row) => options.key(row) !== id)
  }
  return { items, loading, error, hasMore, total, announcement, loadMore, reset, retry, upsert, remove }
}

// ---- the numbers LazyList.vue draws with ---------------------------------------------------------

/** Is the reader close enough to the end that the next page should be asked for now? (The scroll-position fallback for the observer.) */
export function nearEnd(scrollTop: number, viewport: number, scrollHeight: number, screens = PREFETCH_SCREENS): boolean {
  return viewport > 0 && scrollHeight - scrollTop - viewport <= viewport * screens
}
/** How many pixels below the viewport the observer's sentinel reads as "in view": the same distance, as a root margin. */
export const prefetchMargin = (viewport: number, screens = PREFETCH_SCREENS): number => Math.max(0, Math.round(viewport * screens))

export interface WindowSlice { start: number; end: number; height: number }
/**
 * The rows to draw out of `count` rows of one fixed height: those the viewport shows and `overscan` more each side. `offset` is the
 * list's own top inside what scrolls (a list under a heading). `height` is the whole list's height, so the scrollbar is the real one.
 */
export function windowSlice(count: number, rowHeight: number, scrollTop: number, viewport: number, offset = 0, overscan = OVERSCAN): WindowSlice {
  const height = count * rowHeight
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, height: 0 }
  const top = Math.max(0, scrollTop - offset)
  const first = Math.min(count - 1, Math.floor(top / rowHeight)), last = Math.min(count, Math.ceil((top + viewport) / rowHeight))
  return { start: Math.max(0, first - overscan), end: Math.min(count, Math.max(first + 1, last) + overscan), height }
}
/** Windowing applies to a list of fixed-height rows once it is longer than WINDOW_AFTER. */
export const shouldWindow = (count: number, rowHeight: number | undefined, after = WINDOW_AFTER): boolean => Boolean(rowHeight) && count > after
/** Is "Jump to top" shown? */
export const farFromTop = (scrollTop: number, viewport: number, screens = JUMP_SCREENS): boolean => viewport > 0 && scrollTop > viewport * screens

/**
 * CHUNKED RENDERING for rows of unknown height (chat bubbles): of `count` rows only the newest `shown` are drawn, with a placeholder
 * the height of the rows left out above, so the scrollbar and the position stay put. Asking for more raises `shown` by `step`.
 */
export function chunkStart(count: number, shown: number): number { return Math.max(0, count - Math.max(0, shown)) }
export const moreShown = (shown: number, count: number, step: number): number => Math.min(count, shown + step)

/** The scroll position kept for a list that was left (a detail opened over it) and is shown again, by key. */
const positions = new Map<string, number>()
export const keepPosition = (key: string, top: number): void => { if (positions.size > 40) positions.delete(positions.keys().next().value as string); positions.set(key, top) }
export const keptPosition = (key: string): number => positions.get(key) ?? 0
export const forgetPosition = (key: string): void => { positions.delete(key) }

/** Lists that outlive their panel (so coming back to the list shows the same rows at the same place), by key. */
const lists = new Map<string, LazyList<never>>()
export function keptList<T>(key: string, make: () => LazyList<T>): LazyList<T> {
  const found = lists.get(key) as LazyList<T> | undefined
  if (found) return found
  if (lists.size > 12) lists.delete(lists.keys().next().value as string)
  const made = make()
  lists.set(key, made as unknown as LazyList<never>)
  return made
}
export const dropList = (key: string): void => { lists.delete(key) }

/**
 * A list already in memory (a wallet's lines, the stalls of a venue) drawn a chunk at a time as the reader nears the end: the same
 * LazyList, with `more` raising how many rows are drawn. The rows stay where they are; only the drawing is spread out.
 */
export function chunkedView<T>(rows: () => readonly T[], step = 40): { visible: ComputedRef<readonly T[]>; hasMore: ComputedRef<boolean>; more(): void; reset(): void } {
  const count = ref(step)
  return {
    visible: computed(() => rows().slice(0, count.value)),
    hasMore: computed(() => count.value < rows().length),
    more: () => { count.value += step },
    reset: () => { count.value = step },
  }
}
