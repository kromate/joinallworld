import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const recipe = path.dirname(new URL(import.meta.url).pathname)
const workflow = readFileSync(path.join(recipe, 'workflow-review-v6.yml'), 'utf8')
const runner = readFileSync(path.join(recipe, 'run-bounded-linux-render-v6.py'), 'utf8')
const controller = readFileSync(path.join(recipe, 'review-render-cdp-v6.mjs'), 'utf8')
const sealer = readFileSync(path.join(recipe, 'seal-review-sources-v6.mjs'), 'utf8')
const run = '37902739360', commit = 'c4d15a72f6df56b28535579380819bdaf2fad8a1'
const artifact = `environment-whole-slice-v7-package-v3-${run}`
for (const source of [workflow, runner, controller]) { assert.ok(source.includes(run), 'missing pinned CPU run'); assert.ok(source.includes(commit), 'missing pinned CPU commit'); assert.ok(source.includes(artifact), 'missing pinned CPU artifact') }
assert.match(workflow, /on:\s*\n\s+push:/)
assert.ok(workflow.includes('codex/graphics-environment-next-phase-v7-render-review-v6'))
assert.ok(workflow.includes('workflow-review-v6.yml'))
assert.ok(runner.includes('remote-review-source-pins/2'))
assert.ok(controller.includes('remote-review-source-pins/2'))
assert.ok(sealer.includes('remote-review-source-pins/2'))
assert.ok(workflow.includes('2 GiB') === false, 'caps are asserted by runner, not workflow prose')
console.log('remote v6 workflow/package/schema pin contract: PASS')
