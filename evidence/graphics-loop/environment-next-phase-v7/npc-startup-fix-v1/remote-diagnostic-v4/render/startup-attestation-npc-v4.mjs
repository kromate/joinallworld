const INTEGRATION_PATH = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-local-integration.json'
const TEST_RECEIPT_PATH = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-integrated-startup-tests.json'
const TEST_LOG_PATH = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/root-integrated-startup-tests.log'
const RUNTIME_PATHS = ['src/venue-world.ts', 'src/scene/body/startup-gate.ts']
const TEST_SOURCE_PATH = 'src/scene/body/startup-gate.test.ts'
const TEST_COMMAND = ['node', '--max-old-space-size=32', '--experimental-strip-types', '--test', TEST_SOURCE_PATH]

function requireValue(value, message) {
  if (!value) throw new Error(message)
}

/**
 * Validate two distinct proofs: the runtime patch was compiled into the app,
 * while the focused test source was separately pinned and executed 5/5.
 */
export function validateStartupAttestation({ sourcePinsByPath, attestationHashes, integration, testReceipt, testLog, compileConsumedInputs }) {
  const requiredAttestations = [INTEGRATION_PATH, TEST_RECEIPT_PATH, TEST_LOG_PATH]
  for (const relative of requiredAttestations) {
    const pinned = sourcePinsByPath.get(relative)
    requireValue(typeof pinned === 'string', `CPU source pins omit startup attestation: ${relative}`)
    requireValue(attestationHashes.get(relative) === pinned, `Startup attestation bytes differ from CPU source pins: ${relative}`)
  }

  requireValue(integration?.status === 'local-runtime-fix-applied-not-remotely-accepted', 'Startup integration status is not the expected local-only status')
  const applied = integration.applied
  requireValue(applied && typeof applied === 'object' && !Array.isArray(applied), 'Startup integration has no applied-source map')
  const expectedApplied = [...RUNTIME_PATHS, TEST_SOURCE_PATH].sort()
  requireValue(JSON.stringify(Object.keys(applied).sort()) === JSON.stringify(expectedApplied), 'Startup integration source list is incomplete or unexpected')

  const compiledByPath = new Map(compileConsumedInputs.map(item => [item.path, item.sha256]))
  for (const relative of RUNTIME_PATHS) {
    const expected = applied[relative]
    requireValue(typeof expected === 'string' && sourcePinsByPath.get(relative) === expected, `Runtime source does not match the sealed CPU source: ${relative}`)
    requireValue(compiledByPath.get(relative) === expected, `CPU app did not consume the attested runtime source: ${relative}`)
  }

  const testHash = applied[TEST_SOURCE_PATH]
  requireValue(typeof testHash === 'string' && sourcePinsByPath.get(TEST_SOURCE_PATH) === testHash, 'Focused-test source does not match the sealed CPU source')
  requireValue(!compiledByPath.has(TEST_SOURCE_PATH), 'Focused-test source must be validated as a test input, not required as an application compile input')
  requireValue(Array.isArray(testReceipt?.command) && JSON.stringify(testReceipt.command) === JSON.stringify(TEST_COMMAND), 'Focused-test receipt command does not match the expected bounded test invocation')
  requireValue(testReceipt.status === 'completed' && testReceipt.exitCode === 0, 'Focused startup-gate test did not complete successfully')
  requireValue(typeof testLog === 'string' && /# tests 5\s*\n# suites 0\s*\n# pass 5\s*\n# fail 0/.test(testLog), 'Focused startup-gate test log does not prove 5/5 passing')

  return { runtimeCompiled: [...RUNTIME_PATHS], focusedTest: TEST_SOURCE_PATH, focusedTestsPassed: 5, focusedTestsFailed: 0 }
}

