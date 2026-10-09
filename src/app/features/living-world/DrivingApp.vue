<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { DrivingControlPacket, DrivingLifecycleRequest, DrivingResponse, DrivingSessionView, QualificationClaimRequest, QualificationResponse, StarterRentalClaimRequest, StarterRentalResponse } from '../../../types/living-world.ts'
import type { DrivingGear, DrivingInput, DrivingRoute, DrivingState } from '../../../game/living-world/driving.ts'
import { createDriving, stepDriving } from '../../../game/living-world/driving.ts'
import type { Look } from '../../../types/life.ts'
import type { DrivingScene } from './drivingScene.ts'
import { validQualificationReply } from './qualificationReply.ts'
import { validStarterRentalReply } from './rentalReply.ts'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const cityId = computed(() => game.view.value.cityId)
const contextKey = computed(() => JSON.stringify([cityId.value, game.state.value.location, game.view.value.session?.id ?? '']))
const canvas = ref<HTMLCanvasElement | null>(null)
const viewTarget = ref<HTMLDivElement | null>(null)
const steeringWheel = ref<HTMLDivElement | null>(null)
const route = ref<DrivingRoute | null>(null)
const session = ref<DrivingSessionView | null>(null)
const serverState = ref<DrivingState | null>(null)
const assessment = ref<DrivingState['assessment']>('pending')
const feedback = ref('Loading the authored practice course…')
const qualificationReply = ref<QualificationResponse | null>(null)
const qualificationJourney = ref<string | null>(null)
const qualificationMessage = ref('Checking simulated qualification status…')
const qualificationBusy = ref(false)
const rentalReply = ref<StarterRentalResponse | null>(null)
const rentalMessage = ref('Sign in to check starter permission status.')
const rentalBusy = ref(false)
const rentalSnapshot = ref('')
const busy = ref(false), active = ref(false), boarding = ref(false), online = ref(true), needsRefresh = ref(false), webglUnavailable = ref(false)
const retainedPass = ref(false)
const restartConfirmation = ref(false)
const pendingControls = ref(false), lifecyclePending = ref(0)
type TouchControl = keyof DrivingInput | 'left' | 'right'
const touch = new Map<number, TouchControl>()
const keys = new Set<string>()
const held = ref<DrivingInput>({ throttle: 0, brake: 0, steer: 0 })
// null preserves the legacy three-field control frame until a player explicitly picks a direction.
const requestedGear = ref<DrivingGear | null>(null)
const reverseGearControls = ref(false)
const wheelSteer = ref(0)
const scene = ref<DrivingScene | null>(null)
const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
let generation = 0, mounted = false, disposed = false, controlInFlight = false, loadRequest = 0
let capabilityEpoch = 0
let controlActor: string | null = null
let sessionActor: string | null = game.view.value.session?.id ?? null
let pauseAfterControl: { prior: DrivingSessionView; actor: string | null; leaving: boolean; latest?: DrivingSessionView } | null = null
let wheelGesture: { pointerId: number; startX: number; initialSteer: number; target: HTMLElement } | null = null
let sampleTimer = 0, flushTimer = 0, visualState: DrivingState | null = null
let pendingFrames: DrivingInput[] = [], observer: ResizeObserver | null = null
let qualificationRequest = 0
let rentalRequest = 0
type ResponseOrigin = { kind: 'load' | 'start' | 'control' | 'lifecycle' | 'restart'; expectedJourney?: string; capabilityEpoch: number }

const canStart = computed(() => !busy.value && online.value && !needsRefresh.value && Boolean(scene.value) && !webglUnavailable.value && Boolean(game.view.value.session?.id) && Boolean(route.value) && (!session.value || complete.value) && assessment.value !== 'passed' && !retainedPass.value)
const canResume = computed(() => !busy.value && online.value && !needsRefresh.value && Boolean(scene.value) && !webglUnavailable.value && Boolean(session.value) && !active.value && !boarding.value && session.value?.state.status === 'paused')
const canRestart = computed(() => {
  const current = session.value
  return !busy.value && !pendingControls.value && lifecyclePending.value === 0 && online.value && !needsRefresh.value
    && !active.value && !boarding.value && !retainedPass.value && Boolean(game.view.value.session?.id)
    && Boolean(scene.value) && !webglUnavailable.value && Boolean(route.value)
    && current?.state.status === 'paused' && current.state.assessment === 'pending'
    && current.cityId === cityId.value && current.location === game.state.value.location
})
watch(canRestart, eligible => { if (!eligible) restartConfirmation.value = false })
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
const rentalEvidenceKey = computed(() => {
  const current = session.value, q = qualificationReply.value?.qualification
  if (!validQualification.value || !current || current.state.status !== 'complete' || current.state.assessment !== 'passed'
    || qualificationJourney.value !== current.journeyId || q?.evidenceJourneyId !== current.journeyId || q.version !== 1) return ''
  return JSON.stringify([game.view.value.session?.id ?? '', current.cityId, current.journeyId, q.id, q.version])
})
const canClaimStarterPermission = computed(() => {
  const current = session.value, reply = rentalReply.value, actor = game.view.value.session?.id
  return cityId.value === 'lagos' && Boolean(actor) && online.value && !needsRefresh.value && !active.value && !boarding.value
    && !busy.value && !controlInFlight && !pendingControls.value && lifecyclePending.value === 0 && !qualificationBusy.value && !rentalBusy.value
    && Boolean(rentalEvidenceKey.value) && Boolean(current) && current!.cityId === cityId.value
    && rentalSnapshot.value === rentalEvidenceKey.value && reply?.ok === true && reply.code === 'eligible'
    && reply.eligible === true && reply.valid === false && reply.permission === null
  })
const practiceLabel = 'Authored simulated practice course · not a mapped public road or real licence test.'
const canonicalGear = computed<DrivingGear>(() => serverState.value?.gear === 'reverse' ? 'reverse' : 'forward')
const transmissionStatus = computed(() => {
  const saved = serverState.value
  if (!saved) return 'Server-confirmed direction is not available.'
  const confirmed = canonicalGear.value === 'reverse' ? 'Reverse' : 'Drive'
  const requested = requestedGear.value
  if (!requested) return `Server-confirmed direction: ${confirmed}.`
  const selected = requested === 'reverse' ? 'Reverse' : 'Drive'
  if (requested === canonicalGear.value) return `Requested ${selected}; server confirms ${confirmed} is engaged.`
  const shift = saved.status === 'running' && saved.speed > 0
    ? `Braking in ${confirmed} before the shift.` : `Waiting for the server to confirm the shift from ${confirmed}.`
  return `Requested ${selected}; ${shift} Server-confirmed direction: ${confirmed}.`
})
function responseCurrent(token: number, key: string): boolean { return !disposed && token === generation && key === contextKey.value }
function clearHeld(): void {
  keys.clear(); touch.clear(); requestedGear.value = null; held.value = { throttle: 0, brake: 0, steer: 0 }
  const gesture = wheelGesture; wheelGesture = null; wheelSteer.value = 0
  if (gesture?.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId)
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
  const buttonSteering = Number(right) - Number(left)
  const manualSteering = keys.has('ArrowLeft') || keys.has('a') || keys.has('ArrowRight') || keys.has('d') || values.includes('left') || values.includes('right')
  const next: DrivingInput = { throttle: throttle ? 1 : 0, brake: brake ? 1 : 0, steer: manualSteering ? buttonSteering : wheelSteer.value }
  if (reverseGearControls.value && requestedGear.value !== null) next.gear = requestedGear.value
  held.value = next
  scene.value?.setInput(held.value)
}
function selectGear(gear: DrivingGear): void {
  if (!reverseGearControls.value || !active.value || !online.value || needsRefresh.value) return
  if (requestedGear.value !== gear) pendingFrames = []
  requestedGear.value = gear
  updateHeld()
}
function steeringDown(event: PointerEvent): void {
  if (!active.value || wheelGesture || event.button !== 0 || !Number.isFinite(event.clientX)) return
  const target = event.currentTarget as HTMLElement
  try { target.setPointerCapture(event.pointerId) } catch { return }
  wheelGesture = { pointerId: event.pointerId, startX: event.clientX, initialSteer: held.value.steer, target }
  wheelSteer.value = held.value.steer
  target.focus({ preventScroll: true })
  updateHeld()
}
function steeringMove(event: PointerEvent): void {
  const gesture = wheelGesture
  if (!active.value || !gesture || gesture.pointerId !== event.pointerId || !Number.isFinite(event.clientX)) return
  wheelSteer.value = Math.max(-1, Math.min(1, gesture.initialSteer + (event.clientX - gesture.startX) / 64))
  updateHeld()
}
function steeringUp(event: PointerEvent): void {
  const gesture = wheelGesture
  if (!gesture || gesture.pointerId !== event.pointerId) return
  wheelGesture = null; wheelSteer.value = 0
  if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId)
  updateHeld()
}
function steeringFocusOut(): void {
  const gesture = wheelGesture; wheelGesture = null; wheelSteer.value = 0
  if (gesture?.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId)
  updateHeld()
}
function applyCapability(answer: DrivingResponse, requestEpoch: number): void {
  if (requestEpoch !== capabilityEpoch) return
  if (answer.reverseGearControls === true) { reverseGearControls.value = true; return }
  capabilityEpoch++
  const hadGearIntent = requestedGear.value !== null || Object.hasOwn(held.value, 'gear') || pendingFrames.some(frame => Object.hasOwn(frame, 'gear'))
  reverseGearControls.value = false
  if (hadGearIntent) {
    clearHeld(); active.value = false; boarding.value = false
    if (serverState.value) { visualState = serverState.value; scene.value?.present(serverState.value) }
    feedback.value = 'Reverse controls were withdrawn. Held controls were released; the saved lesson is being checked before driving continues.'
  }
}
function applyResponse(answer: DrivingResponse, token: number, key: string, origin: ResponseOrigin): boolean {
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
    const freshSession = !current || contextMatches && (!previous || current.journeyId !== previous.journeyId || current.revision >= previous.revision)
    if (expectedStillCurrent && freshSession) applyCapability(answer, origin.capabilityEpoch)
    if (current && contextMatches && (freshLoad || sameJourneyFresh && expectedStillCurrent || adoptCanonicalStart)) {
      session.value = current; sessionActor = game.view.value.session?.id ?? null; serverState.value = current.state; assessment.value = current.state.assessment
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
    applyCapability(answer, origin.capabilityEpoch)
    retainedPass.value = answer.session.state.assessment === 'passed'
    session.value = answer.session; sessionActor = game.view.value.session?.id ?? null; serverState.value = answer.session.state; assessment.value = answer.session.state.assessment
    if (!visualState || previous?.journeyId !== answer.session.journeyId || answer.session.revision >= (previous?.revision ?? -1)) visualState = answer.session.state
    scene.value?.present(visualState ?? answer.session.state)
  } else {
    const previous = session.value
    const expectedStillCurrent = origin.expectedJourney ? previous?.journeyId === origin.expectedJourney : !previous
    if (!expectedStillCurrent) { needsRefresh.value = true; feedback.value = 'The saved lesson changed while this request was in flight. Reconnect and check it before continuing.'; return false }
    applyCapability(answer, origin.capabilityEpoch)
    retainedPass.value = false; session.value = null; sessionActor = null; serverState.value = null; visualState = null; assessment.value = 'pending'
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
  restartConfirmation.value = false
  clearHeld()
  const token = generation, key = contextKey.value, request = ++loadRequest, requestCapabilityEpoch = capabilityEpoch
  const expectedJourney = session.value?.journeyId, actor = game.view.value.session?.id ?? null, city = cityId.value
  const requestCurrent = (): boolean => responseCurrent(token, key) && request === loadRequest && actor === (game.view.value.session?.id ?? null)
  const responseIsCurrent = (): boolean => requestCurrent() && (session.value?.journeyId ?? undefined) === expectedJourney
  if (!actor) { if (requestCurrent()) feedback.value = 'Sign in to begin a server-tracked practice lesson.'; return }
  busy.value = true
  try {
    const answer = await game.client.api<DrivingResponse>(`/api/living-world/driving?city=${encodeURIComponent(city)}`, {}, responseIsCurrent)
    if (!responseIsCurrent()) return
    if (applyResponse(answer, token, key, { kind: 'load', expectedJourney, capabilityEpoch: requestCapabilityEpoch })) {
      needsRefresh.value = false
      // A server record found running after reload/uncertain delivery is stopped first;
      // only an explicit user action can resume it in this view.
      if (answer.session?.state.status === 'running') await lifecycle('pause', answer.session)
      if (!requestCurrent()) return
      if (session.value?.state.status === 'paused') needsRefresh.value = false
      await nextTick(); if (!requestCurrent()) return
      await createScene(token, key)
      if (!requestCurrent()) return
      void refreshPracticeCredentials(session.value?.journeyId ?? null)
    }
  } catch (error) {
    if (responseIsCurrent()) {
      online.value = false; feedback.value = message(error, 'Offline: reconnect to load the practice course. No result was recorded.')
      void lookupQualification(session.value?.journeyId ?? null)
    }
  } finally { if (requestCurrent()) busy.value = false }
}
function reconcileLeaving(prior: DrivingSessionView, actor: string | null): void {
  if (prior.state.status !== 'running' || !actor || actor !== game.view.value.session?.id) return
  if (mounted && !disposed) { void load(); return }
  // A closing panel may ask the server to pause the saved run, but never applies this reply to the client model.
  void game.client.api<DrivingResponse>(`/api/living-world/driving?city=${encodeURIComponent(cityId.value)}`, {}, () => false).catch(() => {})
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
    const answer = await game.client.api<QualificationResponse>(`/api/living-world/qualification?city=${encodeURIComponent(city)}`, {},
      () => qualificationCurrent(token, key, expectedJourney, request))
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
function rentalEvidenceSnapshot(): string {
  const current = session.value, q = qualificationReply.value?.qualification, actor = game.view.value.session?.id
  if (!current || !actor || current.cityId !== cityId.value || !validQualification.value || current.state.status !== 'complete'
    || current.state.assessment !== 'passed' || qualificationJourney.value !== current.journeyId || q?.evidenceJourneyId !== current.journeyId || q.version !== 1) return ''
  return JSON.stringify([actor, current.cityId, current.journeyId, q.id, q.version])
}
function rentalReadSnapshot(expectedJourney: string | null, city: string, actor: string): string {
  const q = qualificationReply.value?.qualification
  return JSON.stringify([actor, city, expectedJourney, qualificationJourney.value, q?.id ?? null, q?.version ?? null, q?.evidenceJourneyId ?? null])
}
function rentalCurrent(token: number, key: string, snapshot: string, request: number): boolean {
  return responseCurrent(token, key) && request === rentalRequest && snapshot === rentalReadSnapshot(session.value?.journeyId ?? null, cityId.value, game.view.value.session?.id ?? '')
}
async function lookupStarterPermission(expectedJourney: string | null = session.value?.journeyId ?? null): Promise<void> {
  const token = generation, key = contextKey.value, request = ++rentalRequest, city = cityId.value
  const actor = game.view.value.session?.id ?? '', snapshot = rentalReadSnapshot(expectedJourney, city, actor)
  rentalBusy.value = true; rentalReply.value = null; rentalSnapshot.value = ''; rentalMessage.value = 'Checking saved starter permission…'
  if (city !== 'lagos') {
    rentalMessage.value = 'Starter permission is currently unavailable in this city.'
    rentalBusy.value = false
    return
  }
  if (!actor) {
    rentalMessage.value = 'Sign in to check starter permission status.'
    rentalBusy.value = false
    return
  }
  try {
    const answer = await game.client.api<StarterRentalResponse>(`/api/living-world/rental?city=${encodeURIComponent(city)}`, {},
      () => rentalCurrent(token, key, snapshot, request) && (session.value?.journeyId ?? null) === expectedJourney && actor === game.view.value.session?.id)
    if ((session.value?.journeyId ?? null) !== expectedJourney || !rentalCurrent(token, key, snapshot, request) || actor !== game.view.value.session?.id) return
    if (!validStarterRentalReply(answer, actor)) {
      rentalMessage.value = 'Starter permission status could not be verified. Reconnect to check it.'
      return
    }
    rentalReply.value = answer; rentalSnapshot.value = rentalEvidenceSnapshot()
    rentalMessage.value = answer.code === 'invalid_saved_rental' || answer.code === 'invalid_server_clock'
      ? 'Starter permission status could not be verified. Reconnect to check it.'
      : answer.permission?.status === 'active' && answer.valid
      ? 'Free in-game permission saved. No car is allocated; mapped-road trips remain unavailable.'
      : answer.permission?.status === 'active'
        ? 'A saved permission is not currently valid. No car is allocated; mapped-road trips remain unavailable.'
      : answer.permission?.status === 'revoked'
        ? 'The saved starter permission is inactive. No car is allocated; mapped-road trips remain unavailable.'
        : answer.eligible
          ? 'A passed simulated qualification may claim the free in-game permission. No car is allocated; mapped-road trips remain unavailable.'
          : 'A passed simulated qualification is required. No car is allocated; mapped-road trips remain unavailable.'
  } catch {
    if ((session.value?.journeyId ?? null) === expectedJourney && rentalCurrent(token, key, snapshot, request) && actor === game.view.value.session?.id) {
      rentalReply.value = null; rentalSnapshot.value = ''; rentalMessage.value = 'Starter permission status is unavailable. Reconnect to check it.'
    }
  } finally {
    if (request === rentalRequest && responseCurrent(token, key)) rentalBusy.value = false
  }
}
async function refreshPracticeCredentials(expectedJourney: string | null): Promise<void> {
  const token = generation, key = contextKey.value
  await lookupQualification(expectedJourney)
  if (responseCurrent(token, key) && (session.value?.journeyId ?? null) === expectedJourney) await lookupStarterPermission(expectedJourney)
}
async function claimStarterPermission(): Promise<void> {
  const current = session.value, evidenceSnapshot = rentalEvidenceSnapshot(), actor = game.view.value.session?.id
  if (!canClaimStarterPermission.value || !current || !evidenceSnapshot || !actor) return
  const token = generation, key = contextKey.value, request = ++rentalRequest
  const snapshot = rentalReadSnapshot(current.journeyId, current.cityId, actor)
  const body: StarterRentalClaimRequest = { cityId: current.cityId, requestId: game.newId(), qualificationJourneyId: current.journeyId, qualificationVersion: 1 }
  rentalBusy.value = true; rentalMessage.value = 'Submitting the free in-game permission claim…'
  try {
    const answer = await game.client.api<StarterRentalResponse>('/api/living-world/rental/claim', { method: 'POST', body },
      () => rentalCurrent(token, key, snapshot, request) && session.value?.journeyId === current.journeyId
        && rentalEvidenceSnapshot() === evidenceSnapshot && actor === game.view.value.session?.id)
    if (!rentalCurrent(token, key, snapshot, request) || session.value?.journeyId !== current.journeyId || rentalEvidenceSnapshot() !== evidenceSnapshot || actor !== game.view.value.session?.id) return
    rentalMessage.value = validStarterRentalReply(answer, actor) && answer.ok
      ? 'Claim checked. Reading the saved permission status…'
      : 'Claim reply was unclear. Reading the saved permission status…'
  } catch {
    if (!rentalCurrent(token, key, snapshot, request) || session.value?.journeyId !== current.journeyId || rentalEvidenceSnapshot() !== evidenceSnapshot || actor !== game.view.value.session?.id) return
    rentalMessage.value = 'Claim delivery was uncertain. Reading the saved permission status…'
  } finally {
    if (request === rentalRequest && responseCurrent(token, key)) rentalBusy.value = false
  }
  if (responseCurrent(token, key) && request === rentalRequest && session.value?.journeyId === current.journeyId
    && rentalReadSnapshot(current.journeyId, current.cityId, actor) === snapshot && rentalEvidenceSnapshot() === evidenceSnapshot
    && actor === game.view.value.session?.id) await lookupStarterPermission(current.journeyId)
}
async function claimQualification(): Promise<void> {
  const current = session.value
  if (!canClaimQualification.value || !current || qualificationBusy.value) return
  const expectedJourney = current.journeyId, token = generation, key = contextKey.value, request = ++qualificationRequest
  const body: QualificationClaimRequest = { cityId: current.cityId, requestId: game.newId(), journeyId: expectedJourney }
  qualificationBusy.value = true; qualificationMessage.value = 'Submitting the simulated qualification claim…'
  try {
    const answer = await game.client.api<QualificationResponse>('/api/living-world/qualification/claim', { method: 'POST', body },
      () => qualificationCurrent(token, key, expectedJourney, request))
    if (!qualificationCurrent(token, key, expectedJourney, request)) return
    qualificationMessage.value = validQualificationReply(answer) ? 'Claim checked. Reading the saved qualification status…' : 'Claim reply was unclear. Reading the saved qualification status…'
    await refreshPracticeCredentials(expectedJourney)
  } catch (error) {
    if (!qualificationCurrent(token, key, expectedJourney, request)) return
    qualificationMessage.value = message(error, 'Claim delivery was uncertain. Reading the saved qualification status…')
    await refreshPracticeCredentials(expectedJourney)
  } finally {
    if (request === qualificationRequest && responseCurrent(token, key)) qualificationBusy.value = false
  }
}
async function revealDrivingView(token: number, key: string, journey: string): Promise<void> {
  await nextTick()
  const target = viewTarget.value, current = session.value
  if (!mounted || disposed || !responseCurrent(token, key) || document.hidden || !online.value || needsRefresh.value
    || current?.journeyId !== journey || current.state.status !== 'running' || (!boarding.value && !active.value)
    || !target?.isConnected || !target.getClientRects().length) return
  target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
  target.focus({ preventScroll: true })
}
function beginPresentation(): void {
  const current = session.value, journey = current?.journeyId, token = generation, key = contextKey.value
  if (!journey || !scene.value || current?.state.status !== 'running' || !online.value || document.hidden) return
  active.value = false; boarding.value = true
  void revealDrivingView(token, key, journey)
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
  restartConfirmation.value = false
  if (!canStart.value) return
  const token = generation, key = contextKey.value, expectedJourney = session.value?.journeyId, requestCapabilityEpoch = capabilityEpoch
  const city = cityId.value, requestId = game.newId(); busy.value = true
  try {
    const answer = await game.client.api<DrivingResponse>('/api/living-world/driving/start', { method: 'POST', body: { cityId: city, requestId } },
      () => responseCurrent(token, key) && cityId.value === city && (session.value?.journeyId ?? undefined) === expectedJourney)
    if (applyResponse(answer, token, key, { kind: 'start', expectedJourney, capabilityEpoch: requestCapabilityEpoch }) && answer.session) beginPresentation()
  } catch (error) { if (responseCurrent(token, key)) { online.value = false; feedback.value = message(error, 'Offline: the lesson did not start. No result was recorded.') } }
  finally { if (responseCurrent(token, key)) busy.value = false }
}
function isNeutralRestart(answer: DrivingResponse, previous: DrivingSessionView): boolean {
  const course = route.value, next = answer.session
  if (!course || !next || !answer.ok || answer.code !== 'restarted' || next.journeyId === previous.journeyId
    || !next.journeyId || next.revision !== previous.revision + 1 || next.nextSequence !== 1
    || next.cityId !== previous.cityId || next.location !== previous.location
    || next.cityId !== cityId.value || next.location !== game.state.value.location
    || JSON.stringify(answer.course) !== JSON.stringify(course)) return false
  const initial = createDriving(course), state = next.state
  return state.routeId === initial.routeId && state.routeVersion === initial.routeVersion
    && state.status === 'running' && state.assessment === 'pending'
    && state.position.x === initial.position.x && state.position.z === initial.position.z
    && state.heading === initial.heading && state.speed === 0 && state.checkpointIndex === 0
    && state.checkpointEntry === initial.checkpointEntry && state.stopDwellMs === 0 && state.score === initial.score
}
async function restartLesson(): Promise<void> {
  if (!canRestart.value || !session.value) return
  const prior = session.value, token = generation, key = contextKey.value, requestCapabilityEpoch = capabilityEpoch
  restartConfirmation.value = false
  clearHeld(); active.value = false; boarding.value = false
  busy.value = true; lifecyclePending.value++
  const body: DrivingLifecycleRequest = {
    cityId: prior.cityId, requestId: game.newId(), journeyId: prior.journeyId, revision: prior.revision,
  }
  try {
    const answer = await game.client.api<DrivingResponse>('/api/living-world/driving/restart', { method: 'POST', body },
      () => responseCurrent(token, key) && session.value?.journeyId === prior.journeyId && session.value?.revision === prior.revision)
    if (!responseCurrent(token, key)) return
    if (session.value?.journeyId !== prior.journeyId || session.value.revision !== prior.revision) {
      clearHeld(); active.value = false; boarding.value = false; needsRefresh.value = true
      feedback.value = 'The saved lesson changed while restart was in flight. Reconnect and check it before continuing.'
      return
    }
    if (!answer.ok) {
      applyResponse(answer, token, key, { kind: 'restart', expectedJourney: prior.journeyId, capabilityEpoch: requestCapabilityEpoch })
      clearHeld(); active.value = false; boarding.value = false
      return
    }
    if (!isNeutralRestart(answer, prior)) {
      clearHeld(); active.value = false; boarding.value = false; needsRefresh.value = true
      feedback.value = 'The restart reply could not be confirmed. Controls remain stopped; reconnect to check the saved lesson.'
      return
    }
    applyCapability(answer, requestCapabilityEpoch)
    const next = answer.session!
    session.value = next; sessionActor = game.view.value.session?.id ?? null; serverState.value = next.state; assessment.value = next.state.assessment
    retainedPass.value = false; route.value = answer.course; visualState = next.state; scene.value?.present(next.state)
    needsRefresh.value = false; online.value = true
    feedback.value = answer.reason || 'A new practice attempt is ready. Follow the route and stop inside marked zones.'
    beginPresentation()
    void lookupQualification(next.journeyId)
  } catch (error) {
    if (responseCurrent(token, key)) {
      clearHeld(); active.value = false; boarding.value = false; online.value = false; needsRefresh.value = true
      feedback.value = message(error, 'Restart delivery is uncertain. Controls stopped; reconnect to check the saved lesson before trying again.')
    }
  } finally {
    lifecyclePending.value = Math.max(0, lifecyclePending.value - 1)
    if (responseCurrent(token, key)) busy.value = false
  }
}
async function lifecycle(action: 'resume' | 'pause', prior = session.value, allowLeaving = false, applyResult = true): Promise<void> {
  if (!prior) return
  clearHeld()
  const token = generation, key = contextKey.value, requestCapabilityEpoch = capabilityEpoch
  const body: DrivingLifecycleRequest = { cityId: prior.cityId, journeyId: prior.journeyId, revision: prior.revision, requestId: game.newId() }
  lifecyclePending.value++
  try {
    const answer = await game.client.api<DrivingResponse>(`/api/living-world/driving/${action}`, { method: 'POST', body },
      () => !allowLeaving && responseCurrent(token, key) && session.value?.journeyId === prior.journeyId)
    const latest = session.value
    if (applyResult && (allowLeaving || responseCurrent(token, key))) {
      if (answer.ok && answer.session && answer.session.journeyId === prior.journeyId && latest?.journeyId === prior.journeyId
        && answer.session.revision >= prior.revision && answer.session.revision >= latest.revision) {
        if (!allowLeaving) applyCapability(answer, requestCapabilityEpoch)
        session.value = answer.session; sessionActor = game.view.value.session?.id ?? null; serverState.value = answer.session.state; assessment.value = answer.session.state.assessment
        visualState = answer.session.state; scene.value?.present(answer.session.state)
        if (action === 'resume') beginPresentation()
        else { active.value = false; needsRefresh.value = false; feedback.value = answer.reason || 'Lesson paused safely. Resume when ready.' }
      } else if (!answer.ok && !allowLeaving) {
        applyResponse(answer, token, key, { kind: 'lifecycle', expectedJourney: prior.journeyId, capabilityEpoch: requestCapabilityEpoch }); clearHeld(); active.value = false; boarding.value = false
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
  finally { lifecyclePending.value = Math.max(0, lifecyclePending.value - 1) }
}
async function resumeLesson(): Promise<void> {
  restartConfirmation.value = false
  if (!canResume.value || !session.value) return
  busy.value = true; clearHeld()
  try { await lifecycle('resume') } finally { busy.value = false }
}
async function pauseLesson(): Promise<void> {
  restartConfirmation.value = false
  clearHeld(); active.value = false; boarding.value = false
  if (controlInFlight && session.value) { pauseAfterControl = { prior: session.value, actor: controlActor, leaving: false }; feedback.value = 'Stopping controls; the server will pause after its current reply.'; return }
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
  if (!reverseGearControls.value && frames.some(frame => Object.hasOwn(frame, 'gear'))) {
    clearHeld(); active.value = false; boarding.value = false
    return
  }
  const packet: DrivingControlPacket = { cityId: current.cityId, journeyId: current.journeyId, sequence: current.nextSequence, frames }
  const token = generation, key = contextKey.value, requestCapabilityEpoch = capabilityEpoch
  const actor = game.view.value.session?.id ?? null
  controlActor = actor
  controlInFlight = true; pendingControls.value = true
  try {
    const answer = await game.client.api<DrivingResponse>('/api/living-world/driving/input', { method: 'POST', body: packet },
      () => responseCurrent(token, key) && session.value?.journeyId === packet.journeyId
        && session.value?.nextSequence === packet.sequence && actor === (game.view.value.session?.id ?? null))
    if (pauseAfterControl?.prior.journeyId === current.journeyId && answer.session?.journeyId === current.journeyId && answer.session.revision >= pauseAfterControl.prior.revision) pauseAfterControl.latest = answer.session
    if (responseCurrent(token, key) && answer.ok && answer.session && answer.session.journeyId === current.journeyId
      && session.value?.journeyId === current.journeyId && answer.session.revision >= session.value.revision) {
      const hadGearCapability = reverseGearControls.value
      applyResponse(answer, token, key, { kind: 'control', expectedJourney: current.journeyId, capabilityEpoch: requestCapabilityEpoch })
      if (hadGearCapability && !reverseGearControls.value && answer.session.state.status === 'running') void lifecycle('pause', answer.session)
      if (answer.session.state.status === 'complete') { clearHeld(); active.value = false; scene.value?.exit(); feedback.value = answer.session.state.feedback; void refreshPracticeCredentials(answer.session.journeyId) }
      else if (answer.session.state.status !== 'running') { clearHeld(); active.value = false; boarding.value = false; feedback.value = answer.session.state.feedback || 'The server paused this lesson. Review its state before resuming.' }
    } else if (responseCurrent(token, key) && !answer.ok) {
      applyResponse(answer, token, key, { kind: 'control', expectedJourney: current.journeyId, capabilityEpoch: requestCapabilityEpoch }); clearHeld(); active.value = false; boarding.value = false
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
    controlInFlight = false; pendingControls.value = false
    controlActor = null
    if (pauseAfterControl) {
      const queued = pauseAfterControl; pauseAfterControl = null
      if (queued.leaving || !queued.latest) reconcileLeaving(queued.prior, queued.actor)
      else {
        const pauseState = queued.latest
        const canApplyPause = !disposed && responseCurrent(token, key) && session.value?.journeyId === queued.prior.journeyId
        if (pauseState.state.status === 'running') void lifecycle('pause', pauseState, !canApplyPause, canApplyPause)
      }
    }
    // The buffer is a rolling window of at most five 100 ms frames, so old input is bounded and discarded.
  }
}

function onKey(event: KeyboardEvent, down: boolean): void {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const released = !down && keys.delete(key)
  if (released) updateHeld()
  const sliderKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape']
  if (event.target === steeringWheel.value && sliderKeys.includes(key)) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault(); event.stopPropagation()
    if (!down || !active.value) return
    if (key === 'Home') wheelSteer.value = -1
    else if (key === 'End') wheelSteer.value = 1
    else if (key === 'Escape') wheelSteer.value = 0
    else wheelSteer.value = Math.max(-1, Math.min(1, wheelSteer.value + (key === 'ArrowRight' || key === 'ArrowUp' ? 0.1 : -0.1)))
    updateHeld()
    return
  }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(key)) return
  if (!down) {
    if (released) { event.preventDefault(); event.stopPropagation() }
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
  restartConfirmation.value = false; clearHeld(); active.value = false; boarding.value = false; capabilityEpoch++; reverseGearControls.value = false; generation++
  qualificationRequest++; qualificationReply.value = null; qualificationJourney.value = null; qualificationBusy.value = false; qualificationMessage.value = 'Checking simulated qualification status…'
  rentalRequest++; rentalReply.value = null; rentalSnapshot.value = ''; rentalBusy.value = false
  rentalMessage.value = !game.view.value.session?.id ? 'Sign in to check starter permission status.'
    : cityId.value === 'lagos' ? 'Checking starter permission status…' : 'Starter permission is currently unavailable in this city.'
  retainedPass.value = false; webglUnavailable.value = false; assessment.value = 'pending'; online.value = true
  scene.value?.dispose(); scene.value = null; route.value = null; session.value = null; sessionActor = null; serverState.value = null; visualState = null
  if (old && old.state.status === 'running') {
    if (controlInFlight) pauseAfterControl = { prior: old, actor: controlActor, leaving: true }
    // Otherwise the fresh load below reconciles same-actor state under the current scope; it never posts as the prior actor.
  }
  if (mounted) await load()
}, { flush: 'sync' })
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
  const priorActor = sessionActor
  restartConfirmation.value = false
  disposed = true; mounted = false; generation++; qualificationRequest++; rentalRequest++; loadRequest++
  capabilityEpoch++; reverseGearControls.value = false
  if ((active.value || boarding.value) && prior) {
    clearHeld(); active.value = false; boarding.value = false
    // A closing panel only asks for a server-side reconcile; it never applies a stale response.
    if (controlInFlight) pauseAfterControl = { prior, actor: controlActor, leaving: true }
    else reconcileLeaving(prior, priorActor)
  }
  clearHeld(); observer?.disconnect(); observer = null
  window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', windowBlur)
  document.removeEventListener('visibilitychange', visibility); reduced?.removeEventListener?.('change', reducedChanged)
  scene.value?.dispose(); scene.value = null
})
</script>

<template>
  <main class="driving-app" aria-label="Driving practice">
    <p class="practice-label">{{ practiceLabel }}</p>
    <div ref="viewTarget" class="driving-view" :class="{ 'is-flat': webglUnavailable }" role="group" aria-label="Driving practice view" tabindex="-1">
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
      <div v-if="reverseGearControls" class="gear-selector" role="group" aria-label="Select requested direction">
        <button type="button" :disabled="!active || !online || needsRefresh" :aria-pressed="requestedGear === 'forward'" @click="selectGear('forward')">Drive</button>
        <button type="button" :disabled="!active || !online || needsRefresh" :aria-pressed="requestedGear === 'reverse'" @click="selectGear('reverse')">Reverse</button>
      </div>
      <p v-if="reverseGearControls" class="transmission-status" role="status">{{ transmissionStatus }}</p>
      <div class="wheel-controls" aria-label="Steering">
        <button type="button" aria-label="Steer left" :disabled="!active" @pointerdown.prevent="touchDown('left', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">←</button>
        <div class="steering-control">
          <span class="steering-readout">Steering: {{ Math.round(held.steer * 100) }}%</span>
          <div ref="steeringWheel" class="steering-wheel" role="slider" aria-label="Analog steering" aria-describedby="steering-help" :aria-valuemin="-100" :aria-valuemax="100" :aria-valuenow="Math.round(held.steer * 100)" :aria-valuetext="`Requested steering ${Math.round(held.steer * 100)} percent`" :aria-disabled="!active" :tabindex="active ? 0 : -1" :style="{ '--wheel-rotation': `${held.steer * 110}deg` }" @pointerdown.prevent.stop="steeringDown" @pointermove.prevent.stop="steeringMove" @pointerup="steeringUp" @pointercancel="steeringUp" @lostpointercapture="steeringUp" @focusout="steeringFocusOut">
            <svg viewBox="0 0 88 88" aria-hidden="true">
              <circle cx="44" cy="44" r="32" class="wheel-rim" />
              <circle cx="44" cy="44" r="8" class="wheel-hub" />
              <path d="M44 36V14M38 47 20 61M50 47 68 61" class="wheel-spoke" />
            </svg>
          </div>
        </div>
        <button type="button" aria-label="Steer right" :disabled="!active" @pointerdown.prevent="touchDown('right', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">→</button>
      </div>
      <button type="button" class="drive-control throttle" aria-label="Hold to accelerate" :disabled="!active" @pointerdown.prevent="touchDown('throttle', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">Throttle</button>
      <button type="button" class="drive-control brake" aria-label="Hold to brake" :disabled="!active" @pointerdown.prevent="touchDown('brake', $event)" @pointerup="touchUp" @pointercancel="touchUp" @lostpointercapture="touchUp">Brake</button>
    </section>
    <p id="steering-help" class="control-help">Keyboard: WASD or arrow keys. Drag the steering wheel horizontally, or focus it and use arrow keys for 10% steps, Home/End for full lock, and Escape to center. On touch screens, hold the steering, throttle and brake controls. The course is fictional and for practice only.</p>
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
    <section v-if="!active && !boarding" class="starter-permission" aria-labelledby="starter-permission-title">
      <strong id="starter-permission-title">Starter vehicle permission</strong>
      <p>Free in-game permission only. No car is allocated, and mapped-road trips remain unavailable.</p>
      <p>{{ rentalMessage }}</p>
      <button v-if="rentalReply?.eligible && rentalReply.permission === null" type="button" :disabled="!canClaimStarterPermission" @click="claimStarterPermission">
        {{ rentalBusy ? 'Checking…' : 'Claim free starter permission' }}
      </button>
    </section>
    <div class="lesson-actions">
      <button v-if="(!session && !retainedPass) || (complete && assessment !== 'passed')" type="button" :disabled="!canStart" @click="startLesson">{{ busy ? 'Loading…' : complete ? 'Practise again' : 'Start practice' }}</button>
      <button v-else-if="canResume" type="button" :disabled="busy" @click="resumeLesson">{{ busy ? 'Resuming…' : 'Resume saved lesson' }}</button>
      <button v-if="canRestart && !restartConfirmation" type="button" class="secondary" @click="restartConfirmation = true">Restart practice</button>
      <button v-if="active || boarding" type="button" class="secondary" @click="pauseLesson">Pause safely</button>
      <button v-if="!online || needsRefresh" type="button" class="secondary" :disabled="busy" @click="load">Reconnect and check lesson</button>
      <button type="button" class="secondary" @click="shell.close()">Close</button>
    </div>
    <section v-if="restartConfirmation && canRestart" class="restart-confirmation" role="group" aria-label="Confirm restart practice">
      <p>Starting a new attempt replaces this incomplete lesson and its checkpoint progress. Any results or in-game cash already earned remain saved.</p>
      <div class="restart-actions">
        <button type="button" class="secondary" @click="restartConfirmation = false">Cancel</button>
        <button type="button" :disabled="!canRestart || busy" @click="restartLesson">Start new attempt</button>
      </div>
    </section>
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
.starter-permission { display: grid; gap: 6px; padding: 12px; border: 1px solid color-mix(in srgb, var(--app-tint, #3783a4) 22%, #d9e1e5); border-radius: 12px; background: #fff; }
.starter-permission strong { font-size: 14px; }
.starter-permission p { margin: 0; font-size: 12px; line-height: 1.45; }
.starter-permission button { justify-self: start; min-height: 44px; padding: 9px 13px; border: 0; border-radius: 10px; background: #216d84; color: white; font: inherit; font-weight: 700; }
.lesson-status strong { display: block; font-size: 15px; }
.lesson-status p { margin: 5px 0; line-height: 1.4; font-size: 13px; }
.lesson-status small { display: block; font-size: 11px; line-height: 1.45; color: var(--c-muted, #5d6870); }
.restart-confirmation { display: grid; gap: 8px; padding: 12px; border: 1px solid color-mix(in srgb, var(--app-tint, #3783a4) 28%, #d9e1e5); border-radius: 12px; background: #fff; }
.restart-confirmation p { margin: 0; font-size: 13px; line-height: 1.45; }
.restart-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.lesson-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.lesson-actions button, .controls button { min-width: 44px; min-height: 44px; padding: 9px 13px; border: 0; border-radius: 10px; background: #216d84; color: white; font: inherit; font-weight: 700; touch-action: none; }
.lesson-actions button.secondary { background: #e7edf0; color: #25323a; }
.restart-actions button { min-width: 44px; min-height: 44px; padding: 9px 13px; border: 0; border-radius: 10px; background: #216d84; color: white; font: inherit; font-weight: 700; }
.restart-actions button.secondary { background: #e7edf0; color: #25323a; }
button:disabled { opacity: .48; }
.controls { display: grid; grid-template-columns: 1fr 1fr; align-items: stretch; gap: 10px; }
 .gear-selector { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; grid-column: 1 / -1; }
.gear-selector button { min-height: 48px; }
.gear-selector button[aria-pressed="true"] { outline: 3px solid #f1b83a; outline-offset: 1px; }
.transmission-status { grid-column: 1 / -1; margin: 0; padding: 7px 9px; border-radius: 8px; background: #f1f5f6; color: #29373e; font-size: 12px; line-height: 1.35; }
.wheel-controls { display: grid; grid-template-columns: 44px 88px 44px; justify-content: center; align-items: center; gap: 8px; grid-column: 1 / -1; }
.wheel-controls button { font-size: 21px; }
.wheel-controls > button { width: 44px; min-width: 44px; padding: 0; }
.steering-control { display: grid; justify-items: center; gap: 3px; }
.steering-readout { font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.1; white-space: nowrap; }
.steering-wheel { width: 88px; height: 88px; touch-action: none; user-select: none; cursor: grab; border-radius: 50%; outline-offset: 2px; }
.steering-wheel:active { cursor: grabbing; }
.steering-wheel:focus-visible { outline: 3px solid #f1b83a; }
.steering-wheel svg { display: block; width: 100%; height: 100%; overflow: visible; transform: rotate(var(--wheel-rotation)); transition: transform 60ms linear; }
.wheel-rim { fill: #26343c; stroke: #122027; stroke-width: 5; }
.wheel-hub { fill: #cbd6da; stroke: #122027; stroke-width: 2; }
.wheel-spoke { fill: none; stroke: #122027; stroke-width: 5; stroke-linecap: round; }
.controls .drive-control { min-height: 58px; }
.controls .throttle { background: #26764e; }
.controls .brake { background: #a33e3a; }
@media (min-width: 720px) { .driving-app { max-width: 780px; margin: auto; } .driving-view { height: 390px; } .controls { grid-template-columns: 1fr 1fr 1fr; } .wheel-controls { grid-column: auto; } }
@media (max-height: 430px) and (min-width: 481px) { .driving-view { height: clamp(120px, 35vh, 180px); height: clamp(120px, 35svh, 180px); min-height: 120px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } .steering-wheel svg { transition: none; } }
</style>
