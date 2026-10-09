import test from 'node:test'
import assert from 'node:assert/strict'
import { createJusticePractice, applyJusticePractice, JUSTICE_PRACTICE_CASE_ID } from '../../src/game/living-world/justice-practice.ts'
import { eraseLivingWorldProgress, exportLivingWorldProgress, rebindJusticePracticeAccount } from './privacy.ts'
import type { Db } from '../types.ts'

function row(publicId: string, account: string | null) {
  const applied = applyJusticePractice(createJusticePractice(), {
    requestId: 'private-receipt', expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'dispatch-copy' },
  })
  assert.equal(applied.outcome.code, 'advanced')
  return { v: 1, publicId, account, cityId: 'lagos', caseId: JUSTICE_PRACTICE_CASE_ID,
    createdAt: 10, updatedAt: 11, practice: applied.state }
}
const dbWith = (livingWorld: unknown): Db => ({ version: 1, sessions: {}, livingWorld }) as Db

test('justice export gives only owned training summary and preserves legacy shape', () => {
  const foreign = Object.defineProperty({}, 'private', { get: () => { throw new Error('foreign record read') } })
  const db = dbWith({ justicePractice: { ada: row('ada', 'owner'), bob: foreign } })
  const summary = exportLivingWorldProgress(db, 'owner', ['ada']).actors[0]?.justicePractice
  assert.deepEqual(summary, { status: 'present', progress: {
    scenarioVersion: 1, phase: 'inspect-initial', revision: 1, trainingComplete: false, updatedAt: 11,
  } })
  assert.doesNotMatch(JSON.stringify(summary), /private-receipt|dispatch-copy|receipts|account/)
  assert.deepEqual(exportLivingWorldProgress(db, 'different-owner', ['ada']).actors[0]?.justicePractice, { status: 'quarantined' })
  assert.deepEqual(exportLivingWorldProgress(db, 'owner', ['nobody']).actors[0]?.justicePractice, { status: 'empty' })
  assert.equal(Object.hasOwn(exportLivingWorldProgress(dbWith({}), 'owner', ['ada']).actors[0]!, 'justicePractice'), false)
})

test('same-character justice rebind retains every receipt and refuses foreign/future/frozen rows', () => {
  const stored = row('ada', null), before = structuredClone(stored), db = dbWith({ justicePractice: { ada: stored } })
  assert.equal(rebindJusticePracticeAccount(db, 'ada', null, 'owner'), true)
  assert.deepEqual(stored, { ...before, account: 'owner' })
  assert.equal(rebindJusticePracticeAccount(db, 'ada', 'other', null), false)
  assert.equal(rebindJusticePracticeAccount(db, 'ada', 'owner', null), true)
  assert.deepEqual(stored, before)
  const future = { ...stored, v: 2 }, frozen = Object.freeze({ ...stored })
  assert.equal(rebindJusticePracticeAccount(dbWith({ justicePractice: { ada: future } }), 'ada', null, 'owner'), false)
  assert.equal(rebindJusticePracticeAccount(dbWith({ justicePractice: { ada: frozen } }), 'ada', null, 'owner'), false)
  assert.deepEqual(future, { ...before, v: 2 })
})

test('justice erasure respects proven actor scope and preflights malformed maps atomically', () => {
  const other = row('bob', 'other')
  const db = dbWith({ justicePractice: { ada: row('ada', 'owner'), bob: other }, unknown: { ada: 'preserve' } })
  eraseLivingWorldProgress(db, ['ada'])
  assert.deepEqual(db.livingWorld, { justicePractice: { bob: other }, unknown: { ada: 'preserve' } })
  const malformed = dbWith({ clerk: { ada: 'preserve' }, justicePractice: [] }), before = structuredClone(malformed)
  assert.throws(() => eraseLivingWorldProgress(malformed, ['ada']), /privacy-erasure-unavailable/)
  assert.deepEqual(malformed, before)
})
