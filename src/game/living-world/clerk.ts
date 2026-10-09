/** Pure, fictional NPC clerk practice. It does not touch real justice cases or award money. */

export const CLERK_PRACTICE_SCENARIO_VERSION = 1 as const
export const MAX_CLERK_PRACTICE_BYTES = 2048

export type ClerkPracticeStep = 'inspect_receipt' | 'inspect_dispatch' | 'compare_discrepancy' | 'choose_outcome' | 'complete'
export type ClerkPracticeFinding = 'quantity_mismatch'
export type ClerkPracticeOutcome = 'pause_and_reconcile'
export interface ClerkPracticeTerminal { finding: ClerkPracticeFinding; outcome: ClerkPracticeOutcome }
export interface ClerkPracticeState {
  version: 1
  actorId: string
  revision: number
  step: ClerkPracticeStep
  result: ClerkPracticeTerminal | null
}
export interface ClerkPracticeInput { actorId: string; expectedRevision: number; stepId: Exclude<ClerkPracticeStep, 'complete'>; evidenceId: string }
export interface ClerkPracticeResult { ok: boolean; code: string; state: ClerkPracticeState | null; feedback?: string }
export interface ClerkPracticeView {
  scenarioVersion: 1
  title: string
  narrative: string
  step: ClerkPracticeStep
  prompt: string
  evidence: { id: string; label: string; text: string }[]
  choices: { id: string; label: string }[]
  result: { finding: string; outcome: string; explanation: string } | null
}

const MAX = Number.MAX_SAFE_INTEGER
const actor = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(value)
const choiceId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(value)
const whole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX
const object = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try { const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null } catch { return false }
}
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
}
const steps: readonly ClerkPracticeStep[] = ['inspect_receipt', 'inspect_dispatch', 'compare_discrepancy', 'choose_outcome', 'complete']
const revisionFor = (step: ClerkPracticeStep): number => steps.indexOf(step)
const canonicalResult = (value: unknown): value is ClerkPracticeTerminal => object(value)
  && exact(value, ['finding', 'outcome']) && value.finding === 'quantity_mismatch' && value.outcome === 'pause_and_reconcile'

/** Start a blank actor-bound exercise. The caller supplies the authenticated actor, never request data. */
export function startClerkPractice(actorId: unknown): ClerkPracticeState | null {
  if (!actor(actorId)) return null
  return { version: 1, actorId, revision: 0, step: 'inspect_receipt', result: null }
}

/** Strict, non-stepping reader. Invalid/future records return null so the caller can quarantine the original. */
export function readClerkPractice(value: unknown): ClerkPracticeState | null {
  try {
    if (!object(value) || !exact(value, ['version', 'actorId', 'revision', 'step', 'result']) || value.version !== 1
      || !actor(value.actorId) || !whole(value.revision) || !steps.includes(value.step as ClerkPracticeStep)) return null
    const step = value.step as ClerkPracticeStep
    if (value.revision !== revisionFor(step) || (step === 'complete' ? !canonicalResult(value.result) : value.result !== null)) return null
    const state: ClerkPracticeState = { version: 1, actorId: value.actorId, revision: value.revision, step,
      result: step === 'complete' ? { finding: 'quantity_mismatch', outcome: 'pause_and_reconcile' } : null }
    // The canonical record has only ASCII IDs/literals and integers, so string length equals UTF-8 bytes.
    if (JSON.stringify(state).length > MAX_CLERK_PRACTICE_BYTES) return null
    return state
  } catch { return null }
}

function refuse(state: ClerkPracticeState | null, code: string, feedback?: string): ClerkPracticeResult {
  return { ok: false, code, state, ...(feedback ? { feedback } : {}) }
}

/**
 * Apply one ordered authored action. Callers must first readClerkPractice and commit the returned
 * state with actor authorization, durable CAS, and a once receipt in their transaction.
 * Wrong selections teach without advancing; no timer or client-authored evidence can progress it.
 */
export function stepClerkPractice(source: unknown, input: unknown): ClerkPracticeResult {
  const state = readClerkPractice(source)
  if (!state) return refuse(null, 'invalid_state')
  if (!object(input) || !exact(input, ['actorId', 'expectedRevision', 'stepId', 'evidenceId'])
    || !actor(input.actorId) || !whole(input.expectedRevision) || !choiceId(input.stepId) || !choiceId(input.evidenceId)) {
    return refuse(state, 'invalid_request')
  }
  if (input.actorId !== state.actorId) return refuse(state, 'wrong_actor')
  if (input.expectedRevision !== state.revision) return refuse(state, 'revision_conflict')
  if (state.step === 'complete') return refuse(state, 'practice_complete')
  if (input.stepId !== state.step) return refuse(state, 'step_out_of_order', 'Finish the current step before moving on.')

  let accepted = false, feedback: string | undefined
  if (state.step === 'inspect_receipt') {
    accepted = input.evidenceId === 'receipt'
    feedback = accepted ? undefined : 'Start by opening the receiving receipt.'
  } else if (state.step === 'inspect_dispatch') {
    accepted = input.evidenceId === 'dispatch'
    feedback = accepted ? undefined : 'The receipt is recorded. Now inspect the dispatch note.'
  } else if (state.step === 'compare_discrepancy') {
    accepted = input.evidenceId === 'compare-b'
    feedback = accepted ? undefined : input.evidenceId === 'compare-a'
      ? 'The crate labels match. Compare the recorded quantities.'
      : input.evidenceId === 'compare-c'
        ? 'Both notes name the same depot. Compare the recorded quantities.'
        : 'Choose the discrepancy shown by the two records.'
  } else {
    accepted = input.evidenceId === 'outcome-a'
    feedback = accepted ? undefined : input.evidenceId === 'outcome-b'
      ? 'The shortage is not reconciled yet. Pause the handoff and compare the records first.'
      : input.evidenceId === 'outcome-c'
        ? 'A mismatch alone does not show intent. Keep the handoff safe and reconcile the count.'
        : 'Choose a proportionate next step for the unresolved count.'
  }
  if (!accepted) return refuse(state, 'learning_feedback', feedback)
  if (state.revision >= MAX) return refuse(state, 'counter_exhausted')
  const nextStep = steps[state.revision + 1]!
  const next: ClerkPracticeState = { version: 1, actorId: state.actorId, revision: state.revision + 1, step: nextStep,
    result: nextStep === 'complete' ? { finding: 'quantity_mismatch', outcome: 'pause_and_reconcile' } : null }
  if (JSON.stringify(next).length > MAX_CLERK_PRACTICE_BYTES) return refuse(state, 'record_too_large')
  return { ok: true, code: nextStep === 'complete' ? 'practice_completed' : 'step_accepted', state: next }
}

const RECEIPT = { id: 'receipt', label: 'Receiving receipt', text: 'The fictional marina desk depot received 4 Blue Seal crates.' }
const DISPATCH = { id: 'dispatch', label: 'Dispatch note', text: 'The fictional marina desk depot dispatch note records 5 Blue Seal crates loaded.' }
const COMPARE_CHOICES = [
  { id: 'compare-a', label: 'The crate labels differ.' },
  { id: 'compare-b', label: 'The quantities differ: 4 received, 5 dispatched.' },
  { id: 'compare-c', label: 'The destination depot differs.' },
]
const OUTCOME_CHOICES = [
  { id: 'outcome-a', label: 'Pause the handoff and compare the sealed-crate count.' },
  { id: 'outcome-b', label: 'Release the shipment before checking the difference.' },
  { id: 'outcome-c', label: 'Accuse the courier based only on the mismatch.' },
]

/** Player-facing projection. Authored keys and stored state stay small; answers are only explained at completion. */
export function clerkPracticeView(source: unknown): ClerkPracticeView | null {
  const state = readClerkPractice(source)
  if (!state) return null
  const evidence = state.step === 'inspect_receipt' ? [RECEIPT]
    : state.step === 'inspect_dispatch' ? [DISPATCH]
      : state.step === 'compare_discrepancy' || state.step === 'choose_outcome' || state.step === 'complete' ? [RECEIPT, DISPATCH] : []
  const prompts: Record<ClerkPracticeStep, string> = {
    inspect_receipt: 'Open and inspect the receiving record.',
    inspect_dispatch: 'Open and inspect the dispatch record.',
    compare_discrepancy: 'What specific difference do the records show?',
    choose_outcome: 'Choose a proportionate, safe next step.',
    complete: 'Practice complete.',
  }
  return {
    scenarioVersion: 1, title: 'A missing-crate handoff',
    narrative: 'Fictional NPC practice: help a marina desk resolve a sealed-crate count before the handoff. This is not a real case or legal advice.',
    step: state.step, prompt: prompts[state.step], evidence: evidence.map(item => ({ ...item })),
    choices: (state.step === 'compare_discrepancy' ? COMPARE_CHOICES
      : state.step === 'choose_outcome' ? OUTCOME_CHOICES : []).map(choice => ({ ...choice })),
    result: state.result ? { finding: 'The records differ by one crate.', outcome: 'Pause the handoff and reconcile the count before release.',
      explanation: 'The receipt lists four crates while dispatch lists five. A mismatch calls for a check, not an accusation.' } : null,
  }
}
