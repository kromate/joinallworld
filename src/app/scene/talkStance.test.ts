import test from 'node:test'
import assert from 'node:assert/strict'
import { TALK_REACH, beginTalk, endTalk, standAt, talkStand } from './talkStance.ts'

test('the player stands at talking distance on their own side of the person', () => {
  const stand = talkStand({ x: 0, z: 0 }, { x: 6, z: 0 })!
  assert.ok(Math.abs(stand.x - TALK_REACH) < 1e-9 && Math.abs(stand.z) < 1e-9)
  assert.equal(talkStand({ x: 0, z: 0 }, { x: 1.4, z: 0 }), null, 'already close enough')
  assert.ok(Math.hypot(...Object.values(talkStand({ x: 2, z: 2 }, { x: 2, z: 2 })!).map((v, i) => v - [2, 2][i]!)) > 1, 'standing on them: step off')
})

test('the lead point is on the same line, further out', () => {
  const p = standAt({ x: 0, z: 0 }, { x: 0, z: 1.3 }, 2.2)
  assert.ok(p.x === 0 && Math.abs(p.z - 2.2) < 1e-9)
})

test('beginTalk walks to the stand point, wakes the people, and endTalk lets go', () => {
  const calls: string[] = []
  const venue = {
    talk: (a: string, b: string, ms?: number) => { calls.push(`talk ${a} ${b} ${ms}`); return a === 'npc:a' },
    ambientPeople: () => [{ id: 'npc:a', role: 'stander' as const, x: 0, z: 0, sitting: false, you: { x: 5, z: 0 } }],
    walkTo: (x: number, z: number) => { calls.push(`walk ${x.toFixed(1)} ${z.toFixed(1)}`); return true },
    wakeAmbient: () => { calls.push('wake'); return true },
    position: () => ({ x: 5, z: 0, location: 'park' }),
  }
  assert.equal(beginTalk(venue, 'npc:nobody'), null)
  const run = beginTalk(venue, 'npc:a')!
  run.stop()
  endTalk(venue, 'npc:a')
  assert.deepEqual(calls.slice(1), ['talk npc:a you 1800000', 'walk 2.2 0.0', 'wake', 'talk npc:a you 0', 'wake'])
})
