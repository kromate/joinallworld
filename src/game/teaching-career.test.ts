import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCityContent } from './cities/registry.ts'
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts'
import { makeContext } from './util.ts'
import type { ActionBody } from '../types/actions.ts'
import type { LifeState, ActivityAction } from '../types/life.ts'

await loadCityContent('lagos')
const NOW = Date.UTC(2026, 0, 5, 8)
const at = (now = NOW, trustedSave = false) => makeContext({ now, cityId: 'lagos', seed: 'teaching-career', trustedSave })
const act = (state: LifeState, type: string, payload: Record<string, unknown> = {}) => dispatch(state, { type, payload } as ActionBody, at(state.t))
function start(): LifeState {
  const state = createLife({ t: NOW, cash: 0, job: 'teaching', location: 'park', spot: 'work', career: { auto: false }, needs: { energy: 100, hunger: 100 } }, at())
  assert.equal(act(state, 'activity', { id: 'teaching-shift' }).ok, true)
  return state
}
function session(state: LifeState): ActivityAction {
  assert.ok(state.activeAction?.kind === 'activity' && state.activeAction.teaching)
  return state.activeAction
}
function answer(state: LifeState, choice: string) {
  const action = session(state)
  return act(state, 'career.teach', { generation: action.teachingGeneration, revision: action.teaching!.revision, stage: action.teaching!.stage, choice })
}

test('waiting and wrong answers cannot pay; only the three teaching decisions complete existing career effects once', () => {
  const state = start(), generation = state.career.teachingGeneration
  advanceLife(state, 300, at(NOW + 300_000))
  assert.deepEqual([state.cash, state.completedShifts, state.skills.charisma, state.career.performance], [0, 0, 0, 50])
  assert.equal(session(state).remaining, 40)
  assert.equal(answer(state, 'numerator-count').code, 'retry')
  assert.equal(session(state).teaching!.stage, 'diagnose')
  assert.equal(answer(state, 'denominator-count').code, 'answered')
  assert.equal(answer(state, 'same-whole-pieces').code, 'answered')
  const terminal = { generation, revision: session(state).teaching!.revision, stage: 'check', choice: 'one-fifth' }
  assert.equal(act(state, 'career.teach', terminal).code, 'shift_completed')
  assert.deepEqual([state.cash, state.completedShifts, state.skills.charisma, state.career.performance, state.activeAction], [3000, 1, 25, 60, null])
  assert.equal(state.ledger.filter(row => row.amount === 3000).length, 1)
  assert.equal(act(state, 'career.teach', terminal).code, 'no_teaching_shift')
  assert.equal(act(state, 'activity', { id: 'teaching-shift' }).code, 'shift_done')
})

test('cancellation fences old-shift answers and preserves the daily allowance and generation across job changes', () => {
  const state = start(), old = viewLife(state, at()).career.teaching!
  assert.equal(act(state, 'cancel').ok, true)
  assert.deepEqual([state.cash, state.completedShifts, state.skills.charisma, state.career.lastShiftDay], [0, 0, 0, null])
  assert.equal(act(state, 'career.quit').ok, true)
  assert.equal(act(state, 'apply-job', { id: 'teaching' }).ok, true)
  assert.equal(act(state, 'activity', { id: 'teaching-shift' }).ok, true)
  assert.equal(state.career.teachingGeneration, old.generation + 1)
  assert.equal(act(state, 'career.teach', { generation: old.generation, revision: old.practice.revision, stage: old.practice.stage, choice: 'denominator-count' }).code, 'generation_conflict')
  assert.equal(session(state).teaching!.revision, 1)
})

test('trusted interrupted sessions resume exactly; malformed and imported sessions never become legacy reward timers', () => {
  const state = start()
  assert.equal(answer(state, 'denominator-count').ok, true)
  const saved = JSON.parse(JSON.stringify(state))
  const restored = createLife(saved, at(NOW, true))
  assert.deepEqual(viewLife(restored, at()).career.teaching, viewLife(state, at()).career.teaching)
  advanceLife(restored, 80, at(NOW + 80_000))
  assert.equal(session(restored).teaching!.stage, 'explain')
  assert.equal(restored.cash, 0)
  assert.equal(createLife(saved, at()).activeAction, null)
  saved.activeAction.teaching = { ...saved.activeAction.teaching, version: 2 }
  const malformed = createLife(saved, at(NOW, true))
  assert.equal(malformed.activeAction, null)
  advanceLife(malformed, 80, at(NOW + 80_000))
  assert.equal(malformed.cash, 0)
})

test('stale, skipped, extra-field and foreign-context teaching actions leave the practice and wallet unchanged', () => {
  const state = start(), action = session(state)
  const payload = { generation: action.teachingGeneration, revision: action.teaching!.revision, stage: action.teaching!.stage, choice: 'denominator-count' }
  const before = JSON.stringify(state.activeAction)
  assert.equal(act(state, 'career.teach', { ...payload, stage: 'check', choice: 'one-fifth' }).code, 'stage_conflict')
  assert.equal(act(state, 'career.teach', { ...payload, revision: 0 }).code, 'invalid_request')
  assert.equal(act(state, 'career.teach', { ...payload, wage: 9000 }).code, 'invalid_request')
  state.spot = null
  assert.equal(act(state, 'career.teach', payload).code, 'no_teaching_shift')
  assert.equal(JSON.stringify(state.activeAction), before)
  assert.equal(state.cash, 0)
})

test('unsupported persisted generation refuses a new teaching session instead of resetting its identity', () => {
  const state = createLife({ t: NOW, job: 'teaching', location: 'park', spot: 'work',
    career: { auto: false, teachingGeneration: 'future' }, needs: { energy: 100, hunger: 100 } }, at(NOW, true))
  assert.equal(act(state, 'activity', { id: 'teaching-shift' }).code, 'balance_limit')
  assert.equal(state.activeAction, null)
  assert.equal(state.career.teachingGeneration, Number.MAX_SAFE_INTEGER)
})
