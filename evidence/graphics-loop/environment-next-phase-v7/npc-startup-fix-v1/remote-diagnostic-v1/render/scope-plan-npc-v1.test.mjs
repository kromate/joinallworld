import assert from 'node:assert/strict'
import test from 'node:test'
import { capturesForScope, CAPTURE_METHODS, LIMITS, REVIEW_SCOPES, validateCanonicalSnapshot } from './scope-plan-npc-v1.mjs'

test('Market and Beach each run a Home control and one target for each capture method', () => {
  assert.equal(Object.keys(REVIEW_SCOPES).length, 6)
  for (const place of ['market', 'beach']) for (const method of Object.keys(CAPTURE_METHODS)) {
    const rows = capturesForScope(`${place}-${method}`)
    assert.deepEqual(rows.map(row => row.role), ['home-control', 'target'])
    assert.equal(rows[0].place, 'home')
    assert.equal(rows[1].place, place)
    assert.equal(rows[0].method, method)
    assert.equal(rows[1].method, method)
  }
})

test('Target acceptance fails closed on fallback actors and accepts exact canonical crowd counters', () => {
  const snapshot = {
    fixture: { place: 'market', time: 'day', requestedPublicCrowd: 12 },
    readiness: { status: 'READY_CANONICAL' },
    capture: { validForSceneReview: true, validForCanonicalVisualReview: true },
    host: { location: 'market', avatarRendering: 'canonical', canonicalBodyEligible: true,
      drawCalls: 45, triangles: 90000, geometries: 12,
      crowdRendering: { desired: 12, canonical: 12, procedural: 0, loading: 0 },
      authoredPeople: { desired: 6, captured: 6, canonical: 6, procedural: 0, loading: 0 } },
  }
  assert.equal(validateCanonicalSnapshot(snapshot, { place: 'market', time: 'day' }, { requireCrowd: true }).valid, true)
  snapshot.host.crowdRendering.canonical = 11
  snapshot.host.crowdRendering.procedural = 1
  const failed = validateCanonicalSnapshot(snapshot, { place: 'market', time: 'day' }, { requireCrowd: true })
  assert.equal(failed.valid, false)
  assert.ok(failed.reasons.some(reason => reason.includes('12/12 canonical')))
})

test('Strict remote limits preserve the existing resource envelope', () => {
  assert.equal(LIMITS.ownedProcessGroupRssBytes, 2 * 1024 * 1024 * 1024)
  assert.equal(LIMITS.nodeOldSpaceMiB, 96)
  assert.equal(LIMITS.timeoutSeconds, 60)
  assert.equal(LIMITS.maxParallel, 3)
  assert.equal(LIMITS.screenshotTimeoutMs, 7000)
})
