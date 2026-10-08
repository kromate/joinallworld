/** An actual API controller drives the authored lesson; no completion state is seeded. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from '../test-fixture.ts'
import type { DrivingResponse } from '../../src/types/living-world.ts'
import type { DrivingPoint } from '../../src/game/living-world/driving.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'

const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const path = '/api/living-world/driving'
const road = PRACTICE_COURSE.roads[0]!
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
function projection(point: DrivingPoint): number {
  let distance = Infinity, progress = 0, total = 0
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
    const fraction = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length), 0, 1)
    const separation = Math.hypot(point.x - a.x - dx * fraction, point.z - a.z - dz * fraction)
    if (separation < distance) { distance = separation; progress = total + length * fraction }
    total += length
  }
  return progress
}
function pointAt(progress: number): DrivingPoint {
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, length = Math.hypot(b.x - a.x, b.z - a.z)
    if (progress <= length) return { x: a.x + (b.x - a.x) * progress / length, z: a.z + (b.z - a.z) * progress / length }
    progress -= length
  }
  return road[road.length - 1]!
}

test('actual control packets complete the authored stop-turn-park lesson; terminal retries preserve progress and cash', async t => {
  const f = await fixture(t)
  const created = await f.request('/api/session', { name: 'Course driver', onboarding: true })
  const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0]!
  assert.equal((await f.action(cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  const lifeBefore = await (await f.request('/api/life?city=lagos', null, cookie)).json() as { state: { cash: number; ledger: unknown[] } }
  const post = async (suffix: string, body: object) => await (await f.request(path + suffix, body, cookie)).json() as DrivingResponse
  let answer = await post('/start', { cityId: 'lagos', requestId: f.id() })
  assert.ok(answer.ok && answer.session)
  let progress = 0, frame = 0, lastPacket: object | null = null
  const seen = new Set<number>([0])
  while (answer.session!.state.status === 'running' && frame < 500) {
    const state = answer.session!.state
    seen.add(state.checkpointIndex)
    progress = Math.max(progress, projection(state.position))
    const target = pointAt(progress + 3.5)
    const targetHeading = Math.atan2(target.x - state.position.x, target.z - state.position.z)
    const headingError = Math.atan2(Math.sin(targetHeading - state.heading), Math.cos(targetHeading - state.heading))
    const steer = clamp(Math.atan2(2 * 2.6 * Math.sin(headingError), 3.5) / 0.62, -1, 1)
    const checkpoint = PRACTICE_COURSE.checkpoints[state.checkpointIndex]!
    const stopping = checkpoint.stopRequired && Math.hypot(state.position.x - checkpoint.center.x, state.position.z - checkpoint.center.z) <= checkpoint.radius - 0.2 + state.speed * state.speed / 16
    const input = { throttle: stopping ? 0 : state.speed < 3 ? 1 : 0, brake: stopping || state.speed > 3.3 ? 1 : 0, steer }
    lastPacket = { cityId: 'lagos', journeyId: answer.session!.journeyId, sequence: answer.session!.nextSequence, frames: [input] }
    f.advance(100)
    answer = await post('/input', lastPacket)
    assert.equal(answer.ok, true, `frame ${frame}: ${answer.code}`)
    if (answer.session!.state.checkpointIndex > state.checkpointIndex && checkpoint.stopRequired) {
      assert.ok(state.stopDwellMs >= 900, 'a stop transition follows sustained stationary control frames')
      assert.ok(answer.session!.state.speed <= 0.35)
      assert.ok(Math.hypot(answer.session!.state.position.x - checkpoint.center.x, answer.session!.state.position.z - checkpoint.center.z) <= checkpoint.radius, 'stop is inside its authored zone')
    }
    frame++
  }
  const terminal = answer.session!
  assert.equal(terminal.state.status, 'complete', `lesson did not finish after ${frame} control frames at ${JSON.stringify(terminal.state.position)}`)
  assert.equal(terminal.state.assessment, 'passed')
  assert.deepEqual([...seen], [0, 1, 2])
  assert.ok(frame >= 20, 'the lesson needs actual driving and stopping inputs')
  assert.ok(lastPacket)
  const retry = await post('/input', lastPacket)
  assert.deepEqual([retry.ok, retry.duplicate, retry.session], [true, true, terminal])
  const restart = await post('/start', { cityId: 'lagos', requestId: f.id() })
  assert.deepEqual([restart.ok, restart.code, restart.session], [false, 'assessment_retained', terminal])
  const loaded = await (await f.request(path + '?city=lagos', null, cookie)).json() as DrivingResponse
  assert.deepEqual(loaded.session, terminal)
  const lifeAfter = await (await f.request('/api/life?city=lagos', null, cookie)).json() as typeof lifeBefore
  assert.deepEqual([lifeAfter.state.cash, lifeAfter.state.ledger], [lifeBefore.state.cash, lifeBefore.state.ledger], 'practice completion cannot mint a reward')
})
