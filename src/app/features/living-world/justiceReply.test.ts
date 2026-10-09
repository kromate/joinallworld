import test from 'node:test'
import assert from 'node:assert/strict'
import { readJusticeReply } from './justiceReply.ts'

const baseView = {
  caseId: 'fictional-shipment-review-01', title: 'The duplicate tally', disclaimer: 'Fictional practice only.',
  summary: 'A sample depot record is being reviewed.', phase: 'inspect-initial', revision: 0,
  prompt: 'Inspect the records.',
  evidence: [
    { id: 'dispatch-copy', label: 'Dispatch copy', text: 'Ten parcels were dispatched.' },
    { id: 'arrival-receipt', label: 'Arrival receipt', text: 'Twelve parcels were recorded.' },
    { id: 'seal-log', label: 'Seal log', text: 'The seal was intact.' },
  ], reviewedEvidenceIds: [], initialChoices: [], reviewChoices: [], serviceNotice: null, npcReviewRequest: null, trainingComplete: false,
}
function reply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { serverTime: 1_800_000_000_000, ok: true, code: 'practice_loaded', practice: baseView, revision: 0, ...overrides }
}
function phaseView(phase: string, revision: number): Record<string, unknown> {
  const review = phase === 'inspect-review' || phase === 'review-decision' || phase === 'complete'
  const initialDecision = phase === 'initial-decision'
  const reviewDecision = phase === 'review-decision'
  const complete = phase === 'complete'
  return {
    ...baseView, phase, revision,
    evidence: review ? [...baseView.evidence, { id: 'npc-recount', label: 'NPC recount note', text: 'The count was ten.' }] : baseView.evidence,
    reviewedEvidenceIds: phase === 'initial-decision' || phase === 'serve-notice' || phase === 'inspect-review'
      ? ['dispatch-copy', 'arrival-receipt', 'seal-log']
      : phase === 'review-decision' || phase === 'complete'
        ? ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount'] : [],
    initialChoices: initialDecision ? [
      { id: 'pause-and-reconcile', label: 'Pause and reconcile' }, { id: 'accept-receipt', label: 'Accept receipt' }, { id: 'assign-responsibility', label: 'Assign responsibility' },
    ] : [],
    reviewChoices: reviewDecision ? [
      { id: 'correct-duplicate-entry', label: 'Correct the duplicate entry' }, { id: 'keep-hold', label: 'Keep the hold' }, { id: 'assign-responsibility', label: 'Assign responsibility' },
    ] : [],
    serviceNotice: ['serve-notice', 'inspect-review', 'review-decision', 'complete'].includes(phase) ? 'A sample notice was sent.' : null,
    npcReviewRequest: review ? 'The NPC requests an independent review.' : null,
    trainingComplete: complete,
  }
}

test('reads public case phases and the actual API envelope without accepting private state', () => {
  assert.equal(readJusticeReply(reply({ storage: undefined })), null)
  assert.ok(readJusticeReply(reply()))
  for (const [phase, revision] of [['initial-decision', 3], ['serve-notice', 4], ['inspect-review', 5], ['review-decision', 6], ['complete', 7]] as const) {
    const read = readJusticeReply(reply({ practice: phaseView(phase, revision), revision, serverTime: 1_800_000_000_001 }))
    assert.equal(read?.practice?.phase, phase)
    assert.equal(read?.serverTime, 1_800_000_000_001)
  }
  assert.equal(readJusticeReply(reply({ practice: null, revision: null, code: 'practice_ready' }))?.practice, null)
  assert.equal(readJusticeReply(reply({ actorId: 'private-id' })), null)
})

test('rejects failing storage, unknown envelopes, malformed scalar types, and unsafe projections', () => {
  assert.equal(readJusticeReply(reply({ storage: 'failing' })), null)
  assert.equal(readJusticeReply(reply({ surprise: true })), null)
  assert.equal(readJusticeReply(reply({ serverTime: '1800000000000' })), null)
  assert.equal(readJusticeReply(reply({ ok: 1 })), null)
  assert.equal(readJusticeReply(reply({ code: 'Practice loaded' })), null)
  assert.equal(readJusticeReply(reply({ duplicate: false })), null)
  assert.equal(readJusticeReply(reply({ feedback: { text: 'not text' } })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...baseView, evidence: [...baseView.evidence, baseView.evidence[0]] } })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...baseView, privateReceiptLedger: [] } })), null)
})

test('rejects incoherent phase details and mismatched revisions or terminal markers', () => {
  assert.equal(readJusticeReply(reply({ practice: phaseView('complete', 0), revision: 0 })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...baseView, revision: 25 }, revision: 25 })), null)
  assert.equal(readJusticeReply(reply({ revision: 1 })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...baseView, phase: 'future' } })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...baseView, phase: 'complete', trainingComplete: false } })), null)
  assert.equal(readJusticeReply(reply({ practice: phaseView('review-decision', 2) })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...baseView, serviceNotice: 'Premature notice' } })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...baseView, initialChoices: [{ id: 'unknown-choice', label: 'Choose' }] } })), null)
  assert.equal(readJusticeReply(reply({ practice: null, revision: 0 })), null)
})

test('restores reviewed evidence and rejects hidden, duplicate, or incomplete phase lists', () => {
  const restored = phaseView('inspect-initial', 1)
  restored.reviewedEvidenceIds = ['arrival-receipt']
  assert.deepEqual(readJusticeReply(reply({ practice: restored, revision: 1 }))?.practice?.reviewedEvidenceIds, ['arrival-receipt'])

  assert.equal(readJusticeReply(reply({ practice: { ...baseView, reviewedEvidenceIds: ['dispatch-copy', 'dispatch-copy'] } })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...baseView, reviewedEvidenceIds: ['npc-recount'] } })), null)
  assert.equal(readJusticeReply(reply({ practice: { ...phaseView('initial-decision', 3), reviewedEvidenceIds: ['dispatch-copy', 'arrival-receipt'] } })), null)
})
