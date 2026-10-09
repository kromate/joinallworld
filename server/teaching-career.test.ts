import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, flakyDisk } from './test-fixture.ts'
import type { LifeState } from '../src/types/life.ts'

type World = Awaited<ReturnType<typeof fixture>>
async function start(f: World) {
  const player = await f.device('Teacher')
  assert.equal((await f.action(player.cookie, { type: 'apply-job', payload: { id: 'teaching' } })).ok, true)
  assert.equal((await f.action(player.cookie, { type: 'spot', payload: { id: 'work' } })).ok, true)
  const started = await f.action(player.cookie, { type: 'activity', payload: { id: 'teaching-shift' } })
  assert.equal(started.ok, true)
  return { player, state: started.state }
}
function payload(state: LifeState, choice: string) {
  const action = state.activeAction
  assert.ok(action?.kind === 'activity' && action.teaching)
  return { generation: action.teachingGeneration, revision: action.teaching.revision, stage: action.teaching.stage, choice }
}
async function read(f: World, cookie: string): Promise<LifeState> {
  const response = await f.request('/api/life?city=lagos', null, cookie)
  assert.equal(response.status, 200)
  return ((await response.json()) as { state: LifeState }).state
}

test('real action receipts fence concurrent teaching answers, changed payloads and terminal wage retries', async t => {
  const f = await fixture(t, { interactiveTeachingStarts: true }), { player, state } = await start(f)
  f.advance(120_000)
  assert.equal((await read(f, player.cookie)).cash, state.cash, 'server time alone cannot complete teaching')
  const first = { type: 'career.teach', actionId: f.id(), payload: payload(state, 'denominator-count') }
  const raced = await Promise.all([f.action(player.cookie, first), f.action(player.cookie, { ...first, actionId: f.id() })])
  assert.equal(raced.filter(row => row.code === 'answered').length, 1)
  assert.equal(raced.filter(row => row.code === 'revision_conflict').length, 1)
  const changed = await f.action(player.cookie, { ...first, payload: { ...first.payload, choice: 'numerator-count' } })
  assert.equal(changed.error, 'action_id_conflict')
  let current = await read(f, player.cookie)
  current = (await f.action(player.cookie, { type: 'career.teach', payload: payload(current, 'same-whole-pieces') })).state
  const last = { type: 'career.teach', actionId: f.id(), payload: payload(current, 'one-fifth') }
  const terminal = await Promise.all([f.action(player.cookie, last), f.action(player.cookie, last)])
  assert.equal(terminal.filter(row => row.duplicate === true).length, 1)
  assert.ok(terminal.every(row => row.code === 'shift_completed'))
  const done = await read(f, player.cookie)
  assert.deepEqual([done.cash - state.cash, done.skills.charisma, done.completedShifts, done.career.performance, done.activeAction], [3000, 25, 1, 60, null])
  assert.equal(done.ledger.filter(row => row.amount === 3000).length, 1)
  assert.equal((await f.action(player.cookie, { ...last, actionId: f.id() })).code, 'no_teaching_shift')
})

test('a failed final teaching save rolls back wage, XP, performance and receipt before a successful retry', async t => {
  const disk = flakyDisk(), f = await fixture(t, { disk, lazyFlushMs: 0, interactiveTeachingStarts: true }), { player, state } = await start(f)
  let current = (await f.action(player.cookie, { type: 'career.teach', payload: payload(state, 'denominator-count') })).state
  current = (await f.action(player.cookie, { type: 'career.teach', payload: payload(current, 'same-whole-pieces') })).state
  const last = { type: 'career.teach', actionId: f.id(), payload: payload(current, 'one-fifth') }
  disk.fail = 'ENOSPC'
  const failed = await f.request('/api/action', { cityId: 'lagos', ...last }, player.cookie)
  assert.equal(failed.status, 503)
  disk.fail = null
  const beforeRetry = await read(f, player.cookie)
  assert.deepEqual([beforeRetry.cash, beforeRetry.skills.charisma, beforeRetry.completedShifts, beforeRetry.career.performance], [state.cash, 0, 0, 50])
  assert.equal(beforeRetry.activeAction?.kind === 'activity' && beforeRetry.activeAction.teaching?.stage, 'check')
  const repaired = await f.action(player.cookie, last)
  assert.equal(repaired.code, 'shift_completed')
  assert.equal(repaired.duplicate, undefined, 'failed disk save retained no success receipt')
  assert.equal(repaired.state.cash, state.cash + 3000)
  assert.equal((await f.action(player.cookie, last)).duplicate, true)
})


test('a gate-off HTTP teaching start ignores a request-supplied interactive capability', async t => {
  const f = await fixture(t)
  const player = await f.device('Legacy teacher')
  assert.equal((await f.action(player.cookie, { type: 'apply-job', payload: { id: 'teaching' } })).ok, true)
  assert.equal((await f.action(player.cookie, { type: 'spot', payload: { id: 'work' } })).ok, true)
  const started = await f.action(player.cookie, { type: 'activity', payload: { id: 'teaching-shift', interactiveTeachingStarts: true } })
  assert.equal(started.ok, true)
  assert.ok(started.state.activeAction?.kind === 'activity')
  assert.equal(started.state.activeAction.id, 'teaching-shift')
  assert.equal('teaching' in started.state.activeAction, false)
  assert.equal('teachingGeneration' in started.state.activeAction, false)
  assert.equal(started.state.career.teachingGeneration, 0)
  const lifeReply = await f.request('/api/life?city=lagos', null, player.cookie)
  assert.equal(lifeReply.status, 200)
  assert.equal('interactiveTeachingStarts' in (await lifeReply.json() as Record<string, unknown>), false)
})
