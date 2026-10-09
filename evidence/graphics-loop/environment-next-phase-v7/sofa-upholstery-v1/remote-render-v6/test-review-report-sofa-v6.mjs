import assert from 'node:assert/strict'
import test from 'node:test'
import { capturesForScope } from './scope-plan-sofa-v6.mjs'
import { assembleSofaReviewSummary } from './review-report-sofa-v6.mjs'

test('an early invalid capture still produces an empty, serializable report summary', () => {
  const summary = assembleSofaReviewSummary({ expectedCaptures: capturesForScope('sofa-home'), captures: [], emittedEntryComparison: null })
  assert.equal(summary.matchedPairs.length, 4)
  assert.ok(summary.matchedPairs.every(pair => pair.baseline === null && pair.candidate === null && !pair.sameAvatarAnchor && !pair.sameSeatTarget))
  assert.equal(summary.emittedEntryComparison, null)
  assert.doesNotThrow(() => JSON.stringify(summary))
})

test('matched sofa report pairs preserve only actual matching captures and their counters', () => {
  const [base] = capturesForScope('sofa-home').filter(row => row.variant === 'baseline')
  const candidateLabel = `sofa-candidate-${base.time}-${base.camera}-${base.pose}`
  const sofaSeatTarget = { itemId: 'family-sofa', placement: { id: 'host-sofa', x: 2, y: 1, rot: 0 } }
  const captures = [
    { label: base.label, file: 'base.png', host: { avatar: { x: 1, y: 0, z: 2 }, drawCalls: 12, triangles: 300, geometries: 8 }, fixture: { sofaSeatTarget }, geometryStorage: { cpuAttributeAndIndexBytes: 100 } },
    { label: candidateLabel, file: 'candidate.png', host: { avatar: { x: 1, y: 0, z: 2 }, drawCalls: 12, triangles: 304, geometries: 8 }, fixture: { sofaSeatTarget }, geometryStorage: { cpuAttributeAndIndexBytes: 116 } },
  ]
  const pair = assembleSofaReviewSummary({ expectedCaptures: [base], captures }).matchedPairs[0]
  assert.equal(pair.sameAvatarAnchor, true)
  assert.equal(pair.sameSeatTarget, true)
  assert.deepEqual(pair.counterDelta, { drawCalls: 0, triangles: 4, geometries: 0, cpuGeometryBytes: 16 })
})
