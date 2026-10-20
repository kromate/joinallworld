// Feel tiers: every moment has one, only the large tier shakes, a large moment is not repeated inside 2 s, a fight hit freezes 50-90 ms.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EVENT_TIERS, HIT_STOP_STRONG_MS, LARGE_GAP_MS, TIERS, createTierGate, feelFor, fightHitStopMs } from './tiers.ts'
import type { FeelEvent } from './tiers.ts'

const EVENTS = Object.keys(EVENT_TIERS) as FeelEvent[]

test('every game moment has a tier, and the table names the ones the plan asks for', () => {
  assert.deepEqual([...EVENTS].sort(), ['danfo-stop', 'election-won', 'fight-hit', 'football-goal', 'goal-done', 'level-up', 'pay-received'])
  for (const event of EVENTS) {
    const feel = feelFor(event)
    assert.ok(feel.tier in TIERS, event)
    assert.equal(feel.sound, TIERS[feel.tier].sound)
  }
  const tiers = Object.fromEntries(EVENTS.map((event) => [event, feelFor(event).tier]))
  assert.deepEqual(tiers, { 'goal-done': 'large', 'pay-received': 'medium', 'level-up': 'large', 'fight-hit': 'medium', 'football-goal': 'large', 'danfo-stop': 'small', 'election-won': 'large' })
})

test('only the large tier shakes the camera, and the tiers grow', () => {
  assert.equal(TIERS.small.trauma, 0)
  assert.equal(TIERS.medium.trauma, 0)
  assert.ok(TIERS.large.trauma > 0 && TIERS.large.trauma <= 1)
  assert.ok(TIERS.small.burst < TIERS.medium.burst && TIERS.medium.burst < TIERS.large.burst)
  assert.ok(TIERS.small.pop < TIERS.medium.pop && TIERS.medium.pop <= TIERS.large.pop)
  for (const event of EVENTS) if (feelFor(event).tier === 'small') assert.equal(feelFor(event).trauma, 0, event)
})

test('only a fight hit freezes the picture, for 50 to 90 ms, and a block not at all', () => {
  for (const event of EVENTS) if (event !== 'fight-hit') assert.equal(feelFor(event).hitStopMs, 0, event)
  assert.equal(feelFor('fight-hit').hitStopMs, 70)
  assert.equal(fightHitStopMs(false, false), 70)
  assert.equal(fightHitStopMs(true, false), HIT_STOP_STRONG_MS)
  assert.equal(fightHitStopMs(true, true), 0)
  assert.equal(fightHitStopMs(false, true), 0)
  for (const ms of [fightHitStopMs(false, false), fightHitStopMs(true, false)]) assert.ok(ms >= 50 && ms <= 90)
})

test('a large moment fires at most once every 2 s; the others are never held back', () => {
  const gate = createTierGate()
  assert.equal(gate('large', 1000), 'large')
  assert.equal(gate('large', 1000 + LARGE_GAP_MS - 1), 'medium')
  assert.equal(gate('large', 1500), 'medium')
  assert.equal(gate('small', 1600), 'small')
  assert.equal(gate('medium', 1600), 'medium')
  assert.equal(gate('large', 1000 + LARGE_GAP_MS), 'large')
  assert.equal(gate('large', 1000 + LARGE_GAP_MS + 10), 'medium')
  // Many large moments over 10 s: never more than one in any 2 s window.
  const again = createTierGate(), fired: number[] = []
  for (let t = 0; t <= 10000; t += 100) if (again('large', t) === 'large') fired.push(t)
  for (let i = 1; i < fired.length; i++) assert.ok(fired[i]! - fired[i - 1]! >= LARGE_GAP_MS)
  assert.equal(fired.length, 6)
})
