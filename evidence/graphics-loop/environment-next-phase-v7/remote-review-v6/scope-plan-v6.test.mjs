import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LIMITS, REVIEW_SCOPES, capturesForScope, persistCaptureProgress, persistLifecycleProgress, validateCaptureSnapshot } from './scope-plan-v6.mjs'

assert.deepEqual(capturesForScope('scene-pair-home-neighbourhood').map(({ place, time }) => `${place}/${time}`),
  ['home/day', 'home/night', 'neighbourhood/day', 'neighbourhood/night'])
assert.deepEqual(capturesForScope('scene-pair-market-beach').map(({ place, time }) => `${place}/${time}`),
  ['market/day', 'market/night', 'beach/day', 'beach/night'])
assert.equal(capturesForScope('lifecycle-only').length, 0)
assert.deepEqual(REVIEW_SCOPES['lifecycle-only'].actions, ['walk-request', 'dispose-rebuild', 'permanent-dispose'])
assert.equal(LIMITS.ownedProcessGroupRssBytes, 2147483648)
assert.equal(LIMITS.nodeOldSpaceMiB, 96)
assert.equal(LIMITS.timeoutSeconds, 60)
assert.equal(LIMITS.maxParallel, 3)

const valid = { fixture: { place: 'home', time: 'night' }, host: { location: 'home' }, capture: { validForSceneReview: true, validForCanonicalVisualReview: true }, readiness: { status: 'READY_CANONICAL' } }
assert.equal(validateCaptureSnapshot(valid, { place: 'home', time: 'night' }).valid, true)
assert.equal(validateCaptureSnapshot({ ...valid, capture: { validForSceneReview: false } }, { place: 'home', time: 'night' }).valid, false)
assert.equal(validateCaptureSnapshot({ ...valid, readiness: { status: 'PENDING' } }, { place: 'home', time: 'night' }).valid, false)
assert.equal(validateCaptureSnapshot({ ...valid, capture: { ...valid.capture, validForCanonicalVisualReview: false } }, { place: 'home', time: 'night' }).valid, false,
  'Home scene pair cannot waive an unknown/fallback current-body proof')

const dir = mkdtempSync(path.join(os.tmpdir(), 'graphics-v7-progress-'))
try {
  const receipt = { sequence: 1, label: 'home-night', valid: false, reasons: ['readiness pending'] }
  const progress = persistCaptureProgress(dir, receipt)
  assert.deepEqual(JSON.parse(readFileSync(progress, 'utf8').trim()), receipt)
  const lifecycle = persistLifecycleProgress(dir, { sequence: 1, action: 'walk-request', requestId: 7 })
  assert.equal(JSON.parse(readFileSync(lifecycle, 'utf8').trim()).requestId, 7)
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log('scoped remote review plan tests: PASS')
