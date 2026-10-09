import { createHash } from 'node:crypto'
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const base = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v1/render'
const targets = [
  `${base}/README.md`, `${base}/review-render-cdp-npc-v1.mjs`, `${base}/run-bounded-linux-render-npc-v1.py`,
  `${base}/result-dir-contract-npc-v1.mjs`, `${base}/test-result-dir-contract-npc-v1.mjs`,
  `${base}/package-selection-npc-v1.mjs`, `${base}/test-package-selection-npc-v1.mjs`,
  `${base}/test-runner-contract-npc-v1.py`, `${base}/workflow-review-npc-v1.yml`,
  `${base}/seal-review-sources-npc-v1.mjs`, `${base}/scope-plan-npc-v1.mjs`, `${base}/scope-plan-npc-v1.test.mjs`,
  `${base}/remote-control-npc-v1.mjs`, `${base}/remote-control-npc-v1.test.mjs`,
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
const payload = { schema: 'environment-next-phase-v7-npc-startup-remote-review-pins/1', status: 'PRE-REVIEW-SEALED',
  selectedPackagePolicy: 'workflow_dispatch run ID and commit must resolve to this exact artifact-name scheme; controller verifies package source seal gitCommit and every source/output hash before launch',
  limits: { ownedProcessGroupRssBytes: 2 * 1024 * 1024 * 1024, nodeOldSpaceMiB: 96, timeoutSeconds: 60, maxParallel: 3, screenshotTimeoutMs: 7000 },
  scopes: ['market-surface-true', 'market-surface-false', 'market-canvas-clip', 'beach-surface-true', 'beach-surface-false', 'beach-canvas-clip'],
  perScope: { screenshots: ['home-control', 'single target'], exactTargetCaptureAttempts: 1, peerTransitionsWithoutScreenshot: 1 }, files }
const output = path.resolve(root, `${base}/review-sources-npc-v1.json`)
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(`${output}\n`)
