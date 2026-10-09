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
