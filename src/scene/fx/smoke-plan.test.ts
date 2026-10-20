// Smoke, planned (smoke-plan.ts): sources from the landmarks a scene names, puffs as a pure function of (index, seconds).
import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_SOURCES, PUFFS, SMOKE, puffAt, smokeSources } from './smoke-plan.ts'
import type { SmokeSource } from './smoke-plan.ts'

const GRILL = { key: 'grill', x: 8.2, z: 4.6 }

test('a grill landmark smokes; a bar that merely matches the word in its regex does not', () => {
  const sources = smokeSources([{ key: 'bar', x: 0, z: 0 }, GRILL, { key: 'hall', x: 1, z: 1 }])
  assert.deepEqual(sources, [{ kind: 'grill', x: 8.2, y: SMOKE.grill.lift, z: 4.6 }])
  assert.deepEqual(smokeSources([]), [])
})

test('a generator exhausts only while it is running, at its landmark or else behind the venue', () => {
  const named = { key: 'generator', x: -9, z: -9 }
  assert.deepEqual(smokeSources([named]), [])
  assert.equal(smokeSources([named], { generatorRunning: true })[0]!.x, -9)
  assert.deepEqual(smokeSources([], { generatorRunning: false, behind: { x: 3, z: -12 } }), [])
  const behind = smokeSources([GRILL], { generatorRunning: true, behind: { x: 3, z: -12 } })
  assert.deepEqual(behind.map((source) => source.kind), ['grill', 'generator'])
  assert.equal(behind[1]!.z, -12)
})

test('never more than four sources, and bad numbers are ignored', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ key: `grill-${i}`, x: i, z: 0 }))
  assert.equal(smokeSources(many).length, MAX_SOURCES)
  assert.deepEqual(smokeSources([{ key: 'grill', x: Number.NaN, z: 0 }]), [])
})

test('puffs: the same inputs, the same puff; they rise and thin out over their life and begin again', () => {
  const source: SmokeSource = { kind: 'grill', x: 8, y: 1.7, z: 4 }
  const wind = [3, 1] as const
  assert.deepEqual(puffAt(source, 0, 3, 12, 7.5, wind), puffAt(source, 0, 3, 12, 7.5, wind))
  const per = PUFFS.wide
  for (let k = 0; k < per; k++) {
    const early = puffAt(source, 0, k, per, 10, wind)
    const later = puffAt(source, 0, k, per, 10 + 0.3, wind)
    if (later.age > early.age) { assert.ok(later.y > early.y, 'rising'); assert.ok(later.size > early.size, 'growing') }
    assert.ok(early.alpha >= 0 && early.alpha <= SMOKE.grill.alpha)
    assert.ok(early.y >= source.y && early.y <= source.y + SMOKE.grill.rise)
  }
  const again = puffAt(source, 0, 2, per, 5, wind), life = puffAt(source, 0, 2, per, 5 + SMOKE.grill.life, wind)
  assert.ok(Math.abs(again.age - life.age) < 1e-9, 'one life later it is at the same age')
})

test('the wind leans the plume downwind', () => {
  const source: SmokeSource = { kind: 'generator', x: 0, y: 1.4, z: 0 }
  const calm = puffAt(source, 0, 4, 12, 6, [0, 0]), blown = puffAt(source, 0, 4, 12, 6, [4, 0])
  assert.ok(blown.x > calm.x)
  assert.ok(PUFFS.phone < PUFFS.wide && PUFFS.wide < PUFFS.high)
})
