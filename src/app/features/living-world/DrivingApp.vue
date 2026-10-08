<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { DrivingControlPacket, DrivingLifecycleRequest, DrivingResponse, DrivingSessionView } from '../../../types/living-world.ts'
import type { DrivingInput, DrivingRoute, DrivingState } from '../../../game/living-world/driving.ts'
import { stepDriving } from '../../../game/living-world/driving.ts'
import type { Look } from '../../../types/life.ts'
import type { DrivingScene } from './drivingScene.ts'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const cityId = computed(() => game.view.value.cityId)
const contextKey = computed(() => JSON.stringify([cityId.value, game.state.value.location, game.view.value.session?.id ?? '']))
const canvas = ref<HTMLCanvasElement | null>(null)
const route = ref<DrivingRoute | null>(null)
const session = ref<DrivingSessionView | null>(null)
const serverState = ref<DrivingState | null>(null)
const assessment = ref<DrivingState['assessment']>('pending')
const feedback = ref('Loading the authored practice course…')
const busy = ref(false), active = ref(false), boarding = ref(false), online = ref(true), needsRefresh = ref(false), webglUnavailable = ref(false)
const retainedPass = ref(false)
type TouchControl = keyof DrivingInput | 'left' | 'right'
const touch = new Map<number, TouchControl>()
const keys = new Set<string>()
const held = ref<DrivingInput>({ throttle: 0, brake: 0, steer: 0 })
const scene = ref<DrivingScene | null>(null)
const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
let generation = 0, mounted = false, disposed = false, controlInFlight = false
let pauseAfterControl: { prior: DrivingSessionView; latest?: DrivingSessionView } | null = null
let sampleTimer = 0, flushTimer = 0, visualState: DrivingState | null = null
let pendingFrames: DrivingInput[] = [], observer: ResizeObserver | null = null

const canStart = computed(() => !busy.value && online.value && Boolean(scene.value) && !webglUnavailable.value && Boolean(game.view.value.session?.id) && Boolean(route.value) && (!session.value || complete.value) && assessment.value !== 'passed' && !retainedPass.value)
const canResume = computed(() => !busy.value && online.value && !needsRefresh.value && Boolean(scene.value) && !webglUnavailable.value && Boolean(session.value) && !active.value && !boarding.value && session.value?.state.status === 'paused')
const complete = computed(() => serverState.value?.status === 'complete')
const practiceLabel = 'Authored simulated practice course · not a mapped public road or real licence test.'
function responseCurrent(token: number, key: string): boolean { return !disposed && token === generation && key === contextKey.value }
function clearHeld(): void {
  keys.clear(); touch.clear(); held.value = { throttle: 0, brake: 0, steer: 0 }
  scene.value?.setInput(held.value)
  pendingFrames = []
  if (sampleTimer) window.clearInterval(sampleTimer); if (flushTimer) window.clearInterval(flushTimer)
  sampleTimer = flushTimer = 0
}
function updateHeld(): void {
  const values = [...touch.values()]
  const left = keys.has('ArrowLeft') || keys.has('a') || values.includes('left')
  const right = keys.has('ArrowRight') || keys.has('d') || values.includes('right')
  const throttle = keys.has('ArrowUp') || keys.has('w') || values.includes('throttle')
  const brake = keys.has('ArrowDown') || keys.has('s') || values.includes('brake')
  held.value = { throttle: throttle ? 1 : 0, brake: brake ? 1 : 0, steer: Number(right) - Number(left) }
  scene.value?.setInput(held.value)
}
function applyResponse(answer: DrivingResponse, token: number, key: string): boolean {
  if (!responseCurrent(token, key)) return false
  if (!answer || typeof answer.ok !== 'boolean' || !answer.course || typeof answer.course.id !== 'string') throw new Error('The practice lesson reply was incomplete.')
  if (!answer.ok) {
    const current = answer.session, previous = session.value
    if (current && current.cityId === cityId.value && current.location === game.state.value.location
      && (!previous || current.journeyId === previous.journeyId && current.revision >= previous.revision)) {
      session.value = current; serverState.value = current.state; assessment.value = current.state.assessment
      retainedPass.value = current.state.assessment === 'passed'
      visualState = current.state; scene.value?.present(current.state)
    }
    if (answer.code === 'assessment_retained') { retainedPass.value = true; feedback.value = 'Your passed assessment is retained by the server; this course will not replace it with another attempt.' }
    else feedback.value = answer.reason || 'The server returned the current lesson state; controls remain stopped until you review it.'
    online.value = true
    return false
  }
  route.value = answer.course
  if (answer.session) {
    const previous = session.value
    if (previous && previous.journeyId === answer.session.journeyId && answer.session.revision < previous.revision) return false
    retainedPass.value = answer.session.state.assessment === 'passed'
    session.value = answer.session; serverState.value = answer.session.state; assessment.value = answer.session.state.assessment
    if (!visualState || previous?.journeyId !== answer.session.journeyId || answer.session.revision >= (previous?.revision ?? -1)) visualState = answer.session.state
    scene.value?.present(visualState ?? answer.session.state)
  } else { retainedPass.value = false; session.value = null; serverState.value = null; visualState = null; assessment.value = 'pending' }
  feedback.value = answer.reason || answer.session?.state.feedback || 'Course ready. Start a lesson or explicitly resume your saved lesson.'
  online.value = true
  return true
}
async function createScene(token: number, key: string): Promise<void> {
  if (!canvas.value || !route.value || scene.value || webglUnavailable.value) return
  try {
    const { createDrivingScene } = await import('./drivingScene.ts')
    if (!responseCurrent(token, key) || !canvas.value || !route.value) return
    const look = game.state.value.look as Look
    const made = await createDrivingScene(canvas.value, route.value, look, reduced?.matches === true)
    if (!responseCurrent(token, key)) { made.dispose(); return }
    scene.value = made
    const rect = canvas.value.getBoundingClientRect(); made.resize(rect.width, rect.height)
    if (visualState) made.present(visualState)
  } catch {
    if (responseCurrent(token, key)) { webglUnavailable.value = true; feedback.value = '3D practice is unavailable on this device. You can still read the lesson status; no result was recorded.' }
  }
}
async function load(): Promise<void> {
  const token = generation, key = contextKey.value
  if (!game.view.value.session?.id) { feedback.value = 'Sign in to begin a server-tracked practice lesson.'; return }
  busy.value = true
  try {
    const answer = await game.client.api<DrivingResponse>(`/api/living-world/driving?city=${encodeURIComponent(cityId.value)}`)
    if (applyResponse(answer, token, key)) {
      needsRefresh.value = false
      // A server record found running after reload/uncertain delivery is stopped first;
      // only an explicit user action can resume it in this view.
      if (answer.session?.state.status === 'running') await lifecycle('pause', answer.session)
      if (session.value?.state.status === 'paused') needsRefresh.value = false
      await nextTick(); await createScene(token, key)
    }
  } catch (error) {
    if (responseCurrent(token, key)) { online.value = false; feedback.value = message(error, 'Offline: reconnect to load the practice course. No result was recorded.') }
  } finally { if (responseCurrent(token, key)) busy.value = false }
}
function message(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback }
function beginPresentation(): void {
  const current = session.value, journey = current?.journeyId, token = generation, key = contextKey.value
  if (!journey || !scene.value || current?.state.status !== 'running' || !online.value || document.hidden) return
  active.value = false; boarding.value = true
  startControls() // neutral frames keep server timeout refreshed while door/walk/seat animates
  scene.value.begin(() => {
    if (disposed || !responseCurrent(token, key) || document.hidden || !online.value || session.value?.journeyId !== journey || session.value.state.status !== 'running' || !boarding.value) {
      boarding.value = false; active.value = false; clearHeld(); return
    }
    boarding.value = false; active.value = true
    feedback.value = 'Ready. Follow the route and stop inside marked zones.'
  })
}

async function startLesson(): Promise<void> {
  if (!canStart.value) return
  const token = generation, key = contextKey.value; busy.value = true
  try {
    const answer = await game.client.api<DrivingResponse>('/api/living-world/driving/start', { method: 'POST', body: { cityId: cityId.value, requestId: game.newId() } })
    if (applyResponse(answer, token, key) && answer.session) beginPresentation()
  } catch (error) { if (responseCurrent(token, key)) { online.value = false; feedback.value = message(error, 'Offline: the lesson did not start. No result was recorded.') } }
  finally { if (responseCurrent(token, key)) busy.value = false }
}
async function lifecycle(action: 'resume' | 'pause', prior = session.value, allowLeaving = false, applyResult = true): Promise<void> {
  if (!prior) return
  const token = generation, key = contextKey.value
  const body: DrivingLifecycleRequest = { cityId: prior.cityId, journeyId: prior.journeyId, revision: prior.revision, requestId: game.newId() }
  try {
    const answer = await game.client.api<DrivingResponse>(`/api/living-world/driving/${action}`, { method: 'POST', body })
    if (applyResult && (allowLeaving || responseCurrent(token, key))) {
      if (answer.ok && answer.session && answer.session.revision >= prior.revision) {
        session.value = answer.session; serverState.value = answer.session.state; assessment.value = answer.session.state.assessment
        visualState = answer.session.state; scene.value?.present(answer.session.state)
        if (action === 'resume') beginPresentation()
        else { active.value = false; needsRefresh.value = false; feedback.value = answer.reason || 'Lesson paused safely. Resume when ready.' }
      } else if (!answer.ok && !allowLeaving) {
        applyResponse(answer, token, key); clearHeld(); active.value = false; boarding.value = false
        if (action === 'resume' && answer.session?.state.status === 'running') void lifecycle('pause', answer.session)
        if (action === 'pause') needsRefresh.value = true
        feedback.value = answer.reason || `Could not ${action} the lesson; the server's current state is shown.`
      }
      online.value = true
    }
  } catch (error) { if (!allowLeaving && responseCurrent(token, key)) { online.value = false; feedback.value = message(error, 'Offline: lesson state is uncertain. Controls stopped; reconnect before continuing.') } }
}
async function resumeLesson(): Promise<void> {
  if (!canResume.value || !session.value) return
  busy.value = true; clearHeld()
  try { await lifecycle('resume') } finally { busy.value = false }
}
async function pauseLesson(): Promise<void> {
  clearHeld(); active.value = false; boarding.value = false
  if (controlInFlight && session.value) { pauseAfterControl = { prior: session.value }; feedback.value = 'Stopping controls; the server will pause after its current reply.'; return }
  await lifecycle('pause')
}
function startControls(): void {
  clearHeld()
  sampleTimer = window.setInterval(() => {
    if ((!active.value && !boarding.value) || !visualState || !route.value) return
    const input = active.value ? { ...held.value } : { throttle: 0, brake: 1, steer: 0 }
    pendingFrames.push(input)
    if (pendingFrames.length > 5) pendingFrames.shift()
    if (active.value) { visualState = stepDriving(visualState, input, route.value).state; scene.value?.present(visualState) }
  }, 100)
  flushTimer = window.setInterval(() => { void sendFrames() }, 250)
}
async function sendFrames(): Promise<void> {
  const current = session.value
  if ((!active.value && !boarding.value) || !current || !pendingFrames.length || controlInFlight || !online.value) return
  const frames = pendingFrames.slice(-5); pendingFrames = []
  const packet: DrivingControlPacket = { cityId: current.cityId, journeyId: current.journeyId, sequence: current.nextSequence, frames }
  const token = generation, key = contextKey.value
  controlInFlight = true
  try {
    const answer = await game.client.api<DrivingResponse>('/api/living-world/driving/input', { method: 'POST', body: packet })
    if (pauseAfterControl?.prior.journeyId === current.journeyId && answer.session?.journeyId === current.journeyId && answer.session.revision >= pauseAfterControl.prior.revision) pauseAfterControl.latest = answer.session
    if (responseCurrent(token, key) && answer.ok && answer.session && answer.session.journeyId === current.journeyId && answer.session.revision >= current.revision) {
      applyResponse(answer, token, key)
      if (answer.session.state.status === 'complete') { clearHeld(); active.value = false; scene.value?.exit(); feedback.value = answer.session.state.feedback }
      else if (answer.session.state.status !== 'running') { clearHeld(); active.value = false; boarding.value = false; feedback.value = answer.session.state.feedback || 'The server paused this lesson. Review its state before resuming.' }
    } else if (responseCurrent(token, key) && !answer.ok) {
      applyResponse(answer, token, key); clearHeld(); active.value = false; boarding.value = false
      if (answer.session?.state.status === 'running') void lifecycle('pause', answer.session)
      if (answer.code === 'assessment_retained') feedback.value = 'Your passed assessment is retained by the server; this course will not replace it with another attempt.'
    }
  } catch (error) {
    if (responseCurrent(token, key)) {
      clearHeld(); active.value = false; boarding.value = false; online.value = false
      feedback.value = message(error, 'Delivery was uncertain. Controls stopped; reconnect before resuming. No local result counts.')
    }
  } finally {
    controlInFlight = false
    if (pauseAfterControl) { const queued = pauseAfterControl; pauseAfterControl = null; void lifecycle('pause', queued.latest ?? queued.prior, true, false) }
    // The buffer is a rolling window of at most five 100 ms frames, so old input is bounded and discarded.
  }
}

function onKey(event: KeyboardEvent, down: boolean): void {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(key) || !active.value) return
  const target = event.target as HTMLElement | null
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target?.tagName ?? '')) return
  event.preventDefault()
  if (down) keys.add(key); else keys.delete(key)
  updateHeld()
}
function touchDown(control: TouchControl, event: PointerEvent): void {
  if (!active.value) return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId); touch.set(event.pointerId, control); updateHeld()
}
function touchUp(event: PointerEvent): void { touch.delete(event.pointerId); updateHeld() }
function visibility(): void {
  if (document.hidden) { clearHeld(); scene.value?.setVisible(false); if (active.value || boarding.value) void pauseLesson() }
  else scene.value?.setVisible(true)
}
function resize(): void { if (!canvas.value || !scene.value) return; const box = canvas.value.getBoundingClientRect(); scene.value.resize(box.width, box.height) }
function reducedChanged(): void { scene.value?.setReducedMotion(reduced?.matches === true) }
watch(contextKey, async () => {
  const old = session.value
  clearHeld(); active.value = false; boarding.value = false; generation++
  retainedPass.value = false; webglUnavailable.value = false; assessment.value = 'pending'; online.value = true
  scene.value?.dispose(); scene.value = null; route.value = null; session.value = null; serverState.value = null; visualState = null
  if (old && old.state.status === 'running') {
    if (controlInFlight) pauseAfterControl = { prior: old }
    else void lifecycle('pause', old, true, false)
  }
  if (mounted) await load()
})
onMounted(() => {
  mounted = true; disposed = false
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', windowBlur)
  document.addEventListener('visibilitychange', visibility)
  reduced?.addEventListener?.('change', reducedChanged)
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(resize); if (canvas.value) observer.observe(canvas.value) }
  void load()
})
function keyDown(event: KeyboardEvent): void { onKey(event, true) }
function keyUp(event: KeyboardEvent): void { onKey(event, false) }
function windowBlur(): void { clearHeld(); if (active.value || boarding.value) void pauseLesson() }
onBeforeUnmount(() => {
  const prior = session.value
  if ((active.value || boarding.value) && prior) {
    clearHeld(); active.value = false; boarding.value = false
    // Try to pause on close; the server still owns elapsed-time checks and the resulting state.
    if (controlInFlight) pauseAfterControl = { prior }
    else void lifecycle('pause', prior, true, false)
  }
  disposed = true; mounted = false; generation++
  clearHeld(); observer?.disconnect(); observer = null
  window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', windowBlur)
  document.removeEventListener('visibilitychange', visibility); reduced?.removeEventListener?.('change', reducedChanged)
  scene.value?.dispose(); scene.value = null
})
</script>

<template>
  <main class="driving-app" aria-label="Driving practice">
    <p class="practice-label">{{ practiceLabel }}</p>
    <div class="driving-view" :class="{ 'is-flat': webglUnavailable }">
      <canvas ref="canvas" aria-hidden="true" />
      <p v-if="webglUnavailable" class="scene-fallback">3D scene unavailable. Lesson controls and server status remain available.</p>
      <p class="course-caption">{{ route?.id ?? 'Practice course' }} · server-tracked checkpoint lesson</p>
    </div>
    <section class="lesson-status" aria-live="polite">
      <strong>{{ complete ? (assessment === 'passed' ? 'Practice passed' : 'Practice needs another try') : boarding ? 'Getting into the car' : active ? 'Lesson in progress' : session ? 'Saved lesson' : 'Ready to practise' }}</strong>
      <p>{{ feedback }}</p>
      <small v-if="serverState">Server assessment: {{ assessment }} · checkpoint {{ Math.min(serverState.checkpointIndex + 1, route?.checkpoints.length ?? 1) }} of {{ route?.checkpoints.length ?? '—' }}. This result comes only from the server.</small>
      <small v-if="retainedPass || (complete && assessment === 'passed')">This passed result is retained; this course will not replace it with another attempt.</small>
    </section>
    <div class="lesson-actions">
      <button v-if="(!session && !retainedPass) || (complete && assessment !== 'passed')" type="button" :disabled="!canStart" @click="startLesson">{{ busy ? 'Loading…' : complete ? 'Practise again' : 'Start practice' }}</button>
      <button v-else-if="canResume" type="button" :disabled="busy" @click="resumeLesson">{{ busy ? 'Resuming…' : 'Resume saved lesson' }}</button>
      <button v-if="active || boarding" type="button" class="secondary" @click="pauseLesson">Pause safely</button>
      <button v-if="!online || needsRefresh" type="button" class="secondary" :disabled="busy" @click="load">Reconnect and check lesson</button>
      <button type="button" class="secondary" @click="shell.close()">Close</button>
    </div>
    <section class="controls" aria-label="Driving controls" :aria-disabled="!active">
      <div class="wheel-controls" aria-label="Steering">
        <button type="button" aria-label="Steer left" :disabled="!active" @pointerdown.prevent="touchDown('left', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">←</button>
        <button type="button" aria-label="Steer right" :disabled="!active" @pointerdown.prevent="touchDown('right', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">→</button>
      </div>
      <button type="button" class="drive-control throttle" aria-label="Hold to accelerate" :disabled="!active" @pointerdown.prevent="touchDown('throttle', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">Throttle</button>
      <button type="button" class="drive-control brake" aria-label="Hold to brake" :disabled="!active" @pointerdown.prevent="touchDown('brake', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">Brake</button>
    </section>
    <p class="control-help">Keyboard: WASD or arrow keys. On touch screens, hold the steering, throttle and brake controls. The course is fictional and for practice only.</p>
  </main>
</template>

<style scoped>
.driving-app { display: grid; gap: 12px; color: var(--c-ink, #202830); }
.practice-label, .control-help { margin: 0; color: var(--c-muted, #5d6870); font-size: 12px; line-height: 1.45; }
.driving-view { position: relative; overflow: hidden; height: clamp(230px, 42vh, 410px); min-height: 220px; border-radius: 14px; background: #d8e8ee; }
.driving-view canvas { display: block; width: 100%; height: 100%; }
.course-caption { position: absolute; inset: auto 10px 8px; margin: 0; padding: 5px 8px; border-radius: 8px; background: #132431d9; color: white; font-size: 11px; }
.scene-fallback { position: absolute; inset: 25% 12px auto; text-align: center; color: #27333a; font-size: 13px; }
.lesson-status { padding: 12px; border-radius: 12px; background: color-mix(in srgb, var(--app-tint, #3783a4) 7%, white); }
.lesson-status strong { display: block; font-size: 15px; }
.lesson-status p { margin: 5px 0; line-height: 1.4; font-size: 13px; }
.lesson-status small { display: block; font-size: 11px; line-height: 1.45; color: var(--c-muted, #5d6870); }
.lesson-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.lesson-actions button, .controls button { min-width: 44px; min-height: 44px; padding: 9px 13px; border: 0; border-radius: 10px; background: #216d84; color: white; font: inherit; font-weight: 700; touch-action: none; }
.lesson-actions button.secondary { background: #e7edf0; color: #25323a; }
button:disabled { opacity: .48; }
.controls { display: grid; grid-template-columns: 1fr 1fr; align-items: stretch; gap: 10px; }
.wheel-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; grid-column: 1 / -1; }
.wheel-controls button { font-size: 21px; }
.controls .drive-control { min-height: 58px; }
.controls .throttle { background: #26764e; }
.controls .brake { background: #a33e3a; }
@media (min-width: 720px) { .driving-app { max-width: 780px; margin: auto; } .driving-view { height: 390px; } .controls { grid-template-columns: 1fr 1fr 1fr; } .wheel-controls { grid-column: auto; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
</style>
