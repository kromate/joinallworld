/**
 * Pure authored NPC process-training case. The server owns this state and applies it
 * transactionally; clients submit actions, never serialized progress or an outcome.
 * This fictional exercise is not legal advice, a real notice, a real case, or a verdict.
 */
export const JUSTICE_PRACTICE_CASE_ID = 'fictional-shipment-review-01' as const
export const JUSTICE_PRACTICE_SCHEMA_VERSION = 1 as const
export const JUSTICE_PRACTICE_MAX_RECEIPTS = 24
export const JUSTICE_PRACTICE_MAX_STATE_BYTES = 16_384

export type JusticeEvidenceId = 'dispatch-copy' | 'arrival-receipt' | 'seal-log' | 'npc-recount'
export type InitialChoiceId = 'pause-and-reconcile' | 'accept-receipt' | 'assign-responsibility'
export type ReviewChoiceId = 'correct-duplicate-entry' | 'keep-hold' | 'assign-responsibility'

const INITIAL_EVIDENCE = ['dispatch-copy', 'arrival-receipt', 'seal-log'] as const satisfies readonly JusticeEvidenceId[]
const INITIAL_REASONS = ['dispatch-copy', 'arrival-receipt'] as const satisfies readonly JusticeEvidenceId[]
const REVIEW_REASONS = ['dispatch-copy', 'npc-recount'] as const satisfies readonly JusticeEvidenceId[]
const INITIAL_CHOICES = ['pause-and-reconcile', 'accept-receipt', 'assign-responsibility'] as const
const REVIEW_CHOICES = ['correct-duplicate-entry', 'keep-hold', 'assign-responsibility'] as const

const CASE_TITLE = 'The duplicate tally'
const DISCLAIMER = 'Fictional process-training exercise. It is not legal advice or a real case.'
const CASE_SUMMARY = 'A depot clerk and a courier are resolving a sample shipment record. Compare the documents before choosing what to do.'
const SERVICE_NOTICE = 'Training action: send the NPC a notice that the two sample counts differ and ask for a record check. This sends no real message.'
const NPC_REVIEW_REQUEST = 'NPC review request: the receiving clerk asks for an independent review and supplies a recount note.'
const PROMPTS = Object.freeze({
  'inspect-initial': 'Inspect each of the three records. The exercise will not advance on a timer.',
  'initial-decision': 'Choose a procedural next step and cite both the dispatch copy and arrival receipt.',
  'serve-notice': 'Explicitly send the authored sample notice to the NPC to continue the exercise.',
  'inspect-review': 'Read the NPC review request and inspect the new recount note.',
  'review-decision': 'Choose how to update the sample record and cite the dispatch copy and NPC recount.',
  complete: 'Training sequence complete. This records practice completion only; it is not a finding or privilege.',
} as const)
const FEEDBACK = Object.freeze({
  advanced: 'Step recorded in this fictional training case.',
  inspected: 'Record inspected. Compare its count with the other documents.',
  alreadyInspected: 'That record is already in your reviewed evidence list.',
  needEvidence: 'Inspect the required records before making this choice.',
  citeCounts: 'Cite both the dispatch copy and arrival receipt to explain the mismatch.',
  compareCounts: 'The sources disagree. Pause and reconcile the counts before changing the sample record.',
  unsupportedConclusion: 'That conclusion is not supported by the inspected evidence. Review the requested records and try again.',
  noticeSent: 'The sample notice was marked sent. An NPC has now asked for an independent review.',
  reviewFirst: 'Read the NPC request and inspect the recount note before making the review decision.',
  citeReview: 'Cite both the dispatch copy and NPC recount to explain the record correction.',
  reviewEvidence: 'NPC recount inspected. Compare it with the dispatch copy.',
  reviewCounts: 'The recount supports correcting the duplicate entry. Cite it with the dispatch copy and try again.',
  complete: 'Training sequence complete. You compared records, sent a sample notice, and answered an NPC review request.',
  wrongPhase: 'That action is not available at this step. Follow the current training prompt.',
  revisionConflict: 'The saved practice changed. Refresh the current case before trying again.',
  requestConflict: 'This request ID was already used for a different action.',
  terminal: 'This training sequence is already complete.',
  capacity: 'This practice record reached its safe action limit. It cannot be reset or extended.',
  revisionExhausted: 'This practice record cannot safely accept another revision.',
  invalid: 'The practice record or action is invalid and was not changed.',
} as const)
export type JusticeFeedbackId = keyof typeof FEEDBACK
export type JusticeOutcomeCode = 'advanced' | 'feedback' | 'complete' | 'conflict' | 'terminal' | 'capacity' | 'invalid'

export type JusticePracticePhase = 'inspect-initial' | 'initial-decision' | 'serve-notice' | 'inspect-review' | 'review-decision' | 'complete'

export interface EvidenceLinkedChoice<C extends string> {
  readonly choiceId: C
  readonly reasonEvidenceIds: readonly JusticeEvidenceId[]
}

export interface JusticePracticeState {
  readonly schemaVersion: typeof JUSTICE_PRACTICE_SCHEMA_VERSION
  readonly caseId: typeof JUSTICE_PRACTICE_CASE_ID
  /** Server compare-and-set revision. It is not a score or progress claim from a client. */
  readonly revision: number
  readonly phase: JusticePracticePhase
  readonly inspectedEvidenceIds: readonly JusticeEvidenceId[]
  readonly initialDecision: EvidenceLinkedChoice<InitialChoiceId> | null
  readonly noticeSent: boolean
  readonly reviewDecision: EvidenceLinkedChoice<ReviewChoiceId> | null
  /** Bounded server-side idempotency ledger; never include it in a client projection. */
  readonly receipts: readonly JusticePracticeReceipt[]
}

export type JusticePracticeAction =
  | { readonly kind: 'inspect'; readonly evidenceId: JusticeEvidenceId }
  | { readonly kind: 'initial-decision'; readonly choiceId: InitialChoiceId; readonly reasonEvidenceIds: readonly JusticeEvidenceId[] }
  | { readonly kind: 'send-service-notice' }
  | { readonly kind: 'inspect-review' }
  | { readonly kind: 'review-decision'; readonly choiceId: ReviewChoiceId; readonly reasonEvidenceIds: readonly JusticeEvidenceId[] }

export interface JusticePracticeRequest {
  readonly requestId: string
  readonly expectedRevision: number
  readonly action: JusticePracticeAction
}

export interface JusticePracticeOutcome {
  readonly code: JusticeOutcomeCode
  readonly feedbackId: JusticeFeedbackId
  readonly revision: number
}

export interface JusticePracticeReceipt {
  readonly requestId: string
  readonly expectedRevision: number
  readonly action: JusticePracticeAction
  readonly outcome: JusticePracticeOutcome
}

export interface JusticePracticeResult {
  /** Current persisted state, which may be newer than `outcome` on a replay. */
  readonly state: JusticePracticeState
  /** Stable result of the original request. On duplicate delivery, this is not recomputed. */
  readonly outcome: JusticePracticeOutcome
  readonly duplicate: boolean
}

export interface JusticeEvidence { readonly id: JusticeEvidenceId; readonly label: string; readonly text: string }
export interface JusticePracticeView {
  readonly caseId: typeof JUSTICE_PRACTICE_CASE_ID
  readonly title: string
  readonly disclaimer: string
  readonly summary: string
  readonly phase: JusticePracticePhase
  readonly revision: number
  readonly prompt: string
  readonly evidence: readonly JusticeEvidence[]
  /** Authored records this learner has opened; private decisions and receipt IDs remain omitted. */
  readonly reviewedEvidenceIds: readonly JusticeEvidenceId[]
  readonly initialChoices: readonly { readonly id: InitialChoiceId; readonly label: string }[]
  readonly reviewChoices: readonly { readonly id: ReviewChoiceId; readonly label: string }[]
  readonly serviceNotice: string | null
  readonly npcReviewRequest: string | null
  readonly trainingComplete: boolean
}

const EVIDENCE: Readonly<Record<JusticeEvidenceId, JusticeEvidence>> = Object.freeze({
  'dispatch-copy': Object.freeze({ id: 'dispatch-copy', label: 'Dispatch copy', text: 'The fictional dispatch sheet records 10 sealed sample parcels before departure.' }),
  'arrival-receipt': Object.freeze({ id: 'arrival-receipt', label: 'Arrival receipt', text: 'The receiving clerk signed a receipt listing 12 sample parcels.' }),
  'seal-log': Object.freeze({ id: 'seal-log', label: 'Seal log', text: 'The seal was recorded intact at arrival. This does not establish the parcel count.' }),
  'npc-recount': Object.freeze({ id: 'npc-recount', label: 'NPC recount note', text: 'The NPC receiving clerk reports counting 10 parcels and finding a duplicate line on the receipt.' }),
})
const INITIAL_CHOICE_VIEW = Object.freeze([
  Object.freeze({ id: 'pause-and-reconcile' as const, label: 'Hold the sample record for a count reconciliation' }),
  Object.freeze({ id: 'accept-receipt' as const, label: 'Accept the receipt count without checking the mismatch' }),
  Object.freeze({ id: 'assign-responsibility' as const, label: 'Assign responsibility before the count is checked' }),
])
const REVIEW_CHOICE_VIEW = Object.freeze([
  Object.freeze({ id: 'correct-duplicate-entry' as const, label: 'Correct the duplicate sample entry using the recount' }),
  Object.freeze({ id: 'keep-hold' as const, label: 'Keep the sample record on hold' }),
  Object.freeze({ id: 'assign-responsibility' as const, label: 'Assign responsibility based on the mismatch' }),
])

const PHASES: readonly JusticePracticePhase[] = ['inspect-initial', 'initial-decision', 'serve-notice', 'inspect-review', 'review-decision', 'complete']
const EVIDENCE_IDS: readonly JusticeEvidenceId[] = ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount']
const ACTION_KINDS: readonly JusticePracticeAction['kind'][] = ['inspect', 'initial-decision', 'send-service-notice', 'inspect-review', 'review-decision']
const OUTCOME_CODES: readonly JusticeOutcomeCode[] = ['advanced', 'feedback', 'complete', 'conflict', 'terminal', 'capacity', 'invalid']
const FEEDBACK_IDS = Object.keys(FEEDBACK) as JusticeFeedbackId[]

const isRecord = (v: unknown): v is Record<string, unknown> => {
  try { return v !== null && typeof v === 'object' && !Array.isArray(v) } catch { return false }
}
const finiteInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max
function exactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  try { const own = Reflect.ownKeys(v); return own.length === keys.length && own.every((key) => typeof key === 'string' && keys.includes(key)) } catch { return false }
}
// State serialization is schema-restricted to ASCII identifiers, booleans, numbers and arrays,
// so the JSON string length is its UTF-8 byte count as well as its code-unit length.
function serializedStateBytes(value: unknown): number { return JSON.stringify(value).length }
function cloneAction(action: JusticePracticeAction): JusticePracticeAction {
  if (action.kind === 'inspect') return { kind: action.kind, evidenceId: action.evidenceId }
  if (action.kind === 'initial-decision') return { kind: action.kind, choiceId: action.choiceId, reasonEvidenceIds: [...action.reasonEvidenceIds] }
  if (action.kind === 'review-decision') return { kind: action.kind, choiceId: action.choiceId, reasonEvidenceIds: [...action.reasonEvidenceIds] }
  return { kind: action.kind }
}
function validRequestId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(value) }
function validEvidenceId(value: unknown): value is JusticeEvidenceId { return typeof value === 'string' && EVIDENCE_IDS.includes(value as JusticeEvidenceId) }
function validEvidenceIds(value: unknown): value is readonly JusticeEvidenceId[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 3 && value.every(validEvidenceId) && new Set(value).size === value.length
}
function readAction(value: unknown): JusticePracticeAction | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || !ACTION_KINDS.includes(value.kind as JusticePracticeAction['kind'])) return null
  if (value.kind === 'inspect') return exactKeys(value, ['kind', 'evidenceId']) && validEvidenceId(value.evidenceId) ? { kind: 'inspect', evidenceId: value.evidenceId } : null
  if (value.kind === 'initial-decision') return exactKeys(value, ['kind', 'choiceId', 'reasonEvidenceIds'])
    && typeof value.choiceId === 'string' && INITIAL_CHOICES.includes(value.choiceId as InitialChoiceId) && validEvidenceIds(value.reasonEvidenceIds)
    ? { kind: 'initial-decision', choiceId: value.choiceId as InitialChoiceId, reasonEvidenceIds: [...value.reasonEvidenceIds] } : null
  if (value.kind === 'review-decision') return exactKeys(value, ['kind', 'choiceId', 'reasonEvidenceIds'])
    && typeof value.choiceId === 'string' && REVIEW_CHOICES.includes(value.choiceId as ReviewChoiceId) && validEvidenceIds(value.reasonEvidenceIds)
    ? { kind: 'review-decision', choiceId: value.choiceId as ReviewChoiceId, reasonEvidenceIds: [...value.reasonEvidenceIds] } : null
  return exactKeys(value, ['kind']) ? { kind: value.kind as 'send-service-notice' | 'inspect-review' } : null
}
function readOutcome(value: unknown): JusticePracticeOutcome | null {
  if (!isRecord(value) || !exactKeys(value, ['code', 'feedbackId', 'revision'])
    || typeof value.code !== 'string' || !OUTCOME_CODES.includes(value.code as JusticeOutcomeCode)
    || typeof value.feedbackId !== 'string' || !FEEDBACK_IDS.includes(value.feedbackId as JusticeFeedbackId)
    || !finiteInt(value.revision)) return null
  return { code: value.code as JusticeOutcomeCode, feedbackId: value.feedbackId as JusticeFeedbackId, revision: value.revision }
}
function reasonEquals(actual: readonly JusticeEvidenceId[], expected: readonly JusticeEvidenceId[]): boolean {
  return actual.length === expected.length && expected.every((id) => actual.includes(id))
}
function containsAll(actual: readonly JusticeEvidenceId[], expected: readonly JusticeEvidenceId[]): boolean { return expected.every((id) => actual.includes(id)) }
function copyState(state: JusticePracticeState): JusticePracticeState {
  return {
    ...state,
    inspectedEvidenceIds: [...state.inspectedEvidenceIds],
    initialDecision: state.initialDecision ? { ...state.initialDecision, reasonEvidenceIds: [...state.initialDecision.reasonEvidenceIds] } : null,
    reviewDecision: state.reviewDecision ? { ...state.reviewDecision, reasonEvidenceIds: [...state.reviewDecision.reasonEvidenceIds] } : null,
    receipts: state.receipts.map((r) => ({ ...r, action: cloneAction(r.action), outcome: { ...r.outcome } })),
  }
}

interface JusticeTransition {
  phase: JusticePracticePhase
  inspectedEvidenceIds: JusticeEvidenceId[]
  initialDecision: EvidenceLinkedChoice<InitialChoiceId> | null
  noticeSent: boolean
  reviewDecision: EvidenceLinkedChoice<ReviewChoiceId> | null
  code: JusticeOutcomeCode
  feedbackId: JusticeFeedbackId
}
function transition(state: JusticePracticeState, action: JusticePracticeAction): JusticeTransition {
  let phase = state.phase, inspectedEvidenceIds = [...state.inspectedEvidenceIds], initialDecision = state.initialDecision,
    noticeSent = state.noticeSent, reviewDecision = state.reviewDecision, feedbackId: JusticeFeedbackId = 'wrongPhase', code: JusticeOutcomeCode = 'feedback'
  if (action.kind === 'inspect' && phase === 'inspect-initial' && INITIAL_EVIDENCE.includes(action.evidenceId as typeof INITIAL_EVIDENCE[number])) {
    if (inspectedEvidenceIds.includes(action.evidenceId)) feedbackId = 'alreadyInspected'
    else {
      inspectedEvidenceIds.push(action.evidenceId); feedbackId = 'inspected'
      if (containsAll(inspectedEvidenceIds, INITIAL_EVIDENCE)) phase = 'initial-decision'
      code = 'advanced'
    }
  } else if (action.kind === 'initial-decision' && phase === 'initial-decision') {
    if (!containsAll(inspectedEvidenceIds, INITIAL_EVIDENCE)) feedbackId = 'needEvidence'
    else if (action.choiceId === 'pause-and-reconcile' && reasonEquals(action.reasonEvidenceIds, INITIAL_REASONS)) {
      initialDecision = { choiceId: action.choiceId, reasonEvidenceIds: [...action.reasonEvidenceIds] }; phase = 'serve-notice'; feedbackId = 'advanced'; code = 'advanced'
    } else feedbackId = action.choiceId === 'pause-and-reconcile' ? 'citeCounts' : 'compareCounts'
  } else if (action.kind === 'send-service-notice' && phase === 'serve-notice' && initialDecision) {
    noticeSent = true; phase = 'inspect-review'; feedbackId = 'noticeSent'; code = 'advanced'
  } else if (action.kind === 'inspect-review' && phase === 'inspect-review' && noticeSent) {
    if (inspectedEvidenceIds.includes('npc-recount')) feedbackId = 'alreadyInspected'
    else { inspectedEvidenceIds.push('npc-recount'); phase = 'review-decision'; feedbackId = 'reviewEvidence'; code = 'advanced' }
  } else if (action.kind === 'review-decision' && phase === 'review-decision' && noticeSent) {
    if (!inspectedEvidenceIds.includes('npc-recount') || !containsAll(inspectedEvidenceIds, REVIEW_REASONS)) feedbackId = 'reviewFirst'
    else if (action.choiceId === 'correct-duplicate-entry' && reasonEquals(action.reasonEvidenceIds, REVIEW_REASONS)) {
      reviewDecision = { choiceId: action.choiceId, reasonEvidenceIds: [...action.reasonEvidenceIds] }; phase = 'complete'; feedbackId = 'complete'; code = 'complete'
    } else feedbackId = action.choiceId === 'correct-duplicate-entry' ? 'citeReview' : 'reviewCounts'
  }
  return { phase, inspectedEvidenceIds, initialDecision, noticeSent, reviewDecision, code, feedbackId }
}

export function createJusticePractice(): JusticePracticeState {
  return Object.freeze({ schemaVersion: JUSTICE_PRACTICE_SCHEMA_VERSION, caseId: JUSTICE_PRACTICE_CASE_ID, revision: 0,
    phase: 'inspect-initial', inspectedEvidenceIds: Object.freeze([]), initialDecision: null, noticeSent: false, reviewDecision: null, receipts: Object.freeze([]) })
}

/** Strictly parse only this version of the bounded server-owned practice record. */
export function readJusticePracticeState(value: unknown): JusticePracticeState | null {
  try {
    if (!isRecord(value) || !exactKeys(value, ['schemaVersion', 'caseId', 'revision', 'phase', 'inspectedEvidenceIds', 'initialDecision', 'noticeSent', 'reviewDecision', 'receipts'])
      || value.schemaVersion !== JUSTICE_PRACTICE_SCHEMA_VERSION || value.caseId !== JUSTICE_PRACTICE_CASE_ID
      || !finiteInt(value.revision) || typeof value.phase !== 'string' || !PHASES.includes(value.phase as JusticePracticePhase)
      || !Array.isArray(value.inspectedEvidenceIds) || value.inspectedEvidenceIds.length > EVIDENCE_IDS.length
      || !value.inspectedEvidenceIds.every(validEvidenceId) || new Set(value.inspectedEvidenceIds).size !== value.inspectedEvidenceIds.length
      || !value.inspectedEvidenceIds.every((id, i, inspected) => EVIDENCE_IDS.indexOf(id) > (i === 0 ? -1 : EVIDENCE_IDS.indexOf(inspected[i - 1] as JusticeEvidenceId)))
      || typeof value.noticeSent !== 'boolean' || !Array.isArray(value.receipts) || value.receipts.length > JUSTICE_PRACTICE_MAX_RECEIPTS) return null
    const readDecision = <C extends string>(input: unknown, choices: readonly C[]): EvidenceLinkedChoice<C> | null | false => {
      if (input === null) return null
      if (!isRecord(input) || !exactKeys(input, ['choiceId', 'reasonEvidenceIds']) || typeof input.choiceId !== 'string'
        || !choices.includes(input.choiceId as C) || !validEvidenceIds(input.reasonEvidenceIds)) return false
      return { choiceId: input.choiceId as C, reasonEvidenceIds: [...input.reasonEvidenceIds] }
    }
    const initial = readDecision(value.initialDecision, INITIAL_CHOICES), review = readDecision(value.reviewDecision, REVIEW_CHOICES)
    if (initial === false || review === false) return null
    const inspected = value.inspectedEvidenceIds as JusticeEvidenceId[]
    if (initial && (initial.choiceId !== 'pause-and-reconcile' || !reasonEquals(initial.reasonEvidenceIds, INITIAL_REASONS)
      || !containsAll(inspected, INITIAL_EVIDENCE) || !containsAll(inspected, initial.reasonEvidenceIds))) return null
    if (review && (review.choiceId !== 'correct-duplicate-entry' || !reasonEquals(review.reasonEvidenceIds, REVIEW_REASONS)
      || !value.noticeSent || !inspected.includes('npc-recount') || !containsAll(inspected, review.reasonEvidenceIds))) return null
    const phase = value.phase as JusticePracticePhase
    const hasNpcEvidence = inspected.includes('npc-recount')
    const consistent = phase === 'inspect-initial' ? !initial && !value.noticeSent && !review && !hasNpcEvidence && !containsAll(inspected, INITIAL_EVIDENCE)
      : phase === 'initial-decision' ? !initial && !value.noticeSent && !review && !hasNpcEvidence && containsAll(inspected, INITIAL_EVIDENCE)
        : phase === 'serve-notice' ? Boolean(initial) && !value.noticeSent && !review && !hasNpcEvidence
          : phase === 'inspect-review' ? Boolean(initial) && value.noticeSent && !review && !hasNpcEvidence
            : phase === 'review-decision' ? Boolean(initial) && value.noticeSent && !review && inspected.includes('npc-recount')
              : Boolean(initial) && value.noticeSent && Boolean(review) && inspected.includes('npc-recount')
    if (!consistent) return null
    const receipts: JusticePracticeReceipt[] = [], seen = new Set<string>()
    for (const raw of value.receipts) {
      if (!isRecord(raw) || !exactKeys(raw, ['requestId', 'expectedRevision', 'action', 'outcome']) || !validRequestId(raw.requestId)
        || seen.has(raw.requestId) || !finiteInt(raw.expectedRevision)) return null
      const action = readAction(raw.action), outcome = readOutcome(raw.outcome)
      if (!action || !outcome || outcome.revision > value.revision) return null
      seen.add(raw.requestId); receipts.push({ requestId: raw.requestId, expectedRevision: raw.expectedRevision, action, outcome })
    }
    const state: JusticePracticeState = { schemaVersion: JUSTICE_PRACTICE_SCHEMA_VERSION, caseId: JUSTICE_PRACTICE_CASE_ID, revision: value.revision,
      phase, inspectedEvidenceIds: [...inspected], initialDecision: initial, noticeSent: value.noticeSent, reviewDecision: review, receipts }
    // Rebuild progress from the bounded action ledger. A shape-valid but forged saved decision,
    // evidence list, phase, or completion marker is not accepted as persisted server history.
    let replay = createJusticePractice()
    for (const receipt of receipts) {
      if (receipt.outcome.code === 'conflict') {
        if (replay.phase === 'complete' || receipt.outcome.feedbackId !== 'revisionConflict' || receipt.outcome.revision !== replay.revision
          || receipt.expectedRevision === replay.revision) return null
        replay = { ...replay, receipts: [...replay.receipts, receipt] }
        continue
      }
      if (receipt.outcome.code === 'terminal') {
        if (replay.phase !== 'complete' || receipt.outcome.feedbackId !== 'terminal' || receipt.outcome.revision !== replay.revision) return null
        replay = { ...replay, receipts: [...replay.receipts, receipt] }
        continue
      }
      if (replay.phase === 'complete') return null
      if (!['advanced', 'feedback', 'complete'].includes(receipt.outcome.code)
        || receipt.expectedRevision !== replay.revision || receipt.outcome.revision !== replay.revision + 1) return null
      const next = transition(replay, receipt.action)
      if (next.code !== receipt.outcome.code || next.feedbackId !== receipt.outcome.feedbackId) return null
      replay = { schemaVersion: JUSTICE_PRACTICE_SCHEMA_VERSION, caseId: JUSTICE_PRACTICE_CASE_ID, revision: replay.revision + 1,
        phase: next.phase, inspectedEvidenceIds: next.inspectedEvidenceIds, initialDecision: next.initialDecision,
        noticeSent: next.noticeSent, reviewDecision: next.reviewDecision, receipts: [...replay.receipts, receipt] }
    }
    if (replay.revision !== state.revision || replay.phase !== state.phase || replay.noticeSent !== state.noticeSent
      || JSON.stringify(replay.inspectedEvidenceIds) !== JSON.stringify(state.inspectedEvidenceIds)
      || JSON.stringify(replay.initialDecision) !== JSON.stringify(state.initialDecision)
      || JSON.stringify(replay.reviewDecision) !== JSON.stringify(state.reviewDecision)) return null
    if (serializedStateBytes(state) > JUSTICE_PRACTICE_MAX_STATE_BYTES) return null
    return state
  } catch { return null }
}

function outcome(code: JusticeOutcomeCode, feedbackId: JusticeFeedbackId, revision: number): JusticePracticeOutcome { return { code, feedbackId, revision } }
function withReceipt(state: JusticePracticeState, request: JusticePracticeRequest, result: JusticePracticeOutcome, nextRevision = state.revision): JusticePracticeState {
  return { ...state, revision: nextRevision, receipts: [...state.receipts, { requestId: request.requestId, expectedRevision: request.expectedRevision, action: cloneAction(request.action), outcome: result }] }
}
function unchanged(state: JusticePracticeState, result: JusticePracticeOutcome, duplicate = false): JusticePracticeResult {
  return { state: copyState(state), outcome: result, duplicate }
}

/** Apply one bounded action. The caller must persist the returned state with a database CAS. */
function applyJusticePracticeUnchecked(stateValue: unknown, requestValue: unknown): JusticePracticeResult {
  const state = readJusticePracticeState(stateValue)
  if (!state || !isRecord(requestValue) || !exactKeys(requestValue, ['requestId', 'expectedRevision', 'action']) || !validRequestId(requestValue.requestId)
    || !finiteInt(requestValue.expectedRevision) || !readAction(requestValue.action)) {
    const safe = state ?? createJusticePractice()
    return unchanged(safe, outcome('invalid', 'invalid', safe.revision))
  }
  const action = readAction(requestValue.action)!
  const request: JusticePracticeRequest = { requestId: requestValue.requestId, expectedRevision: requestValue.expectedRevision, action }
  const previous = state.receipts.find((receipt) => receipt.requestId === request.requestId)
  if (previous) {
    const same = previous.expectedRevision === request.expectedRevision && JSON.stringify(previous.action) === JSON.stringify(request.action)
    return same ? unchanged(state, previous.outcome, true) : unchanged(state, outcome('conflict', 'requestConflict', state.revision))
  }
  if (state.phase === 'complete') {
    if (state.receipts.length >= JUSTICE_PRACTICE_MAX_RECEIPTS) return unchanged(state, outcome('capacity', 'capacity', state.revision))
    const result = outcome('terminal', 'terminal', state.revision), next = withReceipt(state, request, result)
    return serializedStateBytes(next) <= JUSTICE_PRACTICE_MAX_STATE_BYTES ? { state: next, outcome: result, duplicate: false } : unchanged(state, outcome('capacity', 'capacity', state.revision))
  }
  if (state.receipts.length >= JUSTICE_PRACTICE_MAX_RECEIPTS) return unchanged(state, outcome('capacity', 'capacity', state.revision))
  if (request.expectedRevision !== state.revision) {
    const result = outcome('conflict', 'revisionConflict', state.revision)
    const next = withReceipt(state, request, result)
    return serializedStateBytes(next) <= JUSTICE_PRACTICE_MAX_STATE_BYTES ? { state: next, outcome: result, duplicate: false } : unchanged(state, outcome('capacity', 'capacity', state.revision))
  }
  if (state.revision >= Number.MAX_SAFE_INTEGER) return unchanged(state, outcome('capacity', 'revisionExhausted', state.revision))

  const nextStep = transition(state, action)
  const nextRevision = state.revision + 1
  const result = outcome(nextStep.code, nextStep.feedbackId, nextRevision)
  const next: JusticePracticeState = { ...state, revision: nextRevision, phase: nextStep.phase, inspectedEvidenceIds: nextStep.inspectedEvidenceIds,
    initialDecision: nextStep.initialDecision, noticeSent: nextStep.noticeSent, reviewDecision: nextStep.reviewDecision,
    receipts: [...state.receipts, { requestId: request.requestId, expectedRevision: request.expectedRevision, action: cloneAction(action), outcome: result }] }
  if (serializedStateBytes(next) > JUSTICE_PRACTICE_MAX_STATE_BYTES) return unchanged(state, outcome('capacity', 'capacity', state.revision))
  return { state: next, outcome: result, duplicate: false }
}

/** Hostile requests and saved values are refused as bounded outcomes, never thrown into a route. */
export function applyJusticePractice(stateValue: unknown, requestValue: unknown): JusticePracticeResult {
  const validated = readJusticePracticeState(stateValue)
  if (!validated) {
    const empty = createJusticePractice()
    return unchanged(empty, outcome('invalid', 'invalid', empty.revision))
  }
  const safeState = validated
  try { return applyJusticePracticeUnchecked(safeState, requestValue) }
  catch { return unchanged(safeState, outcome('invalid', 'invalid', safeState.revision)) }
}

/** Safe authored projection for UI transport; internal decisions and receipt IDs stay server-side. */
export function justicePracticeView(value: unknown): JusticePracticeView | null {
  const state = readJusticePracticeState(value)
  if (!state) return null
  const reviewAvailable = state.noticeSent
  const evidenceIds = state.phase === 'inspect-initial' || state.phase === 'initial-decision' || state.phase === 'serve-notice'
    ? INITIAL_EVIDENCE
    : reviewAvailable ? [...INITIAL_EVIDENCE, ...(state.inspectedEvidenceIds.includes('npc-recount') || state.phase === 'inspect-review' ? ['npc-recount' as const] : [])] : INITIAL_EVIDENCE
  return Object.freeze({ caseId: JUSTICE_PRACTICE_CASE_ID, title: CASE_TITLE, disclaimer: DISCLAIMER, summary: CASE_SUMMARY,
    phase: state.phase, revision: state.revision, prompt: PROMPTS[state.phase], evidence: Object.freeze(evidenceIds.map((id) => EVIDENCE[id])),
    reviewedEvidenceIds: Object.freeze([...state.inspectedEvidenceIds]),
    initialChoices: Object.freeze(state.phase === 'initial-decision' ? [...INITIAL_CHOICE_VIEW] : []),
    reviewChoices: Object.freeze(state.phase === 'review-decision' ? [...REVIEW_CHOICE_VIEW] : []),
    serviceNotice: state.phase === 'serve-notice' || reviewAvailable || state.phase === 'complete' ? SERVICE_NOTICE : null,
    npcReviewRequest: reviewAvailable ? NPC_REVIEW_REQUEST : null, trainingComplete: state.phase === 'complete' })
}

export function justicePracticeFeedback(id: JusticeFeedbackId): string { return FEEDBACK[id] }
