import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClerkResponse } from '../../../types/living-world-clerk.ts'
import type { ApiEnvelope } from '../../../types/protocol.ts'
import { readClerkReply } from './clerkReply.ts'

type Payload = ClerkResponse & ApiEnvelope
const currentPractice = {
  scenarioVersion: 1,
  title: 'A missing-crate handoff',
  narrative: 'A fictional desk is comparing two delivery records.',
  step: 'inspect_receipt',
  prompt: 'Open and inspect the receiving record.',
  evidence: [{ id: 'receipt', label: 'Receiving receipt', text: 'Four crates were received.' }],
  choices: [],
  result: null,
}
const completePractice = {
  scenarioVersion: 1,
  title: 'A missing-crate handoff',
  narrative: 'A fictional desk is comparing two delivery records.',
  step: 'complete',
  prompt: 'Practice complete.',
  evidence: [
    { id: 'receipt', label: 'Receiving receipt', text: 'Four crates were received.' },
    { id: 'dispatch', label: 'Dispatch note', text: 'Five crates were dispatched.' },
  ],
  choices: [],
  result: { finding: 'The records differ by one crate.', outcome: 'Pause and reconcile.', explanation: 'A mismatch calls for a check, not an accusation.' },
}
function response(overrides: Record<string, unknown> = {}): Payload {
  return { serverTime: 1_800_000_000_000, ok: true, code: 'practice_loaded', practice: currentPractice,
    revision: 0, claimed: false, reward: 75, ...overrides } as Payload
}

test('reads public current, completed, and claimed server projections', () => {
  const current = readClerkReply(response())
  assert.ok(current)
  assert.equal(current.practice?.step, 'inspect_receipt')

  const complete = response({ code: 'practice_completed', practice: completePractice, revision: 4 })
  const readComplete = readClerkReply(complete)
  assert.ok(readComplete)
  assert.equal(readComplete.practice?.result?.finding, completePractice.result.finding)

  const claimed = readClerkReply(response({ code: 'practice_claimed', practice: completePractice, revision: 4, claimed: true }))
  assert.ok(claimed)
  assert.equal(claimed.claimed, true)
  assert.equal(claimed.reward, 75)
})

test('accepts the empty saved state and rejects incompatible null/claim fields', () => {
  assert.deepEqual(readClerkReply(response({ code: 'practice_ready', practice: null, revision: null })), {
    serverTime: 1_800_000_000_000, ok: true, code: 'practice_ready', practice: null, revision: null, claimed: false, reward: 75,
  })
  assert.equal(readClerkReply(response({ practice: null, revision: 0 })), null)
  assert.equal(readClerkReply(response({ practice: null, revision: null, claimed: true })), null)
})

test('rejects malformed, future, and private saved-state shapes', () => {
  assert.equal(readClerkReply(response({ practice: { ...currentPractice, scenarioVersion: 2 } })), null)
  assert.equal(readClerkReply(response({ practice: { ...currentPractice, step: 'future_step' } })), null)
  assert.equal(readClerkReply(response({ practice: { ...currentPractice, actorId: 'private-actor' } })), null)
  assert.equal(readClerkReply(response({ practice: { ...currentPractice, evidence: [{ ...currentPractice.evidence[0], id: 'bad id' }] } })), null)
  assert.equal(readClerkReply(response({ storage: 'failing' })), null)
  assert.equal(readClerkReply(response({ unexpected: 'unrecognized envelope field' })), null)
})

test('rejects mismatched revisions and terminal state combinations', () => {
  assert.equal(readClerkReply(response({ revision: 1 })), null)
  assert.equal(readClerkReply(response({ practice: completePractice, revision: 3 })), null)
  assert.equal(readClerkReply(response({ practice: completePractice, revision: 4, claimed: true, reward: 0 })), null)
  assert.equal(readClerkReply(response({ practice: { ...currentPractice, result: completePractice.result } })), null)
  assert.equal(readClerkReply(response({ practice: { ...completePractice, result: null }, revision: 4 })), null)
})

test('rejects duplicate evidence or choice identifiers', () => {
  const repeatedEvidence = [{ id: 'receipt', label: 'One', text: 'First.' }, { id: 'receipt', label: 'Two', text: 'Second.' }]
  assert.equal(readClerkReply(response({ practice: { ...currentPractice, evidence: repeatedEvidence } })), null)
  const repeatedChoices = [{ id: 'compare-a', label: 'First.' }, { id: 'compare-a', label: 'Second.' }]
  assert.equal(readClerkReply(response({ practice: { ...currentPractice, choices: repeatedChoices } })), null)
})
