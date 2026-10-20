// Rain, planned (rain-plan.ts): every drop a pure function of (index, seconds), wrapped into a box, thinned by distance, hidden under roofs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FIELD, RAIN_COUNT, SPLASH_COUNT, dropAlpha, dropAt, drawnWidth, hash, rainCount, streakLength, underCover, wrap } from './rain-plan.ts'
import { coverFromBoxes } from './cover.ts'

const FOCUS = { x: 4, z: -7 }

test('the counts per tier are the plan\'s, and nothing falls when it is not wet', () => {
  assert.deepEqual({ ...RAIN_COUNT }, { phone: 600, wide: 2000, high: 6000 })
  assert.equal(rainCount('phone', true), 600)
  assert.equal(rainCount('wide', true), 2000)
  assert.equal(rainCount('high', true), 6000)
  for (const tier of ['phone', 'wide', 'high'] as const) assert.equal(rainCount(tier, false), 0, tier)
  assert.ok(SPLASH_COUNT.phone < SPLASH_COUNT.wide && SPLASH_COUNT.wide < SPLASH_COUNT.high)
})

test('the same inputs always give the same drop, and a different seed gives a different field', () => {
  for (const i of [0, 1, 77, 599]) assert.deepEqual(dropAt(i, 12.34, FIELD, FOCUS), dropAt(i, 12.34, FIELD, FOCUS))
  const other = { ...FIELD, seed: 7.9 }
  assert.notDeepEqual(dropAt(5, 3, FIELD, FOCUS), dropAt(5, 3, other, FOCUS))
  for (let i = 0; i < 50; i++) { const h = hash(i, 1.3); assert.ok(h >= 0 && h < 1) }
})

test('wrap puts a value in [-size/2, size/2) and leaves the ones already there', () => {
  assert.equal(wrap(0, 10), 0)
  assert.equal(wrap(4.9, 10), 4.9)
  assert.equal(wrap(5, 10), -5)
  assert.ok(Math.abs(wrap(-17, 10) - 3) < 1e-9)
  assert.ok(Math.abs(wrap(23, 10) - 3) < 1e-9)
})

test('every drop stays inside the box, from the ground to the cloud base', () => {
  for (let i = 0; i < 600; i++) for (const t of [0, 0.4, 9.7, 333.3]) {
    const d = dropAt(i, t, FIELD, FOCUS)
    assert.ok(Math.abs(d.x - FOCUS.x) <= FIELD.box / 2 + 1e-6 && Math.abs(d.z - FOCUS.z) <= FIELD.box / 2 + 1e-6, `drop ${i} at ${t}`)
    assert.ok(d.y >= 0 && d.y < FIELD.height + 1e-6)
  }
})

test('wrap continuity: a drop never moves more than its fall in the time between two looks, except where the box wraps it', () => {
  const dt = 1 / 30
  let wraps = 0
  for (let i = 0; i < 600; i++) {
    let was = dropAt(i, 0, FIELD, FOCUS)
    for (let step = 1; step <= 90; step++) {
      const now = dropAt(i, step * dt, FIELD, FOCUS)
      const dx = now.x - was.x, dy = now.y - was.y, dz = now.z - was.z
      const reach = Math.hypot(was.vx, was.vy, was.vz) * dt * 1.001 + 1e-6
      if (Math.hypot(dx, dy, dz) > reach) {
        wraps++
        // A wrap moves it whole boxes along an axis, and it is out of sight at both ends: at the edge, the cloud base or the ground.
        const along = (v: number, size: number): boolean => Math.abs(Math.abs(v) - size) < 1e-6 || Math.abs(Math.abs(v) - size) < reach
        assert.ok(along(dx, FIELD.box) || along(dz, FIELD.box) || along(dy, FIELD.height), `drop ${i} jumped (${dx}, ${dy}, ${dz})`)
        const hidden = (d: { x: number; y: number; z: number }): boolean =>
          Math.hypot(d.x - FOCUS.x, d.z - FOCUS.z) > FIELD.box * 0.28 || d.y > FIELD.height * 0.85 || d.y < reach * 2
        assert.ok(hidden(was) || hidden(now), `drop ${i} wrapped in plain sight`)
      } else {
        // Between wraps it is the straight fall: its velocity times the time.
        assert.ok(Math.abs(dx - was.vx * dt) < 1e-6 && Math.abs(dy - was.vy * dt) < 1e-6 && Math.abs(dz - was.vz * dt) < 1e-6)
      }
      was = now
    }
  }
  assert.ok(wraps > 0, 'the test saw drops wrap')
})

test('drops fall down and drift with the wind', () => {
  const a = dropAt(3, 1, FIELD, FOCUS), b = dropAt(3, 1.01, FIELD, FOCUS)
  if (Math.abs(b.y - a.y) < 1) { assert.ok(b.y < a.y); assert.ok(b.x > a.x); assert.ok(b.z > a.z) }
  assert.ok(a.vy < -FIELD.fall * 0.8 && a.vy > -FIELD.fall * 1.2)
})

test('cover: a drop under a roof is not drawn, the same drop in the open is', () => {
  const cover = coverFromBoxes([[-12, 5.9, -12, 12, 6.3, 12]], [-40, -40, 40, 40])
  const field = FIELD
  const focus = { x: 0, z: 0 }
  let under = 0, open = 0
  for (let i = 0; i < 2000; i++) {
    const d = dropAt(i, 5, field, focus)
    const covered = underCover(cover, d.x, d.y, d.z)
    const inside = Math.abs(d.x) < 11 && Math.abs(d.z) < 11
    if (inside && d.y < 5.5) { assert.equal(covered, true); assert.equal(dropAlpha(d, 20, 8, field, covered), 0); under++ }
    if (!inside && Math.abs(d.x) > 14 && Math.abs(d.z) > 14 && d.y < 5.5) { assert.equal(covered, false); open++ }
    if (inside && d.y > 7) assert.equal(covered, false, 'above the roof it falls')
  }
  assert.ok(under > 0 && open > 0)
})

test('fades: none at the camera, full in the middle, none at the box edge and the cloud base', () => {
  const mid = { y: 10 }
  assert.equal(dropAlpha(mid, 0.2, 5, FIELD, false), 0)
  assert.ok(dropAlpha(mid, 20, 5, FIELD, false) > 0.99)
  assert.equal(dropAlpha(mid, 20, FIELD.box * 0.5, FIELD, false), 0)
  assert.equal(dropAlpha({ y: FIELD.height }, 20, 5, FIELD, false), 0)
  assert.equal(dropAlpha(mid, 20, 5, FIELD, true), 0)
})

test('a drop is never thinner than about a pixel, and a streak is a dash at least and a line at most', () => {
  assert.equal(drawnWidth(0.01, 1), 0.01)
  assert.ok(Math.abs(drawnWidth(0.01, 100) - 0.11) < 1e-9)
  assert.equal(streakLength(0), 0.4)
  assert.equal(streakLength(1e6), 5.2)
  assert.ok(streakLength(17) > 0.4 && streakLength(17) < 1)
})
