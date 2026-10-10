// The floating guide steps aside for a teaching lesson on phone widths, so the lesson's feedback can be read. No browser.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { yieldsToLesson } from './lessonYield.ts'

test('the floating guide steps aside for a teaching lesson on phone widths', () => {
  for (const width of [320, 390, 720]) assert.equal(yieldsToLesson(true, width), true, `a lesson at ${width}px`)
  assert.equal(yieldsToLesson(false, 390), false, 'no lesson, no yield')
  assert.equal(yieldsToLesson(false, 320), false, 'no lesson, no yield on a phone either')
})

test('wide screens keep the guide where it is during a lesson', () => {
  assert.equal(yieldsToLesson(true, 721), false)
  assert.equal(yieldsToLesson(true, 1280), false)
})
