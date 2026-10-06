// The routing of "Go there" for the odd job, the bench and the tap, from the help card and from the goal line: where each entry point sends the player.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trek } from './trek.ts'
import type { TrekEnv } from './trek.ts'

function fake(over: Partial<TrekEnv> & { at?: string; accepts?: boolean } = {}) {
  const calls: string[] = []
  let listener: ((location: string, running: boolean) => void) | null = null
  const env: TrekEnv = {
    here: () => over.at ?? 'airport',
    walk: async (venue) => { calls.push(`walk ${venue}`); return over.accepts !== false },
    card: async (venue, spot) => { calls.push(`card ${venue}${spot ? `/${spot}` : ''}`) },
    settle: (next) => { listener = next; return () => { listener = null; calls.push('stopped') } },
    arrived: (spot) => { calls.push(`arrived ${spot ?? ''}`) },
    mark: () => { calls.push('mark') },
  }
  return { env, calls, tell: (location: string, running: boolean) => listener?.(location, running), listening: () => listener !== null }
}

test('already at the place: the spot is chosen and the card is marked at once', async () => {
  const f = fake({ at: 'pleasure-park' })
  await trek(f.env, 'pleasure-park', 'lawn')
  assert.deepEqual(f.calls, ['card pleasure-park/lawn', 'mark'])
})
test('from the airport: the free walk starts, and on arrival the spot is chosen and the card marked, without another tap', async () => {
  const f = fake()
  await trek(f.env, 'pleasure-park', 'lawn')
  assert.deepEqual(f.calls, ['walk pleasure-park'])
  f.tell('airport', false); assert.ok(f.listening(), 'a state change before the walk shows as running changes nothing')
  f.tell('airport', true); f.tell('pleasure-park', false)
  assert.deepEqual(f.calls, ['walk pleasure-park', 'stopped', 'arrived lawn', 'mark'])
  assert.equal(f.listening(), false)
})
test('a walk that is cancelled on the way chooses nothing', async () => {
  const f = fake()
  await trek(f.env, 'pleasure-park', 'lawn')
  f.tell('airport', true); f.tell('airport', false)
  assert.deepEqual(f.calls, ['walk pleasure-park', 'stopped'])
})
test('a walk the server refuses opens the place on the Map instead, with the spot remembered', async () => {
  const f = fake({ accepts: false })
  await trek(f.env, 'pleasure-park', 'lawn')
  assert.deepEqual(f.calls, ['walk pleasure-park', 'card pleasure-park/lawn'])
  assert.equal(f.listening(), false)
})
