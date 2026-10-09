import assert from 'node:assert/strict'
import test from 'node:test'
import { expectedPackageArtifact, validatePackageSelection } from './package-selection-sofa-v6.mjs'

test('candidate package selector accepts only the frozen successful v5 CPU artifact', () => {
  const runId = '37914543927', commit = '10b383754b68c758ba002bb9fbe1e5f5fe668511', artifact = 'environment-sofa-upholstery-cpu-v5-37914543927'
  assert.equal(expectedPackageArtifact(runId), artifact)
  assert.deepEqual(validatePackageSelection({ runId, commit, artifact }), { runId, commit, artifact })
  assert.throws(() => expectedPackageArtifact('123456789'), /sealed successful/)
  assert.throws(() => validatePackageSelection({ runId, commit: 'a'.repeat(40), artifact }), /exact frozen successful/)
  assert.throws(() => validatePackageSelection({ runId, commit, artifact: 'wrong' }), /does not match/)
})
