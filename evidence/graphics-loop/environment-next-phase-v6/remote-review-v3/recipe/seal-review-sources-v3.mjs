// Seal only the deterministic review controller/runner/controls. This is not a package manifest.
import { createHash } from 'node:crypto'
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const base = 'evidence/graphics-loop/environment-next-phase-v6/remote-review-v3'
const recipe = `${base}/recipe`
const targets = [
  `${recipe}/README.md`, `${recipe}/review-render-cdp-v3.mjs`, `${recipe}/run-bounded-linux-render-v3.py`,
  `${recipe}/result-dir-contract-v3.mjs`, `${recipe}/test-result-dir-contract-v3.mjs`,
  `${recipe}/package-selection-v3.mjs`, `${recipe}/test-package-selection-v3.mjs`, `${recipe}/test-runner-contract-v3.py`,
  `${recipe}/workflow-review-v3.yml`, `${recipe}/seal-review-sources-v3.mjs`,
  `${base}/scope-plan-v3.mjs`, `${base}/scope-plan-v3.test.mjs`,
  `${base}/remote-control-v3.mjs`, `${base}/remote-control-v3.test.mjs`,
]
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const files = []
for (const relative of targets.sort()) {
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`Unsafe review input path ${relative}`)
  files.push({ path: relative, bytes: statSync(absolute).size, sha256: await hashFile(absolute) })
}
const payload = { schema: 'environment-next-phase-v6-remote-review-source-pins/1', status: 'PRE-REVIEW-SEALED',
  limits: { ownedProcessGroupRssBytes: 2 * 1024 * 1024 * 1024, nodeOldSpaceMiB: 96, timeoutSeconds: 60, maxParallel: 3 },
  scenes: ['home/day', 'home/night', 'neighbourhood/day', 'neighbourhood/night', 'market/day', 'market/night', 'beach/day', 'beach/night'],
  scopes: ['scene-pair-home-neighbourhood', 'scene-pair-market-beach', 'lifecycle-only'], files }
const output = path.resolve(root, `${recipe}/review-sources-v3.json`)
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(`${output}\n`)
