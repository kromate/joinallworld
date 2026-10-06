<script setup lang="ts">
// The call screens, loaded lazily by CallsHost: the confirmation of the first call, the call card (ringing, incoming,
// connecting), the pill (in the call), the summary, and the quiet line for a call on another device. It also plays the
// call tones for each change of phase, and stops them the instant the call is answered, ended or this page goes away.
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import './calls.css'
import { cityName } from '../../../game/cities/registry.ts'
import { social } from '../social/useSocial.ts'
import { useApp } from '../../state/app.ts'
import { callStore } from './callState.ts'
import { loadedCalls } from './callsLoader.ts'
import { alertIncoming, closeCallAudio, playTone, startIncomingRing, startRingback, stopTones } from './callTones.ts'
import { isFounder, whereText } from './callFormat.ts'
import type { FriendView } from './callFormat.ts'
import CallCard from './CallCard.vue'
import CallEnded from './CallEnded.vue'
import CallLine from './CallLine.vue'
import CallPill from './CallPill.vue'
import DisclosureConfirm from './DisclosureConfirm.vue'

defineProps<{ inDialog?: boolean }>()
const { game } = useApp()
const view = computed(() => callStore.view)
const phase = computed(() => view.value.phase)
const friend = computed<FriendView | undefined>(() => social.me?.friends.find((item) => item.id === view.value.peer?.id))
const where = computed(() => whereText(friend.value, (id) => game.view.value.venues.find((venue) => venue.id === id)?.label ?? id, (id) => cityName(id) ?? id))
const founder = computed(() => isFounder(view.value.peer, friend.value))
const showCard = computed(() => ['calling', 'ringing', 'incoming', 'starting', 'needs-tap', 'connecting'].includes(phase.value))
const showPill = computed(() => phase.value === 'connected' || phase.value === 'reconnecting')

// ---- tones: one place decides, from the phase the controller reports ----
const REFUSED = ['declined', 'busy', 'unreachable', 'unanswered', 'limited']
const BROKEN = ['failed', 'lost', 'mic', 'error']
watch(phase, (now, before) => {
  window.dispatchEvent(new CustomEvent('jaw:call-active', { detail: ['calling', 'ringing', 'incoming', 'starting', 'needs-tap', 'connecting', 'connected', 'reconnecting'].includes(now) }))
  // Only the device that carries the call makes sound; one that shows it on another device is silent at once.
  if (now === 'incoming') { startIncomingRing(); alertIncoming(view.value.peer?.name ?? 'Someone'); return }
  if (now === 'ringing') { startRingback(); return }
  stopTones()
  if (now === 'connected' && before === 'connecting') playTone('connected')
  else if (now === 'ended') {
    const outcome = view.value.outcome ?? 'ended'
    if (outcome === 'ended') playTone('ended')
    else if (REFUSED.includes(outcome)) playTone('declined')
    else if (BROKEN.includes(outcome)) playTone('failed')
  }
}, { immediate: true })

// ---- keys: Enter answers an incoming call, Esc declines or cancels one that has not connected (never while typing) ----
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName))
}
function keys(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'Enter' && phase.value === 'incoming' && !typing(event.target)) { event.preventDefault(); void loadedCalls()?.accept() }
  else if (event.key === 'Escape' && showCard.value && (event.target === document.body || !typing(event.target) || phase.value === 'incoming')) { event.preventDefault(); loadedCalls()?.hangup() }
}
const leave = (): void => closeCallAudio()
onMounted(() => { window.addEventListener('keydown', keys); window.addEventListener('pagehide', leave) })
onBeforeUnmount(() => { window.removeEventListener('keydown', keys); window.removeEventListener('pagehide', leave); stopTones(); window.dispatchEvent(new CustomEvent('jaw:call-active', { detail: false })) })
</script>

<template>
  <div class="calls-layer" :class="{ 'is-in-dialog': inDialog }">
    <DisclosureConfirm v-if="callStore.confirm" :peer="callStore.confirm" />
    <CallCard v-else-if="showCard" :view="view" :where="where" :founder="founder" />
    <CallEnded v-else-if="phase === 'ended'" :view="view" />
    <CallLine v-else-if="phase === 'elsewhere'" :view="view" />
  </div>
  <CallPill v-if="showPill && !callStore.confirm" :view="view" />
</template>

<style scoped>
.calls-layer { position: fixed; top: calc(var(--calls-top, 60px) + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); width: min(380px, calc(100% - 20px)); z-index: 70; font-family: var(--font); display: grid; gap: 8px; pointer-events: none; zoom: var(--ui-zoom, 1); }
.calls-layer.is-in-dialog { z-index: 14; }
.calls-layer > * { pointer-events: auto; }
@media (max-width: 720px) { .calls-layer { --calls-top: 56px; } }
</style>
