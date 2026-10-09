import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCityContent } from './cities/registry.ts'
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts'
import { makeContext } from './util.ts'
import type { ActionBody, LifeContextInit } from '../types/index.ts'
import type { LifeState } from '../types/life.ts'

await loadCityContent('lagos')
const NOW = Date.UTC(2026, 0, 5, 8)
const at = (now = NOW, interactiveTeachingStarts?: boolean, trustedSave = false) => makeContext({
  now, cityId: 'lagos', seed: 'teaching-start-policy', trustedSave,
  ...(interactiveTeachingStarts === undefined ? {} : { interactiveTeachingStarts }),
})
const act = (state: LifeState, type: string, payload: Record<string, unknown> = {}, enabled?: boolean) =>
  dispatch(state, { type, payload } as ActionBody, at(state.t, enabled))
function fresh(): LifeState {
  return createLife({ t: NOW, cash: 0, job: 'teaching', location: 'park', spot: 'work',
    career: { auto: false }, needs: { energy: 100, hunger: 100 } }, at())
}
function active(state: LifeState) {
  assert.ok(state.activeAction?.kind === 'activity' && state.activeAction.id === 'teaching-shift')
  return state.activeAction
}
function answer(state: LifeState, choice: string, enabled?: boolean) {
  const shift = active(state)
  assert.ok(shift.teaching)
  return act(state, 'career.teach', { generation: shift.teachingGeneration, revision: shift.teaching.revision,
    stage: shift.teaching.stage, choice }, enabled)
}

test('absent and false trusted opt-in preserve the legacy timed teaching shift and counter', () => {
  for (const enabled of [undefined, false]) {
    const state = fresh()
    const context = at(NOW, enabled)
    const result = dispatch(state, { type: 'activity', payload: { id: 'teaching-shift' } } as ActionBody, context)
    assert.equal(result.ok, true)
    assert.equal(state.career.teachingGeneration, 0)
    assert.equal(active(state).teaching, undefined)
    advanceLife(state, 40, at(NOW + 40_000, enabled))
    assert.equal(state.activeAction, null)
    assert.deepEqual([state.cash, state.completedShifts, state.ledger.filter(row => row.amount === 3000).length], [3000, 1, 1])
  }
})

test('only literal trusted true creates one authored interactive marker and advertises the mode', () => {
  const state = fresh()
  assert.equal(act(state, 'activity', { id: 'teaching-shift' }, true).ok, true)
  assert.equal(state.career.teachingGeneration, 1)
  assert.equal(active(state).teaching?.stage, 'diagnose')
  assert.equal(viewLife(state, at(state.t, true)).career.interactiveTeachingStarts, true)
})

test('turning the start gate off preserves an issued lesson through trusted reload and its single completion', () => {
  const state = fresh()
  assert.equal(act(state, 'activity', { id: 'teaching-shift' }, true).ok, true)
  const generation = state.career.teachingGeneration
  assert.equal(answer(state, 'denominator-count', true).code, 'answered')
  const saved = JSON.parse(JSON.stringify(state))
  const restored = createLife(saved, at(state.t, false, true))
  assert.deepEqual(viewLife(restored, at(restored.t, false)).career.teaching,
    viewLife(state, at(state.t, true)).career.teaching)
  assert.equal(restored.career.teachingGeneration, generation)
  advanceLife(restored, 300, at(restored.t + 300_000, false))
  assert.equal(active(restored).teaching?.stage, 'explain', 'elapsed time cannot settle the retained input-driven shift')
  assert.equal(restored.cash, 0)
  assert.equal(answer(restored, 'same-whole-pieces', false).code, 'answered')
  const completed = answer(restored, 'one-fifth', false)
  assert.equal(completed.code, 'shift_completed')
  assert.deepEqual([restored.career.teachingGeneration, restored.cash, restored.completedShifts,
    restored.ledger.filter(row => row.amount === 3000).length], [generation, 3000, 1, 1])
  assert.equal(act(restored, 'career.teach', { generation, revision: 3, stage: 'check', choice: 'one-fifth' }, false).code, 'no_teaching_shift')
  assert.equal(restored.cash, 3000)
})

test('a request payload cannot opt into interactive starts', () => {
  const state = fresh()
  const payload: Record<string, unknown> = { id: 'teaching-shift' }
  Reflect.set(payload, 'interactiveTeachingStarts', true)
  const result = dispatch(state, { type: 'activity', payload } as ActionBody, at(NOW, false))
  assert.equal(result.ok, true)
  assert.equal(state.career.teachingGeneration, 0)
  assert.equal(active(state).teaching, undefined)
})

test('context construction rejects a truthy non-boolean opt-in', () => {
  const input: LifeContextInit & { cityId: string } = {
    now: NOW, cityId: 'lagos', seed: 'nonliteral-teaching-opt-in', interactiveTeachingStarts: true,
  }
  Reflect.set(input, 'interactiveTeachingStarts', 1)
  const context = makeContext(input)
  assert.equal(context.interactiveTeachingStarts, undefined)
  const state = createLife({ t: NOW, cash: 0, job: 'teaching', location: 'park', spot: 'work',
    career: { auto: false }, needs: { energy: 100, hunger: 100 } }, context)
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'teaching-shift' } } as ActionBody, context).ok, true)
  assert.equal(state.career.teachingGeneration, 0)
  assert.equal(active(state).teaching, undefined)
})
