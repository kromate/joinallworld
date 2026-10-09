<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { ClerkClaimRequest, ClerkResponse as ClerkResponseBody, ClerkStartRequest, ClerkStepRequest } from '../../../types/living-world-clerk.ts'
import type { ClerkPracticeStep } from '../../../game/living-world/clerk.ts'
import type { CityId } from '../../../types/protocol.ts'
import { readClerkReply, type ClerkReply } from './clerkReply.ts'

type ClerkStep = ClerkPracticeStep
type PendingAttempt =
  | { kind: 'start'; cityId: CityId; requestId: string }
  | { kind: 'step'; cityId: CityId; requestId: string; revision: number; stepId: Exclude<ClerkStep, 'complete'>; evidenceId: string }
  | { kind: 'claim'; cityId: CityId; requestId: string; revision: number }

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const cityId = computed(() => game.view.value.cityId)
const publicId = computed(() => game.view.value.session?.id ?? '')
const contextKey = computed(() => JSON.stringify([cityId.value, game.state.value.location, publicId.value]))
const reply = ref<ClerkReply | null>(null)
const attempt = ref<PendingAttempt | null>(null)
const busy = ref(false)
const online = ref(true)
const needsRefresh = ref(false)
const feedback = ref('Loading the saved NPC practice…')
const mounted = ref(false)
let generation = 0
let disposed = false

const practice = computed(() => reply.value?.practice ?? null)
const canStart = computed(() => Boolean(publicId.value) && online.value && !needsRefresh.value && !busy.value
  && !practice.value && (!attempt.value || attempt.value.kind === 'start'))
const canAct = computed(() => Boolean(publicId.value) && online.value && !needsRefresh.value && !busy.value && Boolean(practice.value)
  && (!attempt.value || attempt.value.kind === 'step'))
const canClaim = computed(() => Boolean(publicId.value) && online.value && !needsRefresh.value && !busy.value
  && practice.value?.step === 'complete' && reply.value?.claimed === false
  && (!attempt.value || attempt.value.kind === 'claim'))
const stepNames: Record<ClerkStep, string> = {
  inspect_receipt: 'Inspect the receiving receipt',
  inspect_dispatch: 'Inspect the dispatch note',
  compare_discrepancy: 'Compare the two records',
  choose_outcome: 'Choose a safe next step',
  complete: 'Practice complete',
}
const stepNumber = computed(() => practice.value ? (['inspect_receipt', 'inspect_dispatch', 'compare_discrepancy', 'choose_outcome', 'complete'] as const).indexOf(practice.value.step) + 1 : 0)

function requestCurrent(token: number, key: string): boolean { return !disposed && token === generation && key === contextKey.value }
function failClosed(message: string): void { needsRefresh.value = true; feedback.value = message }

function reconcileAttempt(answer: ClerkReply): void {
  const pending = attempt.value
  if (!pending) return
  if (pending.kind === 'start' && answer.practice) attempt.value = null
  else if (pending.kind === 'step' && answer.revision !== null && answer.revision > pending.revision) attempt.value = null
  else if (pending.kind === 'claim' && answer.claimed) attempt.value = null
}
function acceptReply(answer: ClerkReply, token: number, key: string, expectedRevision: number | null, kind: 'load' | 'start' | 'step' | 'claim'): boolean {
  if (!requestCurrent(token, key)) return false
  const previous = reply.value
  if (previous?.revision !== null && previous?.revision !== undefined && answer.revision !== null && answer.revision < previous.revision) {
    failClosed('A late practice reply was ignored. Reconnect to check the saved case exercise.')
    return false
  }
  if (kind === 'load' && !answer.ok) { failClosed(answer.reason || 'The saved practice could not be read. Retry the connection.'); return false }
  if (kind === 'start' && answer.ok && !answer.practice) { failClosed('The start reply did not include saved practice. Reconnect to verify it.'); return false }
  if (kind === 'step' && answer.ok && (answer.revision === null || expectedRevision === null || answer.revision <= expectedRevision)) {
    failClosed('The step reply did not confirm saved progress. Reconnect before continuing.')
    return false
  }
  if (kind === 'claim' && answer.ok && !answer.claimed) { failClosed('The claim reply did not confirm the saved result. Reconnect before retrying.'); return false }
  if (expectedRevision !== null && previous?.revision !== null && previous?.revision !== undefined && previous.revision !== expectedRevision) {
    failClosed('The saved practice changed during that action. Reconnect to review the current state.')
    return false
  }
  reply.value = answer
  online.value = true
  needsRefresh.value = false
  reconcileAttempt(answer)
  feedback.value = answer.reason || (answer.claimed ? 'The one-time fictional game-cash claim is recorded.'
    : answer.practice?.result?.explanation || (answer.practice ? 'Saved practice state confirmed by the server.' : 'Start the fictional NPC practice when ready.'))
  return true
}

async function load(): Promise<void> {
  if (!publicId.value || busy.value) {
    if (!publicId.value) feedback.value = 'Sign in to open the fictional NPC practice.'
    return
  }
  const token = generation, key = contextKey.value
  busy.value = true
  try {
    const raw = await game.client.api<ClerkResponseBody>(`/api/living-world/clerk?city=${encodeURIComponent(cityId.value)}`, {}, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = readClerkReply(raw)
    if (!answer) { failClosed('The saved practice reply could not be verified. Reconnect to check it.'); return }
    if (acceptReply(answer, token, key, null, 'load')) online.value = true
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; failClosed(error instanceof Error && error.message ? error.message : 'Offline. Reconnect to check saved practice.') }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

async function startPractice(): Promise<void> {
  if (!canStart.value) return
  const token = generation, key = contextKey.value
  let pending = attempt.value
  if (!pending || pending.kind !== 'start') pending = { kind: 'start', cityId: cityId.value, requestId: game.newId() }
  attempt.value = pending
  busy.value = true
  try {
    const body: ClerkStartRequest = { cityId: pending.cityId, requestId: pending.requestId }
    const raw = await game.client.api<ClerkResponseBody>('/api/living-world/clerk/start', {
      method: 'POST', body,
    }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = readClerkReply(raw)
    if (!answer) { failClosed('Start delivery is uncertain. Reconnect to check the saved practice before retrying.'); return }
    const accepted = acceptReply(answer, token, key, null, 'start')
    if (accepted && !answer.ok) { attempt.value = null; feedback.value = answer.reason || 'The practice did not start. Review the response and try again.' }
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; failClosed(error instanceof Error && error.message ? error.message : 'Start delivery is uncertain. Reconnect to verify saved practice.') }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

async function submitStep(evidenceId: string): Promise<void> {
  const saved = reply.value, current = saved?.practice
  if (!canAct.value || !saved || !current || current.step === 'complete' || saved.revision === null) return
  const stepId = current.step as Exclude<ClerkPracticeStep, 'complete'>
  let pending = attempt.value
  if (pending && (pending.kind !== 'step' || pending.revision !== saved.revision || pending.stepId !== stepId || pending.evidenceId !== evidenceId)) return
  if (!pending) pending = { kind: 'step', cityId: cityId.value, requestId: game.newId(), revision: saved.revision, stepId, evidenceId }
  attempt.value = pending
  const token = generation, key = contextKey.value, before = saved.revision
  busy.value = true
  try {
    const body: ClerkStepRequest = { cityId: pending.cityId, requestId: pending.requestId, revision: pending.revision, stepId: pending.stepId, evidenceId: pending.evidenceId }
    const raw = await game.client.api<ClerkResponseBody>('/api/living-world/clerk/step', {
      method: 'POST', body,
    }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = readClerkReply(raw)
    if (!answer) { failClosed('Step delivery is uncertain. Reconnect to compare the saved practice before retrying.'); return }
    const accepted = acceptReply(answer, token, key, before, 'step')
    if (accepted && !answer.ok) { attempt.value = null; feedback.value = answer.reason || 'The server kept the current practice step.' }
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; failClosed(error instanceof Error && error.message ? error.message : 'Step delivery is uncertain. Reconnect to check saved practice.') }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

async function claimResult(): Promise<void> {
  const saved = reply.value
  if (!canClaim.value || !saved || saved.revision === null) return
  let pending = attempt.value
  if (pending && (pending.kind !== 'claim' || pending.revision !== saved.revision)) return
  if (!pending) pending = { kind: 'claim', cityId: cityId.value, requestId: game.newId(), revision: saved.revision }
  attempt.value = pending
  const token = generation, key = contextKey.value, before = saved.revision
  busy.value = true
  try {
    const body: ClerkClaimRequest = { cityId: pending.cityId, requestId: pending.requestId, revision: pending.revision }
    const raw = await game.client.api<ClerkResponseBody>('/api/living-world/clerk/claim', {
      method: 'POST', body,
    }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = readClerkReply(raw)
    if (!answer) { failClosed('Claim delivery is uncertain. Reconnect to verify the saved result before retrying.'); return }
    const accepted = acceptReply(answer, token, key, before, 'claim')
    if (accepted && !answer.ok) { attempt.value = null; feedback.value = answer.reason || 'The saved result remains available to review.' }
  } catch (error) {
    if (requestCurrent(token, key)) { online.value = false; failClosed(error instanceof Error && error.message ? error.message : 'Claim delivery is uncertain. Reconnect to check the saved result.') }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

function stageFor(step: ClerkStep): string { return stepNames[step] }
function retryLabel(kind: PendingAttempt['kind']): string { return attempt.value?.kind === kind ? 'Retry the same request' : '' }
function close(): void { shell.close() }

watch(contextKey, () => {
  generation++
  attempt.value = null; reply.value = null; busy.value = false; online.value = true; needsRefresh.value = false
  feedback.value = 'Loading the saved NPC practice…'
  if (mounted.value) void load()
})
onMounted(() => { disposed = false; mounted.value = true; void load() })
onBeforeUnmount(() => { disposed = true; mounted.value = false; generation++ })
</script>

<template>
  <main class="clerk-app" aria-label="Fictional NPC mediation practice">
    <header class="clerk-heading">
      <p class="eyebrow">NPC mediation practice</p>
      <h2>Help reconcile a delivery record</h2>
      <p>This is a fictional practice exercise with an NPC. It is not a real case, legal advice, or a justice service.</p>
    </header>

    <section class="practice-card" aria-label="Saved practice exercise">
      <div class="practice-topline">
        <span>Practice</span>
        <span v-if="practice">Step {{ stepNumber }} of 5</span>
      </div>
      <template v-if="practice">
        <h3>{{ practice.title }}</h3>
        <p class="narrative">{{ practice.narrative }}</p>
        <div class="progress-track" role="progressbar" :aria-valuenow="stepNumber" aria-valuemin="0" aria-valuemax="5" :aria-label="`Practice step ${stepNumber} of 5`">
          <span :style="{ width: `${stepNumber * 20}%` }" />
        </div>
        <section class="objective" :aria-label="stageFor(practice.step)">
          <strong>{{ practice.prompt }}</strong>
          <div v-if="practice.evidence.length" class="evidence-list" aria-label="Practice records">
            <article v-for="item in practice.evidence" :key="item.id" class="evidence-card">
              <h4>{{ item.label }}</h4>
              <p>{{ item.text }}</p>
              <button v-if="practice.step === 'inspect_receipt' || practice.step === 'inspect_dispatch'" type="button" class="action-button"
                :disabled="!canAct || Boolean(attempt && (attempt.kind !== 'step' || attempt.revision !== reply?.revision || attempt.stepId !== practice.step || attempt.evidenceId !== item.id))"
                @click="submitStep(item.id)">{{ attempt?.kind === 'step' && attempt.evidenceId === item.id ? retryLabel('step') : 'Record inspection' }}</button>
            </article>
          </div>
          <div v-if="practice.choices.length" class="choice-list" role="group" :aria-label="practice.prompt">
            <button v-for="choice in practice.choices" :key="choice.id" type="button" class="choice-button"
              :disabled="!canAct || Boolean(attempt && (attempt.kind !== 'step' || attempt.revision !== reply?.revision || attempt.stepId !== practice.step || attempt.evidenceId !== choice.id))"
              @click="submitStep(choice.id)">{{ attempt?.kind === 'step' && attempt.evidenceId === choice.id ? retryLabel('step') : choice.label }}</button>
          </div>
          <div v-if="practice.result" class="result-card" aria-label="Saved practice finding">
            <strong>{{ practice.result.finding }}</strong>
            <p>{{ practice.result.outcome }}</p>
            <small>{{ practice.result.explanation }}</small>
          </div>
        </section>
      </template>
      <div v-else class="empty-state">
        <h3>Start with the saved records</h3>
        <p>The NPC will show you two fictional delivery notes to inspect and compare.</p>
      </div>

      <p class="feedback" role="status">{{ feedback }}</p>
      <div class="practice-actions">
        <button v-if="!practice" type="button" class="primary-button" :disabled="!canStart" @click="startPractice">
          {{ retryLabel('start') || 'Start free practice' }}
        </button>
        <button v-if="canClaim" type="button" class="primary-button" @click="claimResult">
          {{ retryLabel('claim') || `Claim ${reply?.reward ?? 75} fictional game cash` }}
        </button>
        <p v-if="practice?.step === 'complete' && reply?.claimed" class="claim-record">Claim recorded: {{ reply.reward }} gross fictional game cash. Automatic ride-debt repayment can affect spendable balance.</p>
        <button v-if="!online || needsRefresh" type="button" class="secondary-button" :disabled="busy || !publicId" @click="load">Reconnect and check saved practice</button>
        <button type="button" class="secondary-button" @click="close">Close</button>
      </div>
      <p class="reward-note">Practice is free. A completed exercise may be claimed once for 75 fictional game cash; server confirmation records the claim.</p>
    </section>
  </main>
</template>

<style scoped>
.clerk-app { display: grid; gap: 14px; width: 100%; max-width: 720px; min-width: 0; margin: 0 auto; color: var(--c-ink, #202830); }
.clerk-heading { display: grid; gap: 5px; min-width: 0; }
.eyebrow { margin: 0; color: var(--c-muted, #5d6870); font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.clerk-heading h2 { margin: 0; font-size: 21px; line-height: 1.2; }
.clerk-heading p:last-child, .narrative, .reward-note, .empty-state p { margin: 0; color: var(--c-muted, #5d6870); font-size: 13px; line-height: 1.45; }
.practice-card { display: grid; gap: 12px; min-width: 0; padding: 14px; border: 1px solid var(--c-line, #d9e1e5); border-radius: 16px; background: var(--c-surface, #fff); }
.practice-topline { display: flex; justify-content: space-between; gap: 8px; color: var(--c-muted, #5d6870); font-size: 12px; font-weight: 700; }
.practice-card h3 { margin: 0; font-size: 18px; }
.progress-track { height: 8px; overflow: hidden; border-radius: 99px; background: #e7edf0; }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: #176f91; transition: width .16s ease-out; }
.objective { display: grid; gap: 10px; min-width: 0; }
.objective > strong { font-size: 15px; line-height: 1.4; }
.evidence-list { display: grid; gap: 8px; min-width: 0; }
.evidence-card, .result-card { display: grid; gap: 6px; min-width: 0; padding: 12px; border: 1px solid var(--c-line, #d9e1e5); border-radius: 12px; background: #f8fafb; }
.evidence-card h4 { margin: 0; font-size: 14px; }
.evidence-card p, .result-card p, .result-card small { margin: 0; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
.result-card { border-color: #a6d3bc; background: #eff8f2; }
.result-card small { color: var(--c-muted, #5d6870); }
.choice-list { display: grid; gap: 8px; }
.choice-button, .action-button, .practice-actions button { min-width: 44px; min-height: 44px; padding: 10px 12px; border: 1px solid var(--c-line, #d0d9de); border-radius: 11px; background: #fff; color: var(--c-ink, #202830); font: 650 14px/1.35 var(--font, system-ui); text-align: left; touch-action: manipulation; overflow-wrap: anywhere; }
.action-button { justify-self: start; min-height: 44px; font-size: 13px; }
.choice-button:disabled, .action-button:disabled, .practice-actions button:disabled { opacity: .55; }
.feedback { min-height: 1.4em; margin: 0; color: #37464e; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
.practice-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.practice-actions button { text-align: center; }
.practice-actions .primary-button { background: #176f91; border-color: #176f91; color: #fff; }
.practice-actions .secondary-button { background: #e7edf0; border-color: #d0d9de; }
.claim-record { flex: 1 1 100%; margin: 0; color: #17633e; font-size: 13px; line-height: 1.45; }
.empty-state { display: grid; gap: 6px; }
.empty-state h3 { margin: 0; font-size: 16px; }
button:focus-visible { outline: 3px solid var(--c-blue, #176f91); outline-offset: 2px; }
@media (max-width: 520px) { .practice-card { padding: 11px; border-radius: 13px; } .clerk-app { gap: 11px; } }
@media (prefers-reduced-motion: reduce) { .progress-track span { transition: none; } }
</style>
