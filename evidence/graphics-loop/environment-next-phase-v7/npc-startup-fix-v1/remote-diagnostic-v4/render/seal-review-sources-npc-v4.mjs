import { createHash } from 'node:crypto'
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const base = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v4/render'
const targets = [
  `${base}/README.md`, `${base}/review-render-cdp-npc-v4.mjs`, `${base}/run-bounded-linux-render-npc-v4.py`,
  `${base}/result-dir-contract-npc-v4.mjs`, `${base}/test-result-dir-contract-npc-v4.mjs`,
  `${base}/package-selection-npc-v4.mjs`, `${base}/test-package-selection-npc-v4.mjs`,
  `${base}/test-runner-contract-npc-v4.py`, `${base}/workflow-review-npc-v4.yml`,
  `${base}/preflight-package-artifact-npc-v4.mjs`,
  `${base}/startup-attestation-npc-v4.mjs`, `${base}/startup-attestation-npc-v4.test.mjs`,
  `${base}/seal-review-sources-npc-v4.mjs`, `${base}/preflight-module-links-npc-v4.mjs`, `${base}/scope-plan-npc-v4.mjs`, `${base}/scope-plan-npc-v4.test.mjs`,
  `${base}/remote-control-npc-v4.mjs`, `${base}/remote-control-npc-v4.test.mjs`,
]
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const files = []
for (const relative of targets.sort()) {
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(`${root}${path.sep}`) || !statSync(absolute).isFile()) throw new Error(`Invalid render source path ${relative}`)
  files.push({ path: relative, bytes: statSync(absolute).size, sha256: await hashFile(absolute) })
}
const payload = { schema: 'environment-next-phase-v7-npc-startup-remote-review-pins/4', status: 'PRE-REVIEW-SEALED',
  selectedPackage: { runId: '37911271949', commit: '0da02ca0f0e0c4350f2754615f58b2dcd6eaed37', artifact: 'environment-npc-startup-fix-v1-package-v1-37911271949' },
  limits: { ownedProcessGroupRssBytes: 2 * 1024 * 1024 * 1024, nodeOldSpaceMiB: 96, timeoutSeconds: 60, maxParallel: 3, screenshotTimeoutMs: 7000 },
  scopes: ['market-surface-true', 'market-surface-false', 'market-canvas-clip', 'beach-surface-true', 'beach-surface-false', 'beach-canvas-clip'],
  perScope: { screenshots: ['home-control', 'single target'], exactTargetCaptureAttempts: 1, peerTransitionsWithoutScreenshot: 1 },
  cpuSourceCheckout: { commit: '0da02ca0f0e0c4350f2754615f58b2dcd6eaed37', sourcePinsSha256: 'a09ae72bb74ff945317129d4fd5533b1695c4db21733a3f099f28cd6d9f8c719' }, files }
const output = path.resolve(root, `${base}/review-sources-npc-v4.json`)
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(`${output}\n`)
