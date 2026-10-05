<script setup lang="ts">
// "● 128 in Allworld · 12 here · 4.2k visits": who is in the game now and how many visits it has had. It sits in the
// top bar, shows nothing until the first real answer (the server's first socket frame, or the first poll), and opens
// People when pressed (the invite when they are alone). The reader is always one of the people counted, so it never says 0; when they are the only one
// online it says something true and warmer instead of a bare "1" ("You're first here", or "N played today") and
// pressing it offers the invite. The dot is green while the numbers are recent and amber when they are not. A number that
// changes steps to its new value in a few timed steps (none under reduced motion); there is no animation loop.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { onCallFrame, onSocketOpen, sendFrame, social } from '../social/useSocial.ts'
import { useGrowth } from '../growth/useGrowth.ts'
import { aloneLine, easeSteps, onlineView, pulseAria, pulseTitle, pulseTone, compactCount } from './onlinePillModel.ts'
import { usePulse } from './usePulse.ts'

const { game, shell, api } = useApp()
const pulse = usePulse((path) => api.fetchJson(path))
const growth = useGrowth()
const state = pulse.state
const connected = game.connected

const shown = computed(() => connected.value && state.numbers !== null)
const tone = computed(() => pulseTone({ failing: state.failing || !connected.value, at: state.at, now: Date.now() }))
const online = ref(1)
const visits = ref(0)
const cityId = game.cityId
const title = computed(() => (state.numbers ? pulseTitle(state.numbers, tone.value, cityId.value) : ''))
const aria = computed(() => (state.numbers ? pulseAria(state.numbers, tone.value, cityId.value) : ''))
const view = computed(() => (state.numbers ? onlineView(state.numbers, cityId.value) : null))
const alone = computed(() => view.value?.alone === true)
const line = computed(() => aloneLine(view.value ?? { today: 0 }))
const hasCity = computed(() => view.value?.here != null)
const here = ref(1)

const reduced = (): boolean => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
const timers: ReturnType<typeof setTimeout>[] = []
let first = true
function glide(target: { value: number }, to: number, from: number | null): void {
  const steps = reduced() ? [to] : easeSteps(from, to)
  steps.forEach((value, i) => {
    if (i === 0) { target.value = value; return }
    timers.push(setTimeout(() => { target.value = value }, i * 55))
  })
}
watch([() => state.numbers, cityId], ([numbers]) => {
  if (!numbers) { first = true; return }
  const now = onlineView(numbers, cityId.value)
  for (const timer of timers.splice(0)) clearTimeout(timer)
  glide(online, now.world, first ? null : online.value)
  glide(here, now.here ?? now.world, first ? null : here.value)
  glide(visits, numbers.visits, first ? null : visits.value)
  first = false
}, { immediate: true })

const press = (): void => { if (alone.value) void growth.share('invite', { surface: 'hud' }); else shell.open('people') }
const onVisibility = (): void => pulse.visibility()
// The server sends the counts over the socket: asked for once per connection (the answer is the right count already), and again on its own when they change.
const askCounts = (): void => { sendFrame({ type: 'pulse-watch' }) }
let unframe: (() => void) | null = null, unopen: (() => void) | null = null
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  unframe = onCallFrame((frame) => { if (frame.type === 'pulse') pulse.take(frame) })
  unopen = onSocketOpen(askCounts)
  if (social.socket === 'open') askCounts()
  if (connected.value) pulse.start()
})
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', onVisibility); unframe?.(); unopen?.(); for (const timer of timers.splice(0)) clearTimeout(timer) })
// The poll belongs to the page (never started while rendering to a string): it follows the session.
watch(connected, (on) => { if (on) pulse.start(); else { pulse.stop(); pulse.reset() } })
</script>

<template>
  <button v-if="shown" class="pulse-pill" :class="{ 'is-alone': alone }" data-tour="online" type="button" :title="title" :aria-label="aria" @click="press">
    <i class="pulse-dot" :class="`is-${tone}`" aria-hidden="true"></i>
    <span class="pulse-online">{{ compactCount(online) }}<span class="pulse-word"> in Allworld</span></span>
    <span v-if="hasCity" class="pulse-world"><span class="pulse-sep" aria-hidden="true"> · </span>{{ compactCount(here) }} here</span>
    <span class="pulse-visits"><span class="pulse-sep" aria-hidden="true"> · </span>{{ compactCount(visits) }} visits</span>
    <span v-if="alone" class="pulse-visits pulse-nudge"><span class="pulse-sep" aria-hidden="true"> · </span>{{ line.long }}: invite a friend</span>
  </button>
</template>

<style scoped>
.pulse-pill { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; border: 0; border-radius: var(--r-pill); background: var(--c-green-soft); color: var(--c-ink-2); font: 600 var(--t-small)/1.2 var(--font); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.pulse-pill:focus-visible { outline: var(--focus); outline-offset: 2px; }
.pulse-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--c-green-dark); transition: background-color .3s; }
.pulse-dot.is-stale { background: var(--c-amber-dark); }
.pulse-visits, .pulse-world { color: var(--c-muted); }
/* Up to a small laptop the pill holds the lead number only (the world, or the line the reader alone gets): with the rest the top bar ran under the wordmark, and on a tablet past the screen's edge. */
@media (max-width: 1300px) { .pulse-visits, .pulse-world { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } }
@media (max-width: 600px) {
  .pulse-pill { padding: 0 8px; }
  .pulse-word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
}
@media (prefers-reduced-motion: reduce) { .pulse-dot { transition: none; } }
</style>
