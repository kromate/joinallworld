import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertOwnedResultDirectory } from './result-dir-contract-npc-v2.mjs'

const root = mkdtempSync(path.join(os.tmpdir(), 'npc-result-contract-'))
try {
  const dir = path.join(root, 'run')
  mkdirSync(dir)
  const token = 'a'.repeat(32)
  writeFileSync(path.join(dir, 'browser.log'), '')
  writeFileSync(path.join(dir, 'supervisor-events.jsonl'), `${JSON.stringify({ stage: 'supervisor-initialized', ownerToken: token })}\n`)
  assert.equal(assertOwnedResultDirectory(dir, token), true)
  assert.throws(() => assertOwnedResultDirectory(dir, 'b'.repeat(32)))
  writeFileSync(path.join(dir, 'extra.png'), 'x')
  assert.throws(() => assertOwnedResultDirectory(dir, token))
} finally { rmSync(root, { recursive: true, force: true }) }
