import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePackageSelection } from './package-selection-npc-v1.mjs'

test('package selection requires a run/commit pair and derived artifact name', () => {
  const runId = '37999999999', commit = 'a'.repeat(40), artifact = `environment-npc-startup-fix-v1-package-v1-${runId}`
  assert.equal(validatePackageSelection({ runId, commit, artifact, pinsCommit: commit }).runId, runId)
  assert.throws(() => validatePackageSelection({ runId, commit, artifact: `${artifact}-stale`, pinsCommit: commit }))
  assert.throws(() => validatePackageSelection({ runId, commit, artifact, pinsCommit: 'b'.repeat(40) }))
})
