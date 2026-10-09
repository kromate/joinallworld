import assert from 'node:assert/strict'
import test from 'node:test'
import { validateStartupAttestation } from './startup-attestation-npc-v4.mjs'

const integrationPath = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-local-integration.json'
const receiptPath = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-integrated-startup-tests.json'
const logPath = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-integrated-startup-tests.log'
const runtime = ['src/venue-world.ts', 'src/scene/body/startup-gate.ts']
const testSource = 'src/scene/body/startup-gate.test.ts'
const applied = Object.fromEntries([...runtime, testSource].map((path, i) => [path, `hash-${i}`]))
const sourcePinsByPath = new Map([
  ...Object.entries(applied), [integrationPath, 'integration-hash'], [receiptPath, 'receipt-hash'], [logPath, 'log-hash'],
])
const attestationHashes = new Map([[integrationPath, 'integration-hash'], [receiptPath, 'receipt-hash'], [logPath, 'log-hash']])
const integration = { status: 'local-runtime-fix-applied-not-remotely-accepted', applied }
const testReceipt = { status: 'completed', exitCode: 0, command: ['node', '--max-old-space-size=32', '--experimental-strip-types', '--test', testSource] }
const testLog = '# tests 5\n# suites 0\n# pass 5\n# fail 0\n'
const compileConsumedInputs = runtime.map(path => ({ path, sha256: applied[path] }))
const validInput = () => ({ sourcePinsByPath, attestationHashes, integration, testReceipt, testLog, compileConsumedInputs })

test('accepts runtime compile proof and separate 5/5 focused-test proof', () => {
  assert.deepEqual(validateStartupAttestation(validInput()), { runtimeCompiled: runtime, focusedTest: testSource, focusedTestsPassed: 5, focusedTestsFailed: 0 })
})

test('rejects a missing runtime compile input', () => {
  const input = validInput()
  input.compileConsumedInputs = input.compileConsumedInputs.slice(1)
  assert.throws(() => validateStartupAttestation(input), /did not consume/)
})

test('rejects a changed focused-test source hash', () => {
  const input = validInput()
  input.sourcePinsByPath = new Map(input.sourcePinsByPath).set(testSource, 'changed')
  assert.throws(() => validateStartupAttestation(input), /Focused-test source/)
})

test('rejects an incomplete or different test command', () => {
  const input = validInput()
  input.testReceipt = { ...testReceipt, command: ['node', '--test', testSource] }
  assert.throws(() => validateStartupAttestation(input), /command/)
})

test('rejects a test log that does not prove all five pass', () => {
  const input = validInput()
  input.testLog = '# tests 5\n# suites 0\n# pass 4\n# fail 1\n'
  assert.throws(() => validateStartupAttestation(input), /5\/5/)
})

test('rejects a tampered root-attestation file', () => {
  const input = validInput()
  input.attestationHashes = new Map(input.attestationHashes).set(logPath, 'tampered')
  assert.throws(() => validateStartupAttestation(input), /bytes differ/)
})

test('does not misclassify the focused test as an app compile input', () => {
  const input = validInput()
  input.compileConsumedInputs = [...input.compileConsumedInputs, { path: testSource, sha256: applied[testSource] }]
  assert.throws(() => validateStartupAttestation(input), /not required as an application compile input/)
})
