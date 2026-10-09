// Seal only the deterministic review controller/runner/controls. This is not a package manifest.
import { createHash } from 'node:crypto'
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const base = 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-render-v1'
const cpu = 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-cpu-v1'
const targets = [
  `${base}/review-render-sofa-v1.mjs`, `${base}/run-bounded-linux-render-sofa-v1.py`,
  `${base}/result-dir-contract-sofa-v1.mjs`, `${base}/test-result-dir-contract-sofa-v1.mjs`,
  `${base}/package-selection-sofa-v1.mjs`, `${base}/test-package-selection-sofa-v1.mjs`, `${base}/test-runner-contract-sofa-v1.py`,
  `${cpu}/workflow-package-sofa-v1.yml`, `${base}/seal-review-sources-sofa-v1.mjs`,
  `${base}/scope-plan-sofa-v1.mjs`, `${base}/remote-control-sofa-v1.mjs`,
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
const payload = { schema: 'sofa-upholstery-v1-remote-review-source-pins/1', status: 'PRE-REVIEW-SEALED',
  limits: { ownedProcessGroupRssBytes: 2 * 1024 * 1024 * 1024, nodeOldSpaceMiB: 96, timeoutSeconds: 60, maxParallel: 1 },
  scenes: ['home/day', 'home/night'], scopes: ['sofa-home'], files }
const output = path.resolve(root, `${base}/review-sources-sofa-v1.json`)
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(`${output}\n`)
