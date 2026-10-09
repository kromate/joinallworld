import assert from 'node:assert/strict'
import test from 'node:test'
import { PINNED_CPU_ARTIFACT, PINNED_CPU_COMMIT, PINNED_CPU_RUN_ID, PINNED_CPU_SOURCE_PINS_SHA, validatePackageSelection } from './package-selection-npc-v3.mjs'

test('selector accepts only the exact root-verified CPU package', () => {
  assert.equal(PINNED_CPU_SOURCE_PINS_SHA, 'a09ae72bb74ff945317129d4fd5533b1695c4db21733a3f099f28cd6d9f8c719')
  assert.deepEqual(validatePackageSelection({ runId: PINNED_CPU_RUN_ID, commit: PINNED_CPU_COMMIT, artifact: PINNED_CPU_ARTIFACT, pinsCommit: PINNED_CPU_COMMIT }),
    { runId: PINNED_CPU_RUN_ID, commit: PINNED_CPU_COMMIT, artifact: PINNED_CPU_ARTIFACT })
  assert.throws(() => validatePackageSelection({ runId: '37911271948', commit: PINNED_CPU_COMMIT, artifact: PINNED_CPU_ARTIFACT }), /root-verified/)
  assert.throws(() => validatePackageSelection({ runId: PINNED_CPU_RUN_ID, commit: '0'.repeat(40), artifact: PINNED_CPU_ARTIFACT }), /root-verified/)
  assert.throws(() => validatePackageSelection({ runId: PINNED_CPU_RUN_ID, commit: PINNED_CPU_COMMIT, pinsCommit: '0'.repeat(40), artifact: PINNED_CPU_ARTIFACT }), /root-verified/)
  assert.throws(() => validatePackageSelection({ runId: PINNED_CPU_RUN_ID, commit: PINNED_CPU_COMMIT, artifact: 'environment-npc-startup-fix-v1-package-v1-37911271948' }), /root-verified/)
})
