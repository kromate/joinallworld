import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JUSTICE_PRACTICE_MAX_RECEIPTS, applyJusticePractice, createJusticePractice,
  justicePracticeFeedback, justicePracticeView, readJusticePracticeState,
} from './justice-practice.ts'
import type { JusticePracticeAction, JusticePracticeState } from './justice-practice.ts'

function send(state: JusticePracticeState, requestId: string, action: JusticePracticeAction, expectedRevision = state.revision) {
  const result = applyJusticePractice(state, { requestId, expectedRevision, action })
  const parsed = readJusticePracticeState(result.state)
  assert.ok(parsed, `saved state after ${requestId} is reconstructible from its receipt ledger`)
  return { ...result, state: parsed }
}

function finishInitialEvidence(state: JusticePracticeState, prefix = 'read'): JusticePracticeState {
  for (const evidenceId of ['dispatch-copy', 'arrival-receipt', 'seal-log'] as const) state = send(state, `${prefix}-${evidenceId}`, { kind: 'inspect', evidenceId }).state
  return state
}

function reachReviewDecision(state: JusticePracticeState, prefix = 'path'): JusticePracticeState {
  state = finishInitialEvidence(state, prefix)
  state = send(state, `${prefix}-initial`, { kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['arrival-receipt', 'dispatch-copy'] }).state
  state = send(state, `${prefix}-notice`, { kind: 'send-service-notice' }).state
  return send(state, `${prefix}-recount`, { kind: 'inspect-review' }).state
}
const AUTHORED_EVIDENCE_ORDER = ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount'] as const
const INITIAL_EVIDENCE_PERMUTATIONS = [
  ['dispatch-copy', 'arrival-receipt', 'seal-log'], ['dispatch-copy', 'seal-log', 'arrival-receipt'],
  ['arrival-receipt', 'dispatch-copy', 'seal-log'], ['arrival-receipt', 'seal-log', 'dispatch-copy'],
  ['seal-log', 'dispatch-copy', 'arrival-receipt'], ['seal-log', 'arrival-receipt', 'dispatch-copy'],
] as const
function canonicalEvidenceSet(ids: readonly string[]) {
  return AUTHORED_EVIDENCE_ORDER.filter((id) => ids.includes(id))
}

test('case stays active through evidence comparison, explicit notice, NPC review request, and linked second decision', () => {
  let state = createJusticePractice()
  const initialView = justicePracticeView(state)
  assert.ok(initialView)
  assert.equal(initialView.trainingComplete, false)
  assert.equal(initialView.evidence.length, 3)
  assert.match(initialView.disclaimer, /not legal advice/)

  const skipped = send(state, 'skip-to-choice', { kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] })
  assert.equal(skipped.outcome.feedbackId, 'wrongPhase')
  assert.equal(skipped.state.phase, 'inspect-initial')
  state = finishInitialEvidence(skipped.state)
  assert.equal(state.phase, 'initial-decision')

  const wrongChoice = send(state, 'unsupported-choice', { kind: 'initial-decision', choiceId: 'assign-responsibility', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] })
  assert.equal(wrongChoice.outcome.feedbackId, 'compareCounts')
  assert.equal(wrongChoice.state.phase, 'initial-decision')
  assert.deepEqual(wrongChoice.state.inspectedEvidenceIds, state.inspectedEvidenceIds)
  const wrongReason = send(wrongChoice.state, 'wrong-reason', { kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['seal-log'] })
  assert.equal(wrongReason.state.phase, 'initial-decision')
  state = send(wrongReason.state, 'initial-correct', { kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['arrival-receipt', 'dispatch-copy'] }).state
  assert.equal(state.phase, 'serve-notice')

  const beforeNotice = justicePracticeView(state)
  assert.ok(beforeNotice)
  assert.ok(beforeNotice.serviceNotice)
  assert.equal(beforeNotice.npcReviewRequest, null)
  state = send(state, 'send-notice', { kind: 'send-service-notice' }).state
  assert.equal(state.phase, 'inspect-review')
  const requestView = justicePracticeView(state)
  assert.ok(requestView)
  assert.match(requestView.npcReviewRequest ?? '', /NPC review request/)
  assert.ok(requestView.evidence.some((item) => item.id === 'npc-recount'))

  state = send(state, 'inspect-npc-recount', { kind: 'inspect-review' }).state
  assert.equal(state.phase, 'review-decision')
  const premature = send(state, 'review-without-link', { kind: 'review-decision', choiceId: 'correct-duplicate-entry', reasonEvidenceIds: ['npc-recount'] })
  assert.equal(premature.state.phase, 'review-decision')
  const wrong = send(premature.state, 'bad-review', { kind: 'review-decision', choiceId: 'assign-responsibility', reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] })
  assert.equal(wrong.state.phase, 'review-decision')
  assert.equal(wrong.state.noticeSent, true)
  state = send(wrong.state, 'review-correct', { kind: 'review-decision', choiceId: 'correct-duplicate-entry', reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] }).state
  assert.equal(state.phase, 'complete')
  assert.equal(state.reviewDecision?.choiceId, 'correct-duplicate-entry')
  const finishedView = justicePracticeView(state)
  assert.ok(finishedView?.trainingComplete)
  assert.match(justicePracticeFeedback('complete'), /practice completion only|Training sequence complete/)
  assert.equal('score' in state, false)
  assert.equal('verdict' in state, false)
  const terminalRequest = { requestId: 'post-completion', expectedRevision: state.revision, action: { kind: 'inspect', evidenceId: 'npc-recount' } }
  const refusal = applyJusticePractice(state, terminalRequest)
  assert.equal(refusal.outcome.code, 'terminal')
  assert.equal(refusal.state.phase, 'complete')
  assert.deepEqual(readJusticePracticeState(refusal.state), refusal.state)
  const terminalReplay = applyJusticePractice(refusal.state, terminalRequest)
  assert.equal(terminalReplay.duplicate, true)
  assert.deepEqual(terminalReplay.outcome, refusal.outcome)
  const changedTerminal = applyJusticePractice(refusal.state, { ...terminalRequest, action: { kind: 'send-service-notice' } })
  assert.equal(changedTerminal.outcome.feedbackId, 'requestConflict')
})

test('same request replays its original outcome alongside current state; changed payload and stale revision conflict', () => {
  let state = createJusticePractice()
  const action = { kind: 'inspect', evidenceId: 'dispatch-copy' } as const
  const first = send(state, 'stable-read', action)
  state = first.state
  state = send(state, 'read-receipt', { kind: 'inspect', evidenceId: 'arrival-receipt' }).state
  const replay = applyJusticePractice(state, { requestId: 'stable-read', expectedRevision: 0, action })
  assert.equal(replay.duplicate, true)
  assert.equal(replay.state.revision, state.revision)
  assert.equal(replay.state.inspectedEvidenceIds.length, 2)
  assert.deepEqual(replay.outcome, first.outcome)

  const changed = applyJusticePractice(state, { requestId: 'stable-read', expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'seal-log' } })
  assert.equal(changed.outcome.feedbackId, 'requestConflict')
  assert.equal(changed.state.revision, state.revision)

  const stale = send(state, 'stale-write', { kind: 'inspect', evidenceId: 'seal-log' }, 0)
  assert.equal(stale.outcome.feedbackId, 'revisionConflict')
  assert.equal(stale.state.revision, state.revision)
  const staleReplay = applyJusticePractice(stale.state, { requestId: 'stale-write', expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'seal-log' } })
  assert.equal(staleReplay.duplicate, true)
  assert.equal(staleReplay.outcome.feedbackId, 'revisionConflict')
  assert.deepEqual(readJusticePracticeState(stale.state), stale.state)

  const sharedBase = createJusticePractice()
  const leftRequest = { requestId: 'race-left', expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'dispatch-copy' } as const }
  const rightRequest = { requestId: 'race-right', expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'arrival-receipt' } as const }
  const leftCandidate = applyJusticePractice(sharedBase, leftRequest)
  const rightCandidate = applyJusticePractice(sharedBase, rightRequest)
  assert.equal(leftCandidate.outcome.revision, rightCandidate.outcome.revision)
  // The server must CAS one persisted candidate; after the winner, the loser's request is stale.
  const losingWrite = applyJusticePractice(leftCandidate.state, rightRequest)
  assert.equal(losingWrite.outcome.feedbackId, 'revisionConflict')
  assert.deepEqual(losingWrite.state.inspectedEvidenceIds, ['dispatch-copy'])
})

test('seal then dispatch inspections remain readable in the exact successful-inspection chronology', () => {
  let state = createJusticePractice()
  const seal = applyJusticePractice(state, { requestId: 'red-seal-first', expectedRevision: 0,
    action: { kind: 'inspect', evidenceId: 'seal-log' } })
  assert.equal(seal.outcome.code, 'advanced')
  state = seal.state
  const dispatch = applyJusticePractice(state, { requestId: 'red-dispatch-second', expectedRevision: 1,
    action: { kind: 'inspect', evidenceId: 'dispatch-copy' } })
  assert.equal(dispatch.outcome.code, 'advanced')
  assert.deepEqual(dispatch.state.inspectedEvidenceIds, ['dispatch-copy', 'seal-log'])
  const parsed = readJusticePracticeState(dispatch.state)
  assert.ok(parsed, 'the supported chronology remains readable before the next action')
  assert.deepEqual(parsed.inspectedEvidenceIds, ['dispatch-copy', 'seal-log'])
  assert.deepEqual(parsed.receipts, dispatch.state.receipts)
  assert.deepEqual(justicePracticeView(dispatch.state)?.reviewedEvidenceIds, ['dispatch-copy', 'seal-log'])
})

test('all six inspection orders round-trip after every action and finish the authored sequence', () => {
  for (const order of INITIAL_EVIDENCE_PERMUTATIONS) {
    let state = createJusticePractice()
    const successfulOrder: string[] = []
    for (const evidenceId of order) {
      const result = applyJusticePractice(state, { requestId: `${order.join('-')}-${evidenceId}`, expectedRevision: state.revision,
        action: { kind: 'inspect', evidenceId } })
      assert.equal(result.outcome.code, 'advanced')
      state = result.state
      successfulOrder.push(evidenceId)
      const rawBeforeRead = structuredClone(state)
      const canonical = readJusticePracticeState(state)
      assert.ok(canonical, `current chronology reads after ${order.join(', ')}`)
      assert.deepEqual(canonical.inspectedEvidenceIds, canonicalEvidenceSet(successfulOrder))
      assert.deepEqual(canonical.receipts, state.receipts, 'receipts retain exact chronological values')
      assert.deepEqual(state, rawBeforeRead, 'reader does not rewrite the stored chronology')
      assert.deepEqual(justicePracticeView(state)?.reviewedEvidenceIds, canonicalEvidenceSet(successfulOrder))
      const serializedRead = readJusticePracticeState(JSON.parse(JSON.stringify(state)))
      assert.ok(serializedRead, 'serialized progress reads after each inspection')
      assert.deepEqual(serializedRead.inspectedEvidenceIds, canonicalEvidenceSet(successfulOrder))

      const legacyChronology = { ...structuredClone(state), inspectedEvidenceIds: [...successfulOrder] }
      const legacyBeforeRead = structuredClone(legacyChronology)
      const legacy = readJusticePracticeState(legacyChronology)
      assert.ok(legacy, 'legacy chronology reconstructed from its own receipts is accepted')
      assert.deepEqual(legacy.inspectedEvidenceIds, canonicalEvidenceSet(successfulOrder))
      assert.deepEqual(legacy.receipts, state.receipts)
      assert.deepEqual(legacyChronology, legacyBeforeRead, 'legacy read leaves supplied bytes in memory unchanged')
      const canonicalLegacy = { ...structuredClone(state), inspectedEvidenceIds: canonicalEvidenceSet(successfulOrder) }
      assert.ok(readJusticePracticeState(canonicalLegacy), 'canonical set representation remains accepted')
    }

    state = send(state, `${order.join('-')}-decision`, { kind: 'initial-decision', choiceId: 'pause-and-reconcile',
      reasonEvidenceIds: ['arrival-receipt', 'dispatch-copy'] }).state
    state = send(state, `${order.join('-')}-notice`, { kind: 'send-service-notice' }).state
    state = send(state, `${order.join('-')}-recount`, { kind: 'inspect-review' }).state
    state = send(state, `${order.join('-')}-review`, { kind: 'review-decision', choiceId: 'correct-duplicate-entry',
      reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] }).state
    assert.equal(state.phase, 'complete')
    assert.deepEqual(state.inspectedEvidenceIds, [...AUTHORED_EVIDENCE_ORDER])
    assert.ok(justicePracticeView(state)?.trainingComplete)
    assert.ok(readJusticePracticeState(JSON.parse(JSON.stringify(state))))
  }
})

test('legacy chronology is derived only from successful inspections and preserves replay history', () => {
  let state = createJusticePractice()
  const firstRequest = { requestId: 'legacy-seal-first', expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'seal-log' } as const }
  state = applyJusticePractice(state, firstRequest).state
  const repeated = applyJusticePractice(state, { requestId: 'legacy-repeat-seal', expectedRevision: state.revision,
    action: { kind: 'inspect', evidenceId: 'seal-log' } })
  assert.equal(repeated.outcome.feedbackId, 'alreadyInspected')
  state = repeated.state
  const stale = applyJusticePractice(state, { requestId: 'legacy-stale-dispatch', expectedRevision: 0,
    action: { kind: 'inspect', evidenceId: 'dispatch-copy' } })
  assert.equal(stale.outcome.feedbackId, 'revisionConflict')
  state = stale.state
  state = applyJusticePractice(state, { requestId: 'legacy-dispatch-second', expectedRevision: state.revision,
    action: { kind: 'inspect', evidenceId: 'dispatch-copy' } }).state

  const legacy = { ...structuredClone(state), inspectedEvidenceIds: ['seal-log', 'dispatch-copy'] as const }
  const before = structuredClone(legacy)
  const parsed = readJusticePracticeState(legacy)
  assert.ok(parsed)
  assert.deepEqual(parsed.inspectedEvidenceIds, ['dispatch-copy', 'seal-log'])
  assert.deepEqual(parsed.receipts, state.receipts)
  assert.deepEqual(legacy, before)
  assert.deepEqual(parsed.receipts.map((receipt) => receipt.outcome.feedbackId), ['inspected', 'alreadyInspected', 'revisionConflict', 'inspected'])

  const replay = applyJusticePractice(legacy, firstRequest)
  assert.equal(replay.duplicate, true)
  assert.deepEqual(replay.outcome, state.receipts[0]?.outcome)
  assert.deepEqual(replay.state.inspectedEvidenceIds, ['dispatch-copy', 'seal-log'])
  assert.deepEqual(replay.state.receipts, state.receipts)

  state = send(state, 'legacy-arrival-third', { kind: 'inspect', evidenceId: 'arrival-receipt' }).state
  state = send(state, 'legacy-decision', { kind: 'initial-decision', choiceId: 'pause-and-reconcile',
    reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] }).state
  state = send(state, 'legacy-notice', { kind: 'send-service-notice' }).state
  state = send(state, 'legacy-recount', { kind: 'inspect-review' }).state
  state = send(state, 'legacy-review', { kind: 'review-decision', choiceId: 'correct-duplicate-entry',
    reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] }).state
  const terminalRequest = { requestId: 'legacy-terminal-replay', expectedRevision: state.revision,
    action: { kind: 'inspect', evidenceId: 'npc-recount' } as const }
  const terminal = applyJusticePractice(state, terminalRequest)
  assert.equal(terminal.outcome.code, 'terminal')
  state = terminal.state
  const fullChronology = { ...structuredClone(state), inspectedEvidenceIds: ['seal-log', 'dispatch-copy', 'arrival-receipt', 'npc-recount'] as const }
  const fullBeforeRead = structuredClone(fullChronology)
  const fullParsed = readJusticePracticeState(fullChronology)
  assert.ok(fullParsed)
  assert.deepEqual(fullParsed.inspectedEvidenceIds, [...AUTHORED_EVIDENCE_ORDER])
  assert.deepEqual(fullParsed.receipts, state.receipts)
  assert.deepEqual(fullChronology, fullBeforeRead)
  const terminalReplay = applyJusticePractice(fullChronology, terminalRequest)
  assert.equal(terminalReplay.duplicate, true)
  assert.deepEqual(terminalReplay.outcome, terminal.outcome)
  assert.deepEqual(terminalReplay.state.receipts, state.receipts)
})

test('matching evidence membership with unsupported order and altered histories remain refused unchanged', () => {
  let state = createJusticePractice()
  for (const [index, evidenceId] of ['seal-log', 'dispatch-copy', 'arrival-receipt'].entries())
    state = applyJusticePractice(state, { requestId: `unsupported-order-${index}`, expectedRevision: state.revision,
      action: { kind: 'inspect', evidenceId } }).state
  const invalidVariants: unknown[] = [
    { ...structuredClone(state), inspectedEvidenceIds: ['arrival-receipt', 'seal-log', 'dispatch-copy'] },
    { ...structuredClone(state), inspectedEvidenceIds: ['dispatch-copy', 'arrival-receipt'] },
    { ...structuredClone(state), inspectedEvidenceIds: ['dispatch-copy', 'arrival-receipt', 'arrival-receipt'] },
    { ...structuredClone(state), receipts: state.receipts.slice(1) },
    { ...structuredClone(state), receipts: [...state.receipts, structuredClone(state.receipts[0])] },
    { ...structuredClone(state), receipts: [...state.receipts].reverse() },
    { ...structuredClone(state), receipts: state.receipts.map((receipt, index) => index === 0
      ? { ...receipt, action: { kind: 'inspect', evidenceId: 'arrival-receipt' } } : receipt) },
    { ...structuredClone(state), receipts: state.receipts.map((receipt, index) => index === 0
      ? { ...receipt, expectedRevision: receipt.expectedRevision + 1 } : receipt) },
    { ...structuredClone(state), receipts: state.receipts.map((receipt, index) => index === 0
      ? { ...receipt, outcome: { ...receipt.outcome, feedbackId: 'alreadyInspected' } } : receipt) },
    { ...structuredClone(state), receipts: state.receipts.map((receipt, index) => index === 0
      ? { ...receipt, outcome: { ...receipt.outcome, revision: receipt.outcome.revision + 1 } } : receipt) },
    { ...structuredClone(state), initialDecision: { choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] } },
    { ...structuredClone(state), phase: 'serve-notice' },
    { ...structuredClone(state), schemaVersion: 2 },
    { ...structuredClone(state), receipts: Array.from({ length: JUSTICE_PRACTICE_MAX_RECEIPTS + 1 }, (_, index) => ({
      requestId: `cap-${index}`, expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'seal-log' },
      outcome: { code: 'advanced', feedbackId: 'inspected', revision: 1 },
    })) },
  ]
  for (const variant of invalidVariants) {
    const serializedBefore = JSON.stringify(variant)
    assert.equal(readJusticePracticeState(variant), null)
    assert.equal(JSON.stringify(variant), serializedBefore, 'invalid stored row remains unchanged')
  }
})

test('review and completion cannot be fabricated in a saved record or via invented evidence', () => {
  const fresh = createJusticePractice()
  assert.equal(readJusticePracticeState({ ...fresh, schemaVersion: 2 }), null)
  assert.equal(readJusticePracticeState({ ...fresh, unexplained: true }), null)
  assert.equal(readJusticePracticeState({ ...fresh, inspectedEvidenceIds: ['invented-record'] }), null)
  assert.equal(readJusticePracticeState({ ...fresh, phase: 'complete', initialDecision: { choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] }, noticeSent: true,
    inspectedEvidenceIds: ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount'], reviewDecision: { choiceId: 'correct-duplicate-entry', reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] } }), null)
  const invalidAction = applyJusticePractice(fresh, { requestId: 'invented', expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'invented-record' } })
  assert.equal(invalidAction.outcome.code, 'invalid')
  assert.equal(invalidAction.state.revision, 0)
  assert.deepEqual(invalidAction.state, fresh)

  const staged = reachReviewDecision(createJusticePractice())
  const forged = { ...staged, phase: 'complete', reviewDecision: { choiceId: 'correct-duplicate-entry', reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] } }
  assert.equal(readJusticePracticeState(forged), null)
  const forgedReceipt = { ...staged, receipts: [...staged.receipts, { requestId: 'made-up-completion', expectedRevision: staged.revision,
    action: { kind: 'review-decision', choiceId: 'correct-duplicate-entry', reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] },
    outcome: { code: 'complete', feedbackId: 'complete', revision: staged.revision + 1 } }] }
  assert.equal(readJusticePracticeState(forgedReceipt), null)
})

test('invalid saved state cannot be silently replaced by a newly advanced practice', () => {
  const future = { ...createJusticePractice(), schemaVersion: 2 }, before = structuredClone(future)
  const refused = applyJusticePractice(future, {
    requestId: 'valid-request', expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'dispatch-copy' },
  })
  assert.equal(refused.outcome.code, 'invalid')
  assert.equal(refused.state.revision, 0)
  assert.deepEqual(refused.state.receipts, [])
  assert.deepEqual(future, before)
})

test('ledger cap fails closed and never evicts the original replay key', () => {
  let state = createJusticePractice()
  let firstRequest: ReturnType<typeof send> | null = null
  for (let i = 0; i < JUSTICE_PRACTICE_MAX_RECEIPTS; i++) {
    const result = send(state, `wrong-phase-${i}`, { kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] })
    if (i === 0) firstRequest = result
    state = result.state
  }
  const capped = applyJusticePractice(state, { requestId: 'would-advance', expectedRevision: state.revision, action: { kind: 'inspect', evidenceId: 'dispatch-copy' } })
  assert.equal(capped.outcome.feedbackId, 'capacity')
  assert.equal(capped.state.receipts.length, JUSTICE_PRACTICE_MAX_RECEIPTS)
  assert.deepEqual(capped.state, state)
  const replay = applyJusticePractice(capped.state, { requestId: 'wrong-phase-0', expectedRevision: 0,
    action: { kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] } })
  assert.equal(replay.duplicate, true)
  assert.deepEqual(replay.outcome, firstRequest?.outcome)
})
