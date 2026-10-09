import assert from 'node:assert/strict'
import test from 'node:test'
import { expectedPackageArtifact, validatePackageSelection } from './package-selection-sofa-v5.mjs'

test('candidate package selector is constrained to its positive workflow run', () => {
  const runId = '123456789', commit = 'a'.repeat(40), artifact = 'environment-sofa-upholstery-cpu-v5-123456789'
  assert.equal(expectedPackageArtifact(runId), artifact)
  assert.deepEqual(validatePackageSelection({ runId, commit, artifact }), { runId, commit, artifact })
  assert.throws(() => expectedPackageArtifact('../123'), /positive numeric/)
  assert.throws(() => validatePackageSelection({ runId, commit: 'bad', artifact }), /40-character/)
  assert.throws(() => validatePackageSelection({ runId, commit, artifact: 'wrong' }), /does not match/)
})
