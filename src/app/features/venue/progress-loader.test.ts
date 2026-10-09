import assert from 'node:assert/strict'
import test from 'node:test'
import { createProgressLoader } from './progress-loader.ts'

test('progress loader does no work until requested and shares the successful renderer once', async () => {
  let calls = 0
  const renderer = { name: 'running-progress' }
  const load = createProgressLoader(async () => { calls++; return renderer })
  assert.equal(calls, 0, 'the idle boundary does not fetch the renderer')
  const first = load()
  assert.equal(first, load(), 'simultaneous active requests share one import')
  assert.equal(await first, renderer)
  assert.equal(await load(), renderer)
  assert.equal(calls, 1, 'a successful renderer is retained')
})

test('a rejected progress import can be retried without reporting false success', async () => {
  let calls = 0
  const renderer = { name: 'running-progress' }
  const load = createProgressLoader(async () => {
    calls++
    if (calls === 1) throw new Error('offline')
    return renderer
  })
  await assert.rejects(load(), /offline/)
  assert.equal(await load(), renderer)
  assert.equal(await load(), renderer)
  assert.equal(calls, 2, 'the failed attempt retries once and later reads use the cached renderer')
})
