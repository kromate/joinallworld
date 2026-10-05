<script setup lang="ts">
// The call screens: the confirmation of the first call, the incoming-call banner and the call bar.
// Loaded lazily by CallsHost.
import { computed, onBeforeUnmount, watch } from 'vue'
import './calls.css'
import { callStore } from './callState.ts'
import { startRinging, stopRinging } from './ringtone.ts'
import CallBar from './CallBar.vue'
import DisclosureConfirm from './DisclosureConfirm.vue'
import IncomingCall from './IncomingCall.vue'

defineProps<{ inDialog?: boolean }>()
const view = computed(() => callStore.view)
const incoming = computed(() => view.value.role === 'callee' && (view.value.phase === 'incoming' || view.value.phase === 'starting'))
const ringing = computed(() => view.value.phase === 'incoming')
watch(ringing, (on) => { if (on) startRinging(); else stopRinging() }, { immediate: true })
onBeforeUnmount(stopRinging)
</script>

<template>
  <div class="calls-layer" :class="{ 'is-in-dialog': inDialog }">
    <DisclosureConfirm v-if="callStore.confirm" :peer="callStore.confirm" />
    <IncomingCall v-else-if="incoming" :view="view" />
    <CallBar v-else-if="view.phase !== 'idle'" :view="view" />
  </div>
</template>

<style scoped>
.calls-layer { position: fixed; top: var(--calls-top, 68px); left: 50%; transform: translateX(-50%); width: min(420px, calc(100% - 24px)); z-index: 45; font-family: var(--font); display: grid; gap: 8px; pointer-events: none; }
.calls-layer.is-in-dialog { z-index: 14; }
.calls-layer > * { pointer-events: auto; }
@media (max-width: 720px) { .calls-layer { --calls-top: 64px; } }
</style>
