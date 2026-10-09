<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { JusticePracticeAction, JusticePracticePhase, JusticeEvidenceId } from '../../../game/living-world/justice-practice.ts'
import type { CityId } from '../../../types/protocol.ts'
import type { JusticePracticeResponse, JusticePracticeStartRequest, JusticePracticeStepRequest } from '../../../types/living-world-justice.ts'
import { readJusticeReply, type JusticeReply } from './justiceReply.ts'

type Pending = { kind: 'start'; cityId: CityId; requestId: string }
  | { kind: 'step'; cityId: CityId; requestId: string; expectedRevision: number; action: JusticePracticeAction; actionKey: string }
type Operation = 'load' | 'start' | 'step'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const cityId = computed(() => game.view.value.cityId)
const publicId = computed(() => game.view.value.session?.id ?? '')
const contextKey = computed(() => JSON.stringify([cityId.value, game.state.value.location, publicId.value]))
const reply = ref<JusticeReply | null>(null)
const pending = ref<Pending | null>(null)
const busy = ref(false)
const online = ref(true)
const needsRefresh = ref(false)
const notice = ref('Loading saved practice…')
const selectedChoice = ref('')
const selectedReasons = ref<JusticeEvidenceId[]>([])
const mounted = ref(false)
let generation = 0
let disposed = false

const practice = computed(() => reply.value?.practice ?? null)
const phase = computed(() => practice.value?.phase ?? null)
const canConnect = computed(() => Boolean(publicId.value) && cityId.value === 'lagos')
const canAct = computed(() => canConnect.value && online.value && !needsRefresh.value && !busy.value && Boolean(practice.value)
  && (!pending.value || pending.value.kind === 'step'))
const phaseNames: Record<JusticePracticePhase, string> = {
  'inspect-initial': 'Inspect the sample records', 'initial-decision': 'Make an evidence-linked choice',
  'serve-notice': 'Send the sample NPC notice', 'inspect-review': 'Read the NPC review request',
  'review-decision': 'Respond to the NPC review', complete: 'Training sequence complete',
}
const stageNumber = computed(() => practice.value ? (['inspect-initial', 'initial-decision', 'serve-notice', 'inspect-review', 'review-decision', 'complete'] as const).indexOf(practice.value.phase) + 1 : 0)
const choices = computed(() => practice.value?.phase === 'initial-decision' ? practice.value.initialChoices
  : practice.value?.phase === 'review-decision' ? practice.value.reviewChoices : [])
const evidence = computed(() => practice.value?.evidence ?? [])
const pendingRetry = computed(() => pending.value?.kind === 'step' ? pending.value : null)
const selectedAction = computed<JusticePracticeAction | null>(() => {
  if (phase.value === 'inspect-initial' && selectedChoice.value.startsWith('inspect:')) return { kind: 'inspect', evidenceId: selectedChoice.value.slice(8) as JusticeEvidenceId }
  if (phase.value === 'initial-decision' && selectedChoice.value && selectedReasons.value.length) return {
    kind: 'initial-decision', choiceId: selectedChoice.value as Extract<JusticePracticeAction, { kind: 'initial-decision' }>['choiceId'], reasonEvidenceIds: [...selectedReasons.value],
  }
  if (phase.value === 'serve-notice' && selectedChoice.value === 'send-notice') return { kind: 'send-service-notice' }
  if (phase.value === 'inspect-review' && selectedChoice.value === 'inspect-review') return { kind: 'inspect-review' }
  if (phase.value === 'review-decision' && selectedChoice.value && selectedReasons.value.length) return {
    kind: 'review-decision', choiceId: selectedChoice.value as Extract<JusticePracticeAction, { kind: 'review-decision' }>['choiceId'], reasonEvidenceIds: [...selectedReasons.value],
  }
  return null
})
const selectedActionKey = computed(() => selectedAction.value ? JSON.stringify(selectedAction.value) : '')
const canSubmit = computed(() => canAct.value && practice.value !== null && (pending.value === null || pending.value.kind === 'step' && pending.value.actionKey === selectedActionKey.value)
  && Boolean(selectedAction.value))

function current(token: number, key: string): boolean { return !disposed && token === generation && key === contextKey.value }
function failClosed(message: string): void { needsRefresh.value = true; notice.value = message }
function reconcile(answer: JusticeReply, operation: Operation, beforeRevision: number | null): boolean {
  if (operation === 'load' && !answer.ok) { failClosed(answer.feedback || 'Saved practice is unavailable. Reconnect to check it.'); return false }
  if (operation === 'start' && answer.ok && !answer.practice) { failClosed('The start response did not include a saved case. Reconnect to verify it.'); return false }
  if (operation === 'step' && (!answer.practice || answer.revision === null || beforeRevision === null || answer.revision < beforeRevision
    || (answer.ok && answer.revision <= beforeRevision))) {
    failClosed('The step response did not confirm saved practice. Reconnect before continuing.')
    return false
  }
  const previousRevision = reply.value?.revision
  if (previousRevision !== null && previousRevision !== undefined && answer.revision !== null && answer.revision < previousRevision) {
    failClosed('A late reply was ignored. Reconnect to check the saved practice.')
    return false
  }
  reply.value = answer
  online.value = true
  needsRefresh.value = false
  if (operation === 'start' || operation === 'step') pending.value = null
  else if (pending.value?.kind === 'start' && answer.practice) pending.value = null
  else if (pending.value?.kind === 'step' && answer.revision !== null && answer.revision > pending.value.expectedRevision) pending.value = null
  notice.value = answer.feedback || (answer.practice?.trainingComplete
    ? 'Training complete. This records fictional practice only, not a verdict or privilege.'
    : answer.practice?.prompt || 'No saved practice yet. Start the fictional NPC exercise when ready.')
  selectedChoice.value = ''
  selectedReasons.value = []
  return true
}

async function load(): Promise<void> {
  if (!canConnect.value || busy.value) {
    if (!publicId.value) notice.value = 'Sign in to open the fictional practice.'
    else if (cityId.value !== 'lagos') notice.value = 'This fictional practice is currently available in Lagos.'
    return
  }
  const token = generation, key = contextKey.value
  busy.value = true
  try {
    const raw = await game.client.api<JusticePracticeResponse>(`/api/living-world/justice-practice?city=${encodeURIComponent(cityId.value)}`, {}, () => current(token, key))
    if (!current(token, key)) return
    const answer = readJusticeReply(raw)
    if (!answer) { failClosed('The saved practice response could not be verified. Reconnect to check it.'); return }
    reconcile(answer, 'load', null)
  } catch (error) {
    if (current(token, key)) { online.value = false; failClosed(error instanceof Error && error.message ? error.message : 'Offline. Reconnect to check saved practice.') }
  } finally { if (current(token, key)) busy.value = false }
}

async function start(): Promise<void> {
  if (!canConnect.value || !online.value || needsRefresh.value || busy.value || practice.value || pending.value?.kind === 'step') return
  const token = generation, key = contextKey.value
  let request = pending.value
  if (!request || request.kind !== 'start') request = { kind: 'start', cityId: cityId.value, requestId: game.newId() }
  pending.value = request
  busy.value = true
  try {
    const body: JusticePracticeStartRequest = { cityId: request.cityId, requestId: request.requestId }
    const raw = await game.client.api<JusticePracticeResponse>('/api/living-world/justice-practice/start', { method: 'POST', body }, () => current(token, key))
    if (!current(token, key)) return
    const answer = readJusticeReply(raw)
    if (!answer) { failClosed('Start delivery is uncertain. Reconnect to verify the saved case before retrying.'); return }
    reconcile(answer, 'start', null)
  } catch (error) {
    if (current(token, key)) { online.value = false; failClosed(error instanceof Error && error.message ? error.message : 'Start delivery is uncertain. Reconnect before retrying.') }
  } finally { if (current(token, key)) busy.value = false }
}

async function submit(action: JusticePracticeAction): Promise<void> {
  const saved = reply.value
  if (!canConnect.value || !canAct.value || !saved?.practice || saved.revision === null) return
  const actionKey = JSON.stringify(action)
  let request = pending.value
  if (request && (request.kind !== 'step' || request.expectedRevision !== saved.revision || request.actionKey !== actionKey)) return
  if (!request) request = { kind: 'step', cityId: cityId.value, requestId: game.newId(), expectedRevision: saved.revision, action, actionKey }
  pending.value = request
  const token = generation, key = contextKey.value, before = saved.revision
  busy.value = true
  try {
    const body: JusticePracticeStepRequest = { cityId: request.cityId, requestId: request.requestId, expectedRevision: request.expectedRevision, action: request.action }
    const raw = await game.client.api<JusticePracticeResponse>('/api/living-world/justice-practice/step', { method: 'POST', body }, () => current(token, key))
    if (!current(token, key)) return
    const answer = readJusticeReply(raw)
    if (!answer) { failClosed('Step delivery is uncertain. Reconnect to compare the saved case before retrying.'); return }
    reconcile(answer, 'step', before)
  } catch (error) {
    if (current(token, key)) { online.value = false; failClosed(error instanceof Error && error.message ? error.message : 'Step delivery is uncertain. Reconnect before retrying.') }
  } finally { if (current(token, key)) busy.value = false }
}

function choose(id: string): void {
  selectedChoice.value = id
  if (id.startsWith('inspect:') || id === 'send-notice' || id === 'inspect-review') {
    const action = selectedAction.value
    if (action) void submit(action)
  }
}
function submitSelected(): void { const action = selectedAction.value; if (action) void submit(action) }
function toggleReason(id: JusticeEvidenceId): void {
  if (!selectedReasons.value.includes(id) && selectedReasons.value.length >= 3) return
  selectedReasons.value = selectedReasons.value.includes(id) ? selectedReasons.value.filter(item => item !== id) : [...selectedReasons.value, id]
}
function retryPending(): void {
  const attempt = pending.value
  if (attempt?.kind === 'start') void start()
  else if (attempt?.kind === 'step') void submit(attempt.action)
}
function close(): void { shell.close() }

watch(contextKey, () => {
  generation++
  pending.value = null; reply.value = null; busy.value = false; online.value = true; needsRefresh.value = false
  selectedChoice.value = ''; selectedReasons.value = []
  notice.value = 'Loading saved practice…'
  if (mounted.value) void load()
}, { flush: 'sync' })
onMounted(() => { disposed = false; mounted.value = true; void load() })
onBeforeUnmount(() => { disposed = true; mounted.value = false; generation++ })
</script>

<template>
  <main class="justice-app" aria-label="Fictional NPC justice-process practice">
    <header class="heading">
      <p class="eyebrow">NPC process practice</p>
      <h2>Review a fictional shipment record</h2>
      <p>This is a fictional learning exercise. It is not legal advice, a real case, a verdict, or a justice service.</p>
    </header>
    <section class="case-card" aria-label="Saved fictional practice">
      <div class="topline"><span>Practice case</span><span v-if="practice">Stage {{ stageNumber }} of 6</span></div>
      <template v-if="practice">
        <h3>{{ practice.title }}</h3>
        <p class="summary">{{ practice.summary }}</p>
        <p class="prompt">{{ practice.prompt }}</p>
        <section v-if="practice.evidence.length" class="evidence" aria-label="Fictional records">
          <article v-for="item in practice.evidence" :key="item.id" class="evidence-card">
            <h4>{{ item.label }}</h4><p>{{ item.text }}</p>
            <p v-if="practice.reviewedEvidenceIds.includes(item.id)" class="reviewed" aria-label="Record already reviewed">Reviewed</p>
            <button v-else-if="phase === 'inspect-initial'" class="secondary" type="button" :disabled="!canAct || Boolean(pending)"
              @click="choose(`inspect:${item.id}`)">Inspect this record</button>
          </article>
        </section>
        <fieldset v-if="choices.length" class="choice-group" :disabled="!canAct || Boolean(pending)">
          <legend>{{ phase === 'initial-decision' ? 'Choose a first response' : 'Choose an NPC review response' }}</legend>
          <label v-for="choice in choices" :key="choice.id" class="choice">
            <input v-model="selectedChoice" type="radio" :value="choice.id">
            <span>{{ choice.label }}</span>
          </label>
          <p class="hint">Cite up to three records that support your choice.</p>
          <label v-for="item in evidence" :key="`reason-${item.id}`" class="reason">
            <input :checked="selectedReasons.includes(item.id)" type="checkbox" :disabled="!canAct || Boolean(pending) || (!selectedReasons.includes(item.id) && selectedReasons.length >= 3)" @change="toggleReason(item.id)">
            <span>{{ item.label }}</span>
          </label>
          <button class="primary" type="button" :disabled="!canSubmit" @click="submitSelected">Submit evidence-linked choice</button>
        </fieldset>
        <aside v-if="practice.serviceNotice" class="notice-card"><h4>NPC service notice</h4><p>{{ practice.serviceNotice }}</p></aside>
        <button v-if="phase === 'serve-notice'" class="primary" type="button" :disabled="!canAct || Boolean(pending)"
          @click="choose('send-notice')">Send the sample notice to the NPC</button>
        <aside v-if="practice.npcReviewRequest" class="notice-card"><h4>NPC review request</h4><p>{{ practice.npcReviewRequest }}</p></aside>
        <button v-if="phase === 'inspect-review'" class="primary" type="button" :disabled="!canAct || Boolean(pending)"
          @click="choose('inspect-review')">Read request and inspect the recount note</button>
        <p v-if="practice.trainingComplete" class="complete">{{ practice.prompt }}</p>
      </template>
      <div v-else class="empty"><h3>Start the sample case</h3><p>The exercise will show fictional records to inspect. Progress is saved by the server.</p></div>
      <p class="status" role="status">{{ notice }}</p>
      <div class="actions">
        <button v-if="!practice" class="primary" type="button" :disabled="!canConnect || !online || needsRefresh || busy || pending?.kind === 'step'" @click="start">
          {{ pending?.kind === 'start' ? 'Retry the same start request' : 'Start free practice' }}
        </button>
        <button v-if="pending" class="secondary" type="button" :disabled="busy || !online || needsRefresh" @click="retryPending">Retry the same request</button>
        <button v-if="!online || needsRefresh" class="secondary" type="button" :disabled="busy || !canConnect" @click="load">Reconnect and check saved practice</button>
        <button class="secondary" type="button" @click="close">Close</button>
      </div>
      <p class="footnote">Practice is free. Completion records training only and gives no legal status, authority, or privilege.</p>
    </section>
  </main>
</template>

<style scoped>
.justice-app { display:grid; gap:14px; width:100%; max-width:720px; min-width:0; margin:0 auto; color:var(--c-ink,#202830); }
.heading { display:grid; gap:5px; }.eyebrow { margin:0; color:var(--c-muted,#5d6870); font-size:12px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
.heading h2 { margin:0; font-size:21px; line-height:1.2; }.heading p:last-child,.summary,.empty p,.footnote { margin:0; color:var(--c-muted,#5d6870); font-size:13px; line-height:1.45; }
.case-card { display:grid; gap:12px; min-width:0; padding:14px; border:1px solid var(--c-line,#d9e1e5); border-radius:16px; background:var(--c-surface,#fff); }
.topline { display:flex; justify-content:space-between; gap:8px; color:var(--c-muted,#5d6870); font-size:12px; font-weight:700; }.case-card h3 { margin:0; font-size:18px; }.prompt { margin:0; font-weight:700; line-height:1.4; }
.evidence { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); gap:9px; }.evidence-card,.notice-card { min-width:0; padding:11px; border:1px solid var(--c-line,#d9e1e5); border-radius:12px; background:#f8fafb; }.evidence-card h4,.notice-card h4 { margin:0 0 5px; font-size:14px; }.evidence-card p,.notice-card p { margin:0 0 8px; font-size:13px; line-height:1.4; }
.evidence-card .reviewed { margin:8px 0 0; color:#176c61; font-size:12px; font-weight:700; }
.choice-group { display:grid; gap:9px; min-width:0; margin:0; padding:11px; border:1px solid var(--c-line,#d9e1e5); border-radius:12px; }.choice-group legend { padding:0 4px; font-weight:700; }.choice,.reason { display:flex; align-items:flex-start; gap:9px; min-height:44px; padding:8px; border-radius:9px; background:#f8fafb; line-height:1.35; }.choice input,.reason input { flex:0 0 auto; width:20px; height:20px; margin:2px 0 0; accent-color:#176c61; }.hint { margin:2px 0 0; color:var(--c-muted,#5d6870); font-size:12px; }
.primary,.secondary { min-height:46px; padding:10px 14px; border:1px solid #176c61; border-radius:10px; font:inherit; font-weight:700; cursor:pointer; }.primary { color:#fff; background:#176c61; }.secondary { color:#174e49; background:#fff; }.primary:disabled,.secondary:disabled { opacity:.55; cursor:not-allowed; }.status { margin:0; padding:9px 10px; border-radius:9px; background:#eef5f3; font-size:13px; line-height:1.4; }.complete { margin:0; padding:10px; border-radius:10px; background:#e8f3ee; line-height:1.45; }.actions { display:flex; flex-wrap:wrap; gap:9px; }.footnote { font-size:12px; }
@media(max-width:420px) { .case-card { padding:11px; }.evidence { grid-template-columns:1fr; }.actions > button { flex:1 1 100%; } }
@media(prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto !important; transition:none !important; } }
</style>
