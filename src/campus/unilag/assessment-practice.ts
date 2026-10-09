import { UNILAG_BETA_RULES } from './curriculum.ts'

/**
 * A saved, fictional logic-lab assignment for the authored cpe-101 course.
 * This module has no clock, wallet, Life, or persistence access. Its caller must
 * bind it to the validated registered assignment and use ctx.once in the same
 * transaction for durable request replay and terminal score settlement. The
 * saved last-operation witness only supports an immediate retry; it is not a
 * replacement for that durable receipt.
 */

export type AssessmentPracticePhase = 'inspect' | 'repair' | 'verify' | 'submit' | 'complete'
export type AssessmentPracticeGate = 'or' | 'and' | 'xor'
export type AssessmentPracticeOperation =
  | { kind: 'probe'; requestId: string; expectedRevision: number; a: boolean; b: boolean }
  | { kind: 'inspect'; requestId: string; expectedRevision: number; a: boolean; b: boolean }
  | { kind: 'repair'; requestId: string; expectedRevision: number; gate: AssessmentPracticeGate }
  | { kind: 'submit'; requestId: string; expectedRevision: number }

export interface AssessmentPracticeReceipt {
  requestId: string
  fingerprint: string
  code: 'probe_recorded' | 'counterexample_inspected' | 'repair_installed' | 'probe_verified' | 'completed'
}

export interface AssessmentPracticeState {
  version: 1
  actorId: string
  revision: number
  phase: AssessmentPracticePhase
  /** Bit i records a server-executed initial probe for input pair i (00, 01, 10, 11). */
  initialMask: number
  counterexample: number | null
  repairGate: AssessmentPracticeGate | null
  /** Bit i records a post-repair probe; outputs are server-derived in the same order. */
  verifyMask: number
  verifyOutputMask: number
  score: number | null
  lastOperation: AssessmentPracticeReceipt | null
}

export interface AssessmentPracticeObservation { a: boolean; b: boolean; output: boolean }
export interface AssessmentPracticeResult {
  ok: boolean
  code: string
  state: AssessmentPracticeState
  /** True for an immediate receipt replay or an already-recorded probe with no progression. */
  duplicate: boolean
  feedback: string
  observation?: AssessmentPracticeObservation
  /** Present only on the first successful submit; durable retries belong to ctx.once. */
  mark?: number
}

export interface AssessmentPracticeView {
  courseId: 'cpe-101'
  scenario: 'logic-probe-lab-v1'
  revision: number
  phase: AssessmentPracticePhase
  title: string
  instructions: string
  targetTable: readonly AssessmentPracticeObservation[]
  initialProbes: readonly AssessmentPracticeObservation[]
  verificationProbes: readonly AssessmentPracticeObservation[]
  counterexample: AssessmentPracticeObservation | null
  feedback: string
  score: number | null
}

export const MAX_ASSESSMENT_PRACTICE_BYTES = 2048
const MAX_REVISION = 12
const ID = /^[A-Za-z0-9:_-]{1,100}$/
const PHASES = new Set<AssessmentPracticePhase>(['inspect', 'repair', 'verify', 'submit', 'complete'])
const GATES = new Set<AssessmentPracticeGate>(['or', 'and', 'xor'])
const RECEIPT_CODES = new Set<AssessmentPracticeReceipt['code']>([
  'probe_recorded', 'counterexample_inspected', 'repair_installed', 'probe_verified', 'completed',
])
const BIT_MASK = 0b1111

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && actual.every((key) => typeof key === 'string' && keys.includes(key))
}

function validId(value: unknown): value is string { return typeof value === 'string' && ID.test(value) }
function safeInt(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}
function bitFor(a: boolean, b: boolean): number { return (a ? 2 : 0) | (b ? 1 : 0) }
function target(a: boolean, b: boolean): boolean { return a && b }
function gateOutput(gate: AssessmentPracticeGate, a: boolean, b: boolean): boolean {
  if (gate === 'and') return a && b
  if (gate === 'xor') return a !== b
  return a || b
}
function outputBit(mask: number, index: number): boolean { return (mask & (1 << index)) !== 0 }
function bitCount(mask: number): number {
  let count = 0
  for (let bits = mask; bits !== 0; bits &= bits - 1) count += 1
  return count
}
function fail(state: AssessmentPracticeState, code: string, feedback: string): AssessmentPracticeResult {
  return { ok: false, code, state, duplicate: false, feedback }
}

function initialShape(state: AssessmentPracticeState): boolean {
  return state.counterexample === null && state.repairGate === null && state.verifyMask === 0 && state.verifyOutputMask === 0 && state.score === null
}

/** Creates an internal row only after the server validates a registered cpe-101 assignment start. */
export function startAssessmentPractice(actorId: string): AssessmentPracticeState {
  if (!validId(actorId)) throw new TypeError('Invalid assessment-practice actor')
  return {
    version: 1, actorId, revision: 1, phase: 'inspect', initialMask: 0, counterexample: null,
    repairGate: null, verifyMask: 0, verifyOutputMask: 0, score: null, lastOperation: null,
  }
}

/** Strict non-mutating reader. Null means quarantine the original saved value unchanged. */
export function readAssessmentPracticeState(value: unknown, expectedActorId: string): AssessmentPracticeState | null {
  if (!validId(expectedActorId) || !isRecord(value) || !hasExactKeys(value, [
    'version', 'actorId', 'revision', 'phase', 'initialMask', 'counterexample', 'repairGate',
    'verifyMask', 'verifyOutputMask', 'score', 'lastOperation',
  ])) return null
  if (value.version !== 1 || value.actorId !== expectedActorId || !validId(value.actorId)
    || !safeInt(value.revision, 1, MAX_REVISION) || typeof value.phase !== 'string' || !PHASES.has(value.phase as AssessmentPracticePhase)
    || !safeInt(value.initialMask, 0, BIT_MASK) || !safeInt(value.verifyMask, 0, BIT_MASK)
    || !safeInt(value.verifyOutputMask, 0, BIT_MASK)) return null
  const counterexample = value.counterexample
  if (counterexample !== null && counterexample !== 1 && counterexample !== 2) return null
  const repairGate = value.repairGate
  if (repairGate !== null && (typeof repairGate !== 'string' || !GATES.has(repairGate as AssessmentPracticeGate))) return null
  const score = value.score
  if (score !== null && !safeInt(score, 0, UNILAG_BETA_RULES.assignmentWeight)) return null
  let lastOperation: AssessmentPracticeReceipt | null = null
  if (value.lastOperation !== null) {
    const receipt = value.lastOperation
    if (!isRecord(receipt) || !hasExactKeys(receipt, ['requestId', 'fingerprint', 'code'])
      || !validId(receipt.requestId) || typeof receipt.fingerprint !== 'string' || !/^[A-Za-z0-9,:_-]{1,180}$/.test(receipt.fingerprint)
      || typeof receipt.code !== 'string' || !RECEIPT_CODES.has(receipt.code as AssessmentPracticeReceipt['code'])) return null
    lastOperation = { requestId: receipt.requestId, fingerprint: receipt.fingerprint, code: receipt.code as AssessmentPracticeReceipt['code'] }
  }

  const state: AssessmentPracticeState = {
    version: 1,
    actorId: value.actorId,
    revision: value.revision,
    phase: value.phase as AssessmentPracticePhase,
    initialMask: value.initialMask,
    counterexample,
    repairGate: repairGate as AssessmentPracticeGate | null,
    verifyMask: value.verifyMask,
    verifyOutputMask: value.verifyOutputMask,
    score: score as number | null,
    lastOperation,
  }
  if (!consistent(state)) return null
  // All saved strings are constrained to ASCII, so JSON code-unit length is its UTF-8 byte length.
  if (JSON.stringify(state).length > MAX_ASSESSMENT_PRACTICE_BYTES) return null
  return state
}

function consistent(state: AssessmentPracticeState): boolean {
  const inspected = state.phase === 'repair' || state.phase === 'verify' || state.phase === 'submit' || state.phase === 'complete' ? 1 : 0
  const repaired = state.phase === 'verify' || state.phase === 'submit' || state.phase === 'complete' ? 1 : 0
  const submitted = state.phase === 'complete' ? 1 : 0
  const expectedRevision = 1 + bitCount(state.initialMask) + inspected + repaired + bitCount(state.verifyMask) + submitted
  if (state.revision !== expectedRevision) return false
  if ((state.revision === 1) !== (state.lastOperation === null)) return false
  if (state.lastOperation) {
    const parts = state.lastOperation.fingerprint.split(':')
    const operationRevision = Number(parts[1])
    if (operationRevision !== state.revision - 1 || !Number.isSafeInteger(operationRevision)) return false
    const expectedCode: Record<string, AssessmentPracticeReceipt['code']> = {
      probe: state.phase === 'inspect' ? 'probe_recorded' : 'probe_verified',
      inspect: 'counterexample_inspected', repair: 'repair_installed', submit: 'completed',
    }
    if (expectedCode[parts[0] ?? ''] !== state.lastOperation.code) return false
    if (parts[0] === 'probe' && (parts.length !== 4 || !['0', '1'].includes(parts[2] ?? '') || !['0', '1'].includes(parts[3] ?? ''))) return false
    if (parts[0] === 'inspect' && (parts.length !== 4 || !['0', '1'].includes(parts[2] ?? '') || !['0', '1'].includes(parts[3] ?? ''))) return false
    if (parts[0] === 'repair' && (parts.length !== 3 || !GATES.has(parts[2] as AssessmentPracticeGate))) return false
    if (parts[0] === 'submit' && parts.length !== 2) return false
    if (parts[0] === 'probe') {
      const index = (parts[2] === '1' ? 2 : 0) | (parts[3] === '1' ? 1 : 0), bit = 1 << index
      if (state.lastOperation.code === 'probe_recorded') {
        if (state.phase !== 'inspect' || (state.initialMask & bit) === 0) return false
      } else if ((state.phase !== 'verify' && state.phase !== 'submit') || (state.verifyMask & bit) === 0
        || outputBit(state.verifyOutputMask, index) !== target(parts[2] === '1', parts[3] === '1')) return false
    }
    if (parts[0] === 'inspect') {
      const index = (parts[2] === '1' ? 2 : 0) | (parts[3] === '1' ? 1 : 0)
      if (state.phase !== 'repair' || state.counterexample !== index || (state.initialMask & (1 << index)) === 0) return false
    }
    if (parts[0] === 'repair' && (state.phase !== 'verify' || state.repairGate !== 'and' || state.verifyMask !== 0)) return false
    if (parts[0] === 'submit' && state.phase !== 'complete') return false
  }
  if (state.phase === 'inspect') return initialShape(state) && state.verifyMask === 0
  if (state.phase === 'repair') return state.counterexample !== null && state.repairGate === null && state.verifyMask === 0
    && state.verifyOutputMask === 0 && state.score === null && (state.initialMask & (1 << state.counterexample)) !== 0
  if (state.phase === 'verify' || state.phase === 'submit' || state.phase === 'complete') {
    if (state.counterexample === null || state.repairGate !== 'and' || (state.initialMask & (1 << state.counterexample)) === 0) return false
    if (state.verifyOutputMask !== (state.verifyMask & 0b1000)
      || state.score !== null && state.score !== UNILAG_BETA_RULES.assignmentWeight) return false
    if (state.phase === 'verify') return state.score === null && state.verifyMask !== BIT_MASK
    if (state.phase === 'submit') return state.score === null && state.verifyMask === BIT_MASK && state.verifyOutputMask === 0b1000
    return state.score === UNILAG_BETA_RULES.assignmentWeight && state.verifyMask === BIT_MASK && state.verifyOutputMask === 0b1000
  }
  return false
}

type ParsedOperation = AssessmentPracticeOperation
function parseOperation(value: unknown): ParsedOperation | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  const common = ['kind', 'requestId', 'expectedRevision']
  if (value.kind === 'probe' || value.kind === 'inspect') {
    if (!hasExactKeys(value, [...common, 'a', 'b']) || !validId(value.requestId) || !safeInt(value.expectedRevision, 1, MAX_REVISION)
      || typeof value.a !== 'boolean' || typeof value.b !== 'boolean') return null
    return { kind: value.kind, requestId: value.requestId, expectedRevision: value.expectedRevision, a: value.a, b: value.b }
  }
  if (value.kind === 'repair') {
    if (!hasExactKeys(value, [...common, 'gate']) || !validId(value.requestId) || !safeInt(value.expectedRevision, 1, MAX_REVISION)
      || typeof value.gate !== 'string' || !GATES.has(value.gate as AssessmentPracticeGate)) return null
    return { kind: 'repair', requestId: value.requestId, expectedRevision: value.expectedRevision, gate: value.gate as AssessmentPracticeGate }
  }
  if (value.kind === 'submit') {
    if (!hasExactKeys(value, common) || !validId(value.requestId) || !safeInt(value.expectedRevision, 1, MAX_REVISION)) return null
    return { kind: 'submit', requestId: value.requestId, expectedRevision: value.expectedRevision }
  }
  return null
}

function fingerprint(operation: ParsedOperation): string {
  switch (operation.kind) {
    case 'probe': case 'inspect': return `${operation.kind}:${operation.expectedRevision}:${Number(operation.a)}:${Number(operation.b)}`
    case 'repair': return `repair:${operation.expectedRevision}:${operation.gate}`
    case 'submit': return `submit:${operation.expectedRevision}`
  }
}

function accepted(state: AssessmentPracticeState, operation: ParsedOperation, code: AssessmentPracticeReceipt['code'], fields: Partial<AssessmentPracticeState>, feedback: string, observation?: AssessmentPracticeObservation, mark?: number): AssessmentPracticeResult {
  const next: AssessmentPracticeState = {
    ...state,
    ...fields,
    revision: state.revision + 1,
    lastOperation: { requestId: operation.requestId, fingerprint: fingerprint(operation), code },
  }
  if (!consistent(next)) return fail(state, 'state_invalid', 'This lab state could not be advanced safely.')
  const result: AssessmentPracticeResult = { ok: true, code, state: next, duplicate: false, feedback }
  if (observation) result.observation = observation
  if (mark !== undefined) result.mark = mark
  return result
}

/** Pure transition. The server must strictly read state and wrap calls in ctx.once + same-store CAS. */
export function stepAssessmentPractice(state: AssessmentPracticeState, actorId: string, rawOperation: unknown): AssessmentPracticeResult {
  if (!validId(actorId) || state.actorId !== actorId || !readAssessmentPracticeState(state, actorId)) {
    return fail(state, 'invalid_state', 'The saved lab is unavailable; it was left unchanged.')
  }
  const operation = parseOperation(rawOperation)
  if (!operation) return fail(state, 'invalid_input', 'Choose one valid lab operation. Extra fields and client scores are not accepted.')
  const operationFingerprint = fingerprint(operation)
  const previous = state.lastOperation
  if (previous?.requestId === operation.requestId) {
    return previous.fingerprint === operationFingerprint
      ? { ok: true, code: previous.code, state, duplicate: true, feedback: 'That operation is already recorded.' }
      : fail(state, 'request_conflict', 'This request ID was already used for a different lab operation.')
  }
  if (operation.expectedRevision !== state.revision) return fail(state, 'revision_conflict', 'The lab changed. Reload its current step before continuing.')
  if (state.revision >= MAX_REVISION) return fail(state, 'revision_exhausted', 'This lab reached its safe operation limit.')
  if (state.phase === 'complete') return fail(state, 'already_complete', 'This assessment is already complete.')

  if (operation.kind === 'probe') {
    const index = bitFor(operation.a, operation.b), bit = 1 << index
    const output = state.phase === 'inspect' ? gateOutput('or', operation.a, operation.b) : state.phase === 'verify' ? gateOutput(state.repairGate!, operation.a, operation.b) : null
    if (output === null) return fail(state, 'wrong_step', state.phase === 'repair' ? 'Inspect the observed counterexample before choosing a repair.' : 'Submit the verified lab result to finish.')
    const observation = { a: operation.a, b: operation.b, output }
    if (state.phase === 'inspect') {
      if ((state.initialMask & bit) !== 0) {
        return { ok: true, code: 'probe_already_recorded', state, duplicate: true,
          feedback: 'This input was already probed; its server-recorded observation is unchanged.', observation }
      }
      return accepted(state, operation, 'probe_recorded', { initialMask: state.initialMask | bit },
        output === target(operation.a, operation.b) ? 'Probe recorded. Compare it with the authored target table.' : 'Probe recorded: this output differs from the authored target.', observation)
    }
    if ((state.verifyMask & bit) !== 0) {
      return { ok: true, code: 'probe_already_recorded', state, duplicate: true,
        feedback: 'This repaired input was already verified; its server-recorded observation is unchanged.', observation }
    }
    const verifyOutputMask = output ? state.verifyOutputMask | bit : state.verifyOutputMask & ~bit
    const verifyMask = state.verifyMask | bit
    const allVerified = verifyMask === BIT_MASK && verifyOutputMask === 0b1000
    if (verifyMask === BIT_MASK && !allVerified) return fail(state, 'verification_mismatch', 'The repaired gate still differs from the target table. The attempt remains open for correction.')
    return accepted(state, operation, 'probe_verified', {
      verifyMask, verifyOutputMask, phase: allVerified ? 'submit' : 'verify',
    }, allVerified ? 'All four repaired outputs match. Submit to record the assignment.' : 'Repaired output recorded. Rerun every remaining input combination.', observation)
  }

  if (operation.kind === 'inspect') {
    if (state.phase !== 'inspect') return fail(state, 'wrong_step', 'Inspect the counterexample before repairing the gate.')
    const index = bitFor(operation.a, operation.b), bit = 1 << index
    if ((state.initialMask & bit) === 0) return fail(state, 'probe_required', 'Run this input through the probe before inspecting it.')
    if ((operation.a === operation.b) || !gateOutput('or', operation.a, operation.b) || target(operation.a, operation.b)) {
      return fail(state, 'not_counterexample', 'That observation agrees with the target. Inspect a mixed-input probe where OR outputs true but the target AND is false.')
    }
    return accepted(state, operation, 'counterexample_inspected', { counterexample: index, phase: 'repair' }, 'Counterexample confirmed: the mixed inputs produce true on OR, but the target requires false.')
  }

  if (operation.kind === 'repair') {
    if (state.phase !== 'repair') return fail(state, 'wrong_step', 'Inspect a real counterexample before selecting a repair.')
    if (operation.gate !== 'and') return fail(state, 'repair_mismatch', 'That repair does not match the target table. Try the AND gate; the attempt remains open.')
    return accepted(state, operation, 'repair_installed', { repairGate: 'and', phase: 'verify', verifyMask: 0, verifyOutputMask: 0 }, 'AND gate installed. Actively rerun all four input combinations to verify the repair.')
  }

  if (state.phase !== 'submit') return fail(state, 'verification_required', 'Run and verify all four repaired input combinations before submitting.')
  return accepted(state, operation, 'completed', { phase: 'complete', score: UNILAG_BETA_RULES.assignmentWeight },
    `Assignment recorded: ${UNILAG_BETA_RULES.assignmentWeight}/${UNILAG_BETA_RULES.assignmentWeight}.`, undefined, UNILAG_BETA_RULES.assignmentWeight)
}

function observation(index: number, output: boolean): AssessmentPracticeObservation {
  return { a: (index & 2) !== 0, b: (index & 1) !== 0, output }
}

function savedFeedback(state: AssessmentPracticeState): string {
  const code = state.lastOperation?.code
  if (code === 'probe_recorded') return 'Probe recorded. Compare the observed output with the authored target table.'
  if (code === 'counterexample_inspected') return 'Counterexample confirmed: the mixed inputs produce true on OR, but the target requires false.'
  if (code === 'repair_installed') return 'AND gate installed. Actively rerun all four input combinations to verify the repair.'
  if (code === 'probe_verified') return state.phase === 'submit'
    ? 'All four repaired outputs match. Submit to record the assignment.'
    : 'Repaired output recorded. Rerun every remaining input combination.'
  if (code === 'completed') return `Marked ${state.score}/${UNILAG_BETA_RULES.assignmentWeight}.`
  return 'Select inputs A and B, run a probe, and compare its output with the target table.'
}

/** Fresh learner-facing projection; authored target is public, hidden gate/answers are not. */
export function assessmentPracticeView(state: AssessmentPracticeState): AssessmentPracticeView {
  const initialProbes: AssessmentPracticeObservation[] = []
  const verificationProbes: AssessmentPracticeObservation[] = []
  for (let index = 0; index < 4; index += 1) {
    const bit = 1 << index
    if ((state.initialMask & bit) !== 0) initialProbes.push(observation(index, gateOutput('or', (index & 2) !== 0, (index & 1) !== 0)))
    if ((state.verifyMask & bit) !== 0) verificationProbes.push(observation(index, outputBit(state.verifyOutputMask, index)))
  }
  return {
    courseId: 'cpe-101', scenario: 'logic-probe-lab-v1', revision: state.revision, phase: state.phase,
    title: 'Computer Engineering Foundations: logic probe lab',
    instructions: state.phase === 'inspect' ? 'Probe the faulty gate, compare observations with the target truth table, then inspect a counterexample.'
      : state.phase === 'repair' ? 'Choose a gate repair that matches the authored target.'
        : state.phase === 'verify' ? 'Rerun each of the four input combinations through the repaired gate.'
          : state.phase === 'submit' ? 'All outputs match. Submit to record the assignment.' : 'Assignment complete.',
    targetTable: [observation(0, false), observation(1, false), observation(2, false), observation(3, true)],
    initialProbes, verificationProbes,
    counterexample: state.counterexample === null ? null : observation(state.counterexample, true),
    feedback: savedFeedback(state),
    score: state.score,
  }
}
