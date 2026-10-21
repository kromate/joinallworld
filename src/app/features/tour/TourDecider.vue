<script setup lang="ts">
// The part of the tour that decides when the walkthrough is due, and fetches the walkthrough (and the shortcuts sheet) only when one
// of them is about to be shown. TourTrigger.vue, which is in the first download, fetches this once a walkthrough may be due or one is asked for.
//
// Due: once per player, after the first landing in the world (the creator finished, or Play now), when nothing else
// is in front: no sheet, no activity, no call, the venue view, the HUD drawn. Never for a life that has already
// played, or with Hints off. Phone → Help and Settings start it again ('jaw:tour'); ? opens the shortcuts ('jaw:shortcuts').
// When it is due by itself, the first-minute strip takes its turn instead (handOff below); asked for, it runs as before.
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { coachHints } from '../hud/coachModel.ts'
import { markTourSeen, tourDue, tourSeen } from './tourSeen.ts'
import { track, tour } from './tourState.ts'
import type { TourId } from '../companion/types.ts'

const emit = defineEmits<{ ready: [] }>()
const TourHost = defineAsyncComponent(() => import('./TourHost.vue'))
const ShortcutsSheet = defineAsyncComponent(() => import('./ShortcutsSheet.vue'))

/** After the arrival settles: the venue draws, the first toasts are read. */
const SETTLE_MS = 1500
/** The walkthrough does not open within this long of the player's last tap, key press or touch: they are in the middle of something. */
const IDLE_MS = 4000
const { game, shell, community } = useApp()
const running = ref(false)
const replay = ref(false)
const which = ref<TourId>('basics')
const shortcuts = ref(false)
const held = new Set<string>()
let timer = 0
let tries = 0
let lastInput = 0
const INPUTS = ['pointerdown', 'keydown', 'touchstart'] as const
const noteInput = (): void => { lastInput = Date.now() }

function store(): Storage | null { try { return window.localStorage } catch { return null } }
const who = (): string => game.view.value.session?.id ?? ''
function hudReady(): boolean { return ['needs', 'hud'].every((id) => Boolean(document.querySelector(`[data-tour="${id}"]`)?.getClientRects().length)) }
function verdict(): 'start' | 'wait' | 'never' {
  const view = game.view.value
  const onboarding = view.onboarding
  return tourDue({
    connected: view.connected, creating: onboarding?.required === true, who: who(),
    activities: onboarding?.activities ?? 0, firstAt: onboarding?.timing?.firstAt ?? null,
    seen: held.has(who()) || tourSeen(store(), who()), hintsOff: !coachHints.value,
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
  timer = window.setTimeout(startWhenIdle, SETTLE_MS)
}
/** Open the walkthrough only at an idle moment; while the player is busy tapping, look again shortly (each look is one timer, and it stops when the walkthrough is no longer due). */
function startWhenIdle(): void {
  if (verdict() !== 'start') return
  const quiet = Date.now() - lastInput
  if (quiet < IDLE_MS) { timer = window.setTimeout(startWhenIdle, IDLE_MS - quiet + 250); return }
  handOff()
}
/**
 * A new player's first minute is the first-minute strip's (features/firstminute, docs/FEED.md "First minute"): one social action instead of
 * the walkthrough, which stays one tap away (the strip's "Show me around", Phone → Help, ?). Marked seen as if it had run; the things that
 * wait for the tour wait until the strip's code is here, so the strip is first. A strip that cannot be fetched gives the walkthrough back.
 */
function handOff(): void {
  held.add(who())
  markTourSeen(store(), who())
  void import('../firstminute/startFirstMinute.ts').then(({ startFirstMinute }) => { startFirstMinute(true); tour.pending = false }, () => { begin(false) })
}
function begin(again: boolean): void {
  if (running.value) return
  tour.pending = false
  held.add(who())
  markTourSeen(store(), who())
  replay.value = again
  if (!again) which.value = 'basics'
  running.value = true
}
function onTour(event?: Event): void {
  if (running.value) return
  which.value = (event as CustomEvent<{ tour?: TourId }> | undefined)?.detail?.tour ?? 'basics'
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

watch([coachHints, () => game.view.value.connected, () => game.view.value.onboarding?.required, shell.sheet, game.mode, () => Boolean(game.state.value.activeAction), () => game.view.value.session?.id], () => { tries = 0; void nextTick(consider) }, { flush: 'post' })
onMounted(() => {
  window.addEventListener('jaw:tour', onTour as EventListener)
  window.addEventListener('jaw:shortcuts', onShortcuts)
  for (const name of INPUTS) window.addEventListener(name, noteInput, { capture: true, passive: true })
  consider()
  emit('ready')
})
onBeforeUnmount(() => { for (const name of INPUTS) window.removeEventListener(name, noteInput, { capture: true }); clearTimeout(timer); window.removeEventListener('jaw:tour', onTour as EventListener); window.removeEventListener('jaw:shortcuts', onShortcuts) })
</script>

<template>
  <TourHost v-if="running" :replay="replay" :tour="which" @end="running = false" />
  <ShortcutsSheet v-if="shortcuts" @close="shortcuts = false" />
</template>
