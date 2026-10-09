<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { UNILAG_BETA_RULES } from '../../../campus/unilag/curriculum.ts'
import type { AssessmentPracticePhase } from '../../../campus/unilag/assessment-practice.ts'
import type { AssessmentOperation, AssessmentResponse, AssessmentStartRequest, AssessmentStepRequest } from '../../../types/living-world-assessment.ts'
import type { CityId } from '../../../types/protocol.ts'
import { useApp } from '../../state/app.ts'
import { readAssessmentReply, type AssessmentReply } from './assessmentReply.ts'

const emit = defineEmits<{ close: [] }>()
const { game } = useApp()
const cityId = computed<CityId>(() => game.view.value.cityId)
const actorId = computed(() => game.view.value.session?.id ?? '')
const life = computed(() => game.state.value)
const student = computed(() => life.value.unilagStudent)
const term = computed(() => student.value?.term ?? null)
const termKey = computed(() => JSON.stringify([
  student.value?.programme ?? null,
  term.value?.semester ?? null,
  term.value?.startDay ?? null,
]))
const contextKey = computed(() => JSON.stringify([
  actorId.value, cityId.value, life.value.location, life.value.spot, termKey.value,
]))
const canReadCurrentTerm = computed(() => {
  const currentStudent = student.value, currentTerm = term.value
  return Boolean(actorId.value && (currentStudent?.status === 'studying' || currentStudent?.status === 'deferred') && currentStudent.programme === 'computer'
    && currentTerm !== null && currentTerm.semester === 1 && Number.isSafeInteger(currentTerm.startDay)
    && currentTerm.registeredCourses.includes('cpe-101'))
})
const canMutate = computed(() => canReadCurrentTerm.value && student.value?.status === 'studying'
  && life.value.location === 'unilag' && life.value.spot === 'engineering' && life.value.activeAction === null)
const actionBlockReason = computed(() => !canReadCurrentTerm.value ? 'This lab is limited to your active CPE-101 semester.'
  : student.value?.status === 'deferred' ? 'Resume your semester to continue the saved assignment.'
    : life.value.location !== 'unilag' || life.value.spot !== 'engineering' ? 'Return to the engineering classroom to work on the assignment.'
      : life.value.activeAction !== null ? 'Finish your current activity before changing the assignment.' : '')

type PendingAttempt =
  | { kind: 'start'; cityId: CityId; requestId: string }
  | { kind: 'step'; cityId: CityId; requestId: string; expectedRevision: number; operation: AssessmentOperation }

const reply = ref<AssessmentReply | null>(null)
const attempt = ref<PendingAttempt | null>(null)
const busy = ref(false)
const online = ref(true)
const needsRefresh = ref(false)
const courseRefreshPending = ref(false)
const courseRefreshing = ref(false)
const feedback = ref('Loading the saved assignment…')
const inputA = ref(false)
const inputB = ref(false)
const mounted = ref(false)
let generation = 0
let disposed = false
let lastCourseRefreshKey = ''

const practice = computed(() => reply.value?.practice ?? null)
const phase = computed<AssessmentPracticePhase | null>(() => practice.value?.phase ?? null)
const canStart = computed(() => canMutate.value && online.value && !needsRefresh.value && !busy.value
  && !practice.value && reply.value?.ok === true && reply.value.assignmentMark === null && (!attempt.value || attempt.value.kind === 'start'))
const canOperate = computed(() => canMutate.value && online.value && !needsRefresh.value && !busy.value
  && Boolean(practice.value) && practice.value?.phase !== 'complete' && !attempt.value)
const currentPairRecorded = computed(() => {
  const observations = phase.value === 'verify' || phase.value === 'submit' ? practice.value?.verificationProbes : practice.value?.initialProbes
  return observations?.some((row) => row.a === inputA.value && row.b === inputB.value) ?? false
})
const repairedCircuit = computed(() => phase.value === 'verify' || phase.value === 'submit' || phase.value === 'complete')
const observedOutput = computed(() => {
  const rows = repairedCircuit.value ? practice.value?.verificationProbes : practice.value?.initialProbes
  return rows?.find(row => row.a === inputA.value && row.b === inputB.value)?.output ?? null
})
const canInspect = computed(() => canOperate.value && phase.value === 'inspect' && inputA.value !== inputB.value
  && practice.value?.initialProbes.some((row) => row.a === inputA.value && row.b === inputB.value && row.output) === true)

function requestCurrent(token: number, key: string): boolean {
  return !disposed && token === generation && key === contextKey.value
}
function failClosed(message: string): void {
  needsRefresh.value = true
  feedback.value = message
}
function termMatches(answer: AssessmentReply): boolean {
  if (answer.term === null) return answer.practice === null
  const currentTerm = term.value
  return canReadCurrentTerm.value && currentTerm !== null && currentTerm.semester === answer.term.semester
    && currentTerm.startDay === answer.term.startDay && answer.term.courseId === 'cpe-101'
}
function reconcileAttempt(answer: AssessmentReply): void {
  const pending = attempt.value
  if (!pending) return
  if (pending.kind === 'start') {
    if (answer.practice || answer.assignmentMark !== null) attempt.value = null
    return
  }
  const currentRevision = answer.revision
  if (currentRevision === null || currentRevision > pending.expectedRevision) attempt.value = null
}
async function refreshCourseRecord(answer: AssessmentReply, token: number, key: string, force = false): Promise<void> {
  const mark = answer.assignmentMark
  if (mark === null || courseRefreshing.value || !requestCurrent(token, key)) return
  const recorded = student.value?.term?.assessments?.['cpe-101']?.assignment ?? null
  if (!force && recorded === mark) { courseRefreshPending.value = false; return }
  const refreshKey = JSON.stringify([actorId.value, cityId.value, answer.term?.startDay ?? term.value?.startDay ?? null, mark])
  if (!force && refreshKey === lastCourseRefreshKey) return
  lastCourseRefreshKey = refreshKey
  courseRefreshing.value = true
  try {
    const refreshed = await game.refresh().catch(() => false)
    if (!requestCurrent(token, key)) return
    courseRefreshPending.value = !refreshed
    if (!refreshed) feedback.value += ' The course record refresh is pending.'
  } finally { if (requestCurrent(token, key)) courseRefreshing.value = false }
}
function acceptReply(answer: AssessmentReply, token: number, key: string, expectedRevision: number | null, kind: 'load' | 'start' | 'step'): boolean {
  if (!requestCurrent(token, key)) return false
  if (kind === 'load' && !answer.ok) {
    failClosed(answer.feedback || (answer.code === 'invalid_saved_assessment' || answer.code === 'assessment_record_mismatch'
      ? 'Your saved assignment could not be verified. Its progress has been preserved. Refresh your course record before continuing.'
      : 'The saved assignment is unavailable. Refresh before continuing.'))
    return false
  }
  if (!termMatches(answer)) {
    failClosed('The saved assignment belongs to a different semester context. Refresh the campus record before continuing.')
    return false
  }
  const previous = reply.value
  if (previous?.revision !== null && previous?.revision !== undefined && answer.revision !== null && answer.revision < previous.revision) {
    failClosed('A late assignment reply was ignored. Refresh to check the saved course record.')
    return false
  }
  if (previous?.practice && !answer.practice) {
    failClosed('The saved lab is missing from this reply. The in-memory assignment was preserved; refresh before continuing.')
    return false
  }
  if (previous?.assignmentMark !== null && previous?.assignmentMark !== undefined && answer.assignmentMark === null && !answer.practice) {
    failClosed('The existing assignment mark was missing from this reply. Refresh the course record before continuing.')
    return false
  }
  if (kind === 'start' && answer.ok && !answer.practice) {
    failClosed('The start reply did not include the saved lab. Refresh to verify the assignment before retrying.')
    return false
  }
  if (kind === 'step' && answer.ok) {
    const confirmedProgress = expectedRevision !== null && answer.revision === expectedRevision + 1
    const confirmedRepeat = expectedRevision !== null && answer.revision === expectedRevision && answer.duplicate === true
    if (!confirmedProgress && !confirmedRepeat) {
      failClosed('The step reply did not confirm saved progress. Refresh the assignment before continuing.')
      return false
    }
  }
  if (expectedRevision !== null && previous?.revision !== null && previous?.revision !== undefined && previous.revision !== expectedRevision) {
    failClosed('The saved lab changed during that action. Refresh to review the current step.')
    return false
  }
  reply.value = answer
  online.value = true
  needsRefresh.value = false
  reconcileAttempt(answer)
  if (kind === 'step' && answer.ok) attempt.value = null
  feedback.value = answer.feedback || answer.practice?.feedback || (answer.assignmentMark !== null
    ? `This assignment is already recorded: ${answer.assignmentMark}/${UNILAG_BETA_RULES.assignmentWeight}.`
    : answer.practice ? 'Saved assignment state confirmed.' : 'Open the free lab when you are ready.')
  if (answer.assignmentMark !== null) void refreshCourseRecord(answer, token, key)
  return true
}

async function load(): Promise<void> {
  if (!actorId.value || busy.value) {
    if (!actorId.value) feedback.value = 'Sign in to open the saved assignment.'
    return
  }
  const token = generation, key = contextKey.value
  busy.value = true
  try {
    const raw = await game.client.api<AssessmentResponse>(`/api/living-world/assessment?city=${encodeURIComponent(cityId.value)}`, {}, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = readAssessmentReply(raw)
    if (!answer) { failClosed('The assignment reply could not be verified. Refresh before continuing.'); return }
    if (acceptReply(answer, token, key, null, 'load')) online.value = true
  } catch (error) {
    if (requestCurrent(token, key)) {
      online.value = false
      failClosed(error instanceof Error && error.message ? error.message : 'Offline. Refresh to check the saved assignment.')
    }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

async function start(): Promise<void> {
  if (!canStart.value) return
  let pending = attempt.value
  if (!pending || pending.kind !== 'start') pending = { kind: 'start', cityId: cityId.value, requestId: game.newId() }
  attempt.value = pending
  const token = generation, key = contextKey.value
  busy.value = true
  try {
    const body: AssessmentStartRequest = { cityId: pending.cityId, requestId: pending.requestId }
    const raw = await game.client.api<AssessmentResponse>('/api/living-world/assessment/start', { method: 'POST', body }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = readAssessmentReply(raw)
    if (!answer) { failClosed('Start delivery is uncertain. Refresh to check the saved lab before retrying.'); return }
    const accepted = acceptReply(answer, token, key, null, 'start')
    if (accepted && !answer.ok) { attempt.value = null; feedback.value = answer.feedback || 'The assignment did not start. Review the course record and try again.' }
  } catch (error) {
    if (requestCurrent(token, key)) {
      online.value = false
      failClosed(error instanceof Error && error.message ? error.message : 'Start delivery is uncertain. Refresh to verify the saved assignment.')
    }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

async function step(operation: AssessmentOperation): Promise<void> {
  const saved = reply.value
  if (!canMutate.value || !online.value || needsRefresh.value || busy.value || !saved || saved.revision === null
    || !practice.value || practice.value.phase === 'complete') return
  let pending = attempt.value
  if (pending && pending.kind !== 'step') return
  if (pending && (pending.expectedRevision !== saved.revision || JSON.stringify(pending.operation) !== JSON.stringify(operation))) return
  if (!pending && !canOperate.value) return
  if (!pending) pending = { kind: 'step', cityId: cityId.value, requestId: game.newId(), expectedRevision: saved.revision, operation }
  attempt.value = pending
  const token = generation, key = contextKey.value, before = saved.revision
  busy.value = true
  try {
    const body: AssessmentStepRequest = {
      cityId: pending.cityId, requestId: pending.requestId, expectedRevision: pending.expectedRevision, operation: pending.operation,
    }
    const raw = await game.client.api<AssessmentResponse>('/api/living-world/assessment/step', { method: 'POST', body }, () => requestCurrent(token, key))
    if (!requestCurrent(token, key)) return
    const answer = readAssessmentReply(raw)
    if (!answer) { failClosed('Step delivery is uncertain. Refresh to compare the saved state before retrying.'); return }
    const accepted = acceptReply(answer, token, key, before, 'step')
    if (accepted && !answer.ok) {
      attempt.value = null
      feedback.value = answer.feedback || 'The server kept the current assignment step.'
      if (answer.code === 'revision_conflict') needsRefresh.value = true
    }
  } catch (error) {
    if (requestCurrent(token, key)) {
      online.value = false
      failClosed(error instanceof Error && error.message ? error.message : 'Step delivery is uncertain. Refresh to check the saved lab.')
    }
  } finally { if (requestCurrent(token, key)) busy.value = false }
}

function submitProbe(): void { void step({ kind: 'probe', a: inputA.value, b: inputB.value }) }
function inspectProbe(): void { void step({ kind: 'inspect', a: inputA.value, b: inputB.value }) }
function repair(gate: 'or' | 'and' | 'xor'): void { void step({ kind: 'repair', gate }) }
function submitAssignment(): void { void step({ kind: 'submit' }) }
function retryPending(): void {
  const pending = attempt.value
  if (pending?.kind === 'start') void start()
  else if (pending?.kind === 'step') void step(pending.operation)
}
function refreshCurrentCourseRecord(): void {
  if (reply.value) void refreshCourseRecord(reply.value, generation, contextKey.value, true)
}

watch(contextKey, () => {
  generation++
  attempt.value = null; reply.value = null; busy.value = false; online.value = true; needsRefresh.value = false
  courseRefreshPending.value = false
  courseRefreshing.value = false
  inputA.value = false; inputB.value = false
  feedback.value = 'Loading the saved assignment…'
  if (mounted.value) void load()
}, { flush: 'sync' })
watch(canMutate, (active, wasActive) => {
  if (active && !wasActive && reply.value) feedback.value = reply.value.practice?.feedback || 'You are back at the class and can continue the saved assignment.'
})
onMounted(() => { disposed = false; mounted.value = true; void load() })
onBeforeUnmount(() => { disposed = true; mounted.value = false; generation++ })
</script>

<template>
  <main class="assignment-app" aria-label="Computer Engineering Foundations assignment">
    <header class="assignment-heading">
      <div>
        <p class="eyebrow">CPE-101 · free assignment lab</p>
        <h2>Repair the logic gate</h2>
        <p>A fictional logic exercise. Use the probes and compare each output with the target truth table.</p>
      </div>
      <button class="close-button" type="button" aria-label="Close assignment" @click="emit('close')">Close</button>
    </header>

    <section v-if="!actorId" class="notice" role="status">Sign in to load the saved assignment.</section>
    <section v-else-if="reply?.assignmentMark !== null && reply?.assignmentMark !== undefined && !practice" class="notice result" aria-label="Existing assignment mark">
      <strong>Assignment already recorded</strong>
      <span>{{ reply.assignmentMark }}/{{ UNILAG_BETA_RULES.assignmentWeight }}</span>
      <p>Your existing academic mark is preserved.</p>
    </section>
    <section v-else-if="!canReadCurrentTerm" class="notice" role="status">This lab is available only for your active Computer Engineering semester 1 CPE-101 course.</section>
    <template v-else>
      <section v-if="busy && !reply" class="notice" role="status">Loading your saved CPE-101 assignment…</section>
      <p v-if="actionBlockReason" class="feedback access-note" role="status">{{ actionBlockReason }}</p>
      <template v-else-if="practice">
        <section class="lab-panel" aria-label="Saved logic lab">
          <div class="lab-status">
            <span>Step: {{ practice.phase }}</span>
            <span>Revision {{ practice.revision }}</span>
          </div>
          <p>{{ practice.instructions }}</p>

          <div class="circuit-card">
            <svg class="circuit" viewBox="0 0 360 112" role="img" aria-labelledby="circuit-title circuit-description">
              <title id="circuit-title">Logic probe circuit</title>
              <desc id="circuit-description">{{ repairedCircuit ? 'The repaired AND gate is ready for verification.' : 'Two selectable inputs pass through a faulty OR gate.' }} The output shows the saved observation for the selected inputs.</desc>
              <path d="M25 32h78M25 80h78M228 56h100" class="wire" />
              <circle cx="25" cy="32" r="8" :class="['input-node', { active: inputA }]" />
              <circle cx="25" cy="80" r="8" :class="['input-node', { active: inputB }]" />
              <path :d="repairedCircuit ? 'M112 18h38a38 38 0 0 1 0 76h-38Z' : 'M112 18c42 0 62 14 80 38-18 24-38 38-80 38 16-23 16-53 0-76Z'" class="gate" />
              <text x="151" y="62" class="gate-label">{{ repairedCircuit ? 'AND' : 'OR' }}</text>
              <circle cx="328" cy="56" r="8" :class="['input-node', { active: observedOutput === true }]" />
              <text x="328" y="86" class="gate-label">{{ observedOutput === null ? '?' : observedOutput ? '1' : '0' }}</text>
              <text x="8" y="18" class="wire-label">A</text>
              <text x="8" y="108" class="wire-label">B</text>
              <text x="231" y="45" class="wire-label">Observed output</text>
            </svg>
            <div class="input-controls" role="group" aria-label="Circuit inputs">
              <button type="button" class="touch-button" :disabled="!canOperate || Boolean(attempt)" :aria-pressed="inputA" @click="inputA = !inputA">Input A: {{ inputA ? '1' : '0' }}</button>
              <button type="button" class="touch-button" :disabled="!canOperate || Boolean(attempt)" :aria-pressed="inputB" @click="inputB = !inputB">Input B: {{ inputB ? '1' : '0' }}</button>
              <button v-if="phase === 'inspect' || phase === 'verify'" type="button" class="touch-button primary"
                :disabled="!canOperate" @click="submitProbe">{{ currentPairRecorded ? 'Probe recorded' : phase === 'verify' ? 'Run verification probe' : 'Run probe' }}</button>
              <button v-if="phase === 'inspect'" type="button" class="touch-button"
                :disabled="!canInspect" @click="inspectProbe">Inspect this counterexample</button>
            </div>
          </div>

          <div class="tables">
            <section class="truth-table" aria-label="Authored target truth table">
              <h3>Target table (AND)</h3>
              <table><thead><tr><th>A</th><th>B</th><th>Target</th></tr></thead>
                <tbody><tr v-for="row in practice.targetTable" :key="`${Number(row.a)}${Number(row.b)}`">
                  <td>{{ row.a ? 1 : 0 }}</td><td>{{ row.b ? 1 : 0 }}</td><td>{{ row.output ? 1 : 0 }}</td>
                </tr></tbody>
              </table>
            </section>
            <section class="truth-table" aria-label="Server-recorded observations">
              <h3>{{ phase === 'verify' || phase === 'submit' || phase === 'complete' ? 'Repaired probes' : 'Faulty-gate probes' }}</h3>
              <table><thead><tr><th>A</th><th>B</th><th>Observed</th></tr></thead>
                <tbody><tr v-for="row in phase === 'verify' || phase === 'submit' || phase === 'complete' ? practice.verificationProbes : practice.initialProbes" :key="`${Number(row.a)}${Number(row.b)}`"
                  :class="{ counterexample: practice.counterexample && row.a === practice.counterexample.a && row.b === practice.counterexample.b }">
                  <td>{{ row.a ? 1 : 0 }}</td><td>{{ row.b ? 1 : 0 }}</td><td>{{ row.output ? 1 : 0 }}<small v-if="practice.counterexample && row.a === practice.counterexample.a && row.b === practice.counterexample.b"> · counterexample</small></td>
                </tr></tbody>
              </table>
            </section>
          </div>

          <section v-if="phase === 'repair'" class="repair-panel" aria-label="Select a gate repair">
            <h3>Choose a repair</h3>
            <p>The inspected mixed-input observation is true, while the target output is false.</p>
            <div class="input-controls">
              <button type="button" class="touch-button" :disabled="!canOperate" @click="repair('or')">Keep OR</button>
              <button type="button" class="touch-button primary" :disabled="!canOperate" @click="repair('and')">Install AND</button>
              <button type="button" class="touch-button" :disabled="!canOperate" @click="repair('xor')">Install XOR</button>
            </div>
          </section>

          <section v-if="phase === 'submit'" class="repair-panel">
            <h3>All four outputs match</h3>
            <p>Submit the verified assignment to record the server-derived mark.</p>
            <button type="button" class="touch-button primary" :disabled="!canOperate" @click="submitAssignment">Submit assignment</button>
          </section>
          <section v-if="phase === 'complete'" class="notice result" aria-label="Assignment result">
            <strong>Assignment recorded</strong>
            <span>{{ reply?.assignmentMark }}/{{ UNILAG_BETA_RULES.assignmentWeight }}</span>
          </section>
        </section>
      </template>

      <section v-else-if="reply?.ok && reply.term" class="notice">
        <strong>Ready to begin</strong>
        <p>This free lab is saved to your current CPE-101 assignment. Your existing academic record stays unchanged until you complete and submit the probes.</p>
        <button type="button" class="touch-button primary" :disabled="!canStart" @click="start">{{ attempt?.kind === 'start' ? 'Retry same start' : 'Start free lab' }}</button>
      </section>

      <section v-else-if="reply" class="notice" role="status">The current server response does not include an eligible CPE-101 semester.</section>
    </template>

    <p class="feedback" role="status" aria-live="polite">{{ feedback }}</p>
    <div class="footer-actions">
      <button v-if="attempt?.kind === 'step' && !busy && !needsRefresh" type="button" class="touch-button primary" @click="retryPending">Retry the same operation</button>
      <button v-if="needsRefresh || !online" type="button" class="touch-button" :disabled="busy" @click="load">Refresh saved assignment</button>
      <button v-if="courseRefreshPending" type="button" class="touch-button" :disabled="courseRefreshing" @click="refreshCurrentCourseRecord">Refresh course record</button>
    </div>
  </main>
</template>

<style scoped>
.assignment-app{display:grid;gap:16px;width:100%;min-width:0;color:#172d32;font:inherit}
.assignment-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.assignment-heading h2{margin:3px 0 6px;font-size:clamp(1.15rem,4vw,1.55rem);line-height:1.2}
.assignment-heading p{margin:0;color:#52676b;font-size:.92rem;line-height:1.45}
.eyebrow{font-size:.72rem!important;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#32756f!important}
.close-button,.touch-button{min-height:46px;border:1px solid #c2d0cc;border-radius:12px;padding:10px 14px;background:#fff;color:#183a3a;font:inherit;font-weight:700;cursor:pointer;touch-action:manipulation}
.close-button{flex:none}.touch-button:disabled,.close-button:disabled{opacity:.5;cursor:not-allowed}
.touch-button.primary{background:#176c63;border-color:#176c63;color:#fff}
.notice,.lab-panel{min-width:0;border:1px solid #d6e0dc;border-radius:16px;background:#fbfdfc;padding:16px}
.notice{display:grid;gap:8px}.notice p{margin:0;color:#52676b;line-height:1.45}.notice.result{grid-template-columns:1fr auto;align-items:center;background:#f1faf5}.notice.result p{grid-column:1/-1}.notice.result span{font-weight:800;font-size:1.15rem}
.lab-panel{display:grid;gap:16px}.lab-panel>p{margin:0;color:#52676b;line-height:1.45}
.lab-status{display:flex;justify-content:space-between;gap:8px;color:#32635f;font-size:.84rem;font-weight:750}
.circuit-card{display:grid;gap:8px;min-width:0;border-radius:14px;background:#f0f7f5;padding:12px}
.circuit{display:block;width:100%;max-height:140px}.wire{fill:none;stroke:#516f70;stroke-width:4;stroke-linecap:round}.input-node{fill:#fff;stroke:#657e7d;stroke-width:4}.input-node.active{fill:#52b89c;stroke:#176c63}.gate{fill:#fff;stroke:#176c63;stroke-width:4}.gate-label{fill:#185d56;font-size:18px;font-weight:800;text-anchor:middle}.wire-label{fill:#425b5e;font-size:13px;font-weight:700}
.input-controls{display:flex;flex-wrap:wrap;gap:8px;min-width:0}.input-controls>*{flex:1 1 130px;min-width:0}
.tables{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.truth-table{min-width:0;border:1px solid #e0e8e4;border-radius:12px;padding:12px}.truth-table h3,.repair-panel h3{margin:0 0 8px;font-size:.95rem}.truth-table table{width:100%;border-collapse:collapse;text-align:center;font-variant-numeric:tabular-nums}.truth-table th,.truth-table td{padding:6px 4px;border-bottom:1px solid #e8eeeb}.truth-table tr:last-child td{border-bottom:0}
.truth-table tr.counterexample{background:#fff3dd}.truth-table small{font-size:.7rem;color:#8b5616}
.repair-panel{display:grid;gap:8px;border:1px solid #d6e0dc;border-radius:14px;padding:14px}.repair-panel p{margin:0;color:#52676b;line-height:1.45}
.feedback{min-height:1.4em;margin:0;color:#315b57;font-size:.9rem}.footer-actions{display:flex;flex-wrap:wrap;gap:8px}
@media(max-width:420px){.assignment-heading{align-items:center}.assignment-heading p:not(.eyebrow){font-size:.86rem}.tables{grid-template-columns:1fr}.notice,.lab-panel{padding:12px}.circuit-card{padding:8px}}
</style>
