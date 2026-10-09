import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { waitForSceneSnapshot, waitForReadinessReceipt, persistCaptureReceipt } from './remote-control-v6.mjs'

let reads = 0
const transition = await waitForSceneSnapshot(async () => ++reads < 2
  ? { fixture: { place: 'market', time: 'day' }, host: { location: 'market', easing: true, loop: { running: true }, avatar: { moving: false } } }
  : { fixture: { place: 'home', time: 'night' }, controlState: { hostGeneration: 2 }, host: { location: 'home', easing: false, loop: { running: true }, avatar: { moving: false } } },
{ place: 'home', time: 'night' }, { timeoutMs: 100, pollMs: 1, pause: async () => {} })
assert.equal(transition.settled, true)
assert.equal(reads, 3)

// A live render loop is expected at idle; only movement/easing should delay scene capture.
let settleRead = 0
const idleActiveLoop = await waitForSceneSnapshot(async () => {
  settleRead++
  return { fixture: { place: 'neighbourhood', time: 'day' }, controlState: { hostGeneration: 4 },
    host: { location: 'neighbourhood', loop: { running: true }, easing: false, avatar: { moving: false } } }
}, { place: 'neighbourhood', time: 'day' }, { timeoutMs: 100, pollMs: 1, pause: async () => {} })
assert.equal(idleActiveLoop.settled, true)
assert.equal(settleRead, 2)
let activeMotionReads = 0
const stillMoving = await waitForSceneSnapshot(async () => {
  activeMotionReads++
  return { fixture: { place: 'neighbourhood', time: 'day' }, controlState: { hostGeneration: 4 },
    host: { location: 'neighbourhood', loop: { running: true }, easing: false, avatar: { moving: true } } }
}, { place: 'neighbourhood', time: 'day' }, { timeoutMs: 100, pollMs: 1, pause: async () => {} })
assert.equal(stillMoving.settled, false)
assert.ok(activeMotionReads > 2)

let easingReads = 0
const transitionWaitsForEaseOut = await waitForSceneSnapshot(async () => {
  easingReads++
  const settled = easingReads >= 3
  return { fixture: { place: 'market', time: 'night' }, controlState: { hostGeneration: 7 },
    host: { location: 'market', loop: { running: true }, easing: !settled, avatar: { moving: easingReads === 2 } } }
}, { place: 'market', time: 'night' }, { timeoutMs: 100, pollMs: 1, pause: async () => {} })
assert.equal(transitionWaitsForEaseOut.settled, true)
assert.equal(easingReads, 4)

let polls = 0
const waited = await waitForReadinessReceipt(async () => {
  polls++
  return { controlState: { readinessWaitReceipts: [{ id: 12, state: polls === 1 ? 'running' : 'ready' }] } }
}, async () => 12, { afterId: 11, timeoutMs: 100, pollMs: 1, pause: async () => {} })
assert.equal(waited.waitId, 12)
assert.equal(waited.receipt.state, 'ready')
await assert.rejects(() => waitForReadinessReceipt(async () => ({}), async () => 11, { afterId: 11 }))

const root = mkdtempSync(path.join(os.tmpdir(), 'graphics-v6-capture-'))
try {
  mkdirSync(path.join(root, 'images'))
  writeFileSync(path.join(root, 'images/home-night.png'), Buffer.from('synthetic capture bytes'))
  const snapshot = { capture: { capturedAt: '2026-10-09T10:00:00Z', validForSceneReview: true, validForCanonicalVisualReview: true },
    fixture: { place: 'home', time: 'night' }, host: { location: 'home' }, readiness: { status: 'READY_CANONICAL' },
    controlState: { readinessWaitReceipts: [] } }
  const receipt = await persistCaptureReceipt(root, { sequence: 1, label: 'home-night', imageFile: 'images/home-night.png', snapshot,
    expected: { place: 'home', time: 'night' }, wait: { waitId: 1, receipt: { state: 'ready' }, timedOut: false } })
  assert.equal(receipt.valid, true)
  assert.equal(JSON.parse(readFileSync(path.join(root, 'captures-progress.jsonl'), 'utf8').trim()).image.path, 'images/home-night.png')
  await assert.rejects(() => persistCaptureReceipt(root, { sequence: 2, label: 'escape', imageFile: '../outside.png', snapshot,
    expected: { place: 'home', time: 'night' } }))
} finally { rmSync(root, { recursive: true, force: true }) }
console.log('structured remote control and durable capture tests: PASS')
