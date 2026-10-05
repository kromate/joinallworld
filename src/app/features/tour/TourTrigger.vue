<script setup lang="ts">
// The small part of the tour that is in the first download: it decides when the walkthrough is due, and fetches
// the walkthrough (and the shortcuts sheet) only when one of them is about to be shown.
//
// Due: once per player, after the first landing in the world (the creator finished, or Play now), when nothing else
// is in front: no sheet, no activity, no call, the venue view, the HUD drawn. Never for a life that has already
// played, or with Hints off. Phone → Help and Settings start it again ('jaw:tour'); ? opens the shortcuts ('jaw:shortcuts').
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { hintsOn } from '../sim/settingsModel.ts'
import { markTourSeen, tourDue, tourSeen } from './tourSeen.ts'
import { track, tour } from './tourState.ts'

const TourHost = defineAsyncComponent(() => import('./TourHost.vue'))
const ShortcutsSheet = defineAsyncComponent(() => import('./ShortcutsSheet.vue'))

/** After the arrival settles: the venue draws, the first toasts are read. */
const SETTLE_MS = 1500
const { game, shell, community } = useApp()
const running = ref(false)
const replay = ref(false)
const shortcuts = ref(false)
const held = new Set<string>()
let timer = 0
let tries = 0

function store(): Storage | null { try { return window.localStorage } catch { return null } }
const who = (): string => game.view.value.session?.id ?? ''
function hudReady(): boolean { return ['needs', 'hud'].every((id) => Boolean(document.querySelector(`[data-tour="${id}"]`)?.getClientRects().length)) }
function verdict(): 'start' | 'wait' | 'never' {
  const view = game.view.value
  const onboarding = view.onboarding
  return tourDue({
    connected: view.connected, creating: onboarding?.required === true, who: who(),
    activities: onboarding?.activities ?? 0, firstAt: onboarding?.timing?.firstAt ?? null,
    seen: held.has(who()) || tourSeen(store(), who()), hintsOff: !hintsOn(store()),
    busy: Boolean(shell.sheet.value) || Boolean(game.state.value.activeAction) || game.mode.value !== 'venue' || community.open.value || community.state.value?.voice.on === true || shortcuts.value || Boolean(document.querySelector('dialog[open]')),
    hudReady: hudReady(),
  })
}
function consider(): void {
  clearTimeout(timer)
  if (running.value) return
  const now = verdict()
  // Due and not started: everything that would compete with it waits. A HUD that never draws stops holding things back.
  tour.pending = now !== 'never' && game.view.value.connected && (now === 'start' || hudReady() || tries < 8)
  if (now === 'never') return
  // The HUD may still be drawing: look again a few times, once each, never in a loop.
  if (now === 'wait') { if (!hudReady() && tries++ < 8) timer = window.setTimeout(consider, 600); return }
  timer = window.setTimeout(() => { if (verdict() === 'start') begin(false) }, SETTLE_MS)
}
function begin(again: boolean): void {
  if (running.value) return
  tour.pending = false
  held.add(who())
  markTourSeen(store(), who())
  replay.value = again
  running.value = true
}
function onTour(): void {
  if (running.value) return
  shortcuts.value = false
  shell.closeSheet(); shell.setMode('venue'); shell.ui.clean = false; shell.ui.trayOpen = false
  void nextTick(() => { tries = 0; begin(true) })
}
function onShortcuts(event: Event): void {
  if (running.value) return
  if (shortcuts.value) { shortcuts.value = false; return }
  const from = (event as CustomEvent<{ from?: string }>).detail?.from
  shortcuts.value = true
  track('shortcuts_opened', { from: from === 'help' || from === 'tour' ? from : 'key' })
}

watch([() => game.view.value.connected, () => game.view.value.onboarding?.required, shell.sheet, game.mode, () => Boolean(game.state.value.activeAction), () => game.view.value.session?.id], () => { tries = 0; void nextTick(consider) }, { flush: 'post' })
onMounted(() => {
  window.addEventListener('jaw:tour', onTour)
  window.addEventListener('jaw:shortcuts', onShortcuts)
  consider()
})
onBeforeUnmount(() => { clearTimeout(timer); window.removeEventListener('jaw:tour', onTour); window.removeEventListener('jaw:shortcuts', onShortcuts) })
</script>

<template>
  <TourHost v-if="running" :replay="replay" @end="running = false" />
  <ShortcutsSheet v-if="shortcuts" @close="shortcuts = false" />
</template>
