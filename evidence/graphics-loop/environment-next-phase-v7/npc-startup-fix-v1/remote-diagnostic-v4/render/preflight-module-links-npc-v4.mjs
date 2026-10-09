import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { capturesForScope, CAPTURE_METHODS, LIMITS, REVIEW_SCOPES, validateCanonicalSnapshot, validateCaptureSnapshot, persistCaptureProgress } from './scope-plan-npc-v4.mjs'
import { waitForSceneSnapshot, waitForReadinessReceipt, persistCaptureReceipt } from './remote-control-npc-v4.mjs'
import { validatePackageSelection, PINNED_CPU_RUN_ID, PINNED_CPU_COMMIT, PINNED_CPU_ARTIFACT } from './package-selection-npc-v4.mjs'
import { assertOwnedResultDirectory } from './result-dir-contract-npc-v4.mjs'
import { validateStartupAttestation } from './startup-attestation-npc-v4.mjs'

for (const fn of [capturesForScope, validateCanonicalSnapshot, validateCaptureSnapshot, persistCaptureProgress, waitForSceneSnapshot, waitForReadinessReceipt, persistCaptureReceipt, validatePackageSelection, assertOwnedResultDirectory, validateStartupAttestation]) assert.equal(typeof fn, 'function')
assert.equal(Object.keys(CAPTURE_METHODS).length, 3)
assert.equal(Object.keys(REVIEW_SCOPES).length, 6)
assert.deepEqual(Object.keys(REVIEW_SCOPES).sort(), ['beach-canvas-clip','beach-surface-false','beach-surface-true','market-canvas-clip','market-surface-false','market-surface-true'])
assert.equal(Object.values(REVIEW_SCOPES).reduce((n, scope) => n + capturesForScope(`${scope.place}-${scope.method}`).length, 0), 12)
assert.deepEqual(validatePackageSelection({ runId: PINNED_CPU_RUN_ID, commit: PINNED_CPU_COMMIT, artifact: PINNED_CPU_ARTIFACT }), { runId: PINNED_CPU_RUN_ID, commit: PINNED_CPU_COMMIT, artifact: PINNED_CPU_ARTIFACT })
assert.throws(() => validatePackageSelection({ runId: '37911271948', commit: PINNED_CPU_COMMIT, artifact: PINNED_CPU_ARTIFACT }))
assert.equal(LIMITS.ownedProcessGroupRssBytes, 2 * 1024 * 1024 * 1024)
assert.equal(LIMITS.nodeOldSpaceMiB, 96)
assert.equal(LIMITS.timeoutSeconds, 60)
assert.equal(LIMITS.maxParallel, 3)
const child = spawnSync(process.execPath, [new URL('./review-render-cdp-npc-v4.mjs', import.meta.url).pathname, '0'.repeat(64)], { encoding: 'utf8', env: { ...process.env, RESULT_DIR: '', REVIEW_SCOPE: 'market-surface-true' }, timeout: 5000 })
assert.notEqual(child.status, 0)
assert.match(child.stderr, process.platform === 'linux' ? /RESULT_DIR must be an absolute per-run output directory/ : /Remote render review is Linux-only/)
process.stdout.write(JSON.stringify({ status: 'NPC_V4_MODULE_AND_SCOPE_PREFLIGHT_PASS_NO_BROWSER', cpuRun: PINNED_CPU_RUN_ID, cpuCommit: PINNED_CPU_COMMIT, scopes: Object.keys(REVIEW_SCOPES).length, methods: Object.keys(CAPTURE_METHODS).length, captures: 12 }) + '\n')
