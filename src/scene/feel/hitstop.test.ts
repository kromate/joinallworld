// Hit-stop: frozen for N ms of real time, then time flows again; never longer than the cap; never blocks anything.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HIT_STOP_MAX_MS, createHitStop } from './hitstop.ts'

test('time stops for the asked milliseconds of the real clock and then runs again', () => {
  let t = 1000
  const stop = createHitStop(() => t)
  assert.equal(stop.advance(0.016), 0.016)
  stop.freeze(70)
  assert.equal(stop.frozen, true)
  assert.equal(stop.advance(0.016), 0)
  t += 69; assert.equal(stop.advance(0.016), 0)
  t += 1; assert.equal(stop.frozen, false); assert.equal(stop.advance(0.016), 0.016)
})

test('a slow frame does not make the freeze longer: it is measured in real time, not in frames', () => {
  let t = 0
  const stop = createHitStop(() => t)
  stop.freeze(60)
  t += 200 // one very long frame
  assert.equal(stop.advance(0.05), 0.05)
})

test('a new freeze never shortens a running one, is capped, and bad values do nothing', () => {
  let t = 0
  const stop = createHitStop(() => t)
  stop.freeze(80); stop.freeze(30); t += 79; assert.equal(stop.frozen, true)
  t = 1000; stop.freeze(10000); t += HIT_STOP_MAX_MS - 1; assert.equal(stop.frozen, true); t += 1; assert.equal(stop.frozen, false)
  stop.freeze(NaN); stop.freeze(-5); stop.freeze(0); assert.equal(stop.frozen, false)
})
