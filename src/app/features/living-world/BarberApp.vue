<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { BarberClaimRequest, BarberControlPacket, BarberLifecycleRequest, BarberResponse, BarberStartRequest, BarberUpgradeRequest } from '../../../types/living-world-barber.ts'
import type { BarberLessonId } from '../../../game/living-world/barber-catalogue.ts'
import { barberLesson, BARBER_STARTER_TOOL_COST } from '../../../game/living-world/barber-catalogue.ts'
import type { BarberPoint, BarberPracticeInput, BarberToolId } from '../../../game/living-world/barber.ts'
import { readBarberReply } from './barberReply.ts'
import type { BarberApiReply } from './barberReply.ts'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const cityId = computed(() => game.view.value.cityId)
const contextKey = computed(() => JSON.stringify([cityId.value, game.state.value.location, game.view.value.session?.id ?? '']))
const reply = ref<BarberApiReply | null>(null)
const selectedLesson = ref<BarberLessonId>('basic')
const selectedTool = ref<BarberToolId>('comb')
const cursor = ref<BarberPoint>({ x: 0.5, y: 0.45 })
const strokeHeld = ref(false)
const active = ref(false), busy = ref(false), online = ref(true), needsRefresh = ref(false)
const feedback = ref('Loading the mannequin lesson…')
const keyboardStroke = ref(false)
const surface = ref<SVGSVGElement | null>(null)
const currentSession = computed(() => reply.value?.session ?? null)
const practice = computed(() => currentSession.value?.practice ?? null)
const plan = computed(() => practice.value?.plan ?? reply.value?.plan ?? null)
const objective = computed(() => {
  const state = practice.value, steps = plan.value?.objectives
  return state && steps && state.objectiveIndex < steps.length ? steps[state.objectiveIndex] ?? null : null
})
const coveragePercent = computed(() => objective.value && practice.value ? Math.min(100, Math.round(practice.value.coverage / objective.value.coverageRequired * 100)) : 100)
const results = computed(() => reply.value?.results ?? [])
const basicEarned = computed(() => results.value.some(result => result.lessonId === 'basic'))
const advancedEarned = computed(() => results.value.some(result => result.lessonId === 'advanced'))
const canStartBasic = computed(() => online.value && !busy.value && !needsRefresh.value && !currentSession.value && !basicEarned.value)
const canStartAdvanced = computed(() => online.value && !busy.value && !needsRefresh.value && !currentSession.value && basicEarned.value && Boolean(reply.value?.starterTool) && !advancedEarned.value)
const canResume = computed(() => online.value && !busy.value && !needsRefresh.value && !active.value && currentSession.value?.status === 'paused')
const canClaim = computed(() => online.value && !busy.value && !needsRefresh.value && currentSession.value?.status === 'complete'
  && practice.value?.status === 'complete' && !results.value.some(result => result.lessonId === currentSession.value?.lessonId))
const canUpgrade = computed(() => online.value && !busy.value && !needsRefresh.value && basicEarned.value && !reply.value?.starterTool)
const tools: readonly BarberToolId[] = ['comb', 'clippers', 'scissors', 'brush']
const toolNames: Record<BarberToolId, string> = { comb: 'Comb', clippers: 'Clippers', scissors: 'Scissors', brush: 'Brush' }
const lessonNames: Record<BarberLessonId, string> = { basic: 'Mannequin basics', advanced: 'Mannequin fade' }
const payout = computed(() => barberLesson(currentSession.value?.lessonId ?? selectedLesson.value)?.payout ?? 80)
type StartAttempt = { lessonId: BarberLessonId; requestId: string }
type RequestAttempt = { lessonId: BarberLessonId; sessionId: string; requestId: string }
const startAttempt = ref<StartAttempt | null>(null)
const claimAttempt = ref<RequestAttempt | null>(null)
const upgradeAttempt = ref<{ requestId: string } | null>(null)
let generation = 0, mounted = false, disposed = false, inputInFlight = false
let pauseAfterInput: string | null = null
let sampleTimer = 0, flushTimer = 0, pointerId: number | null = null
let pendingFrames: BarberPracticeInput[] = []

function requestCurrent(token: number, key: string): boolean { return !disposed && token === generation && key === contextKey.value }
function replyFrom(value: unknown): BarberApiReply | null { return readBarberReply(value) }
function errorText(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback }
function clearInput(): void {
  strokeHeld.value = false; keyboardStroke.value = false; pointerId = null; pendingFrames = []
  if (sampleTimer) window.clearInterval(sampleTimer)
  if (flushTimer) window.clearInterval(flushTimer)
  sampleTimer = flushTimer = 0
}
function stopPractice(message?: string): void { active.value = false; clearInput(); if (message) feedback.value = message }
function setCursor(point: BarberPoint): void { cursor.value = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) } }
function surfacePoint(event: PointerEvent): BarberPoint | null {
  const svg = surface.value, transform = svg?.getScreenCTM()
  if (!svg || !transform) return null
  const point = svg.createSVGPoint()
  point.x = event.clientX; point.y = event.clientY
  const local = point.matrixTransform(transform.inverse())
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y) || local.x < 0 || local.x > 1 || local.y < 0 || local.y > 1) return null
  return { x: local.x, y: local.y }
}
function startLoops(): void {
  clearInput()
  if (!active.value) return
  sampleTimer = window.setInterval(() => {
    if (!active.value || currentSession.value?.status !== 'running') return
    pendingFrames.push({ tool: selectedTool.value, x: cursor.value.x, y: cursor.value.y, pressed: strokeHeld.value })
    if (pendingFrames.length > 5) pendingFrames.shift()
  }, 100)
  flushTimer = window.setInterval(() => { void sendFrames() }, 250)
}
function acceptReply(answer: BarberApiReply, token: number, key: string, expectedSession: string | null, kind: 'load' | 'start' | 'input' | 'lifecycle' | 'claim' | 'upgrade'): boolean {
  if (!requestCurrent(token, key)) return false
  const previous = currentSession.value
  if ((previous?.sessionId ?? null) !== expectedSession) {
    needsRefresh.value = true; stopPractice('The saved lesson changed in another request. Reconnect and check its current state.')
    return false
  }
  const canonical = answer.session
  if (canonical && (canonical.cityId !== cityId.value || canonical.location !== game.state.value.location)) {
    needsRefresh.value = true; stopPractice('The lesson is bound to another place. Reconnect after returning to the barber.')
    return false
  }
  const adoptNewSession = kind === 'load' || kind === 'start' && (answer.ok || ['lesson_active', 'lesson_already_started', 'lesson_retained'].includes(answer.code))
  if (canonical && previous && canonical.sessionId !== previous.sessionId && !adoptNewSession) {
    needsRefresh.value = true; stopPractice('The saved lesson changed in another session. Reconnect and check it.')
    return false
  }
  if (canonical && canonical.sessionId === previous?.sessionId && canonical.revision < previous.revision) {
    needsRefresh.value = true; stopPractice('A late lesson reply was ignored. Reconnect and check the latest progress.')
    return false
  }
  if (!canonical && previous && expectedSession !== previous.sessionId && kind !== 'load') {
    needsRefresh.value = true; stopPractice('The saved lesson changed in another session. Reconnect and check it.')
    return false
  }
  reply.value = answer
  online.value = true
  if (answer.results.some(result => result.lessonId === 'basic') && upgradeAttempt.value && answer.starterTool) upgradeAttempt.value = null
  feedback.value = answer.reason || canonical?.practice.feedback || (answer.code === 'lesson_claimed' ? 'The mannequin result was recorded and its gross game-cash credit applied.' : 'Lesson state updated from the server.')
  if (kind === 'input' && (!answer.ok || !canonical || canonical.status !== 'running')) stopPractice(canonical?.practice.feedback || answer.reason || 'Practice stopped. Review the saved lesson before continuing.')
  if (canonical?.status === 'complete' || !canonical || canonical.status === 'paused') stopPractice(canonical?.practice.feedback || feedback.value)
  return true
}

async function load(): Promise<void> {
  if (!game.view.value.session?.id) { feedback.value = 'Sign in to open the mannequin apprenticeship.'; return }
  const token = generation, key = contextKey.value, expected = currentSession.value?.sessionId ?? null
  busy.value = true
  try {
    const raw = await game.client.api<BarberResponse>(`/api/living-world/barber?city=${encodeURIComponent(cityId.value)}`, undefined, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = replyFrom(raw)
    if (!answer) { needsRefresh.value = true; stopPractice('The saved barber lesson could not be verified. Reconnect to check it.'); return }
    if (acceptReply(answer, token, key, expected, 'load')) {
      needsRefresh.value = false; active.value = false; clearInput()
      if (answer.session?.status === 'running') await lifecycle('pause', answer.session, token, key)
      if (startAttempt.value && (answer.session?.lessonId === startAttempt.value.lessonId
        || results.value.some(result => result.lessonId === startAttempt.value?.lessonId))) startAttempt.value = null
      if (claimAttempt.value && results.value.some(result => result.lessonId === claimAttempt.value?.lessonId)) claimAttempt.value = null
    }
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; needsRefresh.value = true; stopPractice(errorText(error, 'Offline. Reconnect to check the saved mannequin lesson.')) }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

async function startLesson(lessonId: BarberLessonId): Promise<void> {
  if (lessonId === 'basic' ? !canStartBasic.value : !canStartAdvanced.value) return
  const token = generation, key = contextKey.value, expected = currentSession.value?.sessionId ?? null
  let attempt = startAttempt.value
  if (!attempt || attempt.lessonId !== lessonId) {
    attempt = { lessonId, requestId: game.newId() }
    startAttempt.value = attempt
  }
  const body: BarberStartRequest = { cityId: cityId.value, lessonId, requestId: attempt.requestId }
  busy.value = true
  try {
    const raw = await game.client.api<BarberResponse>('/api/living-world/barber/start', { method: 'POST', body }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = replyFrom(raw)
    if (!answer) { needsRefresh.value = true; stopPractice('The start reply could not be verified. Reconnect before trying again.'); return }
    const accepted = acceptReply(answer, token, key, expected, 'start')
    if (answer.ok && accepted && answer.session?.status === 'running') { startAttempt.value = null; selectedTool.value = answer.session.practice.plan.objectives[0]?.tool ?? 'comb'; beginPractice(); void revealPracticeSurface(token, key, answer.session.sessionId) }
    else if (accepted && ['lesson_active', 'lesson_already_started', 'lesson_retained'].includes(answer.code)) { startAttempt.value = null; needsRefresh.value = true; feedback.value = 'A saved lesson or result already exists. Reconnect to review it before continuing.' }
    else if (accepted && !answer.ok) startAttempt.value = null
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; needsRefresh.value = true; stopPractice(errorText(error, 'Start delivery is uncertain. Reconnect to check the saved lesson.')) }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

function beginPractice(): void {
  if (currentSession.value?.status !== 'running' || !online.value || needsRefresh.value) return
  active.value = true; startLoops(); feedback.value = 'Choose the highlighted tool and make short, slow strokes across the mannequin target.'
}
async function revealPracticeSurface(token: number, key: string, sessionId: string): Promise<void> {
  await nextTick()
  const svg = surface.value, saved = currentSession.value
  if (!mounted || !requestCurrent(token, key) || document.hidden || !active.value || !online.value || needsRefresh.value
    || saved?.sessionId !== sessionId || saved.status !== 'running' || !svg?.isConnected || !svg.getClientRects().length) return
  svg.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
  svg.focus({ preventScroll: true })
}
async function lifecycle(action: 'pause' | 'resume', saved = currentSession.value, token = generation, key = contextKey.value): Promise<void> {
  if (!saved) return
  const expected = saved.sessionId
  const body: BarberLifecycleRequest = { cityId: saved.cityId, requestId: game.newId(), sessionId: saved.sessionId, revision: saved.revision }
  try {
    const raw = await game.client.api<BarberResponse>(`/api/living-world/barber/${action}`, { method: 'POST', body }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = replyFrom(raw)
    if (!answer) { needsRefresh.value = true; stopPractice('The lesson state could not be verified. Reconnect before continuing.'); return }
    const accepted = acceptReply(answer, token, key, expected, 'lifecycle')
    if (!accepted) return
    if (answer.ok && answer.session?.sessionId === expected && answer.session.status === 'running' && action === 'resume') {
      beginPractice()
      void revealPracticeSurface(token, key, answer.session.sessionId)
    }
    else if (!answer.ok) {
      stopPractice(answer.reason || answer.session?.practice.feedback || 'The server changed the lesson. Reconnect and review it.')
      if (action === 'resume' && answer.session?.status === 'running') void lifecycle('pause', answer.session, token, key)
      else if (action === 'pause') needsRefresh.value = true
    } else if (action === 'pause') stopPractice(answer.session?.practice.feedback || 'Lesson paused safely. Resume when ready.')
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; needsRefresh.value = true; stopPractice(errorText(error, 'Offline. Controls stopped; reconnect before continuing.')) }
  }
}
async function pausePractice(): Promise<void> {
  const saved = currentSession.value
  stopPractice('Stopping strokes and pausing the lesson…')
  if (!saved || saved.status !== 'running') return
  if (inputInFlight) { pauseAfterInput = saved.sessionId; return }
  await lifecycle('pause', saved)
}
async function resumePractice(): Promise<void> {
  if (!canResume.value || !currentSession.value) return
  const token = generation, key = contextKey.value
  busy.value = true
  try { await lifecycle('resume', currentSession.value, token, key) }
  finally { if (requestCurrent(token, key)) busy.value = false }
}

async function sendFrames(): Promise<void> {
  const saved = currentSession.value
  if (!active.value || !saved || saved.status !== 'running' || !pendingFrames.length || inputInFlight || !online.value) return
  const frames = pendingFrames.splice(0, 5)
  const packet: BarberControlPacket = { cityId: saved.cityId, sessionId: saved.sessionId, revision: saved.revision, sequence: saved.nextSequence, frames }
  const token = generation, key = contextKey.value, expected = saved.sessionId
  inputInFlight = true
  try {
    const raw = await game.client.api<BarberResponse>('/api/living-world/barber/input', { method: 'POST', body: packet }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = replyFrom(raw)
    if (!answer) { needsRefresh.value = true; stopPractice('The stroke reply could not be verified. Reconnect to check saved progress.'); pauseAfterInput = expected; return }
    const accepted = acceptReply(answer, token, key, expected, 'input')
    if (accepted && answer.ok && answer.session?.status === 'running') feedback.value = answer.session.practice.feedback
    else if (accepted && !answer.ok && answer.session?.status === 'running') {
      needsRefresh.value = true
      void lifecycle('pause', answer.session, token, key)
    }
  } catch (error) {
    if (requestCurrent(token, key)) {
      needsRefresh.value = true; online.value = false
      stopPractice(errorText(error, 'Stroke delivery is uncertain. Reconnect to read the saved lesson.'))
      // A timed-out input may have reached the server. Best-effort pause the
      // canonical session after this request settles; reconnect still verifies it.
      pauseAfterInput = expected
    }
  } finally {
    inputInFlight = false
    if (pauseAfterInput) {
      const sessionId = pauseAfterInput; pauseAfterInput = null
      const latest = currentSession.value
      if (latest?.sessionId === sessionId && latest.status === 'running') void lifecycle('pause', latest, token, key)
    }
  }
}

function pointerDown(event: PointerEvent): void {
  if (!active.value || pointerId !== null) return
  const point = surfacePoint(event)
  if (!point) return
  pointerId = event.pointerId; (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId)
  setCursor(point); strokeHeld.value = true
}
function pointerMove(event: PointerEvent): void { if (active.value && pointerId === event.pointerId) { const point = surfacePoint(event); if (point) setCursor(point) } }
function pointerUp(event: PointerEvent): void { if (pointerId === event.pointerId) { pointerId = null; strokeHeld.value = false } }
function keyDown(event: KeyboardEvent): void {
  if (!active.value || event.ctrlKey || event.metaKey || event.altKey) return
  const movements: Record<string, BarberPoint> = { ArrowLeft: { x: -0.035, y: 0 }, ArrowRight: { x: 0.035, y: 0 }, ArrowUp: { x: 0, y: -0.035 }, ArrowDown: { x: 0, y: 0.035 } }
  const move = movements[event.key]
  if (move) { event.preventDefault(); event.stopPropagation(); setCursor({ x: cursor.value.x + move.x, y: cursor.value.y + move.y }); return }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); keyboardStroke.value = true; strokeHeld.value = true }
}
function keyUp(event: KeyboardEvent): void {
  if ((event.key === 'Enter' || event.key === ' ') && keyboardStroke.value) { keyboardStroke.value = false; strokeHeld.value = false; event.preventDefault(); event.stopPropagation() }
}
function releaseFocus(): void { if (keyboardStroke.value) { keyboardStroke.value = false; strokeHeld.value = false } }
function selectTool(tool: BarberToolId): void { if (tool !== selectedTool.value) { selectedTool.value = tool; strokeHeld.value = false; keyboardStroke.value = false; pointerId = null } }
function visibility(): void { if (document.hidden) { if (active.value) void pausePractice(); else clearInput() } }
function blur(): void { releaseFocus(); if (active.value) void pausePractice(); else clearInput() }

async function claimResult(): Promise<void> {
  const saved = currentSession.value
  if (!canClaim.value || !saved || busy.value) return
  if (!claimAttempt.value || claimAttempt.value.sessionId !== saved.sessionId || claimAttempt.value.lessonId !== saved.lessonId)
    claimAttempt.value = { lessonId: saved.lessonId, sessionId: saved.sessionId, requestId: game.newId() }
  const attempt = claimAttempt.value!, token = generation, key = contextKey.value
  const body: BarberClaimRequest = { cityId: saved.cityId, lessonId: saved.lessonId, sessionId: saved.sessionId, requestId: attempt.requestId }
  busy.value = true; feedback.value = 'Submitting the one-time mannequin lesson payout…'
  try {
    const raw = await game.client.api<BarberResponse>('/api/living-world/barber/claim', { method: 'POST', body }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = replyFrom(raw)
    if (!answer) { needsRefresh.value = true; feedback.value = 'The payout reply could not be verified. Reconnect to check the saved result.'; return }
    const accepted = acceptReply(answer, token, key, saved.sessionId, 'claim')
    if (accepted && answer.ok) {
      const expectedStyle = barberLesson(saved.lessonId)?.resultStyleId
      const confirmed = answer.session?.sessionId === saved.sessionId && answer.session.lessonId === saved.lessonId
        && answer.session.status === 'complete' && answer.session.practice.status === 'complete'
        && answer.results.some(result => result.lessonId === saved.lessonId && result.styleId === expectedStyle)
      if (!confirmed) {
        needsRefresh.value = true
        feedback.value = 'The claim reply did not confirm this saved mannequin result. Reconnect to verify it before retrying.'
      } else {
        claimAttempt.value = null
        feedback.value = `Mannequin result recorded. Gross credit: ₦${payout.value} game cash. Automatic ride-debt repayment may reduce your spendable balance.`
      }
    }
    else if (accepted && !answer.ok) { claimAttempt.value = null; feedback.value = answer.reason || claimMessage(answer.code) }
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; needsRefresh.value = true; feedback.value = errorText(error, 'Payout delivery is uncertain. Reconnect to check it before trying again.') }
  } finally {
    if (requestCurrent(token, key)) {
      const refreshed = await game.refresh().catch(() => false)
      if (!requestCurrent(token, key)) return
      if (!refreshed && online.value) feedback.value += ' The cash balance refresh is pending.'
      busy.value = false
    }
  }
}
function claimMessage(code: string): string {
  if (code === 'lesson_incomplete') return 'Finish the highlighted stroke objectives before claiming the payout.'
  if (code === 'lesson_retained') return 'This mannequin lesson payout was already recorded.'
  if (code === 'insufficient_funds') return 'There is not enough game cash for that purchase.'
  return 'The server kept the current lesson state; reconnect to review it.'
}
async function upgradeTool(): Promise<void> {
  if (!canUpgrade.value || busy.value) return
  if (!upgradeAttempt.value) upgradeAttempt.value = { requestId: game.newId() }
  const attempt = upgradeAttempt.value!, token = generation, key = contextKey.value, expected = currentSession.value?.sessionId ?? null
  const body: BarberUpgradeRequest = { cityId: cityId.value, requestId: attempt.requestId }
  busy.value = true; feedback.value = `Buying the starter clipper upgrade for ₦${BARBER_STARTER_TOOL_COST} game cash…`
  try {
    const raw = await game.client.api<BarberResponse>('/api/living-world/barber/upgrade', { method: 'POST', body }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = replyFrom(raw)
    if (!answer) { needsRefresh.value = true; feedback.value = 'The purchase reply could not be verified. Reconnect to check the tool status.'; return }
    const accepted = acceptReply(answer, token, key, expected, 'upgrade')
    if (accepted && answer.ok && answer.starterTool) { upgradeAttempt.value = null; feedback.value = 'Starter clippers unlocked for advanced mannequin practice.' }
    else if (accepted && !answer.ok) { upgradeAttempt.value = null; feedback.value = claimMessage(answer.code) }
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; needsRefresh.value = true; feedback.value = errorText(error, 'Purchase delivery is uncertain. Reconnect to check the tool status.') }
  } finally {
    if (requestCurrent(token, key)) {
      const refreshed = await game.refresh().catch(() => false)
      if (!requestCurrent(token, key)) return
      if (!refreshed && online.value) feedback.value += ' The cash balance refresh is pending.'
      busy.value = false
    }
  }
}

watch(() => objective.value?.id, () => {
  const needed = objective.value?.tool
  if (needed && !strokeHeld.value) selectedTool.value = needed
})
watch(contextKey, async () => {
  const previous = currentSession.value
  generation++; const token = generation
  stopPractice(); reply.value = null; selectedTool.value = 'comb'; selectedLesson.value = 'basic';
  needsRefresh.value = false; online.value = true; busy.value = false; feedback.value = 'Loading the mannequin lesson…'
  startAttempt.value = null; claimAttempt.value = null; upgradeAttempt.value = null; pauseAfterInput = null
  if (previous?.status === 'running') void lifecycle('pause', previous, token - 1, '')
  if (mounted) await load()
}, { flush: 'sync' })
onMounted(() => {
  mounted = true; disposed = false
  window.addEventListener('blur', blur); window.addEventListener('keyup', keyUp, true)
  document.addEventListener('visibilitychange', visibility)
  void load()
})
onBeforeUnmount(() => {
  const previous = currentSession.value
  if (active.value) { stopPractice(); if (previous?.status === 'running' && !inputInFlight) void lifecycle('pause', previous, generation, contextKey.value) }
  else clearInput()
  if (inputInFlight && previous?.status === 'running') pauseAfterInput = previous.sessionId
  disposed = true; mounted = false; generation++
  window.removeEventListener('blur', blur); window.removeEventListener('keyup', keyUp, true)
  document.removeEventListener('visibilitychange', visibility)
  clearInput()
})
</script>

<template>
  <main class="barber-app" aria-label="NPC mannequin barber practice">
    <header class="barber-heading">
      <p class="eyebrow">NPC barber apprenticeship</p>
      <h2>Practice on a mannequin</h2>
      <p>Tool training on a simulated mannequin only. This is not a real client appointment and never changes your character’s look.</p>
    </header>

    <section class="practice-card" aria-label="Mannequin stroke practice">
      <div class="surface-wrap">
        <svg ref="surface" class="mannequin-surface" :class="{ 'is-running': active }" viewBox="0 0 1 1" role="application" tabindex="0"
          aria-label="Mannequin practice surface. Use arrow keys to move the cursor and hold Enter or Space to stroke."
          @pointerdown.prevent="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @lostpointercapture="pointerUp"
          @keydown="keyDown" @keyup="keyUp" @blur="releaseFocus">
          <rect width="1" height="1" rx=".08" fill="#e8eef1" />
          <path d="M.18 .92v-.12c0-.12.08-.2.2-.22l.12-.03.02-.13c-.13-.1-.21-.27-.21-.48 0-.28.17-.44.45-.44s.45.16.45.44c0 .21-.08.38-.21.48l.02.13.12.03c.12.02.2.1.2.22v.12z" fill="#d7b08c" stroke="#593e35" stroke-width=".018" />
          <path d="M.3 .36c.02-.22.17-.36.46-.36.26 0 .42.14.43.36-.1-.06-.2-.11-.28-.11-.15.1-.35.12-.61.11z" fill="#28333b" />
          <path d="M.39 .5h.04m.14 0h.04M.48 .59q.03.025.06 0" fill="none" stroke="#593e35" stroke-width=".012" stroke-linecap="round" />
          <rect v-if="objective" :x="objective.target.minX" :y="objective.target.minY" :width="objective.target.maxX - objective.target.minX" :height="objective.target.maxY - objective.target.minY"
            rx=".025" fill="#54bb8b" fill-opacity=".28" stroke="#14734c" stroke-width=".012" stroke-dasharray=".025 .018" />
          <circle :cx="cursor.x" :cy="cursor.y" r=".018" :fill="strokeHeld ? '#c64d44' : '#176f91'" stroke="white" stroke-width=".009" />
        </svg>
      </div>
      <div class="objective-summary" aria-live="polite">
        <strong>{{ practice?.status === 'complete' ? 'Practice complete' : objective ? `Step ${practice!.objectiveIndex + 1} of ${plan?.objectives.length}: ${objective.region}` : 'Choose a lesson to begin' }}</strong>
        <span v-if="objective">Use {{ toolNames[objective.tool] }} · {{ Math.round(objective.coverageRequired * 100) }}% target coverage</span>
        <span v-else-if="practice">The server has recorded the mannequin result.</span>
        <progress v-if="objective" :value="coveragePercent" max="100" :aria-label="`Target coverage ${coveragePercent}%`">{{ coveragePercent }}%</progress>
        <small v-if="objective">Server-confirmed target coverage: {{ coveragePercent }}%</small>
      </div>
      <div class="tool-row" role="group" aria-label="Choose barber tool">
        <button v-for="tool in tools" :key="tool" type="button" :aria-pressed="selectedTool === tool" :disabled="!active" :class="{ selected: selectedTool === tool }" @click="selectTool(tool)">{{ toolNames[tool] }}</button>
      </div>
      <p class="tool-status" aria-live="polite">Selected: <b>{{ toolNames[selectedTool] }}</b><template v-if="objective"> · Needed now: <b>{{ toolNames[objective.tool] }}</b></template></p>
      <p class="feedback" aria-live="polite">{{ feedback }}</p>
      <p class="keyboard-help">Pointer: hold and make short strokes. Keyboard: focus the mannequin; arrows move the cursor, Enter or Space starts a stroke and release lifts the tool.</p>
      <div class="practice-actions">
        <button v-if="!currentSession && !basicEarned" type="button" :disabled="!canStartBasic" @click="startLesson('basic')">{{ startAttempt?.lessonId === 'basic' ? 'Retry basic lesson' : 'Start free basics' }}</button>
        <button v-if="!currentSession && basicEarned && !advancedEarned" type="button" :disabled="!canStartAdvanced" @click="startLesson('advanced')">{{ reply?.starterTool ? 'Start advanced fade' : 'Advanced · unlock clippers first' }}</button>
        <button v-if="canResume" type="button" @click="resumePractice">Resume saved lesson</button>
        <button v-if="active" type="button" class="secondary" @click="pausePractice">Pause safely</button>
        <button v-if="canClaim" type="button" :disabled="busy" @click="claimResult">{{ claimAttempt ? `Retry claim · ₦${payout}` : `Claim result · ₦${payout} game cash` }}</button>
        <button v-if="canUpgrade" type="button" :disabled="busy" @click="upgradeTool">{{ upgradeAttempt ? `Retry upgrade · ₦${BARBER_STARTER_TOOL_COST}` : `Starter clippers · ₦${BARBER_STARTER_TOOL_COST}` }}</button>
        <button v-if="!online || needsRefresh" type="button" class="secondary" :disabled="busy" @click="load">Reconnect and check saved lesson</button>
        <button type="button" class="secondary" @click="shell.close()">Close</button>
      </div>
      <p class="economy-note">Basic training is free. A completed lesson can be claimed once for a gross ₦80 game-cash credit. The starter clipper upgrade costs ₦120 game cash. Automatic ride-debt repayment may affect your spendable balance; the server checks purchases against the current balance.</p>
    </section>

    <section class="record-card" aria-label="Apprenticeship record">
      <h3>Saved mannequin results</h3>
      <p v-if="!results.length">No mannequin lesson has been claimed yet.</p>
      <ul v-else><li v-for="result in results" :key="result.lessonId">{{ lessonNames[result.lessonId] }} · NPC mannequin result recorded</li></ul>
      <p>{{ reply?.starterTool ? 'Starter clippers unlocked.' : basicEarned ? 'Claim the basic result, then purchase starter clippers to unlock advanced practice.' : 'Complete and claim the free basics before advanced practice.' }}</p>
      <small>Results describe NPC mannequin practice only; they are not a credential, real appointment, or change to your player appearance.</small>
    </section>
  </main>
</template>

<style scoped>
.barber-app { display: grid; gap: 14px; max-width: 760px; min-width: 0; margin: 0 auto; color: var(--c-ink, #202830); }
.barber-heading { display: grid; gap: 5px; min-width: 0; }
.barber-heading .eyebrow { margin: 0; color: var(--c-muted, #5d6870); font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.barber-heading h2 { margin: 0; font-size: 21px; line-height: 1.2; }
.barber-heading p:last-child, .keyboard-help, .economy-note { margin: 0; color: var(--c-muted, #5d6870); font-size: 13px; line-height: 1.45; }
.practice-card, .record-card { display: grid; gap: 10px; min-width: 0; padding: 14px; border: 1px solid var(--c-line, #d9e1e5); border-radius: 16px; background: var(--c-surface, #fff); }
.surface-wrap { display: grid; justify-items: center; }
.mannequin-surface { display: block; width: min(100%, 360px); max-height: 42svh; aspect-ratio: 1; border-radius: 16px; outline: 0; touch-action: pan-y; }
.mannequin-surface.is-running { touch-action: none; cursor: crosshair; }
.mannequin-surface:focus-visible { outline: 3px solid var(--c-blue, #176f91); outline-offset: 3px; }
.objective-summary { display: grid; gap: 4px; }
.objective-summary strong { font-size: 15px; }
.objective-summary span, .objective-summary small { color: var(--c-muted, #5d6870); font-size: 13px; }
.objective-summary progress { width: 100%; height: 12px; accent-color: #168256; }
.tool-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
.tool-row button, .practice-actions button { min-width: 44px; min-height: 44px; padding: 8px 11px; border: 1px solid var(--c-line, #d0d9de); border-radius: 11px; background: #fff; color: var(--c-ink, #202830); font: 650 13px/1.2 var(--font, system-ui); touch-action: manipulation; }
.tool-row button.selected { border-color: #146947; background: #e4f3eb; color: #14573d; box-shadow: inset 0 0 0 1px #146947; }
.tool-row button:disabled, .practice-actions button:disabled { opacity: .52; }
.tool-status, .feedback { margin: 0; font-size: 13px; line-height: 1.4; }
.feedback { min-height: 1.4em; color: #37464e; }
.practice-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.practice-actions button { background: #1d6d84; border: 0; color: #fff; font-size: 14px; }
.practice-actions button.secondary { background: #e7edf0; color: #25323a; }
.record-card h3 { margin: 0; font-size: 16px; }
.record-card p, .record-card ul { margin: 0; font-size: 13px; line-height: 1.45; }
.record-card ul { padding-left: 20px; }
.record-card small { color: var(--c-muted, #5d6870); line-height: 1.4; }
button:focus-visible { outline: 3px solid var(--c-blue, #176f91); outline-offset: 2px; }
@media (max-width: 520px) {
  .practice-card, .record-card { padding: 11px; border-radius: 13px; }
  .mannequin-surface { width: min(100%, 340px); max-height: 38svh; }
  .tool-row { gap: 5px; }
  .tool-row button { padding-inline: 4px; font-size: 12px; }
}
@media (max-height: 430px) and (min-width: 481px) {
  .mannequin-surface { width: min(100%, 190px); max-height: 42svh; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
</style>
