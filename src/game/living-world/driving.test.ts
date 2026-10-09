import assert from 'node:assert/strict'
import test from 'node:test'
import { createDriving, pauseDriving, readDrivingState, readValidatedDrivingState, stepDriving } from './driving.ts'
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
test('a car stopped at a road edge can make a server-stepped reverse move without a pivot or snap', () => {
  const narrow: DrivingRoute = { ...COURSE, roads: [[{ x: 0, z: 0 }, { x: 0, z: 12 }]],
    checkpoints: [{ id: 'end', center: { x: 0, z: 10 }, radius: 1, stopRequired: true }], roadWidth: 2 }
  const edge: DrivingState = { ...createDriving(narrow), position: { x: 1.64, z: 5 }, heading: Math.PI / 2, speed: 0 }
  const forward = stepDriving(edge, { throttle: 1, brake: 0, steer: 0 }, narrow).state
  assert.deepEqual(forward.position, edge.position)
  assert.equal(forward.speed, 0)
  assert.equal(forward.status, 'running')
  const reverse = stepDriving(edge, { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, narrow).state
  assert.equal(reverse.status, 'running')
  assert.ok(reverse.speed > 0)
  assert.equal(Object.hasOwn(reverse, 'gear'), true, 'the reverse direction is explicit in the versioned state')
  assert.ok(reverse.position.x < edge.position.x, 'the server computed a backward move along the current heading')
  assert.equal(reverse.heading, edge.heading)
  assert.equal(reverse.checkpointIndex, 0)
  assert.equal(reverse.assessment, 'pending')
  assert.equal(reverse.score, edge.score, 'reverse movement grants no score or assessment progress')
})
test('reverse entry into an armed checkpoint is blocked, retained and usable on the next frame', () => {
  const course: DrivingRoute = { ...COURSE, roads: [[{ x: 0, z: 0 }, { x: 0, z: 12 }]],
    checkpoints: [{ id: 'target', center: { x: 0, z: 2 }, radius: 1, stopRequired: false }], roadWidth: 10 }
  const outside: DrivingState = { ...createDriving(course), position: { x: 0, z: 3.1 }, heading: 0,
    speed: 3, gear: 'reverse', checkpointEntry: 'armed', checkpointIndex: 0 }
  const crossed = stepDriving(outside, { throttle: 0, brake: 0, steer: 0, gear: 'reverse' }, course).state
  assert.ok(Math.hypot(crossed.position.x, crossed.position.z - 2) < 1, 'the reverse step enters the active zone')
  assert.equal(crossed.checkpointIndex, 0, 'reverse never awards the checkpoint')
  assert.equal(crossed.checkpointEntry, 'blocked')
  assert.equal(crossed.stopDwellMs, 0)
  const retained = readValidatedDrivingState(JSON.parse(JSON.stringify(crossed)), course, 2)
  assert.ok(retained, 'the reverse-entered state survives the strict v2 reader')
  assert.equal(retained.checkpointIndex, 0)
  assert.equal(retained.checkpointEntry, 'blocked')
  const next = stepDriving(retained, { throttle: 0, brake: 0, steer: 0, gear: 'reverse' }, course).state
  assert.equal(next.status, 'running', 'the retained blocked state remains usable on the next server frame')
  assert.equal(next.checkpointIndex, 0)
  assert.equal(next.stopDwellMs, 0)
  let leaving = next
  for (let i = 0; i < 12 && leaving.checkpointEntry === 'blocked'; i++) leaving = stepDriving(leaving,
    { throttle: 0, brake: 0, steer: 0, gear: 'reverse' }, course).state
  assert.equal(leaving.checkpointEntry, 'armed', 'reverse exit rearms but never awards the checkpoint')
  assert.equal(leaving.checkpointIndex, 0)
})

test('continued reverse motion stays on the road and cannot award a checkpoint', () => {
  const narrow: DrivingRoute = { ...COURSE, roads: [[{ x: 0, z: 0 }, { x: 0, z: 12 }]],
    checkpoints: [{ id: 'end', center: { x: 0, z: 10 }, radius: 1, stopRequired: true }], roadWidth: 2 }
  const edge: DrivingState = { ...createDriving(narrow), position: { x: 1.64, z: 5 }, heading: Math.PI / 2, speed: 0 }
  let reverse = stepDriving(edge, { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, narrow).state
  for (let i = 0; i < 12; i++) reverse = stepDriving(reverse, { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, narrow).state
  assert.ok(Math.abs(reverse.position.x) < Math.abs(edge.position.x), 'the swept path remains inside the road corridor while backing away')
  assert.ok(reverse.speed <= 3, 'the v2 reverse cap remains manoeuvring speed')
  assert.equal(readValidatedDrivingState(reverse, narrow, 2)?.speed, reverse.speed, 'v2 reverse speed remains a nonnegative magnitude')
  assert.equal(reverse.gear, 'reverse')
  assert.equal(reverse.checkpointIndex, 0, 'reverse cannot award checkpoint progress')
  assert.equal(reverse.assessment, 'pending')
  assert.equal(reverse.heading, edge.heading, 'straight reverse does not invent a heading pivot')
})
test('direction changes brake to zero before reverse travel and reverse steering yaw is signed', () => {
  const moving: DrivingState = { ...createDriving(COURSE), position: { x: 0, z: 4 }, speed: 1 }
  const braking = stepDriving(moving, { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, COURSE).state
  assert.ok(braking.speed > 0 && braking.speed < moving.speed)
  assert.ok(braking.position.z > moving.position.z, 'the car continues forward while braking; velocity never flips')
  const stopped = stepDriving(braking, { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, COURSE).state
  assert.equal(stopped.speed, 0)
  assert.equal(stopped.position.z, braking.position.z)
  const backing = stepDriving(stopped, { throttle: 1, brake: 0, steer: 1, gear: 'reverse' }, COURSE).state
  assert.ok(backing.speed > 0)
  assert.equal(backing.gear, 'reverse')
  assert.ok(backing.position.z < stopped.position.z)
  assert.ok(backing.heading < 0, 'reverse steers with the opposite bicycle yaw')
  assert.ok(backing.speed <= 3, 'reverse is capped at 3 m/s for low-speed manoeuvring')

  let movingReverse: DrivingState = { ...createDriving(COURSE), position: { x: 0, z: 4 }, heading: 0 }
  for (let i = 0; i < 8; i++) movingReverse = stepDriving(movingReverse,
    { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, COURSE).state
  const shiftForward = stepDriving(movingReverse, { throttle: 1, brake: 0, steer: 0, gear: 'forward' }, COURSE).state
  assert.equal(shiftForward.gear, 'reverse', 'forward request cannot flip a moving reverse vehicle')
  assert.ok(shiftForward.speed < movingReverse.speed && shiftForward.speed > 0)
  assert.ok(shiftForward.position.z < movingReverse.position.z, 'it continues backing while braking')
  let settled = shiftForward
  for (let i = 0; i < 5 && settled.gear !== 'forward'; i++) settled = stepDriving(settled,
    { throttle: 1, brake: 0, steer: 0, gear: 'forward' }, COURSE).state
  assert.deepEqual([settled.speed, settled.gear], [0, 'forward'], 'the v2 gear changes only at rest')
  const forwardAgain = stepDriving(settled, { throttle: 1, brake: 0, steer: 0, gear: 'forward' }, COURSE).state
  assert.ok(forwardAgain.speed > 0 && forwardAgain.position.z > settled.position.z)
})
test('requesting reverse cancels partial stop dwell and requires a fresh forward entry', () => {
  const stopCourse: DrivingRoute = { ...COURSE, checkpoints: [
    { id: 'stop', center: { x: 0, z: 2 }, radius: 1, stopRequired: true },
  ] }
  const almostDone: DrivingState = { ...createDriving(stopCourse), position: { x: 0, z: 2 }, checkpointEntry: 'entered', stopDwellMs: 900 }
  const reversed = stepDriving(almostDone, { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, stopCourse).state
  assert.deepEqual([reversed.checkpointIndex, reversed.checkpointEntry, reversed.stopDwellMs, reversed.gear], [0, 'blocked', 0, 'reverse'])
  assert.equal(reversed.assessment, 'pending')
  let exiting = reversed
  for (let i = 0; i < 12 && exiting.checkpointEntry === 'blocked'; i++) exiting = stepDriving(exiting,
    { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, stopCourse).state
  assert.equal(exiting.checkpointEntry, 'armed', 'the driver must exit the zone before it can be approached again')
  assert.equal(exiting.checkpointIndex, 0)
})
test('legacy frames stay forward-compatible and malformed reverse selectors fail closed', () => {
  const start = createDriving(COURSE)
  const legacy = stepDriving(start, { throttle: 1, brake: 0, steer: 0 }, COURSE).state
  const explicitForward = stepDriving(start, { throttle: 1, brake: 0, steer: 0, gear: 'forward' }, COURSE).state
  assert.equal(Object.hasOwn(legacy, 'gear'), false, 'legacy control and state shapes remain unchanged')
  assert.deepEqual({ ...legacy, gear: 'forward' }, explicitForward)
  assert.equal(readValidatedDrivingState(legacy, COURSE, 1)?.gear, undefined, 'strict v1 reads remain forward-only')
  assert.equal(readValidatedDrivingState({ ...legacy, speed: 20 }, COURSE, 1)?.speed, 20, 'the v1 reader preserves its original saved-speed bound')
  for (const controls of [
    { throttle: 1, brake: 0, steer: 0, gear: 'park' },
    { throttle: 1, brake: 0, steer: 0, gear: undefined },
    { throttle: 1, brake: 0, steer: 0, gear: 'reverse', position: { x: 0, z: 1000 } },
  ]) assert.equal(stepDriving(start, controls, COURSE).state.status, 'paused')
  const liveReverse = stepDriving(start, { throttle: 1, brake: 0, steer: 0, gear: 'reverse' }, COURSE).state
  assert.ok(liveReverse.speed > 0 && liveReverse.speed <= 3)
  assert.equal(readValidatedDrivingState(liveReverse, COURSE), null, 'the default strict reader remains v1 for unrelated consumers')
  const restored = readDrivingState(JSON.parse(JSON.stringify(liveReverse)), COURSE, 2)
  assert.deepEqual([restored.status, restored.speed, restored.gear], ['paused', 0, 'forward'], 'v2 reload clears motion and defaults gear before explicit resume')
  assert.equal(readValidatedDrivingState({ ...legacy, gear: 'reverse' }, COURSE, 1), null, 'v1 cannot silently acquire reverse fields')
  assert.equal(readValidatedDrivingState(liveReverse, COURSE, 1), null, 'v1 reader rejects v2 state shapes')
  assert.equal(readValidatedDrivingState({ ...liveReverse, speed: 3.01 }, COURSE, 2), null, 'reverse above its bound is quarantined')
  assert.equal(readValidatedDrivingState({ ...liveReverse, speed: -0.1 }, COURSE, 2), null, 'v2 speed remains a nonnegative magnitude')
  assert.equal(readValidatedDrivingState({ ...liveReverse, gear: undefined }, COURSE, 2), null, 'v2 requires a strict gear field')
})
test('rejected forward steering stops without changing the last accepted heading', () => {
  const narrow: DrivingRoute = { ...COURSE, roads: [[{ x: 0, z: 0 }, { x: 0, z: 12 }]],
    checkpoints: [{ id: 'end', center: { x: 0, z: 10 }, radius: 1, stopRequired: true }], roadWidth: 2 }
  const edge: DrivingState = { ...createDriving(narrow), position: { x: 1.64, z: 5 }, heading: Math.PI / 2, speed: 1 }
  const rejected = stepDriving(edge, { throttle: 0, brake: 0, steer: 1 }, narrow).state
  assert.deepEqual(rejected.position, edge.position)
  assert.equal(rejected.speed, 0)
  assert.equal(rejected.heading, edge.heading)
  assert.equal(rejected.score, edge.score - 25, 'the existing off-road penalty is not forgiven')
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

// The route adapter must distinguish a corrupted save from a valid paused lesson.
test('strict saved-state validation preserves live state without moving and rejects inconsistent records', () => {
  const live = stepDriving(createDriving(COURSE), { throttle: 1, brake: 0, steer: 0 }, COURSE).state
  const saved = JSON.stringify(live)
  assert.deepEqual(readValidatedDrivingState(JSON.parse(saved), COURSE), live)
  assert.equal(JSON.stringify(live), saved)
  for (const value of [null, {}, { ...live, position: null }, { ...live, assessment: 'passed' },
    { ...live, status: 'paused', speed: 1 }, { ...live, routeVersion: 'stale' },
    { ...live, checkpointIndex: COURSE.checkpoints.length, status: 'complete', speed: 0, assessment: 'pending' }]) {
    assert.equal(readValidatedDrivingState(value, COURSE), null)
  }
})
