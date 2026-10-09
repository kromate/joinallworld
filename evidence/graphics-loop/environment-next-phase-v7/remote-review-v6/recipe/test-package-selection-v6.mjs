import assert from 'node:assert/strict'
import { expectedPackageArtifact, validatePackageSelection } from './package-selection-v6.mjs'
import { REVIEW_SCOPES, capturesForScope, LIMITS } from '../scope-plan-v6.mjs'

const runId = '123456789'
const commit = 'a'.repeat(40)
const artifact = 'environment-whole-slice-v7-package-v3-123456789'
assert.equal(expectedPackageArtifact(runId), artifact)
assert.deepEqual(validatePackageSelection({ runId, commit, artifact }), { runId, commit, artifact })
assert.throws(() => expectedPackageArtifact('../123'), /positive numeric/)
assert.throws(() => validatePackageSelection({ runId, commit: 'bad', artifact }), /40-character/)
assert.throws(() => validatePackageSelection({ runId, commit, artifact: 'old-package' }), /does not match/)
const scenes = ['home/day', 'home/night', 'neighbourhood/day', 'neighbourhood/night', 'market/day', 'market/night', 'beach/day', 'beach/night']
const planned = [...capturesForScope('scene-pair-home-neighbourhood'), ...capturesForScope('scene-pair-market-beach')].map(({ place, time }) => `${place}/${time}`)
assert.deepEqual([...planned].sort(), [...scenes].sort())
assert.equal(capturesForScope('lifecycle-only').length, 0)
assert.equal(REVIEW_SCOPES['lifecycle-only'].kind, 'lifecycle-only')
assert.deepEqual(LIMITS, { ownedProcessGroupRssBytes: 2147483648, nodeOldSpaceMiB: 96, timeoutSeconds: 60, maxParallel: 3 })
console.log('package artifact and complete v7 review scope contracts: PASS')
