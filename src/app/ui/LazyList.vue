<script setup lang="ts" generic="T">
// A long list that fills itself as it is read (docs/LISTS.md). The rows come in as `items`; the screen reads the next page when
// this asks (`more`), which it does while the reader is still 1.5 viewports from the end. Past a few hundred rows of one fixed
// height only the rows near the viewport are drawn. It scrolls with the nearest scrolling ancestor (or by itself, given `height`).
// Rows are the caller's own markup in the `row` slot. The announcement for the screen reader is a polite live region; nothing here
// moves focus. Jump to top does not animate for a reader who asked for reduced motion.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { farFromTop, keepPosition, keptPosition, nearEnd, prefetchMargin, shouldWindow, windowSlice } from './lazyList.ts'

const props = withDefaults(defineProps<{
  items: readonly T[]
  itemKey: (item: T) => string
  hasMore: boolean
  loading: boolean
  error?: string | null
  /** One height for every row, in pixels: the list is then drawn through a window once it is long. Absent: every row is drawn. */
  rowHeight?: number
  /** Grey rows shown while a page is on its way. */
  skeletonRows?: number
  /** What the rows are, for the reader of the screen ("players"). */
  label?: string
  announcement?: string
  /** Keep the scroll position under this name, and come back to it when the list is shown again. */
  memory?: string
  /** Scroll inside the list at this CSS height instead of with the page. */
  height?: string
}>(), { error: null, rowHeight: undefined, skeletonRows: 3, label: 'rows', announcement: '', memory: undefined, height: undefined })
const emit = defineEmits<{ more: []; retry: [] }>()
defineSlots<{ row(props: { item: T; index: number }): unknown; empty?(): unknown }>()

const root = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
const scrollTop = ref(0), viewport = ref(0), offset = ref(0)
const jump = ref(false)
const focused = ref(-1)
let scroller: HTMLElement | null = null, observer: IntersectionObserver | null = null, frame = 0, mounted = false

const windowed = computed(() => shouldWindow(props.items.length, props.rowHeight))
const slice = computed(() => windowSlice(props.items.length, props.rowHeight ?? 0, scrollTop.value, viewport.value || 800, offset.value))
const drawn = computed(() => {
  if (!windowed.value) return props.items.map((item, index) => ({ item, index }))
  const rows: { item: T; index: number }[] = []
  const hold = focused.value >= 0 && focused.value < props.items.length && (focused.value < slice.value.start || focused.value >= slice.value.end) ? focused.value : -1
  if (hold >= 0 && hold < slice.value.start) rows.push({ item: props.items[hold] as T, index: hold })
  for (let index = slice.value.start; index < slice.value.end; index += 1) rows.push({ item: props.items[index] as T, index })
  if (hold >= slice.value.end) rows.push({ item: props.items[hold] as T, index: hold })
  return rows
})

const ancestor = (from: HTMLElement): HTMLElement => {
  for (let node = from.parentElement; node; node = node.parentElement) { const overflow = getComputedStyle(node).overflowY; if (overflow === 'auto' || overflow === 'scroll') return node }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement
}
/** Where the page is, read from the scrolling element and the list. */
function measure(): void {
  const box = root.value
  if (!box || !scroller) return
  const page = scroller === document.scrollingElement || scroller === document.documentElement
  scrollTop.value = scroller.scrollTop
  viewport.value = page ? window.innerHeight : scroller.clientHeight
  offset.value = scroller === box ? 0 : box.getBoundingClientRect().top - (page ? 0 : scroller.getBoundingClientRect().top) + scroller.scrollTop
  jump.value = farFromTop(scrollTop.value - offset.value, viewport.value)
  if (props.memory) keepPosition(props.memory, scrollTop.value)
}
/** Ask for the next page when the end is within 1.5 viewports. */
function check(): void {
  if (!mounted || !props.hasMore || props.loading || props.error) return
  const end = sentinel.value
  if (!end || !scroller) return
  const page = scroller === document.scrollingElement || scroller === document.documentElement
  const bottom = page ? window.innerHeight : scroller.getBoundingClientRect().bottom, height = viewport.value || bottom
  if (end.getBoundingClientRect().top - bottom <= prefetchMargin(height) || nearEnd(scroller.scrollTop, height, scroller.scrollHeight)) emit('more')
}
function onScroll(): void {
  if (frame) return
  frame = requestAnimationFrame(() => { frame = 0; measure(); check() })
}
function watchEnd(): void {
  observer?.disconnect()
  if (!sentinel.value || typeof IntersectionObserver === 'undefined') return
  const page = scroller === document.scrollingElement || scroller === document.documentElement
  observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) check() }, { root: page ? null : scroller, rootMargin: `0px 0px ${prefetchMargin(viewport.value || 800)}px 0px` })
  observer.observe(sentinel.value)
}
function toTop(): void {
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller?.scrollTo({ top: Math.max(0, offset.value - 8), behavior: calm ? 'auto' : 'smooth' })
}
function onFocus(event: FocusEvent): void {
  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-index]')
  focused.value = row ? Number(row.dataset['index']) : -1
}
onMounted(async () => {
  const box = root.value
  if (!box) return
  scroller = props.height ? box : ancestor(box)
  const target = scroller === document.scrollingElement || scroller === document.documentElement ? window : scroller
  target.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  mounted = true
  measure()
  await nextTick()
  const kept = props.memory ? keptPosition(props.memory) : 0
  if (kept > 0 && scroller) { scroller.scrollTop = kept; measure() }
  watchEnd(); check()
})
onBeforeUnmount(() => {
  mounted = false
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
  const target = scroller === document.scrollingElement || scroller === document.documentElement ? window : scroller
  target?.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
})
// After rows were added, or a read ended, the end may still be close: ask again (the observer only speaks when something crosses).
watch(() => [props.items.length, props.loading, props.hasMore, props.error], () => { void nextTick(() => { measure(); check() }) }, { flush: 'post' })
watch(() => props.items.length, (now, was) => { if (now < was || was === 0) { void nextTick(() => { watchEnd() }) } })
</script>

<template>
  <div ref="root" class="ll" :class="{ 'is-own': Boolean(height) }" :style="height ? { maxHeight: height } : undefined" role="list" :aria-label="label" :aria-busy="loading" @focusin="onFocus">
    <div v-if="!items.length && !loading && !error && !hasMore" class="ll-empty"><slot name="empty" /></div>
    <div class="ll-rows" :class="{ 'is-windowed': windowed }" :style="windowed ? { height: `${slice.height}px` } : undefined">
      <div v-for="row in drawn" :key="itemKey(row.item)" class="ll-row" role="listitem" :data-index="row.index" :aria-posinset="windowed ? row.index + 1 : undefined" :aria-setsize="windowed ? items.length : undefined"
        :style="windowed ? { top: `${row.index * (rowHeight ?? 0)}px`, height: `${rowHeight}px` } : undefined">
        <slot name="row" :item="row.item" :index="row.index" />
      </div>
    </div>
    <div v-if="loading" class="ll-skeleton" role="status" aria-label="Loading"><i v-for="n in skeletonRows" :key="n" aria-hidden="true" /></div>
    <p v-if="error" class="ll-error" role="alert">Couldn’t load more · <button type="button" @click="emit('retry')">Try again</button></p>
    <div ref="sentinel" class="ll-sentinel" aria-hidden="true" />
    <div class="ll-live" aria-live="polite" role="status">{{ announcement }}</div>
    <button v-if="jump" type="button" class="ll-top" @click="toTop">Jump to top</button>
  </div>
</template>

<style scoped>
.ll { position: relative; }
.ll.is-own { overflow-y: auto; overscroll-behavior: contain; }
.ll-rows.is-windowed { position: relative; }
.ll-rows.is-windowed > .ll-row { position: absolute; left: 0; right: 0; overflow: hidden; }
.ll-skeleton { display: grid; gap: 8px; padding: 8px 0; }
.ll-skeleton i { display: block; height: 52px; border-radius: var(--r-md); background: var(--c-fill); }
.ll-error { margin: 8px 0; font-size: 13px; color: var(--c-muted); }
.ll-error button { border: 0; background: none; padding: 0; font: inherit; font-weight: 700; color: inherit; text-decoration: underline; cursor: pointer; }
.ll-error button:focus-visible, .ll-top:focus-visible { outline: var(--focus); outline-offset: 2px; }
.ll-sentinel { height: 1px; }
.ll-live { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ll-top { position: sticky; bottom: 12px; display: block; margin: 8px auto 0; padding: 7px 14px; border: 1px solid var(--c-line); border-radius: 999px; background: var(--c-card, #fff); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12); }
</style>
