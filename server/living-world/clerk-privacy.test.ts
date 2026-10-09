import test from 'node:test'
import assert from 'node:assert/strict'
import { startClerkPractice, stepClerkPractice } from '../../src/game/living-world/clerk.ts'
import { eraseLivingWorldProgress, exportLivingWorldProgress, rebindClerkAccount } from './privacy.ts'
import type { Db } from '../types.ts'

function row(actor: string, account: string | null) {
  const practice = startClerkPractice(actor)!
  const progressed = stepClerkPractice(practice, { actorId: actor, expectedRevision: 0, stepId: 'inspect_receipt', evidenceId: 'receipt' })
  assert.ok(progressed.state && progressed.ok)
  return { v: 1, publicId: actor, account, cityId: 'lagos', location: 'home', createdAt: 10, updatedAt: 11,
    practice: progressed.state, claimed: false, claimedAt: null }
}
const dbWith = (livingWorld: unknown): Db => ({ version: 1, sessions: {}, livingWorld }) as Db

test('clerk export summarizes owned steps without owner IDs, answers or unrelated records', () => {
  const db = dbWith({ clerk: { ada: row('ada', 'owner'), bob: { private: 'unread' } } })
  const before = structuredClone(db)
  const summary = exportLivingWorldProgress(db, 'owner', ['ada']).actors[0]?.clerk
  assert.deepEqual(summary, { status: 'present', progress: { scenarioVersion: 1, step: 'inspect_dispatch', revision: 1, claimed: false, updatedAt: 11 } })
  assert.deepEqual(exportLivingWorldProgress(db, 'other-owner', ['ada']).actors[0]?.clerk, { status: 'quarantined' })
  assert.deepEqual(exportLivingWorldProgress(db, 'owner', ['nobody']).actors[0]?.clerk, { status: 'empty' })
  assert.deepEqual(db, before)
})

test('same actor account rebind preserves exercise and rejects future, foreign or unwritable rows', () => {
  const stored = row('ada', null), before = structuredClone(stored)
  const db = dbWith({ clerk: { ada: stored } })
  assert.equal(rebindClerkAccount(db, 'ada', null, 'owner'), true)
  assert.deepEqual(stored, { ...before, account: 'owner' })
  assert.equal(rebindClerkAccount(db, 'ada', 'someone-else', null), false)
  assert.equal(rebindClerkAccount(db, 'ada', 'owner', null), true)
  assert.deepEqual(stored, before)
  const future = { ...stored, v: 2 }, frozen = Object.freeze({ ...stored })
  assert.equal(rebindClerkAccount(dbWith({ clerk: { ada: future } }), 'ada', null, 'owner'), false)
  assert.equal(rebindClerkAccount(dbWith({ clerk: { ada: frozen } }), 'ada', null, 'owner'), false)
  assert.deepEqual(future, { ...before, v: 2 })
})

test('erasure removes only proven actors, preserves unknown slices and refuses malformed maps before changing any row', () => {
  const unrelated = row('bob', 'other-owner')
  const db = dbWith({ clerk: { ada: row('ada', 'owner'), bob: unrelated }, future: { ada: 'preserve' } })
  eraseLivingWorldProgress(db, ['ada'])
  assert.deepEqual(db.livingWorld, { clerk: { bob: unrelated }, future: { ada: 'preserve' } })
  const malformed = dbWith({ barber: { ada: 'retained' }, clerk: [] })
  const before = structuredClone(malformed)
  assert.throws(() => eraseLivingWorldProgress(malformed, ['ada']), /privacy-erasure-unavailable/)
  assert.deepEqual(malformed, before)
})
