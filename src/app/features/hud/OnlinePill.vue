<script setup lang="ts">
// "● 128 online · 4.2k visits": who is in the game now and how many visits it has had. It sits in the top
// bar, shows nothing until the first real answer, and opens People when pressed. The dot is green while
// the numbers are recent and amber when they are not. A number that changes steps to its new value in a
// few timed steps (none under reduced motion); there is no animation loop.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { easeSteps, pulseAria, pulseTitle, pulseTone, compactCount } from './onlinePillModel.ts'
import { usePulse } from './usePulse.ts'

const { game, shell, api } = useApp()
const pulse = usePulse((path) => api.fetchJson(path))
const state = pulse.state
const connected = game.connected

const shown = computed(() => connected.value && state.numbers !== null)
const tone = computed(() => pulseTone({ failing: state.failing || !connected.value, at: state.at, now: Date.now() }))
const online = ref(0)
const visits = ref(0)
const title = computed(() => (state.numbers ? pulseTitle(state.numbers, tone.value) : ''))
const aria = computed(() => (state.numbers ? pulseAria(state.numbers, tone.value) : ''))

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
watch(() => state.numbers, (numbers) => {
  if (!numbers) { first = true; return }
  for (const timer of timers.splice(0)) clearTimeout(timer)
  glide(online, numbers.online, first ? null : online.value)
  glide(visits, numbers.visits, first ? null : visits.value)
  first = false
}, { immediate: true })

const onVisibility = (): void => pulse.visibility()
onMounted(() => { document.addEventListener('visibilitychange', onVisibility); if (connected.value) pulse.start() })
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', onVisibility); for (const timer of timers.splice(0)) clearTimeout(timer) })
// The poll belongs to the page (never started while rendering to a string): it follows the session.
watch(connected, (on) => { if (on) pulse.start(); else { pulse.stop(); pulse.reset() } })
</script>

<template>
  <button v-if="shown" class="pulse-pill" data-tour="online" type="button" :title="title" :aria-label="aria" @click="shell.open('people')">
    <i class="pulse-dot" :class="`is-${tone}`" aria-hidden="true"></i>
    <span class="pulse-online">{{ compactCount(online) }}<span class="pulse-word"> online</span></span>
    <span class="pulse-visits"><span class="pulse-sep" aria-hidden="true"> · </span>{{ compactCount(visits) }} visits</span>
  </button>
</template>

<style scoped>
.pulse-pill { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; border: 0; border-radius: var(--r-pill); background: var(--c-green-soft); color: var(--c-ink-2); font: 600 var(--t-small)/1.2 var(--font); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.pulse-pill:focus-visible { outline: var(--focus); outline-offset: 2px; }
.pulse-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--c-green-dark); transition: background-color .3s; }
.pulse-dot.is-stale { background: var(--c-amber-dark); }
.pulse-visits { color: var(--c-muted); }
@media (max-width: 600px) {
  .pulse-pill { padding: 0 8px; }
  .pulse-word, .pulse-visits { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
}
@media (prefers-reduced-motion: reduce) { .pulse-dot { transition: none; } }
</style>
