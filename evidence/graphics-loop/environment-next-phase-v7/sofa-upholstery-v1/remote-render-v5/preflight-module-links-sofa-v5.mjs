import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { capturesForScope, LIMITS, persistCaptureProgress, persistLifecycleProgress, REVIEW_SCOPES, validateCaptureSnapshot } from './scope-plan-sofa-v5.mjs'
import { persistCaptureReceipt, waitForReadinessReceipt, waitForSceneSnapshot } from './remote-control-sofa-v5.mjs'
import { expectedPackageArtifact, validatePackageSelection } from './package-selection-sofa-v5.mjs'
import { assertOwnedResultDirectory } from './result-dir-contract-sofa-v5.mjs'

assert.equal(typeof persistCaptureProgress, 'function')
assert.equal(typeof persistLifecycleProgress, 'function')
assert.equal(typeof validateCaptureSnapshot, 'function')
assert.equal(typeof persistCaptureReceipt, 'function')
assert.equal(typeof waitForReadinessReceipt, 'function')
assert.equal(typeof waitForSceneSnapshot, 'function')
assert.equal(typeof expectedPackageArtifact, 'function')
assert.equal(typeof validatePackageSelection, 'function')
assert.equal(typeof assertOwnedResultDirectory, 'function')
assert.equal(LIMITS.ownedProcessGroupRssBytes, 2 * 1024 * 1024 * 1024)
assert.equal(LIMITS.timeoutSeconds, 60)
assert.equal(LIMITS.nodeOldSpaceMiB, 96)
assert.equal(LIMITS.maxParallel, 1)
assert.equal(expectedPackageArtifact('37910039601'), 'environment-sofa-upholstery-cpu-v5-37910039601')

const matrix = capturesForScope('sofa-home')
assert.equal(REVIEW_SCOPES['sofa-home'].kind, 'sofa-home')
assert.equal(matrix.length, 8, 'the comparison must retain all eight baseline/candidate × day/night × normal/close seated captures')
assert.equal(new Set(matrix.map(row => row.label)).size, 8, 'capture labels must be unique')
for (const variant of ['baseline', 'candidate']) for (const time of ['day', 'night']) for (const camera of ['normal', 'close']) {
  assert.ok(matrix.some(row => row.variant === variant && row.time === time && row.camera === camera && row.pose === 'sit' && row.place === 'home'))
}
const validPackage = validatePackageSelection({ runId: '37910039601', commit: 'a'.repeat(40), artifact: expectedPackageArtifact('37910039601') })
assert.equal(validPackage.runId, '37910039601')
assert.throws(() => validatePackageSelection({ runId: '37910039601', commit: 'a'.repeat(40), artifact: 'environment-sofa-upholstery-cpu-v1-37910039601' }))

// Import the whole controller in a child process. ESM resolves and links every static named
// import before evaluating its first guard. The expected guard exit proves module instantiation
// succeeded without opening Chrome or starting the local HTTP server.
const controller = fileURLToPath(new URL('./review-render-sofa-v5.mjs', import.meta.url))
const child = spawnSync(process.execPath, ['--max-old-space-size=32', controller, '0'.repeat(64)], {
  cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
  env: { ...process.env, RESULT_DIR: '', REVIEW_SCOPE: 'sofa-home' },
})
assert.equal(child.error, undefined, `controller link preflight process error: ${child.error ?? ''}`)
assert.notEqual(child.status, 0, 'controller must stop before starting without a result directory')
assert.doesNotMatch(child.stderr, /does not provide an export named|Cannot find module|ERR_MODULE_NOT_FOUND/)
assert.match(child.stderr, process.platform === 'linux' ? /RESULT_DIR must be an absolute per-run output directory/ : /Remote render review is Linux-only/)

process.stdout.write(JSON.stringify({ status: 'MODULE_LINK_AND_EIGHT_CAPTURE_PREFLIGHT_PASS_NO_BROWSER', captures: matrix.length,
  controllerInstantiation: 'all static imports linked; expected pre-server guard reached', limits: LIMITS }) + '\n')
