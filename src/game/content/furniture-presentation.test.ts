import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { FURNITURE as RULES } from './furniture.ts'
import { FURNITURE, FURNITURE_PRESENTATION } from './furniture-presentation.ts'

test('all 57 furniture records retain their original appearance, prose and gameplay values', () => {
  assert.equal(Object.keys(FURNITURE).length, 57)
  assert.deepEqual(Object.keys(FURNITURE_PRESENTATION).sort(), Object.keys(RULES).sort())
  for (const item of Object.values(RULES)) {
    for (const field of ['shape', 'color', 'blurb']) assert.equal(Object.hasOwn(item, field), false)
  }
  const canonical = JSON.stringify(Object.values(FURNITURE).map(item => Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))).sort((a, b) => String(a.id).localeCompare(String(b.id))))
  assert.equal(createHash('sha256').update(canonical).digest('hex'), 'de7268b1a0b4399ba27e98b16d603f3c5697c3e49c1a7a5cb4440dca9c04dd14')
})
