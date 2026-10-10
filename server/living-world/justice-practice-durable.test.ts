/**
 * Justice practice save integrity through the registered production routes: every opening order of the three
 * records, rows saved in the earlier non-canonical shape, refused forgeries, no-write reads and replays, and a
 * cold reopen of the Node file store.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { fixture, snapshot } from '../test-fixture.ts'
import { createServer } from '../server.ts'
import type { AllworldServer } from '../server.ts'
import { readValidatedJusticePracticeRecord } from './justice-practice-service.ts'
import { INITIAL_ORDERS, journey, legacyStates } from './justice-practice-legacy-rows.ts'
import type { InitialEvidenceId } from './justice-practice-legacy-rows.ts'
import type { Look } from '../../src/types/life.ts'
import type { JusticeEvidenceId, JusticePracticeAction } from '../../src/game/living-world/justice-practice.ts'

const PATH = '/api/living-world/justice-practice'
const AUTHORED: readonly JusticeEvidenceId[] = ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount']
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Fixture = Awaited<ReturnType<typeof fixture>>
type Request = (path: string, body?: unknown, cookie?: string) => Promise<Response>
type Player = { cookie: string; id: string }
type Reply = { ok?: boolean; code?: string; error?: string; duplicate?: true; practice?: { phase: string; revision: number; reviewedEvidenceIds: string[]; trainingComplete: boolean } | null; revision?: number | null }

async function signIn(request: Request, name: string, id: () => string): Promise<Player> {
  const response = await request('/api/session', { name, onboarding: true })
  assert.equal(response.status, 200)
  const payload = await response.json() as { session?: { id?: string } }
  const player = { cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: payload.session?.id ?? '' }
  assert.ok(player.cookie && player.id)
  const confirmed = await request('/api/action', { actionId: id(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, player.cookie)
  assert.equal((await confirmed.json() as { code: string }).code, 'playing')
  return player
}

function api(request: Request, id: () => string) {
  return {
    get: async (who: Player): Promise<Reply> => await (await request(`${PATH}?city=lagos`, undefined, who.cookie)).json() as Reply,
    start: async (who: Player, requestId = id()): Promise<Reply> => await (await request(`${PATH}/start`, { cityId: 'lagos', requestId }, who.cookie)).json() as Reply,
    step: async (who: Player, expectedRevision: number, action: JusticePracticeAction, requestId = id()): Promise<Reply> =>
      await (await request(`${PATH}/step`, { cityId: 'lagos', requestId, expectedRevision, action }, who.cookie)).json() as Reply,
    raw: async (who: Player, body: unknown): Promise<{ status: number; error?: string }> => {
      const response = await request(`${PATH}/step`, body, who.cookie)
      return { status: response.status, ...(response.status === 200 ? {} : { error: (await response.json() as Reply).error as string }) }
    },
  }
}

const rowOf = (f: Fixture, who: Player): Promise<string> => f.server.store.read(db =>
  JSON.stringify((db.livingWorld as { justicePractice?: Record<string, unknown> } | undefined)?.justicePractice?.[who.id] ?? null))
const parsed = (text: string, who: Player) => readValidatedJusticePracticeRecord(JSON.parse(text), who.id)
const canonical = (ids: readonly string[]): string[] => AUTHORED.filter(id => ids.includes(id))
const label = (order: readonly string[]) => order.map(id => id.split('-')[0]).join(' then ')

/** Replace a freshly started practice with the stored shape the earlier transition wrote (legacy fixture, not a repair). */
async function seedLegacy(f: Fixture, who: Player, order: readonly InitialEvidenceId[], upTo: number): Promise<void> {
  const practice = legacyStates(order)[upTo]!
  await f.server.store.transact(db => {
    const row = (db.livingWorld as { justicePractice: Record<string, { practice: unknown }> }).justicePractice[who.id]!
    row.practice = snapshot(practice)
  })
}
const lastLegacy = (order: readonly InitialEvidenceId[]) => legacyStates(order).length - 1

test('all six opening orders persist through the registered service as strictly readable canonical rows and read back', { timeout: 120_000 }, async t => {
  assert.equal(INITIAL_ORDERS.length, 6)
  const f = await fixture(t, { log: () => {} }), s = api(f.request, f.id)
  for (const order of INITIAL_ORDERS) {
    const who = await signIn(f.request, `Order ${INITIAL_ORDERS.indexOf(order) + 1}`, f.id)
    assert.equal((await s.start(who)).code, 'practice_started')
    let revision = 0
    for (const action of journey(order)) {
      const reply = await s.step(who, revision, action)
      assert.equal(reply.ok, true, `${label(order)} ${action.kind}`)
      revision = reply.revision!
      const stored = parsed(await rowOf(f, who), who)
      assert.ok(stored, `${label(order)} revision ${revision} is strictly readable after the write`)
      assert.deepEqual(stored.practice.inspectedEvidenceIds, canonical(stored.practice.inspectedEvidenceIds), 'stored in authored order')
      assert.equal(stored.practice.revision, revision)
      const read = await s.get(who)
      assert.deepEqual([read.practice?.revision, read.practice?.phase], [stored.practice.revision, stored.practice.phase])
    }
    const done = await s.get(who)
    assert.deepEqual([done.code, done.practice?.trainingComplete, done.practice?.reviewedEvidenceIds], ['practice_complete', true, AUTHORED])
    assert.equal(parsed(await rowOf(f, who), who)?.practice.receipts.length, 7)
  }
})

test('rows saved in the earlier non-canonical shape are read, resumed and completed without losing their receipts', { timeout: 120_000 }, async t => {
  const f = await fixture(t, { log: () => {} }), s = api(f.request, f.id)
  let stuck = 0
  for (const order of INITIAL_ORDERS) {
    const states = legacyStates(order), last = states.length - 1
    const who = await signIn(f.request, `Legacy ${INITIAL_ORDERS.indexOf(order) + 1}`, f.id)
    await s.start(who)
    await seedLegacy(f, who, order, last)
    const seeded = await rowOf(f, who), legacy = states[last]!
    if (legacy.inspectedEvidenceIds.some((id, i, list) => i > 0 && AUTHORED.indexOf(id) < AUTHORED.indexOf(list[i - 1]!))) stuck++
    assert.deepEqual(JSON.parse(seeded).practice.inspectedEvidenceIds, legacy.inspectedEvidenceIds, 'the stored list really is in opening order')
    const strict = parsed(seeded, who)
    assert.ok(strict, `${label(order)}: the strict reader accepts the earlier shape`)
    assert.deepEqual(strict.practice.inspectedEvidenceIds, canonical(legacy.inspectedEvidenceIds))
    assert.deepEqual(strict.practice.receipts, legacy.receipts, 'receipts are preserved')

    const first = await s.get(who)
    assert.deepEqual([first.ok, first.practice?.revision, first.practice?.phase], [true, legacy.revision, legacy.phase])
    assert.equal(await rowOf(f, who), seeded, 'reading does not rewrite the earlier shape')

    let revision = legacy.revision
    for (const action of journey(order).slice(last)) {
      const reply = await s.step(who, revision, action)
      assert.equal(reply.ok, true, `${label(order)} resumes with ${action.kind}`)
      revision = reply.revision!
      const stored = parsed(await rowOf(f, who), who)
      assert.ok(stored)
      assert.deepEqual(stored.practice.inspectedEvidenceIds, canonical(stored.practice.inspectedEvidenceIds))
    }
    const finished = parsed(await rowOf(f, who), who)!
    assert.deepEqual([finished.practice.phase, finished.practice.revision, finished.practice.receipts.length], ['complete', 7, 7])
    assert.deepEqual(finished.practice.receipts.slice(0, legacy.receipts.length), legacy.receipts, 'earlier receipts stay first and unchanged')
  }
  assert.equal(stuck, 5, 'five of the six opening orders produced a row the earlier reader could not read')
})

test('forged or unknown evidence is refused without a write, and unreadable saved rows stay untouched', { timeout: 120_000 }, async t => {
  const f = await fixture(t, { log: () => {} }), s = api(f.request, f.id)
  const who = await signIn(f.request, 'Forger', f.id)
  await s.start(who)
  assert.equal((await s.step(who, 0, { kind: 'inspect', evidenceId: 'seal-log' })).ok, true)
  const before = await rowOf(f, who)
  for (const action of [{ kind: 'inspect', evidenceId: 'forged-clue' }, { kind: 'inspect', evidenceId: 'future-clue' },
    { kind: 'inspect', evidenceId: 'seal-log', completed: true }, { kind: 'inspect', evidenceId: ['seal-log', 'dispatch-copy'] },
    { kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['dispatch-copy', 'forged-clue'] }]) {
    const refused = await s.raw(who, { cityId: 'lagos', requestId: f.id(), expectedRevision: 1, action })
    assert.deepEqual([refused.status, refused.error], [400, 'invalid_justice_practice_request'], JSON.stringify(action))
    assert.equal(await rowOf(f, who), before, 'no write for a refused request')
  }
  const early = await s.step(who, 1, { kind: 'inspect', evidenceId: 'npc-recount' })
  assert.deepEqual([early.ok, early.practice?.phase, early.practice?.reviewedEvidenceIds], [true, 'inspect-initial', ['seal-log']], 'the later record cannot be opened early')
  const earlyRow = parsed(await rowOf(f, who), who)!
  assert.deepEqual(earlyRow.practice.inspectedEvidenceIds, ['seal-log'])
  assert.equal((await s.step(who, 1, { kind: 'inspect', evidenceId: 'arrival-receipt' }, f.id())).ok, false, 'a stale revision is a conflict')

  // Saved rows: each forgery is rejected by the strict reader, answered as unreadable, and left byte-for-byte unchanged.
  const base = JSON.parse(await rowOf(f, who)) as { practice: Record<string, unknown> } & Record<string, unknown>
  const receiptsOf = (b: typeof base) => b.practice.receipts as { action: { evidenceId?: string } }[]
  const forgeries: [string, (row: typeof base) => void][] = [
    ['an evidence order that matches neither authored nor opening order', row => { row.practice.inspectedEvidenceIds = ['seal-log', 'arrival-receipt']; receiptsOf(row)[0]!.action.evidenceId = 'dispatch-copy' }],
    ['an evidence list with a record that has no receipt', row => { row.practice.inspectedEvidenceIds = ['seal-log', 'dispatch-copy'] }],
    ['the later record listed in the first phase', row => { row.practice.inspectedEvidenceIds = ['seal-log', 'npc-recount'] }],
    ['an unknown evidence id', row => { row.practice.inspectedEvidenceIds = ['seal-log', 'future-clue'] }],
    ['a future practice schema', row => { row.practice.schemaVersion = 2 }],
    ['a future row version', row => { row.v = 2 }],
    ['a receipt dated past its revision', row => { (row.practice.receipts as { outcome: { revision: number } }[])[0]!.outcome.revision = 9 }],
  ]
  for (const [name, forge] of forgeries) {
    const row = JSON.parse(JSON.stringify(base)) as typeof base
    forge(row)
    assert.equal(readValidatedJusticePracticeRecord(row, who.id), null, name)
    await f.server.store.transact(db => { (db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[who.id] = snapshot(row) })
    const stored = await rowOf(f, who)
    const read = await s.get(who)
    assert.deepEqual([read.ok, read.code, read.practice], [false, 'invalid_saved_justice_practice', null], name)
    const write = await s.step(who, 1, { kind: 'inspect', evidenceId: 'dispatch-copy' })
    assert.deepEqual([write.ok, write.code, write.practice], [false, 'invalid_saved_justice_practice', null], name)
    assert.equal(await rowOf(f, who), stored, `${name}: left unchanged`)
  }
  // A row dated after the server clock is hidden, not rewritten.
  await f.server.store.transact(db => { (db.livingWorld as { justicePractice: Record<string, { updatedAt: number }> }).justicePractice[who.id] = { ...snapshot(base), updatedAt: f.now() + 86_400_000, createdAt: f.now() } as never })
  const dated = await rowOf(f, who)
  assert.equal((await s.get(who)).code, 'invalid_server_clock')
  assert.equal((await s.step(who, 1, { kind: 'inspect', evidenceId: 'dispatch-copy' })).code, 'invalid_server_clock')
  assert.equal(await rowOf(f, who), dated)
})

test('reads and duplicate deliveries leave the practice row byte-identical, including a row in the earlier shape', { timeout: 120_000 }, async t => {
  const f = await fixture(t, { log: () => {} }), s = api(f.request, f.id)
  const who = await signIn(f.request, 'Replayer', f.id)
  const startId = f.id()
  await s.start(who, startId)
  const stepId = f.id(), action: JusticePracticeAction = { kind: 'inspect', evidenceId: 'seal-log' }
  const applied = await s.step(who, 0, action, stepId)
  assert.deepEqual([applied.ok, applied.duplicate], [true, undefined])
  const settled = await rowOf(f, who)
  f.advance(5_000)
  await s.get(who); await s.get(who)
  assert.equal(await rowOf(f, who), settled, 'GET does not rewrite the row, even after the session was renewed')
  const again = await s.step(who, 0, action, stepId)
  assert.deepEqual([again.ok, again.duplicate, again.revision], [true, true, 1])
  assert.equal(await rowOf(f, who), settled, 'the same request delivered again does not rewrite the row')
  assert.equal((await s.start(who, startId)).duplicate, true)
  assert.equal(await rowOf(f, who), settled, 'a replayed start does not rewrite the row')
  const conflict = await s.raw(who, { cityId: 'lagos', requestId: stepId, expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'arrival-receipt' } })
  assert.deepEqual([conflict.status, conflict.error], [409, 'client_id_conflict'])
  assert.equal(await rowOf(f, who), settled)

  const order: InitialEvidenceId[] = ['seal-log', 'dispatch-copy', 'arrival-receipt']
  const old = await signIn(f.request, 'Replayer legacy', f.id)
  await s.start(old); await seedLegacy(f, old, order, lastLegacy(order))
  const legacyBytes = await rowOf(f, old)
  f.advance(5_000)
  assert.equal((await s.get(old)).ok, true)
  assert.equal((await s.get(old)).ok, true)
  assert.equal(await rowOf(f, old), legacyBytes, 'reading an earlier-shape row never rewrites it')
})

async function host(dataDir: string, clock: { now: number }) {
  const server = await createServer({ dataDir, now: () => clock.now, log: () => {}, heartbeatMs: 60_000 })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const request: Request = (path, body, cookie) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { server, request }
}
async function stop(server: AllworldServer): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await server.store.close?.()
}
async function fileRow(dataDir: string, id: string): Promise<Record<string, unknown>> {
  const db = JSON.parse(await readFile(join(dataDir, 'devices.json'), 'utf8')) as { livingWorld?: { justicePractice?: Record<string, Record<string, unknown>> } }
  const row = db.livingWorld?.justicePractice?.[id]
  assert.ok(row, 'the row is in the data file')
  return row
}

test('Node file store: a practice written through the service, in a new and in the earlier shape, survives a cold reopen', { timeout: 120_000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-justice-node-reopen-'))
  let current: AllworldServer | null = null
  t.after(async () => { try { if (current) await stop(current) } finally { await rm(dataDir, { recursive: true, force: true }) } })
  const clock = { now: 100_000 }, id = () => `${clock.now}:${randomUUID()}`
  const order: InitialEvidenceId[] = ['seal-log', 'arrival-receipt', 'dispatch-copy']
  const legacyOrder: InitialEvidenceId[] = ['arrival-receipt', 'dispatch-copy', 'seal-log']

  let app = await host(dataDir, clock); current = app.server
  let s = api(app.request, id)
  const fresh = await signIn(app.request, 'Reopen new', id), old = await signIn(app.request, 'Reopen legacy', id)
  await s.start(fresh)
  let revision = 0
  for (const action of journey(order).slice(0, 4)) revision = (await s.step(fresh, revision, action)).revision!
  await s.start(old)
  const legacy = legacyStates(legacyOrder)[lastLegacy(legacyOrder)]!
  await app.server.store.transact(db => { (db.livingWorld as { justicePractice: Record<string, { practice: unknown }> }).justicePractice[old.id]!.practice = snapshot(legacy) })
  const freshBefore = await fileRow(dataDir, fresh.id), legacyBefore = await fileRow(dataDir, old.id)
  assert.deepEqual((freshBefore['practice'] as { inspectedEvidenceIds: string[] }).inspectedEvidenceIds, ['dispatch-copy', 'arrival-receipt', 'seal-log'])
  assert.deepEqual((legacyBefore['practice'] as { inspectedEvidenceIds: string[] }).inspectedEvidenceIds, legacy.inspectedEvidenceIds)

  await stop(current); current = null
  clock.now += 60_000
  app = await host(dataDir, clock); current = app.server
  s = api(app.request, id)
  assert.deepEqual(await fileRow(dataDir, fresh.id), freshBefore, 'the file row is unchanged by the reopen')
  const cookies = { fresh, old }
  const reopenedNew = await s.get(cookies.fresh), reopenedOld = await s.get(cookies.old)
  assert.deepEqual([reopenedNew.ok, reopenedNew.practice?.phase, reopenedNew.practice?.revision], [true, 'serve-notice', 4])
  assert.deepEqual([reopenedOld.ok, reopenedOld.practice?.phase, reopenedOld.practice?.revision], [true, legacy.phase, legacy.revision])
  assert.deepEqual(await fileRow(dataDir, fresh.id), freshBefore)
  assert.deepEqual(await fileRow(dataDir, old.id), legacyBefore, 'reading after reopen does not rewrite either row')
  // The saved session cookie still works, and the replayed request answers from the saved receipt.
  const replay = await s.step(fresh, 0, journey(order)[0]!, (freshBefore['practice'] as { receipts: { requestId: string }[] }).receipts[0]!.requestId)
  assert.deepEqual([replay.ok, replay.duplicate, replay.revision], [true, true, 4], 'the request delivered before the restart is answered from its saved receipt')
  assert.deepEqual(await fileRow(dataDir, fresh.id), freshBefore, 'the replay after reopen does not rewrite the row')

  for (const [who, steps, from] of [[fresh, journey(order).slice(4), 4], [old, journey(legacyOrder).slice(lastLegacy(legacyOrder)), legacy.revision]] as const) {
    let at: number = from
    for (const action of steps) {
      const reply = await s.step(who, at, action)
      assert.equal(reply.ok, true)
      at = reply.revision!
    }
  }
  await stop(current); current = null
  clock.now += 60_000
  app = await host(dataDir, clock); current = app.server
  s = api(app.request, id)
  for (const who of [fresh, old]) {
    const done = await s.get(who)
    assert.deepEqual([done.ok, done.code, done.practice?.trainingComplete, done.practice?.reviewedEvidenceIds], [true, 'practice_complete', true, AUTHORED])
    const row = await fileRow(dataDir, who.id)
    assert.ok(readValidatedJusticePracticeRecord(row, who.id), 'the completed row in the file is strictly readable')
    assert.deepEqual((row['practice'] as { inspectedEvidenceIds: string[] }).inspectedEvidenceIds, AUTHORED)
    assert.equal((row['practice'] as { receipts: unknown[] }).receipts.length, 7)
  }
})
