<script setup lang="ts">
// The floating call bar. It stays on screen while you play: who, how long, mute, microphone choice, hang up.
// Before the call connects it says what is happening (Calling, Tap to start your microphone, Connecting), and after it
// ends it says why for a few seconds.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CallView } from '../../../calls.ts'
import { NO_CONNECTION_TEXT } from '../../../calls.ts'
import { loadedCalls } from './callsLoader.ts'

const props = defineProps<{ view: CallView }>()
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (tick !== null) clearInterval(tick) })

const name = computed(() => props.view.peer?.name ?? 'them')
const clock = computed(() => {
  if (props.view.startedAt === null) return ''
  const seconds = Math.max(0, Math.floor((now.value - props.view.startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const line = computed(() => {
  switch (props.view.phase) {
    case 'calling': return `Calling ${name.value}…`
    case 'ringing': return `Calling ${name.value}…`
    case 'needs-tap': return `${name.value} answered.`
    case 'starting': return 'Opening your microphone…'
    case 'connecting': return `Connecting to ${name.value}…`
    case 'reconnecting': return 'Reconnecting…'
    case 'connected': return name.value
    default: return props.view.notice ?? ''
  }
})
const live = computed(() => ['connecting', 'connected', 'reconnecting'].includes(props.view.phase))
const waiting = computed(() => ['calling', 'ringing'].includes(props.view.phase))
const failed = computed(() => props.view.phase === 'ended' && props.view.notice === NO_CONNECTION_TEXT)
const choices = computed(() => (props.view.devices && props.view.devices.length > 2 ? props.view.devices : null))

const controller = () => loadedCalls()
</script>

<template>
  <section class="call-card is-bar" :class="`is-${view.phase}`" role="region" aria-label="Call" data-call="bar">
    <div class="call-who">
      <span v-if="waiting || view.phase === 'connecting' || view.phase === 'reconnecting'" class="call-pulse" aria-hidden="true" />
      <div class="call-text" role="status" aria-live="polite">
        <p class="call-title">{{ line }}</p>
        <p v-if="view.phase === 'connected'" class="call-sub">{{ clock }}<template v-if="view.muted"> · Muted</template></p>
        <p v-else-if="view.phase === 'needs-tap'" class="call-sub">Tap to start your microphone.</p>
        <p v-else-if="failed" class="call-note">Calls need a direct path between two devices. Some networks, such as work or school networks and some mobile networks, do not allow it. Try another network.</p>
      </div>
    </div>
    <p v-if="view.error" class="call-error" role="alert">{{ view.error }}</p>
    <div v-if="view.phase !== 'ended'" class="call-actions">
      <button v-if="view.phase === 'needs-tap'" type="button" class="call-btn is-primary" data-call="start" @click="controller()?.startMicrophone()">Start microphone</button>
      <button v-if="live" type="button" class="call-btn" :aria-pressed="view.muted" data-call="mute" @click="controller()?.toggleMute()">{{ view.muted ? 'Unmute' : 'Mute' }}</button>
      <button v-if="view.playBlocked" type="button" class="call-btn" data-call="hear" @click="controller()?.playAudio()">Tap to hear {{ name }}</button>
      <label v-if="choices && live" class="call-device"><span class="call-sr">Microphone</span>
        <select :value="view.selectedDevice" aria-label="Microphone" @change="controller()?.selectDevice(($event.target as HTMLSelectElement).value)"><option v-for="item in choices" :key="item.id" :value="item.id">{{ item.label }}</option></select>
      </label>
      <button type="button" class="call-btn is-danger" data-call="hangup" @click="controller()?.hangup()">{{ waiting ? 'Cancel' : 'Hang up' }}</button>
    </div>
    <div v-else class="call-actions"><button type="button" class="call-btn" data-call="dismiss" @click="controller()?.dismiss()">OK</button></div>
  </section>
</template>
