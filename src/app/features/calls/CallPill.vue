<script setup lang="ts">
// The call in progress: a small pill that floats over the game, so the player keeps walking and playing. It can be dragged
// (it settles against the nearest side) and opened for more: the microphone level, who is heard, microphone and speaker
// choice, and how the audio is travelling. Muted is shown three ways (the button, a red outline, and a banner) because a
// silent player is the commonest reason a call seems broken.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { CallView } from '../../../calls.ts'
import { clockText, hueOf, initialOf } from './callFormat.ts'
import { loadedCalls } from './callsLoader.ts'
import CallIcons from './CallIcons.vue'

const props = defineProps<{ view: CallView }>()
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (tick !== null) clearInterval(tick) })

const open = ref(false)
const details = ref(false)
const name = computed(() => props.view.peer?.name ?? 'them')
const reconnecting = computed(() => props.view.phase === 'reconnecting')
const clock = computed(() => (props.view.startedAt === null ? '0:00' : clockText(now.value - props.view.startedAt)))
const qualityWord = computed(() => (reconnecting.value ? 'Reconnecting…' : props.view.quality === 'weak' ? 'Weak connection' : 'Good connection'))
const qualityClass = computed(() => (reconnecting.value ? 'is-reconnecting' : props.view.quality === 'weak' ? 'is-weak' : 'is-good'))
const micChoices = computed(() => (props.view.devices && props.view.devices.length > 2 ? props.view.devices : null))
const pathWord = computed(() => (props.view.path === 'relay' ? 'Audio is going through a relay server (the direct route was not possible).' : props.view.path === 'direct' ? 'Audio is going directly between your devices.' : 'Checking the route…'))
const controller = () => loadedCalls()

// ---- dragging: the position is the pill's own, in pixels from the left and top; it settles to the nearest side ----
const spot = reactive<{ x: number | null; y: number | null }>({ x: null, y: null })
const el = ref<HTMLElement | null>(null)
let drag: { dx: number; dy: number; moved: boolean; id: number } | null = null
function down(event: PointerEvent): void {
  const box = el.value?.getBoundingClientRect()
  if (!box) return
  drag = { dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false, id: event.pointerId }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}
function move(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return
  const box = el.value?.getBoundingClientRect()
  if (!box) return
  if (!drag.moved && Math.abs(event.clientX - drag.dx - box.left) + Math.abs(event.clientY - drag.dy - box.top) < 6) return
  drag.moved = true
  spot.x = Math.min(Math.max(8, event.clientX - drag.dx), window.innerWidth - box.width - 8)
  spot.y = Math.min(Math.max(8, event.clientY - drag.dy), window.innerHeight - box.height - 8)
}
function up(event: PointerEvent): void {
  if (!drag) return
  const moved = drag.moved
  drag = null
  const box = el.value?.getBoundingClientRect()
  if (moved && box) spot.x = box.left + box.width / 2 < window.innerWidth / 2 ? 8 : window.innerWidth - box.width - 8
  else if (event.type === 'pointerup') open.value = !open.value
}
function key(event: KeyboardEvent): void { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open.value = !open.value } }
const style = computed(() => (spot.x === null || spot.y === null ? {} : { left: `${spot.x}px`, top: `${spot.y}px`, right: 'auto' }))
</script>

<template>
  <section ref="el" class="call-pill" :class="[qualityClass, { 'is-muted': view.muted }]" :style="style" role="region" aria-label="Call in progress" data-call="pill">
    <div class="call-pill-row">
      <div class="call-pill-body" role="button" tabindex="0" :aria-expanded="open" aria-label="Call details. Drag to move." data-call="expand" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown="key">
        <span class="call-mini" :style="{ background: `hsl(${hueOf(name)} 45% 38%)` }" aria-hidden="true">{{ initialOf(name) }}</span>
        <span class="call-pill-text"><b>{{ name }}</b><small data-call="clock"><span class="call-quality"><span class="call-dot" aria-hidden="true" /> {{ reconnecting ? 'Reconnecting…' : clock }}</span><template v-if="view.muted && !reconnecting"> · Muted</template></small></span>
      </div>
      <button type="button" class="call-icon" :class="{ 'is-off': view.muted }" :aria-pressed="view.muted" :aria-label="view.muted ? 'Unmute microphone' : 'Mute microphone'" data-call="mute" @click="controller()?.toggleMute()"><CallIcons :name="view.muted ? 'mic-off' : 'mic'" /></button>
      <button type="button" class="call-icon is-end" aria-label="Hang up" data-call="hangup" @click="controller()?.hangup()"><CallIcons name="hangup" /></button>
    </div>
    <p v-if="view.muted" class="call-muted-banner" data-call="muted-banner">You are muted. {{ name }} cannot hear you.</p>
    <button v-if="view.playBlocked" type="button" class="call-btn is-primary" data-call="hear" @click="controller()?.playAudio()">Tap to hear {{ name }}</button>
    <p v-if="view.error" class="call-error" role="alert" data-call="error">{{ view.error }}</p>
    <button v-if="view.error && view.mic === 'problem'" type="button" class="call-btn" data-call="retry" @click="controller()?.startMicrophone()">Try again</button>
    <div v-if="open" class="call-panel" data-call="panel">
      <p class="call-level" data-call="level"><span>{{ view.muted ? 'Muted' : 'You' }}</span>
        <i aria-hidden="true"><s v-for="n in 5" :key="n" :class="{ 'is-on': n <= view.micLevel }" /></i>
        <span class="call-sr" aria-live="off">Microphone level {{ view.micLevel }} of 5</span></p>
      <p class="call-details" data-call="quality">{{ qualityWord }}</p>
      <label v-if="micChoices" class="call-field">Microphone
        <select :value="view.selectedDevice" aria-label="Microphone" @change="controller()?.selectDevice(($event.target as HTMLSelectElement).value)"><option v-for="item in micChoices" :key="item.id" :value="item.id">{{ item.label }}</option></select>
      </label>
      <label v-if="view.outputs" class="call-field">Speaker
        <select :value="view.selectedOutput" aria-label="Speaker" data-call="output" @change="controller()?.selectOutput(($event.target as HTMLSelectElement).value)"><option v-for="item in view.outputs" :key="item.id" :value="item.id">{{ item.label }}</option></select>
      </label>
      <button type="button" class="call-link" :aria-expanded="details" data-call="details" @click="details = !details">{{ details ? 'Hide details' : 'Details' }}</button>
      <template v-if="details">
        <p class="call-details" data-call="path">{{ pathWord }}</p>
        <p v-if="view.awake === 'on'" class="call-details">Your screen is kept on during the call.</p>
        <p v-else-if="view.awake === 'off'" class="call-details" data-call="awake">This browser cannot keep the screen on. If you lock your phone, the call may pause until you open it again.</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.call-pill { top: calc(var(--calls-top, 60px)); right: max(8px, env(safe-area-inset-right)); }
</style>
