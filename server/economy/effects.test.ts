import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCityContent } from '../../src/game/cities/registry.ts'
import { JOBS } from '../../src/game/content/jobs.ts'
import { makeContext } from '../../src/game/util.ts'
import { advanceLife, createLife, dispatch } from '../../src/life.ts'
import { applyLifeAction, settleCity } from '../life-service.ts'
import { createStore } from '../store.ts'
import type { SessionRecord } from '../types.ts'
import { drainWalletEffects, walletEffectSink } from './effects.ts'

const PUBLIC_ID = '00000000-0000-4000-8000-000000000001'
const session = (): SessionRecord => ({ secret: 'secret', publicId: PUBLIC_ID, name: 'Ada', expiresAt: 99_999_999, cities: {}, actions: {}, rev: 0 })
const OTHER_ID = '00000000-0000-4000-8000-000000000002'

test('wallet effect collector appends in operation order and drains a re-keyed session once', () => {
  const record = session(), effect = (at: number) => ({ at, amount: 1, balanceAfter: 5000 + at, reason: `Effect ${at}` })
  walletEffectSink(record, 'lagos', 'one')(effect(1)); walletEffectSink(record, 'lagos', 'one')(effect(2)); walletEffectSink(record, 'lagos', 'two')(effect(3))
  assert.deepEqual(drainWalletEffects([record, record]).map(row => [row.operationId, row.ordinal]), [['one', 0], ['one', 1], ['two', 0]])
  assert.deepEqual(drainWalletEffects([record]), [])
})

test('Node abort drops cash and effects; retry commits exactly one effect and forces lazy durability', async t => {
  await loadCityContent('lagos'); const directory = await mkdtemp(join(tmpdir(), 'allworld-wallet-effects-')); const store = await createStore(directory, { lazyFlushMs: 60000 })
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }) })
  await store.transact(db => { const record = session(); db.sessions[record.secret] = record; settleCity(record, 'lagos', 1000) })
  const act = async (abort: boolean): Promise<void> => store.transact(db => {
    const record = db.sessions.secret; assert.ok(record); const state = settleCity(record, 'lagos', 2000)
    const result = applyLifeAction(state, { type: 'social.server', cityId: 'lagos', actionId: 'effect-retry', payload: { op: 'transfer-in', from: OTHER_ID, name: 'Bola', amount: 100 } }, { now: 2000, cityId: 'lagos', internal: true })
    assert.equal(result.ok, true); if (abort) throw new Error('injected after wallet mutation')
  }, { durable: false }).then(() => {})
  await assert.rejects(act(true), /injected/)
  assert.deepEqual(await store.read(db => [db.sessions.secret?.cities.lagos?.state.cash, db.walletEffects?.length ?? 0]), [5000, 0])
  await act(false)
  assert.deepEqual(await store.read(db => [db.sessions.secret?.cities.lagos?.state.cash, db.walletEffects?.map(row => [row.operationId,row.amount,row.balanceAfter])]), [5100,[['effect-retry',100,5100]]])
  const saved = JSON.parse(await readFile(join(directory, 'devices.json'), 'utf8')) as { walletEffects?: unknown[] }
  assert.equal(saved.walletEffects?.length, 1, 'a monetary transaction requested as lazy was durable before it returned')
})

test('a real completed shift counts and displays only cash the wallet actually credited', async () => {
  await loadCityContent('lagos')
  const job = JOBS.teaching, shift = job.shift, now = Date.UTC(2026, 0, 5, 8)
  const running = (cash: number) => {
    const context = makeContext({ now, cityId: 'lagos', seed: `shift-${cash}` })
    const state = createLife({ t: now, cash: 5000, job: job.id, location: job.workplace.venue, spot: job.workplace.spot }, context)
    const started = dispatch(state, { type: 'activity', payload: { id: shift.id } }, context)
    assert.equal(started.ok, true)
    // The wallet may fill while an already-running shift is in progress. Keep the
    // start-time projected-reward guard intact and exercise settlement at that cap.
    state.cash = cash
    return state
  }
  const complete = (state: ReturnType<typeof running>, seed: string) => {
    const finishedAt = now + shift.duration * 1000
    advanceLife(state, shift.duration, makeContext({ now: finishedAt, cityId: 'lagos', seed: `${seed}-timer` }))
    const answers = [
      ['diagnose', 'denominator-count'],
      ['explain', 'same-whole-pieces'],
      ['check', 'one-fifth'],
    ] as const
    for (const [stage, choice] of answers) {
      const active = state.activeAction
      assert.ok(active?.kind === 'activity' && active.id === shift.id && active.teaching)
      assert.ok(typeof active.teachingGeneration === 'number' && Number.isSafeInteger(active.teachingGeneration) && active.teachingGeneration > 0,
        'the full engine issued a positive safe teaching generation')
      const result = dispatch(state, { type: 'career.teach', payload: {
        generation: active.teachingGeneration, revision: active.teaching.revision, stage, choice,
      } }, makeContext({ now: finishedAt, cityId: 'lagos', seed: `${seed}-${stage}` }))
      assert.equal(result.ok, true, `${stage} answer completes the authored lesson`)
    }
    assert.equal(state.activeAction, null)
  }
  const full = running(Number.MAX_SAFE_INTEGER)
  complete(full, 'full-shift')
  assert.equal(full.cash, Number.MAX_SAFE_INTEGER)
  assert.equal(full.social.earned, 0)
  assert.equal(full.ledger.some(line => line.reason === shift.label), false)
  assert.doesNotMatch(full.message, /earned ₦3,000/)
  const ordinary = running(5000)
  complete(ordinary, 'ordinary-shift')
  assert.equal(ordinary.cash, 8000)
  assert.equal(ordinary.social.earned, 3000)
  assert.equal(ordinary.ledger.at(-1)?.amount, 3000)
  assert.match(ordinary.message, /earned ₦3,000/)
})

test('an existing corrupt wallet is refused without mutation while an absent life keeps the new-life default', async () => {
  await loadCityContent('lagos')
  for (const [index, entry] of [null, {}, { state: {} }, { state: { cash: -1 } }, { state: { cash: Number.MAX_SAFE_INTEGER + 1 } }].entries()) {
    const record = session(); Reflect.set(record.cities, 'lagos', entry); const before = JSON.stringify(record)
    assert.throws(() => settleCity(record, 'lagos', 1000), (error: unknown) => typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'economy_unavailable', `corrupt entry ${index}`)
    assert.equal(JSON.stringify(record), before)
  }
  assert.equal(settleCity(session(), 'lagos', 1000).cash, 5000)
})
