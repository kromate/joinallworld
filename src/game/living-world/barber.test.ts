import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readBarberPractice,
  readValidatedBarberPractice,
  resumeBarberPractice,
  startBarberPractice,
  stepBarberPractice,
  type BarberPracticePlan,
  type BarberPracticeState,
} from './barber.ts'

// Test-only opaque catalogue mapping. Production must inject its approved, versioned mapping.
const plan: BarberPracticePlan = {
  id: 'fixture-practice', version: 1, catalogueVersion: 'fixture-catalogue-v1', styleId: 'approved-style-ref', body: 'woman',
  objectives: [
    { id: 'section-front', tool: 'comb', region: 'front', target: { minX: 0.2, minY: 0.3, maxX: 0.6, maxY: 0.5 }, coverageRequired: 0.18 },
    { id: 'finish-side', tool: 'brush', region: 'left', target: { minX: 0.3, minY: 0.7, maxX: 0.7, maxY: 0.9 }, coverageRequired: 0.18 },
  ],
}
const active = (): BarberPracticeState => {
  const state = startBarberPractice(plan)
  assert.ok(state)
  return state
}
const step = (state: BarberPracticeState, tool: 'comb' | 'brush' | 'scissors' | 'clippers', x: number, y: number, pressed = true, currentPlan = plan): { state: BarberPracticeState; feedback: string } => {
  const result = stepBarberPractice(state, { tool, x, y, pressed }, currentPlan)
  assert.ok(result.state)
  return { state: result.state, feedback: result.feedback }
}

test('strict server reader retains active measured strokes without stepping or accepting coercible saved status', () => {
  const moving = step(active(), 'comb', 0.25, 0.4).state
  const snapshot = JSON.stringify(moving)
  const validated = readValidatedBarberPractice(moving, plan)
  assert.deepEqual(validated, moving)
  assert.notEqual(validated, moving)
  assert.notEqual(validated?.cursor, moving.cursor)
  assert.equal(JSON.stringify(moving), snapshot)
  assert.equal(readBarberPractice(moving, plan)?.status, 'paused', 'bootstrap alone clears held controls')
  for (const status of [['running'], { toString: () => 'running' }, new String('running')]) {
    assert.equal(readValidatedBarberPractice({ ...moving, status }, plan), null)
    assert.equal(readBarberPractice({ ...moving, status }, plan), null)
  }
  assert.equal(readValidatedBarberPractice({ ...moving, pointerDown: false }, plan), null)
  assert.equal(readValidatedBarberPractice({ ...moving, status: 'paused' }, plan), null)
  assert.equal(readValidatedBarberPractice(moving, { ...plan, version: 2 }), null, 'a new plan cannot use old live progress')
  const complete = { ...moving, status: 'complete', objectiveIndex: plan.objectives.length, cursor: null, pointerDown: false, coverage: 0 }
  assert.ok(readValidatedBarberPractice(complete, plan))
  for (const corrupt of [{ ...complete, coverage: 0.01 }, { ...complete, cursor: moving.cursor, pointerDown: true }]) {
    assert.equal(readValidatedBarberPractice(corrupt, plan), null)
    assert.equal(readBarberPractice(corrupt, plan), null)
  }
})

test('active ordered strokes cover each server-authored target with its required tool', () => {
  let state = active()
  for (const point of [[0.25, 0.4], [0.4, 0.4], [0.55, 0.4]] as const) state = step(state, 'comb', ...point).state
  assert.equal(state.objectiveIndex, 1)
  assert.equal(state.status, 'running')
  assert.equal(state.pointerDown, false)
  for (const point of [[0.35, 0.8], [0.5, 0.8], [0.65, 0.8]] as const) state = step(state, 'brush', ...point).state
  assert.equal(state.status, 'complete')
  assert.equal(state.objectiveIndex, 2)
  assert.equal(state.coverage, 0)
})

test('wrong tool, stationary holding, and strokes on a later region do not earn coverage', () => {
  let state = active()
  state = step(state, 'scissors', 0.3, 0.4).state
  assert.equal(state.status, 'running')
  assert.equal(state.coverage, 0)
  assert.equal(state.pointerDown, false)
  state = step(state, 'comb', 0.3, 0.4).state
  state = step(state, 'comb', 0.3, 0.4).state
  assert.equal(state.coverage, 0, 'holding still cannot advance practice')
  state = step(state, 'comb', 0.35, 0.8).state
  state = step(state, 'comb', 0.5, 0.8).state
  assert.equal(state.objectiveIndex, 0, 'later objective remains locked until the current target is covered')
})

test('invalid, reordered, extra, and over-fast controls pause safely without accepting progress flags', () => {
  let state = active()
  const forged = stepBarberPractice(state, { tool: 'comb', x: 0.3, y: 0.4, pressed: true, completed: true }, plan)
  assert.ok(forged.state)
  state = forged.state
  assert.equal(state.status, 'paused')
  assert.equal(state.pointerDown, false)
  const malformedPlan = { ...plan, objectives: [...plan.objectives].reverse() }
  const mismatched = stepBarberPractice(active(), { tool: 'brush', x: 0.4, y: 0.8, pressed: true }, malformedPlan)
  assert.ok(mismatched.state)
  assert.equal(mismatched.state.status, 'paused')
  assert.equal(mismatched.state.objectiveIndex, 0)
  let fast = active()
  fast = step(fast, 'comb', 0.3, 0.4).state
  fast = step(fast, 'comb', 0.8, 0.4).state
  assert.equal(fast.status, 'paused')
  assert.equal(fast.pointerDown, false)
  assert.equal(startBarberPractice({ ...plan, objectives: Array(9).fill(plan.objectives[0]!) }), null)
})

test('reload pauses an interrupted stroke, clears held tools, and preserves only measured coverage', () => {
  let state = active()
  state = step(state, 'comb', 0.25, 0.4).state
  state = step(state, 'comb', 0.4, 0.4).state
  assert.ok(state.coverage > 0)
  const saved = JSON.parse(JSON.stringify(state)) as unknown
  const loaded = readBarberPractice(saved, plan)
  assert.ok(loaded)
  assert.equal(loaded.status, 'paused')
  assert.equal(loaded.pointerDown, false)
  assert.equal(loaded.cursor, null)
  assert.equal(loaded.coverage, state.coverage)
  const resumed = resumeBarberPractice(loaded, plan)
  assert.ok(resumed)
  assert.equal(resumed.status, 'running')
  assert.equal(resumed.pointerDown, false)
  assert.equal(resumed.coverage, state.coverage)
})

test('plan version changes fence progress; terminal completion remains stable across reload', () => {
  const state = active()
  const changed = { ...plan, version: 2 }
  const fenced = step(state, 'comb', 0.3, 0.4, true, changed).state
  assert.equal(fenced.status, 'paused')
  assert.equal(fenced.objectiveIndex, 0)

  let complete = active()
  for (const point of [[0.25, 0.4], [0.4, 0.4], [0.55, 0.4]] as const) complete = step(complete, 'comb', ...point).state
  for (const point of [[0.35, 0.8], [0.5, 0.8], [0.65, 0.8]] as const) complete = step(complete, 'brush', ...point).state
  assert.equal(complete.status, 'complete')
  const loaded = readBarberPractice(JSON.parse(JSON.stringify(complete)), plan)
  assert.ok(loaded)
  assert.deepEqual(loaded, complete)
  assert.deepEqual(stepBarberPractice(loaded, { tool: 'brush', x: 0.5, y: 0.8, pressed: true }, plan).state, loaded)
  const changedPlan = { ...plan, version: 2 }
  const historical = stepBarberPractice(loaded, { tool: 'brush', x: 0.5, y: 0.8, pressed: true }, changedPlan)
  assert.ok(historical.state)
  assert.equal(historical.state.status, 'paused')
  assert.equal(historical.state.plan.version, 2, 'a completed old plan is not completion evidence for the current plan')
  assert.doesNotThrow(() => readBarberPractice({ v: 1, plan: null }, plan))
  assert.equal(readBarberPractice({ v: 1, plan: null }, plan), null)
  const malformedStep = stepBarberPractice(null, { tool: 'comb', x: 0.3, y: 0.4, pressed: true }, plan)
  assert.equal(malformedStep.state?.status, 'paused')
})
