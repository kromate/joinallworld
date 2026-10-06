import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FRESH_AFTER_MS, RELOAD_KEY, RELOAD_MAX, RELOAD_WINDOW_MS, SLOW_AFTER_MS, bootStage, nextStageIn, startFresh, takeAutoReload } from './bootWatch.ts'

const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { raw: Map<string, string> } => {
  const raw = new Map<string, string>()
  return { raw, getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => { raw.set(k, v) } }
}

test('the loading screen moves from loading to slow at 15 s and to start-fresh at 40 s', () => {
  assert.deepEqual([0, SLOW_AFTER_MS - 1, SLOW_AFTER_MS, FRESH_AFTER_MS - 1, FRESH_AFTER_MS, 120_000].map(bootStage), ['loading', 'loading', 'slow', 'slow', 'fresh', 'fresh'])
  assert.equal(nextStageIn(5_000), 10_000)
  assert.equal(nextStageIn(SLOW_AFTER_MS), 25_000)
  assert.equal(nextStageIn(FRESH_AFTER_MS), null)
})

test('an automatic reload is allowed three times in three minutes, then the player is asked; old ones age out', () => {
  const m = memory()
  assert.deepEqual([1_000, 2_000, 3_000, 4_000].map((at) => takeAutoReload(m, at)), [true, true, true, false])
  assert.equal(JSON.parse(m.raw.get(RELOAD_KEY) as string).length, RELOAD_MAX)
  assert.equal(takeAutoReload(m, 1_000 + RELOAD_WINDOW_MS - 1), false)
  assert.equal(takeAutoReload(m, 1_000 + RELOAD_WINDOW_MS), true)
})

test('where nothing can be remembered, or the record is damaged, the reload loop cannot start', () => {
  assert.equal(takeAutoReload(null, 1), false)
  assert.equal(takeAutoReload({ getItem: () => { throw new Error('blocked') }, setItem: () => undefined }, 1), false)
  assert.equal(takeAutoReload({ getItem: () => null, setItem: () => { throw new Error('full') } }, 1), false)
  const damaged = memory(); damaged.raw.set(RELOAD_KEY, '{nope')
  assert.equal(takeAutoReload(damaged, 1), false)
  const odd = memory(); odd.raw.set(RELOAD_KEY, JSON.stringify(['x', null, 5]))
  assert.equal(takeAutoReload(odd, 10), true)
})

test('start fresh removes workers and cached files, skips a step that fails, and never throws', async () => {
  const gone: string[] = []
  const result = await startFresh({
    serviceWorker: { getRegistrations: async () => [{ unregister: async () => true }, { unregister: async () => { throw new Error('x') } }] },
    caches: { keys: async () => ['a', 'b'], delete: async (key) => { gone.push(key); return key === 'a' } },
  })
  assert.deepEqual(result, { workers: 1, caches: 1 })
  assert.deepEqual(gone, ['a', 'b'])
  assert.deepEqual(await startFresh({}), { workers: 0, caches: 0 })
  assert.deepEqual(await startFresh({ serviceWorker: { getRegistrations: async () => { throw new Error('no') } }, caches: { keys: async () => { throw new Error('no') }, delete: async () => true } }), { workers: 0, caches: 0 })
})
