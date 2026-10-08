import assert from 'node:assert/strict'
import test from 'node:test'
import { createDriving, pauseDriving, readDrivingState, stepDriving } from './driving.ts'
import type { DrivingRoute, DrivingState } from './driving.ts'

const COURSE: DrivingRoute = {
  id: 'lesson-loop', version: 'authored-course-v1',
  roads: [[{ x: 0, z: 0 }, { x: 0, z: 12 }, { x: 0, z: 16 }, { x: 4, z: 20 }, { x: 12, z: 20 }]],
  checkpoints: [
    { id: 'stop-line', center: { x: 0, z: 7 }, radius: 2, stopRequired: true },
    { id: 'turn-entry', center: { x: 0, z: 14 }, radius: 2.5, stopRequired: false },
    { id: 'finish', center: { x: 3, z: 18 }, radius: 3, stopRequired: false },
  ],
  roadWidth: 10,
  speedLimit: 4,
}

function driveCourse(): DrivingState {
  let state = createDriving(COURSE)
  for (let i = 0; i < 500 && state.status === 'running'; i++) {
    let controls = { throttle: 1, brake: 0, steer: 0 }
    if (state.checkpointIndex === 0 && state.position.z >= 6.2) controls = { throttle: 0, brake: 1, steer: 0 }
    else if (state.checkpointIndex > 0 && state.position.z >= 11) controls = { throttle: 1, brake: 0, steer: 0.7 }
    state = stepDriving(state, controls, COURSE).state
  }
  return state
}

test('fixed control frames accelerate, brake and steer deterministically through a stop and turn', () => {
  const start = createDriving(COURSE)
  const first = stepDriving(start, { throttle: 1, brake: 0, steer: 0 }, COURSE).state
  assert.ok(first.speed > start.speed)
  const turned = stepDriving(first, { throttle: 1, brake: 0, steer: 1 }, COURSE).state
  assert.notEqual(turned.heading, first.heading)
  const braked = stepDriving(turned, { throttle: 0, brake: 1, steer: 0 }, COURSE).state
  assert.ok(braked.speed < turned.speed)
  const controls = { throttle: 1, brake: 0, steer: 0 }
  assert.deepEqual(stepDriving(start, controls, COURSE), stepDriving(start, controls, COURSE))
})

test('a controlled throttle, full stop dwell, and turn earns only simulation-derived assessment', () => {
  const state = driveCourse()
  assert.equal(state.status, 'complete')
  assert.equal(state.assessment, 'passed')
  assert.equal(state.checkpointIndex, COURSE.checkpoints.length)
  assert.ok(state.score >= 70)
})
test('crossing a required stop while moving does not advance the checkpoint', () => {
  const state = createDriving(COURSE)
  const fast: DrivingState = { ...state, position: { x: 0, z: 4.9 }, speed: 16 }
  const result = stepDriving(fast, { throttle: 0, brake: 0, steer: 0 }, COURSE).state
  assert.equal(result.checkpointIndex, 0)
  assert.match(result.feedback, /Stop inside/)
  assert.equal(result.assessment, 'pending')
})
test('stationary spawn inside a checkpoint cannot satisfy it; active exit and re-entry are required', () => {
  for (const stopRequired of [false, true]) {
    const spawnCourse: DrivingRoute = { ...COURSE, checkpoints: [
      { id: 'spawn-check', center: { x: 0, z: 0 }, radius: 2, stopRequired },
    ] }
    let state = createDriving(spawnCourse)
    assert.equal(state.checkpointEntry, 'blocked')
    for (let i = 0; i < 20; i++) state = stepDriving(state, { throttle: 0, brake: 1, steer: 0 }, spawnCourse).state
    assert.equal(state.checkpointIndex, 0)
    assert.equal(state.status, 'running')
    assert.equal(state.stopDwellMs, 0)
  }
})

test('overlapping next checkpoint stays blocked until the driver exits and re-enters it', () => {
  const overlap: DrivingRoute = { ...COURSE, checkpoints: [
    { id: 'first', center: { x: 0, z: 1.5 }, radius: 1, stopRequired: false },
    { id: 'overlap', center: { x: 0, z: 2.2 }, radius: 1, stopRequired: false },
  ] }
  const before = { ...createDriving(overlap), speed: 16 }
  const first = stepDriving(before, { throttle: 0, brake: 0, steer: 0 }, overlap).state
  assert.equal(first.checkpointIndex, 1)
  assert.equal(first.checkpointEntry, 'blocked')
  const held = stepDriving({ ...first, speed: 0 }, { throttle: 0, brake: 1, steer: 0 }, overlap).state
  assert.equal(held.checkpointIndex, 1)
  assert.equal(held.checkpointEntry, 'blocked')
})

test('untrusted controls require exact finite bounded fields and fail safely', () => {
  const start = createDriving(COURSE)
  for (const controls of [{ throttle: 1, brake: 0, steer: 0, passed: true }, { throttle: Number.NaN, brake: 0, steer: 0 }, { throttle: 1.01, brake: 0, steer: 0 }, { throttle: 0, brake: 0, steer: -1.01 }, { throttle: 0, brake: 0 }]) {
    const result = stepDriving(start, controls, COURSE).state
    assert.deepEqual([result.status, result.speed, result.checkpointIndex, result.assessment], ['paused', 0, 0, 'pending'])
  }
})

test('a fast swept crossing records a checkpoint without trusting a client coordinate', () => {
  const narrow: DrivingRoute = { ...COURSE, checkpoints: [
    { id: 'gate', center: { x: 0.9, z: 0.8 }, radius: 1, stopRequired: false },
    { id: 'next', center: { x: 0, z: 4 }, radius: 2, stopRequired: false },
  ] }
  const state: DrivingState = { ...createDriving(narrow), speed: 16 }
  const result = stepDriving(state, { throttle: 0, brake: 0, steer: 0 }, narrow).state
  assert.equal(result.checkpointIndex, 1, 'the segment sweep sees the gate crossed between fixed steps')
  assert.equal(result.position.z < 2, true, 'position came from the simulation step')
})

test('pause and route-version changes stop motion and discard partial dwell', () => {
  const moving = stepDriving(createDriving(COURSE), { throttle: 1, brake: 0, steer: 0 }, COURSE).state
  const paused = pauseDriving(moving)
  assert.equal(paused.status, 'paused')
  assert.equal(paused.speed, 0)
  const updatedRoute = { ...COURSE, version: 'authored-course-v2' }
  const changed = stepDriving(moving, { throttle: 1, brake: 0, steer: 0 }, updatedRoute).state
  assert.equal(changed.status, 'paused')
  assert.equal(changed.speed, 0)
})

test('a long scripted drive wraps heading and reloads paused with no carried speed or dwell', () => {
  const wideCourse: DrivingRoute = { ...COURSE, version: 'turning-range-v1',
    roads: [[{ x: 0, z: -100 }, { x: 0, z: 100 }], [{ x: -100, z: 0 }, { x: 100, z: 0 }]],
    checkpoints: [{ id: 'far-gate', center: { x: 0, z: 80 }, radius: 2, stopRequired: false }],
    roadWidth: 40, speedLimit: 40 }
  let state = createDriving(wideCourse)
  for (let i = 0; i < 500 && state.status === 'running'; i++) {
    state = stepDriving(state, { throttle: 1, brake: 0, steer: 1 }, wideCourse).state
  }
  assert.ok(Math.abs(state.heading) <= Math.PI)
  const live = stepDriving(createDriving(COURSE), { throttle: 1, brake: 0, steer: 0 }, COURSE).state
  const resumedLater = readDrivingState(JSON.parse(JSON.stringify(live)), COURSE)
  assert.deepEqual([resumedLater.status, resumedLater.speed, resumedLater.stopDwellMs], ['paused', 0, 0])
  const terminal = driveCourse()
  assert.deepEqual(readDrivingState(JSON.parse(JSON.stringify(terminal)), COURSE), terminal)
})

test('reload inside a partially entered stop resets dwell and requires a fresh boundary entry', () => {
  const stopCourse: DrivingRoute = { ...COURSE, checkpoints: [
    { id: 'stop', center: { x: 0, z: 2 }, radius: 1, stopRequired: true },
  ] }
  const entered = stepDriving({ ...createDriving(stopCourse), speed: 16 }, { throttle: 0, brake: 0, steer: 0 }, stopCourse).state
  assert.equal(entered.checkpointEntry, 'entered')
  const loaded = readDrivingState(JSON.parse(JSON.stringify(entered)), stopCourse)
  assert.equal(loaded.status, 'paused')
  assert.equal(loaded.checkpointEntry, 'blocked')
  assert.equal(loaded.stopDwellMs, 0)
})

test('malformed, out-of-road and hostile terminal saves become safe pauses', () => {
  const live = stepDriving(createDriving(COURSE), { throttle: 1, brake: 0, steer: 0 }, COURSE).state
  const malformed = readDrivingState({ ...live, speed: Infinity }, COURSE)
  assert.equal(malformed.status, 'paused')
  assert.equal(malformed.speed, 0)
  const outside = readDrivingState({ ...live, position: { x: 50, z: 50 } }, COURSE)
  assert.equal(outside.status, 'paused')
  assert.equal(outside.speed, 0)
  const stale = readDrivingState(live, { ...COURSE, version: 'new-course' })
  assert.equal(stale.status, 'paused')
  for (const forged of [
    { ...live, status: 'complete', checkpointIndex: COURSE.checkpoints.length, speed: 0, stopDwellMs: 0, assessment: 'passed', score: 0 },
    { ...live, status: 'complete', checkpointIndex: COURSE.checkpoints.length, speed: 0, stopDwellMs: 0, assessment: 'failed', score: 100 },
    { ...live, status: 'complete', checkpointIndex: COURSE.checkpoints.length, speed: 0, stopDwellMs: 0, assessment: 'pending' },
    { ...live, status: 'running', checkpointIndex: COURSE.checkpoints.length, assessment: 'pending' },
  ]) assert.equal(readDrivingState(forged, COURSE).status, 'paused')
})

test('leaving the road stops at the last safe point instead of snapping to another road', () => {
  const narrow = { ...COURSE, roadWidth: 2 }
  const state: DrivingState = { ...createDriving(narrow), position: { x: 1.5, z: 0 }, heading: Math.PI / 2, speed: 16 }
  const result = stepDriving(state, { throttle: 0, brake: 0, steer: 0 }, narrow).state
  assert.deepEqual(result.position, state.position)
  assert.equal(result.speed, 0)
  assert.match(result.feedback, /left the road/)
})
test('swept road checks reject a sub-step off-road gap between disconnected polylines', () => {
  const gap: DrivingRoute = { ...COURSE, roads: [[{ x: -10, z: 1.65 }, { x: 0, z: 1.65 }], [{ x: 1.6, z: -1.65 }, { x: 10, z: -1.65 }]], checkpoints: [{ id: 'nearby', center: { x: 0, z: 0 }, radius: 3, stopRequired: false }], roadWidth: 2 }
  const state: DrivingState = { ...createDriving(gap), position: { x: 0, z: 0 }, heading: Math.PI / 2, speed: 16, checkpointEntry: 'blocked' }
  const result = stepDriving(state, { throttle: 0, brake: 0, steer: 0 }, gap).state
  assert.deepEqual(result.position, state.position)
  assert.equal(result.speed, 0)
  assert.match(result.feedback, /left the road/)
})

test('analytic road coverage catches a 1 cm gap that bounded sampling can miss', () => {
  const gap: DrivingRoute = { ...COURSE, roads: [[{ x: -10, z: 0 }, { x: 10, z: 0 }], [{ x: -10, z: 3.31 }, { x: 10, z: 3.31 }]], checkpoints: [{ id: 'nearby', center: { x: 0, z: 0 }, radius: 2, stopRequired: false }], roadWidth: 2 }
  const state: DrivingState = { ...createDriving(gap), position: { x: 0, z: 0.85 }, heading: 0, speed: 16, checkpointEntry: 'blocked' }
  const result = stepDriving(state, { throttle: 0, brake: 0, steer: 0 }, gap).state
  assert.deepEqual(result.position, state.position)
  assert.equal(result.speed, 0)
  assert.match(result.feedback, /left the road/)
})
