<script setup lang="ts">
// The only part of the tour in the first download. The deciding part (TourDecider.vue) is fetched when a walkthrough may be due for this
// player (not seen, hints on, nothing played yet) or when one is asked for: Phone → Help and Settings ('jaw:tour'), or the ? key
// ('jaw:shortcuts'). A request that arrives while it is being fetched is kept and sent again once it is listening.
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { coachHints } from '../hud/coachModel.ts'
import { tourDue, tourSeen } from './tourSeen.ts'
import { tour } from './tourState.ts'

const TourDecider = defineAsyncComponent(() => import('./TourDecider.vue'))
const { game } = useApp()
const loaded = ref(false)
const asked: Event[] = []

function mayBeDue(): boolean {
  const view = game.view.value, who = view.session?.id ?? ''
  let store: Storage | null = null
  try { store = window.localStorage } catch { /* no storage: nothing is remembered as seen */ }
  const onboarding = view.onboarding
  return tourDue({
    connected: view.connected, creating: onboarding?.required === true, who, activities: onboarding?.activities ?? 0, firstAt: onboarding?.timing?.firstAt ?? null,
    seen: tourSeen(store, who), hintsOff: !coachHints.value, busy: false, hudReady: true,
  }) !== 'never'
}
function check(): void {
  if (loaded.value) return
  if (mayBeDue()) {
    // The things that would compete with the walkthrough wait from the first moment it may be due, not from when its code arrives.
    tour.pending = game.view.value.connected
    loaded.value = true
  }
}
function ask(event: Event): void {
  asked.push(new CustomEvent(event.type, { detail: (event as CustomEvent).detail }))
  loaded.value = true
}
function stopAsking(): void { window.removeEventListener('jaw:tour', ask); window.removeEventListener('jaw:shortcuts', ask) }
/** The deciding part is listening now: it takes over from here, and what was asked meanwhile is sent to it. */
function ready(): void { stopAsking(); for (const event of asked.splice(0)) window.dispatchEvent(event) }

watch([coachHints, () => game.view.value.connected, () => game.view.value.onboarding?.required, () => game.view.value.session?.id], check)
onMounted(() => {
  window.addEventListener('jaw:tour', ask)
  window.addEventListener('jaw:shortcuts', ask)
  check()
})
onBeforeUnmount(stopAsking)
</script>

<template>
  <TourDecider v-if="loaded" @ready="ready" />
</template>
