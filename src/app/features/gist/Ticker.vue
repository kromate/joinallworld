<script setup lang="ts">
// The city news line (docs/GIST.md, "The ticker"): what is happening in the city, one short line at a time, in the register of the place.
// It reads the gist lines the page already has plus a few life changes and the city's power cuts (src/news/), and is fetched when the game
// is idle, never with the first page. Two places show it:
//   * variant "square": the Square's panel, where it replaces the plain gist line once it has something to say (until then, and when
//     its own line is more than half an hour old, the panel's `fallback` is shown, so the Square never loses its line);
//   * variant "hud": a thin strip in the notice slot for nine seconds after each line, then gone. It stays out of the way of the coach's
//     tips and of the Square panel, which shows the same line itself.
// It is a polite status line and never in chat.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { liveSource } from '../../../news/live.ts'
import { ticker, watchTicker } from '../../../news/ticker.ts'
import { gist, loadGist } from './gistStore.ts'

const props = defineProps<{ variant: 'square' | 'hud'; fallback?: string }>()
const emit = defineEmits<{ ready: [] }>()
const { game, shell } = useApp()

/** How long the strip at the top of the screen holds a line, and how old a line may be and still be the Square's. */
const SHOW_MS = 9000, STALE_MS = 30 * 60000

const clock = ref(Date.now())
const shown = ref(false)
let hide: ReturnType<typeof setTimeout> | undefined, tick: ReturnType<typeof setInterval> | undefined, leave: (() => void) | undefined

onMounted(() => {
  const handles = {
    cityId: () => game.view.value.cityId,
    state: () => game.state.value,
    gistLines: (city: string) => (gist.city === city ? gist.lines : []),
    askGist: (city: string, now: number) => { void loadGist((path) => game.fetchJson(path), city, now) },
  }
  leave = watchTicker(liveSource(handles))
  if (props.variant === 'square') ticker.squares += 1
  tick = setInterval(() => { clock.value = Date.now() }, 15000)
  emit('ready')
})
onBeforeUnmount(() => {
  leave?.()
  if (props.variant === 'square') ticker.squares = Math.max(0, ticker.squares - 1)
  clearInterval(tick); clearTimeout(hide)
})

watch(() => ticker.at, (at) => {
  if (props.variant !== 'hud' || !at) return
  shown.value = true
  clearTimeout(hide)
  hide = setTimeout(() => { shown.value = false }, SHOW_MS)
})

const squareText = computed(() => (ticker.line && clock.value - ticker.at < STALE_MS ? ticker.line : props.fallback ?? ''))
const stripText = computed(() => (shown.value && !ticker.squares && !shell.ui.coaching ? ticker.line : ''))
</script>

<template>
  <p v-if="variant === 'square' && squareText" class="social-note place-gist" data-place="gist" data-ticker="square">{{ squareText }}</p>
  <aside v-else-if="variant === 'hud' && stripText" class="news-line" role="status" aria-live="polite" aria-atomic="true" data-ticker="hud" @click="shown = false">
    <span class="news-line-tag" aria-hidden="true">News</span>
    <span class="news-line-text">{{ stripText }}</span>
  </aside>
</template>

<style scoped>
.news-line { box-sizing: border-box; width: 100%; max-width: 460px; display: flex; align-items: baseline; gap: 8px; padding: 6px 12px; border-radius: 12px; background: #f6f1e4; color: var(--c-ink); box-shadow: inset 0 0 0 1px #e2d6b4, var(--e-1, 0 2px 8px rgba(0, 0, 0, .12)); font: 500 13px/1.35 var(--font); pointer-events: auto; cursor: default; }
.news-line-tag { flex: none; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--c-ink-2); }
.news-line-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
</style>
