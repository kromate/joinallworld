import test from 'node:test'
import assert from 'node:assert/strict'
import { startAssessmentPractice, stepAssessmentPractice } from '../../src/campus/unilag/assessment-practice.ts'
import { eraseLivingWorldProgress, exportLivingWorldProgress, rebindAssessmentAccount } from './privacy.ts'
import type { Db } from '../types.ts'

function row(publicId: string, account: string | null) {
  const practice = stepAssessmentPractice(startAssessmentPractice(publicId), publicId, {
    kind: 'probe', requestId: 'private-lab-operation', expectedRevision: 1, a: false, b: true,
  }).state
  return { v: 1, publicId, account, cityId: 'lagos', programmeId: 'computer', courseId: 'cpe-101',
    attempts: [{ semester: 1, startDay: 20_000, practice }], createdAt: 10, updatedAt: 11 }
}
const dbWith = (livingWorld: unknown): Db => ({ version: 1, sessions: {}, livingWorld }) as Db

test('assessment export summarizes proven attempts without lab answers or retry witnesses', () => {
  const db = dbWith({ assessments: { ada: row('ada', 'owner'), bob: { private: 'preserve' } } }), before = structuredClone(db)
  const exported = exportLivingWorldProgress(db, 'owner', ['ada']).actors[0]?.assessments
  assert.deepEqual(exported, { status: 'present', progress: { courseId: 'cpe-101', attempts: [
    { semester: 1, startDay: 20_000, phase: 'inspect', revision: 2, score: null },
  ], updatedAt: 11 } })
  assert.doesNotMatch(JSON.stringify(exported), /private-lab-operation|counterexample|repairGate|lastOperation|initialMask|actorId/)
  assert.deepEqual(exportLivingWorldProgress(db, 'other', ['ada']).actors[0]?.assessments, { status: 'quarantined' })
  assert.equal(Object.hasOwn(exportLivingWorldProgress(dbWith({}), 'owner', ['ada']).actors[0]!, 'assessments'), false)
  assert.deepEqual(db, before)
})

test('assessment ownership changes preserve attempts; future/frozen rows and malformed erasure maps fail closed', () => {
  const stored = row('ada', null), before = structuredClone(stored), db = dbWith({ assessments: { ada: stored } })
  assert.equal(rebindAssessmentAccount(db, 'ada', null, 'owner'), true)
  assert.deepEqual(stored, { ...before, account: 'owner' })
  assert.equal(rebindAssessmentAccount(db, 'ada', 'other', null), false)
  assert.equal(rebindAssessmentAccount(db, 'ada', 'owner', null), true)
  assert.deepEqual(stored, before)
  assert.equal(rebindAssessmentAccount(dbWith({ assessments: { ada: { ...stored, v: 2 } } }), 'ada', null, 'owner'), false)
  assert.equal(rebindAssessmentAccount(dbWith({ assessments: { ada: Object.freeze({ ...stored }) } }), 'ada', null, 'owner'), false)
  const other = row('bob', 'other'), erase = dbWith({ assessments: { ada: stored, bob: other }, unknown: { ada: 'preserve' } })
  eraseLivingWorldProgress(erase, ['ada'])
  assert.deepEqual(erase.livingWorld, { assessments: { bob: other }, unknown: { ada: 'preserve' } })
  const malformed = dbWith({ justicePractice: { ada: 'preserve' }, assessments: [] }), malformedBefore = structuredClone(malformed)
  assert.throws(() => eraseLivingWorldProgress(malformed, ['ada']), /privacy-erasure-unavailable/)
  assert.deepEqual(malformed, malformedBefore)
})
