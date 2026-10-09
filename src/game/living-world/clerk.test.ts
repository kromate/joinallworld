import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_CLERK_PRACTICE_BYTES, clerkPracticeView, readClerkPractice, startClerkPractice, stepClerkPractice,
  type ClerkPracticeInput, type ClerkPracticeState,
} from './clerk.ts'

const send = (state: ClerkPracticeState, stepId: ClerkPracticeInput['stepId'], evidenceId: string,
  patch: Partial<ClerkPracticeInput> = {}) => stepClerkPractice(state, { actorId: state.actorId, expectedRevision: state.revision, stepId, evidenceId, ...patch })
const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

test('fictional clerk practice requires ordered inspection, comparison, and proportionate decision', () => {
  let state = startClerkPractice('guest-ada')!
  assert.deepEqual([state.step, state.revision, state.result], ['inspect_receipt', 0, null])
  assert.deepEqual(readClerkPractice(state), state)
  assert.ok(JSON.stringify(state).length <= MAX_CLERK_PRACTICE_BYTES)

  const initialView = clerkPracticeView(state)!
  assert.equal(initialView.evidence.length, 1)
  assert.equal(initialView.evidence[0]!.id, 'receipt')
  assert.deepEqual(initialView.choices, [])
  const outOfOrder = send(state, 'compare_discrepancy', 'compare-b')
  assert.deepEqual([outOfOrder.ok, outOfOrder.code, outOfOrder.state], [false, 'step_out_of_order', state])
  const badReceipt = send(state, 'inspect_receipt', 'dispatch')
  assert.deepEqual([badReceipt.ok, badReceipt.code, badReceipt.feedback, badReceipt.state],
    [false, 'learning_feedback', 'Start by opening the receiving receipt.', state])
  const receipt = send(state, 'inspect_receipt', 'receipt')
  assert.ok(receipt.ok && receipt.state)
  state = receipt.state

  const dispatchView = clerkPracticeView(state)!
  assert.equal(dispatchView.step, 'inspect_dispatch')
  assert.deepEqual(dispatchView.evidence.map(item => item.id), ['dispatch'])
  const dispatch = send(state, 'inspect_dispatch', 'dispatch')
  assert.ok(dispatch.ok && dispatch.state)
  state = dispatch.state

  const compareView = clerkPracticeView(state)!
  assert.equal(compareView.evidence.length, 2)
  assert.equal(compareView.choices.length, 3)
  assert.equal(compareView.choices.some(choice => choice.id === 'quantity_mismatch'), false, 'public view does not expose the answer key')
  assert.match(compareView.evidence[0]!.text, /Blue Seal crates/)
  assert.match(compareView.evidence[1]!.text, /Blue Seal crates/)
  compareView.evidence[0]!.text = 'tampered evidence'
  compareView.choices[0]!.label = 'tampered choice'
  compareView.evidence.pop()
  compareView.choices.pop()
  const freshView = clerkPracticeView(state)!
  assert.equal(freshView.evidence.length, 2)
  assert.match(freshView.evidence[0]!.text, /4 Blue Seal crates/)
  assert.notEqual(freshView.choices[0]!.label, 'tampered choice', 'view mutation cannot alter the authored catalogue')
  const wrongCompare = send(state, 'compare_discrepancy', 'compare-a')
  assert.match(wrongCompare.feedback ?? '', /labels match/)
  assert.deepEqual(wrongCompare.state, state)
  const compare = send(state, 'compare_discrepancy', 'compare-b')
  assert.ok(compare.ok && compare.state)
  state = compare.state

  const decisionView = clerkPracticeView(state)!
  assert.equal(decisionView.step, 'choose_outcome')
  assert.equal(decisionView.choices.length, 3)
  const wrongDecision = send(state, 'choose_outcome', 'outcome-c')
  assert.match(wrongDecision.feedback ?? '', /does not show intent/)
  assert.deepEqual(wrongDecision.state, state)
  const complete = send(state, 'choose_outcome', 'outcome-a')
  assert.ok(complete.ok && complete.state)
  state = complete.state
  assert.deepEqual([state.step, state.revision, state.result], [
    'complete', 4, { finding: 'quantity_mismatch', outcome: 'pause_and_reconcile' },
  ])
  assert.deepEqual(readClerkPractice(state), state)
  assert.equal(clerkPracticeView(state)?.result?.finding, 'The records differ by one crate.')

  const replay = stepClerkPractice(state, { actorId: state.actorId, expectedRevision: state.revision, stepId: 'choose_outcome', evidenceId: 'outcome-a' })
  assert.deepEqual([replay.ok, replay.code, replay.state], [false, 'practice_complete', state], 'terminal replay cannot progress or re-award')
})

test('actor, CAS, step payload shape, and authored IDs are checked without mutating the save', () => {
  const state = startClerkPractice('ada')!
  const before = snapshot(state)
  const cases: [unknown, string][] = [
    [{ actorId: 'bob', expectedRevision: 0, stepId: 'inspect_receipt', evidenceId: 'receipt' }, 'wrong_actor'],
    [{ actorId: 'ada', expectedRevision: 1, stepId: 'inspect_receipt', evidenceId: 'receipt' }, 'revision_conflict'],
    [{ actorId: 'ada', expectedRevision: 0, stepId: 'inspect_receipt', evidenceId: 'not-authored' }, 'learning_feedback'],
    [{ actorId: 'ada', expectedRevision: 0, stepId: 'inspect_receipt', evidenceId: 'receipt', answer: true }, 'invalid_request'],
    [{ actorId: 'ada', expectedRevision: 0, stepId: 'future-step', evidenceId: 'receipt' }, 'step_out_of_order'],
  ]
  for (const [input, code] of cases) {
    const result = stepClerkPractice(state, input)
    assert.deepEqual([result.ok, result.code, result.state], [false, code, state])
  }
  assert.deepEqual(state, before)
  assert.equal(startClerkPractice('x'.repeat(101)), null)
})

test('strict reader quarantines malformed, future, inconsistent, oversized, and impossible terminal saves unchanged', () => {
  const initial = startClerkPractice('ada')!
  const progressed = send(initial, 'inspect_receipt', 'receipt').state!
  const completed = (() => {
    let s = initial
    for (const [stepId, evidenceId] of [
      ['inspect_receipt', 'receipt'], ['inspect_dispatch', 'dispatch'], ['compare_discrepancy', 'compare-b'], ['choose_outcome', 'outcome-a'],
    ] as const) s = send(s, stepId, evidenceId).state!
    return s
  })()
  const candidates: unknown[] = [
    { ...initial, future: true },
    { ...initial, actorId: '__proto__' },
    { ...initial, revision: 2 },
    { ...initial, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...progressed, result: { finding: 'quantity_mismatch', outcome: 'pause_and_reconcile' } },
    { ...completed, result: { finding: 'different', outcome: 'pause_and_reconcile' } },
    { ...completed, step: 'inspect_receipt' },
    { ...completed, result: { finding: 'quantity_mismatch', outcome: 'pause_and_reconcile', extra: true } },
    { ...initial, actorId: 'a'.repeat(100), note: 'x'.repeat(MAX_CLERK_PRACTICE_BYTES) },
  ]
  for (const source of candidates) {
    const before = snapshot(source)
    assert.equal(readClerkPractice(source), null)
    assert.deepEqual(source, before, 'invalid save is quarantined without repair/reset')
  }
  assert.equal(readClerkPractice(null), null)
  assert.equal(clerkPracticeView({ ...initial, future: true }), null)
})
