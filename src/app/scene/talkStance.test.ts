import test from 'node:test'
import assert from 'node:assert/strict'
import { TALK_REACH, beginTalk, endTalk, facingStep, talkStand } from './talkStance.ts'

test('the player stands at talking distance on their own side of the person', () => {
  const stand = talkStand({ x: 0, z: 0 }, { x: 6, z: 0 })!
  assert.ok(Math.abs(stand.x - TALK_REACH) < 1e-9 && Math.abs(stand.z) < 1e-9)
  assert.equal(talkStand({ x: 0, z: 0 }, { x: 1.4, z: 0 }), null, 'already close enough')
  assert.ok(Math.hypot(...Object.values(talkStand({ x: 2, z: 2 }, { x: 2, z: 2 })!).map((v, i) => v - [2, 2][i]!)) > 1, 'standing on them: step off')
})

test('a small step toward the person turns the avatar to face them', () => {
  const step = facingStep({ x: 0, z: 0 }, { x: 0, z: 1.3 })
  assert.ok(step.x === 0 && step.z < 1.3 && step.z > 1.0)
})

test('beginTalk walks to the stand point and wakes the people; endTalk lets go', () => {
  const calls: string[] = []
  const venue = {
    talk: (a: string, b: string, ms?: number) => { calls.push(`talk ${a} ${b} ${ms}`); return a === 'npc:a' },
    ambientPeople: () => [{ id: 'npc:a', role: 'stander' as const, x: 0, z: 0, sitting: false, you: { x: 5, z: 0 } }],
    walkTo: (x: number, z: number) => { calls.push(`walk ${x.toFixed(1)} ${z.toFixed(1)}`); return true },
    wakeAmbient: () => { calls.push('wake'); return true },
  }
  assert.equal(beginTalk(venue, 'npc:nobody'), false)
  assert.equal(beginTalk(venue, 'npc:a'), true)
  endTalk(venue, 'npc:a')
  assert.deepEqual(calls.slice(1), ['talk npc:a you 90000', 'walk 1.3 0.0', 'wake', 'talk npc:a you 0', 'wake'])
})
