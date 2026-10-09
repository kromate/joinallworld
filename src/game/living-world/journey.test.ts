import test from 'node:test'
import assert from 'node:assert/strict'
import { awardQualification, checkPermission, issuePermission, offerDelivery, revokePermission, revokeQualification, sanitizeJourneyState, transitionDelivery } from './journey.ts'
import type { JourneyState, ProximityEvidence } from './journey.ts'

const empty = (): JourneyState => sanitizeJourneyState(null)
const offer = (state = empty(), expiresAt = 50_000) => offerDelivery(state, {
  id: 'parcel-1', city: 'lagos', origin: 'depot-1', destination: 'shop-1', product: 'rice', quantity: 3,
  reward: 120, offeredBy: 'dispatch', expiresAt,
}, 1_000)
const step = (state: JourneyState, operation: 'accept' | 'collect' | 'deliver' | 'cancel' | 'expire', actor: string, version: number, at: number, proximity?: ProximityEvidence) => transitionDelivery(state, { deliveryId: 'parcel-1', operation, actor, expectedVersion: version, at, ...(proximity ? { proximity } : {}) })

test('sanitizer bounds maps and discards malformed untrusted records', () => {
  const qualifications = { malformed0: null, malformed1: { id: 'wrong' }, q0: { id: 'q0', version: 1, evidenceJourneyId: 'j0', earnedAt: 0, status: 'active', extra: 'ignored' } }
  const state = sanitizeJourneyState({ qualifications, permissions: { broken: { id: 'broken', actor: {}, status: 'active' } }, deliveries: { bad: { id: 'bad', version: -1 } } })
  assert.equal(Object.keys(state.qualifications).length, 1)
  assert.equal(state.qualifications.q0?.status, 'active')
  assert.equal('extra' in (state.qualifications.q0 ?? {}), false)
  assert.deepEqual(state.permissions, {})
  assert.deepEqual(state.deliveries, {})
  const malformed = sanitizeJourneyState({
    permissions: {
      late: { id: 'late', actor: 'p', resourceId: 'car', scope: 'drive', issuedAt: 10, expiresAt: 9, status: 'active' },
      malformedQualification: { id: 'malformedQualification', actor: 'p', resourceId: 'car', scope: 'drive', issuedAt: 1, expiresAt: null, status: 'active', qualificationId: {}, },
    },
    deliveries: {
      noCarrier: { id: 'noCarrier', version: 2, city: 'lagos', origin: 'depot', destination: 'shop', product: 'rice', quantity: 1, reward: 1, offeredBy: 'dispatch', carrier: null, expiresAt: 20, status: 'accepted' },
      lateCollect: { id: 'lateCollect', version: 2, city: 'lagos', origin: 'depot', destination: 'shop', product: 'rice', quantity: 1, reward: 1, offeredBy: 'dispatch', carrier: 'p', expiresAt: 20, collectedAt: 21, status: 'collected' },
    },
  })
  assert.deepEqual(malformed.permissions, {})
  assert.deepEqual(malformed.deliveries, {})
})

test('oversized raw maps fail closed so later terminal rows are not silently truncated', () => {
  const terminal = { id: 'settled', version: 4, city: 'lagos', origin: 'depot', destination: 'shop', product: 'rice', quantity: 2, reward: 20, offeredBy: 'dispatch', carrier: 'player', expiresAt: 30_000, collectedAt: 10_000, status: 'delivered' }
  const withinLimit: Record<string, unknown> = { bad0: { id: 'mismatch' }, bad1: { id: 'mismatch' }, bad2: { id: 'mismatch' }, settled: terminal }
  assert.equal(sanitizeJourneyState({ deliveries: withinLimit }).deliveries.settled?.status, 'delivered')
  const oversized: Record<string, unknown> = {}
  for (let i = 0; i < 128; i++) oversized[`bad${i}`] = { id: 'mismatch' }
  oversized.settled = terminal
  const original = JSON.stringify(oversized)
  assert.throws(() => sanitizeJourneyState({ deliveries: oversized }), /quarantine the unchanged source record/)
  assert.equal(JSON.stringify(oversized), original)
  assert.equal((oversized.settled as typeof terminal).status, 'delivered')
})

test('own-key checks ignore inherited and reserved object properties', () => {
  const ghost = { id: 'ghost', actor: 'player', resourceId: 'car', scope: 'drive', issuedAt: 0, expiresAt: null, status: 'active' }
  const permissions = Object.assign(Object.create({ ghost }), { constructor: ghost })
  const state = sanitizeJourneyState({ permissions })
  assert.deepEqual(state.permissions, {})
  assert.equal(checkPermission({ ...empty(), permissions: permissions as JourneyState['permissions'] }, { permissionId: 'ghost', actor: 'player', resourceId: 'car', scope: 'drive', at: 0 }).ok, false)
  assert.equal(issuePermission(empty(), { id: '__proto__', actor: 'p', resourceId: 'car', scope: 'drive', issuedAt: 0, expiresAt: null }).code, 'invalid_permission')
})

test('capacity refusals retain existing qualifications, permissions and terminal deliveries', () => {
  let state = empty()
  for (let i = 0; i < 64; i++) {
    const result = awardQualification(state, { id: `q${i}`, version: 1, evidenceJourneyId: `e${i}`, earnedAt: i })
    assert.equal(result.ok, true); if (!result.ok) return; state = result.state
  }
  assert.equal(awardQualification(state, { id: 'q64', version: 1, evidenceJourneyId: 'e64', earnedAt: 64 }).code, 'qualification_capacity')
  for (let i = 0; i < 128; i++) {
    const result = issuePermission(state, { id: `g${i}`, actor: 'p', resourceId: `r${i}`, scope: 'practice', issuedAt: 0, expiresAt: null })
    assert.equal(result.ok, true); if (!result.ok) return; state = result.state
  }
  assert.equal(issuePermission(state, { id: 'g128', actor: 'p', resourceId: 'r', scope: 'practice', issuedAt: 0, expiresAt: null }).code, 'permission_capacity')
  for (let i = 0; i < 128; i++) {
    const made = offerDelivery(state, { id: `d${i}`, city: 'lagos', origin: 'depot', destination: 'shop', product: 'rice', quantity: 1, reward: 0, offeredBy: 'dispatch', expiresAt: 50_000 }, 1_000)
    assert.equal(made.ok, true); if (!made.ok) return; state = made.state
    if (i === 0) { const ended = transitionDelivery(state, { deliveryId: 'd0', operation: 'cancel', actor: 'dispatch', expectedVersion: 1, at: 2_000 }); assert.equal(ended.ok, true); if (ended.ok) state = ended.state }
  }
  assert.equal(offerDelivery(state, { id: 'd128', city: 'lagos', origin: 'depot', destination: 'shop', product: 'rice', quantity: 1, reward: 0, offeredBy: 'dispatch', expiresAt: 50_000 }, 1_000).code, 'delivery_capacity')
  const loaded = sanitizeJourneyState(state)
  assert.equal(loaded.qualifications.q0?.evidenceJourneyId, 'e0')
  assert.equal(loaded.permissions.g0?.resourceId, 'r0')
  assert.equal(loaded.deliveries.d0?.status, 'cancelled')
  assert.equal(Object.keys(loaded.deliveries).length, 128)
})

test('permission checks exact actor, resource, scope, expiry and current qualification independently of ownership', () => {
  const qualified = awardQualification(empty(), { id: 'driver', version: 2, evidenceJourneyId: 'road-test-1', earnedAt: 2_000 })
  assert.equal(qualified.ok, true)
  if (!qualified.ok) return
  const granted = issuePermission(qualified.state, { id: 'rental-grant', actor: 'player', resourceId: 'rental-car', scope: 'drive', issuedAt: 2_000, expiresAt: 10_000, qualificationId: 'driver', qualificationVersion: 2 })
  assert.equal(granted.ok, true)
  if (!granted.ok) return
  assert.deepEqual(checkPermission(granted.state, { permissionId: 'rental-grant', actor: 'player', resourceId: 'rental-car', scope: 'drive', at: 9_999 }), { ok: true, code: 'allowed' })
  assert.equal(checkPermission(granted.state, { permissionId: 'rental-grant', actor: 'player', resourceId: 'rental-car', scope: 'drive', at: 1_999 }).code, 'permission_not_yet_issued')
  assert.equal(checkPermission(granted.state, { permissionId: 'rental-grant', actor: 'other', resourceId: 'rental-car', scope: 'drive', at: 3_000 }).code, 'permission_scope')
  assert.equal(checkPermission(granted.state, { permissionId: 'rental-grant', actor: 'player', resourceId: 'another-car', scope: 'drive', at: 3_000 }).code, 'permission_scope')
  assert.equal(checkPermission(granted.state, { permissionId: 'rental-grant', actor: 'player', resourceId: 'rental-car', scope: 'drive', at: 10_000 }).code, 'permission_expired')
  const revoked = revokeQualification(granted.state, 'driver')
  assert.equal(revoked.ok, true)
  if (revoked.ok) assert.equal(checkPermission(revoked.state, { permissionId: 'rental-grant', actor: 'player', resourceId: 'rental-car', scope: 'drive', at: 3_000 }).code, 'qualification_required')
  const revokedGrant = revokePermission(granted.state, 'rental-grant')
  assert.equal(revokedGrant.ok, true)
  if (revokedGrant.ok) assert.equal(checkPermission(revokedGrant.state, { permissionId: 'rental-grant', actor: 'player', resourceId: 'rental-car', scope: 'drive', at: 3_000 }).code, 'permission_revoked')
})

test('payload extras cannot override qualification status and operations leave input state unchanged', () => {
  const before = empty()
  const value = { id: 'driver', version: 1, evidenceJourneyId: 'test', earnedAt: 1, status: 'revoked', extra: 'discard' } as unknown as { id: string; version: number; evidenceJourneyId: string; earnedAt: number }
  const result = awardQualification(before, value)
  assert.equal(result.ok, true)
  assert.deepEqual(before, empty())
  if (result.ok) { assert.equal(result.state.qualifications.driver?.status, 'active'); assert.equal('extra' in (result.state.qualifications.driver ?? {}), false) }
  const grant = issuePermission(before, { id: 'grant', actor: 'p', resourceId: 'car', scope: 'practice', issuedAt: 1, expiresAt: null, extra: 'discard', status: 'revoked' } as unknown as { id: string; actor: string; resourceId: string; scope: string; issuedAt: number; expiresAt: null })
  assert.equal(grant.ok, true)
  if (grant.ok) { assert.equal(grant.state.permissions.grant?.status, 'active'); assert.equal('extra' in (grant.state.permissions.grant ?? {}), false) }
  const parcel = offer(before)
  assert.equal(parcel.ok, true)
  assert.equal(before.deliveries['parcel-1'], undefined)
})

test('practice permission has no ownership, price or collateral prerequisite', () => {
  const result = issuePermission(empty(), { id: 'practice', actor: 'new-player', resourceId: 'npc-car', scope: 'practice', issuedAt: 1_000, expiresAt: null })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(checkPermission(result.state, { permissionId: 'practice', actor: 'new-player', resourceId: 'npc-car', scope: 'practice', at: 1_001 }), { ok: true, code: 'allowed' })
})

test('delivery freezes terms and emits stock/reward description only on first delivered transition', () => {
  const opened = offer()
  assert.equal(opened.ok, true)
  if (!opened.ok) return
  const accepted = step(opened.state, 'accept', 'carrier', 1, 2_000)
  assert.equal(accepted.ok, true)
  if (!accepted.ok) return
  assert.equal(step(accepted.state, 'collect', 'intruder', 2, 3_000).code, 'wrong_carrier')
  const origin: ProximityEvidence = { deliveryId: 'parcel-1', actor: 'carrier', place: 'origin', at: 3_000, verified: true }
  assert.equal(step(accepted.state, 'collect', 'carrier', 1, 3_000, origin).code, 'version_conflict')
  const collected = step(accepted.state, 'collect', 'carrier', 2, 3_000, origin)
  assert.equal(collected.ok, true)
  if (!collected.ok) return
  const destination: ProximityEvidence = { deliveryId: 'parcel-1', actor: 'carrier', place: 'destination', at: 4_000, verified: true }
  const delivered = step(collected.state, 'deliver', 'carrier', 3, 4_000, destination)
  assert.equal(delivered.ok, true)
  if (!delivered.ok) return
  assert.deepEqual(delivered.effect, { deliveryId: 'parcel-1', eventId: 'delivery:parcel-1:4', stockDelta: { product: 'rice', units: 3 }, reward: 120 })
  assert.equal(delivered.state.deliveries['parcel-1']?.status, 'delivered')
  const reloaded = sanitizeJourneyState(delivered.state)
  assert.equal(step(reloaded, 'deliver', 'carrier', 4, 5_000, destination).code, 'delivery_terminal')
  assert.equal(step(reloaded, 'deliver', 'carrier', 4, 5_000, destination).ok, false, 'a fresh transport request cannot replay the terminal effect')
  assert.equal(delivered.effect?.reward, 120, 'the helper describes a simulated reward; it does not change a wallet')
})

test('cancel wins a stale delivery race and expiry makes an active parcel terminal', () => {
  const opened = offer()
  assert.equal(opened.ok, true)
  if (!opened.ok) return
  const accepted = step(opened.state, 'accept', 'carrier', 1, 2_000)
  assert.equal(accepted.ok, true)
  if (!accepted.ok) return
  const cancelled = step(accepted.state, 'cancel', 'dispatch', 2, 3_000)
  assert.equal(cancelled.ok, true)
  if (cancelled.ok) {
    assert.equal(cancelled.state.deliveries['parcel-1']?.status, 'cancelled')
    assert.equal(cancelled.state.deliveries['parcel-1']?.version, 3)
    const stale = step(cancelled.state, 'deliver', 'carrier', 2, 4_000)
    assert.equal(stale.code, 'version_conflict')
    assert.equal(stale.state, cancelled.state)
    assert.equal('effect' in stale, false)
    const terminal = step(cancelled.state, 'deliver', 'carrier', 3, 4_000)
    assert.equal(terminal.code, 'delivery_terminal')
    assert.equal(terminal.state, cancelled.state)
    assert.equal('effect' in terminal, false)
  }
  const expired = step(accepted.state, 'accept', 'carrier', 2, 50_000)
  assert.equal(expired.ok, true)
  if (expired.ok) {
    assert.equal(expired.state.deliveries['parcel-1']?.status, 'expired')
    assert.equal('effect' in expired, false)
  }
})
