<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { DrivingControlPacket, DrivingLifecycleRequest, DrivingResponse, DrivingSessionView, QualificationClaimRequest, QualificationResponse } from '../../../types/living-world.ts'
import type { DrivingInput, DrivingRoute, DrivingState } from '../../../game/living-world/driving.ts'
import { stepDriving } from '../../../game/living-world/driving.ts'
import type { Look } from '../../../types/life.ts'
import type { DrivingScene } from './drivingScene.ts'
import { validQualificationReply } from './qualificationReply.ts'

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
const qualificationReply = ref<QualificationResponse | null>(null)
const qualificationJourney = ref<string | null>(null)
const qualificationMessage = ref('Checking simulated qualification status…')
const qualificationBusy = ref(false)
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
let qualificationRequest = 0
type ResponseOrigin = { kind: 'load' | 'start' | 'control' | 'lifecycle'; expectedJourney?: string }

const canStart = computed(() => !busy.value && online.value && !needsRefresh.value && Boolean(scene.value) && !webglUnavailable.value && Boolean(game.view.value.session?.id) && Boolean(route.value) && (!session.value || complete.value) && assessment.value !== 'passed' && !retainedPass.value)
const canResume = computed(() => !busy.value && online.value && !needsRefresh.value && Boolean(scene.value) && !webglUnavailable.value && Boolean(session.value) && !active.value && !boarding.value && session.value?.state.status === 'paused')
const complete = computed(() => serverState.value?.status === 'complete')
const dashboard = computed(() => {
  const course = route.value, saved = serverState.value
  if (!course) return {
    speed: '—', limit: '—', distance: '—', target: 'No course', action: 'The practice course is unavailable.', state: 'Course unavailable',
  }
  if (!saved) return {
    speed: '—', limit: `${(course.speedLimit * 3.6).toFixed(1)} km/h`, distance: '—', target: 'No active target',
    action: 'Start practice to see server-confirmed gauges.', state: 'Waiting for saved lesson state',
  }
  if (saved.status === 'complete') return {
    speed: `${(saved.speed * 3.6).toFixed(1)} km/h`, limit: `${(course.speedLimit * 3.6).toFixed(1)} km/h`, distance: '—', target: 'No remaining target',
    action: saved.assessment === 'passed' ? 'Practice complete; the server saved a pass.' : 'Practice complete; review the result before trying again.',
    state: saved.assessment === 'passed' ? 'Practice complete · passed' : 'Practice complete · try again',
  }
  const stoppedAction = saved.status === 'paused' ? 'Paused. Explicitly resume before driving.'
    : !online.value || needsRefresh.value ? 'Controls are stopped. Reconnect and check the saved lesson before continuing.'
      : boarding.value ? 'Wait for the car entry animation to finish before using the controls.'
        : !active.value ? 'Controls are stopped. Check the saved lesson before driving.' : ''
  const savedGaugeLabel = saved.status === 'paused' ? 'Lesson paused · saved gauges'
    : stoppedAction ? 'Last server-confirmed gauges' : 'Server-confirmed gauges'
  const checkpoint = course.checkpoints[saved.checkpointIndex]
  if (!checkpoint) return {
    speed: `${(saved.speed * 3.6).toFixed(1)} km/h`, limit: `${(course.speedLimit * 3.6).toFixed(1)} km/h`, distance: '—', target: 'No current target',
    action: stoppedAction || 'The saved checkpoint target is unavailable; reconnect to check the lesson.',
    state: stoppedAction ? savedGaugeLabel : 'Target unavailable',
  }
  const centerDistance = Math.hypot(saved.position.x - checkpoint.center.x, saved.position.z - checkpoint.center.z)
  const zoneDistance = Math.max(0, centerDistance - checkpoint.radius)
  const distance = `${zoneDistance.toFixed(1)} m`
  const target = checkpoint.stopRequired ? 'Full-stop target' : 'Pass-through target'
  let action: string
  if (stoppedAction) {
    action = saved.status === 'paused' && saved.checkpointEntry === 'blocked'
      ? `${stoppedAction} Then leave this zone before approaching it again.`
      : stoppedAction
  } else if (saved.checkpointEntry === 'blocked') {
    action = 'Leave this zone, then approach it again to record the checkpoint.'
  } else if (checkpoint.stopRequired) {
    action = saved.checkpointEntry === 'entered'
      ? 'Brake and hold inside the marked zone; the server will confirm the stop.'
      : 'Enter the marked zone and brake to a full stop.'
  } else {
    action = 'Drive through the marked zone in checkpoint order.'
  }
  return {
    speed: `${(saved.speed * 3.6).toFixed(1)} km/h`, limit: `${(course.speedLimit * 3.6).toFixed(1)} km/h`, distance, target, action,
    state: savedGaugeLabel,
  }
})
const validQualification = computed(() => {
  const answer = qualificationReply.value, qualification = answer?.qualification, current = session.value
  let evidenceMatchesPass = true
  if (current && current.state.status === 'complete' && current.state.assessment === 'passed') evidenceMatchesPass = qualification?.evidenceJourneyId === current.journeyId
  return answer?.valid === true && answer.ok && answer.code === 'qualified' && qualification?.status === 'active'
    && evidenceMatchesPass
})
const qualificationClaimAvailable = computed(() => {
  const current = session.value
  return online.value && !needsRefresh.value && qualificationReply.value?.code === 'claim_available'
    && current !== null && qualificationJourney.value === current.journeyId
    && current.state.status === 'complete' && current.state.assessment === 'passed'
})
const canClaimQualification = computed(() => qualificationClaimAvailable.value && !qualificationBusy.value)
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
function applyResponse(answer: DrivingResponse, token: number, key: string, origin: ResponseOrigin = { kind: 'load' }): boolean {
  if (!responseCurrent(token, key)) return false
  if (!answer || typeof answer.ok !== 'boolean' || !answer.course || typeof answer.course.id !== 'string') throw new Error('The practice lesson reply was incomplete.')
  if (!answer.ok) {
    const current = answer.session, previous = session.value
    const expectedStillCurrent = origin.expectedJourney ? previous?.journeyId === origin.expectedJourney : !previous
    if (!expectedStillCurrent) {
      clearHeld(); active.value = false; boarding.value = false
      needsRefresh.value = true; online.value = true
      feedback.value = 'The saved lesson changed while this request was in flight. Reconnect and check it before continuing.'
      return false
    }
    const contextMatches = current?.cityId === cityId.value && current.location === game.state.value.location
    const sameJourneyFresh = Boolean(current && previous && current.journeyId === previous.journeyId && current.revision >= previous.revision)
    const freshLoad = Boolean(origin.kind === 'load' && expectedStillCurrent && contextMatches && current
      && (!previous || current.journeyId !== previous.journeyId || current.revision >= previous.revision))
    const startRefusal = origin.kind === 'start' && ['journey_active', 'journey_exists', 'superseded_journey', 'assessment_retained'].includes(answer.code)
    const adoptCanonicalStart = Boolean(startRefusal && expectedStillCurrent && contextMatches && current
      && (!previous || current.journeyId !== previous.journeyId || current.revision >= previous.revision))
    if (current && contextMatches && (freshLoad || sameJourneyFresh && expectedStillCurrent || adoptCanonicalStart)) {
      session.value = current; serverState.value = current.state; assessment.value = current.state.assessment
      retainedPass.value = current.state.assessment === 'passed'
      visualState = current.state; scene.value?.present(current.state)
    } else if (current && (!expectedStillCurrent || !contextMatches || current.journeyId !== previous?.journeyId)) {
      needsRefresh.value = true
    }
    clearHeld(); active.value = false; boarding.value = false
    if (adoptCanonicalStart || origin.kind !== 'load' && current && current.journeyId !== origin.expectedJourney) needsRefresh.value = true
    if (answer.code === 'assessment_retained') { retainedPass.value = true; feedback.value = 'Your passed assessment is retained by the server; this course will not replace it with another attempt.' }
    else feedback.value = answer.reason || 'The server returned the current lesson state; controls remain stopped until you review it.'
    online.value = true
    return false
  }
  route.value = answer.course
  if (answer.session) {
    const previous = session.value
    const expectedStillCurrent = origin.expectedJourney ? previous?.journeyId === origin.expectedJourney : !previous
    if (!expectedStillCurrent) {
      clearHeld(); active.value = false; boarding.value = false
      needsRefresh.value = true
      feedback.value = 'The saved lesson changed while this request was in flight. Reconnect and check it before continuing.'
      return false
    }
    const mayAdoptDifferentJourney = origin.kind === 'load' && expectedStillCurrent
      || origin.kind === 'start' && expectedStillCurrent && ['started', 'superseded_journey'].includes(answer.code)
    if (previous && previous.journeyId !== answer.session.journeyId && !mayAdoptDifferentJourney) {
      clearHeld(); active.value = false; boarding.value = false; needsRefresh.value = true
      feedback.value = 'The saved lesson changed in another session. Reconnect and check it before continuing.'
      return false
    }
    if (previous && previous.journeyId === answer.session.journeyId && answer.session.revision < previous.revision) {
      clearHeld(); active.value = false; boarding.value = false; needsRefresh.value = true
      feedback.value = 'The saved lesson changed while this request was in flight. Reconnect and check it before continuing.'
      return false
    }
    retainedPass.value = answer.session.state.assessment === 'passed'
    session.value = answer.session; serverState.value = answer.session.state; assessment.value = answer.session.state.assessment
    if (!visualState || previous?.journeyId !== answer.session.journeyId || answer.session.revision >= (previous?.revision ?? -1)) visualState = answer.session.state
    scene.value?.present(visualState ?? answer.session.state)
  } else {
    const previous = session.value
    const expectedStillCurrent = origin.expectedJourney ? previous?.journeyId === origin.expectedJourney : !previous
    if (!expectedStillCurrent) { needsRefresh.value = true; feedback.value = 'The saved lesson changed while this request was in flight. Reconnect and check it before continuing.'; return false }
    retainedPass.value = false; session.value = null; serverState.value = null; visualState = null; assessment.value = 'pending'
  }
  feedback.value = answer.reason || answer.session?.state.feedback || 'Course ready. Start a lesson or explicitly resume your saved lesson.'
  online.value = true
  return true
}
async function createScene(token: number, key: string): Promise<void> {
  if (!canvas.value || !route.value || scene.value || webglUnavailable.value) return
  try {
    const { createDrivingScene } = await import('./drivingScene.ts')
    if (!responseCurrent(token, key) || !canvas.value || !route.value) return
    const look: Look = game.state.value.onboarding.look
    const made = await createDrivingScene(canvas.value, route.value, look, reduced?.matches === true, game.view.value.session?.id ?? '')
    if (!responseCurrent(token, key)) { made.dispose(); return }
    scene.value = made
    const rect = canvas.value.getBoundingClientRect(); made.resize(rect.width, rect.height)
    if (visualState) made.present(visualState)
  } catch {
    if (responseCurrent(token, key)) { webglUnavailable.value = true; feedback.value = '3D practice is unavailable on this device. Lesson status is available; reopen on a device with 3D support to practise.' }
  }
}
async function load(): Promise<void> {
  const token = generation, key = contextKey.value, expectedJourney = session.value?.journeyId
  if (!game.view.value.session?.id) { feedback.value = 'Sign in to begin a server-tracked practice lesson.'; return }
  busy.value = true
  try {
    const answer = await game.client.api<DrivingResponse>(`/api/living-world/driving?city=${encodeURIComponent(cityId.value)}`)
    if (applyResponse(answer, token, key, { kind: 'load', expectedJourney })) {
      needsRefresh.value = false
      // A server record found running after reload/uncertain delivery is stopped first;
      // only an explicit user action can resume it in this view.
      if (answer.session?.state.status === 'running') await lifecycle('pause', answer.session)
      if (session.value?.state.status === 'paused') needsRefresh.value = false
      await nextTick(); await createScene(token, key)
      void lookupQualification(session.value?.journeyId ?? null)
    }
  } catch (error) {
    if (responseCurrent(token, key)) {
      online.value = false; feedback.value = message(error, 'Offline: reconnect to load the practice course. No result was recorded.')
      void lookupQualification(session.value?.journeyId ?? null)
    }
  } finally { if (responseCurrent(token, key)) busy.value = false }
}
function message(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback }
function qualificationCurrent(token: number, key: string, expectedJourney: string | null, request: number): boolean {
  return responseCurrent(token, key) && request === qualificationRequest && (session.value?.journeyId ?? null) === expectedJourney
}
function qualificationText(answer: QualificationResponse, expectedJourney: string | null): string {
  if (answer.valid && answer.code === 'qualified') {
    const current = session.value
    if (current && current.journeyId === expectedJourney && current.state.status === 'complete' && current.state.assessment === 'passed'
      && answer.qualification?.evidenceJourneyId !== current.journeyId) return 'A saved qualification belongs to a different practice run; it is not attached to this result.'
    return 'A simulated qualification has been earned for a passed practice run.'
  }
  if (answer.code === 'claim_available') return 'A passed simulated practice result is ready for your explicit claim.'
  if (answer.code === 'not_qualified' || answer.code === 'assessment_required') return 'Complete and pass the simulated practice course to qualify.'
  if (answer.code === 'reassessment_required' || answer.code === 'qualification_revoked') return 'The saved qualification needs a new passed assessment.'
  return answer.reason || 'The qualification status could not be verified.'
}
async function lookupQualification(expectedJourney: string | null = session.value?.journeyId ?? null): Promise<void> {
  const token = generation, key = contextKey.value, request = ++qualificationRequest, city = cityId.value
  qualificationBusy.value = true; qualificationJourney.value = expectedJourney; qualificationReply.value = null
  qualificationMessage.value = 'Checking simulated qualification status…'
  try {
    const answer = await game.client.api<QualificationResponse>(`/api/living-world/qualification?city=${encodeURIComponent(city)}`)
    if (!qualificationCurrent(token, key, expectedJourney, request)) return
    if (!validQualificationReply(answer)) { qualificationMessage.value = 'The qualification status could not be verified.'; return }
    qualificationReply.value = answer; qualificationMessage.value = qualificationText(answer, expectedJourney)
  } catch (error) {
    if (responseCurrent(token, key) && request === qualificationRequest && (session.value?.journeyId ?? null) === expectedJourney) {
      qualificationReply.value = null; qualificationMessage.value = message(error, 'Qualification status is unavailable. Reconnect to check it.')
    }
  } finally {
    if (request === qualificationRequest && responseCurrent(token, key)) {
      if ((session.value?.journeyId ?? null) !== expectedJourney) { qualificationReply.value = null; qualificationMessage.value = 'The lesson changed; reconnect to check qualification status.' }
      qualificationBusy.value = false
    }
  }
}
async function claimQualification(): Promise<void> {
  const current = session.value
  if (!canClaimQualification.value || !current || qualificationBusy.value) return
  const expectedJourney = current.journeyId, token = generation, key = contextKey.value, request = ++qualificationRequest
  const body: QualificationClaimRequest = { cityId: current.cityId, requestId: game.newId(), journeyId: expectedJourney }
  qualificationBusy.value = true; qualificationMessage.value = 'Submitting the simulated qualification claim…'
  try {
    const answer = await game.client.api<QualificationResponse>('/api/living-world/qualification/claim', { method: 'POST', body })
    if (!qualificationCurrent(token, key, expectedJourney, request)) return
    qualificationMessage.value = validQualificationReply(answer) ? 'Claim checked. Reading the saved qualification status…' : 'Claim reply was unclear. Reading the saved qualification status…'
    await lookupQualification(expectedJourney)
  } catch (error) {
    if (!qualificationCurrent(token, key, expectedJourney, request)) return
    qualificationMessage.value = message(error, 'Claim delivery was uncertain. Reading the saved qualification status…')
    await lookupQualification(expectedJourney)
  } finally {
    if (request === qualificationRequest && responseCurrent(token, key)) qualificationBusy.value = false
  }
}
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
  const token = generation, key = contextKey.value, expectedJourney = session.value?.journeyId; busy.value = true
  try {
    const answer = await game.client.api<DrivingResponse>('/api/living-world/driving/start', { method: 'POST', body: { cityId: cityId.value, requestId: game.newId() } })
    if (applyResponse(answer, token, key, { kind: 'start', expectedJourney }) && answer.session) beginPresentation()
  } catch (error) { if (responseCurrent(token, key)) { online.value = false; feedback.value = message(error, 'Offline: the lesson did not start. No result was recorded.') } }
  finally { if (responseCurrent(token, key)) busy.value = false }
}
async function lifecycle(action: 'resume' | 'pause', prior = session.value, allowLeaving = false, applyResult = true): Promise<void> {
  if (!prior) return
  const token = generation, key = contextKey.value
  const body: DrivingLifecycleRequest = { cityId: prior.cityId, journeyId: prior.journeyId, revision: prior.revision, requestId: game.newId() }
  try {
    const answer = await game.client.api<DrivingResponse>(`/api/living-world/driving/${action}`, { method: 'POST', body })
    const latest = session.value
    if (applyResult && (allowLeaving || responseCurrent(token, key))) {
      if (answer.ok && answer.session && answer.session.journeyId === prior.journeyId && latest?.journeyId === prior.journeyId
        && answer.session.revision >= prior.revision && answer.session.revision >= latest.revision) {
        session.value = answer.session; serverState.value = answer.session.state; assessment.value = answer.session.state.assessment
        visualState = answer.session.state; scene.value?.present(answer.session.state)
        if (action === 'resume') beginPresentation()
        else { active.value = false; needsRefresh.value = false; feedback.value = answer.reason || 'Lesson paused safely. Resume when ready.' }
      } else if (!answer.ok && !allowLeaving) {
        applyResponse(answer, token, key, { kind: 'lifecycle', expectedJourney: prior.journeyId }); clearHeld(); active.value = false; boarding.value = false
        if (action === 'resume' && answer.session?.journeyId === prior.journeyId && answer.session.state.status === 'running') void lifecycle('pause', answer.session)
        if (action === 'pause') needsRefresh.value = true
        feedback.value = answer.reason || `Could not ${action} the lesson; the server's current state is shown.`
      } else if (applyResult && !allowLeaving && answer.ok) {
        clearHeld(); active.value = false; boarding.value = false; needsRefresh.value = true
        feedback.value = 'The saved lesson changed while this request was in flight. Reconnect and check it before continuing.'
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
    if (responseCurrent(token, key) && answer.ok && answer.session && answer.session.journeyId === current.journeyId
      && session.value?.journeyId === current.journeyId && answer.session.revision >= session.value.revision) {
      applyResponse(answer, token, key, { kind: 'control', expectedJourney: current.journeyId })
      if (answer.session.state.status === 'complete') { clearHeld(); active.value = false; scene.value?.exit(); feedback.value = answer.session.state.feedback; void lookupQualification(answer.session.journeyId) }
      else if (answer.session.state.status !== 'running') { clearHeld(); active.value = false; boarding.value = false; feedback.value = answer.session.state.feedback || 'The server paused this lesson. Review its state before resuming.' }
    } else if (responseCurrent(token, key) && !answer.ok) {
      applyResponse(answer, token, key, { kind: 'control', expectedJourney: current.journeyId }); clearHeld(); active.value = false; boarding.value = false
      if (session.value?.journeyId === current.journeyId && answer.session?.journeyId === current.journeyId && answer.session.state.status === 'running') void lifecycle('pause', answer.session)
      if (answer.code === 'assessment_retained') feedback.value = 'Your passed assessment is retained by the server; this course will not replace it with another attempt.'
    } else if (responseCurrent(token, key) && answer.ok && answer.session
      && (answer.session.journeyId !== current.journeyId || session.value?.journeyId !== current.journeyId || answer.session.revision < (session.value?.revision ?? 0))) {
      clearHeld(); active.value = false; boarding.value = false; needsRefresh.value = true
      feedback.value = 'The saved lesson changed while controls were in flight. Reconnect and check it before continuing.'
    }
  } catch (error) {
    if (responseCurrent(token, key)) {
      clearHeld(); active.value = false; boarding.value = false; online.value = false
      feedback.value = message(error, 'Delivery was uncertain. Controls stopped; reconnect before resuming. No local result counts.')
    }
  } finally {
    controlInFlight = false
    if (pauseAfterControl) {
      const queued = pauseAfterControl; pauseAfterControl = null
      const pauseState = queued.latest ?? queued.prior
      const canApplyPause = !disposed && responseCurrent(token, key) && session.value?.journeyId === queued.prior.journeyId
      if (pauseState.state.status === 'running') void lifecycle('pause', pauseState, !canApplyPause, canApplyPause)
    }
    // The buffer is a rolling window of at most five 100 ms frames, so old input is bounded and discarded.
  }
}

function onKey(event: KeyboardEvent, down: boolean): void {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(key)) return
  if (!down) {
    if (keys.delete(key)) { updateHeld(); event.preventDefault(); event.stopPropagation() }
    return
  }
  if (!active.value) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return
  event.preventDefault(); event.stopPropagation()
  keys.add(key)
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
  qualificationRequest++; qualificationReply.value = null; qualificationJourney.value = null; qualificationBusy.value = false; qualificationMessage.value = 'Checking simulated qualification status…'
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
  window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true); window.addEventListener('blur', windowBlur)
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
  disposed = true; mounted = false; generation++; qualificationRequest++
  clearHeld(); observer?.disconnect(); observer = null
  window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', windowBlur)
  document.removeEventListener('visibilitychange', visibility); reduced?.removeEventListener?.('change', reducedChanged)
  scene.value?.dispose(); scene.value = null
})
</script>

<template>
  <main class="driving-app" aria-label="Driving practice">
    <p class="practice-label">{{ practiceLabel }}</p>
    <div class="driving-view" :class="{ 'is-flat': webglUnavailable }">
      <canvas ref="canvas" aria-hidden="true" />
      <section v-if="!webglUnavailable" class="server-dashboard" role="group" aria-label="Server-confirmed driving gauges">
        <div class="gauge-grid">
          <div class="gauge"><span>Speed</span><strong>{{ dashboard.speed }}</strong></div>
          <div class="gauge"><span>Limit</span><strong>{{ dashboard.limit }}</strong></div>
          <div class="gauge"><span>Zone distance</span><strong>{{ dashboard.distance }}</strong></div>
        </div>
      </section>
      <p v-if="webglUnavailable" class="scene-fallback">3D scene unavailable. Lesson status is available; reopen on a device with 3D support to practise.</p>
      <p class="course-caption">Fictional practice course · checkpoint lesson</p>
    </div>
    <section class="checkpoint-guidance" role="group" aria-label="Checkpoint and saved lesson guidance">
      <strong>{{ dashboard.target }}</strong>
      <p>{{ dashboard.action }}</p>
      <small>{{ dashboard.state }} · Zone distance is straight-line to its edge, not distance along the road.</small>
    </section>
    <section class="controls" aria-label="Driving controls" :aria-disabled="!active">
      <div class="wheel-controls" aria-label="Steering">
        <button type="button" aria-label="Steer left" :disabled="!active" @pointerdown.prevent="touchDown('left', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">←</button>
        <button type="button" aria-label="Steer right" :disabled="!active" @pointerdown.prevent="touchDown('right', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">→</button>
      </div>
      <button type="button" class="drive-control throttle" aria-label="Hold to accelerate" :disabled="!active" @pointerdown.prevent="touchDown('throttle', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">Throttle</button>
      <button type="button" class="drive-control brake" aria-label="Hold to brake" :disabled="!active" @pointerdown.prevent="touchDown('brake', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">Brake</button>
    </section>
    <p class="control-help">Keyboard: WASD or arrow keys. On touch screens, hold the steering, throttle and brake controls. The course is fictional and for practice only.</p>
    <section class="lesson-status" aria-live="polite">
      <strong>{{ complete ? (assessment === 'passed' ? 'Practice passed' : 'Practice needs another try') : boarding ? 'Getting into the car' : active ? 'Lesson in progress' : session ? 'Saved lesson' : 'Ready to practise' }}</strong>
      <p>{{ feedback }}</p>
      <small v-if="serverState">Assessment: {{ assessment }} · checkpoint {{ Math.min(serverState.checkpointIndex + 1, route?.checkpoints.length ?? 1) }} of {{ route?.checkpoints.length ?? '—' }}.</small>
      <small v-if="retainedPass || (complete && assessment === 'passed')">This passed result is retained; this course will not replace it with another attempt.</small>
    </section>
    <section v-if="!active && !boarding" class="qualification-status" aria-live="polite">
      <strong>Simulated driving qualification</strong>
      <p>This is an in-game qualification for simulated practice, not a real driving licence.</p>
      <p>{{ qualificationMessage }}</p>
      <button v-if="qualificationClaimAvailable" type="button" :disabled="!canClaimQualification" @click="claimQualification">{{ qualificationBusy ? 'Checking…' : 'Claim simulated qualification' }}</button>
      <small>Starter vehicle permissions and delivery are being connected.</small>
    </section>
    <div class="lesson-actions">
      <button v-if="(!session && !retainedPass) || (complete && assessment !== 'passed')" type="button" :disabled="!canStart" @click="startLesson">{{ busy ? 'Loading…' : complete ? 'Practise again' : 'Start practice' }}</button>
      <button v-else-if="canResume" type="button" :disabled="busy" @click="resumeLesson">{{ busy ? 'Resuming…' : 'Resume saved lesson' }}</button>
      <button v-if="active || boarding" type="button" class="secondary" @click="pauseLesson">Pause safely</button>
      <button v-if="!online || needsRefresh" type="button" class="secondary" :disabled="busy" @click="load">Reconnect and check lesson</button>
      <button type="button" class="secondary" @click="shell.close()">Close</button>
    </div>
  </main>
</template>

<style scoped>
.driving-app { display: grid; gap: 12px; color: var(--c-ink, #202830); }
.practice-label, .control-help { margin: 0; color: var(--c-muted, #5d6870); font-size: 12px; line-height: 1.45; }
.driving-view { position: relative; overflow: hidden; height: clamp(220px, 35vh, 320px); height: clamp(220px, 35svh, 320px); min-height: 220px; border-radius: 14px; background: #d8e8ee; }
.driving-view canvas { display: block; width: 100%; height: 100%; }
.server-dashboard { position: absolute; z-index: 2; inset: 8px 8px auto; box-sizing: border-box; display: grid; max-width: 430px; padding: 6px; border: 1px solid #ffffffa6; border-radius: 10px; background: #102431e8; color: white; pointer-events: none; }
.gauge-grid { display: grid; grid-template-columns: .8fr .8fr 1.4fr; gap: 5px; }
.gauge { display: grid; align-content: start; min-width: 0; gap: 2px; }
.gauge span { color: #d3e3e9; font-size: 12px; line-height: 1.2; }
.gauge strong { font-size: 14px; line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.checkpoint-guidance { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--app-tint, #3783a4) 22%, #d9e1e5); border-radius: 10px; background: #fff; font-size: 13px; line-height: 1.4; }
.checkpoint-guidance p { margin: 0; }
.checkpoint-guidance small { color: var(--c-muted, #5d6870); font-size: 12px; line-height: 1.4; }
.course-caption { position: absolute; inset: auto 10px 8px; margin: 0; padding: 5px 8px; border-radius: 8px; background: #132431d9; color: white; font-size: 11px; }
.scene-fallback { position: absolute; inset: 25% 12px auto; text-align: center; color: #27333a; font-size: 13px; }
.lesson-status { padding: 12px; border-radius: 12px; background: color-mix(in srgb, var(--app-tint, #3783a4) 7%, white); }
.qualification-status { display: grid; gap: 6px; padding: 12px; border: 1px solid color-mix(in srgb, var(--app-tint, #3783a4) 22%, #d9e1e5); border-radius: 12px; background: #fff; }
.qualification-status strong { font-size: 14px; }
.qualification-status p { margin: 0; font-size: 12px; line-height: 1.45; }
.qualification-status small { color: var(--c-muted, #5d6870); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.qualification-status button { justify-self: start; min-height: 44px; padding: 9px 13px; border: 0; border-radius: 10px; background: #216d84; color: white; font: inherit; font-weight: 700; }
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
@media (max-height: 430px) and (min-width: 481px) { .driving-view { height: clamp(120px, 35vh, 180px); height: clamp(120px, 35svh, 180px); min-height: 120px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
</style>
