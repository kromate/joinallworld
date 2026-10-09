import assert from 'node:assert/strict'
import test from 'node:test'
import { newTeachingPractice, teachingStep } from '../../../game/living-world/teaching-practice.ts'
import type { TeachingPractice } from '../../../game/living-world/teaching-practice.ts'
import { teachingShiftAnswer } from './teachingShiftModel.ts'

const practice: TeachingPractice = newTeachingPractice()
const firstChoice = teachingStep(practice)?.options[0]?.id ?? ''

test('answer model emits only an authored current-step choice with current revision', () => {
  const answer = teachingShiftAnswer(3, practice, practice.revision, practice.stage, firstChoice)
  assert.deepEqual(answer, { generation: 3, revision: practice.revision, stage: practice.stage, choice: firstChoice })
  assert.deepEqual(Object.keys(answer ?? {}).sort(), ['choice', 'generation', 'revision', 'stage'])
  assert.equal(teachingShiftAnswer(3, practice, practice.revision, practice.stage, 'invented-answer'), null)
})

test('stale displayed revision or stage cannot produce a submission', () => {
  assert.equal(teachingShiftAnswer(3, practice, practice.revision - 1, practice.stage, firstChoice), null)
  assert.equal(teachingShiftAnswer(3, practice, practice.revision, 'explain', firstChoice), null)
})

test('disabled and terminal practice states refuse answer creation', () => {
  assert.equal(teachingShiftAnswer(3, practice, practice.revision, practice.stage, firstChoice, true), null)
  const complete: TeachingPractice = { ...practice, revision: 4, stage: 'complete', feedback: 'correct' }
  assert.equal(teachingShiftAnswer(3, complete, complete.revision, 'complete', firstChoice), null)
})

test('missing, invalid, or old-generation context refuses an answer', () => {
  assert.equal(teachingShiftAnswer(0, practice, practice.revision, practice.stage, firstChoice), null)
  assert.equal(teachingShiftAnswer(Number.NaN, practice, practice.revision, practice.stage, firstChoice), null)
  assert.equal(teachingShiftAnswer(Number.MAX_SAFE_INTEGER + 1, practice, practice.revision, practice.stage, firstChoice), null)
})
