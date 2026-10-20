// Camera shake from trauma: decays to zero fast, identical inputs give identical output, offsets grow with the square of trauma.
import test from 'node:test'
import assert from 'node:assert/strict'
import { K_X, K_Y, createShake, decayTrauma, shakeOffset } from './shake.ts'

test('trauma 0.4 is gone within 600 ms at 60 and at 30 frames a second, and the offset is exactly zero then', () => {
  for (const fps of [60, 30, 20]) {
    const shake = createShake()
    shake.kick(0.4)
    let ms = 0, running = true
    while (running && ms < 600) { running = shake.step(1 / fps); ms += 1000 / fps }
    assert.equal(running, false, `${fps} fps still shaking after ${ms} ms`)
    assert.equal(shake.trauma, 0)
    assert.deepEqual(shake.offset(1), { x: 0, y: 0 })
  }
  assert.equal(decayTrauma(0.4, 0.6), 0)
})

test('the same inputs give the same output, and nothing is random', () => {
  const run = () => { const s = createShake(); s.kick(0.6); const out: number[] = []; for (let i = 0; i < 20; i++) { s.step(1 / 60); const o = s.offset(2); out.push(o.x, o.y) } return out }
  assert.deepEqual(run(), run())
  assert.deepEqual(shakeOffset(0.5, 1.234, 3), shakeOffset(0.5, 1.234, 3))
  const randomUsed = Math.random
  Math.random = () => { throw new Error('shake must not use Math.random') }
  try { run() } finally { Math.random = randomUsed }
})

test('the offset is max · trauma² · sin(k · clock) on two axes with different speeds, and stays inside max', () => {
  const clock = 0.0137
  const o = shakeOffset(0.5, clock, 4)
  assert.ok(Math.abs(o.x - 4 * 0.25 * Math.sin(K_X * clock)) < 1e-12)
  assert.ok(Math.abs(o.y - 4 * 0.25 * Math.sin(K_Y * clock + 1.3)) < 1e-12)
  assert.notEqual(K_X, K_Y)
  for (let c = 0; c < 2; c += 0.0031) { const p = shakeOffset(1, c, 3); assert.ok(Math.abs(p.x) <= 3 && Math.abs(p.y) <= 3) }
  // Half the trauma is a quarter of the movement.
  const full = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(shakeOffset(1, i * 0.005, 1).x)))
  const half = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(shakeOffset(0.5, i * 0.005, 1).x)))
  assert.ok(Math.abs(half / full - 0.25) < 1e-9)
})

test('kicks add up to at most 1, bad numbers are ignored, and an idle shake asks for no frames', () => {
  const shake = createShake()
  assert.equal(shake.step(0.016), false)
  shake.kick(0.7); shake.kick(0.7); assert.equal(shake.trauma, 1)
  shake.kick(NaN); shake.kick(-1); assert.equal(shake.trauma, 1)
  shake.clear(); assert.equal(shake.trauma, 0)
})

test('apply moves the camera sideways along the screen and up, never along its view, and nothing at rest', () => {
  const shake = createShake()
  const at = { x: 3, y: 5, z: 7 }
  shake.apply(at, 0.6, 1); assert.deepEqual(at, { x: 3, y: 5, z: 7 })
  shake.kick(1); shake.step(0.01)
  const azimuth = 0.6, moved = { x: 3, y: 5, z: 7 }
  shake.apply(moved, azimuth, 2)
  const dx = moved.x - 3, dz = moved.z - 7, dy = moved.y - 5
  // The camera looks along (-sin a, -cos a): a sideways move has no part along that line.
  assert.ok(Math.abs(dx * -Math.sin(azimuth) + dz * -Math.cos(azimuth)) < 1e-12)
  assert.ok(Math.hypot(dx, dz) > 0 || dy !== 0)
  assert.ok(Math.hypot(dx, dz) <= 2 && Math.abs(dy) <= 2)
})
