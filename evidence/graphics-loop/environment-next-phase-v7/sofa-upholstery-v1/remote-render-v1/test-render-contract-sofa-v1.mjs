import assert from 'node:assert/strict'
import test from 'node:test'
import { capturesForScope, validateCaptureSnapshot } from './scope-plan-sofa-v1.mjs'

test('remote sofa matrix is eight matched real Home captures with the seated activity requested', () => {
  const rows = capturesForScope('sofa-home')
  assert.equal(rows.length, 8)
  assert.equal(new Set(rows.map(row => row.label)).size, 8)
  for (const variant of ['baseline', 'candidate']) for (const time of ['day', 'night']) for (const camera of ['normal', 'close']) {
    assert.ok(rows.some(row => row.variant === variant && row.time === time && row.camera === camera && row.pose === 'sit' && row.place === 'home'))
  }
})

test('capture validity requires same variant/time/camera and canonical seated Home readiness', () => {
  const expected = { place: 'home', variant: 'candidate', time: 'day', camera: 'close' }
  const good = { fixture: { place: 'home', variant: 'candidate', time: 'day', cameraPreset: 'close', homePose: 'sit', sofaSeatActivity: 'home-sit-down' },
    host: { location: 'home', avatar: {} }, readiness: { status: 'READY_CANONICAL' }, capture: { validForCanonicalVisualReview: true }, canvas: { drawingBuffer: { width: 1280 } } }
  assert.equal(validateCaptureSnapshot(good, expected).valid, true)
  assert.equal(validateCaptureSnapshot({ ...good, fixture: { ...good.fixture, cameraPreset: 'normal' } }, expected).valid, false)
  assert.equal(validateCaptureSnapshot({ ...good, capture: { validForCanonicalVisualReview: false } }, expected).valid, false)
})
