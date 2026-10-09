import test from 'node:test'
import assert from 'node:assert/strict'
import { barberLesson, type BarberLessonId } from '../../../game/living-world/barber-catalogue.ts'
import { startBarberPractice, stepBarberPractice, type BarberPracticeState } from '../../../game/living-world/barber.ts'
import type { BarberResponse } from '../../../types/living-world-barber.ts'
import type { ApiEnvelope } from '../../../types/protocol.ts'
import { readBarberReply } from './barberReply.ts'

const lessonId: BarberLessonId = 'basic'
const lesson = barberLesson(lessonId)!
function completePractice(): BarberPracticeState {
  let state = startBarberPractice(lesson.plan)!
  for (const objective of lesson.plan.objectives) {
    const y = (objective.target.minY + objective.target.maxY) / 2
    const first = objective.target.minX + 0.03
    let result = stepBarberPractice(state, { tool: objective.tool, x: first, y, pressed: true }, lesson.plan)
    assert.ok(result.state)
    state = result.state
    for (let x = first + 0.15; x < objective.target.maxX; x += 0.15) {
      result = stepBarberPractice(state, { tool: objective.tool, x: Math.min(x, objective.target.maxX - 0.03), y, pressed: true }, lesson.plan)
      assert.ok(result.state)
      state = result.state
      if (state.objectiveIndex > lesson.plan.objectives.indexOf(objective)) break
    }
    assert.equal(state.objectiveIndex, lesson.plan.objectives.indexOf(objective) + 1)
  }
  assert.equal(state.status, 'complete')
  return state
}
function reply(session: BarberResponse['session'] = {
  sessionId: 'barber-session-1', lessonId, cityId: 'lagos', location: 'barber-shop', revision: 1, nextSequence: 1,
  status: 'running', practice: startBarberPractice(lesson.plan)!,
}): BarberResponse & ApiEnvelope & Record<string, unknown> {
  return { ok: true, code: 'lesson_loaded', session, plan: session ? lesson.plan : null, results: [], starterTool: false, starterToolCost: 120, serverTime: 1_800_000_000_000 }
}

test('reads a real API envelope and known server plan while allowing unrelated root extras', () => {
  const payload = { ...reply(), traceId: 'gateway-42' }
  const read = readBarberReply(payload)
  assert.ok(read)
  assert.equal(read.serverTime, payload.serverTime)
  assert.equal(read.session?.practice.plan.id, lesson.plan.id)
  assert.equal(readBarberReply({ ...payload, storage: 'failing' }), null, 'unavailable durable storage fails closed')
})

test('rejects coercible statuses, malformed plans, incoherent cursors, and invalid session counters or city', () => {
  const base = reply()
  const session = base.session!
  assert.equal(readBarberReply({ ...base, session: { ...session, status: 1 } }), null)
  assert.equal(readBarberReply({ ...base, session: { ...session, status: '1' } }), null)
  assert.equal(readBarberReply({ ...base, session: { ...session, cityId: 4 } }), null)
  assert.equal(readBarberReply({ ...base, session: { ...session, nextSequence: 0 } }), null)
  assert.equal(readBarberReply({ ...base, session: { ...session, nextSequence: '1' } }), null)
  assert.equal(readBarberReply({ ...base, plan: { ...lesson.plan, objectives: [] } }), null)
  const incoherent = { ...session.practice, cursor: { x: 0.5, y: 0.5 } }
  assert.equal(readBarberReply({ ...base, session: { ...session, practice: incoherent } }), null)
})

test('accepts only catalogue-backed NPC results and keeps terminal state immutable', () => {
  const practice = completePractice()
  const terminal = reply({ sessionId: 'barber-session-1', lessonId, cityId: 'lagos', location: 'barber-shop', revision: 4, nextSequence: 8,
    status: 'complete', practice })
  terminal.ok = true; terminal.code = 'lesson_claimed'
  terminal.results = [{ lessonId, styleId: lesson.resultStyleId, earnedAt: 1_800_000_000_000 }]
  const before = JSON.stringify(terminal)
  const read = readBarberReply(terminal)
  assert.ok(read)
  assert.equal(read.results[0]?.styleId, lesson.resultStyleId)
  assert.deepEqual(read.session?.practice, practice)
  assert.equal(Object.hasOwn(terminal, 'look'), false, 'NPC result replies do not carry player appearance changes')
  assert.equal(JSON.stringify(terminal), before, 'reading never mutates the server reply')
  assert.equal(readBarberReply({ ...terminal, results: [{ lessonId, styleId: 'unknown-style', earnedAt: 1_800_000_000_000 }] }), null)
  assert.equal(readBarberReply({ ...terminal, results: [{ lessonId: 'advanced', styleId: lesson.resultStyleId, earnedAt: 1_800_000_000_000 }] }), null)
  assert.equal(readBarberReply({ ...terminal, results: [], starterTool: true }), null)
  assert.equal(readBarberReply({ ...terminal, results: [{ lessonId: 'advanced', styleId: barberLesson('advanced')!.resultStyleId, earnedAt: 1_800_000_000_000 }], starterTool: true }), null)
})
