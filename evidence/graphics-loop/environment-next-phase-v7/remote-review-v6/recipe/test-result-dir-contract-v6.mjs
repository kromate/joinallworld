import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertOwnedResultDirectory } from './result-dir-contract-v6.mjs'

const root = mkdtempSync(path.join(os.tmpdir(), 'render-result-contract-v7-'))
const token = '0123456789abcdef0123456789abcdef'
function fresh(name) {
  const dir = path.join(root, name)
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'browser.log'), '')
  writeFileSync(path.join(dir, 'supervisor-events.jsonl'), `${JSON.stringify({ stage: 'supervisor-initialized', ownerToken: token })}\n`)
  return dir
}
try {
  assert.equal(assertOwnedResultDirectory(fresh('owned-empty'), token), true)
  const partialAppend = fresh('partial-append')
  appendFileSync(path.join(partialAppend, 'supervisor-events.jsonl'), '{"stage":"process-sample"')
  assert.equal(assertOwnedResultDirectory(partialAppend, token), true)
  const malformedRecord = fresh('malformed-complete')
  appendFileSync(path.join(malformedRecord, 'supervisor-events.jsonl'), '{bad}\n')
  assert.throws(() => assertOwnedResultDirectory(malformedRecord, token), SyntaxError)
  const unrelated = fresh('unrelated')
  writeFileSync(path.join(unrelated, 'old-capture.png'), 'old')
  assert.throws(() => assertOwnedResultDirectory(unrelated, token), /Refusing to overwrite/)
  const wrongOwner = fresh('wrong-owner')
  writeFileSync(path.join(wrongOwner, 'supervisor-events.jsonl'), `${JSON.stringify({ stage: 'supervisor-initialized', ownerToken: 'f'.repeat(32) })}\n`)
  assert.throws(() => assertOwnedResultDirectory(wrongOwner, token), /not owned by this run/)
  const extraJsonl = fresh('extra-jsonl')
  writeFileSync(path.join(extraJsonl, 'old-events.jsonl'), '{}\n')
  assert.throws(() => assertOwnedResultDirectory(extraJsonl, token), /Refusing to overwrite/)
  console.log('result directory ownership contract: PASS')
} finally {
  rmSync(root, { recursive: true, force: true })
}
