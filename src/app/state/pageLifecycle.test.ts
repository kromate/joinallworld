import assert from 'node:assert/strict'
import test from 'node:test'
import { createPageLifecycle } from './pageLifecycle.ts'

function setup(connected = true) {
  const calls: string[] = []
  const game = { connected: { value: connected }, stop: () => { calls.push('stop') }, refresh: async () => { calls.push('refresh') } }
  const community = { destroy: () => { calls.push('destroy') }, ensure: async () => { calls.push('ensure') } }
  return { calls, life: createPageLifecycle(game, community) }
}

test('pagehide ends the community and the poll', () => {
  const { calls, life } = setup()
  life.onPageHide()
  assert.deepEqual(calls, ['destroy', 'stop'])
})

test('a page restored from the back/forward cache refreshes and starts the community again', async () => {
  const { calls, life } = setup()
  life.onPageHide(); calls.length = 0
  life.onPageShow({ persisted: true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['refresh', 'ensure'])
})

test('a normal pageshow does nothing, and a disconnected restore does not start the community', async () => {
  const a = setup()
  a.life.onPageShow({ persisted: false }); await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(a.calls, [])
  const b = setup(false)
  b.life.onPageShow({ persisted: true }); await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(b.calls, ['refresh'])
})
