import test from 'node:test'
import assert from 'node:assert/strict'
import {
  disabledMilestonePublisher,
  emptyMilestoneSync,
  enqueueMilestone,
  holdExpiredMilestoneLeases,
  leaseNextMilestone,
  readMilestoneSync,
  reconcileMilestone,
  recordMilestoneResult,
  revokeMilestoneConsent,
  setMilestoneConsent,
  type GameMilestoneObservation,
  type MilestonePublisher,
  type MilestoneSyncBinding,
  type SyncResult,
  type VerifiedMilestoneContract,
} from './sync.ts'

const binding = (generation = 1, status: 'active' | 'revoked' = 'active', contractVersion: string | null = '0.1.0'): MilestoneSyncBinding => ({
  accountId: 'account-1', workspaceId: 'workspace-1', installationId: 'install-1', generation, contractVersion, status,
})
const observation = (id = 'observation-1', completionAt = 1000): GameMilestoneObservation => ({
  id, kind: 'delivery.completed', schemaVersion: 1, aggregateVersion: 1, completionAt, gameEvidenceRef: `event:${id}`,
})
const contract: VerifiedMilestoneContract = { version: '0.1.0', sourceSha: 'a'.repeat(40), verified: true }
const codeOf = (result: SyncResult) => result.ok ? undefined : result.code

test('missing legacy state is unconsented, disabled and cannot enqueue', () => {
  const state = readMilestoneSync(undefined)
  assert.deepEqual(state, { v: 1, binding: null, outbox: [] })
  assert.equal(codeOf(enqueueMilestone(state, binding(), observation(), 1000)), 'unconsented')
})

test('enqueue requires the exact current consent and is stable across retry IDs', () => {
  let state = setMilestoneConsent(emptyMilestoneSync(), binding())
  const first = enqueueMilestone(state, binding(), observation(), 1000)
  assert.equal(first.ok, true)
  if (!first.ok) return
  state = first.state
  const duplicate = enqueueMilestone(state, binding(), observation(), 1200)
  assert.equal(duplicate.ok && duplicate.duplicate, true)
  assert.equal(codeOf(enqueueMilestone(state, binding(), observation('observation-1', 1001), 1200)), 'payload_conflict')
  assert.equal(codeOf(enqueueMilestone(state, binding(), { ...observation('alternate-id'), kind: 'mission.completed', aggregateVersion: 2, gameEvidenceRef: 'event:observation-1' }, 1200)), 'payload_conflict')
  assert.equal(codeOf(enqueueMilestone(state, binding(2), observation('other'), 1200)), 'stale_consent')
  assert.equal(codeOf(enqueueMilestone(state, binding(1, 'revoked'), observation('other'), 1200)), 'stale_consent')
})

test('the outbox is bounded and rejects observations carrying unapproved fields', () => {
  let state = setMilestoneConsent(emptyMilestoneSync(), binding())
  for (let i = 0; i < 128; i++) {
    const result = enqueueMilestone(state, binding(), observation(`observation-${i}`), 1000 + i)
    assert.equal(result.ok, true)
    if (result.ok) state = result.state
  }
  assert.equal(codeOf(enqueueMilestone(state, binding(), observation('overflow'), 2000)), 'outbox_full')
  const hostile = { ...observation('hostile'), email: 'private@example.test' } as GameMilestoneObservation
  assert.equal(codeOf(enqueueMilestone(state, binding(), hostile, 2000)), 'invalid_observation')
  assert.equal(codeOf(enqueueMilestone(state, binding(), { ...observation('bad-email'), id: 'person@example.test' }, 2000)), 'invalid_observation')
})

test('unknown or mismatched contracts never lease work; only exact verified contract can', () => {
  let state = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(state, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (!queued.ok) return
  state = queued.state
  assert.equal(codeOf(leaseNextMilestone(state, binding(), null, 1200)), 'unknown_contract')
  assert.equal(codeOf(leaseNextMilestone(state, binding(), { ...contract, version: '0.2.0' }, 1200)), 'unknown_contract')
  assert.equal(codeOf(leaseNextMilestone(state, binding(), { ...contract, verified: false } as unknown as VerifiedMilestoneContract, 1200)), 'unknown_contract')
  const unknown = setMilestoneConsent(emptyMilestoneSync(), binding(1, 'active', null))
  assert.equal(codeOf(leaseNextMilestone(unknown, binding(1, 'active', null), contract, 1200)), 'unknown_contract')
  const leased = leaseNextMilestone(state, binding(), contract, 1200)
  assert.equal(leased.ok, true)
  assert.equal(leased.ok && leased.entry.state, 'leased')
  assert.equal(codeOf(leaseNextMilestone(state, binding(), contract, Number.MAX_SAFE_INTEGER - 10, 30000)), 'not_dispatchable')
})

test('revocation cancels queued work, fences leased work, and a new generation cannot replay old observations', () => {
  let state = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(state, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (!queued.ok) return
  state = queued.state
  state = revokeMilestoneConsent(state, 1300)
  assert.equal(state.outbox[0]?.state, 'cancelled')
  assert.equal(codeOf(enqueueMilestone(state, binding(), observation('new'), 1400)), 'unconsented')
  state = setMilestoneConsent(state, binding(2))
  assert.equal(state.outbox[0]?.state, 'cancelled')
  assert.equal(codeOf(leaseNextMilestone(state, binding(2), contract, 1500)), 'not_dispatchable')
  assert.equal(enqueueMilestone(state, binding(2), observation('fresh'), 1500).ok, true)

  let raced = setMilestoneConsent(emptyMilestoneSync(), binding())
  const racedQueue = enqueueMilestone(raced, binding(), observation('raced'), 1600)
  assert.equal(racedQueue.ok, true)
  if (racedQueue.ok) {
    const racedLease = leaseNextMilestone(racedQueue.state, binding(), contract, 1700)
    assert.equal(racedLease.ok, true)
    if (racedLease.ok) {
      raced = revokeMilestoneConsent(racedLease.state, 1800)
      assert.equal(raced.outbox[0]?.state, 'uncertain')
      assert.equal(codeOf(recordMilestoneResult(raced, 'raced', 1, racedLease.entry.attemptVersion, { status: 'accepted', receiptId: 'late-ack' })), 'stale_consent')
      assert.equal(setMilestoneConsent(raced, binding(2)).outbox[0]?.state, 'uncertain')
    }
  }
})

test('lost leases become uncertain; unknown reconciliation holds and explicit non-acceptance may retry only under same consent', () => {
  let state = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(state, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (!queued.ok) return
  const leased = leaseNextMilestone(queued.state, binding(), contract, 1100, 500)
  assert.equal(leased.ok, true)
  if (!leased.ok) return
  state = holdExpiredMilestoneLeases(leased.state, 1700)
  assert.equal(state.outbox[0]?.state, 'uncertain')
  state = reconcileMilestone(state, 'observation-1', leased.entry.attemptVersion, 'unknown').state
  assert.equal(state.outbox[0]?.state, 'uncertain')
  state = reconcileMilestone(state, 'observation-1', leased.entry.attemptVersion, 'not-accepted').state
  assert.equal(state.outbox[0]?.state, 'queued')
  const accepted = leaseNextMilestone(state, binding(), contract, 1800)
  assert.equal(accepted.ok, true)
  if (accepted.ok) {
    const settled = recordMilestoneResult(accepted.state, 'observation-1', 1, accepted.entry.attemptVersion, { status: 'accepted', receiptId: 'provider-receipt' })
    assert.equal(settled.ok && settled.entry.state, 'acknowledged')
    assert.equal(JSON.stringify(settled).includes('reward'), false)
  }
})

test('attempt versions fence a late response after reconciliation and a second lease', () => {
  const consented = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(consented, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (!queued.ok) return
  const leaseA = leaseNextMilestone(queued.state, binding(), contract, 1100, 100)
  assert.equal(leaseA.ok, true)
  if (!leaseA.ok) return
  assert.equal(leaseA.entry.attemptVersion, 1)
  const uncertain = holdExpiredMilestoneLeases(leaseA.state, 1200)
  const retried = reconcileMilestone(uncertain, 'observation-1', leaseA.entry.attemptVersion, 'not-accepted')
  assert.equal(retried.ok, true)
  const leaseB = leaseNextMilestone(retried.state, binding(), contract, 1300)
  assert.equal(leaseB.ok, true)
  if (!leaseB.ok) return
  assert.equal(leaseB.entry.attemptVersion, 2)
  const lateA = recordMilestoneResult(leaseB.state, 'observation-1', 1, leaseA.entry.attemptVersion, { status: 'accepted', receiptId: 'late-A' })
  assert.equal(codeOf(lateA), 'stale_consent')
  assert.equal(lateA.state.outbox[0]?.state, 'leased')
  assert.equal(lateA.state.outbox[0]?.attemptVersion, 2)
  const resultB = recordMilestoneResult(leaseB.state, 'observation-1', 1, leaseB.entry.attemptVersion, { status: 'accepted', receiptId: 'B' })
  assert.equal(resultB.ok && resultB.entry.receiptId, 'B')
})

test('reconciliation rejects unknown runtime outcomes and cannot reopen uncertain work after revocation', () => {
  let state = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(state, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (!queued.ok) return
  const leased = leaseNextMilestone(queued.state, binding(), contract, 1100)
  assert.equal(leased.ok, true)
  if (!leased.ok) return
  state = holdExpiredMilestoneLeases(leased.state, 50000)
  assert.equal(codeOf(reconcileMilestone(state, 'observation-1', leased.entry.attemptVersion, 'surprise' as never)), 'invalid_observation')
  const revoked = revokeMilestoneConsent(state, 50001)
  assert.equal(codeOf(reconcileMilestone(revoked, 'observation-1', leased.entry.attemptVersion, 'not-accepted')), 'stale_consent')
  assert.equal(reconcileMilestone(revoked, 'observation-1', leased.entry.attemptVersion, 'unknown').state.outbox[0]?.state, 'uncertain')
})

test('saved leased entries require leases and stale consent fails closed on read', () => {
  const state = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(state, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (!queued.ok) return
  assert.throws(() => readMilestoneSync({ ...queued.state, outbox: [{ ...queued.entry, state: 'leased' }] }))
  assert.throws(() => readMilestoneSync({ ...queued.state, outbox: [queued.entry, { ...queued.entry, observation: { ...observation('alternate-id'), kind: 'mission.completed', aggregateVersion: 2, gameEvidenceRef: queued.entry.observation.gameEvidenceRef } }] }))
  const stale = readMilestoneSync({ ...queued.state, binding: binding(2), outbox: [queued.entry] })
  assert.equal(stale.outbox[0]?.state, 'cancelled')
  const leased = leaseNextMilestone(queued.state, binding(), contract, 1100)
  assert.equal(leased.ok, true)
  if (leased.ok) {
    const staleLease = readMilestoneSync({ ...leased.state, binding: binding(2) })
    assert.equal(staleLease.outbox[0]?.state, 'uncertain')
    assert.equal(staleLease.outbox[0]?.leaseUntil, undefined)
  }
})

test('disabled publisher performs no I/O and reports unavailable; test mock is explicit and deterministic', async () => {
  let calls = 0
  const unavailable = await disabledMilestonePublisher.publish(observation(), binding())
  assert.deepEqual(unavailable, { status: 'unavailable', reason: 'integration-disabled' })
  assert.equal(calls, 0)
  const fixtureOnlyMock: MilestonePublisher = {
    mode: 'test-mock', label: 'fixture-only',
    async publish(event) { calls++; return { status: 'mock-only', label: 'fixture-only', receiptId: `fixture:${event.id}` } },
  }
  assert.equal(fixtureOnlyMock.mode, 'test-mock')
  const mocked = await fixtureOnlyMock.publish(observation(), binding())
  assert.deepEqual(mocked, { status: 'mock-only', label: 'fixture-only', receiptId: 'fixture:observation-1' })
  assert.equal(calls, 1)
})

test('consent binding and observations round-trip without adding identity or credentials', () => {
  let state = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(state, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (queued.ok) state = queued.state
  const serialized = JSON.stringify(state)
  assert.equal(serialized.includes('email'), false)
  assert.equal(serialized.includes('token'), false)
  assert.deepEqual(readMilestoneSync(JSON.parse(serialized)), state)
})

test('fixture-only receipt remains bounded and round-trips after mock acknowledgement', () => {
  let state = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(state, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (!queued.ok) return
  const leased = leaseNextMilestone(queued.state, binding(), contract, 1100)
  assert.equal(leased.ok, true)
  if (!leased.ok) return
  const mocked = recordMilestoneResult(leased.state, 'observation-1', 1, leased.entry.attemptVersion, { status: 'mock-only', label: 'fixture-only', receiptId: 'x'.repeat(187) })
  assert.equal(mocked.ok && mocked.entry.receiptId?.length, 200)
  assert.deepEqual(JSON.parse(JSON.stringify(readMilestoneSync(JSON.parse(JSON.stringify(mocked.state))))), JSON.parse(JSON.stringify(mocked.state)))
})

test('malformed publisher outputs are refused without throwing or mutating leased state', () => {
  const consented = setMilestoneConsent(emptyMilestoneSync(), binding())
  const queued = enqueueMilestone(consented, binding(), observation(), 1000)
  assert.equal(queued.ok, true)
  if (!queued.ok) return
  const leased = leaseNextMilestone(queued.state, binding(), contract, 1100)
  assert.equal(leased.ok, true)
  if (!leased.ok) return
  for (const result of [
    { status: 'accepted', receiptId: 'x'.repeat(201) },
    { status: 'mock-only', label: 'fixture-only', receiptId: 'x'.repeat(188) },
    { status: 'accepted', receiptId: 'valid', privateData: 'unexpected' },
    null,
  ]) {
    const refused = recordMilestoneResult(leased.state, 'observation-1', 1, leased.entry.attemptVersion, result)
    assert.equal(codeOf(refused), 'invalid_publisher_result')
    assert.equal(refused.state.outbox[0]?.state, 'leased')
  }
})
