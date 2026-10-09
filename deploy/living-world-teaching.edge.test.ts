// Public Worker/SQLite persistence for active teaching. No raw lesson, balance, or progress rows are seeded.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { LifeState } from '../src/types/life.ts'

interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>
  unsafeGetDurableObjectStorage(script: string, name: string, id: { name: string }): Promise<StoredObject>
}
interface StoredObject {
  exec(sql: string, ...values: (string | number | null)[]): Promise<Record<string, unknown>[]>
}
interface WorkerTools {
  Miniflare: new (options: Record<string, unknown>) => WorkerHost
  convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown>
}
interface TeachingReply { status: number; ok?: boolean; code?: string; duplicate?: boolean; state?: LifeState; error?: string }

const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as WorkerTools
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }
const origin = 'https://joinallworld.test'
const look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const newId = (): string => `${Date.now()}:${randomUUID()}`

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-teaching-'))
  let worker: WorkerHost | null = null, address = 0
  t.after(async () => { try { await worker?.dispose() } finally { await rm(folder, { recursive: true, force: true }) } })
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  async function start(startEnabled = true) {
    await worker?.dispose()
    worker = new Miniflare({ ...convertV4MiniflareOptions({ name: 'joinallworld-teaching', script, modules: true,
      compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'teaching-fixture', FOUNDER_EMAIL_SHA256: '',
        ...(startEnabled ? { INTERACTIVE_TEACHING_STARTS: '1' } : {}) },
      serviceBindings: { ASSETS: () => new Response('asset') } }), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
    await worker.ready
  }
  async function storage(): Promise<StoredObject> {
    assert.ok(worker)
    return worker.unsafeGetDurableObjectStorage('joinallworld-teaching', 'JoinAllworldState', { name: 'joinallworld-v1' })
  }
  async function request(path: string, cookie = '', body?: object): Promise<Response> {
    assert.ok(worker)
    return worker.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: {
      origin, 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`,
      ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) })
  }
  async function player(name: string): Promise<string> {
    const created = await request('/api/session', '', { name, onboarding: true })
    assert.equal(created.status, 200)
    const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    assert.ok(cookie)
    const session = await created.json() as { session?: { id?: unknown; name?: unknown } }
    assert.equal(typeof session.session?.id, 'string')
    assert.equal(session.session?.name, name)
    await (await request('/api/life?city=lagos', cookie)).arrayBuffer()
    const played = await request('/api/action', cookie, { actionId: newId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look } })
    assert.equal((await played.json() as { code: string }).code, 'playing')
    return cookie
  }
  async function action(cookie: string, body: object): Promise<TeachingReply> {
    const response = await request('/api/action', cookie, body)
    return { status: response.status, ...await response.json() as Omit<TeachingReply, 'status'> }
  }
  async function life(cookie: string): Promise<LifeState> {
    const response = await request('/api/life?city=lagos', cookie)
    assert.equal(response.status, 200)
    return (await response.json() as { state: LifeState }).state
  }
  return { start, player, action, life, storage }
}

function activeTeaching(state: LifeState) {
  const action = state.activeAction
  assert.ok(action?.kind === 'activity' && action.id === 'teaching-shift' && action.teaching)
  const teaching = action.teaching
  const generation = action.teachingGeneration
  assert.ok(teaching && typeof generation === 'number' && Number.isSafeInteger(generation) && generation > 0)
  return { ...action, teaching, teachingGeneration: generation }
}

function answerBody(state: LifeState, choice: string, actionId = newId()) {
  const active = activeTeaching(state)
  return { actionId, cityId: 'lagos', type: 'career.teach', payload: {
    generation: active.teachingGeneration, revision: active.teaching.revision, stage: active.teaching.stage, choice,
  } }
}

test('active lesson, authored answers, once receipt, and completed shift survive real Worker restarts', async t => {
  const h = await fixture(t)
  await h.start()
  const cookie = await h.player('Teacher')

  // Normal public setup: turn off automatic travel, take the job, select its actual work spot, start the shift.
  assert.equal((await h.action(cookie, { actionId: newId(), cityId: 'lagos', type: 'career.auto', payload: { on: false } })).code, 'auto_set')
  assert.equal((await h.action(cookie, { actionId: newId(), cityId: 'lagos', type: 'apply-job', payload: { id: 'teaching' } })).code, 'applied')
  assert.equal((await h.action(cookie, { actionId: newId(), cityId: 'lagos', type: 'spot', payload: { id: 'work' } })).code, 'selected')
  const begun = await h.action(cookie, { actionId: newId(), cityId: 'lagos', type: 'activity', payload: { id: 'teaching-shift' } })
  assert.deepEqual([begun.status, begun.code], [200, 'started'])
  const initial = await h.life(cookie), initialAction = activeTeaching(initial)
  const initialCash = initial.cash, initialRemaining = initialAction.remaining
  const generation = initialAction.teachingGeneration

  // Recreate the Worker against the same SQLite directory with new interactive starts disabled.
  // The existing marker must remain readable and answerable under the gate-off host policy.
  await h.start(false)
  const restored = await h.life(cookie), restoredAction = activeTeaching(restored)
  assert.deepEqual([restoredAction.teaching, restoredAction.teachingGeneration, restored.career.teachingGeneration,
    restoredAction.remaining, restored.cash], [initialAction.teaching, generation, generation, initialRemaining, initialCash])

  // A wrong answer is recoverable and cannot pay. Ordinary elapsed server time also cannot settle this lesson.
  const wrong = await h.action(cookie, answerBody(restored, 'numerator-count'))
  assert.equal(wrong.code, 'retry')
  const afterWrong = await h.life(cookie), afterWrongAction = activeTeaching(afterWrong)
  assert.deepEqual([afterWrongAction.teaching?.stage, afterWrongAction.teaching?.feedback, afterWrong.cash], ['diagnose', 'retry', initialCash])
  await delay(1_250)
  const afterWait = await h.life(cookie), afterWaitAction = activeTeaching(afterWait)
  assert.deepEqual([afterWaitAction.remaining, afterWaitAction.teaching, afterWait.cash],
    [afterWrongAction.remaining, afterWrongAction.teaching, initialCash], 'elapsed time and reload preserve the unresolved lesson without a wage')

  for (const choice of ['denominator-count', 'same-whole-pieces']) {
    const current = await h.life(cookie)
    const answer = await h.action(cookie, answerBody(current, choice))
    assert.equal(answer.code, 'answered')
  }
  const beforeFinal = await h.life(cookie)
  const finalIntent = answerBody(beforeFinal, 'one-fifth')
  const db = await h.storage()
  await db.exec(`CREATE TRIGGER test_reject_teaching_wage BEFORE INSERT ON wallet_effects
    WHEN NEW.amount = 3000 AND NEW.reason = 'Teaching shift'
    BEGIN SELECT RAISE(ABORT, 'teaching wage write injected'); END`)
  let failed: TeachingReply
  try { failed = await h.action(cookie, finalIntent) }
  finally { await db.exec('DROP TRIGGER IF EXISTS test_reject_teaching_wage') }
  assert.deepEqual([failed.status, failed.error], [503, 'storage_unavailable'])
  const afterFailure = await h.life(cookie), failedAction = activeTeaching(afterFailure)
  assert.deepEqual([failedAction.teaching, failedAction.teachingGeneration, afterFailure.cash,
    afterFailure.completedShifts, afterFailure.career.shifts, afterFailure.career.performance,
    afterFailure.skills.charisma, afterFailure.career.teachingGeneration,
    afterFailure.ledger.filter(row => row.amount === 3000).length],
    [beforeFinal.activeAction && beforeFinal.activeAction.kind === 'activity' ? beforeFinal.activeAction.teaching : null,
      generation, beforeFinal.cash, beforeFinal.completedShifts, beforeFinal.career.shifts, beforeFinal.career.performance,
      beforeFinal.skills.charisma, generation, beforeFinal.ledger.filter(row => row.amount === 3000).length])
  const receipts = await db.exec('SELECT COUNT(*) AS count FROM action_receipts WHERE action_id = ?', finalIntent.actionId)
  assert.equal(receipts[0]?.['count'], 0, 'the failed transaction did not retain the action receipt')

  const [one, duplicate] = await Promise.all([h.action(cookie, finalIntent), h.action(cookie, finalIntent)])
  assert.deepEqual([one.status, one.code, duplicate.status, duplicate.code, [one.duplicate, duplicate.duplicate].filter(Boolean).length],
    [200, 'shift_completed', 200, 'shift_completed', 1])
  const completed = await h.life(cookie)
  assert.deepEqual([completed.activeAction, completed.cash - initialCash, completed.completedShifts,
    completed.career.shifts, completed.skills.charisma, completed.career.performance,
    completed.ledger.filter(row => row.amount === 3000).length], [null, 3000, 1, 1, 25, 60, 1])

  await h.start(false)
  const completedAfterRestart = await h.life(cookie)
  assert.deepEqual([completedAfterRestart.activeAction, completedAfterRestart.cash, completedAfterRestart.ledger],
    [null, completed.cash, completed.ledger])
  const replay = await h.action(cookie, finalIntent)
  assert.deepEqual([replay.status, replay.code, replay.duplicate], [200, 'shift_completed', true])
  const afterReplay = await h.life(cookie)
  assert.deepEqual([afterReplay.cash, afterReplay.completedShifts, afterReplay.career.shifts,
    afterReplay.ledger.filter(row => row.amount === 3000).length], [completed.cash, 1, 1, 1])

  // With the same gate-off Worker, a new public teaching start remains the legacy timed activity.
  const legacyCookie = await h.player('Legacy teacher')
  assert.equal((await h.action(legacyCookie, { actionId: newId(), cityId: 'lagos', type: 'career.auto', payload: { on: false } })).code, 'auto_set')
  assert.equal((await h.action(legacyCookie, { actionId: newId(), cityId: 'lagos', type: 'apply-job', payload: { id: 'teaching' } })).code, 'applied')
  assert.equal((await h.action(legacyCookie, { actionId: newId(), cityId: 'lagos', type: 'spot', payload: { id: 'work' } })).code, 'selected')
  const legacyStart = await h.action(legacyCookie, { actionId: newId(), cityId: 'lagos', type: 'activity', payload: { id: 'teaching-shift' } })
  assert.deepEqual([legacyStart.status, legacyStart.code], [200, 'started'])
  const legacy = await h.life(legacyCookie)
  assert.ok(legacy.activeAction?.kind === 'activity' && legacy.activeAction.id === 'teaching-shift')
  assert.equal('teaching' in legacy.activeAction, false)
  assert.equal('teachingGeneration' in legacy.activeAction, false)
  assert.equal(legacy.career.teachingGeneration, 0)
})
